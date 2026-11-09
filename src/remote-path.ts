// Terminal-side fixed path operations (remote-terminal.md R15). Runs on the terminal as the SSH user.
import * as fs from "node:fs";
import * as path from "node:path";
import { RemoteTerminalError } from "./remote-terminal.js";

export interface PathStatus { schema: "aiterm.remote-path.v1"; exists: boolean; directory: boolean; writable: boolean }

const MISSING: PathStatus = { schema: "aiterm.remote-path.v1", exists: false, directory: false, writable: false };
const denied = (code: string | undefined) => code === "EACCES" || code === "EPERM";
const notPermitted = () => new RemoteTerminalError("FOLDER_NOT_PERMITTED", "the folder cannot be used by the terminal's SSH user (privacy consent, ACL or permissions)");

export function checkRemotePath(value: unknown): asserts value is string {
  // eslint-disable-next-line no-control-regex
  if (typeof value !== "string" || !path.posix.isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value) || Buffer.byteLength(value) > 4096)
    throw new RemoteTerminalError("PATH_INVALID", "path must be an absolute path without control characters");
}

function errno(error: unknown): string | undefined { return (error as NodeJS.ErrnoException)?.code; }

/** Can this directory be listed? A privacy-protected folder (macOS TCC) refuses it with EPERM. */
function listable(dir: string): boolean {
  try { fs.opendirSync(dir).closeSync(); return true; }
  catch (error) { if (denied(errno(error))) return false; throw error; }
}

/** writable = a probe directory could actually be created and removed now. */
function writable(dir: string): boolean {
  let probe: string;
  try { probe = fs.mkdtempSync(path.join(dir, ".aiterm-write-probe-")); } catch { return false; }
  fs.rmdirSync(probe);
  return true;
}

export function inspectPath(target: string): PathStatus {
  checkRemotePath(target);
  let stat: fs.Stats;
  try { stat = fs.statSync(target); }
  catch (error) {
    const code = errno(error);
    if (denied(code)) throw notPermitted();
    if (code !== "ENOENT" && code !== "ENOTDIR") throw new RemoteTerminalError("PATH_UNAVAILABLE", `the path cannot be inspected (${code ?? "unknown"})`);
    // An inaccessible parent must not read as a missing folder.
    for (let parent = path.dirname(target); ; parent = path.dirname(parent)) {
      let parentStat: fs.Stats | null = null;
      try { parentStat = fs.statSync(parent); } catch (e) { if (denied(errno(e))) throw notPermitted(); }
      if (parentStat) { if (parentStat.isDirectory() && !listable(parent)) throw notPermitted(); break; }
      if (parent === path.dirname(parent)) break;
    }
    return MISSING;
  }
  if (!stat.isDirectory()) return { schema: "aiterm.remote-path.v1", exists: true, directory: false, writable: false };
  if (!listable(target)) throw notPermitted();
  return { schema: "aiterm.remote-path.v1", exists: true, directory: true, writable: writable(target) };
}

export function makeDirectory(target: string): PathStatus {
  checkRemotePath(target);
  try { fs.mkdirSync(target, { recursive: true }); }
  catch (error) { if (denied(errno(error))) throw notPermitted(); /* a file in the way shows in the inspection */ }
  return inspectPath(target);
}
