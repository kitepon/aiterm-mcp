// Shared metadata only: no delivery text, payload, retry or work queue.
// A crashed writer's lock is deliberately not stolen on elapsed time. Until
// reconciliation exists, its scope returns STATE_UNAVAILABLE/BUSY, never empty.
import * as fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { executionLaunchSchema, executionRequestSchema } from "./execution-contract.js";
import { executionRecordSchema, ExecutionError } from "./execution-wire.js";
import { writeJson0600 } from "./agent-shared.js";

export const executionStateSchema = z.object({
  schema: z.literal("aiterm.execution-state.v1"),
  records: z.array(executionRecordSchema), stopping: z.array(executionLaunchSchema),
  slots: z.array(z.object({
    session_id: executionLaunchSchema.shape.session_id, expected_launch_id: executionLaunchSchema.shape.launch_id.nullable(),
    stage: z.enum(["launch", "send", "close", "configure"]),
    state: z.enum(["issued", "unknown"]), request: executionRequestSchema.nullable(),
  }).strict()),
}).strict();
export type ExecutionState = z.infer<typeof executionStateSchema>;
export interface ExecutionStore {
  transaction<T>(body: (state: ExecutionState) => T | Promise<T>, options?: { readOnly?: boolean }): Promise<T>;
}
export function emptyExecutionState(): ExecutionState {
  return { schema: "aiterm.execution-state.v1", records: [], stopping: [], slots: [] };
}

export class FileExecutionStore implements ExecutionStore {
  constructor(readonly directory: string, private readonly lockTimeoutMs = 2000) {}
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
      let state: ExecutionState;
      try { state = executionStateSchema.parse(JSON.parse(fs.readFileSync(statePath, "utf8"))); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ExecutionError("EXECUTION_STATE_UNAVAILABLE", "possible");
        state = emptyExecutionState();
      }
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
