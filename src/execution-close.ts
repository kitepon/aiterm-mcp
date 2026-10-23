// Synchronous expected-generation close. The serving adapter must already own
// the shared issued close slot; this helper does not replace admission/drain.
import { executionLaunchSchema, executionNativeBindingSchema, type ExecutionLaunch } from "./execution-contract.js";
export { executionNativeBindingSchema } from "./execution-contract.js";
import { ExecutionError } from "./execution-wire.js";
import { z } from "zod";

export type ExecutionNativeSession = { session_id: string; native_id: string };
export type ExecutionNativeServer = { pid: number; started_identity: string };
export type ExecutionNativeBinding = z.infer<typeof executionNativeBindingSchema>;
export type ExecutionNativeSessions = { state: "known"; sessions: ExecutionNativeSession[]; server?: ExecutionNativeServer | null } | { state: "unknown" };
export interface ExecutionCloseBindings {
  sessions(): ExecutionNativeSessions;
  launch(session: string): ExecutionLaunch | null;
  // Address the captured native session ID, never its reusable human name.
  kill(nativeId: string): { code: number };
}

export function parseExecutionNativeSessions(text: string): ExecutionNativeSessions {
  const sessions: ExecutionNativeSession[] = [];
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const parts = line.split("\t");
    if (parts.length !== 2 || !/^\$\d+$/.test(parts[0])
      || !executionLaunchSchema.shape.session_id.safeParse(parts[1]).success
      || sessions.some(value => value.session_id === parts[1] || value.native_id === parts[0])) return { state: "unknown" };
    sessions.push({ native_id: parts[0], session_id: parts[1] });
  }
  return { state: "known", sessions };
}

export function closeExpectedExecution(input: ExecutionLaunch, bindings: ExecutionCloseBindings): "closed" | "already_closed" {
  const expected = executionLaunchSchema.parse(input);
  const snapshot = () => {
    try { return bindings.sessions(); }
    catch { return { state: "unknown" } as const; }
  };
  const current = () => {
    try {
      const result = bindings.launch(expected.session_id);
      return result ? executionLaunchSchema.parse(result) : null;
    } catch { return null; }
  };
  const before = snapshot();
  if (before.state !== "known") throw new ExecutionError("EXECUTION_UNCONFIRMED", "not_started");
  const target = before.sessions.find(value => value.session_id === expected.session_id);
  if (!target) return "already_closed";
  const launch = current();
  if (!launch) throw new ExecutionError("EXECUTION_UNCONFIRMED", "not_started");
  if (launch.session_id !== expected.session_id || launch.launch_id !== expected.launch_id)
    throw new ExecutionError("EXECUTION_STALE_GENERATION", "not_started");
  const ready = snapshot();
  if (ready.state !== "known") throw new ExecutionError("EXECUTION_UNCONFIRMED", "not_started");
  const still = ready.sessions.find(value => value.session_id === expected.session_id);
  if (!still) return "already_closed";
  if (still.native_id !== target.native_id) throw new ExecutionError("EXECUTION_STALE_GENERATION", "not_started");
  // Metadata must still agree after collecting native identity. No await or
  // idle wait separates this check and the single synchronous native effect.
  const last = current();
  if (!last || last.session_id !== expected.session_id || last.launch_id !== expected.launch_id)
    throw new ExecutionError(last ? "EXECUTION_STALE_GENERATION" : "EXECUTION_UNCONFIRMED", "not_started");
  try {
    if (bindings.kill(target.native_id).code !== 0) throw new Error("native close unconfirmed");
  } catch (error) {
    // The single native primitive's gate can refuse before dispatch. No
    // earlier native effect exists inside this kill callback to hide here.
    if (error instanceof ExecutionError && error.effect === "not_started") throw error;
    throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
  }
  const after = snapshot();
  if (after.state !== "known" || after.sessions.some(value => value.native_id === target.native_id))
    throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
  // Do not clean by reusable name: another generation may already exist there.
  // The serving service also performs its normal expected-seat post-observation.
  return "closed";
}
