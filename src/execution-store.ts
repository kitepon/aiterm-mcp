// Shared metadata only: no delivery text, payload, retry or work queue.
// A crashed writer's lock is never stolen on elapsed time. Explicit native-
// owner recovery releases only that mutex; uncertain operations remain intact.
import * as fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { executionLaunchSchema, executionRequestSchema, executionPointSchema } from "./execution-contract.js";
import { executionRecordSchema, ExecutionError } from "./execution-wire.js";
import { parentSourceSchema } from "./execution-parent-source.js";
import { parentHookReferenceSchema } from "./execution-parent-alias.js";
import { writeExecutionCheckpoint, executionCheckpoint } from "./execution-checkpoint.js";
import { executionParticipantSchema } from "./execution-inventory.js";
import { executionInterruptionSchema } from "./execution-interruption.js";
import { acquireExecutionLock, releaseExecutionLock, recoverExecutionLock, type ExecutionLock } from "./execution-lock.js";
import { executionActorSchema, type ExecutionActor } from "./execution-inventory.js";

export const executionStateSchema = z.object({
  schema: z.literal("aiterm.execution-state.v1"),
  records: z.array(executionRecordSchema), stopping: z.array(executionLaunchSchema),
  interruptions: z.array(executionInterruptionSchema).default([]).superRefine((rows, context) => {
    if (new Set(rows.map(row => JSON.stringify([row.before.run.launch, row.before.run.boundary?.turn_id,
      row.before.run.boundary?.operation_id, row.before.schema === "aiterm.claude-anonymous-interruption-observation.v1"
        ? row.before.run.boundary?.event_cursor : null]))).size !== rows.length)
      context.addIssue({ code: "custom", message: "interruption run references must be unique" });
  }),
  // Native process declarations only; they do not establish launch/source,
  // all-process discovery, mandatory entrypoint coverage or termination.
  participants: z.array(executionParticipantSchema).default([]).superRefine((rows, context) => {
    if (new Set(rows.map(row => JSON.stringify([row.actor.pid, row.actor.started_identity]))).size !== rows.length)
      context.addIssue({ code: "custom", message: "participant process identities must be unique" });
  }),
  // Companion references for the existing parent-delivery ID, never payloads
  // or a second delivery queue. The parent generation is fixed before_send.
  parent_deliveries: z.array(z.object({
    delivery_id: z.uuid(), request: executionRequestSchema,
    parent: executionPointSchema, child: executionPointSchema,
    endpoint_digest: z.string().regex(/^[0-9a-f]{64}$/),
    source_evidence: parentSourceSchema.optional(),
  }).strict()).default([]),
  // Native phases of that same existing delivery, not new invocation IDs.
  parent_effects: z.array(z.object({ delivery_id: z.uuid(), stage: z.enum(["dequeue", "emit", "wake"]),
    state: z.enum(["issued", "accepted", "unknown"]),
    actor: z.object({ pid: z.number().int().positive(), started_identity: z.string().min(1).max(256) }).strict(),
    hook_reference: parentHookReferenceSchema.optional(),
  }).strict()).default([]),
  slots: z.array(z.object({
    session_id: executionLaunchSchema.shape.session_id, expected_launch_id: executionLaunchSchema.shape.launch_id.nullable(),
    stage: z.enum(["launch", "send", "close", "configure", "parent_dequeue", "parent_emit", "parent_wake", "interrupt"]),
    state: z.enum(["issued", "unknown"]), request: executionRequestSchema.nullable(),
    run: executionPointSchema.optional(),
    // Native ID returned by this request's actual new-session command.
    created_native_id: z.string().regex(/^\$\d+$/).optional(),
    created_server: z.object({ pid: z.number().int().positive(), started_identity: z.string().min(1).max(256) }).strict().optional(),
    // Trusted transport snapshot for a non-delivery close/configure call.
    // Never filled from a latest job or inferred from the target's name.
    source: executionLaunchSchema.nullable().optional(),
    // One native hook output may contain several existing delivery IDs.
    sources: z.array(executionLaunchSchema).optional(),
  }).strict().superRefine((slot, context) => {
    if (slot.stage === "interrupt" && (!slot.run || slot.request !== null || slot.run.launch.session_id !== slot.session_id
      || slot.run.launch.launch_id !== slot.expected_launch_id))
      context.addIssue({ code: "custom", message: "interrupt slot must identify its exact run and launch" });
    if (slot.stage !== "interrupt" && slot.run) context.addIssue({ code: "custom", message: "run is reserved for interrupt slots" });
  })),
}).strict();
export type ExecutionState = z.infer<typeof executionStateSchema>;
export interface ExecutionStore {
  transaction<T>(body: (state: ExecutionState) => T | Promise<T>, options?: { readOnly?: boolean }): Promise<T>;
  transactionSync?<T>(body: (state: ExecutionState) => T, options?: { readOnly?: boolean }): T;
  // Same process's native identity, supplied only by the scoped MCP store.
  // An old journal never acquires a caller from a reconstructed/latest actor.
  interruptionActor?(): ExecutionActor;
  interruptionCheckpoint?(): typeof executionCheckpoint;
}
export function emptyExecutionState(): ExecutionState {
  return { schema: "aiterm.execution-state.v1", records: [], stopping: [], slots: [], parent_deliveries: [], parent_effects: [], participants: [], interruptions: [] };
}

/** Use the product's existing stateRoot and resolved multiplexer identity.
 * The digest is a storage namespace, never an execution/delivery identifier.
 * Supplying both explicitly keeps import inert and prevents test/live fallback.
 */
export function executionStoreDirectory(stateRoot: string, multiplexer: { kind: "socket" | "namespace"; key: string }): string {
  if (!path.isAbsolute(stateRoot) || !multiplexer.key || /[\r\n\0]/.test(multiplexer.key))
    throw new ExecutionError("EXECUTION_INVALID");
  const scope = createHash("sha256").update(JSON.stringify([multiplexer.kind, multiplexer.key])).digest("hex");
  return path.join(stateRoot, "execution", scope);
}

export class FileExecutionStore implements ExecutionStore {
  private readonly lockActor: ExecutionActor | null;
  constructor(readonly directory: string, private readonly lockTimeoutMs = 2000, lockActor?: ExecutionActor) {
    this.lockActor = lockActor ? executionActorSchema.parse(lockActor) : null;
  }
  /** Atomic-rename snapshot: no writer lock, checkpoint, repair, or wait. */
  snapshot(): ExecutionState {
    if (!fs.existsSync(this.directory)) return emptyExecutionState();
    return this.read();
  }
  recoverAbandonedLock(expected: ExecutionActor, observeOwner: (pid: number) => unknown) {
    if (!this.lockActor) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    return recoverExecutionLock(this.directory, this.lockActor, expected, observeOwner);
  }
  private initialized(): boolean {
    const file = path.join(this.directory, "relations.initialized.json");
    let found = false;
    try {
      const before = fs.lstatSync(file, { bigint: true });
      found = true;
      if (!before.isFile() || JSON.parse(fs.readFileSync(file, "utf8")) !== "aiterm.execution-store.v1")
        throw new Error("invalid execution store marker");
      const after = fs.lstatSync(file, { bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
        throw new Error("changed execution store marker");
      return true;
    } catch (error) {
      if (!found && (error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw new ExecutionError("EXECUTION_STATE_UNAVAILABLE", "possible");
    }
  }
  private write(state: ExecutionState): void {
    // An immutable metadata marker, not a graph backup, queue, work ID or
    // completion proof. Sync it before the first graph commit so a crash or
    // later graph deletion cannot silently reopen a populated scope as empty.
    const parsed = executionStateSchema.parse(state);
    if (!this.initialized()) writeExecutionCheckpoint(path.join(this.directory, "relations.initialized.json"), "aiterm.execution-store.v1");
    writeExecutionCheckpoint(path.join(this.directory, "relations.json"), parsed);
  }
  private read(): ExecutionState {
    const initialized = this.initialized();
    try { return executionStateSchema.parse(JSON.parse(fs.readFileSync(path.join(this.directory, "relations.json"), "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ExecutionError("EXECUTION_STATE_UNAVAILABLE", "possible");
      // A retained abandoned mutex proves this is not an unobserved bootstrap.
      // Recovery must not turn a subsequently missing graph into empty success.
      if (initialized || fs.readdirSync(this.directory).some(name => name.startsWith("abandoned-transaction-lock-")))
        throw new ExecutionError("EXECUTION_STATE_UNAVAILABLE", "possible");
      return emptyExecutionState();
    }
  }
  /** Native effect admission cannot await while a synchronous core call is on
   * the stack. Use the same short metadata lock, but never block the JS thread
   * waiting for an async owner: contention is an explicit pre-effect refusal.
   * The callback is metadata-only; it must not issue a native effect itself.
   * Guarded synchronous preparation may update companion metadata under this
   * lock while leaving execution state read-only and the operation unissued.
   */
  transactionSync<T>(body: (state: ExecutionState) => T, options: { readOnly?: boolean } = {}): T {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    let lock: ExecutionLock;
    try { lock = acquireExecutionLock(this.directory, this.lockActor); }
    catch (error) {
      if (error instanceof ExecutionError) throw error;
      throw new ExecutionError((error as NodeJS.ErrnoException).code === "EEXIST" ? "EXECUTION_BUSY" : "EXECUTION_STATE_UNAVAILABLE", "not_started");
    }
    try {
      const state = this.read(), result = body(state);
      if (result && typeof (result as { then?: unknown }).then === "function") {
        void Promise.resolve(result).catch(() => undefined);
        throw new ExecutionError("EXECUTION_INVALID");
      }
      if (!options.readOnly) this.write(state);
      return structuredClone(result);
    } finally { releaseExecutionLock(lock); }
  }
  async transaction<T>(body: (state: ExecutionState) => T | Promise<T>, options: { readOnly?: boolean } = {}): Promise<T> {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    let lock: ExecutionLock;
    const deadline = performance.now() + this.lockTimeoutMs;
    for (;;) {
      try { lock = acquireExecutionLock(this.directory, this.lockActor); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" && !(error instanceof ExecutionError && error.code === "EXECUTION_BUSY"))
          throw new ExecutionError("EXECUTION_STATE_UNAVAILABLE", "possible");
        if (performance.now() >= deadline) throw new ExecutionError("EXECUTION_BUSY", "possible");
        // Retrying lock acquisition never replays an invocation or transaction.
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    try {
      const state = this.read();
      // A callback exception commits nothing. Mutations must be prepared inside
      // this short transaction, and side effects must run after it commits.
      const result = await body(state);
      if (!options.readOnly) this.write(state);
      return structuredClone(result);
    } finally {
      releaseExecutionLock(lock);
    }
  }
}
