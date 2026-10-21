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
const codexInterruptionObservationSchema = z.object({
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
  if (!turn || value.run.boundary?.operation_id !== null || value.run.boundary.steer_id !== null
    || value.recorded_state !== expected || !Number.isFinite(Date.parse(value.native.server.started_identity)))
    context.addIssue({ code: "custom", message: "native boundary must identify the original run and state" });
});
// Aiterm reserves these files before sending the input. They identify an
// existing managed operation, NOT native acceptance, running/aborted state or
// the live conversation. Only that fixed managed reference may be keyed; this
// diagnostic can never settle or claim a native processing-start/abort proof.
export const claudeManagedInterruptionObservationSchema = z.object({
  schema: z.literal("aiterm.claude-managed-interruption-observation.v1"), run: executionPointSchema,
  native: executionNativeBindingSchema, harness: z.literal("claude-code"), harness_process: identity,
  endpoint: z.object({ session_id: z.null(),
    operation_marker: z.object({ device: z.number().int().nonnegative(), inode: z.number().int().nonnegative() }).strict(),
    dispatch_receipt: z.object({ device: z.number().int().nonnegative(), inode: z.number().int().nonnegative() }).strict(),
  }).strict(),
  recorded_state: z.literal("unconfirmed"),
  native_boundary: z.object({ type: z.literal("managed_operation_reserved"),
    operation_id: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict(),
  invocation_fence: z.literal("unknown"), session_preserved: z.literal("unconfirmed"),
}).strict().superRefine((value, context) => {
  if (!value.run.boundary?.operation_id || value.run.boundary.operation_id !== value.native_boundary.operation_id
    || value.run.boundary.turn_id !== null || value.run.boundary.steer_id !== null
    || !Number.isFinite(Date.parse(value.native.server.started_identity)))
    context.addIssue({ code: "custom", message: "managed operation keeps its original operation-only Point without native acceptance proof" });
});
// Anonymous Claude has no operation/native turn ID. Accept only its original
// private before_send cursor bound by the current v2 marker. This diagnostic
// must never become a source alias or a native start/stop/fence proof.
export const claudeAnonymousInterruptionObservationSchema = z.object({
  schema: z.literal("aiterm.claude-anonymous-interruption-observation.v1"), run: executionPointSchema,
  native: executionNativeBindingSchema, harness: z.literal("claude-code"), harness_process: identity,
  endpoint: z.object({ session_id: z.null(),
    operation_marker: z.object({ device: z.number().int().nonnegative(), inode: z.number().int().nonnegative() }).strict(),
    dispatch_receipt: z.null(),
  }).strict(),
  recorded_state: z.literal("unconfirmed"),
  native_boundary: z.object({ type: z.literal("anonymous_turn_reserved"), event_cursor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict(),
  marker_protocol: z.literal("aiterm.claude-operation-marker.v2"), loaded_hook: z.literal("unconfirmed"),
  invocation_fence: z.literal("unknown"), session_preserved: z.literal("unconfirmed"),
}).strict().superRefine((value, context) => {
  const boundary = value.run.boundary;
  if (!boundary || boundary.operation_id !== null || boundary.turn_id !== null || boundary.steer_id !== null
    || boundary.event_cursor !== value.native_boundary.event_cursor || !Number.isFinite(Date.parse(value.native.server.started_identity)))
    context.addIssue({ code: "custom", message: "anonymous reference requires its original v2 before_send cursor without native acceptance proof" });
});
export const nativeInterruptionObservationSchema = z.union([codexInterruptionObservationSchema,
  claudeManagedInterruptionObservationSchema, claudeAnonymousInterruptionObservationSchema]);
export type NativeInterruptionObservation = z.infer<typeof nativeInterruptionObservationSchema>;
export function interruptionKeyReference(value: NativeInterruptionObservation): boolean {
  return value.recorded_state === "running" || value.harness === "claude-code";
}
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
  if (!interruptionKeyReference(value.before)) context.addIssue({ code: "custom", message: "interruption requires its original native turn or managed operation reference" });
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
  if (!same(a.launch, b.launch) || !a.boundary || !b.boundary || a.boundary.steer_id || b.boundary.steer_id) return false;
  return !!a.boundary.turn_id && !a.boundary.operation_id && !b.boundary.operation_id && a.boundary.turn_id === b.boundary.turn_id
    || !!a.boundary.operation_id && !a.boundary.turn_id && !b.boundary.turn_id && a.boundary.operation_id === b.boundary.operation_id;
}
export function sameInterruptionRowRun(before: NativeInterruptionObservation, point: ExecutionPoint): boolean {
  // Only an already decoded private anonymous reservation may use cursor
  // identity. Keep generic sameInterruptionRun/source verification strict.
  return before.schema === "aiterm.claude-anonymous-interruption-observation.v1"
    ? same(before.run, point) : sameInterruptionRun(before.run, point);
}
function activeTargets(state: ExecutionState): ExecutionLaunch[] {
  const roots = state.interruptions.filter(row => !["settled", "not_sent"].includes(row.phase)).map(row => row.before.run.launch);
  return roots.length ? planCascadeStop(roots, state.records.map(record => record.relation)).targets : [];
}
export function interruptionBlocksLaunch(state: ExecutionState, launch: ExecutionLaunch | null | undefined): boolean {
  return !!launch && activeTargets(state).some(value => same(value, launch));
}
export function interruptionBlocksRequest(state: ExecutionState, request: ExecutionRequest): boolean {
  return state.records.some(record => record.stopping && same(record.reservation.request, request))
    || state.interruptions.some(row => row.requests.some(value => same(value, request)));
}
export function assertInterruptionSource(state: ExecutionState, source: ExecutionPoint | null, hint: string | null): void {
  for (const target of activeTargets(state)) {
    if (source && same(source.launch, target)) throw new ExecutionError("EXECUTION_STOPPING");
    if (!source && hint === target.session_id) throw new ExecutionError("EXECUTION_UNCONFIRMED");
  }
  for (const row of state.interruptions) {
    if (source && !same(row.before.run.launch, source.launch)) continue;
    if (!source && hint !== row.before.run.launch.session_id) continue;
    if (!source || !sameInterruptionRun(source, source)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
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
