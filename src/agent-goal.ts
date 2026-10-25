// Goal state belongs to the CLI. This module holds no goal store or loop.
import { z } from "zod";
import type { AgentHarness } from "./agent-shared.js";
import { executionLaunchSchema } from "./execution-contract.js";

export const goalActionSchema = z.enum(["inspect", "create", "edit", "pause", "resume", "clear"]);
export const agentGoalInputObject = z.object({
  ...executionLaunchSchema.shape, action: goalActionSchema,
  expected_thread_id: z.string().min(1).max(256).optional(),
  objective: z.string().trim().min(1).refine(value => [...value].length <= 4000, "objective exceeds 4000 characters").optional(),
  token_budget: z.number().int().positive().optional(),
}).strict();
export const agentGoalInputSchema = agentGoalInputObject.superRefine((value, context) => {
  if (value.action === "create" && value.objective === undefined)
    context.addIssue({ code: "custom", message: "create requires objective" });
  if (value.action === "edit" && value.objective === undefined && value.token_budget === undefined)
    context.addIssue({ code: "custom", message: "edit requires objective or token_budget" });
  if (!["create", "edit"].includes(value.action) && (value.objective !== undefined || value.token_budget !== undefined))
    context.addIssue({ code: "custom", message: "fields do not apply to this action" });
});
export type AgentGoalInput = z.infer<typeof agentGoalInputSchema>;
export const GOAL_HOST_META_KEY = "aiterm/goal";
const hostOrigin = z.object({ origin: z.literal("user") }).strict();
/** Host provenance on the existing local MCP channel, not authentication.
 * BellTeam must authenticate the Owner and reject seat ingress before stamping
 * this metadata. A model client's metadata never upgrades its origin. */
export function goalOriginFromHost(clientName: string | undefined, meta: unknown): "user" | "automatic" {
  if (clientName !== "bellteam" || !meta || typeof meta !== "object") return "automatic";
  return hostOrigin.safeParse((meta as Record<string, unknown>)[GOAL_HOST_META_KEY]).success ? "user" : "automatic";
}
export const nativeGoalSchema = z.object({
  threadId: z.string().min(1), objective: z.string().min(1),
  status: z.enum(["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"]),
  tokenBudget: z.number().int().positive().nullable(), tokensUsed: z.number().int().nonnegative(),
  timeUsedSeconds: z.number().nonnegative(), createdAt: z.number().nonnegative(), updatedAt: z.number().nonnegative(),
}).strict();
export type NativeGoal = z.infer<typeof nativeGoalSchema>;
const goalFieldCapabilitiesSchema = z.object({
  create: z.object({ objective: z.boolean(), token_budget: z.boolean() }).strict(),
  edit: z.object({ objective: z.boolean(), token_budget: z.boolean(), combined: z.boolean().optional() }).strict(),
}).strict();
export const agentGoalResultSchema = z.object({
  schema: z.literal("aiterm.agent-goal-result.v1"),
  session_id: z.string(), launch_id: z.string(),
  harness: z.enum(["claude-code", "codex-cli", "grok-cli", "cursor-cli"]).nullable(),
  binding: z.object({ ...executionLaunchSchema.shape, thread_id: z.string().min(1) }).nullable(),
  availability: z.enum(["available", "unsupported", "unavailable"]),
  capabilities: z.object({ inspect: z.boolean(), create: z.boolean(), edit: z.boolean(), pause: z.boolean(), resume: z.boolean(), clear: z.boolean() }),
  field_capabilities: goalFieldCapabilitiesSchema.optional(),
  outcome: z.enum(["observed", "applied", "rejected", "outcome_unknown", "unavailable", "unsupported"]),
  mutation: z.enum(["not_requested", "not_issued", "acknowledged", "rejected", "outcome_unknown"]),
  readback: z.enum(["confirmed", "not_attempted", "failed", "mismatch"]),
  // Missing means unknown. null is only an authoritative native empty result.
  goal: nativeGoalSchema.nullable().optional(),
  reason: z.string(), observed_at: z.string(),
}).strict();
export type AgentGoalResult = z.infer<typeof agentGoalResultSchema>;
export interface GoalTarget {
  session_id: string; launch_id: string; harness: AgentHarness;
  vendor_session_id: string | null; codex_home?: string; executable?: string;
  native_process?: { pid: number; started_identity: string };
}
export type GoalRequest = (method: string, params: unknown) => Promise<unknown>;
export type GoalCapabilities = AgentGoalResult["capabilities"];
export type GoalFieldCapabilities = z.infer<typeof goalFieldCapabilitiesSchema>;
export type GoalConnectionRun<T> = (request: GoalRequest, supported?: GoalCapabilities, fields?: GoalFieldCapabilities) => Promise<T>;
export class AgentGoalConnectionError extends Error {
  constructor(readonly availability: "unsupported" | "unavailable", readonly reason: string) { super(reason); }
}
/** Raised only by a trusted input owner that proved no goal submission. */
export class AgentGoalNotIssuedError extends Error {
  constructor(readonly reason: string, readonly outcome: "rejected" | "unsupported" = "rejected") { super(reason); }
}
export interface AgentGoalRuntime {
  // Both functions come from the serving runtime, never from tool arguments.
  resolve(): GoalTarget | null;
  connect<T>(target: GoalTarget, run: GoalConnectionRun<T>): Promise<T>;
}
const capabilities = (enabled: boolean) => ({ inspect: enabled, create: enabled, edit: enabled, pause: enabled, resume: enabled, clear: enabled });

export async function manageAgentGoal(input: AgentGoalInput, runtime: AgentGoalRuntime,
  origin: "user" | "automatic" = "automatic"): Promise<AgentGoalResult> {
  input = agentGoalInputSchema.parse(input);
  const result: AgentGoalResult = { schema: "aiterm.agent-goal-result.v1", session_id: input.session_id,
    launch_id: input.launch_id, harness: null, binding: null, availability: "unavailable", capabilities: capabilities(false),
    outcome: "unavailable", mutation: input.action === "inspect" ? "not_requested" : "not_issued",
    readback: "not_attempted", reason: "binding_unavailable", observed_at: new Date().toISOString() };
  let target: GoalTarget | null;
  try { target = runtime.resolve(); } catch { return result; }
  const same = () => {
    const current = runtime.resolve();
    return !!current && current.session_id === input.session_id && current.launch_id === input.launch_id
      && current.harness === target?.harness && current.vendor_session_id === target?.vendor_session_id
      && current.codex_home === target?.codex_home && current.executable === target?.executable
      && JSON.stringify(current.native_process) === JSON.stringify(target?.native_process);
  };
  if (!target || target.session_id !== input.session_id || target.launch_id !== input.launch_id) return result;
  result.harness = target.harness;
  if (target.harness !== "codex-cli") return { ...result, availability: "unsupported", outcome: "unsupported", reason: "native_goal_adapter_not_implemented" };
  if (!target.vendor_session_id || !target.codex_home) return { ...result, reason: "thread_binding_unavailable" };
  if (input.expected_thread_id !== undefined && input.expected_thread_id !== target.vendor_session_id)
    return { ...result, reason: "thread_binding_mismatch" };
  const threadId = target.vendor_session_id;
  let issued = false;
  try {
    return await runtime.connect(target, async (request, supported = capabilities(true), fields) => {
      const read = async (): Promise<NativeGoal | null> => {
        const value = z.object({ goal: nativeGoalSchema.nullable() }).parse(await request("thread/goal/get", { threadId }));
        if (value.goal && value.goal.threadId !== threadId) throw new Error("goal_thread_mismatch");
        return value.goal;
      };
      if (!same()) return { ...result, reason: "generation_replaced" };
      const before = await read();
      if (!same()) return { ...result, reason: "generation_replaced" };
      Object.assign(result, { availability: "available", capabilities: supported, goal: before,
        binding: { session_id: target.session_id, launch_id: target.launch_id, thread_id: threadId },
        readback: "confirmed", outcome: "observed", reason: "native_goal_observed" });
      result.field_capabilities = fields ?? {
        create: { objective: supported.create, token_budget: supported.create },
        edit: { objective: supported.edit, token_budget: supported.edit },
      };
      if (input.action === "inspect") return result;
      if (!supported[input.action]) return { ...result, outcome: "unsupported", reason: "native_goal_operation_unsupported" };
      if (input.action === "create" || input.action === "edit") {
        const supportedFields = result.field_capabilities[input.action];
        if ((input.objective !== undefined && !supportedFields.objective)
          || (input.token_budget !== undefined && !supportedFields.token_budget)
          || (input.action === "edit" && input.objective !== undefined && input.token_budget !== undefined
            && result.field_capabilities.edit.combined === false))
          return { ...result, outcome: "unsupported", reason: "native_goal_field_unsupported" };
      }
      // The host may establish user provenance at authenticated UI ingress.
      // Model tool arguments cannot select or upgrade their origin.
      const reject = (reason: string): AgentGoalResult => ({ ...result, outcome: "rejected", reason });
      if (origin !== "user") return reject("user_authorization_required");
      if (input.action === "create" && before !== null) return reject("goal_already_exists");
      if (input.action !== "create" && input.action !== "clear" && before === null) return reject("goal_missing");
      if (input.action === "resume" && before?.status !== "paused") return reject("resume_requires_paused_goal");
      if (input.action === "pause" && before?.status !== "active") return reject("pause_requires_active_goal");
      if (!same()) return { ...result, availability: "unavailable", outcome: "unavailable", reason: "generation_replaced" };
      const method = input.action === "clear" ? "thread/goal/clear" : "thread/goal/set";
      const params: Record<string, unknown> = { threadId, origin };
      if (input.objective !== undefined) params.objective = input.objective;
      if (input.token_budget !== undefined) params.tokenBudget = input.token_budget;
      if (input.action === "create" || input.action === "resume") params.status = "active";
      if (input.action === "pause") params.status = "paused";
      issued = true;
      delete result.goal;
      result.readback = "not_attempted";
      let response: unknown;
      try { response = await request(method, params); }
      catch (error) {
        if (!(error instanceof AgentGoalNotIssuedError)) throw error;
        issued = false;
        result.mutation = "not_issued";
        // UI preparation may have taken time. Do not restore a stale snapshot.
        try {
          const current = await read();
          if (!same()) throw new Error("generation_replaced");
          return { ...result, goal: current, outcome: error.outcome, readback: "confirmed", reason: error.reason };
        } catch {
          return { ...result, outcome: error.outcome, readback: "failed", reason: error.reason };
        }
      }
      if (input.action === "clear") z.object({ cleared: z.boolean() }).parse(response);
      else {
        const ack = z.object({ goal: nativeGoalSchema }).parse(response);
        if (ack.goal.threadId !== threadId) throw new Error("goal_thread_mismatch");
      }
      result.mutation = "acknowledged";
      if (!same()) return { ...result, outcome: "outcome_unknown", readback: "failed", reason: "generation_replaced_after_mutation" };
      try {
        const after = await read();
        if (!same()) return { ...result, outcome: "outcome_unknown", readback: "failed", reason: "generation_replaced_after_readback" };
        result.goal = after;
        const matches = input.action === "clear" ? after === null : after !== null
          && (input.objective === undefined || after.objective === input.objective)
          && (input.token_budget === undefined || after.tokenBudget === input.token_budget)
          && (params.status === undefined || after.status === params.status);
        return { ...result, outcome: matches ? "applied" : "outcome_unknown", readback: matches ? "confirmed" : "mismatch",
          reason: matches ? "native_goal_readback_confirmed" : "native_goal_changed_before_readback", observed_at: new Date().toISOString() };
      } catch {
        return { ...result, outcome: "outcome_unknown", readback: "failed", reason: "native_goal_readback_failed" };
      }
    });
  } catch (error) {
    if (issued) return { ...result, outcome: "outcome_unknown", mutation: result.mutation === "acknowledged" ? "acknowledged" : "outcome_unknown",
      readback: "failed", reason: "native_goal_mutation_unconfirmed" };
    if (error instanceof AgentGoalConnectionError) return { ...result, availability: error.availability,
      outcome: error.availability, capabilities: capabilities(false), reason: error.reason };
    return { ...result, availability: "unavailable", outcome: "unavailable", capabilities: capabilities(false), reason: "native_goal_connection_unavailable" };
  }
}
