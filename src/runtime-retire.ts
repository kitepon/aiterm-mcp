// a482r: after a runtime swap or an npm update, seats whose aiterm-mcp / claude-machine-host started before it still run the old code.
// This hibernates the idle ones (the next delivery wakes them with the new code) and reports the rest. docs/architecture/setup-update.md.
import { lstatSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { processIdentity, processSubtree, readRuntimeProcesses, signalRuntimeProcess, type NativeProcessIdentity, type RuntimeProcess } from "./process-runtime.js";
import { isWin } from "./tmux-runtime.js";

export type SeatRetireOutcome = "hibernated" | "busy" | "unavailable" | "ended" | "caller_in_seat";
export interface RetireResult {
  schema: "aiterm.retire-stale.v1";
  since: string;
  seats: { session_id: string; outcome: SeatRetireOutcome; reason?: string }[];
  ended_servers: number;
}
export interface RetireDeps {
  rows(): RuntimeProcess[];
  /** Live native sessions with their pane process (null when unresolved). */
  seats(): { session_id: string; pane: NativeProcessIdentity | null; agent: boolean }[];
  hibernate(session: string): Promise<void>;
  signal(target: NativeProcessIdentity): void;
  now(): number;
  selfPid: number;
}

/** An Aiterm server or machine host: the program is the command itself, or node running it (a path with spaces is never matched). */
export function isAitermEntry(command: string): boolean {
  const tokens = command.trim().split(/\s+/u);
  const entry = (token: string) => /(?:^|[/\\])(?:claude-machine-host\.js|aiterm-mcp(?:\.cmd)?|aiterm-mcp[/\\]dist[/\\]index\.js)$/u.test(token);
  return entry(tokens[0]) || (/(?:^|[/\\])node(?:\.exe)?$/u.test(tokens[0]) && tokens.slice(1, 5).some(entry));
}

const WARM_MAX_AGE_MS = 15 * 60_000; // remote.ts keeps a warm session 10 minutes; an older server outside every seat is not serving a call

export async function retireStale(sinceMs: number, force: boolean, deps: RetireDeps): Promise<RetireResult> {
  const result: RetireResult = { schema: "aiterm.retire-stale.v1", since: new Date(sinceMs).toISOString(), seats: [], ended_servers: 0 };
  const rows = deps.rows();
  const byPid = new Map(rows.map(row => [row.pid, row]));
  const self = new Set<number>();
  for (let row = byPid.get(deps.selfPid); row && !self.has(row.pid); row = byPid.get(row.parent_pid)) self.add(row.pid);
  const stale = (row: RuntimeProcess) => isAitermEntry(row.command) && Date.parse(row.started_identity) < sinceMs;
  const owned = new Set<number>();
  for (const seat of deps.seats()) {
    if (!seat.pane) continue;
    const subtree = processSubtree(rows, seat.pane.pid);
    for (const row of subtree) owned.add(row.pid);
    const old = subtree.filter(stale);
    if (!seat.agent || old.length === 0) continue;
    if (subtree.some(row => self.has(row.pid))) { result.seats.push({ session_id: seat.session_id, outcome: "caller_in_seat" }); continue; }
    try { await deps.hibernate(seat.session_id); result.seats.push({ session_id: seat.session_id, outcome: "hibernated" }); continue; }
    catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const [, code, reason] = /^(AGENT_[A-Z_]+): ([a-z_]+)/u.exec(text) ?? [];
      const kept = { session_id: seat.session_id, outcome: (code === "AGENT_BUSY" ? "busy" : "unavailable") as SeatRetireOutcome, reason: reason ?? text.slice(0, 120) };
      if (!force) { result.seats.push(kept); continue; }
    }
    // --force: the stale processes end; a machine seat's host stops its claude too, and the seat is `exited` until the next delivery wakes it.
    for (const row of old) deps.signal(processIdentity(row));
    result.seats.push({ session_id: seat.session_id, outcome: "ended" });
  }
  for (const row of rows) {
    if (owned.has(row.pid) || self.has(row.pid) || !stale(row) || deps.now() - Date.parse(row.started_identity) < WARM_MAX_AGE_MS) continue;
    deps.signal(processIdentity(row));
    result.ended_servers++;
  }
  return result;
}

/** When the running code became the active one: provision's ACTIVATED (epoch seconds first), else the ctime of `current`. */
export function activationMs(root = path.join(os.homedir(), ".aiterm", "runtime")): number {
  try {
    const seconds = Number(readFileSync(path.join(root, "ACTIVATED"), "utf8").split(/\s+/u)[0]);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  } catch { /* an older provision wrote none */ }
  return lstatSync(path.join(root, "current")).ctimeMs;
}

export async function retireStaleHere(sinceMs: number, force: boolean): Promise<RetireResult> {
  const core = await import("./core.js");
  return retireStale(sinceMs, force, {
    rows: () => readRuntimeProcesses(false),
    seats: () => core.listSessionsResult().sessions.map(row => {
      // One seat that cannot be observed leaves only itself out; it is not a reason to skip the others.
      try { return { session_id: row.session_id, pane: core.observeSession(row.session_id).pane_process, agent: core.isAgentSession(row.session_id) }; }
      catch { return { session_id: row.session_id, pane: null, agent: false }; }
    }),
    hibernate: async session => { await core.hibernateAgentSession(session); },
    signal: target => signalRuntimeProcess(target, isWin ? "SIGKILL" : "SIGTERM", false),
    now: Date.now, selfPid: process.pid,
  });
}
