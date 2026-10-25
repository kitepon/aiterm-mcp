// Attach to the existing official native server. No process or thread resume.
import { withCodexRelay, verifyLoadedParent } from "../codex-relay-client.js";
import { nativeCodexGoalSocket } from "../codex-goal-connection.js";
import { withCodexReceiver } from "../codex-parent-receiver.js";
import { z } from "zod";
import type { GoalTarget, GoalRequest, GoalConnectionRun } from "../agent-goal.js";
import { AgentGoalConnectionError } from "../agent-goal.js";

export async function withCodexGoal<T>(target: GoalTarget, run: GoalConnectionRun<T>,
  cliControl?: (command: "pause" | "resume" | "clear") => Promise<void>): Promise<T> {
  if (!target.codex_home || !target.vendor_session_id) throw new Error("Codex goal binding unavailable");
  let attached = false;
  try {
    return await withCodexRelay(nativeCodexGoalSocket(target.codex_home), async request => {
      await verifyLoadedParent(request, target.vendor_session_id!);
      attached = true;
      return run(request);
    }, 15_000, { experimentalApi: true });
  } catch (error) {
    // Only topology discovery can select a different read transport. Once
    // attached, no action or failure is replayed through another process.
    if (attached || (error instanceof AgentGoalConnectionError && error.availability === "unsupported")) throw error;
  }
  return withCodexReceiver({ thread_id: target.vendor_session_id, codex_home: target.codex_home }, async request => {
    const value = await request("thread/read", { threadId: target.vendor_session_id, includeTurns: false });
    if (value?.thread?.id !== target.vendor_session_id) throw new Error("Codex goal thread binding mismatch");
    return withOrdinaryCodexGoal(request, target.vendor_session_id!, run, cliControl);
  }, { ...(target.executable ? { executable: target.executable } : {}) });
}

/** Budget-only updates use the official service without competing for the
 * live rollout writer. Objective/status mutations stay with the owning CLI. */
export async function withOrdinaryCodexGoal<T>(request: GoalRequest, threadId: string, run: GoalConnectionRun<T>,
  cliControl?: (command: "pause" | "resume" | "clear") => Promise<void>): Promise<T> {
    const budgetUpdate = z.object({ threadId: z.literal(threadId), origin: z.literal("user"), tokenBudget: z.number().int().positive() }).strict();
    return run(async (method, params) => {
      if (method === "thread/goal/get") return request(method, params);
      if (method === "thread/goal/set" && budgetUpdate.safeParse(params).success) return request(method, params);
      const value = params as { threadId?: unknown; status?: unknown; origin?: unknown; [key: string]: unknown };
      if (!cliControl || value.threadId !== threadId || value.origin !== "user"
        || Object.keys(value).some(key => !["threadId", "status", "origin"].includes(key))) throw new Error("Read-only native goal connection");
      const command = method === "thread/goal/clear" ? "clear"
        : method === "thread/goal/set" && value.status === "paused" ? "pause"
          : method === "thread/goal/set" && value.status === "active" ? "resume" : null;
      if (!command) throw new Error("Unsupported CLI goal operation");
      await cliControl(command); // once, through the current CLI's own goal action
      const deadline = Date.now() + 3_000;
      do {
        const observed: any = await request("thread/goal/get", { threadId });
        if (command === "clear" ? observed?.goal === null : observed?.goal?.threadId === threadId
          && observed.goal.status === (command === "pause" ? "paused" : "active"))
          return command === "clear" ? { cleared: true } : observed;
        await new Promise(resolve => setTimeout(resolve, 40));
      } while (Date.now() < deadline);
      throw new Error("CLI goal acknowledgement unconfirmed");
    }, { inspect: true, create: false, edit: true, pause: !!cliControl, resume: !!cliControl, clear: !!cliControl },
    { create: { objective: false, token_budget: false }, edit: { objective: false, token_budget: true } });
}
