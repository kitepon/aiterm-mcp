#!/usr/bin/env node
// aiterm-session-alive <session> [--tmpdir DIR] (a532b1, remote-terminal.md R25): is this machine's native session alive? No MCP, one `has-session`.
// exit 0 = it exists, 1 = confirmed absent, 2 = cannot tell (bad name, tmux/psmux unusable). A caller counts only 1 as "gone".
// --tmpdir is the launching Aiterm's temp base: the multiplexer's socket (POSIX) / psmux namespace (Windows) comes from it, so the answer
// must not depend on the caller's own TEMP/TMPDIR (a door started without TEMP asked another namespace and got 1 for a live seat, fox 2026-11-23).
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import path from "node:path";

export function sessionAliveExit(session: string | undefined, has: (name: string) => number | null): 0 | 1 | 2 {
  if (!session || !/^[A-Za-z0-9_.-]{1,128}$/.test(session)) return 2;
  const code = has(session);
  return code === 0 ? 0 : code === 1 ? 1 : 2;
}

/** `<session> [--tmpdir DIR]`; a --tmpdir that is not an absolute path is "cannot tell" (null), never a guess. */
export function parseAliveArgs(argv: string[]): { session: string | undefined; tmpdir: string | undefined } | null {
  const [session, ...rest] = argv;
  const at = rest.indexOf("--tmpdir");
  if (at < 0) return { session, tmpdir: undefined };
  const dir = rest[at + 1];
  return dir && path.isAbsolute(dir) ? { session, tmpdir: dir } : null;
}

async function main(argv: string[]): Promise<0 | 1 | 2> {
  const parsed = parseAliveArgs(argv);
  if (!parsed) return 2;
  if (parsed.tmpdir) process.env.TMPDIR = parsed.tmpdir; // before tmux-runtime is loaded: it derives SOCKDIR / the psmux namespace at import
  const { tmuxCommand } = await import("./tmux-runtime.js");
  return sessionAliveExit(parsed.session, name => tmuxCommand(false, "has-session", "-t", name).code);
}

let entry = false;
try { entry = !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { /* library import */ }
if (entry) main(process.argv.slice(2)).then(code => process.exit(code), () => process.exit(2));
