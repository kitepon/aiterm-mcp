// Shared metadata only: no delivery text, payload, retry or work queue.
// A crashed writer's lock is deliberately not stolen on elapsed time. Until
// reconciliation exists, its scope returns STATE_UNAVAILABLE/BUSY, never empty.
import * as fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { executionLaunchSchema, executionRequestSchema, executionPointSchema } from "./execution-contract.js";
import { executionRecordSchema, ExecutionError } from "./execution-wire.js";
import { writeJson0600 } from "./agent-shared.js";

export const executionStateSchema = z.object({
  schema: z.literal("aiterm.execution-state.v1"),
  records: z.array(executionRecordSchema), stopping: z.array(executionLaunchSchema),
  // Companion references for the existing parent-delivery ID, never payloads
  // or a second delivery queue. The parent generation is fixed before_send.
  parent_deliveries: z.array(z.object({
    delivery_id: z.uuid(), request: executionRequestSchema,
    parent: executionPointSchema, child: executionPointSchema,
    endpoint_digest: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict()).default([]),
  // Native phases of that same existing delivery, not new invocation IDs.
  parent_effects: z.array(z.object({ delivery_id: z.uuid(), stage: z.enum(["dequeue", "emit", "wake"]),
    state: z.enum(["issued", "accepted", "unknown"]),
    actor: z.object({ pid: z.number().int().positive(), started_identity: z.string().min(1).max(256) }).strict(),
  }).strict()).default([]),
  slots: z.array(z.object({
    session_id: executionLaunchSchema.shape.session_id, expected_launch_id: executionLaunchSchema.shape.launch_id.nullable(),
    stage: z.enum(["launch", "send", "close", "configure", "parent_dequeue", "parent_emit", "parent_wake"]),
    state: z.enum(["issued", "unknown"]), request: executionRequestSchema.nullable(),
    // Trusted transport snapshot for a non-delivery close/configure call.
    // Never filled from a latest job or inferred from the target's name.
    source: executionLaunchSchema.nullable().optional(),
    // One native hook output may contain several existing delivery IDs.
    sources: z.array(executionLaunchSchema).optional(),
  }).strict()),
}).strict();
export type ExecutionState = z.infer<typeof executionStateSchema>;
export interface ExecutionStore {
  transaction<T>(body: (state: ExecutionState) => T | Promise<T>, options?: { readOnly?: boolean }): Promise<T>;
  transactionSync?<T>(body: (state: ExecutionState) => T, options?: { readOnly?: boolean }): T;
}
export function emptyExecutionState(): ExecutionState {
  return { schema: "aiterm.execution-state.v1", records: [], stopping: [], slots: [], parent_deliveries: [], parent_effects: [] };
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
  constructor(readonly directory: string, private readonly lockTimeoutMs = 2000) {}
  private read(): ExecutionState {
    try { return executionStateSchema.parse(JSON.parse(fs.readFileSync(path.join(this.directory, "relations.json"), "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ExecutionError("EXECUTION_STATE_UNAVAILABLE", "possible");
      return emptyExecutionState();
    }
  }
  /** Native effect admission cannot await while a synchronous core call is on
   * the stack. Use the same short metadata lock, but never block the JS thread
   * waiting for an async owner: contention is an explicit pre-effect refusal.
   * The callback is metadata-only; it must not issue a native effect itself.
   */
  transactionSync<T>(body: (state: ExecutionState) => T, options: { readOnly?: boolean } = {}): T {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const lock = path.join(this.directory, "transaction.lock");
    try { fs.mkdirSync(lock, { mode: 0o700 }); }
    catch (error) {
      throw new ExecutionError((error as NodeJS.ErrnoException).code === "EEXIST" ? "EXECUTION_BUSY" : "EXECUTION_STATE_UNAVAILABLE", "not_started");
    }
    try {
      const state = this.read(), result = body(state);
      if (result && typeof (result as { then?: unknown }).then === "function") throw new ExecutionError("EXECUTION_INVALID");
      if (!options.readOnly) writeJson0600(path.join(this.directory, "relations.json"), executionStateSchema.parse(state));
      return structuredClone(result);
    } finally { try { fs.rmdirSync(lock); } catch { /* fail closed */ } }
  }
  async transaction<T>(body: (state: ExecutionState) => T | Promise<T>, options: { readOnly?: boolean } = {}): Promise<T> {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const lock = path.join(this.directory, "transaction.lock");
    const statePath = path.join(this.directory, "relations.json");
    const deadline = performance.now() + this.lockTimeoutMs;
    for (;;) {
      try { fs.mkdirSync(lock, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new ExecutionError("EXECUTION_STATE_UNAVAILABLE", "possible");
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
      if (!options.readOnly) writeJson0600(statePath, executionStateSchema.parse(state));
      return structuredClone(result);
    } finally {
      try { fs.rmdirSync(lock); } catch { /* fail closed for subsequent callers */ }
    }
  }
}
