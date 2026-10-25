// Attach to the existing official native server. No process or thread resume.
import { withCodexRelay, verifyLoadedParent } from "../codex-relay-client.js";
import { nativeCodexGoalSocket } from "../codex-goal-connection.js";
import type { GoalTarget, GoalRequest } from "../agent-goal.js";

export async function withCodexGoal<T>(target: GoalTarget, run: (request: GoalRequest) => Promise<T>): Promise<T> {
  if (!target.codex_home || !target.vendor_session_id) throw new Error("Codex goal binding unavailable");
  return withCodexRelay(nativeCodexGoalSocket(target.codex_home), async request => {
    await verifyLoadedParent(request, target.vendor_session_id!);
    return run(request);
  }, 15_000, { experimentalApi: true });
}
