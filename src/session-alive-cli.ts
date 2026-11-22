#!/usr/bin/env node
// aiterm-session-alive <session> (a532b1, remote-terminal.md R25): is this machine's native session alive? No MCP, one `has-session`.
// exit 0 = it exists, 1 = confirmed absent, 2 = cannot tell (bad name, tmux/psmux unusable). A caller counts only 1 as "gone".
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { tmuxCommand } from "./tmux-runtime.js";

export function sessionAliveExit(session: string | undefined, has: (name: string) => number | null = name => tmuxCommand(false, "has-session", "-t", name).code): 0 | 1 | 2 {
  if (!session || !/^[A-Za-z0-9_.-]{1,128}$/.test(session)) return 2;
  const code = has(session);
  return code === 0 ? 0 : code === 1 ? 1 : 2;
}

let entry = false;
try { entry = !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { /* library import */ }
if (entry) process.exit(sessionAliveExit(process.argv[2]));
