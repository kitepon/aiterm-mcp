import { AitermError } from "../errors.js";
import { sleep } from "../agent-shared.js";
import { lineCounts, type AgentModelUi } from "../agent-model-ui.js";
import { loadAgentMetadata } from "../agent-metadata-reader.js";
import { resolveAgentBin } from "../agent-resolver.js";
import { codexModelChoice, codexEffortChoice, codexMoreReasoningChoice, codexCurrentEffort,
  codexModelChangeNotices, codexModelChoices } from "./codex.js";

export async function configureCodexModel(name: string, model: string | null, effort: string | null, beforeChange: () => void, ui: AgentModelUi & { waitForText(text: string): Promise<string> }): Promise<void> {
  try {
    await chooseCodexModel(name, model, effort, beforeChange, ui);
  } catch (error) {
    // 選べずに断る時は、開いた選ぶ画面を閉じてから断る（開いたままだと、席は次の文を受け付けない）。
    for (let i = 0; i < 3; i++) {
      const tail = ui.screen().split("\n").map((line) => line.trim()).filter(Boolean).slice(-2).join("\n");
      if (!/esc back/.test(tail)) break;
      ui.key("Escape");
      await sleep(400);
    }
    throw error;
  }
}

async function chooseCodexModel(name: string, model: string | null, effort: string | null, beforeChange: () => void, ui: AgentModelUi & { waitForText(text: string): Promise<string> }): Promise<void> {
  const beforeCounts = lineCounts(ui.screen());
  await ui.command("/model");
  let modelScreen = await ui.waitForText("Select Model and Effort");
  if (model && !effort) {
    ui.key("Enter");
    let currentScreen = await ui.waitForText("Select Reasoning Level");
    let advanced = false;
    if (/More reasoning[^\n]*\(current\)/.test(currentScreen)) {
      const more = codexMoreReasoningChoice(currentScreen);
      if (more) {
        ui.key(more);
        currentScreen = await ui.waitForText("Advanced Reasoning");
        advanced = true;
      }
    }
    effort = codexCurrentEffort(currentScreen);
    if (!effort) throw new AitermError("CODEX_CURRENT_EFFORT_UNKNOWN: 現在のeffortを確認できません。設定は変えていません。", 2);
    if (advanced) {
      ui.key("Escape");
      await ui.waitForText("Select Reasoning Level");
    }
    ui.key("Escape");
    modelScreen = await ui.waitForText("Select Model and Effort");
  }
  if (model) {
    let choice = codexModelChoice(modelScreen, model);
    if (!choice) {
      const meta = loadAgentMetadata(name);
      const bin = meta.agent_executable ?? resolveAgentBin("codex");
      if (!bin) throw new AitermError("Codex の CLI が見つかりません", 2);
      const catalog = await codexModelChoices(bin, true);
      const target = catalog.models.find(item => item.id.toLowerCase() === model.toLowerCase());
      const displayName = target?.display_name;
      if (displayName && catalog.models.filter(item => item.display_name?.toLowerCase() === displayName.toLowerCase()).length === 1) {
        choice = codexModelChoice(modelScreen, model, displayName);
      }
    }
    if (!choice) throw new AitermError(`Codexの/modelに ${model} がありません`, 2);
    ui.key(choice);
  } else {
    ui.key("Enter");
  }

  let effortScreen = await ui.waitForText("Select Reasoning Level");
  if (effort) {
    let choice = codexEffortChoice(effortScreen, effort);
    if (!choice && (effort === "max" || effort === "ultra")) {
      const more = codexMoreReasoningChoice(effortScreen);
      if (more) {
        ui.key(more);
        effortScreen = await ui.waitForText("Advanced Reasoning");
        choice = codexEffortChoice(effortScreen, effort);
      }
    }
    if (!choice) throw new AitermError(`Codexの/modelに reasoning_effort=${effort} がありません`, 2);
    beforeChange();
    ui.key(choice);
  } else {
    beforeChange();
    ui.key("Enter");
  }
  for (const deadline = performance.now() + 3_000; performance.now() < deadline; await sleep(100)) {
    const screen = ui.screen();
    const counts = lineCounts(screen);
    if (codexModelChangeNotices(screen, model, effort).some(line => (counts.get(line) ?? 0) > (beforeCounts.get(line) ?? 0))) return;
  }
  throw new AitermError("CODEX_MODEL_SWITCH_UNCONFIRMED: 指定したmodel／effortの新しい変更通知を確認できません。設定が変わった可能性があります。再送しないでください。", 2);
}
