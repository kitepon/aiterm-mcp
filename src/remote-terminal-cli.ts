#!/usr/bin/env node
// aiterm-remote-terminal (remote-terminal.md). Run as the UID that can read the terminal key.
//   status --ref R | register ... | trust-confirm --ref R --fingerprint F   (one JSON line; exit 0 result, 2 error)
//   serve        stdio MCP for one bound connection, spawned by BellTeam terminals
//   transcript-read --session S [--cursor-session ID --offset N] [--max-bytes N]   (runs on the terminal)
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RemoteTerminalConnection, RemoteTerminalError, bindingStatus, confirmHostKey, registerBinding, type RemoteCommandOp } from "./remote-terminal.js";
import { readCompletedTranscript } from "./transcript-read.js";
import { credentialHandleSchema } from "./remote-contract.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

function errorDto(error: unknown, schema: string): { schema: string; code: string; message: string; action?: string } {
  if (error instanceof RemoteTerminalError) return { schema, code: error.code, message: error.message, ...(error.action ? { action: error.action } : {}) };
  const message = error instanceof Error ? error.message : String(error);
  const code = /^([A-Z][A-Z0-9_]+):/.exec(message)?.[1] ?? "AITERM_FAILED";
  return { schema, code, message };
}

function oneShot(run: () => unknown, errorSchema: string): never {
  try { process.stdout.write(`${JSON.stringify(run())}\n`); process.exit(0); }
  catch (error) { process.stdout.write(`${JSON.stringify(errorDto(error, errorSchema))}\n`); process.exit(2); }
}

function serve(): void {
  const server = new McpServer({ name: "aiterm-remote-terminal", version: pkg.version });
  let connection: RemoteTerminalConnection | null = null;
  const ok = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> });
  const fail = (error: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(errorDto(error, "aiterm.remote-terminal-error.v1")) }], isError: true });
  const bound = () => { if (!connection) throw new RemoteTerminalError("NOT_OPEN", "remote_terminal_open first"); return connection; };
  const guarded = (fn: (args: any) => Promise<unknown> | unknown) => async (args: any) => { try { return ok(await fn(args)); } catch (error) { return fail(error); } };

  server.registerTool("remote_terminal_status", { description: "Public status of a terminal binding", inputSchema: { ref: z.string() } },
    guarded(({ ref }) => bindingStatus(ref)));
  server.registerTool("remote_terminal_open", {
    description: "Open the bound connection for this process",
    inputSchema: { ref: z.string(), target: z.object({ host: z.string(), user: z.string(), port: z.number().int() }).strict(),
      trustRevision: z.string(), credentialRevision: z.string().optional(), credential: credentialHandleSchema.optional(),
      sudoCredential: credentialHandleSchema.optional(), privateEnv: z.record(z.string(), z.string()).optional() },
  }, guarded(async args => {
    if (connection) throw new RemoteTerminalError("ALREADY_OPEN", "this process already holds a connection");
    connection = await RemoteTerminalConnection.open(args);
    connection.on("event", event => {
      server.server.notification({ method: "aiterm/remote-terminal-event", params: event }).catch(() => {});
    });
    return { opened: true, remoteVersion: connection.remoteVersion };
  }));
  server.registerTool("remote_terminal_call", {
    description: "Call a seat tool on the terminal's Aiterm",
    inputSchema: { name: z.string(), args: z.record(z.string(), z.unknown()), timeoutMs: z.number().int().positive().optional(),
      private: z.object({ appendSystemPrompt: z.string().optional(), mcpConfig: z.record(z.string(), z.unknown()).optional() }).strict().optional() },
  }, async ({ name, args, timeoutMs, private: priv }: any) => {
    // The terminal's tool result passes through unchanged.
    try { return await bound().call(name, args, { private: priv, timeoutMs }) as any; } catch (error) { return fail(error); }
  });
  server.registerTool("remote_terminal_transcript_read", {
    description: "Completed native transcript lines from a cursor",
    inputSchema: { sessionName: z.string(), cursor: z.object({ claudeSessionId: z.string(), offset: z.number().int() }).strict().nullable(), maxBytes: z.number().int().positive().optional() },
  }, guarded(args => bound().transcriptRead(args)));
  server.registerTool("remote_terminal_wait", {
    description: "Run the terminal's aiterm-wait for a receipt's wait_process; cancel the request to stop",
    inputSchema: { waitProcess: z.object({ executable: z.string().optional(), args: z.array(z.string()) }).passthrough() },
  }, async ({ waitProcess }: any, extra: { signal: AbortSignal }) => {
    try { return ok(await bound().wait(waitProcess, extra.signal)); } catch (error) { return fail(error); }
  });
  server.registerTool("remote_terminal_command", {
    description: "Fixed Claude Code setup operation on the terminal",
    inputSchema: { op: z.enum(["claude_version", "claude_install", "claude_update"]) },
  }, guarded(({ op }) => bound().command(op as RemoteCommandOp)));
  server.registerTool("remote_terminal_close", { description: "Close the bound connection and exit", inputSchema: {} },
    guarded(async () => { const result = connection ? await connection.close() : { closed: true }; setTimeout(() => process.exit(0), 100); return result; }));
  server.connect(new StdioServerTransport()).catch(error => { console.error("aiterm-remote-terminal fatal:", error); process.exit(1); });
}

export function main(args: string[]): void {
  const [command, ...rest] = args;
  if (command === "serve") return serve();
  if (command === "status") return oneShot(() => bindingStatus(option(rest, "--ref") ?? ""), "aiterm.remote-binding-error.v1");
  if (command === "register") return oneShot(() => registerBinding({
    target: { host: option(rest, "--host") ?? "", user: option(rest, "--user") ?? "", port: Number(option(rest, "--port") ?? "22") },
    keyFile: option(rest, "--key-file") ?? null, knownHostsFile: option(rest, "--known-hosts") ?? null, hostKeyAlias: option(rest, "--host-key-alias") ?? null,
  }), "aiterm.remote-binding-error.v1");
  if (command === "trust-confirm") return oneShot(() => confirmHostKey(option(rest, "--ref") ?? "", option(rest, "--fingerprint") ?? ""), "aiterm.remote-binding-error.v1");
  if (command === "transcript-read") return oneShot(() => {
    const id = option(rest, "--cursor-session"), offset = option(rest, "--offset"), max = option(rest, "--max-bytes");
    return readCompletedTranscript(option(rest, "--session") ?? "", id ? { claudeSessionId: id, offset: Number(offset) } : null, max ? Number(max) : undefined);
  }, "aiterm.transcript-read-error.v1");
  process.stderr.write("usage: aiterm-remote-terminal serve|status|register|trust-confirm|transcript-read\n");
  process.exit(64);
}

let entry = false;
try { entry = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { /* imported */ }
if (entry) main(process.argv.slice(2));
