// Private metadata for session-preserving interruption. Existing run/request/
// delivery references only: no delivery queue, retry, clock expiry or new ID.
import { z } from "zod";
import { executionPointSchema, executionRequestSchema, planCascadeStop, type ExecutionPoint, type ExecutionLaunch, type ExecutionRequest } from "./execution-contract.js";
import { executionNativeBindingSchema } from "./execution-close.js";
import { ExecutionError } from "./execution-wire.js";
import type { ExecutionState } from "./execution-store.js";
import { executionActorSchema } from "./execution-inventory.js";
import { isDeepStrictEqual as same } from "node:util";
import { executionCheckpoint } from "./execution-checkpoint.js";

const identity = z.object({ pid: z.number().int().positive(), started_identity: z.string().refine(value => Number.isFinite(Date.parse(value))) }).strict();
export const nativeInterruptionObservationSchema = z.object({
  schema: z.literal("aiterm.native-interruption-observation.v1"), run: executionPointSchema,
  native: executionNativeBindingSchema, harness: z.literal("codex-cli"), harness_process: identity,
  endpoint: z.object({ session_id: z.string().min(1).max(256),
    record_file: z.object({ device: z.number().int().nonnegative(), inode: z.number().int().nonnegative() }).strict() }).strict(),
  recorded_state: z.enum(["running", "interrupted", "completed", "other_run", "unconfirmed"]),
  native_boundary: z.object({ type: z.enum(["task_started", "task_complete", "turn_aborted"]),
    turn_id: z.string().min(1).max(256), reason: z.string().nullable() }).strict(),
  invocation_fence: z.enum(["closed", "unknown"]), session_preserved: z.enum(["confirmed", "unconfirmed"]),
}).strict().superRefine((value, context) => {
  const turn = value.run.boundary?.turn_id, boundary = value.native_boundary;
  const expected = boundary.turn_id !== turn ? "other_run" : boundary.type === "task_started" ? "running"
    : boundary.type === "task_complete" ? "completed" : boundary.reason === "interrupted" ? "interrupted" : "unconfirmed";
  if (!turn || value.recorded_state !== expected || !Number.isFinite(Date.parse(value.native.server.started_identity)))
    context.addIssue({ code: "custom", message: "native boundary must identify the original run and state" });
});
export type NativeInterruptionObservation = z.infer<typeof nativeInterruptionObservationSchema>;
export const executionInterruptionSchema = z.object({
  before: nativeInterruptionObservationSchema,
  phase: z.enum(["draining", "preparing", "issued", "accepted", "unknown", "not_sent", "settled"]),
  caller: executionActorSchema.optional(),
  // Requires this writer protocol for every subsequent state commit. Old
  // strict readers reject the field rather than silently issuing unsynced.
  checkpoint: z.literal(executionCheckpoint).optional(),
  // Explicit diagnosis of a dead caller's unissued key attempt. Keep phase
  // preparing and old-run admission/tombstones; this is not a native fence.
  preparing_resolution: z.literal("key_not_sent").optional(),
  requests: z.array(executionRequestSchema), parent_deliveries: z.array(z.uuid()),
}).strict().superRefine((value, context) => {
  if (value.before.recorded_state !== "running") context.addIssue({ code: "custom", message: "interruption requires its original running observation" });
  if (value.caller && value.phase === "draining") context.addIssue({ code: "custom", message: "caller belongs to the claimed key frame, not admission alone" });
  if (value.checkpoint && (!value.caller || value.phase === "draining"))
    context.addIssue({ code: "custom", message: "checkpoint belongs to the original native caller claim" });
  if (value.preparing_resolution && (value.phase !== "preparing" || !value.checkpoint || !value.caller))
    context.addIssue({ code: "custom", message: "unissued key diagnosis must retain the original preparing claim and checkpoint" });
});
export function interruptionIdentity(value: NativeInterruptionObservation) {
  return { run: value.run, native: value.native, harness: value.harness, harness_process: value.harness_process, endpoint: value.endpoint };
}
export function sameInterruptionRun(a: ExecutionPoint, b: ExecutionPoint): boolean {
  return same(a.launch, b.launch) && !!a.boundary?.turn_id && a.boundary.turn_id === b.boundary?.turn_id;
}
function activeTargets(state: ExecutionState): ExecutionLaunch[] {
  const roots = state.interruptions.filter(row => !["settled", "not_sent"].includes(row.phase)).map(row => row.before.run.launch);
  return roots.length ? planCascadeStop(roots, state.records.map(record => record.relation)).targets : [];
}
export function interruptionBlocksLaunch(state: ExecutionState, launch: ExecutionLaunch | null | undefined): boolean {
  return !!launch && activeTargets(state).some(value => same(value, launch));
}
export function interruptionBlocksRequest(state: ExecutionState, request: ExecutionRequest): boolean {
  return state.interruptions.some(row => row.requests.some(value => same(value, request)));
}
export function assertInterruptionSource(state: ExecutionState, source: ExecutionPoint | null, hint: string | null): void {
  for (const target of activeTargets(state)) {
    if (source && same(source.launch, target)) throw new ExecutionError("EXECUTION_STOPPING");
    if (!source && hint === target.session_id) throw new ExecutionError("EXECUTION_UNCONFIRMED");
  }
  for (const row of state.interruptions) {
    if (source && !same(row.before.run.launch, source.launch)) continue;
    if (!source && hint !== row.before.run.launch.session_id) continue;
    if (!source?.boundary?.turn_id) throw new ExecutionError("EXECUTION_UNCONFIRMED");
    if (!["settled", "not_sent"].includes(row.phase) || sameInterruptionRun(source, row.before.run)) throw new ExecutionError("EXECUTION_STOPPING");
  }
}
export function interruptionBlocksParent(state: ExecutionState, binding: ExecutionState["parent_deliveries"][number]): boolean {
  return interruptionBlocksLaunch(state, binding.parent.launch) || interruptionBlocksLaunch(state, binding.child.launch)
    || interruptionBlocksRequest(state, binding.request)
    || state.interruptions.some(row => row.parent_deliveries.includes(binding.delivery_id));
}
export function interruptionSlots(state: ExecutionState, run: ExecutionPoint) {
  const row = state.interruptions.find(value => same(value.before.run, run));
  return state.slots.filter(slot => !(slot.stage === "interrupt" && same(slot.run, run)) &&
    (slot.session_id === run.launch.session_id || same(slot.source, run.launch)
      || slot.sources?.some(value => same(value, run.launch))
      || (slot.request && row?.requests.some(value => same(value, slot.request)))));
}
