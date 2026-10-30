import { z } from "zod";
import { AitermError } from "../errors.js";
import { checkedCatalog, catalogInvalid, type AgentModelCatalog } from "../model-catalog.js";

// agy 1.4.10 exposes effort-specific IDs; overriding an ID's effort is rejected by the CLI.
export function antigravityCatalog(stdout: string, selected: string): AgentModelCatalog {
  const rows = (text: string) => text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const fields = line.split("\t");
    if (fields.length !== 2 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(fields[0]) || !fields[1].trim()) {
      throw catalogInvalid("Antigravity", "agy modelsのIDと表示名を確認できません");
    }
    return { id: fields[0], display_name: fields[1] };
  });
  const models = rows(stdout).map(model => {
    const effort = /-(low|medium|high|xhigh|max)$/.exec(model.id)?.[1] ?? null;
    return { ...model, efforts: effort ? [effort] : [], default_effort: effort, hidden: false, fast: false };
  });
  const current = rows(selected);
  if (current.length !== 1) throw catalogInvalid("Antigravity", "agy -p /modelの選択modelを確認できません");
  return checkedCatalog("Antigravity", {
    source: "agy models / agy -p /model", harness_version: null,
    default_model: current[0].id, models, adapter_efforts: {},
  });
}

const resultSchema = z.object({
  conversation_id: z.uuid(),
  status: z.enum(["SUCCESS", "ERROR", "CANCELED", "INTERRUPTED", "INVALID", "WAITING", "RUNNING"]),
  response: z.string(),
  error: z.string().optional(),
  num_turns: z.number().int().nonnegative(),
}).loose();

/** Match a result to the sole outstanding turn; neither queueing nor a partial step proves completion. */
export function antigravityTurnResult(value: unknown, conversationId: string, turn: number) {
  if (!value || typeof value !== "object" || !("event" in value) || value.event !== "result") return null;
  const parsed = resultSchema.safeParse("result" in value ? value.result : undefined);
  if (!parsed.success || parsed.data.conversation_id !== conversationId || parsed.data.num_turns !== turn) {
    throw new AitermError("ANTIGRAVITY_RESULT_MISMATCH: resultが送信した会話とturnに一致しません", 2);
  }
  const result = parsed.data;
  if (result.status === "WAITING" || result.status === "RUNNING") return null;
  return { ...result, outcome: result.status === "SUCCESS" ? "done" as const : "error" as const };
}
