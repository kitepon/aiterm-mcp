import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

// Claude Code（2.1.293のLinuxと2.1.296のmacOSの実物 2026-10-12）は、`/model <名前>` と `/effort <値>` で選んだ値を
// 端末の ~/.claude/settings.json へ新しい会話の既定として保存する。引数なしの `/model` の選ぶ画面で s を押すと保存しない。
// 画面の文は、その実物から写した。
const base = fs.mkdtempSync(path.join(os.tmpdir(), "acs-"));
process.env.TMPDIR = base;
process.env.XDG_RUNTIME_DIR = base;
const claude = await import("../dist/harnesses/claude.js");
const core = await import("../dist/core.js");
core.__testSetAgentTuiReadyStableSamples(1);
after(() => fs.rmSync(base, { recursive: true, force: true }));

const head = [
  "❯ /model",
  "────────────────────────────────────────────────────────────────────────────────",
  "  Select model",
  "  Switch between Claude models. Your pick becomes the default for new",
  "  sessions. For other/previous model names, specify with --model.",
].join("\n");
const foot = "  Enter to set as default · s to use this session only · Esc to cancel";
// Linux 2.1.293、開いた直後。
const opened = `${head}
  ❯ 1.  Default (recommended) ✔  Opus 5.5 · Best for everyday, complex tasks
    2.  Opus 5.5                 For complex work and everyday tasks
    3.  Fable 5.1                For your toughest challenges
    4.  Sonnet 5.5               Most efficient for simpler tasks
  ↓ 5.  Haiku 5.5                Fastest for quick answers
     … +8 models
  ● High effort ←/→ to adjust
${foot}`;
// macOS 2.1.296（全画面の表示）、既定がSonnetの席。
const macOpened = ` ▐▛███▛█   Claude Code v2.1.296
▝▜██████▀  Sonnet 5.5 · Claude Pro
▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ ◐ medium · /effort ▔
   Select model
   Switch between Claude models. Your pick becomes the default for new
   sessions. For other/previous model names, specify with --model.
   ↑ 2.  Opus 5.5               For complex work and everyday tasks
     3.  Fable 5.1              For your toughest challenges
   ❯ 4.  Sonnet 5.5 ✔           Most efficient for simpler tasks
      … +9 models
   ◐ Medium effort (default) ←/→ to adjust
   Enter to set as default · s to use this session only · Esc to cancel`;
const confirm = `❯ /model
────────────────────────────────────────────────────────────────────────────────
  Switch model?
  Your next response will be slower and use more tokens
  This conversation is cached for the current model. Switching to Opus 5.5
  means the full history gets re-read on your next message.
  ❯ 1. Yes, switch to Opus 5.5
    2. No, go back`;
const composer = `────────────────────────────────────────────────────────────────────────────────
❯
────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents`;

test("選ぶ画面: 行・今の行・今のmodel・effort・「この会話だけ」の有無を読む", () => {
  assert.deepEqual(claude.claudeModelPicker(opened), {
    rows: [
      { index: 1, label: "Default (recommended)", cursor: true, current: true },
      { index: 2, label: "Opus 5.5", cursor: false, current: false },
      { index: 3, label: "Fable 5.1", cursor: false, current: false },
      { index: 4, label: "Sonnet 5.5", cursor: false, current: false },
      { index: 5, label: "Haiku 5.5", cursor: false, current: false },
    ],
    effort: "high",
    session_only: true,
  });
  const mac = claude.claudeModelPicker(macOpened);
  assert.deepEqual(mac.rows, [
    { index: 2, label: "Opus 5.5", cursor: false, current: false },
    { index: 3, label: "Fable 5.1", cursor: false, current: false },
    { index: 4, label: "Sonnet 5.5", cursor: true, current: true },
  ]);
  assert.equal(mac.effort, "medium");
  // effortの段と、effortに対応しない行。
  for (const [line, effort] of [["○ Low effort ←/→ to adjust", "low"], ["◉ xHigh effort ←/→ to adjust", "xhigh"],
    ["◈ Max effort ←/→ to adjust\n  May use excessive tokens resulting in long response times or overthinking.", "max"],
    ["○ Effort not supported for Haiku 4.5", null]]) {
    assert.equal(claude.claudeModelPicker(opened.replace("● High effort ←/→ to adjust", line)).effort, effort, line);
  }
  // 保存する選び方しか無い画面（sの案内が無い）。
  assert.equal(claude.claudeModelPicker(opened.replace(foot, "  Enter to confirm · Esc to cancel")).session_only, false);
  // 選ぶ画面でない物は拾わない。
  assert.equal(claude.claudeModelPicker(composer), null);
  assert.equal(claude.claudeModelPicker(confirm), null);
  assert.equal(claude.claudeModelPicker("  Select model\n  ❯ 1.  Default (recommended) ✔  Opus 5.5"), null);
});

test("選ぶ行: catalogのID・別名・表示名を、画面の行へ対応させる", () => {
  const rows = ["Default (recommended)", "Opus 5.5", "Fable 5.1", "Sonnet 5.5", "Haiku 5.5", "Haiku 4.5", "Sonnet 5", "Opus 5",
    "Fable 5", "Opus 4.8", "Opus 4.7", "Opus 4.6", "Sonnet 4.6"].map((label, i) => ({ index: i + 1, label, cursor: false, current: false }));
  const pick = (model) => claude.claudeModelPickerRow([...rows].reverse(), model)?.index ?? null;
  assert.equal(pick("claude-opus-5-5"), 2);
  assert.equal(pick("opus"), 2, "別名は、その系統で番号が一番若い行");
  assert.equal(pick("Opus 5.5"), 2);
  assert.equal(pick("default"), 1);
  assert.equal(pick("sonnet"), 4);
  assert.equal(pick("claude-sonnet-5"), 7, "Sonnet 5 を Sonnet 5.5 と取り違えない");
  assert.equal(pick("claude-haiku-4-5-20251001"), 6);
  assert.equal(pick("claude-sonnet-4-6"), 13);
  assert.equal(pick("fable"), 3);
  assert.equal(pick("claude-opus-9-9"), null);
  assert.equal(pick("opus[1m]"), null);
  assert.equal(pick("gpt-5.6-sol"), null);
});

test("切り替えの確かめと、閉じた後の知らせを読む", () => {
  assert.equal(claude.claudeModelSwitchConfirm(confirm), "yes_selected");
  assert.equal(claude.claudeModelSwitchConfirm(confirm.replace("  ❯ 1. Yes", "    1. Yes").replace("    2. No", "  ❯ 2. No")), "other_selected");
  assert.equal(claude.claudeModelSwitchConfirm(opened), null);
  const result = (line) => claude.claudeModelSwitchResult(`❯ /model\n  ⎿  ${line}\n${composer}`);
  assert.deepEqual(result("Set model to Opus 5.5 for this session only with high effort"),
    { scope: "session_only", line: "Set model to Opus 5.5 for this session only with high effort" });
  assert.equal(result("Set model to Opus 5.5 (default) for this session only with medium effort").scope, "session_only");
  assert.equal(result("Set model to Opus 5.5 and saved as your default for new sessions").scope, "saved_as_default");
  assert.equal(result("Kept model as Sonnet 5.5").scope, "kept");
  assert.equal(result("Model switch to Opus 5.5 was blocked by a PreModelSwitch hook: no").scope, "blocked");
  // 折り返した知らせも1件として読む。
  assert.equal(claude.claudeModelSwitchResult(`❯ /model\n  ⎿  Set model to Opus 5.5 (default) for this\n     session only with medium effort\n${composer}`).scope, "session_only");
  // 前の `/model` の知らせを、今回の物として読まない（今回の `/model` の下に、まだ知らせが無い）。
  assert.equal(claude.claudeModelSwitchResult(`❯ /model\n  ⎿  Set model to Haiku 5.5 for this session only with low effort\n❯ /model\n${composer}`), null);
  assert.equal(claude.claudeModelSwitchResult(composer), null);
});

const hasTmux = process.platform !== "win32" && spawnSync("tmux", ["-V"]).status === 0;
const ptySkip = hasTmux ? false : "POSIX模擬CLIのPTY試験にはtmuxが必要";

// 模擬のClaude Code。`/model` で実物と同じ選ぶ画面を出す。Enterは「既定として保存」（savedのfileを書く）、sは「この会話だけ」。
async function withPickerClaude(options, run) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(base, "pty-")));
  const inputFile = path.join(dir, "input.jsonl");
  const saved = path.join(dir, "saved-as-default");
  const bin = path.join(dir, "claude.sh");
  fs.mkdirSync(path.join(dir, "bin"));
  // 実体の名前はclaudeにする（Aitermはpane内のprocess名でharnessの生存を見る）。
  const driver = path.join(dir, "bin", "claude");
  fs.writeFileSync(inputFile, "");
  fs.writeFileSync(bin, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(driver)} "$@"\n`, { mode: 0o700 });
  fs.writeFileSync(driver, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "auth" && args[1] === "status" && args[2] === "--json") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" }));
  process.exit(0);
}
fs.writeFileSync(${JSON.stringify(path.join(dir, "session-id"))}, args[args.indexOf("--session-id") + 1] ?? "");
const options = ${JSON.stringify(options)};
const ALL = ["low", "medium", "high", "xhigh", "max"];
const rows = [["Default (recommended)", ALL], ["Opus 5.5", ALL], ["Fable 5.1", ALL], ["Sonnet 5.5", ALL], ["Haiku 5.5", ALL], ["Haiku 4.5", []],
  ["Sonnet 5", ALL], ["Opus 5", ALL], ["Fable 5", ALL], ["Opus 4.8", ALL], ["Opus 4.7", ALL],
  ["Opus 4.6", ["low", "medium", "high", "max"]], ["Sonnet 4.6", ["low", "medium", "high", "max"]]];
const label = { low: "Low", medium: "Medium", high: "High", xhigh: "xHigh", max: "Max" };
const rule = "─".repeat(60);
let mode = "composer", line = "", log = [], current = 3, cursor = 3, effort = "medium", picked = "medium", dropped = false;
// 本物と同じく、同じ場所へ描き直す（画面を消して送ると、前の表示が端末の履歴に残る）。
const render = (lines) => process.stdout.write("\\x1b[H" + lines.map(l => l + "\\x1b[K").join("\\n") + "\\n\\x1b[J");
const supported = () => rows[cursor][1];
// そのmodelに無い段は、1つ下の段で見せる。
const shown = () => { const list = supported(); return list.length === 0 ? null : list.includes(picked) ? picked : [...list].reverse().find(l => ALL.indexOf(l) < ALL.indexOf(picked)) ?? list[0]; };
function draw() {
  const top = ["Claude Code v2.1.296", ...log.slice(-8)];
  if (mode === "composer") return render([...top, rule, "❯ " + line, rule, "  ⏵⏵ bypass permissions on (shift+tab to cycle)"]);
  if (mode === "confirm") return render([...top, rule, "  Switch model?", "  Your next response will be slower and use more tokens",
    "  This conversation is cached for the current model. Switching to " + rows[cursor][0],
    "  means the full history gets re-read on your next message.", "  ❯ 1. Yes, switch to " + rows[cursor][0], "    2. No, go back"]);
  const start = Math.max(0, Math.min(cursor - 1, rows.length - 3));
  const view = rows.slice(start, start + 3).map(([name], i) => {
    const at = start + i;
    const mark = at === cursor ? "❯" : i === 0 && start > 0 ? "↑" : i === 2 && start + 3 < rows.length ? "↓" : " ";
    return "  " + mark + " " + String(at + 1) + ".  " + (name + (at === current ? " ✔" : "")).padEnd(24) + "  For some kind of work";
  });
  const level = shown();
  render([...top, rule, options.newLayout ? "  Choose a model" : "  Select model", "  Switch between Claude models. Your pick becomes the default for new",
    "  sessions. For other/previous model names, specify with --model.", ...view, "     … +" + (rows.length - 3) + " models",
    level ? "  ◐ " + label[level] + " effort" + (level === "medium" ? " (default)" : "") + " ←/→ to adjust" : "  ○ Effort not supported for " + rows[cursor][0],
    options.noSessionOnly ? "  Enter to confirm · Esc to cancel" : "  Enter to set as default · s to use this session only · Esc to cancel"]);
}
function apply(scope) {
  current = cursor; effort = shown() ?? effort;
  if (scope === "saved") fs.writeFileSync(${JSON.stringify(saved)}, rows[cursor][0] + " " + effort);
  log.push("  ⎿  Set model to " + rows[cursor][0] + (scope === "saved" ? " and saved as your default for new sessions" : " for this session only" + (shown() ? " with " + effort + " effort" : "")));
  mode = "composer";
}
// 全画面の表示（別の画面）へ移る。起動コマンドの折り返しの印が残った行へ重ねて描くと、端末が行をつなげて読む。
process.stdout.write("\\x1b[?1049h");
process.stdin.setRawMode(true);
process.stdin.resume();
draw();
process.stdin.on("data", (chunk) => {
  const key = chunk.toString("utf8");
  fs.appendFileSync(${JSON.stringify(inputFile)}, JSON.stringify(key) + "\\n");
  if (mode === "composer") {
    for (const ch of key.replace(/\\x1b\\[20[01]~/g, "")) {
      if (ch !== "\\r") { if (ch >= " ") line += ch; continue; }
      const text = line; line = "";
      log.push("❯ " + text);
      if (text === "/model") { mode = "picker"; cursor = current; picked = effort; }
      else if (text.startsWith("/effort ")) log.push("  ⎿  Ultracode on (this session only): workflows");
      else log.push("  ⎿  PROMPT:" + text);
    }
    return draw();
  }
  if (mode === "confirm") {
    if (key === "\\r") apply("session"); else if (key === "\\x1b") mode = "picker";
    return draw();
  }
  const arrow = /^\\x1b[\\[O]([ABCD])$/.exec(key)?.[1];
  if (arrow && options.dropFirstKey && !dropped) { dropped = true; return; }
  if (arrow === "B") cursor = (cursor + 1) % rows.length;
  else if (arrow === "A") cursor = (cursor + rows.length - 1) % rows.length;
  else if (arrow === "C" || arrow === "D") {
    const list = supported(), at = list.indexOf(shown());
    if (at >= 0) picked = list[Math.max(0, Math.min(list.length - 1, at + (arrow === "C" ? 1 : -1)))];
  }
  else if (key === "s" && !options.noSessionOnly) { if (options.cached && cursor !== current) mode = "confirm"; else apply("session"); }
  else if (key === "\\r") apply("saved");
  else if (key === "\\x1b") { log.push("  ⎿  Kept model as " + rows[current][0]); mode = "composer"; }
  draw();
});
`, { mode: 0o700 });
  const savedBin = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = bin;
  let sid;
  try {
    [sid] = core.openAgent("claude", { agent_done: true, cwd: dir });
    await core.readOutput(sid, { wait: true, until: "bypass permissions", timeout: 5, raw: true });
    const keys = () => fs.readFileSync(inputFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse).join("")
      .replace(/\x1b\[20[01]~/g, "").replace(/\x1b[[O]A/g, "↑").replace(/\x1b[[O]B/g, "↓").replace(/\x1b[[O]C/g, "→").replace(/\x1b[[O]D/g, "←").replace(/\x1b/g, "⎋").replace(/\r/g, "⏎");
    const screen = async () => (await core.readOutput(sid, { screen: true, raw: true })).replace(/[ \t]+$/gmu, "");
    await run({ sid, keys, screen, saved: () => fs.existsSync(saved), launchedSessionId: () => fs.readFileSync(path.join(dir, "session-id"), "utf8") });
  } finally {
    if (sid) { try { core.closeSession(sid); } catch {} }
    if (savedBin === undefined) delete process.env.CLAUDE_BIN; else process.env.CLAUDE_BIN = savedBin;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const done = (sid, model, reasoning_effort) => ({
  schema: "aiterm.agent-configure-result.v1", session_id: sid, provider: "claude", harness: "claude-code", model, reasoning_effort,
});

test("agent_configure: Claude Codeの席は、選ぶ画面の s（この会話だけ）で替え、既定として保存しない", { skip: ptySkip }, async () => {
  await withPickerClaude({}, async ({ sid, keys, screen, saved }) => {
    // 今はSonnet 5.5（4行目）・medium。IDで渡したOpus 5.5（2行目）をhighで選ぶ。
    assert.deepEqual(await core.configureAgent(sid, { model: "claude-opus-5-5", reasoning_effort: "high" }), done(sid, "claude-opus-5-5", "high"));
    assert.equal(saved(), false, "Enter（既定として保存）を押していない");
    assert.match(await screen(), /Set model to Opus 5\.5 for this session only with high effort/u);
    // 一周して行を集め（下へ13回）、2行目へ戻り（上へ2回）、effortを1段上げ、s。`/model <名前>` も `/effort` も打たない。
    assert.equal(keys(), `/model⏎${"↓".repeat(13)}↑↑→s`);
    assert.equal(core.observeSession(sid).state, "idle");

    // effortだけ: 今のmodelの行のまま、effortを変えて s。
    assert.deepEqual(await core.configureAgent(sid, { reasoning_effort: "low" }), done(sid, null, "low"));
    assert.match(await screen(), /Set model to Opus 5\.5 for this session only with low effort/u);
    assert.ok(keys().endsWith("/model⏎←←s"), keys());

    // modelだけ（別名）: effortは触らない。見えていない行（13行目）も選べる。
    assert.deepEqual(await core.configureAgent(sid, { model: "claude-sonnet-4-6" }), done(sid, "claude-sonnet-4-6", null));
    assert.match(await screen(), /Set model to Sonnet 4\.6 for this session only with low effort/u);
    assert.deepEqual(await core.configureAgent(sid, { model: "opus" }), done(sid, "opus", null));
    assert.match(await screen(), /Set model to Opus 5\.5 for this session only with low effort/u);
    assert.equal(saved(), false);
    assert.equal(/\/model \S|\/effort/u.test(keys()), false, keys());
  });
});

test("agent_configure: 会話がcacheされている席では、切り替えの確かめを1番で進める。キーが1つ落ちても選べる", { skip: ptySkip }, async () => {
  await withPickerClaude({ cached: true, dropFirstKey: true }, async ({ sid, keys, screen, saved }) => {
    assert.deepEqual(await core.configureAgent(sid, { model: "opus", reasoning_effort: "xhigh" }), done(sid, "opus", "xhigh"));
    assert.match(await screen(), /Set model to Opus 5\.5 for this session only with xhigh effort/u);
    assert.equal(saved(), false);
    assert.ok(keys().endsWith("→→s⏎"), keys());
    assert.equal(core.observeSession(sid).state, "idle");
  });
});

test("agent_configure: 選べない時は、選ぶ画面をEscで閉じて、何も変えずに断る", { skip: ptySkip }, async () => {
  await withPickerClaude({}, async ({ sid, keys, screen, saved }) => {
    const refused = async (opts, pattern) => {
      await assert.rejects(core.configureAgent(sid, opts), pattern);
      assert.equal(saved(), false);
      assert.ok(keys().endsWith("⎋"), keys());
      assert.equal(core.observeSession(sid).state, "idle", "選ぶ画面を閉じて入力待ちへ戻す");
      const now = await screen();
      assert.match(now, /Kept model as Sonnet 5\.5\n[\s\S]*$/u);
      assert.doesNotMatch(now, /Set model to/u);
    };
    // 選ぶ画面に無い機種。
    await refused({ model: "claude-opus-9-9" }, /CLAUDE_MODEL_NOT_IN_PICKER vendor=claude[\s\S]*claude-opus-9-9 がありません（選べる機種: Default \(recommended\), Opus 5\.5,[\s\S]*modelとreasoning_effortは変えていません。/u);
    // effortに対応しない機種と、その機種に無い段。
    await refused({ model: "claude-haiku-4-5-20251001", reasoning_effort: "high" }, /CLAUDE_EFFORT_NOT_SELECTABLE[\s\S]*Haiku 4\.5 では reasoning_effort を選べません。modelとreasoning_effortは変えていません。/u);
    await refused({ model: "claude-opus-4-6", reasoning_effort: "xhigh" }, /CLAUDE_EFFORT_NOT_SELECTABLE[\s\S]*Opus 4\.6 では reasoning_effort=xhigh を選べません/u);
    // 知らない値は、画面を開く前に断る。
    await assert.rejects(core.configureAgent(sid, { reasoning_effort: "impossible" }), /low\/medium\/high\/xhigh\/max\/ultracode のいずれかです。設定は変えていません。/u);
    assert.equal(/\/effort/u.test(keys()), false);
  });
});

test("agent_configure: 「この会話だけ」の選び方が無いClaude Codeでは、既定を書き換える選び方へ落ちずに断る", { skip: ptySkip }, async () => {
  await withPickerClaude({ noSessionOnly: true }, async ({ sid, keys, saved }) => {
    await assert.rejects(core.configureAgent(sid, { model: "opus", reasoning_effort: "high" }),
      /CLAUDE_MODEL_SESSION_ONLY_UNAVAILABLE vendor=claude[\s\S]*端末の既定を書き換える選び方は使いません。modelとreasoning_effortは変えていません。/u);
    assert.equal(saved(), false);
    assert.equal(keys(), "/model⏎⎋");
    assert.equal(core.observeSession(sid).state, "idle");
  });
});

test("agent_configure: 選ぶ画面の形が変わって読めない時は、開いた画面をEscで閉じてから断る（席を塞がない）", { skip: ptySkip }, async () => {
  await withPickerClaude({ newLayout: true }, async ({ sid, keys, saved }) => {
    await assert.rejects(core.configureAgent(sid, { model: "opus", reasoning_effort: "high" }),
      /CLAUDE_MODEL_PICKER_NOT_SHOWN vendor=claude session=\S+ state=idle\/composer_ready\n[\s\S]*modelとreasoning_effortは変えていません。/u);
    assert.equal(saved(), false);
    assert.equal(keys(), "/model⏎⎋");
    assert.equal(core.observeSession(sid).state, "idle");
  });
});

test("pty_list: Claude Codeの席は、起動時に--session-idで渡した会話IDを構造の返りにも載せる", { skip: ptySkip }, async () => {
  await withPickerClaude({}, async ({ sid, launchedSessionId }) => {
    const listed = core.listSessionsResult().sessions.find((session) => session.session_id === sid);
    assert.equal(listed.harness, "claude-code");
    assert.match(listed.vendor_session_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    assert.equal(listed.vendor_session_id, launchedSessionId());
    assert.ok(core.listSessions().includes(`vendor_session_id=${listed.vendor_session_id}`), "文字の返りと同じ値");
  });
});

test("agent_configure: ultracodeはClaude Codeのsession設定なので、今までどおり /effort で送る", { skip: ptySkip }, async () => {
  await withPickerClaude({}, async ({ sid, keys, saved }) => {
    assert.deepEqual(await core.configureAgent(sid, { reasoning_effort: "ultracode" }), done(sid, null, "ultracode"));
    assert.equal(keys(), "/effort ultracode⏎");
    assert.equal(saved(), false);
  });
});
