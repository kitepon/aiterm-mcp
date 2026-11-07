// Opt-in runtime lifecycle (aiterm.runtime-adoption.v1). Only a trusted host
// composition creates it; default startup never registers the control tool.
// It never stops tmux/native/vendor processes, resumes a CLI or resets state.
import * as fs from "node:fs";
import path from "node:path";
import { writeExecutionCheckpoint } from "./execution-checkpoint.js";
import { RUNTIME_ADOPTION_ABI, decideRuntimeOverlap, type RuntimeOverlapDecision } from "./runtime-compatibility.js";

export const RUNTIME_ADOPTION_SCHEMA = RUNTIME_ADOPTION_ABI;
export type RuntimeAdoptionMode = "standby" | "active";
export type RuntimeAdoptionState = "standby" | "active" | "retiring" | "retired";

export interface RuntimeAdoptionConfig { mode: RuntimeAdoptionMode; generation: string; scope: string; stateRoot: string }
export interface RuntimeActivationRecord {
  schema: typeof RUNTIME_ADOPTION_SCHEMA; job_id: string; scope: string;
  expected: string; candidate: string; common_formats: Record<string, string>; phase: "activated";
}

export class RuntimeAdoptionError extends Error {
  constructor(readonly code: "RUNTIME_ADOPTION_INVALID" | "RUNTIME_ADOPTION_STATE" | "RUNTIME_ADOPTION_CONFLICT"
    | "RUNTIME_ADOPTION_UNSUPPORTED" | "RUNTIME_ADOPTION_UNAVAILABLE" | "RUNTIME_ADOPTION_NOT_SERVING") { super(code); }
}

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const token = (value: unknown): string => {
  if (typeof value !== "string" || !TOKEN.test(value)) throw new RuntimeAdoptionError("RUNTIME_ADOPTION_INVALID");
  return value;
};

export function parseRuntimeAdoptionConfig(value: { mode?: string; generation?: string; scope?: string; stateRoot?: string }): RuntimeAdoptionConfig {
  if (value.mode !== "standby" && value.mode !== "active") throw new RuntimeAdoptionError("RUNTIME_ADOPTION_INVALID");
  if (typeof value.stateRoot !== "string" || !path.isAbsolute(value.stateRoot) || /[\r\n\0]/.test(value.stateRoot))
    throw new RuntimeAdoptionError("RUNTIME_ADOPTION_INVALID");
  return { mode: value.mode, generation: token(value.generation), scope: token(value.scope), stateRoot: value.stateRoot };
}

export function activationRecordPath(config: Pick<RuntimeAdoptionConfig, "stateRoot" | "scope">, jobId: string): string {
  return path.join(config.stateRoot, "runtime-adoption", token(config.scope), `${token(jobId)}.json`);
}

/** Read-only; ENOENT is "absent", any other failure is unavailable (never absent). */
export function readActivationRecord(config: Pick<RuntimeAdoptionConfig, "stateRoot" | "scope">, jobId: string): RuntimeActivationRecord | null {
  let text: string;
  try { text = fs.readFileSync(activationRecordPath(config, jobId), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new RuntimeAdoptionError("RUNTIME_ADOPTION_UNAVAILABLE");
  }
  let record: RuntimeActivationRecord;
  try { record = JSON.parse(text); } catch { throw new RuntimeAdoptionError("RUNTIME_ADOPTION_UNAVAILABLE"); }
  if (!record || record.schema !== RUNTIME_ADOPTION_SCHEMA || record.phase !== "activated" || record.job_id !== jobId
    || record.scope !== config.scope || typeof record.expected !== "string" || typeof record.candidate !== "string")
    throw new RuntimeAdoptionError("RUNTIME_ADOPTION_UNAVAILABLE");
  return record;
}

export interface RuntimeAdoptionHooks {
  /** Candidate's own signed-archive declaration (runtime-overlap.json). */
  declaration: () => unknown;
  /** Admit manager work after durable activation. Failure leaves lazy construction to the first request. */
  onActivate?: () => void;
  /** Await existing ParentDeliveryManager close (owner.closed). Never closes native seats. */
  onRetire: () => Promise<void>;
}

export function createRuntimeAdoption(config: RuntimeAdoptionConfig, hooks: RuntimeAdoptionHooks) {
  let state: RuntimeAdoptionState = config.mode;
  let prepared: { expected: string; decision: RuntimeOverlapDecision } | null = null;
  let retirement: Promise<void> | null = null;
  let serial: Promise<unknown> = Promise.resolve();
  const inflight = new Set<Promise<unknown>>();
  const identity = () => ({ schema: RUNTIME_ADOPTION_SCHEMA, generation: config.generation, scope: config.scope, state });
  const serialize = <T>(work: () => T | Promise<T>): Promise<T> => {
    const next = serial.then(work, work);
    serial = next.catch(() => undefined);
    return next;
  };

  function prepare(input: { expected?: unknown; live?: unknown }) {
    return serialize(() => {
      if (state !== "standby") throw new RuntimeAdoptionError("RUNTIME_ADOPTION_STATE");
      const expected = token(input.expected);
      let decision: RuntimeOverlapDecision;
      try { decision = decideRuntimeOverlap(hooks.declaration(), input.live as unknown[]); }
      catch { throw new RuntimeAdoptionError("RUNTIME_ADOPTION_INVALID"); }
      prepared = decision.supported ? { expected, decision } : null;
      return { ...identity(), action: "prepare" as const, expected, overlap: decision };
    });
  }

  function activate(input: { job_id?: unknown; expected?: unknown }) {
    return serialize(() => {
      const jobId = token(input.job_id), expected = token(input.expected);
      const existing = readActivationRecord(config, jobId);
      if (existing) {
        if (existing.candidate !== config.generation || existing.expected !== expected) throw new RuntimeAdoptionError("RUNTIME_ADOPTION_CONFLICT");
        if (state === "standby") { state = "active"; try { hooks.onActivate?.(); } catch { /* lazy per request */ } }
        if (state !== "active") throw new RuntimeAdoptionError("RUNTIME_ADOPTION_STATE");
        return { ...identity(), action: "activate" as const, disposition: "activated" as const, record: existing };
      }
      if (state !== "standby") throw new RuntimeAdoptionError("RUNTIME_ADOPTION_STATE");
      if (!prepared || prepared.expected !== expected) throw new RuntimeAdoptionError("RUNTIME_ADOPTION_UNSUPPORTED");
      const record: RuntimeActivationRecord = { schema: RUNTIME_ADOPTION_SCHEMA, job_id: jobId, scope: config.scope,
        expected, candidate: config.generation, common_formats: prepared.decision.common_formats, phase: "activated" };
      const file = activationRecordPath(config, jobId);
      try { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); }
      catch { throw new RuntimeAdoptionError("RUNTIME_ADOPTION_UNAVAILABLE"); }
      // Durable before ACK. A failed directory flush may still leave the record visible: status decides.
      try { writeExecutionCheckpoint(file, record); } catch { throw new RuntimeAdoptionError("RUNTIME_ADOPTION_UNAVAILABLE"); }
      state = "active";
      try { hooks.onActivate?.(); } catch { /* lazy per request */ }
      return { ...identity(), action: "activate" as const, disposition: "activated" as const, record };
    });
  }

  function status(input: { job_id?: unknown }) {
    const jobId = token(input.job_id);
    const record = readActivationRecord(config, jobId);
    return { ...identity(), action: "status" as const, disposition: record ? "activated" as const : "absent" as const,
      ...(record ? { record } : {}) };
  }

  function retire() {
    retirement ??= serialize(async () => {
      state = "retiring";
      // Real handler completion, not client cancellation. New ordinary requests are refused meanwhile.
      while (inflight.size) await Promise.allSettled([...inflight]);
      await hooks.onRetire();
      state = "retired";
    }).catch(error => { retirement = null; throw error; });
    return retirement.then(() => ({ ...identity(), action: "retire" as const, owner_closed: true }));
  }

  return {
    get state() { return state; },
    config: Object.freeze({ ...config }),
    /** Ordinary tools only while active. Standby/retiring never mutate production state. */
    admit() { if (state !== "active") throw new RuntimeAdoptionError("RUNTIME_ADOPTION_NOT_SERVING"); },
    track<T>(work: Promise<T>): Promise<T> {
      inflight.add(work);
      const done = () => { inflight.delete(work); };
      work.then(done, done);
      return work;
    },
    prepare, activate, status, retire,
  };
}
export type RuntimeAdoption = ReturnType<typeof createRuntimeAdoption>;
