// Terminal-side fixed path operations (remote-terminal.md R15). Runs on the terminal as the SSH user.
import * as fs from "node:fs";
import * as os from "node:os";
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

/** missing / file / a folder the SSH user can list; refusals throw FOLDER_NOT_PERMITTED, never read as missing. */
function folderState(target: string): "missing" | "file" | "directory" {
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
    return "missing";
  }
  if (!stat.isDirectory()) return "file";
  if (!listable(target)) throw notPermitted();
  return "directory";
}

export function inspectPath(target: string): PathStatus {
  checkRemotePath(target);
  const state = folderState(target);
  if (state === "missing") return MISSING;
  if (state === "file") return { schema: "aiterm.remote-path.v1", exists: true, directory: false, writable: false };
  return { schema: "aiterm.remote-path.v1", exists: true, directory: true, writable: writable(target) };
}

export interface DirListing {
  schema: "aiterm.remote-dirs.v1"; home: string; path: string; exists: boolean; directory: boolean;
  entries: { name: string }[] | null; truncated: boolean;
}

export const LIST_DIRS_MAX = 500;

/** Read-only folder picker listing (R15): subfolders only, no dot names, sorted, at most LIST_DIRS_MAX. */
export function listDirectories(target: string | undefined, home = os.homedir()): DirListing {
  const dir = target === undefined ? home : target;
  checkRemotePath(dir);
  const base = { schema: "aiterm.remote-dirs.v1" as const, home, path: path.posix.resolve(dir) };
  const state = folderState(base.path);
  if (state !== "directory") return { ...base, exists: state === "file", directory: false, entries: null, truncated: false };
  let dirents: fs.Dirent[];
  try { dirents = fs.readdirSync(base.path, { withFileTypes: true }); }
  catch (error) { if (denied(errno(error))) throw notPermitted(); throw new RemoteTerminalError("PATH_UNAVAILABLE", `the folder cannot be listed (${errno(error) ?? "unknown"})`); }
  const names: string[] = [];
  for (const entry of dirents) {
    if (entry.name.startsWith(".")) continue;
    let folder = entry.isDirectory();
    if (!folder && entry.isSymbolicLink()) { try { folder = fs.statSync(path.join(base.path, entry.name)).isDirectory(); } catch { /* broken or refused link: not a folder */ } }
    if (folder) names.push(entry.name);
  }
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { ...base, exists: true, directory: true, entries: names.slice(0, LIST_DIRS_MAX).map(name => ({ name })), truncated: names.length > LIST_DIRS_MAX };
}

export function makeDirectory(target: string): PathStatus {
  checkRemotePath(target);
  try { fs.mkdirSync(target, { recursive: true }); }
  catch (error) { if (denied(errno(error))) throw notPermitted(); /* a file in the way shows in the inspection */ }
  return inspectPath(target);
}
