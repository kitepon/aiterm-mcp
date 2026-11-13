import * as fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { agentMetadataPath, writeJson0600, type AgentMetadata } from "./agent-shared.js";
import { readProcessIdentities, observeExecutionActor } from "./process-runtime.js";
import type { ParentPaneEvidence } from "./agent-screen-observation.js";

export type ManagedSeatTurn = {
  state: "running"; turn_id: string; started_at: string;
  /** interim-words token where this span's words begin: the position at the last settled idle, else null. */
  event_cursor: null; interim_from: string | null; wait_process: null;
} | { state: "idle" };

const stamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const spanSchema = z.object({ turn_id: z.string().regex(/^managed:[a-f0-9]{32}$/), started_at: stamp,
  interim_from: z.string().nullable().optional() }).strict();
const recordSchema = z.object({ binding: z.string().min(1), span: spanSchema.nullable(), terminal: z.string().nullable(),
  ready: z.object({ since: stamp, terminal: z.string().nullable() }).strict().nullable(),
  settled_from: z.string().nullable().optional() }).strict();
const ownerSchema = z.object({ pid: z.number().int().positive(), started_identity: stamp, token: z.string() }).strict();
export const managedSpanDirectory = (meta: Pick<AgentMetadata, "aiterm_session" | "launch_id">) =>
  agentMetadataPath(meta.aiterm_session, meta.launch_id).replace(/\.agent\.json$/, ".seat-span.d");

/** Another live reader holds the span this instant: no observation this tick (seat-turns `unread`), not an unknown turn. */
export const SPAN_HELD: unique symbol = Symbol("span-held");

/** Same callback owns live capture and the short identity transaction. Never waits or sends input. */
export function withManagedSpan<T>(meta: AgentMetadata, capture: (file: string) => T): T | null | typeof SPAN_HELD {
  const directory = managedSpanDirectory(meta);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const actor = readProcessIdentities([process.pid]).find(row => row.pid === process.pid);
  if (!actor?.started_identity) return null;
  const owner = ownerSchema.parse({ ...actor, token: randomBytes(16).toString("hex") });
  const lock = path.join(directory, "lock"), candidate = path.join(directory, `claim-${owner.token}`);
  fs.mkdirSync(candidate, { mode: 0o700 });
  let acquired = false;
  try {
    writeJson0600(path.join(candidate, "owner.json"), owner);
    try { fs.renameSync(candidate, lock); acquired = true; }
    catch (error) {
      if (!["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      const before = fs.lstatSync(lock, { bigint: true });
      const prior = ownerSchema.parse(JSON.parse(fs.readFileSync(path.join(lock, "owner.json"), "utf8")));
      const dead = () => {
        const observed = observeExecutionActor(prior.pid);
        return observed.state === "absent" || observed.state === "present" && observed.actor.started_identity !== prior.started_identity;
      };
      if (!dead()) return SPAN_HELD;
      const after = fs.lstatSync(lock, { bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || !dead()) return SPAN_HELD;
      // Retain this nonempty destination: a competing reap cannot move a later owner's lock over it.
      fs.renameSync(lock, path.join(directory, `retired-${before.dev}-${before.ino}`));
      fs.renameSync(candidate, lock); acquired = true;
    }
    return capture(path.join(directory, "span.json"));
  } finally {
    if (acquired) {
      const current = ownerSchema.parse(JSON.parse(fs.readFileSync(path.join(lock, "owner.json"), "utf8")));
      if (current.token === owner.token) { fs.unlinkSync(path.join(lock, "owner.json")); fs.rmdirSync(lock); }
    } else fs.rmSync(candidate, { recursive: true, force: true });
  }
}

/** How long a ready frame must hold (same terminal) before the span settles idle. */
export const MANAGED_SPAN_SETTLE_MS = 250;

/** The last observation saw ready and started the settle clock: a second look after MANAGED_SPAN_SETTLE_MS can settle it. */
export function managedSpanSettling(file: string): boolean {
  try { const record = recordSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))); return record.ready !== null && Date.now() - Date.parse(record.ready.since) < MANAGED_SPAN_SETTLE_MS; }
  catch { return false; }
}

/** Persistence keeps identity only; evidence must come from a new validated native read. */
export function observeManagedSpan(file: string, binding: string, evidence: ParentPaneEvidence,
  terminal: string | null, at: string, position: () => string | null = () => null): ManagedSeatTurn | null {
  stamp.parse(at);
  let record: z.infer<typeof recordSchema> | null = null;
  try { record = recordSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (evidence !== "ready" || !terminal)) return null;
  }
  if (record?.binding !== binding) record = null;
  if (evidence === "unknown") return null;
  // Claude shows the same plain composer in a quiet wait; only a binding that never saw work may settle it.
  if (evidence === "ready_no_completion" && (terminal || record?.span || record?.terminal)) return null;
  if (evidence === "busy") {
    if (!record?.span) {
      // Words of this span start where the same binding last settled idle; a span never seen idle has no start.
      record = { binding, span: { turn_id: `managed:${randomBytes(16).toString("hex")}`, started_at: at,
        interim_from: record?.settled_from ?? null }, terminal, ready: null, settled_from: null };
      writeJson0600(file, record);
    } else if (record.ready) { record.ready = null; writeJson0600(file, record); }
    const { turn_id, started_at, interim_from = null } = record.span!;
    return { state: "running", turn_id, started_at, event_cursor: null, interim_from, wait_process: null };
  }
  // A launch that never showed busy nor any terminal has no turn to hide: its settled ready is idle.
  // An idle compaction has no Stop of its own; its notice settles the span its spinner opened. So does agy's ready composer
  // over a background-task count: its Stop waits for the task, and the rerun that follows opens a new span.
  if (evidence !== "ready_compacted" && evidence !== "ready_background" && (!terminal && (record?.span || record?.terminal) || record?.span && terminal === record.terminal)) return null;
  if (!record) record = { binding, span: null, terminal, ready: null };
  if (!record.ready || record.ready.terminal !== terminal || Date.parse(at) < Date.parse(record.ready.since)) {
    record.ready = { since: at, terminal }; writeJson0600(file, record); return null;
  }
  if (Date.parse(at) - Date.parse(record.ready.since) < MANAGED_SPAN_SETTLE_MS) return null;
  const settled = position();
  if (record.span || (record.settled_from ?? null) !== settled) {
    record.span = null; record.terminal = terminal; record.settled_from = settled; writeJson0600(file, record);
  }
  return { state: "idle" };
}

/** A turn the harness's own record ended without a completion hook (Claude's usage-limit hold): close its span now.
 * `terminal` names that end, so a later busy frame opens a new span and only a newer terminal settles it. */
export function closeManagedSpan(file: string, binding: string, terminal: string, position: () => string | null = () => null): ManagedSeatTurn {
  let record: z.infer<typeof recordSchema> | null = null;
  try { record = recordSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { /* absent or unreadable: write a closed one */ }
  if (record?.binding !== binding || record.span || record.terminal !== terminal)
    writeJson0600(file, { binding, span: null, terminal, ready: null, settled_from: position() });
  return { state: "idle" };
}
