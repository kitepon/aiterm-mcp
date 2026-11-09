#!/usr/bin/env node
// aiterm-transcript-read --session S [--cursor-session ID --offset N] [--max-bytes N]   (remote-terminal.md "One launch path")
// One JSON line. A local seat is read here; a terminal seat is read by the same reader on its terminal over the trusted SSH.
import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readCompletedTranscript } from "./transcript-read.js";
import { boundTerminalTarget, classifySshFailure, trustedSshArguments } from "./remote-terminal.js";
import { posixCommand } from "./remote.js";

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

function run(args: string[]): { line: string; code: number } {
  const flags = transcriptFlags(args);
  const target = boundTerminalTarget(flags[1]);
  if (!target) {
    const id = option(flags, "--cursor-session"), max = option(flags, "--max-bytes");
    return { line: JSON.stringify(readCompletedTranscript(flags[1], id ? { claudeSessionId: id, offset: Number(option(flags, "--offset")) } : null,
      max ? Number(max) : undefined)), code: 0 };
  }
  const ssh = spawnSync("ssh", trustedSshArguments(target.trusted_ref, posixCommand(`exec aiterm-remote-terminal transcript-read ${flags.join(" ")}`), null),
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
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
  try { const { line, code } = run(process.argv.slice(2)); process.stdout.write(`${line}\n`); process.exit(code); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ schema: ERROR, code: /^([A-Z][A-Z0-9_]+):/.exec(message)?.[1] ?? "AITERM_FAILED", message })}\n`);
    process.exit(2);
  }
}
