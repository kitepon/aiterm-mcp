// Draft execution relation contract. Not registered as an MCP tool yet.
// Wire claims are never evidence. Runtime/harness adapters own the evidence
// supplied to assessExecutionSource; HTTP headers alone cannot set its fields.
import { z } from "zod";

const sessionId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const launchId = z.string().regex(/^[0-9a-f]{32}$/);
const referenceId = z.string().min(1).max(256);
export const executionLaunchSchema = z.object({
  session_id: sessionId,
  launch_id: launchId,
}).strict();
export type ExecutionLaunch = z.infer<typeof executionLaunchSchema>;

// The serving Aiterm state scope is implicit; a remote scope cannot be silently
// converted to this local scope. Transport adapters must route it explicitly.
export const executionBoundarySchema = z.object({
  event_cursor: z.number().int().nonnegative(),
  operation_id: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable(),
  turn_id: referenceId.nullable(),
  steer_id: z.string().regex(/^[0-9a-f]{16}$/).nullable(),
}).strict();
export type ExecutionBoundary = z.infer<typeof executionBoundarySchema>;

// Reuse the application's existing reference, including the actual fan-out
// target. Neither a room ID nor a call session ID alone identifies an input.
export const executionRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("delivery"), delivery_id: referenceId, target_session_id: sessionId }).strict(),
  z.object({ kind: z.literal("room"), message_id: referenceId, target_session_id: sessionId }).strict(),
  z.object({ kind: z.literal("call"), call_session_id: referenceId,
    event: z.enum(["session.message", "session.reply"]), seq: z.number().int().nonnegative(),
    target_session_id: sessionId }).strict(),
  z.object({ kind: z.literal("aiterm"), launch: executionLaunchSchema, boundary: executionBoundarySchema }).strict(),
]);
export type ExecutionRequest = z.infer<typeof executionRequestSchema>;

export const executionSourceClaimSchema = z.object({
  launch: executionLaunchSchema.nullable(),
  boundary: executionBoundarySchema.nullable(),
  request: executionRequestSchema.nullable(),
}).strict();
export type ExecutionSourceClaim = z.infer<typeof executionSourceClaimSchema>;

// INTERNAL dependency result, not a request schema. The verifier must have
// bound the caller to the live launch, and the invocation to the exact request
// and boundary. A singleton active-job list is not invocation_bound evidence.
export interface ExecutionSourceEvidence {
  live_launch: ExecutionLaunch | null;
  caller_bound: boolean;
  invocation_bound: boolean;
  input_coverage: "complete" | "incomplete";
  active_inputs: ExecutionRequest[];
  boundary: ExecutionBoundary | null;
  request: ExecutionRequest | null;
}
export interface ExecutionSourceAssessment {
  schema: "aiterm.execution-source.v1";
  status: "verified" | "mixed" | "unknown" | "stale";
  reason: "matched" | "launch_unavailable" | "launch_changed" | "caller_unbound"
    | "input_coverage_incomplete" | "multiple_inputs" | "invocation_unbound" | "boundary_mismatch";
  launch: ExecutionLaunch | null;
  boundary: ExecutionBoundary | null;
  request: ExecutionRequest | null;
  candidates: ExecutionRequest[];
}

function equal(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

/** Pure decision function; it neither observes nor modifies a real session. */
export function assessExecutionSource(
  input: unknown, evidence: ExecutionSourceEvidence,
): ExecutionSourceAssessment {
  const claim = executionSourceClaimSchema.parse(input);
  // Normalize internal references too, so key order cannot change equality.
  const live = evidence.live_launch && executionLaunchSchema.parse(evidence.live_launch);
  const candidates = evidence.active_inputs.map(value => executionRequestSchema.parse(value));
  const unique = [...new Map(candidates.map(value => [JSON.stringify(value), value])).values()];
  const result = (status: ExecutionSourceAssessment["status"], reason: ExecutionSourceAssessment["reason"]): ExecutionSourceAssessment => ({
    schema: "aiterm.execution-source.v1", status, reason, launch: live,
    boundary: status === "verified" ? claim.boundary : null,
    request: status === "verified" ? claim.request : null,
    candidates: unique,
  });
  if (!claim.launch || !live) return result("unknown", "launch_unavailable");
  if (!equal(claim.launch, live)) return result("stale", "launch_changed");
  if (!evidence.caller_bound) return result("unknown", "caller_unbound");
  if (evidence.input_coverage !== "complete") return result("unknown", "input_coverage_incomplete");
  if (unique.length > 1) return result("mixed", "multiple_inputs");
  if (!evidence.invocation_bound || !claim.request || !claim.boundary || unique.length !== 1
    || !evidence.request || !evidence.boundary) return result("unknown", "invocation_unbound");
  const requestSession = claim.request.kind === "aiterm" ? claim.request.launch.session_id : claim.request.target_session_id;
  if (requestSession !== claim.launch.session_id) return result("unknown", "boundary_mismatch");
  if (!equal(claim.request, executionRequestSchema.parse(evidence.request))
    || !equal(claim.request, unique[0])
    || !equal(claim.boundary, executionBoundarySchema.parse(evidence.boundary)))
    return result("unknown", "boundary_mismatch");
  return result("verified", "matched");
}

// Draft Bridge reservation, before queueing/launch/paste. A matching existing
// request reference later accompanies agent_launch/pty_send in request _meta.
// This is admission metadata, not a queue containing message text or a retry.
export const executionReservationSchema = z.object({
  schema: z.literal("aiterm.execution-reservation.v1"),
  request: executionRequestSchema,
  source: executionSourceClaimSchema,
  target: z.object({ session_id: sessionId, expected_launch_id: launchId.nullable() }).strict(),
}).strict().superRefine((value, context) => {
  const requestSession = value.request.kind === "aiterm" ? value.request.launch.session_id : value.request.target_session_id;
  if (requestSession !== value.target.session_id || (value.request.kind === "aiterm"
    && value.target.expected_launch_id !== value.request.launch.launch_id))
    context.addIssue({ code: "custom", message: "reservation reference and target must identify the same execution" });
});

export const cascadeStopRequestSchema = z.object({
  schema: z.literal("aiterm.cascade-stop-request.v1"),
  roots: z.array(executionLaunchSchema).min(1),
}).strict();

export const cascadeStopResultSchema = z.object({
  schema: z.literal("aiterm.cascade-stop-result.v1"),
  roots: z.array(executionLaunchSchema).min(1),
  status: z.enum(["stopped", "partial", "unconfirmed"]),
  relation_coverage: z.enum(["complete", "incomplete"]),
  targets: z.array(z.object({
    launch: executionLaunchSchema,
    outcome: z.enum(["closed", "already_closed", "shared_busy", "unknown", "unsupported", "replaced"]),
    reason: z.string().min(1).max(128),
  }).strict()),
}).strict().superRefine((value, context) => {
  if (value.status !== "stopped") return;
  const closed = value.targets.filter(target => target.outcome === "closed" || target.outcome === "already_closed");
  if (value.relation_coverage !== "complete" || closed.length !== value.targets.length
    || value.roots.some(root => !closed.some(target => equal(root, target.launch))))
    context.addIssue({ code: "custom", message: "stopped requires complete coverage and every root/target closed" });
});
