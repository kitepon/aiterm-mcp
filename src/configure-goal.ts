import type { NativeGoal } from "./agent-goal.js";
import type { AgentGoalWireResult } from "./agent-goal-native-result.js";
import { AitermError } from "./errors.js";

export interface ConfigureGoalRuntime {
  goal(action: "inspect" | "pause" | "resume", expected?: NativeGoal): Promise<AgentGoalWireResult>;
  waitForTurnEnd(): Promise<void>;
}

function confirmed(result: AgentGoalWireResult): boolean {
  return result.availability === "available" && result.readback === "confirmed";
}

function goalState(result: AgentGoalWireResult): string {
  if (!confirmed(result)) return `unknown (${result.reason})`;
  return result.schema === "aiterm.agent-goal-result.v1" ? result.goal?.status ?? "none" : "native v2";
}

/** Only a pause owned by this request may be restored; native goal data stays with the CLI. */
export async function configureWithPausedGoal<T>(runtime: ConfigureGoalRuntime, configure: () => Promise<T>): Promise<T> {
  const before = await runtime.goal("inspect");
  if (!confirmed(before) || before.goal === null) return configure();
  if (before.schema !== "aiterm.agent-goal-result.v1") {
    throw new AitermError("GOAL_CONFIGURE_UNSUPPORTED: このgoalは一時停止に対応していません。goalを停止または完了にしてから agent_configure してください。設定は変えていません。", 2);
  }
  if (before.goal?.status !== "active") return configure();
  const paused = await runtime.goal("pause", before.goal);
  if (!confirmed(paused) || paused.outcome !== "applied" || paused.schema !== "aiterm.agent-goal-result.v1" || paused.goal?.status !== "paused") {
    throw new AitermError(`GOAL_CONFIGURE_PAUSE_UNCONFIRMED: goal=${goalState(paused)} (${paused.reason})。設定は変えていません。goalの状態を確認してから再実行してください。`, 2);
  }
  let value!: T;
  let failure: unknown;
  let failed = false;
  let applied = false;
  try {
    await runtime.waitForTurnEnd();
    value = await configure();
    applied = true;
  } catch (error) { failed = true; failure = error; }

  let restored = "unknown";
  let resumedSuccessfully = false;
  try {
    const current = await runtime.goal("inspect");
    if (confirmed(current) && current.schema === "aiterm.agent-goal-result.v1" && current.goal?.status === "paused"
      && current.goal.threadId === paused.goal.threadId && current.goal.createdAt === paused.goal.createdAt
      && current.goal.objective === paused.goal.objective && current.goal.tokenBudget === paused.goal.tokenBudget) {
      const resumed = await runtime.goal("resume", current.goal);
      restored = goalState(resumed);
      resumedSuccessfully = confirmed(resumed) && resumed.outcome === "applied" && resumed.schema === "aiterm.agent-goal-result.v1" && resumed.goal?.status === "active";
    } else restored = goalState(current) + " (goal changed; not resumed)";
  } catch (error) {
    restored = `unknown (${error instanceof Error ? error.message : String(error)})`;
  }
  if (resumedSuccessfully) {
    if (!failed) return value;
    const error = failure instanceof Error ? failure : new Error(String(failure));
    error.message += " goal=active（一時停止したgoalは再開済み）。";
    throw error;
  }
  throw new AitermError(`GOAL_CONFIGURE_RESTORE_UNCONFIRMED: ${applied ? "設定変更は完了" : "設定変更は未完了"}。goal=${restored}。` +
    (failed ? ` ${failure instanceof Error ? failure.message : String(failure)}` : "") + " goalの状態を確認してください。", 2);
}
