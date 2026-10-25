// Stop-button path: one read-only graph snapshot, postorder normal CLI cancel keys.
// No graph writes, journal, drain, actor cleanup, polling or automatic retry.
import { z } from "zod";
import { executionLaunchSchema, unfinishedExecutionRelations } from "./execution-contract.js";

const session = executionLaunchSchema.shape.session_id;
export const immediateStopInputSchema = z.object({
  session_id: session.optional(), session_ids: z.array(session).min(1).optional(),
  pause_goals: z.boolean().optional(),
}).strict().refine(value => (value.session_id !== undefined) !== (value.session_ids !== undefined));
export const goalPauseStatusSchema = z.enum(["paused", "already_inactive", "no_goal", "unsupported", "unavailable", "outcome_unknown"]);
export const immediateStopResultSchema = z.object({
  session_id: session.optional(), status: z.enum(["sent", "partial", "failed", "idle"]),
  targets: z.array(z.object({ session_id: session, status: z.enum(["sent", "failed", "idle"]), error: z.string().optional(),
    goal_pause: goalPauseStatusSchema.optional(), goal_error: z.string().optional() }).strict()),
}).strict();
type Relations = ReturnType<typeof unfinishedExecutionRelations>;
export interface ImmediateStopDependencies {
  relations?(): Relations;
  children?(): { parent: string; child: string }[];
  currentLaunchId(sessionId: string): string | null;
  sendKey(sessionId: string, expectedLaunchId?: string): unknown;
}
function stopPlan(input: unknown, dependencies: ImmediateStopDependencies) {
  const args = immediateStopInputSchema.parse(input), roots = [...new Set(args.session_ids ?? [args.session_id!])];
  let relations: Relations = [], children: { parent: string; child: string }[] = [], graphUnavailable = false;
  try {
    if (dependencies.children) children = dependencies.children();
    else if (dependencies.relations) relations = unfinishedExecutionRelations(dependencies.relations());
  }
  catch { graphUnavailable = true; }
  const ordered: { session_id: string; launch_id?: string }[] = [], visited = new Set<string>(), sent = new Set<string>();
  const visit = (name: string, launchId?: string) => {
    const key = JSON.stringify([name, launchId]);
    if (visited.has(key)) return;
    visited.add(key);
    for (const child of children) if (child.parent === name) visit(child.child);
    for (const edge of relations) if (edge.source?.launch.session_id === name
      && (!launchId || edge.source.launch.launch_id === launchId) && edge.target)
      visit(edge.target.launch.session_id, edge.target.launch.launch_id);
    if (!sent.has(name)) { sent.add(name); ordered.push({ session_id: name, ...(launchId ? { launch_id: launchId } : {}) }); }
  };
  for (const name of roots) {
    let launchId: string | null = null;
    try { launchId = dependencies.currentLaunchId(name); } catch { /* still send to the explicitly requested current session */ }
    visit(name, launchId ?? undefined);
  }
  return { args, roots, ordered, graphUnavailable };
}
function sendStopTarget(target: { session_id: string; launch_id?: string }, plan: ReturnType<typeof stopPlan>, dependencies: ImmediateStopDependencies) {
    try {
      const receipt = dependencies.sendKey(target.session_id, target.launch_id) as { then?: unknown; outcome?: unknown; session_id?: unknown };
      if (receipt?.then) { void Promise.resolve(receipt).catch(() => undefined); throw new Error("async key sender"); }
      if (receipt?.outcome === "idle" && receipt.session_id === target.session_id)
        return { session_id: target.session_id, status: "idle" as const };
      if (receipt?.outcome !== "accepted" || receipt.session_id !== target.session_id) throw new Error("missing key receipt");
      return { session_id: target.session_id, status: "sent" as const,
        ...(plan.graphUnavailable && plan.roots.includes(target.session_id) ? { error: "RELATION_GRAPH_UNAVAILABLE" } : {}) };
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      return { session_id: target.session_id, status: "failed" as const,
        error: typeof code === "string" && /^EXECUTION_[A-Z_]+$/.test(code) ? code : "KEY_SEND_FAILED" };
    }
}
function finishStop(plan: ReturnType<typeof stopPlan>, targets: z.infer<typeof immediateStopResultSchema>["targets"]) {
  const { args, graphUnavailable } = plan;
  const successful = targets.filter(target => target.status !== "failed").length;
  const goalsConfirmed = targets.every(target => target.goal_pause === undefined
    || ["paused", "already_inactive", "no_goal"].includes(target.goal_pause));
  return immediateStopResultSchema.parse({ ...(args.session_id ? { session_id: args.session_id } : {}),
    status: successful === targets.length && !graphUnavailable && goalsConfirmed ? (targets.every(target => target.status === "idle") ? "idle" : "sent") : successful ? "partial" : "failed", targets });
}
export function interruptKnownSessions(input: unknown, dependencies: ImmediateStopDependencies) {
  const plan = stopPlan(input, dependencies);
  if (plan.args.pause_goals) throw new Error("GOAL_PAUSE_REQUIRES_TRUSTED_ASYNC_STOP");
  return finishStop(plan, plan.ordered.map(target => sendStopTarget(target, plan, dependencies)));
}
/** Explicit whole-application stop only. Ordinary interruption stays synchronous.
 * One existing relation snapshot and one key per target; no retries or store. */
export async function interruptKnownSessionsAndGoals(input: unknown, dependencies: ImmediateStopDependencies & {
  pauseGoal(target: { session_id: string; launch_id?: string }): Promise<{ status: z.infer<typeof goalPauseStatusSchema>; reason?: string }>;
}, origin: "user" | "automatic") {
  const plan = stopPlan(input, dependencies);
  if (!plan.args.pause_goals) return finishStop(plan, plan.ordered.map(target => sendStopTarget(target, plan, dependencies)));
  if (origin !== "user") throw new Error("GOAL_OWNER_ACTION_REQUIRED");
  const targets: z.infer<typeof immediateStopResultSchema>["targets"] = [];
  for (const target of plan.ordered) {
    let pause: Awaited<ReturnType<typeof dependencies.pauseGoal>>;
    try { pause = await dependencies.pauseGoal(target); pause.status = goalPauseStatusSchema.parse(pause.status); }
    catch { pause = { status: "outcome_unknown", reason: "GOAL_PAUSE_UNCONFIRMED" }; }
    // Preserve the explicit emergency key even when goal state is unavailable.
    targets.push({ ...sendStopTarget(target, plan, dependencies), goal_pause: pause.status,
      ...(pause.reason ? { goal_error: pause.reason } : {}) });
  }
  return finishStop(plan, targets);
}
