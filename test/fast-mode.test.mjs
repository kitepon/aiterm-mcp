import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

// ファスト（高速の応答）の切り替え（ADR 0114）。画面の文と設定fileの書かれ方は、2026-10-12の実物から写した:
// Claude Code 2.1.296、Codex 0.162.1（偽のmodelと一時のCODEX_HOME）、Grok 1.0.50、Cursor 2026.10.01。
const base = fs.mkdtempSync(path.join(os.tmpdir(), "afm-"));
process.env.TMPDIR = base;
process.env.XDG_RUNTIME_DIR = base;
// 利用者の設定の置き場を、試験の中だけの場所へ向ける（模したClaude Codeは、ここのsettings.jsonへ書く）。
const claudeConfig = path.join(base, "claude-config");
fs.mkdirSync(claudeConfig);
process.env.CLAUDE_CONFIG_DIR = claudeConfig;
const claude = await import("../dist/harnesses/claude.js");
const codex = await import("../dist/harnesses/codex.js");
const cursor = await import("../dist/harnesses/cursor.js");
const grok = await import("../dist/harnesses/grok.js");
const { agentModelsResult } = await import("../dist/model-catalog.js");
const { FastModeError, fastModeFailure, launchContinuesWithoutFast } = await import("../dist/fast-mode.js");
const { restoreJsonSetting, withUserConfigLock } = await import("../dist/user-config.js");
const core = await import("../dist/core.js");
core.__testSetAgentTuiReadyStableSamples(1);
after(() => fs.rmSync(base, { recursive: true, force: true }));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- 一覧（agent_models）

const claudeInitialize = (reason) => JSON.stringify({ type: "control_response", response: { request_id: "r1", subtype: "success", response: {
  models: [
    { value: "default", resolvedModel: "claude-opus-5-5", displayName: "Default (recommended)", supportsEffort: true, supportedEffortLevels: ["low", "high"], supportsFastMode: true },
    { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5", supportsEffort: true, supportedEffortLevels: ["low", "high"], supportsFastMode: true },
    { value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku 5.5", supportsEffort: true, supportedEffortLevels: ["low", "high"] },
    { value: "claude-opus-4-8", resolvedModel: "claude-opus-4-8", displayName: "Opus 4.8", supportsEffort: true, supportedEffortLevels: ["low", "high"], supportsFastMode: true },
  ],
  fast_mode_state: "off",
  ...(reason === undefined ? {} : { fast_mode_disabled_reason: reason }),
} } });

test("一覧: Claude Codeは supportsFastMode をmodelごとの fast にし、実体のIDでも引けるようにする", () => {
  const catalog = claude.claudeCatalogFromInitialize(claudeInitialize(undefined), "r1");
  assert.deepEqual(catalog.models.map((model) => [model.id, model.fast]), [["default", true], ["opus", true], ["haiku", false], ["claude-opus-4-8", true]]);
  // 一覧の値に無い実体のID（BellTeamの席の claude-opus-5-5）でも、fastの対応を引ける。
  assert.deepEqual(Object.keys(catalog.fast_ids).sort(), ["claude-opus-4-8", "claude-opus-5-5", "default", "opus"]);
  assert.equal(catalog.fast_unavailable, null);
  assert.equal(agentModelsResult("claude-code", catalog).fast_unavailable, null);
  assert.equal("fast_ids" in agentModelsResult("claude-code", catalog), false, "中で使う表は公開の返りへ出さない");
});

test("一覧: Claude Codeがアカウントの都合で使えないと答えた時は fast_unavailable に訳を入れる", () => {
  const unavailable = claude.claudeCatalogFromInitialize(claudeInitialize("extra_usage_disabled"), "r1").fast_unavailable;
  assert.equal(unavailable.code, "FAST_MODE_UNAVAILABLE");
  assert.match(unavailable.message, /^FAST_MODE_UNAVAILABLE: .*extra_usage_disabled: Fast mode requires usage credits/u);
  assert.match(claude.claudeFastUnavailable("preference").message, /disabled by your organization/u);
  assert.match(claude.claudeFastUnavailable("something_new").message, /something_new/u, "知らない訳も、そのまま添える");
  // 使える・まだ分からない・聞き方の都合は、使えないとは言わない。
  for (const reason of [undefined, null, "", "pending", "sdk_opt_in_required"]) assert.equal(claude.claudeFastUnavailable(reason), null, String(reason));
});

test("一覧: Codexは、速度の段に名前が Fast の段があるmodelを fast にする", () => {
  const tier = [{ id: "priority", name: "Fast", description: "2x speed, increased usage" }];
  const model = (id, serviceTiers) => ({ id, displayName: id, supportedReasoningEfforts: [{ reasoningEffort: "low" }], defaultReasoningEffort: "low", serviceTiers });
  const catalog = codex.codexCatalogFromPages([{ data: [model("gpt-6.1-sol", tier), model("gpt-daybreak-blue-latest", []), model("gpt-flex", [{ id: "flex", name: "Flex" }]), model("old", undefined)] }]);
  assert.deepEqual(catalog.models.map((item) => [item.id, item.fast]), [["gpt-6.1-sol", true], ["gpt-daybreak-blue-latest", false], ["gpt-flex", false], ["old", false]]);
  assert.deepEqual(catalog.fast_ids, { "gpt-6.1-sol": "gpt-6.1-sol" });
});

test("一覧: Grokのfast版は別のmodelとして並べず、元のmodelの fast にまとめる", () => {
  const efforts = { supportsReasoningEffort: true, reasoningEffort: "high", reasoningEfforts: [{ value: "low" }, { value: "high", default: true }] };
  const model = (modelId, name) => ({ modelId, name, _meta: efforts });
  const stdout = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { _meta: { agentVersion: "1.0.50", modelState: { currentModelId: "grok-4.7-build-fast",
    availableModels: [model("grok-4.7", "Grok 4.7"), model("grok-4.7-build-fast", "Grok 4.7 Fast"), model("grok-4.6", "Grok 4.6"), model("grok-9-fast", "Grok 9 Fast")] } } } });
  const catalog = grok.grokCatalogFromInitialize(stdout);
  assert.deepEqual(catalog.models.map((item) => [item.id, item.fast]), [["grok-4.7", true], ["grok-4.6", false], ["grok-9-fast", false]],
    "元のmodelが一覧に無いfast版（grok-9-fast）は、そのまま1つのmodelとして残す");
  assert.deepEqual(catalog.fast_ids, { "grok-4.7": "grok-4.7-build-fast" });
  assert.equal(catalog.default_model, "grok-4.7", "既定がfast版の時は、元のmodelで表す");
  assert.equal(grok.grokFastBase(catalog, "grok-4.7-build-fast"), "grok-4.7");
  assert.equal(grok.grokFastBase(catalog, "grok-4.6"), null);
});

test("一覧: Cursorは -fast 付きの完成形を、元のmodelの fast と、起動時に渡すIDの表にする", () => {
  const line = (id) => ({ id, label: id });
  const catalog = cursor.cursorCatalogFromLines(["auto", "gpt-5.3-codex", "gpt-5.3-codex-fast", "gpt-5.3-codex-low", "gpt-5.3-codex-low-fast", "gpt-5.3-codex-high",
    "composer-2.5", "composer-2.5-fast", "gemini-3.7-flash-high"].map(line));
  assert.deepEqual(catalog.models.map((item) => [item.id, item.fast]), [["auto", false], ["gpt-5.3-codex", true], ["composer-2.5", true], ["gemini-3.7-flash", false]]);
  assert.deepEqual(catalog.fast_ids, { "gpt-5.3-codex": "gpt-5.3-codex-fast", "gpt-5.3-codex-low": "gpt-5.3-codex-low-fast", "composer-2.5": "composer-2.5-fast" });
  assert.equal(cursor.cursorModelArgument("gpt-5.3-codex", "low", true), "gpt-5.3-codex-low-fast");
  assert.equal(cursor.cursorModelArgument("composer-2.5", null, true), "composer-2.5-fast");
  assert.equal(cursor.cursorModelArgument("gpt-5.3-codex", "low"), "gpt-5.3-codex-low", "fastを渡さなければ今までどおり");
  assert.equal(cursor.cursorModelIsFastVariant("composer-2.5-fast"), true);
  assert.equal(cursor.cursorModelIsFastVariant("composer-2.5"), false);
  assert.equal(cursor.cursorModelIsFastVariant(null), false);
});

// ---------- 断りの符号

test("断りの符号: アカウントの都合と確かめられない時だけ、起動を続ける", () => {
  assert.equal(launchContinuesWithoutFast("FAST_MODE_UNAVAILABLE"), true);
  assert.equal(launchContinuesWithoutFast("FAST_MODE_UNCONFIRMED"), true);
  assert.equal(launchContinuesWithoutFast("FAST_MODE_NOT_SUPPORTED"), false);
  assert.equal(launchContinuesWithoutFast("FAST_MODE_MODEL_CONFLICT"), false);
  const error = new FastModeError("FAST_MODE_NOT_SUPPORTED", "そのmodelは対応していません。");
  assert.equal(error.message, "FAST_MODE_NOT_SUPPORTED: そのmodelは対応していません。");
  assert.deepEqual(fastModeFailure(error), { code: "FAST_MODE_NOT_SUPPORTED", message: error.message });
  assert.equal(fastModeFailure(new Error("ほかの誤り")), null);
});

// ---------- 起動は通常の速度

test("起動: Codexは service_tier=default を明示して起こす（modelの既定の段や、利用者のconfigの値で流さない）", () => {
  const meta = { kind: "codex", hook_route: "none" };
  const command = codex.buildCodexAgentCmd("codex", "gpt-6-sol", "low", null, meta);
  assert.match(command, / -c service_tier=default(?: |$)/u);
  assert.doesNotMatch(command, /service_tier=(?:fast|priority)/u, "起動の引数でfastにしない（戻しても補助の問い合わせに残る）");
});

// ---------- 画面の読み

test("Claude Code: /fast の結果の行を、送る前の画面と比べて読む", () => {
  const composer = "──────\n❯\n──────\n  ⏵⏵ bypass permissions on (shift+tab to cycle)";
  const screen = (...lines) => [...lines, composer].join("\n");
  const before = screen("❯ /fast", "  ⎿  Fast mode OFF");
  assert.deepEqual(claude.claudeFastResult(before, screen("❯ /fast", "  ⎿  Fast mode OFF", "❯ /fast on", "  ⎿  ↯ Fast mode ON · $8/$40 per Mtok")),
    { state: "on", line: "↯ Fast mode ON · $8/$40 per Mtok" });
  assert.deepEqual(claude.claudeFastResult(before, screen("❯ /fast", "  ⎿  Fast mode OFF", "❯ /fast off", "  ⎿  Fast mode OFF")), { state: "off", line: "Fast mode OFF" });
  // 使えない訳は次の行へ折り返す（実物）。
  assert.deepEqual(claude.claudeFastResult(before, screen("❯ /fast", "  ⎿  Fast mode OFF", "❯ /fast on",
    "  ⎿  Fast mode unavailable: Fast mode requires usage credits · /usage-credits to", "     turn them on")),
    { state: "unavailable", line: "Fast mode unavailable: Fast mode requires usage credits · /usage-credits to turn them on" });
  assert.equal(claude.claudeFastResult(before, screen("❯ /fast", "  ⎿  Fast mode OFF", "❯ /fast on", "  ⎿  Fast mode was not changed: applying it failed")).state, "unchanged");
  assert.equal(claude.claudeFastResult(before, screen("❯ /fast", "  ⎿  Fast mode OFF", "❯ /fast on", "  ⎿  Fast mode unchanged (cancelled)")).state, "unchanged");
  // まだ結果が出ていない（前の /fast の行しか無い）。
  assert.equal(claude.claudeFastResult(before, screen("❯ /fast", "  ⎿  Fast mode OFF", "❯ /fast off")), null);
  assert.equal(claude.claudeFastIndicatorShown(screen("❯ hello")), false);
  assert.equal(claude.claudeFastIndicatorShown(`──────\n❯ ↯\n──────\n  ⏵⏵ bypass permissions on`), true);
});

test("Codex: /fast の候補と、切り替えた後の行を読む", () => {
  assert.equal(codex.codexFastCommandOffered("• MOCK_OK_1\n› /fast  2x speed, increased usage\n› /fast\n  GPT-6.1-Sol default · /proj"), true);
  assert.equal(codex.codexFastCommandOffered("• MOCK_OK_1\n› /fast\n  GPT-6.1-Sol default · /proj"), false, "入力欄へ打った文字だけでは、候補が出たとは読まない");
  assert.deepEqual(codex.codexServiceTierNotices("• Service tier set to priority\n› Reply\n• MOCK_OK\n• Service tier set to default\n› Ask Codex to do anything"), ["fast", "standard"]);
  assert.deepEqual(codex.codexServiceTierNotices("  Service tier cleared\n"), ["standard"]);
  assert.deepEqual(codex.codexServiceTierNotices("› tell me about Service tier set to priority things"), []);
});

test("Cursor: /model の画面の今の姿は最後の行で読み、パラメータの画面のFastの行を読む", () => {
  const list = ["   →  Codex 5.3                Low (Tab to modify)", "      Claude Opus 4.6          200K High", " 15-24 of 43", " Type to filter • Enter to select • Tab to edit"].join("\n");
  const parameters = (fast, selected = "Low") => [" Codex 5.3 — Edit Parameters                 Max mode: OFF", "   Reasoning",
    ...["Low", "Medium", "High", "Extra High"].map((label) => `   ${label === selected ? "→ ● " + label + " ✓" : "○ " + label}`),
    `   ${fast ? "◉" : "◯"} Fast`, "   ↑/↓ to navigate • Enter to select • Esc to go back"].join("\n");
  const closed = ["   → Plan, search, build anything", "   Codex 5.3 Low Fast                                            Run Everything", "   /tmp/proj"].join("\n");
  assert.equal(cursor.cursorPickerView(list), "list");
  assert.equal(cursor.cursorPickerView(list.replace("Type to filter", "Edit prompt to filter")), "list");
  assert.equal(cursor.cursorPickerView(parameters(false)), "parameters");
  assert.equal(cursor.cursorPickerView(closed), null);
  // Cursorは閉じた画面の行を消さない。上に前の画面が残っていても、今の姿は最後の行で決まる。
  assert.equal(cursor.cursorPickerView(`${parameters(true)}\n${list}\n${closed}`), null);
  assert.equal(cursor.cursorPickerView(`${closed}\n${parameters(true)}\n${list}`), "list");
  assert.deepEqual(cursor.cursorFastParameter(parameters(false)), { state: false, down: 4 });
  assert.deepEqual(cursor.cursorFastParameter(parameters(true, "High")), { state: true, down: 2 });
  // 前に開いたパラメータの画面が上に残っていても、今の画面（最後の見出しより後）を読む。
  assert.deepEqual(cursor.cursorFastParameter(`${parameters(true)}\n${list}\n${parameters(false, "Medium")}`), { state: false, down: 3 });
  assert.equal(cursor.cursorFastParameter(parameters(false).replace(/\n.*Fast.*/u, "")), null, "Fastの行が無いmodel");
  assert.equal(cursor.cursorFastParameter(closed), null);
  assert.equal(cursor.cursorEffortSelected(parameters(false, "High"), "High"), true);
  assert.equal(cursor.cursorEffortSelected(`${parameters(false, "High")}\n${list}\n${parameters(false, "Low")}`, "High"), false, "前の画面の印を、今の物として読まない");
  assert.deepEqual(cursor.cursorEffortNavigation(parameters(true, "Low"), "high"), { down: 2, label: "High" });
  // 開いた直後は、選んである段（✓）でなく1行目に矢印が居る（実物）。矢印の行と名前を読む。
  const opened = parameters(true, "Low").replace("→ ● Low ✓", "→ ○ Low").replace("○ High", "● High ✓");
  assert.deepEqual(cursor.cursorParameterRows(opened), [{ label: "Low", cursor: true }, { label: "Medium", cursor: false }, { label: "High", cursor: false },
    { label: "Extra High", cursor: false }, { label: "Fast", cursor: false }]);
  assert.deepEqual(cursor.cursorFastParameter(opened), { state: true, down: 4 });
  assert.equal(cursor.cursorHeaderShowsFast(closed), true);
  assert.equal(cursor.cursorHeaderShowsFast(closed.replace("Low Fast", "Low     ")), false);
  // 画面の幅で権限の表示が切れた見出し。
  assert.equal(cursor.cursorHeaderShowsFast("   → Plan, search, build anything\n      Codex 5.3 Low Fast                                            Run\n /tmp/proj"), true);
  assert.equal(cursor.cursorHeaderShowsFast("no header here"), null);
});

test("Cursor: 見出しが画面の外へ流れた後も、入力欄の案内があれば入力待ちと読む", () => {
  // まだ番を流していない席で /model の選ぶ画面を開いて閉じた後（2026.10.01の実物）。見出しの「Cursor Agent」は残っていない。
  const afterPicker = "   →\n   → Plan, search, build anything\n   Codex 5.3 Low                                                 Run Everything\n   /tmp/proj";
  assert.equal(cursor.cursorTuiReady(afterPicker), true);
  assert.equal(cursor.cursorTuiReady("   Filter:\n   Muse Spark 1.3           300K High\n   Codex 5.3 Low        Run Everything\n   /tmp/proj"), false,
    "選ぶ画面を閉じた直後（入力欄がまだ描かれていない）は、入力待ちと読まない");
  assert.equal(cursor.cursorTuiReady("$ ls\n   →\n"), false, "見出しも案内も無い矢印だけの行は、入力待ちと読まない");
});

test("Grok: 足元のmodelの表示から、今のmodelとfast版かどうかを読む", () => {
  const catalog = { models: [{ id: "grok-4.7", display_name: "Grok 4.7" }, { id: "grok-4.6", display_name: "Grok 4.6" }], fast_ids: { "grok-4.7": "grok-4.7-build-fast" } };
  const footer = (label) => `   Switched to ${label.replace(/ \((\w+)\)/u, " ($1 effort)")}\n  ╭──────╮\n  │ ❯    │\n  ╰──────── ${label} ─╯\n  Shift+Tab:mode  │  Ctrl+x:shortcuts`;
  assert.deepEqual(grok.grokModelFromFooter(footer("Grok 4.7 Fast (high)"), catalog), { id: "grok-4.7-build-fast", base: "grok-4.7", fast: true });
  assert.deepEqual(grok.grokModelFromFooter(footer("Grok 4.7 (medium)"), catalog), { id: "grok-4.7", base: "grok-4.7", fast: false });
  // 権限の表示が付く形。
  assert.deepEqual(grok.grokModelFromFooter(footer("Grok 4.6 (high)").replace(" ─╯", " · always-approve ─╯"), catalog), { id: "grok-4.6", base: "grok-4.6", fast: false });
  assert.equal(grok.grokModelFromFooter(footer("Grok 9 (high)"), catalog), null, "一覧に無い表示");
  assert.equal(grok.grokModelFromFooter("   Switched to Grok 4.7 Fast (high effort)\n", catalog), null, "切り替えの知らせは足元でない");
});

// ---------- 利用者の既定を戻す

test("Codex: config.tomlの最上位の service_tier を読み、1行だけを元の値へ直す", () => {
  const file = path.join(base, "codex-config.toml");
  const original = 'model = "gpt-6.1-sol"\n# 速度の段は書いていない\n\n[features]\nfast_mode = true\n';
  fs.writeFileSync(file, original, { mode: 0o600 });
  assert.deepEqual(codex.readCodexConfigPins(file).service_tier, { present: false, value: null });
  // /fast が書いた後（Codexは最上位へ足す）。
  fs.writeFileSync(file, 'model = "gpt-6.1-sol"\n# 速度の段は書いていない\nservice_tier = "fast"\n\n[features]\nfast_mode = true\n');
  assert.deepEqual(codex.readCodexConfigPins(file).service_tier, { present: true, value: "fast" });
  codex.restoreCodexDefaultInFile(file, "service_tier", { present: false, value: null });
  assert.equal(fs.readFileSync(file, "utf8"), 'model = "gpt-6.1-sol"\n# 速度の段は書いていない\n\n[features]\nfast_mode = true\n');
  // 元に値があった時は、その値へ戻す。行が消えていれば、最初の表の前へ足す。
  fs.writeFileSync(file, 'service_tier = "default"\n[features]\nservice_tier = "table-key"\n');
  codex.restoreCodexDefaultInFile(file, "service_tier", { present: true, value: "flex" });
  assert.equal(fs.readFileSync(file, "utf8"), 'service_tier = "flex"\n[features]\nservice_tier = "table-key"\n', "表の中の同じ名前の鍵には触らない");
  fs.writeFileSync(file, '[features]\nfast_mode = true\n');
  codex.restoreCodexDefaultInFile(file, "service_tier", { present: true, value: "flex" });
  assert.equal(fs.readFileSync(file, "utf8"), 'service_tier = "flex"\n[features]\nfast_mode = true\n');
  // model と model_reasoning_effort も同じ形で戻す（/model の選択が保存する）。
  fs.writeFileSync(file, 'model = "gpt-6-sol"\nmodel_reasoning_effort = "low"\n[features]\n');
  codex.restoreCodexDefaultInFile(file, "model", { present: true, value: "gpt-6.1-sol" });
  codex.restoreCodexDefaultInFile(file, "model_reasoning_effort", { present: false, value: null });
  assert.equal(fs.readFileSync(file, "utf8"), 'model = "gpt-6.1-sol"\n[features]\n');
  // 元の値が読めない書き方だった時は触らない。
  fs.writeFileSync(file, 'service_tier = "fast"\n');
  codex.restoreCodexDefaultInFile(file, "service_tier", { present: true, value: null });
  assert.equal(fs.readFileSync(file, "utf8"), 'service_tier = "fast"\n');
});

test("Grok: [models] の default と default_reasoning_effort を読み、切り替えの直前の値へ戻す", () => {
  const file = path.join(base, "grok-config.toml");
  const original = '[ui]\nyolo = false\n\n[models]\ndefault = "grok-4.6"\ndefault_reasoning_effort = "high"\n\n[marketplace]\ndefault = "not-a-model"\n';
  fs.writeFileSync(file, original, { mode: 0o600 });
  const before = grok.readGrokModelDefaults(file);
  assert.deepEqual([before.default, before.default_reasoning_effort], [{ present: true, value: "grok-4.6" }, { present: true, value: "high" }]);
  // Grokが `/model grok-4.7-build-fast low` で書いた後。ほかの行が同じなら、前の中身をそのまま書き戻す。
  fs.writeFileSync(file, original.replace('"grok-4.6"', '"grok-4.7-build-fast"').replace('"high"', '"low"'));
  grok.restoreGrokModelDefaults(file, before);
  assert.equal(fs.readFileSync(file, "utf8"), original);
  // ほかの行も変わっていた時（ほかの人の書き込み）は、既定の行だけを直して、ほかは今のまま残す。
  fs.writeFileSync(file, original.replace('"grok-4.6"', '"grok-4.7"').replace("yolo = false", "yolo = true"));
  grok.restoreGrokModelDefaults(file, before);
  assert.equal(fs.readFileSync(file, "utf8"), original.replace("yolo = false", "yolo = true"));
  // [models] の節が無かった所へGrokが足した時は、足された既定の行を消す（別の節の同じ名前の鍵には触らない）。
  const bare = '[marketplace]\ndefault = "not-a-model"\n';
  fs.writeFileSync(file, bare);
  const none = grok.readGrokModelDefaults(file);
  assert.deepEqual([none.default.present, none.default_reasoning_effort.present], [false, false]);
  fs.writeFileSync(file, `${bare}\n[models]\ndefault = "grok-4.7"\n`);
  grok.restoreGrokModelDefaults(file, none);
  assert.equal(fs.readFileSync(file, "utf8"), `${bare}\n[models]\n`);
  // fileが無かった時・読めない書き方の値は触らない。
  const missing = grok.readGrokModelDefaults(path.join(base, "no-such.toml"));
  assert.equal(missing.body, null);
  fs.writeFileSync(file, original);
  grok.restoreGrokModelDefaults(file, missing);
  assert.equal(fs.readFileSync(file, "utf8"), original);
});

test("JSONの設定: 1項目だけを切り替えの前の値へ戻し、並びだけの書き直しは前の中身へ戻す", () => {
  const file = path.join(base, "settings.json");
  const original = '{\n  "hooks": {"Stop": [{"asyncRewake": true, "timeout": 86400}]},\n  "theme": "dark"\n}\n';
  const write = (value) => fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2), { mode: 0o600 });
  const read = () => fs.readFileSync(file, "utf8");
  const before = Buffer.from(original);
  // /fast on: Claude Codeは fastMode を足し、hookの中の項目の並びも変えて書き直す（実物）。
  write({ hooks: { Stop: [{ timeout: 86400, asyncRewake: true }] }, theme: "dark", fastMode: true });
  assert.equal(restoreJsonSetting(file, before, "fastMode"), true);
  assert.equal(read(), original, "前の中身（空白や並びもそのまま）へ戻る");
  // /fast off: 項目は無いままで、並びだけ変わった。
  write({ theme: "dark", hooks: { Stop: [{ timeout: 86400, asyncRewake: true }] } });
  assert.equal(restoreJsonSetting(file, before, "fastMode"), true);
  assert.equal(read(), original);
  // 何も変わっていなければ書かない。
  assert.equal(restoreJsonSetting(file, before, "fastMode"), false);
  // 切り替えの間に、ほかの人がほかの項目を書いた。その項目は残し、fastMode だけを戻す。
  write({ hooks: { Stop: [{ timeout: 86400, asyncRewake: true }] }, theme: "light", fastMode: true });
  assert.equal(restoreJsonSetting(file, before, "fastMode"), true);
  assert.deepEqual(JSON.parse(read()), { hooks: { Stop: [{ timeout: 86400, asyncRewake: true }] }, theme: "light" });
  // 前に値があった時は、その値へ戻す。
  write({ theme: "dark" });
  assert.equal(restoreJsonSetting(file, Buffer.from('{"theme":"dark","fastMode":true}'), "fastMode"), true);
  assert.equal(read(), '{"theme":"dark","fastMode":true}');
  // 前はfileが無かった所へ、harnessが作った。項目だけを消す。
  write({ fastMode: true, theme: "dark" });
  assert.equal(restoreJsonSetting(file, null, "fastMode"), true);
  assert.deepEqual(JSON.parse(read()), { theme: "dark" });
  // 読めない中身には触らない。
  write("{ broken");
  assert.equal(restoreJsonSetting(file, before, "fastMode"), false);
  assert.equal(read(), "{ broken");
  assert.equal(restoreJsonSetting(path.join(base, "no-such.json"), before, "fastMode"), false);
});

test("鍵: 同じ設定fileを触る切り替えは1つずつ進み、落ちたprocessの鍵は古くなれば引き取る", async () => {
  const file = path.join(base, "locked.json");
  fs.writeFileSync(file, "{}");
  const order = [];
  const job = (name, ms) => withUserConfigLock(file, async () => { order.push(`${name}:in`); await sleep(ms); order.push(`${name}:out`); return name; });
  assert.deepEqual(await Promise.all([job("a", 300), job("b", 50), job("c", 10)]), ["a", "b", "c"]);
  for (let index = 0; index < order.length; index += 2) assert.equal(order[index].split(":")[0], order[index + 1].split(":")[0], `重ならない: ${order.join(" ")}`);
  assert.equal(fs.existsSync(`${file}.aiterm-lock`), false, "終わったら鍵を残さない");
  // 誤りで抜けても鍵を残さない。
  await assert.rejects(withUserConfigLock(file, async () => { throw new Error("途中で失敗"); }), /途中で失敗/u);
  assert.equal(fs.existsSync(`${file}.aiterm-lock`), false);
  // 落ちたprocessが残した鍵（2分より古い）は引き取る。
  fs.mkdirSync(`${file}.aiterm-lock`);
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(`${file}.aiterm-lock`, old, old);
  assert.equal(await withUserConfigLock(file, async () => "taken"), "taken");
  // 設定fileの置き場が無い時は、鍵なしで通す。
  assert.equal(await withUserConfigLock(path.join(base, "no-such-dir", "x.json"), async () => "ok"), "ok");
});

// ---------- 模したClaude Codeの席で、/fast の道を通す（本物の on は usage credits が要り、試せない）

const hasTmux = process.platform !== "win32" && spawnSync("tmux", ["-V"]).status === 0;
const ptySkip = hasTmux ? false : "POSIX模擬CLIのPTY試験にはtmuxが必要";
const userSettings = path.join(claudeConfig, "settings.json");
const ORIGINAL_SETTINGS = '{\n  "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "true", "asyncRewake": true, "timeout": 86400}]}]},\n  "theme": "dark"\n}\n';

// 模したClaude Code。`-p` の initialize へは一覧とfastの可否を答える。席では `/fast on`・`/fast off` を、実物の作り
// （利用者の設定へ fastMode を書く／消す。書く時に項目の並びが変わる。結果を1行で出す）で動かす。
async function withFastClaude(options, run) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(base, "pty-")));
  const inputFile = path.join(dir, "input.jsonl");
  const bin = path.join(dir, "claude.sh");
  fs.mkdirSync(path.join(dir, "bin"));
  const driver = path.join(dir, "bin", "claude");
  fs.writeFileSync(inputFile, "");
  fs.writeFileSync(userSettings, ORIGINAL_SETTINGS, { mode: 0o600 });
  fs.writeFileSync(bin, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(driver)} "$@"\n`, { mode: 0o700 });
  fs.writeFileSync(driver, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const options = ${JSON.stringify(options)};
const settingsFile = ${JSON.stringify(userSettings)};
if (args[0] === "auth" && args[1] === "status" && args[2] === "--json") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" }));
  process.exit(0);
}
if (args.includes("-p")) {
  // 一覧の問い合わせ（initialize）。席ごとの設定へ fastMode: true を付けて聞かれた時だけ、アカウントの可否を答える。
  const asked = JSON.parse(fs.readFileSync(args[args.indexOf("--settings") + 1], "utf8"));
  let input = "";
  process.stdin.on("data", (chunk) => {
    input += chunk;
    if (!input.includes("\\n")) return;
    const request = JSON.parse(input.split("\\n")[0]);
    const model = (value, resolvedModel, displayName, fast) => ({ value, resolvedModel, displayName, supportsEffort: true, supportedEffortLevels: ["low", "high"], ...(fast ? { supportsFastMode: true } : {}) });
    console.log(JSON.stringify({ type: "control_response", response: { request_id: request.request_id, subtype: "success", response: {
      models: [model("default", "claude-opus-5-5", "Default (recommended)", true), model("opus", "claude-opus-5-5", "Opus 5.5", true), model("haiku", "claude-haiku-5-5", "Haiku 5.5", false)],
      fast_mode_state: "off",
      fast_mode_disabled_reason: asked.fastMode === true ? (options.unavailable ? "extra_usage_disabled" : null) : "sdk_opt_in_required",
    } } }));
    process.exit(0);
  });
  return;
}
// 席。起動時に渡された設定（--settings）を控える。
fs.writeFileSync(${JSON.stringify(path.join(dir, "seat-settings.json"))}, fs.readFileSync(args[args.indexOf("--settings") + 1], "utf8"));
const rule = "─".repeat(60);
let line = "", log = [], fast = false;
const render = (lines) => process.stdout.write("\\x1b[H" + lines.map(l => l + "\\x1b[K").join("\\n") + "\\n\\x1b[J");
const draw = () => render(["Claude Code v2.1.296", ...log.slice(-10), rule, "❯ " + line, rule, "  ⏵⏵ bypass permissions on (shift+tab to cycle)" + (fast ? " \\u21AF" : "")]);
// 実物は、書く時に設定を組み立て直す（hookの中の項目の並びが入れ替わる）。
const rewrite = (change) => {
  const now = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  const reordered = JSON.parse(JSON.stringify(now), (key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value);
  change(reordered);
  fs.writeFileSync(settingsFile, JSON.stringify(reordered, null, 2) + "\\n");
};
process.stdout.write("\\x1b[?1049h");
process.stdin.setRawMode(true);
process.stdin.resume();
draw();
process.stdin.on("data", (chunk) => {
  const key = chunk.toString("utf8");
  fs.appendFileSync(${JSON.stringify(inputFile)}, JSON.stringify(key) + "\\n");
  for (const ch of key.replace(/\\x1b\\[20[01]~/g, "")) {
    if (ch !== "\\r") { if (ch >= " ") line += ch; continue; }
    const text = line; line = "";
    log.push("❯ " + text);
    if (text === "/fast on") {
      if (options.refuseAtCommand) { log.push("  ⎿  Fast mode unavailable: Fast mode requires usage credits · /usage-credits to"); log.push("     turn them on"); }
      else { rewrite((settings) => { settings.fastMode = true; }); fast = true; log.push("  ⎿  \\u21AF Fast mode ON · $8/$40 per Mtok"); }
    } else if (text === "/fast off") {
      rewrite((settings) => { delete settings.fastMode; }); fast = false; log.push("  ⎿  Fast mode OFF");
    } else log.push("  ⎿  PROMPT:" + text);
  }
  draw();
});
`, { mode: 0o700 });
  const savedBin = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = bin;
  let sid;
  try {
    [sid] = core.openAgent("claude", { agent_done: true, cwd: dir, model: options.model ?? "opus" });
    await core.readOutput(sid, { wait: true, until: "bypass permissions", timeout: 5, raw: true });
    const keys = () => fs.readFileSync(inputFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse).join("").replace(/\x1b\[20[01]~/g, "").replace(/\r/g, "⏎");
    await run({ sid, keys, seatSettings: () => JSON.parse(fs.readFileSync(path.join(dir, "seat-settings.json"), "utf8")) });
  } finally {
    if (sid) { try { core.closeSession(sid); } catch {} }
    if (savedBin === undefined) delete process.env.CLAUDE_BIN; else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const configured = (sid, fast, model = null) => ({
  schema: "aiterm.agent-configure-result.v1", session_id: sid, provider: "claude", harness: "claude-code", model, reasoning_effort: null, fast,
});

test("Claude Codeの席: 通常の速度で起こし、/fast on・off で切り替え、利用者の設定は切り替えの前の中身へ戻す", { skip: ptySkip }, async () => {
  await withFastClaude({}, async ({ sid, keys, seatSettings }) => {
    assert.equal(seatSettings().fastMode, false, "席ごとの設定で通常の速度を明示する（共有の設定に残った値で始めない）");
    // もう通常の速度の席へ false: 何も打たない（/fast off は、もう off でも利用者の設定を書き直す）。
    assert.deepEqual(await core.configureAgent(sid, { fast: false }), configured(sid, false));
    assert.equal(keys(), "");
    assert.deepEqual(await core.configureAgent(sid, { fast: true }), configured(sid, true));
    assert.equal(keys(), "/fast on⏎");
    assert.equal(fs.readFileSync(userSettings, "utf8"), ORIGINAL_SETTINGS, "Claude Codeが書いた fastMode と並びの入れ替えを、前の中身へ戻す");
    assert.equal(fs.existsSync(`${userSettings}.aiterm-lock`), false);
    assert.deepEqual(await core.configureAgent(sid, { fast: false }), configured(sid, false));
    assert.equal(keys(), "/fast on⏎/fast off⏎");
    assert.equal(fs.readFileSync(userSettings, "utf8"), ORIGINAL_SETTINGS);
    assert.equal(core.observeSession(sid).state, "idle");
  });
});

test("Claude Codeの席: アカウントで使えない時・対応していないmodelは、何も打たずに断る", { skip: ptySkip }, async () => {
  await withFastClaude({ unavailable: true }, async ({ sid, keys }) => {
    await assert.rejects(core.configureAgent(sid, { fast: true }), /^.*FAST_MODE_UNAVAILABLE: .*extra_usage_disabled.*設定は変えていません。$/su);
    assert.equal(keys(), "", "使えないと分かっている時は /fast on を打たない");
    assert.equal(fs.readFileSync(userSettings, "utf8"), ORIGINAL_SETTINGS);
  });
  await withFastClaude({ model: "haiku" }, async ({ sid, keys }) => {
    // 対応していないmodelで /fast on を打つと、Claude Codeは勝手にOpusへ替える。打つ前に断る。
    await assert.rejects(core.configureAgent(sid, { fast: true }), /FAST_MODE_NOT_SUPPORTED: Claude Code の haiku はfastに対応していません/u);
    assert.equal(keys(), "");
  });
});

test("Claude Codeの席: 一覧では使えるのに /fast on が断られた時は、その行を添えて断る", { skip: ptySkip }, async () => {
  await withFastClaude({ refuseAtCommand: true }, async ({ sid, keys }) => {
    await assert.rejects(core.configureAgent(sid, { fast: true }),
      /FAST_MODE_UNAVAILABLE: Claude Code: Fast mode unavailable: Fast mode requires usage credits · \/usage-credits to turn them on。席の速度は変えていません。/u);
    assert.equal(keys(), "/fast on⏎");
    assert.equal(fs.readFileSync(userSettings, "utf8"), ORIGINAL_SETTINGS);
    assert.equal(core.observeSession(sid).state, "idle");
  });
});

test("fast版のIDと fast: false の食い違いは、席に触る前に断る", { skip: ptySkip }, async () => {
  await withFastClaude({}, async ({ sid, keys }) => {
    // 何も指定しない設定替えは、fastを足した今の文で断る。
    await assert.rejects(core.configureAgent(sid, {}), /model、reasoning_effort、fast のいずれかを指定してください/u);
    assert.equal(keys(), "");
  });
});

test("起動: fast版のIDと fast: false の食い違いは、席を作る前に断る", async () => {
  const sessions = () => core.listSessions();
  const before = sessions();
  await assert.rejects(core.openAgentWithInitialPrompt("cursor", { model: "composer-2.5-fast", fast: false }),
    /FAST_MODE_MODEL_CONFLICT: model=composer-2\.5-fast はfast版のIDですが、fast: false が渡されました。.*起動していません。/u);
  await assert.rejects(core.openAgentWithInitialPrompt("grok", { model: "grok-4.7-build-fast", fast: false }), /FAST_MODE_MODEL_CONFLICT/u);
  assert.equal(sessions(), before, "席を作っていない");
});

test("Codex: 足元のmodelの表示に fast と出ていれば読む（出ていない時は、通常とは言い切らない）", () => {
  // 本物のログインの席（0.162.1）。
  assert.equal(codex.codexFooterShowsFast("• Service tier set to priority\n› Ask Codex to do anything\n  GPT-5.6-Sol xhigh fast · ~/proj\n  ? for shortcuts"), true);
  assert.equal(codex.codexFooterShowsFast("› Ask Codex to do anything\n  GPT-5.6-Sol xhigh · ~/proj\n  ? for shortcuts"), null);
  // 独自のproviderの席は、fastでも足元に出さない。
  assert.equal(codex.codexFooterShowsFast("• Service tier set to priority\n› Ask Codex to do anything\n  GPT-6.1-Sol default · /tmp/proj"), null);
  assert.equal(codex.codexFooterShowsFast("› please be fast · thanks\n  GPT-6.1-Sol default · /tmp/proj"), null, "入力欄の文は足元でない");
});

test("JSONの設定: 複数の項目をまとめて戻す（Cursorの既定のmodelの項目）", () => {
  const file = path.join(base, "cli-config.json");
  const original = { version: 1, model: { modelId: "default", displayName: "Auto" }, selectedModel: { modelId: "default", parameters: [] },
    modelSelectionHistory: ["default"], modelParameters: { default: [] }, privacyCache: { updatedAt: 1 }, authInfo: { email: "a@example.com" } };
  const before = Buffer.from(JSON.stringify(original, null, 2));
  // Cursor（2026.10.01-14929f9）が、fastを入れたmodelの選択で書いた後。控えの時刻（privacyCache）も一緒に進む。
  fs.writeFileSync(file, JSON.stringify({ ...original, model: { modelId: "gpt-5.3-codex", displayName: "Codex 5.3 Low Fast" },
    selectedModel: { modelId: "gpt-5.3-codex", parameters: [{ id: "reasoning", value: "low" }, { id: "fast", value: "true" }] },
    modelSelectionHistory: ["gpt-5.3-codex", "default"], modelParameters: { default: [], "gpt-5.3-codex": [{ id: "fast", value: "true" }] },
    maxMode: false, hasChangedDefaultModel: true, privacyCache: { updatedAt: 2 } }, null, 2));
  assert.equal(restoreJsonSetting(file, before, cursor.CURSOR_DEFAULT_MODEL_KEYS), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { ...original, privacyCache: { updatedAt: 2 } },
    "modelの項目は前の値へ戻り（前に無かった項目は消える）、Cursorの控えの更新は残る");
  // modelの項目だけが変わっていた時は、前の中身をそのまま書き戻す。
  fs.writeFileSync(file, JSON.stringify({ ...original, selectedModel: { modelId: "x", parameters: [] } }));
  assert.equal(restoreJsonSetting(file, before, cursor.CURSOR_DEFAULT_MODEL_KEYS), true);
  assert.equal(fs.readFileSync(file, "utf8"), before.toString("utf8"));
});

test("一覧: Claude Codeが「fastの可否を確かめている最中」と答えた時を見分ける（聞き直すため）", () => {
  assert.equal(claude.claudeFastStatePending(claudeInitialize("pending"), "r1"), true);
  assert.equal(claude.claudeFastStatePending(claudeInitialize("extra_usage_disabled"), "r1"), false);
  assert.equal(claude.claudeFastStatePending(claudeInitialize(undefined), "r1"), false);
  assert.equal(claude.claudeFastStatePending("not json\n", "r1"), false);
});

test("Codex: /model の選ぶ画面は表示名で並ぶ。一覧のIDを、大文字と小文字を問わずに行へ対応させる", () => {
  // 0.162.1の実物。
  const screen = ["  Select Model and Effort", "› 1. GPT-6.1-Sol (current)  Latest workhorse model for coding and everyday work.",
    "  2. GPT-6-Astra            Frontier intelligence for the most demanding work.", "  3. GPT-6-Sol              Previous generation workhorse model.",
    "  8. GPT-5.5                Legacy coding model.", "  enter select · esc back"].join("\n");
  assert.equal(codex.codexModelChoice(screen, "gpt-6.1-sol"), "1");
  assert.equal(codex.codexModelChoice(screen, "gpt-6-sol"), "3", "gpt-6.1-sol の行と取り違えない");
  assert.equal(codex.codexModelChoice(screen, "GPT-5.5"), "8");
  assert.equal(codex.codexModelChoice(screen, "gpt-9"), null);
});

test("Grok: 足元のmodelの表示の名前だけを読む（一覧を引かずに、今がfast版かを見るため）", () => {
  assert.equal(grok.grokFooterModelName("  ╰──────── Grok 4.7 Fast (high) ─╯\n  Shift+Tab:mode"), "Grok 4.7 Fast");
  assert.equal(grok.grokFooterModelName("  ╰──── Grok 4.6 (medium) · always-approve ─╯"), "Grok 4.6");
  assert.equal(grok.grokFooterModelName("   Switched to Grok 4.7 Fast (high effort)\n  │ ❯ │"), null);
});
