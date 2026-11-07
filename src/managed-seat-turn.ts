import * as fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { agentMetadataPath, writeJson0600, type AgentMetadata } from "./agent-shared.js";
import { readProcessIdentities, observeExecutionActor } from "./process-runtime.js";
import type { ParentPaneEvidence } from "./agent-screen-observation.js";

export type ManagedSeatTurn = {
  state: "running"; turn_id: string; started_at: string;
  event_cursor: null; interim_from: null; wait_process: null;
} | { state: "idle" };

const stamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const spanSchema = z.object({ turn_id: z.string().regex(/^managed:[a-f0-9]{32}$/), started_at: stamp }).strict();
const recordSchema = z.object({ binding: z.string().min(1), span: spanSchema.nullable(), terminal: z.string().nullable(),
  ready: z.object({ since: stamp, terminal: z.string() }).strict().nullable() }).strict();
const ownerSchema = z.object({ pid: z.number().int().positive(), started_identity: stamp, token: z.string() }).strict();
export const managedSpanDirectory = (meta: Pick<AgentMetadata, "aiterm_session" | "launch_id">) =>
  agentMetadataPath(meta.aiterm_session, meta.launch_id).replace(/\.agent\.json$/, ".seat-span.d");

/** Same callback owns live capture and the short identity transaction. Never waits or sends input. */
export function withManagedSpan<T>(meta: AgentMetadata, capture: (file: string) => T): T | null {
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
      if (!dead()) return null;
      const after = fs.lstatSync(lock, { bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || !dead()) return null;
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

/** Persistence keeps identity only; evidence must come from a new validated native read. */
export function observeManagedSpan(file: string, binding: string, evidence: ParentPaneEvidence,
  terminal: string | null, at: string): ManagedSeatTurn | null {
  stamp.parse(at);
  let record: z.infer<typeof recordSchema> | null = null;
  try { record = recordSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (evidence !== "ready" || !terminal)) return null;
  }
  if (record?.binding !== binding) record = null;
  if (evidence === "unknown") return null;
  if (evidence === "busy") {
    if (!record?.span) {
      record = { binding, span: { turn_id: `managed:${randomBytes(16).toString("hex")}`, started_at: at }, terminal, ready: null };
      writeJson0600(file, record);
    } else if (record.ready) { record.ready = null; writeJson0600(file, record); }
    return { state: "running", ...record.span!, event_cursor: null, interim_from: null, wait_process: null };
  }
  if (!terminal || record?.span && terminal === record.terminal) return null;
  if (!record) record = { binding, span: null, terminal, ready: null };
  if (!record.ready || record.ready.terminal !== terminal || Date.parse(at) < Date.parse(record.ready.since)) {
    record.ready = { since: at, terminal }; writeJson0600(file, record); return null;
  }
  if (Date.parse(at) - Date.parse(record.ready.since) < 250) return null;
  if (record.span) { record.span = null; record.terminal = terminal; writeJson0600(file, record); }
  return { state: "idle" };
}
