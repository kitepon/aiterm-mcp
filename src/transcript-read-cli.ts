#!/usr/bin/env node
// aiterm-transcript-read --session S [--cursor-session ID --offset N] [--max-bytes N]   (remote-terminal.md "One launch path")
// One JSON line. A local seat is read here; a terminal seat is read by the same reader on its terminal over the trusted SSH;
// a seat launched on `remote`+`ssh` (R32) is read with --host --user [--port] --known-hosts [--host-key-alias] --identity-agent|--identity-file (the pinned ssh of agent_launch's `remote`).
import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readCompletedTranscript } from "./transcript-read.js";
import { boundTerminalTarget, classifySshFailure, trustedSshArguments } from "./remote-terminal.js";
import { remoteShell, sshInvocation, terminalCommand, terminalProgram } from "./remote.js";
import { forwardRemoteSchema } from "./remote-contract.js";

const ERROR = "aiterm.transcript-read-error.v1";

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

/** Validated reader flags; every value is a plain token, so the remote command needs no quoting. */
export function transcriptFlags(args: string[]): string[] {
  const session = option(args, "--session") ?? "", id = option(args, "--cursor-session"), offset = option(args, "--offset"), max = option(args, "--max-bytes");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(session)) throw new Error("SESSION_INVALID: --session is required");
  const flags = ["--session", session];
  if (id !== undefined || offset !== undefined) {
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "") || !/^\d{1,15}$/.test(offset ?? "")) throw new Error("TRANSCRIPT_CURSOR_INVALID: --cursor-session and --offset go together");
    flags.push("--cursor-session", id!, "--offset", offset!);
  }
  if (max !== undefined) {
    if (!/^[1-9]\d{0,9}$/.test(max)) throw new Error("TRANSCRIPT_MAX_INVALID: --max-bytes must be a positive integer");
    flags.push("--max-bytes", max);
  }
  return flags;
}

/** The pinned `remote` of a seat launched without a binding, from the same flag names as `aiterm-remote`; null when --host is absent. */
export function pinnedRemoteFlags(args: string[]) {
  if (option(args, "--host") === undefined) return null;
  const port = option(args, "--port");
  const parsed = forwardRemoteSchema.safeParse(JSON.parse(JSON.stringify({ host: option(args, "--host"), user: option(args, "--user"), ...(port === undefined ? {} : { port: Number(port) }),
    ssh: { known_hosts_file: option(args, "--known-hosts"), host_key_alias: option(args, "--host-key-alias"), identity_agent: option(args, "--identity-agent"), identity_file: option(args, "--identity-file") } })));
  if (!parsed.success) throw new Error(`REMOTE_INVALID: ${parsed.error.issues.map(issue => `${issue.path.map(String).join(".") || "input"}: ${issue.message}`).join("; ")}`);
  return parsed.data;
}

async function run(args: string[]): Promise<{ line: string; code: number }> {
  const flags = transcriptFlags(args);
  const pinned = pinnedRemoteFlags(args);
  const target = pinned ? null : boundTerminalTarget(flags[1]);
  if (!pinned && !target) {
    const id = option(flags, "--cursor-session"), max = option(flags, "--max-bytes");
    return { line: JSON.stringify(readCompletedTranscript(flags[1], id ? { claudeSessionId: id, offset: Number(option(flags, "--offset")) } : null,
      max ? Number(max) : undefined)), code: 0 };
  }
  const reached = pinned ?? target!, command = terminalCommand(await remoteShell(reached), terminalProgram(["aiterm-remote-terminal", "transcript-read", ...flags]));
  const invocation = pinned ? sshInvocation(pinned, command) : { args: trustedSshArguments(target!.trusted_ref, command, null), env: undefined };
  const ssh = spawnSync("ssh", invocation.args,
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, maxBuffer: 64 * 1024 * 1024, ...(invocation.env ? { env: invocation.env } : {}) });
  const line = (ssh.stdout ?? "").trim().split("\n").pop() ?? "";
  let parsed: { schema?: string } | null = null;
  try { parsed = JSON.parse(line); } catch { /* classified below */ }
  if (parsed?.schema === "aiterm.transcript-read.v1") return { line, code: 0 };
  if (parsed?.schema === ERROR) return { line, code: 2 };
  const failure = ssh.status === 255 ? classifySshFailure(ssh.stderr ?? "") : { code: "COMMAND_FAILED", message: "the transcript reader failed on the terminal" };
  return { line: JSON.stringify({ schema: ERROR, ...failure }), code: 2 };
}

let entry = false;
try { entry = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { /* imported */ }
if (entry) {
  run(process.argv.slice(2)).then(({ line, code }) => { process.stdout.write(`${line}\n`); process.exit(code); }, (error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ schema: ERROR, code: /^([A-Z][A-Z0-9_]+):/.exec(message)?.[1] ?? "AITERM_FAILED", message })}\n`);
    process.exit(2);
  });
}
