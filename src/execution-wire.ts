// Versioned Bridge/MCP contract. No dependency on core, PTY or the tool server.
import { z } from "zod";
import { executionLaunchSchema, executionBoundarySchema, executionPointSchema,
  executionRequestSchema, executionReservationSchema, executionRelationSchema, executionPhaseSchema,
  cascadeStopRequestSchema, cascadeStopResultSchema } from "./execution-contract.js";

export const EXECUTION_REQUEST_META_KEY = "aiterm/execution";
export const EXECUTION_BINDING_META_KEY = "aiterm/execution_binding";
export const EXECUTION_ERROR_META_KEY = "aiterm/execution_error";
export const EXECUTION_SOURCE_META_KEY = "aiterm/execution_source";
export const executionTransportSourceSchema = z.object({
  schema: z.literal("aiterm.execution-source.v1"), source: executionPointSchema.nullable(),
}).strict();
export type ExecutionTransportSource = z.infer<typeof executionTransportSourceSchema>;

/** Local host correlation, not client authentication. The product mount calls
 * this with the initialized client name, never a tool argument. Direct CLI
 * callers use their fixed stdio environment; they cannot override it here.
 */
export function executionHostSourceFromMeta(meta: unknown, clientName: string | undefined): ExecutionTransportSource | undefined {
  const value = meta && typeof meta === "object" ? (meta as Record<string, unknown>)[EXECUTION_SOURCE_META_KEY] : undefined;
  if (clientName !== "bellteam") {
    if (value !== undefined) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    return undefined;
  }
  // A missing host context is explicitly unknown, never stdio-env fallback.
  return value === undefined ? { schema: "aiterm.execution-source.v1", source: null }
    : executionTransportSourceSchema.parse(value);
}

// The source seat hint is for reporting an unbound generation, never proof of
// a live source. Bridge fills it at HTTP ingress, not from model tool arguments.
export const executionRegisterSchema = z.object({
  action: z.literal("register"), reservation: executionReservationSchema,
  source_session_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullable(),
}).strict().superRefine((value, context) => {
  if (value.reservation.source.launch && value.source_session_id !== value.reservation.source.launch.session_id)
    context.addIssue({ code: "custom", message: "source seat and launch must agree" });
});
export const executionStatusSchema = z.object({ action: z.literal("status"), request: executionRequestSchema }).strict();
// Evidence fields identify the observation to repeat, not a trusted completion
// claim. The server validates/re-observes using its stored binding and adapter.
export const executionFinishSchema = z.object({
  action: z.literal("finish"), request: executionRequestSchema,
  evidence: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("not_sent") }).strict(),
    z.object({ kind: z.literal("completion"), target: executionPointSchema }).strict(),
    z.object({ kind: z.literal("interrupted"), target: executionLaunchSchema }).strict(),
  ]),
}).strict();
export const executionActionSchema = z.union([executionRegisterSchema, executionStatusSchema, executionFinishSchema]);
export type ExecutionAction = z.infer<typeof executionActionSchema>;
export type ExecutionRegister = z.infer<typeof executionRegisterSchema>;
export type ExecutionFinish = z.infer<typeof executionFinishSchema>;
export const executionRefMetaSchema = z.object({
  schema: z.literal("aiterm.execution-ref.v1"), request: executionRequestSchema,
}).strict();
export const executionSourceResultSchema = z.object({
  status: z.enum(["verified", "unknown", "stale"]),
  reason: z.enum(["matched", "launch_unavailable", "launch_changed", "caller_unbound"]),
  point: executionPointSchema.nullable(), boundary_status: z.enum(["matched", "missing", "mismatch"]),
}).strict();
export const executionBindingSchema = z.object({
  schema: z.literal("aiterm.execution-binding.v1"), request: executionRequestSchema,
  source: executionSourceResultSchema, target: executionPointSchema.nullable(),
  phase: executionPhaseSchema,
}).strict();
export const executionRecordSchema = z.object({
  schema: z.literal("aiterm.execution-record.v1"), reservation: executionReservationSchema,
  source_session_id: z.string().nullable(), source: executionSourceResultSchema,
  relation: executionRelationSchema,
  operations: z.object({
    launch: z.enum(["not_issued", "issued", "accepted", "not_sent", "unknown"]),
    send: z.enum(["not_issued", "issued", "accepted", "not_sent", "unknown"]),
  }).strict(),
  stopping: z.boolean(),
}).strict();
export type ExecutionRecord = z.infer<typeof executionRecordSchema>;

export const executionRootsRequestSchema = z.object({
  session_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
}).strict();
export const executionRootsResultObjectSchema = z.object({
  schema: z.literal("aiterm.execution-roots.v1"), session_id: z.string(),
  observation: z.enum(["present", "absent", "unknown"]), current: executionLaunchSchema.nullable(),
  roots: z.array(executionLaunchSchema), relation_coverage: z.enum(["complete", "incomplete"]),
  unresolved: z.array(z.object({ request: executionRequestSchema.nullable(), reason: z.string() }).strict()),
}).strict();
export const executionRootsResultSchema = executionRootsResultObjectSchema.superRefine((value, context) => {
  if (value.roots.some(root => root.session_id !== value.session_id)
    || (value.current && (value.observation !== "present" || value.current.session_id !== value.session_id
      || !value.roots.some(root => root.launch_id === value.current!.launch_id)))
    || (value.relation_coverage === "complete" && (value.unresolved.length > 0 || value.observation === "unknown"
      || (value.observation === "present" && !value.current))))
    context.addIssue({ code: "custom", message: "root lookup must preserve scope and report missing evidence" });
});

export const executionErrorCodeSchema = z.enum([
  "EXECUTION_INVALID", "EXECUTION_NOT_FOUND", "EXECUTION_CONFLICT", "EXECUTION_STOPPING",
  "EXECUTION_STALE_GENERATION", "EXECUTION_UNCONFIRMED", "EXECUTION_BUSY",
  "EXECUTION_STATE_UNAVAILABLE", "EXECUTION_UNSUPPORTED",
]);
export type ExecutionErrorCode = z.infer<typeof executionErrorCodeSchema>;
export const executionErrorSchema = z.object({
  schema: z.literal("aiterm.execution-error.v1"), code: executionErrorCodeSchema,
  effect: z.enum(["not_started", "possible"]), follow_up: z.enum(["none", "status_only"]),
}).strict();
export class ExecutionError extends Error {
  constructor(readonly code: ExecutionErrorCode, readonly effect: "not_started" | "possible" = "not_started") {
    super(code); this.name = "ExecutionError";
  }
  receipt(): z.infer<typeof executionErrorSchema> {
    return { schema: "aiterm.execution-error.v1", code: this.code, effect: this.effect,
      follow_up: ["EXECUTION_UNCONFIRMED", "EXECUTION_CONFLICT", "EXECUTION_BUSY", "EXECUTION_STATE_UNAVAILABLE"].includes(this.code)
        ? "status_only" : "none" };
  }
}
export function executionErrorResult(error: unknown): {
  isError: true; content: { type: "text"; text: string }[]; _meta: Record<string, unknown>;
} {
  const typed = error instanceof ExecutionError ? error
    : error instanceof z.ZodError ? new ExecutionError("EXECUTION_INVALID")
    : new ExecutionError("EXECUTION_STATE_UNAVAILABLE", "possible");
  return { isError: true, content: [{ type: "text", text: typed.code }],
    _meta: { [EXECUTION_ERROR_META_KEY]: typed.receipt() } };
}
export function executionRefFromMeta(meta: unknown): z.infer<typeof executionRefMetaSchema> | null {
  if (meta == null || typeof meta !== "object" || !(EXECUTION_REQUEST_META_KEY in meta)) return null;
  return executionRefMetaSchema.parse((meta as Record<string, unknown>)[EXECUTION_REQUEST_META_KEY]);
}

// Export tool schemas together so the integration cannot drift to a second
// interpretation of request/result types. These are not yet tools/list entries.
export const EXECUTION_TOOL_CONTRACT = {
  agent_execution: { input: executionActionSchema, output: executionRecordSchema },
  agent_stop: { input: cascadeStopRequestSchema, output: cascadeStopResultSchema },
  agent_execution_roots: { input: executionRootsRequestSchema, output: executionRootsResultSchema },
} as const;
