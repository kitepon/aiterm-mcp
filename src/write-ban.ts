// Fork write-ban (ADR 0140): every write inside one folder is refused below the tools, for the whole CLI process tree.
// Everything else (reads, commands, network, MCP, writes elsewhere) is untouched.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AitermError } from "./errors.js";
import { resolveWindowsPowerShell7 } from "./windows-powershell.js";

export type WriteBanMethod = "landlock" | "seatbelt" | "restricted-token";
export interface WriteBan { path: string; method: WriteBanMethod }

// Linux: Landlock via the bundled static helper (native/write-ban/aiterm-write-ban.c), so nothing has to be
// installed on the machine. Unprivileged (works in standard Docker, where bwrap cannot create a namespace).
// Fails closed: exit 126 before the CLI starts.
function landlockHelper(): string {
  if (process.arch !== "x64" && process.arch !== "arm64") throw unenforceable(`no write-ban helper for CPU ${process.arch}`);
  return fileURLToPath(new URL(`../native/write-ban/linux-${process.arch}/aiterm-write-ban`, import.meta.url));
}

// Windows: the bundled helper (native/write-ban/aiterm-write-ban-win.c) runs the CLI under a restricted token whose
// marker SID is denied writes by an inert inheritable ACE on the folder (ADR 0140).
function windowsHelper(): string {
  if (process.arch !== "x64") throw unenforceable(`no write-ban helper for CPU ${process.arch}`);
  return fileURLToPath(new URL("../native/write-ban/win32-x64/aiterm-write-ban.exe", import.meta.url));
}

const unenforceable = (why: string) => new AitermError(`READONLY_UNENFORCEABLE: the project write-ban cannot be applied here: ${why}`, 2);

function seatbeltProfile(folder: string): string {
  return `(version 1)(allow default)(deny file-write* (subpath "${folder.replace(/[\\"]/g, "\\$&")}"))`;
}

/** argv placed before the CLI's own argv. The CLI is exec'd, so its PID and process name stay the seat's. */
export function writeBanPrefix(ban: WriteBan): string[] {
  return ban.method === "landlock" ? [landlockHelper(), ban.path, "--"]
    : ban.method === "restricted-token" ? [windowsHelper(), ban.path, "--"]
    : ["/usr/bin/sandbox-exec", "-p", seatbeltProfile(ban.path)];
}

/** Windows: the helper starts the CLI with CreateProcess, which runs only real executables; npm shims go through pwsh. */
export function windowsWriteBanArgv(ban: WriteBan, argv: string[]): string[] {
  const [bin, ...rest] = argv;
  const ps1 = /\.ps1$/i.test(bin) ? bin : /\.(?:cmd|bat)$/i.test(bin) ? bin.replace(/\.(?:cmd|bat)$/i, ".ps1") : null;
  const cli = ps1 && fs.existsSync(ps1)
    ? [resolveWindowsPowerShell7(), "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, ...rest]
    : /\.(?:cmd|bat)$/i.test(bin) ? [process.env.ComSpec ?? "cmd.exe", "/d", "/c", ...argv] : argv;
  return [...writeBanPrefix(ban), ...cli];
}

/**
 * Prove on this machine that the ban can be applied before any seat starts. Without proof the fork is refused:
 * starting it would let it write the project (the one thing the Owner forbade).
 */
export function probeWriteBan(folder: string, platform: NodeJS.Platform = process.platform): WriteBan {
  if (!path.isAbsolute(folder) || !fs.existsSync(folder)) throw unenforceable(`folder ${folder} does not exist`);
  const real = fs.realpathSync(folder);
  if (real === path.parse(real).root) throw unenforceable("the folder is the filesystem root");
  const ban: WriteBan = { path: real, method: platform === "darwin" ? "seatbelt" : platform === "win32" ? "restricted-token" : "landlock" };
  const [bin, ...args] = writeBanPrefix(ban);
  const probe = ban.method === "seatbelt" ? [...args, "/usr/bin/true"] : ["--probe", real];
  const r = spawnSync(bin, probe, { encoding: "utf8", timeout: 10_000 });
  if (r.status !== 0) throw unenforceable((r.stderr || r.error?.message || `exit ${r.status}`).trim().split("\n").pop() ?? "probe failed");
  return ban;
}
