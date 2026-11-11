#!/usr/bin/env node
// aiterm-remote-terminal (remote-terminal.md). Run as the UID that can read the terminal key.
//   status --ref R | register ... | trust-confirm --ref R --fingerprint F   (one JSON line; exit 0 result, 2 error)
//   serve        stdio MCP for one bound connection, spawned by BellTeam terminals
//   credential-load --ref R --terminal-id ID --handle UUID --revision N --purpose ssh-key   (key bytes on stdin; one JSON receipt line)
//   transcript-read --session S [--cursor-session ID --offset N] [--max-bytes N]   (runs on the terminal)
//   authorize-key --ref R [--os macos|linux|windows]   (login password on stdin until EOF; R14)      provision --ref R   (macOS/Linux runtime; R16)
//   path-status|make-dir --path P | --path-base64 B, list-dirs [--path P | --path-base64 B]   (on the terminal; R15)      runtime-smoke --expect-version V   (on the terminal)
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { REMOTE_COMMAND_OPS, RemoteTerminalConnection, RemoteTerminalError, bindingStatus, confirmHostKey, loadCredential, registerBinding, runForwardKeeper, type RemoteCommandOp } from "./remote-terminal.js";
import { readCompletedTranscript } from "./transcript-read.js";
import { credentialHandleSchema, terminalOsSchema } from "./remote-contract.js";
import { inspectPath, listDirectories, makeDirectory } from "./remote-path.js";
import { ASKPASS_SOCKET_ENV, askpass, authorizeKey, prepareAuthorization } from "./remote-authorize.js";
import { provision, runtimeSmoke } from "./remote-provision.js";

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

function oneShot(run: () => unknown, errorSchema: string): void {
  const fail = (error: unknown) => { process.stdout.write(`${JSON.stringify(errorDto(error, errorSchema))}\n`); process.exit(2); };
  try {
    Promise.resolve(run()).then(value => { process.stdout.write(`${JSON.stringify(value)}\n`); process.exit(0); }, fail);
  } catch (error) { fail(error); }
}

function readStdin(): Promise<Buffer> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => { const all = Buffer.concat(chunks); for (const chunk of chunks) chunk.fill(0); resolve(all); });
  });
}

function pathArgument(rest: string[]): string {
  const encoded = option(rest, "--path-base64");
  return encoded !== undefined ? Buffer.from(encoded, "base64").toString("utf8") : option(rest, "--path") ?? "";
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
    inputSchema: { ref: z.string(), target: z.object({ host: z.string(), user: z.string(), port: z.number().int() }).strict(), os: terminalOsSchema.optional(),
      trustRevision: z.string(), credentialRevision: z.string().optional(), credential: credentialHandleSchema.optional(),
      sudoCredential: credentialHandleSchema.optional(), privateEnv: z.record(z.string(), z.string()).optional() },
  }, guarded(async args => {
    if (connection) throw new RemoteTerminalError("ALREADY_OPEN", "this process already holds a connection");
    connection = await RemoteTerminalConnection.open(args);
    connection.on("event", event => {
      server.server.notification({ method: "aiterm/remote-terminal-event", params: event }).catch(() => {});
    });
    return { opened: true, remoteVersion: connection.remoteVersion, platform: connection.platform };
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
    description: "Fixed operation on the terminal: a CLI's version / install / update / login state (cli_*, harness required), Claude Code setup (claude_*), or a path check / mkdir / read-only folder listing",
    inputSchema: { op: z.enum(REMOTE_COMMAND_OPS), path: z.string().optional(), harness: z.string().optional() },
  }, guarded(({ op, path, harness }) => bound().command(op as RemoteCommandOp, path, harness)));
  server.registerTool("remote_terminal_close", { description: "Close the bound connection and exit", inputSchema: {} },
    guarded(async () => { const result = connection ? await connection.close() : { closed: true }; setTimeout(() => process.exit(0), 100); return result; }));
  server.connect(new StdioServerTransport()).catch(error => { console.error("aiterm-remote-terminal fatal:", error); process.exit(1); });
}

export function main(args: string[]): void {
  const [command, ...rest] = args;
  if (command === "serve") return serve();
  // Started detached by Aiterm itself (remote-terminal.md forward keeper); not an operator command.
  if (command === "forward-keeper") return runForwardKeeper(option(rest, "--ref") ?? "");
  if (command === "status") return oneShot(() => bindingStatus(option(rest, "--ref") ?? ""), "aiterm.remote-binding-error.v1");
  if (command === "register") return oneShot(() => registerBinding({
    target: { host: option(rest, "--host") ?? "", user: option(rest, "--user") ?? "", port: Number(option(rest, "--port") ?? "22") },
    keyFile: option(rest, "--key-file") ?? null, knownHostsFile: option(rest, "--known-hosts") ?? null, hostKeyAlias: option(rest, "--host-key-alias") ?? null,
  }), "aiterm.remote-binding-error.v1");
  if (command === "credential-load") {
    // Key bytes only on stdin until EOF (remote-terminal.md R13); flags carry metadata only.
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => {
      const key = Buffer.concat(chunks);
      for (const chunk of chunks) chunk.fill(0);
      loadCredential({ ref: option(rest, "--ref") ?? "", terminalId: option(rest, "--terminal-id") ?? "", handle: option(rest, "--handle") ?? "",
        revision: option(rest, "--revision") ?? "", purpose: option(rest, "--purpose") ?? "" }, key)
        .then(receipt => { process.stdout.write(`${JSON.stringify(receipt)}\n`); process.exit(0); })
        .catch(error => { process.stdout.write(`${JSON.stringify(errorDto(error, "aiterm.remote-binding-error.v1"))}\n`); process.exit(2); });
    });
    return;
  }
  if (command === "authorize-key") return oneShot(() => {
    // Trust and the held key are checked before stdin is read (R14).
    const prepared = prepareAuthorization(option(rest, "--ref") ?? "");
    const system = option(rest, "--os");
    if (system !== undefined && !terminalOsSchema.safeParse(system).success) throw new RemoteTerminalError("OS_INVALID", "--os must be macos, linux or windows");
    return readStdin().then(password => authorizeKey(prepared, password, system === "windows" ? "windows" : "posix"));
  }, "aiterm.remote-binding-error.v1");
  if (command === "askpass") return askpass(rest.join(" "), process.env[ASKPASS_SOCKET_ENV]);
  if (command === "provision") return oneShot(() => provision(option(rest, "--ref") ?? ""), "aiterm.remote-binding-error.v1");
  if (command === "path-status") return oneShot(() => inspectPath(pathArgument(rest)), "aiterm.remote-binding-error.v1");
  if (command === "make-dir") return oneShot(() => makeDirectory(pathArgument(rest)), "aiterm.remote-binding-error.v1");
  if (command === "list-dirs") return oneShot(() => listDirectories(rest.length ? pathArgument(rest) : undefined), "aiterm.remote-binding-error.v1");
  if (command === "runtime-smoke") return oneShot(() => runtimeSmoke(option(rest, "--expect-version") ?? ""), "aiterm.remote-binding-error.v1");
  if (command === "trust-confirm") return oneShot(() => confirmHostKey(option(rest, "--ref") ?? "", option(rest, "--fingerprint") ?? ""), "aiterm.remote-binding-error.v1");
  if (command === "transcript-read") return oneShot(() => {
    const id = option(rest, "--cursor-session"), offset = option(rest, "--offset"), max = option(rest, "--max-bytes");
    return readCompletedTranscript(option(rest, "--session") ?? "", id ? { claudeSessionId: id, offset: Number(offset) } : null, max ? Number(max) : undefined);
  }, "aiterm.transcript-read-error.v1");
  process.stderr.write("usage: aiterm-remote-terminal serve|status|register|trust-confirm|credential-load|authorize-key|provision|transcript-read|path-status|make-dir|list-dirs|runtime-smoke\n");
  process.exit(64);
}

let entry = false;
try { entry = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { /* imported */ }
if (entry) main(process.argv.slice(2));
