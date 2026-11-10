// Fork write-ban (ADR 0140): every write inside one folder is refused below the tools, for the whole CLI process tree.
// Everything else (reads, commands, network, MCP, writes elsewhere) is untouched.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AitermError } from "./errors.js";

export type WriteBanMethod = "landlock" | "seatbelt";
export interface WriteBan { path: string; method: WriteBanMethod }

// Linux: Landlock via the bundled static helper (native/write-ban/aiterm-write-ban.c), so nothing has to be
// installed on the machine. Unprivileged (works in standard Docker, where bwrap cannot create a namespace).
// Fails closed: exit 126 before the CLI starts.
function landlockHelper(): string {
  if (process.arch !== "x64" && process.arch !== "arm64") throw unenforceable(`no write-ban helper for CPU ${process.arch}`);
  return fileURLToPath(new URL(`../native/write-ban/linux-${process.arch}/aiterm-write-ban`, import.meta.url));
}

const unenforceable = (why: string) => new AitermError(`READONLY_UNENFORCEABLE: the project write-ban cannot be applied here: ${why}`, 2);

function seatbeltProfile(folder: string): string {
  return `(version 1)(allow default)(deny file-write* (subpath "${folder.replace(/[\\"]/g, "\\$&")}"))`;
}

/** argv placed before the CLI's own argv. The CLI is exec'd, so its PID and process name stay the seat's. */
export function writeBanPrefix(ban: WriteBan): string[] {
  return ban.method === "landlock"
    ? [landlockHelper(), ban.path, "--"]
    : ["/usr/bin/sandbox-exec", "-p", seatbeltProfile(ban.path)];
}

/**
 * Prove on this machine that the ban can be applied before any seat starts. Without proof the fork is refused:
 * starting it would let it write the project (the one thing the Owner forbade).
 */
export function probeWriteBan(folder: string, platform: NodeJS.Platform = process.platform): WriteBan {
  if (platform === "win32") throw unenforceable("Windows has no same-user folder write-ban yet");
  if (!path.isAbsolute(folder) || !fs.existsSync(folder)) throw unenforceable(`folder ${folder} does not exist`);
  const real = fs.realpathSync(folder);
  if (real === path.parse(real).root) throw unenforceable("the folder is the filesystem root");
  const ban: WriteBan = { path: real, method: platform === "darwin" ? "seatbelt" : "landlock" };
  const [bin, ...args] = writeBanPrefix(ban);
  const probe = ban.method === "landlock" ? ["--probe", real] : [...args, "/usr/bin/true"];
  const r = spawnSync(bin, probe, { encoding: "utf8", timeout: 10_000 });
  if (r.status !== 0) throw unenforceable((r.stderr || r.error?.message || `exit ${r.status}`).trim().split("\n").pop() ?? "probe failed");
  return ban;
}
