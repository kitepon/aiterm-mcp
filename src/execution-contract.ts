// Contract and pure snapshot planning for the injectable execution service.
// Production MCP/core runtime evidence and mutation adapters are not mounted.
import { z } from "zod";

const sessionId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const launchId = z.string().regex(/^[0-9a-f]{32}$/);
const referenceId = z.string().min(1).max(256);
export const executionLaunchSchema = z.object({
  session_id: sessionId, launch_id: launchId,
}).strict();
export type ExecutionLaunch = z.infer<typeof executionLaunchSchema>;

// Existing references, normalized by the runtime adapter to an immutable run
// boundary. A later native turn ID is an alias, not permission to rekey history.
export const executionBoundarySchema = z.object({
  event_cursor: z.number().int().nonnegative(),
  operation_id: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable(),
  turn_id: referenceId.nullable(),
  steer_id: z.string().regex(/^[0-9a-f]{16}$/).nullable(),
}).strict();
export type ExecutionBoundary = z.infer<typeof executionBoundarySchema>;
export const executionPointSchema = z.object({
  launch: executionLaunchSchema, boundary: executionBoundarySchema.nullable(),
}).strict();
export type ExecutionPoint = z.infer<typeof executionPointSchema>;

// Scope is the serving local Aiterm. Remote scopes require an explicit adapter.
// Room fan-out uses actual target, not just the requested responders.
export const executionRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("delivery"), delivery_id: referenceId, target_session_id: sessionId }).strict(),
  z.object({ kind: z.literal("room"), message_id: referenceId, target_session_id: sessionId }).strict(),
  z.object({ kind: z.literal("call"), call_session_id: referenceId,
    event: z.enum(["session.message", "session.reply"]), seq: z.number().int().nonnegative(),
    target_session_id: sessionId }).strict(),
  z.object({ kind: z.literal("aiterm"), launch: executionLaunchSchema, boundary: executionBoundarySchema }).strict(),
  // Existing JSON-RPC call identity, scoped by the serving process's native
  // identity. No new job/delivery ID is allocated for direct stdio operations.
  z.object({ kind: z.literal("mcp"), process_pid: z.number().int().positive(),
    process_started_identity: referenceId,
    request_id: z.union([referenceId, z.number().int().safe()]),
    tool: z.enum(["agent_launch", "claude_agent", "codex_agent", "grok_agent", "pty_open", "pty_send", "pty_key", "pty_close",
      "agent_configure", "agent_auth.start", "agent_auth.status", "agent_auth.cancel", "agent_approval.respond",
      "claude_approval.respond", "claude_turn.issue"]), target_session_id: sessionId }).strict(),
]);
export type ExecutionRequest = z.infer<typeof executionRequestSchema>;

// Owner correction: interruption preserves the current session/launch and
// conversation. The former close result is deliberately a different version.
export const cascadeInterruptRequestSchema = z.object({
  schema: z.literal("aiterm.cascade-stop-request.v2"), mode: z.literal("interrupt"),
  roots: z.array(executionLaunchSchema).min(1),
}).strict();
export const cascadeInterruptResultObjectSchema = z.object({
  schema: z.literal("aiterm.cascade-stop-result.v2"), mode: z.literal("interrupt"),
  roots: z.array(executionLaunchSchema).min(1), status: z.enum(["confirmed", "partial", "unconfirmed"]),
  relation_coverage: z.enum(["complete", "incomplete"]),
  unresolved: z.array(z.object({ request: executionRequestSchema.nullable(), reason: z.string() }).strict()),
  targets: z.array(z.object({ launch: executionLaunchSchema, run: executionPointSchema.nullable(),
    key: z.enum(["Escape", "C-c"]).nullable(), key_receipt: z.enum(["not_sent", "accepted", "unknown"]),
    interruption: z.enum(["interrupted", "already_idle", "unconfirmed", "unsupported", "replaced"]),
    session_preserved: z.enum(["confirmed", "unconfirmed"]), reason: z.string(),
  }).strict()),
}).strict();
export const cascadeInterruptResultSchema = cascadeInterruptResultObjectSchema.superRefine((value, context) => {
  const confirmed = (target: typeof value.targets[number]) => target.session_preserved === "confirmed"
    && ["interrupted", "already_idle"].includes(target.interruption);
  if (value.targets.some(target => (target.run && (target.run.launch.session_id !== target.launch.session_id
      || target.run.launch.launch_id !== target.launch.launch_id))
      || (target.key_receipt === "accepted" && !target.key)
      || (target.interruption === "interrupted" && !target.run?.boundary)
      || (target.interruption === "already_idle" && (target.key !== null || target.key_receipt !== "not_sent")))
    || value.roots.some(root => !value.targets.some(target => target.launch.session_id === root.session_id && target.launch.launch_id === root.launch_id))
    || (value.status === "confirmed" && (!value.targets.length || !value.targets.every(confirmed)
      || value.relation_coverage !== "complete" || value.unresolved.length > 0))
    || (value.status === "partial" && !value.targets.some(confirmed)))
    context.addIssue({ code: "custom", message: "key receipt alone cannot confirm interruption or preserved-session coverage" });
});



// Mechanical operation type, never an interpretation of the message contents.
// Mutation admission still fences/drains non-work operations; they do not
// become an AI invocation edge merely because they touched another seat.
export function executionRequestStartsWork(request: ExecutionRequest): boolean {
  return request.kind !== "mcp" || ["agent_launch", "claude_agent", "codex_agent", "grok_agent", "pty_send", "pty_key",
    "agent_approval.respond", "claude_approval.respond", "claude_turn.issue"].includes(request.tool);
}

export const executionSourceClaimSchema = z.object({
  launch: executionLaunchSchema.nullable(),
  boundary: executionBoundarySchema.nullable(),
}).strict();

// INTERNAL runtime result, never caller-supplied verification flags. Generation
// binding is sufficient for a recorded invocation edge. Neither semantic input
// attribution nor a complete set of input jobs is a condition for adoption.
export interface ExecutionSourceEvidence {
  runtime_launch: ExecutionLaunch | null;
  caller_bound: boolean;
  invocation_boundary: ExecutionBoundary | null;
}
export interface ExecutionSourceAssessment {
  status: "verified" | "unknown" | "stale";
  reason: "matched" | "launch_unavailable" | "launch_changed" | "caller_unbound";
  point: ExecutionPoint | null;
  boundary_status: "matched" | "missing" | "mismatch";
}
function equal(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

export function assessExecutionSource(input: unknown, evidence: ExecutionSourceEvidence): ExecutionSourceAssessment {
  const claim = executionSourceClaimSchema.parse(input);
  const runtime = evidence.runtime_launch && executionLaunchSchema.parse(evidence.runtime_launch);
  const result = (status: ExecutionSourceAssessment["status"], reason: ExecutionSourceAssessment["reason"]): ExecutionSourceAssessment =>
    ({ status, reason, point: null, boundary_status: "missing" });
  if (!claim.launch || !runtime) return result("unknown", "launch_unavailable");
  if (!equal(claim.launch, runtime)) return result("stale", "launch_changed");
  if (!evidence.caller_bound) return result("unknown", "caller_unbound");
  const boundary = evidence.invocation_boundary && executionBoundarySchema.parse(evidence.invocation_boundary);
  const mismatch = !!boundary && !!claim.boundary && !equal(boundary, claim.boundary);
  return { status: "verified", reason: "matched", point: { launch: runtime, boundary: mismatch ? null : boundary },
    boundary_status: mismatch ? "mismatch" : boundary ? "matched" : "missing" };
}

function requestTarget(request: ExecutionRequest): string {
  return request.kind === "aiterm" ? request.launch.session_id : request.target_session_id;
}
export const executionReservationSchema = z.object({
  schema: z.literal("aiterm.execution-reservation.v1"), request: executionRequestSchema,
  source: executionSourceClaimSchema,
  target: z.object({ session_id: sessionId, expected_launch_id: launchId.nullable() }).strict(),
}).strict().superRefine((value, context) => {
  if (requestTarget(value.request) !== value.target.session_id || (value.request.kind === "aiterm"
    && value.target.expected_launch_id !== value.request.launch.launch_id))
    context.addIssue({ code: "custom", message: "reservation reference and target must identify the same execution" });
});

// Runtime-owned snapshot, NOT a public register/finish request. Completion must
// be backed by the exact request/launch/boundary, not queue acceptance, a generic
// delivery status, an aborted waiter, a timeout, or an idle snapshot alone.
export const executionPhaseSchema = z.enum(["reserved", "invoked", "submitted_unknown", "unsent"]);
export const executionRelationSchema = z.object({
  request: executionRequestSchema,
  source_session_id: sessionId.nullable(), // hint for reporting an unbound source only
  source: executionPointSchema.nullable(), target: executionPointSchema.nullable(),
  phase: executionPhaseSchema,
  completion: z.enum(["open", "completed", "interrupted", "unknown"]),
  target_fence: z.enum(["open", "closed", "unknown"]),
  // Set after the recorded invocation and its known return/descendant work finish.
  // This is relation lifetime, not proof that a CLI process has terminated.
  // A retired edge is never revived by unrelated work on the same seat.
  lifecycle: z.enum(["tracking", "retired"]),
}).strict().superRefine((value, context) => {
  if ((value.source && value.source_session_id !== value.source.launch.session_id)
    || (value.target && requestTarget(value.request) !== value.target.launch.session_id)
    || (value.target && value.request.kind === "aiterm" && !equal(value.request.launch, value.target.launch)))
    context.addIssue({ code: "custom", message: "relation reference and bound execution disagree" });
  if ((value.phase === "reserved" || value.phase === "unsent") && value.completion !== "open")
    context.addIssue({ code: "custom", message: "an uninvoked reservation has no execution completion" });
  if ((value.completion === "completed" && !value.target?.boundary)
    || (value.completion === "interrupted" && !value.target))
    context.addIssue({ code: "custom", message: "completion requires a bound run; generation-wide interruption requires a bound launch" });
  if (value.lifecycle === "retired" && value.phase !== "unsent"
    && (value.target_fence !== "closed" || (value.completion !== "completed" && value.completion !== "interrupted")))
    context.addIssue({ code: "custom", message: "retirement requires terminal execution or confirmed unsent" });
});
export type ExecutionRelation = z.infer<typeof executionRelationSchema>;
export interface CascadePlanGap {
  request: ExecutionRequest;
  reason: "source_generation_missing" | "target_generation_missing" | "run_boundary_missing"
    | "completion_missing" | "invocation_outcome_unknown" | "descendant_binding_missing" | "invocation_fence_unconfirmed";
}
export interface CascadePlan {
  targets: ExecutionLaunch[];
  retained: ExecutionRequest[];
  cancel_reservations: ExecutionRequest[];
  gaps: CascadePlanGap[];
}

/** Pure snapshot plan. No PTY, wall-clock cutoff, process, I/O or LLM judgment.
 * Every reached launch is included even if shared with unrelated live work.
 * Terminal history is excluded unless needed to reach unfinished descendants.
 * Atomic runtime admission/draining and closure verification are separate work.
 */
function relationActivity(relations: ExecutionRelation[]): { active: Set<number>; uncertainRetention: Set<number> } {
  const active = new Set<number>();
  const uncertainRetention = new Set<number>();
  for (let i = 0; i < relations.length; i++) {
    const edge = relations[i];
    if (!executionRequestStartsWork(edge.request)) continue;
    if (edge.lifecycle !== "retired" && edge.phase !== "unsent"
      && (edge.phase === "reserved" || edge.completion === "open" || edge.completion === "unknown" || edge.target_fence !== "closed"))
      active.add(i);
  }
  // Least fixed point: all-terminal cycles expire. Completed parents remain
  // connectors only for unfinished descendants of the same runtime execution.
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < relations.length; i++) {
      const edge = relations[i];
      if (!executionRequestStartsWork(edge.request) || active.has(i) || edge.lifecycle === "retired" || edge.phase === "unsent" || !edge.target) continue;
      for (const j of active) {
        const child = relations[j];
        // A known unbound child candidate cannot silently prove the ancestor's
        // branch complete. Retain only the already-recorded ancestor; do not
        // fabricate or traverse that child's unbound generation edge.
        const unboundChild = !child.source && child.source_session_id === edge.target.launch.session_id;
        if (!unboundChild && (!child.source || !equal(edge.target.launch, child.source.launch))) continue;
        const missing = unboundChild || !edge.target.boundary || !child.source?.boundary;
        if (!missing && !equal(edge.target.boundary, child.source?.boundary)) continue;
        active.add(i);
        if (missing) uncertainRetention.add(i);
        changed = true;
        break;
      }
    }
  }
  return { active, uncertainRetention };
}

export function unfinishedExecutionRelations(input: unknown): ExecutionRelation[] {
  const relations = z.array(executionRelationSchema).parse(input);
  return [...relationActivity(relations).active].map(index => relations[index]);
}

export function planCascadeStop(rootInput: unknown, relationInput: unknown): CascadePlan {
  const roots = z.array(executionLaunchSchema).min(1).parse(rootInput);
  const relations = z.array(executionRelationSchema).parse(relationInput);
  const { active, uncertainRetention } = relationActivity(relations);
  const plan: CascadePlan = { targets: [], retained: [], cancel_reservations: [], gaps: [] };
  const visited = new Set<string>();
  const reported = new Set<string>();
  const gap = (edge: ExecutionRelation, reason: CascadePlanGap["reason"]): void => {
    const key = JSON.stringify([edge.request, reason]);
    if (!reported.has(key)) { reported.add(key); plan.gaps.push({ request: edge.request, reason }); }
  };
  const queue = [...roots];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const launch = queue[cursor];
    const key = JSON.stringify(launch);
    if (visited.has(key)) continue;
    visited.add(key);
    plan.targets.push(launch);
    for (const i of active) {
      const edge = relations[i];
      if (!edge.source) {
        if (edge.source_session_id === launch.session_id) gap(edge, "source_generation_missing");
        continue;
      }
      if (!equal(edge.source.launch, launch)) continue;
      plan.retained.push(edge.request);
      if (edge.phase === "reserved") { plan.cancel_reservations.push(edge.request); continue; }
      if (!edge.target) { gap(edge, "target_generation_missing"); continue; }
      queue.push(edge.target.launch);
      if (!edge.source.boundary || !edge.target.boundary) gap(edge, "run_boundary_missing");
      if (edge.completion === "unknown") gap(edge, "completion_missing");
      if ((edge.completion === "completed" || edge.completion === "interrupted") && edge.target_fence !== "closed")
        gap(edge, "invocation_fence_unconfirmed");
      if (edge.phase === "submitted_unknown") gap(edge, "invocation_outcome_unknown");
      if (uncertainRetention.has(i)) gap(edge, "descendant_binding_missing");
    }
  }
  return plan;
}

export const cascadeStopRequestSchema = z.object({
  schema: z.literal("aiterm.cascade-stop-request.v1"), roots: z.array(executionLaunchSchema).min(1),
}).strict();
export const cascadeStopResultObjectSchema = z.object({
  schema: z.literal("aiterm.cascade-stop-result.v1"), roots: z.array(executionLaunchSchema).min(1),
  status: z.enum(["stopped", "partial", "unconfirmed"]), relation_coverage: z.enum(["complete", "incomplete"]),
  unresolved: z.array(z.object({ request: executionRequestSchema.nullable(), reason: referenceId }).strict()),
  targets: z.array(z.object({
    launch: executionLaunchSchema,
    outcome: z.enum(["closed", "already_closed", "unknown", "unsupported", "replaced"]),
    reason: referenceId,
  }).strict()),
}).strict();
export const cascadeStopResultSchema = cascadeStopResultObjectSchema.superRefine((value, context) => {
  if (value.status !== "stopped") return;
  const closed = value.targets.filter(target => target.outcome === "closed" || target.outcome === "already_closed");
  if (value.relation_coverage !== "complete" || value.unresolved.length || closed.length !== value.targets.length
    || value.roots.some(root => !closed.some(target => equal(root, target.launch))))
    context.addIssue({ code: "custom", message: "stopped requires complete relations, no unresolved work and every root/target closed" });
});
