// core.ts の純粋関数（tmux 非依存）の回帰テスト: stripControl / reduceOutput。
import { test } from "node:test";
import assert from "node:assert/strict";
import * as core from "../dist/core.js";
import * as claudeHarness from "../dist/harnesses/claude.js";
import * as grokHarness from "../dist/harnesses/grok.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("factory diagnostics: PTY server不在はnot_applicableかつ件数null", () => {
  const diagnostic = core.readOnlyPtyListDiagnostic(() => ({
    code: 1,
    stdout: "",
    stderr: "no server running on /tmp/aiterm.sock",
  }));
  assert.deepEqual(diagnostic, { status: "not_applicable", session_count: null });
});

test("factory diagnostics: PTY一覧成功時だけ件数を公開", () => {
  const diagnostic = core.readOnlyPtyListDiagnostic(() => ({
    code: 0,
    stdout: "one\ntwo\n",
    stderr: "",
  }));
  assert.deepEqual(diagnostic, { status: "ready", session_count: 2 });
});

// ---------------------------------------------------------------- utf8SafeEnd（B3: マルチバイト境界）
test("utf8SafeEnd: 不完全な UTF-8 末尾を文字境界まで戻す", () => {
  const s = Buffer.from("あい", "utf8"); // 6 バイト（3+3）
  assert.equal(core.utf8SafeEnd(s, 6), 6); // 完全
  assert.equal(core.utf8SafeEnd(s, 4), 3); // 「い」の途中(4)→「あ」の後(3)へ戻す
  assert.equal(core.utf8SafeEnd(s, 5), 3); // 同上
  assert.equal(core.utf8SafeEnd(s, 3), 3); // 「あ」の後は境界
  assert.equal(core.utf8SafeEnd(Buffer.from("abc"), 3), 3); // ASCII は常に境界
  assert.equal(core.utf8SafeEnd(Buffer.from("a😀", "utf8"), 3), 1); // 4バイト絵文字の途中→「a」の後へ
  assert.equal(core.utf8SafeEnd(Buffer.alloc(0), 0), 0);
});

// ---------------------------------------------------------------- stripControl
test("stripControl: ANSI/OSC/制御文字を除去、tab と改行は残す", () => {
  assert.equal(core.stripControl("\x1b[31mred\x1b[0m"), "red");
  assert.equal(core.stripControl("\x1b]0;title\x07body"), "body"); // OSC + BEL 終端
  assert.equal(core.stripControl("\x1bPq;data\x1b\\body"), "body"); // DCS + ST 終端（ペイロードごと除去・B10）
  assert.equal(core.stripControl("\x1b_APCpayload\x07body"), "body"); // APC + BEL 終端（B10）
  assert.equal(core.stripControl("a\x00b\x07c"), "abc"); // NUL/BEL 除去
  assert.equal(core.stripControl("col1\tcol2"), "col1\tcol2"); // tab 保持
});

test("stripControl: CRLF 正規化と行内 CR 上書きは最終状態だけ残す", () => {
  assert.equal(core.stripControl("a\r\nb"), "a\nb");
  assert.equal(core.stripControl("loading...\rdone"), "done"); // 進捗上書き
  assert.equal(core.stripControl("x   \ny\t\t"), "x\ny"); // 行末空白 rstrip
});

// ---------------------------------------------------------------- reduceOutput: dedup
test("reduceOutput: 同一行 N(>=3) 連続を 1 行＋件数に畳む", () => {
  const [body] = core.reduceOutput("a\na\na\na\na", "t1");
  assert.equal(body, "a  〈×5〉");
});
test("reduceOutput: 連続 2 行は畳まない（閾値 3）", () => {
  const [body] = core.reduceOutput("a\na\nb", "t1");
  assert.equal(body, "a\na\nb");
});

// ---------------------------------------------------------------- reduceOutput: 空行畳み
test("reduceOutput: 連続空行を 1 行に、前後の空行は除去", () => {
  const [body] = core.reduceOutput("\n\na\n\n\n\nb\n\n", "t1");
  assert.equal(body, "a\n\nb");
});

// ---------------------------------------------------------------- reduceOutput: elide（head+tail 折りたたみ）
test("reduceOutput: 60 行超は head30 + ヒント + tail20 に畳む", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line${i}`);
  const [body, meta] = core.reduceOutput(lines.join("\n"), "sess");
  const out = body.split("\n");
  assert.equal(out.length, 31 + 20); // head30 + hint(1) + tail20
  assert.equal(out[0], "line0");
  assert.equal(out[29], "line29");
  assert.equal(out[30], '… 〈50 行省略。全文は full=true、範囲は line_range="A:B"〉 …');
  assert.equal(out[31], "line80");
  assert.equal(out[50], "line99");
  assert.match(meta, /\[aiterm sess: 51 行 \/ ~\d+ tok \(raw 100 行 \/ ~\d+ tok\); 50 行 hidden\]/);
});

test("reduceOutput: elide=false なら折りたたまない", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `L${i}`);
  const [body] = core.reduceOutput(lines.join("\n"), "sess", false);
  assert.equal(body.split("\n").length, 100);
});

test("reduceOutput: 少数の巨大行は行数を保ったまま行内を省略する", () => {
  const lines = Array.from({ length: 3 }, (_, i) => `${i}${"x".repeat(100_000)}`);
  const [body] = core.reduceOutput(lines.join("\n"), "huge");
  const out = body.split("\n");
  assert.equal(out.length, 3);
  assert.ok(body.length < 10_000, `出力が有界: ${body.length}`);
  assert.equal((body.match(/行内 \d+ 文字省略/g) ?? []).length, 3);
  assert.ok(out.every((line, i) => line.startsWith(String(i))), "行順序を保つ");
});

test("reduceOutput: 行内省略はサロゲートペアとマルチバイト文字を分断しない", () => {
  const line = `${"a".repeat(1199)}😀あ${"b".repeat(2000)}`;
  const [body] = core.reduceOutput(line, "unicode");
  assert.ok(body.startsWith(`${"a".repeat(1199)}😀`));
  assert.ok(body.endsWith("b".repeat(600)));
  assert.doesNotMatch(body, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
});

test("reduceOutput: elide=false は巨大行もそのまま返し line_range の復元経路を保つ", () => {
  const line = "x".repeat(2001);
  const [body] = core.reduceOutput(line, "range", false);
  assert.equal(body, line);
});

test("reduceOutput: メタは raw 行数/トークン概算を併記", () => {
  const [, meta] = core.reduceOutput("a\nb\nc", "x");
  assert.match(meta, /^\[aiterm x: 3 行 \/ ~\d+ tok \(raw 3 行 \/ ~\d+ tok\)\]$/);
});

// ---------------------------------------------------------------- agent_done screen settle
test("agent_done screen settle: 不一致後に screen/log が一致すれば安定扱い", async () => {
  const r = await core.__testSettleAgentDoneScreen(
    [
      { screen: "old", logSize: 1 },
      { screen: "new", logSize: 2 },
      { screen: "new", logSize: 2 },
    ],
    { minDelayMs: 10, pollMs: 20, maxPolls: 5 },
  );
  assert.equal(r.unstable, false);
  assert.equal(r.samples, 3);
  assert.deepEqual(r.sleeps, [10, 20, 20]);
});

test("agent_done screen settle: 古い画面の一時的な一致だけでは早期安定扱いしない", async () => {
  const r = await core.__testSettleAgentDoneScreen(
    [
      { screen: "old", logSize: 1 },
      { screen: "old", logSize: 1 },
      { screen: "new", logSize: 2 },
      { screen: "new", logSize: 2 },
    ],
    { minDelayMs: 0, pollMs: 0, maxPolls: 5 },
  );
  assert.equal(r.unstable, false);
  assert.equal(r.samples, 4);
});

test("agent_done screen settle: 上限まで一致しなければ unstable", async () => {
  const r = await core.__testSettleAgentDoneScreen(
    [
      { screen: "a", logSize: 1 },
      { screen: "b", logSize: 2 },
      { screen: "c", logSize: 3 },
      { screen: "d", logSize: 4 },
    ],
    { minDelayMs: 0, pollMs: 0, maxPolls: 3 },
  );
  assert.equal(r.unstable, true);
  assert.equal(r.samples, 4);
});

// ---------------------------------------------------------------- agent_done TUI ready gate
test("agent_done ready gate: Claude/Codex/Grok/Composer の入力欄を判定する", () => {
  assert.equal(core.__testIsAgentTuiReady("claude", "Claude Code v2.1.211\n❯ "), true);
  assert.equal(core.__testIsAgentTuiReady("codex", "╭─╮\n│ >_ OpenAI Codex │\n› "), true);
  assert.equal(core.__testIsAgentTuiReady("grok", "Grok Build  0.2.87 Beta\n  │ ❯"), true);
  assert.equal(core.__testIsAgentTuiReady("composer", "Grok Build  0.2.87 Beta\n  │ ❯"), true);
  assert.equal(core.__testIsAgentTuiReady("grok", "2.7K / 500K\n│ ❯ │\nGrok 4.5 (high) · always-approve"), true);
  assert.equal(core.__testIsAgentTuiReady("composer", "2.7K / 500K\n│ ❯ │\nComposer 2.5 Fast · always-approve"), true);
  assert.equal(core.__testIsAgentTuiReady("codex", "OpenAI Codex\n◦ Starting MCP servers"), false);
  assert.equal(core.__testIsAgentTuiReady("grok", "Grok Build\nChangelog"), false);
  assert.equal(core.__testIsAgentTuiReady("claude", "Claude Code\nConnecting…"), false);
  // Windows native grok.exe 1.0.4（実測）は入力欄 marker を `>` で描画し、footer に model を出す。
  assert.equal(core.__testIsAgentTuiReady("grok", "│ >                │\n╰─── Grok 4.6 (high) ─╯\nGrok Build  1.0.4 [stable]"), true);
  assert.equal(core.__testIsAgentTuiReady("composer", "│ >                │\n╰─── Composer 2.5 Fast ─╯\nGrok Build  1.0.4 [stable]"), true);
});

test("agent_done ready gate: ready が連続安定するまで polling し、timeout なら false", async () => {
  const ok = await core.__testWaitAgentTuiReady(
    "codex",
    ["OpenAI Codex\n◦ Starting MCP servers", "OpenAI Codex\n› ", "OpenAI Codex\n› "],
    { timeoutMs: 100, pollMs: 10, stableSamples: 2 },
  );
  assert.equal(ok.ready, true);
  assert.equal(ok.samples, 3);
  assert.deepEqual(ok.sleeps, [10, 10]);

  const bad = await core.__testWaitAgentTuiReady("grok", ["Grok Build\nChangelog"], {
    timeoutMs: 0,
    pollMs: 10,
  });
  assert.equal(bad.ready, false);
  assert.equal(bad.samples, 1);
  assert.deepEqual(bad.sleeps, []);
});

test("agent_done ready gate: 既知の承認UIはtimeoutを待たずcallerへ返す", async () => {
  for (const [kind, screen] of [
    ["codex", "✨ Update available! 0.149.0 -> 0.150.1\n› 1. Update now"],
    ["codex", "Do you trust the contents of this directory?\n› 1. Yes, continue"],
    ["codex", "Hooks need review\n› 1. Review hooks"],
    ["claude", "2 new MCP servers found in this project\n[✔] room\nEnable selected"],
  ]) {
    const result = await core.__testWaitAgentTuiReady(kind, [screen], {
      timeoutMs: 60_000,
      pollMs: 1_000,
    });
    assert.equal(result.ready, false);
    assert.equal(result.samples, 1);
    assert.deepEqual(result.sleeps, []);
  }
});

test("agent_done ready gate: 非対話型のCodex更新通知は入力待ちを妨げない", async () => {
  const screen = [
    "✨ Update available! 0.151.0 -> 0.152.1",
    "Run npm install -g @openai/codex to update.",
    "OpenAI Codex (v0.151.0)",
    "› Ask Codex to do anything",
    "gpt-5.6-sol default · /tmp/project",
  ].join("\n");
  const result = await core.__testWaitAgentTuiReady("codex", [screen], {
    timeoutMs: 0,
    stableSamples: 1,
  });
  assert.equal(result.ready, true);
});

test("agent_done ready gate: Claude workspace trustの選択カーソルをcomposerと誤認しない", async () => {
  const trustScreen = [
    "Claude Code v2.1.251",
    "Accessing workspace:",
    "Is this a project you created or one you trust?",
    "Claude Code'll be able to read, edit, and execute files here.",
    "❯ No, exit",
    "  Yes, I trust this folder",
    "Enter to confirm · Esc to cancel",
  ].join("\n");
  assert.equal(core.__testIsAgentTuiReady("claude", trustScreen), false);
  assert.equal(core.__testIsAgentTuiIdleReady("claude", trustScreen), false);
  assert.equal(core.__testIsAgentTuiReady("claude", trustScreen.replace("❯ No, exit", "❯ 1. No, exit")), false);
  const blocked = await core.__testWaitAgentTuiReady("claude", [trustScreen], {
    timeoutMs: 60_000,
    pollMs: 1_000,
  });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.samples, 1);
  assert.deepEqual(blocked.sleeps, []);

  const currentComposer = `${trustScreen}\nClaude Code v2.1.251\n❯ \n[Fable 5]`;
  assert.equal(core.__testIsAgentTuiReady("claude", currentComposer), true);
});

test("agent_done ready gate: scrollbackの古い承認文言より現在のidle composerを優先する", async () => {
  const screen = "Hooks need review\n（過去の表示）\nOpenAI Codex\n› \ngpt-5.6-terra high · ~/repo";
  const result = await core.__testWaitAgentTuiReady("codex", [screen], {
    timeoutMs: 100,
    pollMs: 0,
    stableSamples: 1,
  });
  assert.equal(result.ready, true);
  assert.equal(result.samples, 1);
});

test("agent_done ready gate: 一瞬のready後に再初期化したらstreakをリセットする", async () => {
  const result = await core.__testWaitAgentTuiReady(
    "claude",
    [
      "Claude Code\n❯ ",
      "Claude Code\nConnecting…",
      "Claude Code\n❯ ",
      "Claude Code\n❯ ",
      "Claude Code\n❯ ",
    ],
    { timeoutMs: 100, pollMs: 10, stableSamples: 3 },
  );
  assert.equal(result.ready, true);
  assert.equal(result.samples, 5);
  assert.deepEqual(result.sleeps, [10, 10, 10, 10]);
});

test("agent_done ready gate: production既定は11回連続readyを要求する", async () => {
  const ready = "Claude Code\n❯ ";
  const result = await core.__testWaitAgentTuiReady("claude", Array(11).fill(ready), {
    timeoutMs: 100,
    pollMs: 0,
  });
  assert.equal(result.ready, true);
  assert.equal(result.samples, 11);
  assert.equal(result.sleeps.length, 10);
});

// ---------------------------------------------------------------- busy 除外 ready gate（実被弾: Codex MCP init ハング中の誤送信）
test("agent_done ready gate: busy 表示（esc to interrupt）中の Codex/Claude は ready と数えない", async () => {
  // 実機採取: Codex 実行中は「Working (2m 18s • esc to interrupt)」を表示しつつ composer も描画する
  const codexBusy = "OpenAI Codex\n• Working (2m 18s • esc to interrupt)\n› ";
  const claudeBusy = "Claude Code\n✻ Musing… (esc to interrupt)\n❯ ";
  assert.equal(core.__testIsAgentTuiIdleReady("codex", codexBusy), false);
  assert.equal(core.__testIsAgentTuiIdleReady("claude", claudeBusy), false);
  // frontend 推定用の isAgentTuiReady は busy 中も agent TUI と判定したまま（回帰防止）
  assert.equal(core.__testIsAgentTuiReady("codex", codexBusy), true);
  assert.equal(core.__testIsAgentTuiReady("claude", claudeBusy), true);
  // idle 画面はこれまでどおり ready
  assert.equal(core.__testIsAgentTuiIdleReady("codex", "OpenAI Codex\n› "), true);
  assert.equal(core.__testIsAgentTuiIdleReady("claude", "Claude Code\n❯ "), true);
  // Grok/Composer は busy 文字列の実機根拠が未採取のため除外対象外（従来判定を維持）
  assert.equal(core.__testIsAgentTuiIdleReady("grok", "Grok Build\n❯ esc to interrupt"), true);

  // gate 全体: busy が続く間は streak が積み上がらない
  const blocked = await core.__testWaitAgentTuiReady("codex", [codexBusy], { timeoutMs: 0, pollMs: 10 });
  assert.equal(blocked.ready, false);
  const recovered = await core.__testWaitAgentTuiReady(
    "codex",
    [codexBusy, "OpenAI Codex\n› ", "OpenAI Codex\n› "],
    { timeoutMs: 100, pollMs: 10, stableSamples: 2 },
  );
  assert.equal(recovered.ready, true);
});

test("agent_done ready gate: ヘッダが画面外へ流れた長寿命Codexもfooterと入力欄でreadyになる", () => {
  const longLivedCodex = [
    "• bell さんへ指定どおりDMを送信し、マーカーを保持したまま待機します。",
    "",
    "› Write tests for @filename",
    "",
    "  gpt-5.6-terra high · ~/Developer/peertable",
  ].join("\n");
  assert.equal(core.__testIsAgentTuiReady("codex", longLivedCodex), true);
  assert.equal(core.__testIsAgentTuiIdleReady("codex", longLivedCodex), true);
  assert.equal(core.__testIsAgentTuiReady("codex", "› Write tests for @filename"), false);
  assert.equal(core.__testIsAgentTuiReady("codex", "gpt-5.6-terra high · ~/Developer/peertable"), false);
  assert.equal(core.__testIsAgentTuiIdleReady("codex", `${longLivedCodex}\n• Working (1s • esc to interrupt)`), false);
});

test("agent_done ready gate: Codex v0.147のfast入りfooterもreadyになる", () => {
  const screen = "\n› Find and fix a bug in @filename\n\n  gpt-5.6-luna medium fast · ~/Developer/project\n";
  assert.equal(core.__testIsAgentTuiReady("codex", screen), true);
  assert.equal(core.__testIsAgentTuiIdleReady("codex", screen), true);
});

test("Cursor ready gate: active turnのctrl+c停止UIとscrollback上の旧composerをreadyにしない", () => {
  const startup = "Cursor Agent\n\n> \n\nGPT-5.4 Nano Low · ~/Developer/aiterm-mcp";
  const idle = "Cursor Agent\n\n→ Add a follow-up\n\nGPT-5.4 Nano Low · ~/Developer/aiterm-mcp";
  const busy = `${idle}\n⠰⠳ Working\n→ Add a follow-up  ctrl+c to stop`;
  assert.equal(core.__testIsAgentTuiIdleReady("cursor", startup), true, "起動直後の空composerを受ける");
  assert.equal(core.__testIsAgentTuiReady("cursor", busy), true, "frontend自体はCursorと認識する");
  assert.equal(core.__testIsAgentTuiIdleReady("cursor", idle), true);
  assert.equal(core.__testIsAgentTuiIdleReady("cursor", busy), false);
});

test("Cursor ready gate: v2026.08.31の起動直後placeholderを入力待ちとして受ける", () => {
  const screen = [
    "Cursor Agent",
    "v2026.08.31-4057e58",
    "",
    "→ Plan, search, build anything",
    "",
    "Auto",
    "/srv/bellteam/bots/bot-11711167 · master",
  ].join("\n");
  assert.equal(core.__testIsAgentTuiReady("cursor", screen), true);
  assert.equal(core.__testIsAgentTuiIdleReady("cursor", screen), true);
});

test("Cursor ready gate: 長い回答でheaderが画面外へ流れてもfollow-up入力欄を受ける", () => {
  const screen = [
    "引き継ぎ完了。Cursor確認担当（bot-11711167）— Cursorの会話・記憶復元確認。",
    "",
    "個人記憶: BT-MEM-CURSOR-0901A",
    "共通記憶: BT-MEM-SHARED-0901A",
    "",
    "→ Add a follow-up",
    "",
    "Auto · 7.8%",
    "/srv/bellteam/bots/bot-11711167 · master",
  ].join("\n");
  assert.equal(core.__testIsAgentTuiReady("cursor", screen), true);
  assert.equal(core.__testIsAgentTuiIdleReady("cursor", screen), true);
});

// ---------------------------------------------------------------- submit座礁観測（実被弾: 未submit promptがcomposerに2時間滞留）
test("submit座礁観測: composer に送信 text の末尾が残存していれば residue=true", async () => {
  const text = "1. 既存 runtime event-store を読む\n2. byte-level fail closed を実装する";
  const stranded =
    "OpenAI Codex\n• Working (12m • esc to interrupt)\n› 1. 既存 runtime event-store を読む\n  2. byte-level fail closed を実装する";
  const result = await core.__testDetectAgentSubmitResidue("codex", text, [stranded], { maxSamples: 3 });
  assert.equal(result.residue, true);
  assert.equal(result.samples, 3, "残存はサンプル全数の持続で確定する");
});

test("submit座礁観測: submit 済み（echo は marker より上・composer 空）は residue=false で早期確定", async () => {
  const text = "1. 既存 runtime event-store を読む\n2. byte-level fail closed を実装する";
  const submitted =
    "OpenAI Codex\nuser: 1. 既存 runtime event-store を読む\n  2. byte-level fail closed を実装する\n• Working (2s • esc to interrupt)\n› ";
  const result = await core.__testDetectAgentSubmitResidue("codex", text, [submitted]);
  assert.equal(result.residue, false);
  assert.equal(result.samples, 1);
});

test("submit座礁観測: 描画遅延の一時残存は false へ収束し、判定不能は null", async () => {
  const text = "実装方針を検討して plan を出してください";
  const strandedOnce = "Claude Code\n❯ 実装方針を検討して plan を出してください";
  const cleared = "Claude Code\n❯ ";
  const settle = await core.__testDetectAgentSubmitResidue("claude", text, [strandedOnce, cleared]);
  assert.equal(settle.residue, false, "途中で消えた残存は座礁と報告しない");
  assert.equal(settle.samples, 2);

  // tail が短すぎる（8 codepoint 未満）→ 観測せず null
  const short = await core.__testDetectAgentSubmitResidue("codex", "OK", ["OpenAI Codex\n› OK"]);
  assert.equal(short.residue, null);
  assert.equal(short.samples, 0);

  // 入力欄 marker が見つからない画面 → null
  const noMarker = await core.__testDetectAgentSubmitResidue("codex", text, ["OpenAI Codex\nrestarting..."]);
  assert.equal(noMarker.residue, null);
});

test("submit座礁観測: 画面折返し（whitespace 差）を跨いでも末尾一致で検出する", async () => {
  const text = "3. byte-level fail closed を critical path に適用する";
  const wrapped = "OpenAI Codex\n› 3. byte-level fail closed を critical\n  path に適用する";
  const result = await core.__testDetectAgentSubmitResidue("codex", text, [wrapped], { maxSamples: 1 });
  assert.equal(result.residue, true);
});

test("Cursor submit座礁観測: active turnはscrollbackの旧markerを残留入力と誤認しない", async () => {
  const text = "まず5秒待ち、その後に次の1行だけ返してください。CURSOR_RESIDUE_FOLLOWUP";
  const active = [
    "Cursor Agent",
    "> ",
    "まず5秒待ち、その後に次の1行だけ返してください。CURSOR_RESIDUE_FOLLOWUP",
    "⠰⠳ Working",
    "→ Add a follow-up  ctrl+c to stop",
  ].join("\n");
  const result = await core.__testDetectAgentSubmitResidue("cursor", text, [active]);
  assert.equal(result.residue, false);
  assert.equal(result.samples, 1);
});

test("Cursor初回prompt座礁: 現行の矢印composerに残った復元文を検出する", async () => {
  const text = [
    "---",
    "## Portable fork mission",
    "前の会話の記憶を引き継ぎ、ユーザーからの次のメッセージを待ってください。",
  ].join("\n");
  const stranded = [
    "Cursor Agent",
    "→",
    "  ---",
    "  ## Portable fork mission",
    "  前の会話の記憶を引き継ぎ、ユーザーからの次のメッセージを待ってください。",
    "Auto",
  ].join("\n");
  const result = await core.__testDetectAgentSubmitResidue("cursor", text, [stranded], { maxSamples: 1 });
  assert.equal(result.residue, true);
});

test("Cursor初回prompt座礁: 矢印と本文が同じ行に残る実画面を検出する", async () => {
  const text = [
    "GitHub: https://github.com/quolu",
    "[BellTeam owner profile]",
    "これはBellTeamが現在の正本から添付したオーナー情報です。古い記憶よりこの内容を優先してください。",
  ].join("\n");
  const stranded = [
    "Cursor Agent",
    "→ GitHub: https://github.com/quolu",
    "  [BellTeam owner profile]",
    "  これはBellTeamが現在の正本から添付したオーナー情報です。古い記憶よりこの内容を優先してください。",
    "Auto",
  ].join("\n");
  const result = await core.__testDetectAgentSubmitResidue("cursor", text, [stranded], { maxSamples: 1 });
  assert.equal(result.residue, true);
});

test("Cursor長文prompt座礁: 送信文の末尾が画面外でも本文入りcomposerを検出する", async () => {
  const text = [
    "AITERM_AGENT_LAUNCH_ID=long-prompt-test",
    "BellTeamの共通規範とオーナー情報を含む長い起動文です。",
    "最後にこの識別子だけを返してください。CURSOR_LONG_PROMPT_END",
  ].join("\n");
  const stranded = [
    "Cursor Agent",
    "→ 愛してくれる子が好き。クオの依頼には柔らかく返答する。",
    "  共通規範の途中だけが画面に表示され、末尾は表示領域外にある。",
    "Auto · 7.8%",
    "/srv/bellteam/bots/bot-1788dc47 · master",
  ].join("\n");
  const result = await core.__testDetectAgentSubmitResidue("cursor", text, [stranded], { maxSamples: 2 });
  assert.equal(result.residue, true);
  assert.equal(result.samples, 2);
});

test("Cursor submit座礁観測: 空のfollow-up placeholderは残留本文にしない", async () => {
  const text = "この依頼を実行して結果を返してください。CURSOR_PLACEHOLDER_TEST";
  const idle = [
    "Cursor Agent",
    "処理は完了しました。",
    "→ Add a follow-up",
    "Auto · 7.8%",
    "/srv/bellteam/bots/bot-1788dc47 · master",
  ].join("\n");
  const result = await core.__testDetectAgentSubmitResidue("cursor", text, [idle], { maxSamples: 1 });
  assert.equal(result.residue, false);
});

test("Cursor prompt反映待ち: 冷間起動で貼付表示が遅れても本文を確認するまでsubmitへ進まない", async () => {
  const text = [
    "AITERM_AGENT_LAUNCH_ID=cold-start-test",
    "BellTeamの復元文とオーナー情報を含む起動promptです。",
  ].join("\n");
  const empty = [
    "Cursor Agent",
    "→ Plan, search, build anything",
    "Auto",
  ].join("\n");
  const pasted = [
    "Cursor Agent",
    "→ AITERM_AGENT_LAUNCH_ID=cold-start-test",
    "  BellTeamの復元文とオーナー情報を含む起動promptです。",
    "Auto",
  ].join("\n");

  const result = await core.__testWaitCursorPromptVisible(text, [empty, empty, pasted], {
    pollMs: 100,
    maxSamples: 5,
  });
  assert.equal(result.visible, true);
  assert.equal(result.samples, 3);
  assert.deepEqual(result.sleeps, [100, 100]);
});

test("Cursor prompt反映待ち: 長文の先頭が矢印の次行に見えれば末尾が画面外でもsubmitへ進む", async () => {
  const text = [
    "[BellTeam owner profile]",
    "名前: クオ",
    "末尾は画面外にある長い起動promptです。CURSOR_COLD_START_END",
  ].join("\n");
  const pasted = [
    "Cursor Agent",
    "→",
    "  [BellTeam owner profile]",
    "  名前: クオ",
    "  プロフィール: 開発に熱心。",
    "Auto                                                          Run Everything",
    "/srv/bellteam/bots/bot-1788dc47 · master",
  ].join("\n");

  const result = await core.__testWaitCursorPromptVisible(text, [pasted], {
    pollMs: 100,
    maxSamples: 1,
  });
  assert.equal(result.visible, true);
  assert.equal(result.samples, 1);
});

test("Cursor submit: Enter後もcomposerへ本文が残る時だけ同じEnterを一度再送する", async () => {
  const first = { residue: true, samples: 3 };
  const second = { residue: false, samples: 1 };
  assert.deepEqual(
    await core.__testRetryCursorSubmitIfResidue("cursor", first, second),
    { result: second, submits: 1 },
  );
  assert.deepEqual(
    await core.__testRetryCursorSubmitIfResidue("codex", first, second),
    { result: first, submits: 0 },
  );
});

test("agent dispatch: composer残留を成功receiptにしない", () => {
  assert.throws(
    () => core.__testAssertAgentSubmitDelivered("bot-bd860dba", "cursor", { residue: true, samples: 3 }),
    /submit_residue=true/,
  );
  assert.doesNotThrow(() =>
    core.__testAssertAgentSubmitDelivered("bot-bd860dba", "cursor", { residue: false, samples: 1 }),
  );
});

// tmuxSpawnEnv: C/POSIX/未設定 locale だけに UTF-8 LC_CTYPE を注入する（実挙動の破壊は
// caveat tmux-3-7b-list-sessions-f が正。server 側入力破壊・client 側 format タブ "_" 化の対策）。
function withLocaleEnv(vars, fn) {
  const keys = ["LC_ALL", "LC_CTYPE", "LANG"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, vars);
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("tmuxSpawnEnv: locale 未設定は UTF-8 LC_CTYPE を注入する", () => {
  withLocaleEnv({}, () => {
    const env = core.tmuxSpawnEnv();
    assert.ok(env, "注入 env を返す");
    assert.equal(env.LC_CTYPE, process.platform === "darwin" ? "UTF-8" : "C.UTF-8");
    assert.equal("LC_ALL" in env, false);
  });
});

test("tmuxSpawnEnv: C/POSIX locale は上書きし、優先される LC_ALL=C は削除する", () => {
  for (const vars of [{ LANG: "C" }, { LC_CTYPE: "POSIX" }, { LC_ALL: "C", LANG: "ja_JP.UTF-8" }]) {
    withLocaleEnv(vars, () => {
      const env = core.tmuxSpawnEnv();
      assert.ok(env, `注入する: ${JSON.stringify(vars)}`);
      assert.equal("LC_ALL" in env, false, "LC_ALL 残存は注入を無効化するため削除");
      assert.match(env.LC_CTYPE, /UTF-8/);
    });
  }
});

test("tmuxSpawnEnv: 明示された非C locale は尊重して注入しない", () => {
  for (const vars of [{ LANG: "ja_JP.UTF-8" }, { LC_CTYPE: "en_US.UTF-8" }, { LC_ALL: "ja_JP.eucJP" }]) {
    withLocaleEnv(vars, () => {
      assert.equal(core.tmuxSpawnEnv(), undefined, `尊重する: ${JSON.stringify(vars)}`);
    });
  }
});

test("tmuxSpawnEnv: C.UTF-8 は既に UTF-8 なので注入しない", () => {
  withLocaleEnv({ LANG: "C.UTF-8" }, () => {
    assert.equal(core.tmuxSpawnEnv(), undefined);
  });
});

// ---- 完了待ちの案内（投げっぱなし規範） ----
// 抽象名詞の「バックグラウンドで」だけでは親が foreground 実行へ落ちるため、親ホストが分かる時は
// 実際の呼び出し形を名指しする。分からない時は汎用文へ落ちるだけで機能は変わらない。

test("agentWaitLaunchForm: claude-code親には実際の非ブロック呼び出し形を名指しする", () => {
  try {
    core.setParentClient("claude-code");
    const form = core.agentWaitLaunchForm("aiterm-wait --session t1 --cursor 0");
    assert.match(form, /run_in_background: true/, "背景実行フラグを名指しする");
    assert.match(form, /aiterm-wait --session t1 --cursor 0/, "コマンドをそのまま含む");
  } finally {
    core.setParentClient(null);
  }
});

test("agentWaitProcess: npm shimを解釈せず現在Nodeと同梱CLIを分離して返す", () => {
  const waitProcess = core.agentWaitProcess("session-1", 42);
  assert.equal(waitProcess.executable, process.execPath);
  assert.match(waitProcess.args[0], /aiterm-wait-cli\.js$/);
  assert.deepEqual(waitProcess.args.slice(1), ["--session", "session-1", "--cursor", "42"]);
  assert.equal(
    typeof waitProcess.windows_start_process_argument_list === "string",
    process.platform === "win32",
  );
});

test("agentWaitProcess: Windows Start-Process用文字列は空白・quote・末尾backslashを保持する", () => {
  const waitProcess = core.agentWaitProcess("session-1", 42, {
    executable: "C:\\Program Files\\nodejs\\node.exe",
    cliPath: "C:\\Users\\A B\\aiterm wait\\aiterm-wait-cli.js",
    platform: "win32",
  });
  assert.equal(
    waitProcess.windows_start_process_argument_list,
    '"C:\\Users\\A B\\aiterm wait\\aiterm-wait-cli.js" --session session-1 --cursor 42',
  );
  assert.equal(
    core.windowsStartProcessArgumentList(["plain", "with space", 'with"quote', "tail\\"]),
    'plain "with space" "with\\\"quote" tail\\',
  );
});

test("agentWaitLaunchForm: 未知/未申告の親には汎用の非ブロック指示へ落ちる", () => {
  for (const client of [null, "", "   ", "some-other-host"]) {
    core.setParentClient(client);
    const form = core.agentWaitLaunchForm("aiterm-wait --session t1 --cursor 0");
    assert.doesNotMatch(form, /run_in_background/, `ホスト固有形を漏らさない: ${JSON.stringify(client)}`);
    assert.match(form, /親のターンを塞がない別プロセス/, `非ブロックを要求する: ${JSON.stringify(client)}`);
  }
  core.setParentClient(null);
});

test("agentDispatchGuide: 先頭で待たないことを宣言し、待ちコマンドと禁止事項を含む", () => {
  const guide = core.agentDispatchGuide("t7", 4096);
  const first = guide.split("\n")[0];
  assert.match(first, /投げっぱなしでよい/, "1行目で投げっぱなしを許諾する");
  assert.match(first, /ここで待たない/, "1行目で待たないことを宣言する");
  assert.match(guide, /aiterm-wait --session t7 --cursor 4096/, "cursorを含む正しい待ちコマンドを出す");
  assert.match(guide, /foreground 実行は親を最大 600 秒塞ぐ/, "foreground実行の害を明示する");
  assert.match(guide, /pty_read\(agent_transcript:true\)/, "回収経路を示す");
});

test("agentWaitGuide: 復旧案内は取りこぼしゼロの --cursor 0 を維持する", () => {
  // cursor 省略時の既定は waiter 起動時 EOF＝案内表示〜実行の間に届いた done を読み飛ばす race。
  const guide = core.agentWaitGuide("t9");
  assert.match(guide, /aiterm-wait --session t9 --cursor 0/, "0起点を明示する");
  assert.match(guide, /親はここで待たない/, "復旧経路でも親を待たせない");
  assert.match(guide, /outcome=done/, "exit≠完了の判定基準を示す");
});

// ---------------------------------------------------------------- pane 入力の到達性（Codex 0.153 実測 2026-09-04）
test("classifyPaneTtyProcesses: bash が前面(+)で codex が背面(S)なら agent 在席・非前面", () => {
  const ps = [
    "Ss+  bash",
    "S    node /Users/kite/.local/bin/codex -c check_for_update_on_startup=false -m gpt-5.6-terra",
    "S    /opt/homebrew/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex -c x",
    "S    node /Users/kite/Developer/peertable/room/client.mjs",
  ].join("\n");
  assert.deepEqual(core.classifyPaneTtyProcesses(ps), {
    agentPresent: true, agentForeground: false, agentStopped: false, toolForeground: false, foregroundShell: "bash",
  });
});
test("classifyPaneTtyProcesses: codex が前面(S+)なら回復不要", () => {
  const ps = "Ss   bash\nS+   node /Users/kite/.local/bin/codex -c a\nS+   /x/bin/codex -c b\nS    node ./mcp/server.mjs";
  assert.deepEqual(core.classifyPaneTtyProcesses(ps), {
    agentPresent: true, agentForeground: true, agentStopped: false, toolForeground: false, foregroundShell: null,
  });
});
test("classifyPaneTtyProcesses: 停止(T)した agent は stopped、agent 不在は present=false", () => {
  assert.equal(core.classifyPaneTtyProcesses("Ss+  bash\nT    node /x/codex").agentStopped, true);
  assert.deepEqual(core.classifyPaneTtyProcesses("Ss+  bash\n"), {
    agentPresent: false, agentForeground: false, agentStopped: false, toolForeground: false, foregroundShell: "bash",
  });
  assert.equal(core.classifyPaneTtyProcesses("").agentPresent, false);
});
test("termiosIsCooked: icanon/echo が有効なら cooked、-icanon -echo なら raw", () => {
  const cooked = "speed 9600 baud; 24 rows; 80 columns;\nlflags: icanon isig iexten echo echoe -echok echoke -echonl echoctl\n\t-echoprt -altwerase -noflsh -tostop -flusho -pendin -nokerninfo";
  const raw = "speed 9600 baud; 24 rows; 80 columns;\nlflags: -icanon -isig -iexten -echo -echoe -echok -echoke -echonl -echoctl\n\t-echoprt -altwerase -noflsh -tostop -flusho -pendin -nokerninfo";
  assert.equal(core.termiosIsCooked(cooked), true);
  assert.equal(core.termiosIsCooked(raw), false);
  // echoe / echoke は echo ではない
  assert.equal(core.termiosIsCooked("lflags: -icanon -echo echoe echoke"), false);
});
test("classifyPaneTtyProcesses: ログイン shell の `-zsh` は shell、codex が起動した子 bash やツールの前面は toolForeground", () => {
  const codex = /(^|[\s/])codex([\s]|$)/;
  // login zsh が前面、codex が背面 → fg 対象
  assert.deepEqual(core.classifyPaneTtyProcesses("Ss+  -zsh\nS    node /Users/kite/.local/bin/codex -c a", codex), {
    agentPresent: true, agentForeground: false, agentStopped: false, toolForeground: false, foregroundShell: "zsh",
  });
  // codex が前面、その子 bash -lc（session leader でない）も前面 → ツール実行中。触らない
  const tool = core.classifyPaneTtyProcesses("Ss   bash\nS+   node /x/codex -c a\nS+   /x/bin/codex -c a\nS+   bash -lc ssh fox python train.py", codex);
  assert.equal(tool.agentForeground, true);
  assert.equal(tool.toolForeground, true);
  // codex が前面で非 shell のツール（ssh）が前面 → toolForeground
  assert.equal(core.classifyPaneTtyProcesses("Ss   bash\nS+   /x/bin/codex -c a\nS+   ssh fox", codex).toolForeground, true);
  // MCP 子（node room/client.mjs、S）は agent でもツール前面でもない
  const mcp = core.classifyPaneTtyProcesses("Ss   bash\nS+   /x/bin/codex -c a\nS    node /Users/kite/Developer/peertable/room/client.mjs", codex);
  assert.deepEqual([mcp.agentForeground, mcp.toolForeground], [true, false]);
});

// ---------------------------------------------------------------- attachImages（画像添付はaitermが所有）
test("attachImages: 画像なしは本文をそのまま返す", () => {
  assert.equal(core.attachImages("本文", undefined), "本文");
  assert.equal(core.attachImages("本文", []), "本文");
});

test("attachImages: 絶対パスの画像を本文末尾へ添付行として付ける", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-image-"));
  const a = path.join(dir, "a.png");
  const b = path.join(dir, "b.JPG");
  fs.writeFileSync(a, "x");
  fs.writeFileSync(b, "x");
  assert.equal(
    core.attachImages("これを見て", [a, b]),
    `これを見て\n\n[aiterm 添付画像 1/2] ${a}\n[aiterm 添付画像 2/2] ${b}\n添付画像は上のファイルを読んで確認する。`,
  );
  assert.equal(
    core.attachImages("", [a]),
    `添付画像を確認してください。\n\n[aiterm 添付画像 1/1] ${a}\n添付画像は上のファイルを読んで確認する。`,
  );
});

test("attachImages: 相対パス・未対応拡張子・不在・directoryはtyped errorで拒否する", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-image-"));
  const png = path.join(dir, "a.png");
  fs.writeFileSync(png, "x");
  assert.throws(() => core.attachImages("t", ["a.png"]), /image\[0\] は画像ファイルの絶対パス/u);
  assert.throws(() => core.attachImages("t", [path.join(dir, "a.txt")]), /image\[0\] の拡張子に対応していません/u);
  assert.throws(() => core.attachImages("t", [png, path.join(dir, "missing.png")]), /image\[1\] が読めません/u);
  assert.throws(() => core.attachImages("t", [dir + ".png"]), /image\[0\] が読めません/u);
  fs.mkdirSync(path.join(dir, "d.png"));
  assert.throws(() => core.attachImages("t", [path.join(dir, "d.png")]), /image\[0\] はfileではありません/u);
});

// ---------------------------------------------------------------- APIエラー終了の検知
test("claudeApiErrorFromLine: isApiErrorMessage:true のassistant行だけをエラー終了として読む", () => {
  const line = JSON.stringify({
    type: "assistant", isApiErrorMessage: true, apiErrorStatus: 529, timestamp: "2026-09-03T13:44:38.124Z",
    message: { role: "assistant", content: [{ type: "text", text: "API Error: 529 Overloaded. This is a server-side issue" }] },
  });
  assert.deepEqual(claudeHarness.claudeApiErrorFromLine(line), {
    text: "API Error: 529 Overloaded. This is a server-side issue", at: "2026-09-03T13:44:38.124Z",
  });
  assert.equal(claudeHarness.claudeApiErrorFromLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } })), null);
  assert.equal(claudeHarness.claudeApiErrorFromLine(JSON.stringify({ type: "system", isApiErrorMessage: true })), null);
  assert.equal(claudeHarness.claudeApiErrorFromLine("{broken"), null);
  assert.deepEqual(
    claudeHarness.claudeApiErrorFromLine(JSON.stringify({ type: "assistant", isApiErrorMessage: true, apiErrorStatus: 500 })),
    { text: "API Error: 500", at: null },
  );
});

test("claudeSessionTranscriptPath: cwdの英数字以外を1文字ずつ '-' にしたproject slugの下のsession jsonl", () => {
  assert.equal(claudeHarness.claudeProjectSlug("/Users/kite/.throughline-x"), "-Users-kite--throughline-x");
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = "/cfg";
  try {
    assert.equal(
      claudeHarness.claudeSessionTranscriptPath({ kind: "claude", cwd: "/srv/bellteam/bots/bot-f4d0f046", vendor_session_id: "20442ef4-595d-4753-8584-71f53aff4002" }),
      path.join("/cfg", "projects", "-srv-bellteam-bots-bot-f4d0f046", "20442ef4-595d-4753-8584-71f53aff4002.jsonl"),
    );
    assert.equal(claudeHarness.claudeSessionTranscriptPath({ kind: "grok", cwd: "/x", vendor_session_id: "s" }), null);
    assert.equal(claudeHarness.claudeSessionTranscriptPath({ kind: "claude", cwd: "/x", vendor_session_id: null }), null);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

test("grokCompletionEvent: turn_ended outcome=error は turn_error の終了境界", () => {
  const meta = { kind: "grok", aiterm_session: "s", launch_id: "l", vendor_session_id: "v" };
  const error = grokHarness.grokCompletionEvent(meta, { ts: "2026-08-22T12:23:43.996Z", type: "turn_ended", outcome: "error" });
  assert.equal(error.done_status, "turn_error");
  assert.equal(error.reason, "Grok transcript turn_ended:error");
  assert.equal(grokHarness.grokCompletionEvent(meta, { ts: "t", type: "turn_ended", outcome: "completed" }).done_status, "turn_done");
  assert.equal(grokHarness.grokCompletionEvent(meta, { ts: "t", type: "turn_ended", outcome: "timeout" }), null);
});
