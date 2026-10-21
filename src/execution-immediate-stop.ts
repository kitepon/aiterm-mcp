// Stop-button path: one read-only graph snapshot, postorder normal CLI cancel keys.
// No graph writes, journal, drain, actor cleanup, polling or automatic retry.
import { z } from "zod";
import { executionLaunchSchema, unfinishedExecutionRelations } from "./execution-contract.js";

const session = executionLaunchSchema.shape.session_id;
export const immediateStopInputSchema = z.object({
  session_id: session.optional(), session_ids: z.array(session).min(1).optional(),
}).strict().refine(value => (value.session_id !== undefined) !== (value.session_ids !== undefined));
export const immediateStopResultSchema = z.object({
  session_id: session.optional(), status: z.enum(["sent", "partial", "failed", "idle"]),
  targets: z.array(z.object({ session_id: session, status: z.enum(["sent", "failed", "idle"]), error: z.string().optional() }).strict()),
}).strict();
type Relations = ReturnType<typeof unfinishedExecutionRelations>;
export function interruptKnownSessions(input: unknown, dependencies: {
  relations(): Relations;
  currentLaunchId(sessionId: string): string | null;
  sendKey(sessionId: string, expectedLaunchId?: string): unknown;
}) {
  const args = immediateStopInputSchema.parse(input), roots = [...new Set(args.session_ids ?? [args.session_id!])];
  let relations: Relations = [], graphUnavailable = false;
  try { relations = unfinishedExecutionRelations(dependencies.relations()); }
  catch { graphUnavailable = true; }
  const ordered: { session_id: string; launch_id?: string }[] = [], visited = new Set<string>(), sent = new Set<string>();
  const visit = (name: string, launchId?: string) => {
    const key = JSON.stringify([name, launchId]);
    if (visited.has(key)) return;
    visited.add(key);
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
  const targets = ordered.map(target => {
    try {
      const receipt = dependencies.sendKey(target.session_id, target.launch_id) as { then?: unknown; outcome?: unknown; session_id?: unknown };
      if (receipt?.then) { void Promise.resolve(receipt).catch(() => undefined); throw new Error("async key sender"); }
      if (receipt?.outcome === "idle" && receipt.session_id === target.session_id)
        return { session_id: target.session_id, status: "idle" as const };
      if (receipt?.outcome !== "accepted" || receipt.session_id !== target.session_id) throw new Error("missing key receipt");
      return { session_id: target.session_id, status: "sent" as const,
        ...(graphUnavailable && roots.includes(target.session_id) ? { error: "RELATION_GRAPH_UNAVAILABLE" } : {}) };
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      return { session_id: target.session_id, status: "failed" as const,
        error: typeof code === "string" && /^EXECUTION_[A-Z_]+$/.test(code) ? code : "KEY_SEND_FAILED" };
    }
  });
  const successful = targets.filter(target => target.status !== "failed").length;
  return immediateStopResultSchema.parse({ ...(args.session_id ? { session_id: args.session_id } : {}),
    status: successful === targets.length && !graphUnavailable ? (targets.every(target => target.status === "idle") ? "idle" : "sent") : successful ? "partial" : "failed", targets });
}
