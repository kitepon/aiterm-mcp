// a535: a seat's hooks must not name the versioned runtime folder. On Windows `runtime\current` is a junction and node resolves it to
// `runtime\aiterm-runtime-<version>`; the update deleted that folder while the seat still ran, so its Stop hook failed (Anis, fox, 11-28).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { agentsDir } from "./agent-shared.js";

const VERSIONED = /^(.*[\\/]\.aiterm[\\/]runtime)([\\/])aiterm-runtime-[^\\/]+([\\/].*)$/u;

/** The same file through `runtime/current`, so a hook follows the active runtime; unchanged when it is no runtime path or `current` lacks the file. */
export function stableRuntimePath(file: string, exists: (file: string) => boolean = fs.existsSync): string {
  const match = VERSIONED.exec(file);
  if (!match) return file;
  const through = `${match[1]}${match[2]}current${match[3]}`;
  return exists(through) ? through : file;
}

/** Rewrite the hook commands of a saved claude settings file to `current` paths (a hibernated seat resumes with it). Best effort: false when nothing changed. */
export function stabilizeClaudeSettingsHooks(file: string): boolean {
  try {
    const settings = JSON.parse(fs.readFileSync(file, "utf8"));
    let changed = false;
    const fix = (value: unknown): unknown => {
      if (typeof value === "string") {
        const next = value.replace(/'([^']*[\\/]\.aiterm[\\/]runtime[\\/]aiterm-runtime-[^']*)'/gu, (whole, p: string) => { const s = stableRuntimePath(p); return s === p ? whole : `'${s}'`; });
        if (next !== value) changed = true;
        return next;
      }
      if (Array.isArray(value)) return value.map(fix);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fix(v)]));
      return value;
    };
    const next = fix(settings.hooks);
    if (!changed) return false;
    fs.writeFileSync(file, JSON.stringify({ ...settings, hooks: next }, null, 2) + "\n", { mode: 0o600 });
    return true;
  } catch { return false; }
}

export interface PruneResult { schema: "aiterm.runtime-prune.v1"; removed: string[]; kept: { dir: string; reason: string }[] }

/** Delete the runtime folders nothing needs: not `current`, not `previous`, and not one a saved claude settings file still names (a live or hibernated seat's hooks). A folder in use stays (the delete fails and is ignored). */
export function pruneRuntimes(root = path.join(os.homedir(), ".aiterm", "runtime"), agents = agentsDir()): PruneResult {
  const result: PruneResult = { schema: "aiterm.runtime-prune.v1", removed: [], kept: [] };
  const real = (link: string) => { try { return fs.realpathSync(link); } catch { return null; } };
  const active = new Set([real(path.join(root, "current")), real(path.join(root, "previous"))]);
  let named = "";
  try { for (const name of fs.readdirSync(agents)) if (name.endsWith(".claude-settings.json")) { try { named += fs.readFileSync(path.join(agents, name), "utf8"); } catch { /* unreadable: names nothing */ } } } catch { /* no agents dir */ }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("aiterm-runtime-")) continue;
    const dir = path.join(root, entry.name);
    if (active.has(real(dir))) { result.kept.push({ dir: entry.name, reason: "active" }); continue; }
    if (named.includes(entry.name)) { result.kept.push({ dir: entry.name, reason: "named_by_seat_settings" }); continue; }
    try { fs.rmSync(dir, { recursive: true, force: true }); result.removed.push(entry.name); } catch { result.kept.push({ dir: entry.name, reason: "in_use" }); }
  }
  return result;
}
