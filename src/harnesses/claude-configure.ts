import { AitermError } from "../errors.js";
import { sleep, type AgentMetadata } from "../agent-shared.js";
import type { AgentModelUi } from "../agent-model-ui.js";
import { resolveAgentBin } from "../agent-resolver.js";
import type { AgentModelCatalog } from "../model-catalog.js";
import { claudeModelPicker, claudeModelPickerRow, claudeModelSwitchConfirm,
  claudeModelSwitchResult, claudePaneObservation, claudeModelChoices, type ClaudeModelPicker } from "./claude.js";

const CLAUDE_MODEL_PICKER_TIMEOUT_MS = 8_000;
const CLAUDE_MODEL_PICKER_KEY_TIMEOUT_MS = 1_500;
const CLAUDE_MODEL_SWITCH_TIMEOUT_MS = 15_000;
const CLAUDE_EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"];

export async function configureClaudeForSessionOnly(
  name: string,
  meta: AgentMetadata,
  model: string | null,
  effort: string | null,
  beforeChange: () => void,
  ui: AgentModelUi & { ready(): Promise<{ ready: boolean }> },
): Promise<void> {
  let selectionIssued = false;
  const screen = () => ui.screen();
  const until = async <T>(read: () => T | null | undefined, timeoutMs: number): Promise<T | null> => {
    const deadline = performance.now() + timeoutMs;
    do {
      const got = read();
      if (got) return got;
      await sleep(100);
    } while (performance.now() < deadline);
    return null;
  };
  // Escは、選ぶ画面か確かめの画面が出ている間だけ打つ（入力欄へ戻った後のEscは、ほかの操作を取り消してしまう）。
  const refuse = async (code: string, reason: string): Promise<never> => {
    for (let i = 0; i < 3; i++) {
      const now = screen();
      if (!claudeModelPicker(now) && !claudeModelSwitchConfirm(now)) break;
      ui.key("Escape");
      await sleep(300);
    }
    throw new AitermError(`${code} vendor=claude session=${name}\n${reason}。` +
      (selectionIssued ? "設定が変わった可能性があります。再送しないでください。" : "modelとreasoning_effortは変えていません。"), 2);
  };
  const picker = (): ClaudeModelPicker | null => claudeModelPicker(screen());
  const cursorOf = (p: ClaudeModelPicker | null) => p?.rows.find((row) => row.cursor) ?? null;
  // 1回押して、画面の今の行かeffortが変わるまで待つ。変わらなければnull（端で止まった・キーが落ちた）。
  // キーが落ちる事があるので、変わらなければ1度だけ押し直す。
  const press = async (key: string, changed: (p: ClaudeModelPicker) => boolean): Promise<ClaudeModelPicker | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      ui.key(key);
      const next = await until(() => { const p = picker(); return p && changed(p) ? p : null; }, CLAUDE_MODEL_PICKER_KEY_TIMEOUT_MS);
      if (next) return next;
    }
    return null;
  };

  await ui.command("/model");
  let now = await until(picker, CLAUDE_MODEL_PICKER_TIMEOUT_MS);
  if (!now) {
    // 読めない形の画面が開いたままだと、席が次の文を受け取れない。入力待ちでも動作中でもない時だけ、Escを1度打って閉じる。
    let state = claudePaneObservation(screen());
    if (state.state === "unknown") {
      ui.key("Escape");
      await sleep(500);
      state = claudePaneObservation(screen());
    }
    throw new AitermError(
      `CLAUDE_MODEL_PICKER_NOT_SHOWN vendor=claude session=${name} state=${state.state}/${state.reason}\n` +
        "Claude Codeの /model の選ぶ画面を読めません（Claude Codeの版で画面の形が変わった見込み）。modelとreasoning_effortは変えていません。",
      2,
    );
  }
  if (!now.session_only) {
    return refuse(
      "CLAUDE_MODEL_SESSION_ONLY_UNAVAILABLE",
      "このClaude Codeの /model の選ぶ画面に、この会話だけで使う選び方（s to use this session only）がありません。" +
        "端末の既定を書き換える選び方は使いません",
    );
  }

  let targetIndex: number | null = null;
  if (model) {
    // 見えていない行は、下へ送りながら集める（一周するか、端で止まるまで）。
    const known = new Map(now.rows.map((row) => [row.index, row]));
    const start = cursorOf(now);
    if (!start) return refuse("CLAUDE_MODEL_PICKER_UNREADABLE", "選ぶ画面の今の行を読めません");
    let at = start.index;
    const seen = new Set([at]);
    for (let i = 0; i < 80; i++) {
      const before = at;
      const next = await press("Down", (p) => { const c = cursorOf(p); return !!c && c.index !== before; });
      if (!next) break;
      now = next;
      for (const row of next.rows) known.set(row.index, row);
      at = cursorOf(next)!.index;
      if (seen.has(at)) break;
      seen.add(at);
    }
    let target = claudeModelPickerRow([...known.values()], model);
    if (!target || /^[a-z]+$/iu.test(model)) {
      const bin = meta.agent_executable ?? resolveAgentBin("claude");
      if (!bin) return refuse("CLAUDE_MODEL_NOT_IN_PICKER", "Claude CodeのCLIが見つかりません");
      let catalog: AgentModelCatalog;
      try { catalog = await claudeModelChoices(bin, meta.cwd ?? process.cwd()); }
      catch (error) { return refuse("CLAUDE_MODEL_CATALOG_UNAVAILABLE", error instanceof Error ? error.message : String(error)); }
      const native = catalog.models.find(item => item.id.toLowerCase() === model.toLowerCase());
      // The native alias can resolve to an older model; picker order is not alias authority.
      const label = native?.display_name ?? native?.id ?? model;
      const matching = [...known.values()].filter(row => row.label.toLowerCase() === label.toLowerCase());
      target = matching.length === 1 ? matching[0] : null;
    }
    if (!target) {
      const names = [...known.values()].sort((a, b) => a.index - b.index).map((row) => row.label).join(", ");
      return refuse("CLAUDE_MODEL_NOT_IN_PICKER", `Claude Codeの /model の選ぶ画面に ${model} がありません（選べる機種: ${names}）`);
    }
    for (let i = 0; i < 80 && at !== target.index; i++) {
      const before = at;
      const next = await press(target.index > at ? "Down" : "Up", (p) => { const c = cursorOf(p); return !!c && c.index !== before; });
      if (!next) break;
      now = next;
      at = cursorOf(next)!.index;
    }
    if (at !== target.index) return refuse("CLAUDE_MODEL_PICKER_UNREADABLE", `選ぶ画面で ${target.label} の行へ動けません`);
    // 起きた後にClaude Codeが更新された席では、「Update Claude Code to use this model」の行が出る。その行にはEnterもsも無い。
    if (!now.session_only) {
      return refuse(
        "CLAUDE_MODEL_NOT_SELECTABLE",
        `${target.label} は、この席のClaude Codeでは選べません（選ぶ画面のその行に、選ぶためのキーが出ていません。席のClaude Codeが古い見込み）`,
      );
    }
    targetIndex = target.index;
  }

  if (effort) {
    const wanted = CLAUDE_EFFORT_ORDER.indexOf(effort);
    const row = cursorOf(now)?.label ?? model ?? "このmodel";
    // そのmodelに無い段は飛ばされて行き来になるので、回数で打ち切る。
    for (let i = 0; i < CLAUDE_EFFORT_ORDER.length + 3 && now.effort !== effort; i++) {
      const current: string | null = now.effort;
      const from = current === null ? -1 : CLAUDE_EFFORT_ORDER.indexOf(current);
      if (from < 0) return refuse("CLAUDE_EFFORT_NOT_SELECTABLE", `${row} では reasoning_effort を選べません`);
      const next = await press(wanted > from ? "Right" : "Left", (p) => p.effort !== current);
      if (!next) break;
      now = next;
    }
    if (now.effort !== effort) return refuse("CLAUDE_EFFORT_NOT_SELECTABLE", `${row} では reasoning_effort=${effort} を選べません`);
  }

  // 打つ直前に、もう1度読んで確かめる。
  const last = picker();
  const lastRow = cursorOf(last);
  if (!last || !lastRow || !last.session_only
    || (targetIndex !== null && lastRow.index !== targetIndex)
    || (effort && last.effort !== effort)) {
    return refuse("CLAUDE_MODEL_PICKER_UNREADABLE", "選ぶ直前の画面が、選んだ行・effortと合いません");
  }
  beforeChange();
  selectionIssued = true;
  ui.key("s");

  let confirmed = false;
  const result = await until(() => {
    const text = screen();
    const confirm = claudeModelSwitchConfirm(text);
    if (confirm === "yes_selected" && !confirmed) {
      // 会話が今のmodelでcacheされている時の確かめ。1番（Yes, switch）が選ばれている時だけ進める。
      confirmed = true;
      ui.key("Enter");
      return null;
    }
    if (confirm || claudeModelPicker(text)) return null;
    return claudeModelSwitchResult(text);
  }, CLAUDE_MODEL_SWITCH_TIMEOUT_MS);
  if (!result) return refuse("CLAUDE_MODEL_SWITCH_UNCONFIRMED", "Claude Codeの切り替えの知らせを確認できません");
  if (result.scope === "saved_as_default") {
    throw new AitermError(
      `CLAUDE_MODEL_SAVED_AS_DEFAULT vendor=claude session=${name}\n` +
        `Claude Codeが、選んだ値を端末の既定として保存したと返しました（${result.line}）。~/.claude/settings.json を確かめてください。`,
      2,
    );
  }
  if (result.scope !== "session_only") {
    throw new AitermError(
      `CLAUDE_MODEL_SWITCH_REFUSED vendor=claude session=${name}\n` +
        `Claude Codeがmodelを切り替えませんでした（${result.line}）。modelとreasoning_effortは変えていません。`,
      2,
    );
  }
  const ready = await ui.ready();
  if (!ready.ready) throw new AitermError("Claudeのmodel変更完了を確認できません", 2);
}
