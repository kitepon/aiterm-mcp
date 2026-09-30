// agent_modelsの共通の形。harnessごとの取得口・出力形式・model IDとeffortの変換は src/harnesses/ が持ち、
// ここはharness中立の型、effortの並び、形の検証だけを持つ。
import { AitermError } from "./errors.js";

// 並びはBellTeamの候補表示と同じ。未知のeffortは既知のものの後ろへ、出てきた順で置く。
const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "extra-high", "max", "ultra", "ultracode"];

export interface AgentModelChoice {
  /** harnessへ渡すmodel ID（agent_launch／agent_configureのmodel） */
  id: string;
  display_name: string | null;
  /** そのmodelで選べるreasoning effort（agent_launch／agent_configureのreasoning_effort） */
  efforts: string[];
  default_effort: string | null;
  hidden: boolean;
}

export interface AgentModelCatalog {
  /** 取得に使った公式の入口 */
  source: string;
  harness_version: string | null;
  /** modelを省略した時にharnessが使うmodel。一覧のIDで表せない時はnull */
  default_model: string | null;
  models: AgentModelChoice[];
  /** harnessの一覧には無く、Aitermのadapterが足したeffortと理由 */
  adapter_efforts: Record<string, string>;
}

export function sortEfforts(efforts: Iterable<string>): string[] {
  const unique = [...new Set(efforts)];
  const rank = (effort: string) => {
    const index = EFFORT_ORDER.indexOf(effort);
    return index === -1 ? EFFORT_ORDER.length : index;
  };
  return unique.map((effort, order) => ({ effort, order })).sort((a, b) => rank(a.effort) - rank(b.effort) || a.order - b.order)
    .map(item => item.effort);
}

export function catalogUnavailable(label: string, detail: string): AitermError {
  return new AitermError(`MODEL_CATALOG_UNAVAILABLE: ${label} のmodel一覧を取得できません: ${detail}`, 2);
}

export function catalogInvalid(label: string, detail: string): AitermError {
  return new AitermError(`MODEL_CATALOG_INVALID: ${label} のmodel一覧の形式が不正です: ${detail}`, 2);
}

/** adapterが作った一覧を検証する。空の一覧、重複ID、空の値は形式異常として止める。 */
export function checkedCatalog(label: string, catalog: AgentModelCatalog): AgentModelCatalog {
  if (catalog.models.length === 0) throw catalogInvalid(label, "利用可能なmodelがありません");
  const seen = new Set<string>();
  for (const model of catalog.models) {
    if (!model.id.trim()) throw catalogInvalid(label, "空のmodel IDがあります");
    if (seen.has(model.id)) throw catalogInvalid(label, `model ID ${JSON.stringify(model.id)} が重複しています`);
    seen.add(model.id);
    if (model.efforts.some(effort => !effort.trim())) throw catalogInvalid(label, `${model.id} に空のeffortがあります`);
    if (model.default_effort !== null && !model.efforts.includes(model.default_effort)) {
      throw catalogInvalid(label, `${model.id} の既定effort ${JSON.stringify(model.default_effort)} が候補にありません`);
    }
  }
  if (catalog.default_model !== null && !seen.has(catalog.default_model)) {
    throw catalogInvalid(label, `既定model ${JSON.stringify(catalog.default_model)} が一覧にありません`);
  }
  return { ...catalog, models: catalog.models.map(model => ({ ...model, efforts: sortEfforts(model.efforts) })) };
}

/** 公開toolの結果。harness全体のeffortsは各modelの和で、modelを省略した時や一覧に無いmodelで使える範囲の目安。 */
export function agentModelsResult(harness: string, catalog: AgentModelCatalog) {
  return {
    schema: "aiterm.agent-models.v1" as const,
    harness,
    source: catalog.source,
    harness_version: catalog.harness_version,
    default_model: catalog.default_model,
    efforts: sortEfforts(catalog.models.flatMap(model => model.efforts)),
    adapter_efforts: catalog.adapter_efforts,
    models: catalog.models,
  };
}

/** 応答が見つからない時の原因調査用。本文は出さず、終了状態と長さ、stderrの末尾だけを返す。 */
export function processSummary(result: { status: number | null; signal?: NodeJS.Signals | null; stdout?: string | null; stderr?: string | null }): string {
  const stderr = (result.stderr ?? "").trim().split(/\r?\n/).slice(-3).join(" / ").slice(-300);
  return `exit=${result.status ?? "null"} signal=${result.signal ?? "null"} stdout=${(result.stdout ?? "").length}bytes` +
    (stderr ? ` stderr=${JSON.stringify(stderr)}` : "");
}

/** JSON Linesの出力から、条件に合う最初の行を返す。JSONでない行（起動時の案内等）は読み飛ばす。 */
export function findJsonLine(stdout: string, match: (value: any) => boolean): any | null {
  for (const line of stdout.split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    let value: any;
    try { value = JSON.parse(text); } catch { continue; }
    if (match(value)) return value;
  }
  return null;
}
