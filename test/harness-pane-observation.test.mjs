import assert from "node:assert/strict";
import test from "node:test";
import { grokPaneObservation, grokEnvTokens } from "../dist/harnesses/grok.js";
import { codexHelperProcess, codexPaneObservation, codexTuiBusy, codexTuiReady, codexApprovalDialog, codexRateLimitModelSwitchDialog, codexStartupAction, codexTurnError, codexTurnErrorLine, codexUsageLimit } from "../dist/harnesses/codex.js";

test("CodexのWindows hook確認は画面上部の見出しとgo back footerから判定する", () => {
  const screen = ['  Hooks need review', '  8 hooks are new or changed.',
    '  Hooks can run outside the sandbox after you trust them.', '',
    '› 1. Review hooks', '  2. Trust all and continue',
    "  3. Continue without trusting (hooks won't run)", '',
    '  Press enter to confirm or esc to go back', ...Array(21).fill('')].join('\n');
  assert.deepEqual(codexPaneObservation(screen), { state: 'blocked', reason: 'hooks_review' });
  assert.equal(codexStartupAction(screen, false), null);
  assert.deepEqual(codexStartupAction(screen, true), { kind: 'project_hooks_trusted', keys: ['Down', 'Enter'] });
});

// Codex 0.157.0 の実機capture（fox、psmux、2026-09-26）。modalが上部にあり、下に空行が続く。
test("Codexのmodalは画面下の空行に押し出されても検知する", () => {
  const screen = ['  Folder access', '  C:\\Users\\example', '',
    '  Trust this folder? Codex can read, edit, and run files here, subject to your permission settings.', '',
    '› 1. Trust and continue', '  2. Quit', '', '  enter continue · esc quit', ...Array(30).fill('')].join('\n');
  assert.deepEqual(codexPaneObservation(screen), { state: 'blocked', reason: 'startup_dialog' });
  assert.deepEqual(codexStartupAction(screen, true), { kind: 'workspace_trusted', keys: ['Enter'] });
});

// Codex 0.157.0 の実機capture逐語（rabbit、2026-09-26）。旧「Do you trust the contents」に代わる画面。
test("Codex 0.157のFolder access画面をtrust_projectの時だけ進める", () => {
  const screen = ['╭──────────────────────────────╮', '│ >_ OpenAI Codex (v0.157.0)   │', '╰──────────────────────────────╯',
    '› Ask Codex to do anything', '', '  Folder access', '  /tmp/tmp.MBLUoIhtoz', '',
    '  Trust this folder? Codex can read, edit, and run files here, subject to your permission settings. Folder settings can run code automatically, even without a',
    '  model request. Continue only if you trust these files. Your trust decision will be saved.', '',
    '› 1. Trust and continue', '  2. Quit', '  enter continue · esc quit'].join('\n');
  assert.deepEqual(codexPaneObservation(screen), { state: 'blocked', reason: 'startup_dialog' });
  assert.equal(codexStartupAction(screen, false), null);
  assert.deepEqual(codexStartupAction(screen, true), { kind: 'workspace_trusted', keys: ['Enter'] });
});
import { claudeStartupAction, claudePaneObservation, claudeTuiBusy, claudeTuiReady, claudeUsageLimit } from "../dist/harnesses/claude.js";
import { paneTokenHint } from "../dist/harnesses/pane-tokens.js";
import { cursorHookBlocked, cursorPaneObservation, cursorPromptHooksRunning, cursorUsageLimit } from "../dist/harnesses/cursor.js";

test("Grokの通信失敗は応答待ち表示より優先する", () => {
  for (const padding of [[], Array(20).fill("wrapped line")]) {
    const screen = ["Connection failed — reqwest error stream", ...padding, "Waiting for response… 29s [stop]"].join("\n");
    assert.deepEqual(grokPaneObservation(screen), { state: "blocked", reason: "connection_failed" });
  }
  assert.equal(grokPaneObservation("Waiting for response… 12s [stop]").state, "busy");
});

test("Grokのprivacy回避は起動adapterが所有し、表示中はreadyにしない", () => {
  assert.ok(grokEnvTokens({}).includes("GROK_PRIVACY_NOTICE_ROLLOUT=0"));
  assert.deepEqual(grokPaneObservation("Help improve Grok\n[Opt out] [Opt in]\nGrok Build\n❯"),
    { state: "blocked", reason: "privacy_choice" });
});

test("Codex承認は単発許可と拒否だけを公開する", () => {
  const screen = 'Allow the room MCP server to run tool "members"?\n  › 1. Allow                   Run the tool and continue.\n    2. Allow for this session  Remember for this session.\n    3. Always allow            Remember for future calls.\n    4. Cancel                  Cancel this tool call\n  enter to submit | esc to cancel';
  const dialog = codexApprovalDialog(screen);
  assert.deepEqual(dialog.choices.map(choice => choice.decision), ["approve_once", "deny"]);
  assert.equal(dialog.selected_index, 1);
  assert.equal(dialog.kind, "mcp_approval");
  const command = "Would you like to run the following command?\n$ python3 test.py\n› 1. Yes, proceed (y)\n2. Yes, and don't ask again for commands that start with python3 (p)\n3. No, and tell Codex what to do differently (esc)\nPress enter to confirm or esc to cancel";
  assert.equal(codexApprovalDialog(command).choices.length, 2);
  assert.equal(codexApprovalDialog(`${command}\n› Ask Codex to do anything\ngpt-5.6-terra high · ~/work`), null);
});

test("Codexの補助process（code-mode-host）だけを、harnessの一部として見分ける", () => {
  assert.equal(codexHelperProcess("/usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex-code-mode-host"), true);
  assert.equal(codexHelperProcess('"C:\\Users\\k\\codex\\codex-code-mode-host.exe" --stdio'), true);
  assert.equal(codexHelperProcess("/usr/local/bin/codex -c check_for_update_on_startup=false"), false);
  assert.equal(codexHelperProcess("/bin/bash -c ./codex-code-mode-host"), false);
  assert.equal(codexHelperProcess("sleep 240"), false);
});

test("pane token hintは直近の表示値だけを返す", () => {
  assert.equal(paneTokenHint("↓ 1.2k tokens\n↑ 3.4M tokens"), 3_400_000);
  assert.equal(paneTokenHint("表示なし"), null);
});

test("起動時同意はproject信頼の意図に限定する", () => {
  const hooks = "Hooks need review\n› 1. Review hooks\n  2. Trust all hooks for this project";
  assert.equal(codexStartupAction(hooks, false), null);
  assert.deepEqual(codexStartupAction(hooks, true).keys, ["Down", "Enter"]);
  const update = "Update available!\n› 1. Update now\n  2. Not now";
  assert.equal(codexStartupAction(update, false).kind, "update_deferred");
  const mcp = "Claude Code\n2 new MCP servers found in this project\n❯ [✔] booth\n  [✔] room\n    Enable selected";
  assert.equal(claudePaneObservation(mcp).state, "blocked");
  assert.equal(claudeStartupAction(mcp, false), null);
  assert.deepEqual(claudeStartupAction(mcp, true).keys, ["Down", "Down", "Enter"]);
  assert.equal(codexStartupAction("Hooks need review\n› 1. Unknown option", true), null);
});

test("Claude Codeの初回テーマ選択は既定の選択を確定して起動を続ける", () => {
  const screen = [
    "Welcome to Claude Code v2.1.261",
    "Choose the text style that looks best with your terminal",
    "To change this later, run /theme",
    "  1. Auto (match terminal)",
    "❯ 2. Dark mode ✔",
    "  3. Light mode",
    "Syntax theme: Monokai Extended (ctrl+t to disable)",
  ].join("\n");
  assert.equal(claudeTuiReady(screen), false);
  assert.deepEqual(claudePaneObservation(screen), { state: "blocked", reason: "startup_dialog" });
  assert.deepEqual(claudeStartupAction(screen, true), { kind: "initial_theme_selected", keys: ["Enter"] });
});

test("Claude Codeのログイン方式選択は入力欄と誤認せず公式CLIでの初回設定を要求する", () => {
  const screen = [
    "Claude Code can be used with your Claude subscription or billed based on API usage through your Console account.",
    "Select login method:",
    "❯ Claude account with subscription · Pro, Max, Team, or Enterprise",
    "  Anthropic Console account · API usage billing",
    "  3rd-party platform · Amazon Bedrock, Microsoft Foundry, or Vertex AI",
  ].join("\n");
  assert.equal(claudeTuiReady(screen), false);
  assert.deepEqual(claudePaneObservation(screen), { state: "blocked", reason: "vendor_onboarding_required" });
  assert.equal(claudeStartupAction(screen, true), null);
});

test("Claude Code 2.1.282の番号付きログイン方式選択も初回設定の要求として扱う", () => {
  const screen = [
    "Welcome to Claude Code v2.1.282",
    " Claude Code can be used with your Claude subscription or billed based on API usage through your Console account.",
    " Select login method:",
    " ❯ 1. Claude account with subscription · Pro, Max, Team, or Enterprise",
    "   2. Anthropic Console account · API usage billing",
    "   3. 3rd-party platform · Amazon Bedrock, Microsoft Foundry, or Vertex AI",
  ].join("\n");
  assert.equal(claudeTuiReady(screen), false);
  assert.deepEqual(claudePaneObservation(screen), { state: "blocked", reason: "vendor_onboarding_required" });
  assert.equal(claudeStartupAction(screen, true), null);
});

// Codex 0.160.1の実画面（BellTeamコンテナ 2026-10-06）。回答に「esc to interrupt」の語が残った席は、止まった後も動作中と読まれ、
// 次の送信が差し込みになって、その回の完了が届かなかった。
test("Codexの会話欄にある「esc to interrupt」を、動作中の印にしない", () => {
  const footer = ["", "› Ask Codex to do anything", "", "  GPT-6.1-Sol default · /tmp/proj · Run delayed Node command", "  ? for shortcuts"];
  const prompt = ["› Run this shell command once: node -e \"setTimeout(() => console.log(6*7),", "  6000)\" . When it finishes, reply with exactly this one line and nothing else:",
    "  FIRST_OK the footer shows esc to interrupt while a turn runs", "", ""];
  const idle = [...prompt, "• 指定のコマンドを一度実行します。", "", "• Ran node -e \"setTimeout(() => console.log(6*7), 6000)\"", "  └ 42", "",
    "• FIRST_OK the footer shows esc to interrupt while a turn runs", "", "  Worked for 12s • 12:24 PM", "", ...footer].join("\n");
  assert.deepEqual(codexPaneObservation(idle), { state: "idle", reason: "composer_ready" });
  assert.equal(codexTuiBusy(idle), false);
  // 括弧に入っていても、経過時間の無い形は印にしない。
  assert.equal(codexTuiBusy("• 動いている間は (esc to interrupt) が出ます。\n› "), false);
  // 動いている間の行は、今までどおり読む（会話欄に同じ語があっても）。見出しの文と後ろの知らせは変わる。
  for (const status of [
    "◦ Working (5s • esc to interrupt) · 1 background terminal running · /ps to view…",
    "• Working (0s • esc to interrupt)",
    "• Working (2m 18s • esc to interrupt)",
    "• Investigating the failing test (1h 02m 03s • esc to interrupt)",
    "• Working (12m • Esc to interrupt)",
  ]) {
    const running = [...prompt, "• 指定のコマンドを一度実行します。", "", status, "", ...footer].join("\n");
    assert.deepEqual(codexPaneObservation(running), { state: "busy", reason: "turn_running" }, status);
    assert.equal(codexTuiBusy(running), true, status);
  }
});

test("Codexの警告の画面（F2）が開いている間は、入力待ちと読まない", () => {
  // Codex 0.161.0の実物の画面（2026-10-08）。足元の「⚠ N warnings · f2 to view」をF2で開くと、入力欄の場所に警告が出て、鍵をその画面が受ける。
  const header = ["  >_ OpenAI Codex (v0.161.0)", "     /tmp/proj", "", "  permissions: YOLO mode", "",
    "  To get started, describe a task or try one of these commands:", "", "  /init - create an AGENTS.md file with instructions for Codex",
    "  /status - show current session configuration", "  /permissions - choose what Codex is allowed to do",
    "  /model - choose what model and reasoning effort to use", "  /review - review any changes and find issues", ""];
  const keys = "  k keep & next · esc dismiss & close · ^o copy · ←/→ warning · ↓ scroll";
  const startup = ["  Warnings · 1 of 3 · Startup", "", "  Running without the shared background server: command-line configuration",
    "  overrides (-c, --enable, --disable, or --search) requires embedded mode.", "", keys];
  const composer = ["› Ask Codex to do anything", "", "  GPT-6.1-Sol default · /tmp/proj", "  ? for shortcuts                                     ⚠ 3 warnings · f2 to view"];
  // 起こしたての席（見出しが残っている）。直す前は、見出しの「>_」を入力欄と読んで入力待ちにしていた。
  const fresh = [...header, ...startup].join("\n");
  assert.deepEqual(codexPaneObservation(fresh), { state: "blocked", reason: "unknown_dialog" });
  assert.equal(codexTuiReady(fresh), false);
  // 番が動いている間。動作中の行は警告の画面に隠れる。
  const running = [...header.slice(5), "› Reply with exactly SLOW_OK.", "", "  Warnings · 1 of 2 · Startup", "",
    "  Model metadata for `mock-model` not found. Defaulting to fallback metadata;", "  this can degrade performance and cause issues.", "", keys].join("\n");
  assert.deepEqual(codexPaneObservation(running), { state: "blocked", reason: "unknown_dialog" });
  // 回答を流している間。MCPの警告は本文が長く、鍵の案内の行は同じ。
  const streaming = [...Array.from({ length: 10 }, (_, index) => `  ${index + 6}. item number ${index + 6} is here`), "",
    "  Warnings · 2 of 3 · MCP · bellteam", "", "  MCP client for `bellteam` failed to start: MCP startup failed:",
    "  handshaking with MCP server failed: Send message error Transport", "  response: HTTP 400: {\"error\":\"BELLTEAM_SEAT_UNRESOLVED\"},", "", keys].join("\n");
  assert.deepEqual(codexPaneObservation(streaming), { state: "blocked", reason: "unknown_dialog" });
  // 会話に製品名があり、前の依頼文が残っている席でも、警告の画面が下にある間は入力待ちにしない。
  const mentioned = ["› Tell me about OpenAI Codex.", "", "• OpenAI Codex is a coding agent.", "", "  Worked for 2s • 3:26 AM", "", ...startup].join("\n");
  assert.deepEqual(codexPaneObservation(mentioned), { state: "blocked", reason: "unknown_dialog" });
  // 閉じた後は、今までどおり入力待ち。動いている番も今までどおり読む。
  assert.deepEqual(codexPaneObservation([...header, ...composer].join("\n")), { state: "idle", reason: "composer_ready" });
  assert.deepEqual(codexPaneObservation([...header.slice(5), "› Reply with exactly SLOW_OK.", "", "• Working (3s • esc to interrupt)", "", ...composer].join("\n")),
    { state: "busy", reason: "turn_running" });
  // 回答や依頼文に同じ案内の行があっても、その下に入力欄がある席は入力待ち。
  const quoted = ["› What does the warnings view show?", "", "• The footer reads:", keys, "", "  Worked for 2s • 3:26 AM", "", ...composer].join("\n");
  assert.deepEqual(codexPaneObservation(quoted), { state: "idle", reason: "composer_ready" });
  // Codex 0.160.0の鍵の案内は「ctrl+o copy」（0.161.0は「^o copy」）。どちらも同じに読む。
  const older = [...header, "  Warnings · 1 of 3 · Startup", "", "  Codex could not find bubblewrap on PATH. Install bubblewrap with", "  your OS package manager.", "",
    "  k keep & next · esc dismiss & close · ctrl+o copy · ←/→ warning · ↓ scroll"].join("\n");
  assert.deepEqual(codexPaneObservation(older), { state: "blocked", reason: "unknown_dialog" });
  // 承認の画面ではない。
  assert.equal(codexApprovalDialog(fresh), null);
  assert.equal(codexRateLimitModelSwitchDialog(fresh), null);
});

test("Codexの起動の見出しの「>_」だけでは、入力待ちと読まない", () => {
  // 見出しは出たが、入力欄がまだ無い（または別の画面に置き換わっている）画面。
  const header = "  >_ OpenAI Codex (v0.161.0)\n     /tmp/proj\n\n  permissions: YOLO mode\n";
  assert.equal(codexTuiReady(header), false);
  assert.deepEqual(codexPaneObservation(header), { state: "unknown", reason: "unrecognized_screen" });
  // 入力欄が出れば入力待ち。古い描画の「>」の入力欄も今までどおり。
  assert.equal(codexTuiReady(`${header}\n› Ask Codex to do anything\n`), true);
  assert.equal(codexTuiReady(`${header}\n> Ask Codex to do anything\n`), true);
  assert.deepEqual(codexPaneObservation(`${header}\n› Ask Codex to do anything\n\n  GPT-6.1-Sol default · /tmp/proj`), { state: "idle", reason: "composer_ready" });
});

test("Codexの古い承認を現在の入力欄へ持ち越さない", () => {
  const old = "Would you like to run the following command?\n2. Yes, and don't ask again for commands that start with rg";
  const composer = "› Ask Codex to do anything\ngpt-5.6-terra high · ~/work";
  assert.equal(codexPaneObservation(`${old}\n• Working (8s • esc to interrupt)\n${composer}`).state, "busy");
  assert.equal(codexPaneObservation(`${old}\n${composer}`).state, "idle");
  assert.deepEqual(codexPaneObservation(`${old}\n${Array(28).fill("wrapped command line").join("\n")}\nPress enter to confirm or esc to cancel`), { state: "blocked", reason: "command_approval" });
});

test("Codexの設定読込失敗を残った入力欄からreadyと誤認しない", () => {
  const screen = "OpenAI Codex (v0.150.1)\nmodel: loading\n› Error loading config.toml: invalid type: map, expected a boolean\n in `features`\nbash-3.2$";
  assert.deepEqual(codexPaneObservation(screen), { state: "blocked", reason: "configuration_error" });
});

test("Codexの承認と起動操作は最後のdialogだけを使う", () => {
  const old = "Would you like to run the following command?\n› 1. Yes, proceed (y)\n  3. No, and tell Codex what to do differently (esc)\nPress enter to confirm or esc to cancel";
  const current = 'Allow the room MCP server to run tool "members"?\n  1. Allow\n  2. Allow for this session\n› 3. Always allow\n  4. Cancel\nenter to submit | esc to cancel';
  assert.deepEqual(codexPaneObservation(`${old}\n${current}`), { state: "blocked", reason: "mcp_approval" });
  const dialog = codexApprovalDialog(`${old}\n${current}`);
  assert.equal(dialog.selected_index, 3);
  assert.equal(dialog.choices.find(choice => choice.decision === "approve_once").index, 1);
  assert.ok(!dialog.prompt.includes("following command"));
  assert.deepEqual(codexPaneObservation(`${old}\nUnknown request\n› 1. Continue\nenter to submit | esc to cancel`),
    { state: "blocked", reason: "unknown_dialog" });
  const hooks = "Hooks need review\n› 1. Review hooks\n  2. Trust all hooks for this project";
  assert.equal(codexApprovalDialog(`${old}\n${hooks}`), null);
  assert.deepEqual(codexStartupAction(`${old}\n${hooks}`, true).keys, ["Down", "Enter"]);
});

test("Codexの上限接近model switchは現在の完全な3択だけを専用modalとして扱う", () => {
  const modal = (cursor) => [
    "Approaching rate limits",
    "Switch to gpt-5.6-luna for lower credit usage?",
    `${cursor === 1 ? "› " : "  "}1. Switch to gpt-5.6-luna                 Fast and affordable agentic coding`,
    "                                            model.",
    `${cursor === 2 ? "› " : "  "}2. Keep current model`,
    `${cursor === 3 ? "› " : "  "}3. Keep current model (never show again)  Hide future rate limit reminders`,
    "                                            about switching models.",
    "Press enter to confirm or esc to go back",
  ].join("\n");
  for (const cursor of [1, 2, 3]) {
    assert.deepEqual(codexPaneObservation(modal(cursor)), { state: "blocked", reason: "rate_limit_model_switch" });
    assert.deepEqual(codexRateLimitModelSwitchDialog(modal(cursor)), { keepCurrentIndex: 2, selectedIndex: cursor });
    assert.equal(codexApprovalDialog(modal(cursor)), null);
  }
  const old = modal(1);
  const composer = "› Ask Codex to do anything\ngpt-5.6-terra high · ~/work";
  assert.deepEqual(codexPaneObservation(`${old}\n${composer}`), { state: "idle", reason: "composer_ready" });
  assert.equal(codexRateLimitModelSwitchDialog(`${old}\n${composer}`), null);
  assert.equal(codexRateLimitModelSwitchDialog(modal(1).replace("3. Keep current model (never show again)", "3. Keep current model")), null);
});

// Codex CLI 0.157.0 の実機capture逐語（BellTeamコンテナ、tmux 80x24、2026-09-26）。切替先modelとfooterが0.155.1から変わった。
const CODEX_0157_RATE_LIMIT_SCREEN = [
  "  Worked for 29m 46s · 11:03 AM",
  "", "", "  Approaching rate limits",
  "  Switch to gpt-6-luna for lower credit usage?", "", "",
  "› 1. Switch to gpt-6-luna                   Fast and affordable model for easier",
  "                                            tasks.",
  "  2. Keep current model",
  "  3. Keep current model (never show again)  Hide future rate limit reminders",
  "                                            about switching models", "",
  "  enter select · esc back",
].join("\n");

test("Codex 0.157の上限接近modalも、新しい切替先modelとkey hint footerで見分ける", () => {
  assert.deepEqual(codexPaneObservation(CODEX_0157_RATE_LIMIT_SCREEN), { state: "blocked", reason: "rate_limit_model_switch" });
  assert.deepEqual(codexRateLimitModelSwitchDialog(CODEX_0157_RATE_LIMIT_SCREEN), { keepCurrentIndex: 2, selectedIndex: 1 });
  assert.equal(codexApprovalDialog(CODEX_0157_RATE_LIMIT_SCREEN), null);
  // 「2」で閉じた後の実機画面。scrollbackのmodalを現在のmodalとして扱わない。
  const closed = `${CODEX_0157_RATE_LIMIT_SCREEN}\n\n› Ask Codex to do anything\n\n  GPT-6-Sol high · /srv/bellteam/bots/bot-3545e21f\n  ? for shortcuts`;
  assert.equal(codexRateLimitModelSwitchDialog(closed), null);
  assert.deepEqual(codexPaneObservation(closed), { state: "idle", reason: "composer_ready" });
  // 質問と選択肢1の切替先が食い違う画面は、Aitermが選ばない。
  assert.equal(codexRateLimitModelSwitchDialog(CODEX_0157_RATE_LIMIT_SCREEN.replace("1. Switch to gpt-6-luna", "1. Switch to gpt-6-terra")), null);
  // footerが無い画面はmodalの描画途中として扱わない。
  assert.equal(codexRateLimitModelSwitchDialog(CODEX_0157_RATE_LIMIT_SCREEN.replace("  enter select · esc back", "")), null);
});

// Cursor Agent 2026.09.26-dd393fe の実機capture逐語（macbook、tmux、2026-09-26）。入力欄は戻らない。
const CURSOR_USAGE_LIMIT_SCREEN = [
  "    Run the shell command `hostname` and reply with only its output.           ",
  "                                                                               ",
  "", "  Claude Sonnet 5 300K High No Thinking                         Run Everything", "  ~", "",
  "  Error: You've hit your usage limit",
  "  You've saved $766 on API model usage this month with Ultra. Switch to a ",
  "  different model or set a Spend Limit to continue with Sonnet. Your usage ",
  "  limits will reset when your monthly cycle ends on 10/17/2026.",
  "  fallbackModel: ", "  spendLimitHit: true",
  "  chatMessage: *You've saved $766 on API model usage this month with Ultra. ",
  "  Switch to a different model or set a [Spend ",
  "  Limit](https://www.cursor.com/dashboard?tab=settings) to continue with ",
  "  Sonnet. Your usage limits will reset when your monthly cycle ends on ",
  "  10/17/2026.*", "  spendLimits: [20,30,40]", ""].join("\n");

test("Cursorの利用上限は説明文ごと返し、画面をblockedにする", () => {
  assert.deepEqual(cursorUsageLimit(CURSOR_USAGE_LIMIT_SCREEN), {
    message: "You've hit your usage limit. You've saved $766 on API model usage this month with Ultra. Switch to a "
      + "different model or set a Spend Limit to continue with Sonnet. Your usage limits will reset when your monthly cycle ends on 10/17/2026.",
  });
  assert.deepEqual(cursorPaneObservation(CURSOR_USAGE_LIMIT_SCREEN), { state: "blocked", reason: "rate_limited" });
});

test("Cursorの利用上限の後に入力欄や実行中表示があれば、過去の履歴として扱う", () => {
  for (const later of [
    ["  → Add a follow-up", "", "  Auto · 13.4%                                                  Run Everything"],
    [" ⠘⠆ Working  72 tokens", "  → Add a follow-up                                             ctrl+c to stop"],
    [" \x1b[48;2;21;21;21m → 続けて\x1b[49m"],
  ]) {
    const screen = [CURSOR_USAGE_LIMIT_SCREEN, ...later].join("\n");
    assert.equal(cursorUsageLimit(screen), null);
    assert.notEqual(cursorPaneObservation(screen).reason, "rate_limited");
  }
  assert.equal(cursorUsageLimit("  You've hit your usage limit と書いた依頼文"), null);
});

// Cursor Agent v2026.09.26-dd393fe、fox（Windows、psmux）の実機画面 2026-09-27。
// spotter 1.7.3のUserPromptSubmit hookがBOM付きJSONを読めず、promptが捨てられた直後。
const CURSOR_HOOK_BLOCKED_SCREEN = [
  "  Cursor Agent",
  "  v2026.09.26-dd393fe",
  "  Tip: Use /mcp to connect Cursor to your tools and data sources.",
  "", "", "", "",
  "  → Plan, search, build anything",
  "", "",
  "  Auto                                                                                                  Run Everything",
  "  ~\\.cache\\aiterm-branch-test\\steer-test",
  "",
  "  Hook blocked with message: (node:26552) ExperimentalWarning: SQLite is an experimental feature and might change at",
  "  any time",
  "  (Use `node --trace-warnings ...` to show where the warning was created)",
  "  spotter: Error: hook stdin is not valid JSON: Unexpected token '\uFEFF', \"\uFEFF{\"convers\"... is not valid JSON",
  "      at readStdinJson",
  "  (file:///C:/Users/kite_/AppData/Roaming/npm/node_modules/claude-spotter/src/hooks/lib.mjs:109:17)",
  "", "", "",
].join("\n");

test("Cursorで送信前hookがpromptを拒否した画面を、hookの出力ごとblockedにする", () => {
  const blocked = cursorHookBlocked(CURSOR_HOOK_BLOCKED_SCREEN);
  assert.match(blocked.message, /^spotter: Error: hook stdin is not valid JSON/);
  assert.doesNotMatch(blocked.message, /ExperimentalWarning|trace-warnings/, "hookを動かしたNodeの警告は理由に含めない");
  const observed = cursorPaneObservation(CURSOR_HOOK_BLOCKED_SCREEN);
  assert.equal(observed.state, "blocked");
  assert.equal(observed.reason, "user_hook_blocked");
  assert.equal(observed.detail, blocked.message);
});

test("Cursorのhook拒否の後に実行中表示やfollow-up欄があれば、古い表示として扱う", () => {
  for (const later of [
    [" ⠘⠆ Working  72 tokens", "  → Add a follow-up                                             ctrl+c to stop"],
    ["  → Add a follow-up", "", "  Auto · 13.4%                                                  Run Everything"],
  ]) {
    const screen = [CURSOR_HOOK_BLOCKED_SCREEN, ...later].join("\n");
    assert.equal(cursorHookBlocked(screen), null);
    assert.notEqual(cursorPaneObservation(screen).reason, "user_hook_blocked");
  }
  // 拒否の表示が消えた後は、空の入力欄に戻っただけの画面。
  const cleared = CURSOR_HOOK_BLOCKED_SCREEN.split("\n").slice(0, 12).join("\n");
  assert.equal(cursorHookBlocked(cleared), null);
  assert.equal(cursorPaneObservation(cleared).state, "idle");
});

test("Cursorの送信前hookが動いている画面だけを、hookの実行中として見分ける", () => {
  // fox実機 2026-09-27: 送信直後、hookの結果が出るまでの画面。入力欄はまだ空の起動時表示のまま。
  const hooksRunning = [
    "  Cursor Agent",
    "  v2026.09.26-dd393fe",
    "  Reply with exactly SEND_OK.",
    "",
    " ⠰⠰ Working",
    "",
    "  → Plan, search, build anything",
    "",
    "  Auto                                                                                                  Run Everything",
    "  ~\\.cache\\aiterm-branch-test\\steer-test",
  ].join("\n");
  assert.equal(cursorPromptHooksRunning(hooksRunning), true);
  // turnが始まった後は「Add a follow-up」と「ctrl+c to stop」が出る。
  assert.equal(cursorPromptHooksRunning(" ⠘⠆ Working  72 tokens\n  → Add a follow-up                                             ctrl+c to stop"), false);
  assert.equal(cursorPromptHooksRunning(CURSOR_HOOK_BLOCKED_SCREEN), false);
  assert.equal(cursorPromptHooksRunning(CURSOR_HOOK_BLOCKED_SCREEN.split("\n").slice(0, 12).join("\n")), false);
});

// Claude Code のBellTeamコンテナ実画面（2026-09-28、tmux）。上限の知らせは入力欄の下の足元に出る。
const CLAUDE_RULE = "─".repeat(80);
const CLAUDE_USAGE_LIMIT_TRANSCRIPT = [
  "  ⎿  You've hit your session limit · resets 4:10pm (UTC)",
  "     Continuing automatically at 4:10pm · esc to cancel",
  "",
  "● Usage limit reached · continuing automatically at 4:10pm · esc or type",
  "  to cancel",
  "",
  "✻ Brewed for 46s · done 2:01 PM",
  "",
];
const CLAUDE_USAGE_LIMIT_SCREEN = [
  ...CLAUDE_USAGE_LIMIT_TRANSCRIPT,
  CLAUDE_RULE,
  "❯ ",
  CLAUDE_RULE,
  "  ⚠ Usage limit reached · continuing automatically at 4:10pm · esc to cancel",
  "  ⏵⏵ bypass permissions on (shift+tab to cycle)",
].join("\n");

// BellTeamコンテナ 2026-10-03 11:40 UTC: 入力待ちのClaudeの13席のうち8席がunknown/unrecognized_screenだった。
// 会話が長くなり、起動時の見出し「Claude Code」が取得範囲（直近200行）から流れ出ていた。
test("会話が長くて見出しが流れ出たClaude Codeも、入力欄の形で入力待ちと読む", () => {
  const rule = "─".repeat(80);
  const footer = "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents";
  const idle = ["● 作業は終わりました。", "", "✻ Brewed for 16m 51s · done 10:46 AM", rule, "❯ ", rule, footer].join("\n");
  assert.equal(claudeTuiReady(idle), true);
  assert.deepEqual(claudePaneObservation(idle), { state: "idle", reason: "composer_ready" });
  const shell = ["● 作業は終わりました。", rule, "❯ ", rule, "  ⏵⏵ bypass permissions on · 1 shell · ← for agents · ↓ to manage"].join("\n");
  assert.deepEqual(claudePaneObservation(shell), { state: "idle", reason: "composer_ready" });
  // 入力欄に文が入っていて複数行でも、すぐ上と下の罫線で見分ける。
  const typed = [rule, "❯ 1行目", "  2行目", rule, footer].join("\n");
  assert.deepEqual(claudePaneObservation(typed), { state: "idle", reason: "composer_ready" });
  // 実行中は今までどおりbusy。
  const busy = [rule, "❯ ", rule, "  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ← for agents"].join("\n");
  assert.deepEqual(claudePaneObservation(busy), { state: "busy", reason: "turn_running" });
  // 通常shellの❯と、罫線で挟まれていない❯は、Claude Codeの入力欄と数えない。
  assert.equal(claudeTuiReady("~/work\n❯ "), false);
  assert.equal(claudeTuiReady([rule, "何かの出力", "❯ "].join("\n")), false);
  assert.equal(claudeTuiReady(["出力", "❯ ls", rule].join("\n")), false);
});

// BellTeamコンテナ 2026-10-06、Claude Code 2.1.291の実画面。複数行のprompt（貼り付けの形）を送った後の約8秒は、足元の行が
// 「paste again to expand」へ置き換わり「esc to interrupt」が出ない。動いているのに入力待ちと読み、起動時promptの開始を
// 確認できなかった（submitted_unconfirmed）。動いている間は、入力欄の上に進行行が出続ける。
test("Claudeの足元が貼り付けの知らせに置き換わっていても、入力欄の上の進行行で動作中と読む", () => {
  const rule = "─".repeat(80);
  const pasted = [rule, "❯ ", rule, "  paste again to expand"];
  const busy = { state: "busy", reason: "turn_running" };
  const idle = { state: "idle", reason: "composer_ready" };
  const prompt = ["❯ 確認だけの小さな用件です。ファイルは何も変えないでください。", "", "  以上です。余計な説明は要りません。", ""];
  // 送った直後（利用者のhookが動いている間）。
  assert.deepEqual(claudePaneObservation([...prompt, "✢ Swirling… (running UserPromptSubmit hook · 0s)", "", ...pasted,
    "  tmux focus-events off · add 'set -g focus-events on' to ~/.tmux.conf and re…"].join("\n")), busy);
  // 経過時間がまだ出ていない進行行。
  assert.deepEqual(claudePaneObservation([...prompt, "* Swirling…                                     ", "", ...pasted].join("\n")), busy);
  // 道具を動かしている間。
  assert.deepEqual(claudePaneObservation([...prompt, "  Bash(node -e \"setTimeout(() => console.log(6*7), 7000)\")", "  ⎿  Running…", "",
    "* Slithering… (3s · ↓ 200 tokens · thought for 2s)", "", ...pasted].join("\n")), busy);
  // 作業の一覧を使う時は、進行行が進行中の項目の文になり、一覧が進行行と入力欄の間へ字下げで並ぶ。
  assert.deepEqual(claudePaneObservation(["● 了解しました。まず TaskCreate", "  で作業を登録します。", "",
    "✻ コマンド実行中… (11s · ↓ 846 tokens · thinking)", "  ⎿  ◼ 下の命令を1回だけ動かす", "     ◻ 終わったら答える", "", ...pasted].join("\n")), busy);
  // 終わりのhookが動いている間（括弧の中にも「…」がある）。
  assert.deepEqual(claudePaneObservation(["● START_OK", "",
    "✻ Simmering… (running Stop hooks… 2/3 · 23s · ↓ 1.4k tokens · thinking)", "  ⎿  ✔ 下の命令を1回だけ動かす", "     ✔ 終わったら答える", "", ...pasted].join("\n")), busy);

  // 終わった後は、同じ位置が完了の行に変わる。入力待ち。
  const footer = "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents";
  assert.deepEqual(claudePaneObservation(["● START_OK", "", "✻ Cogitated for 11s · done 4:45 AM", "", rule, "❯ ", rule, footer].join("\n")), idle);
  assert.deepEqual(claudePaneObservation(["● START_OK", "", "✻ Worked for 23s · done 4:46 AM", "", "  2 tasks (2 done, 0 open)",
    "  ✔ 下の命令を1回だけ動かす", "  ✔ 終わったら答える", "", rule, "❯ ", rule,
    "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ctrl+t to hide tasks · ← fo…"].join("\n")), idle);
  // 貼り付けの知らせが残ったまま終わった時も、入力待ち。
  assert.deepEqual(claudePaneObservation(["● START_OK", "", "✻ Cogitated for 2s · done 4:45 AM", "", ...pasted].join("\n")), idle);
  // 会話欄の行は進行行と数えない: 「…」で終わる回答、依頼文や回答の中の箇条書き（字下げされる）、古い進行行の引用。
  assert.deepEqual(claudePaneObservation(["● テストを流しています…", "", rule, "❯ ", rule, footer].join("\n")), idle);
  assert.deepEqual(claudePaneObservation(["❯ 次の行を見て", "  * Thinking… (3s · thinking)", "", "● 見ました。", "  ✻ Slithering… (3s · ↓ 200 tokens)",
    "", "✻ Brewed for 4s · done 4:50 AM", "", rule, "❯ ", rule, footer].join("\n")), idle);
  // 入力欄の形が無い画面（通常shellの❯）では、進行行の形の行があっても数えない。
  assert.equal(claudePaneObservation(["* Building… (3s)", "", "~/work", "❯ "].join("\n")).state, "unknown");
});

test("Claudeの利用上限は入力欄の下の知らせから返す", () => {
  assert.deepEqual(claudeUsageLimit(CLAUDE_USAGE_LIMIT_SCREEN), {
    message: "Usage limit reached · continuing automatically at 4:10pm",
  });
  // 色付きの描画でも同じ。
  assert.deepEqual(claudeUsageLimit(CLAUDE_USAGE_LIMIT_SCREEN.replace("  ⚠ Usage", "  \x1b[38;5;231m⚠ Usage")), {
    message: "Usage limit reached · continuing automatically at 4:10pm",
  });
});

// 2026-10-06: 会話欄に「esc to interrupt」の語があると、止まっているClaudeを動作中と読んでいた。Aitermの中身を話している席は、
// 止まった後も画面にこの語が残る。動作中の印は、Claude Codeが自分で出す足元の行と進行行だけにある。
test("Claudeの会話欄や打ちかけの文にある「esc to interrupt」を、動作中の印にしない", () => {
  const footer = "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents";
  const idle = (...conversation) => [...conversation, "", "✻ Cooked for 1m 15s · done 20:31", CLAUDE_RULE, "❯ ", CLAUDE_RULE, footer].join("\n");
  // 回答の行、回答の続きの行、依頼文、道具の出力。
  for (const conversation of [
    ["● 足元の行に esc to interrupt が出ている間は動作中と読みます。"],
    ["● 画面の読み方は次のとおりです。", "  足元に「esc to interrupt」が無ければ入力待ちです。"],
    ["❯ esc to interrupt という語が画面にあると busy になるのはなぜ？", "", "● 末尾32行を見ているためです。"],
    ["> esc to interrupt の件を調べて"],
    // macOSのClaude Code（2.1.289の実画面）は、回答の印が「⏺」になる。
    ["  Ran 1 shell command", "", "⏺ REMOTE_START_OK the footer shows esc to interrupt while a turn runs"],
    ["● Bash(grep -rn \"esc to interrupt\" src)", "  ⎿  src/harnesses/claude.ts:373:  return /esc to interrupt/i.test(screen)"],
  ]) {
    assert.deepEqual(claudePaneObservation(idle(...conversation)), { state: "idle", reason: "composer_ready" }, conversation.join(" / "));
  }
  // 入力欄へ打ちかけの文（1行目と続きの行）。
  const typed = ["● 終わりました。", CLAUDE_RULE, "❯ esc to interrupt を見て", "  esc to interrupt をもう一度", CLAUDE_RULE, footer].join("\n");
  assert.deepEqual(claudePaneObservation(typed), { state: "idle", reason: "composer_ready" });
  // 動いている間の印は、今までどおり読む。足元の行（会話欄に同じ語があっても）。
  const running = ["● esc to interrupt の話をしています。", "", CLAUDE_RULE, "❯ ", CLAUDE_RULE,
    "  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ← for agents"].join("\n");
  assert.deepEqual(claudePaneObservation(running), { state: "busy", reason: "turn_running" });
  // 古い版の進行行（入力欄の上、行頭から始まる）。
  for (const progress of ["✻ Musing… (esc to interrupt)", "* Herding… (3s · esc to interrupt)", "· Running stop hooks… (esc to interrupt)"]) {
    const old = ["● 調べています。", "", progress, "", CLAUDE_RULE, "❯ ", CLAUDE_RULE, footer].join("\n");
    assert.deepEqual(claudePaneObservation(old), { state: "busy", reason: "turn_running" }, progress);
  }
  // 入力欄の無い画面は、今までどおり末尾のどこにあっても動作中。
  assert.equal(claudeTuiBusy("Claude Code\n✻ Musing… (esc to interrupt)\n❯ "), true);
  assert.equal(claudeTuiBusy("Claude Code\n  esc to interrupt"), true);
});

test("Claudeの足元が描き直された後は、会話欄や依頼文に残る上限の文を数えない", () => {
  // 上限が明けて次のturnが走っている画面。会話欄の「● Usage limit reached」は残っている。
  const running = [
    ...CLAUDE_USAGE_LIMIT_TRANSCRIPT,
    "❯ 「トロニー」からあなたへ: wait_processが rate_limited（\"Usage limit reached · continuing",
    "  automatically at 4:10pm\"）を返してた",
    "",
    "✶ Wrangling… (5s · ↓ 402 tokens)",
    "",
    CLAUDE_RULE,
    "❯ ",
    CLAUDE_RULE,
    "  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ← for ag…",
  ].join("\n");
  assert.equal(claudeUsageLimit(running), null);
  // 入力欄へ打ちかけの依頼文に上限の文があっても、枠線の内側なので数えない。
  const typing = [CLAUDE_RULE, "❯ Usage limit reached と出たら教えて", CLAUDE_RULE,
    "  ⏵⏵ bypass permissions on (shift+tab to cycle)"].join("\n");
  assert.equal(claudeUsageLimit(typing), null);
  assert.equal(claudeUsageLimit("● Usage limit reached · continuing automatically at 4:10pm"), null);
});

test("Codexのturnエラーはtask_completeのerrorから読み、利用上限はcodex_error_infoで見分ける", () => {
  const done = (error) => ({ type: "event_msg", payload: { type: "task_complete", turn_id: "t", last_agent_message: null, error } });
  const message = "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 8th, 2026 12:35 PM.";
  assert.equal(codexUsageLimit(done({ message, codex_error_info: "usage_limit_exceeded" })), message);
  assert.deepEqual(codexTurnError(done({ message, codex_error_info: "usage_limit_exceeded" })), { message, info: "usage_limit_exceeded" });
  // 値を持つ種類は{"種類":{…}}で書かれる。
  assert.deepEqual(codexTurnError(done({ message: "boom", codex_error_info: { http_connection_failed: { http_status_code: 502 } } })),
    { message: "boom", info: "http_connection_failed" });
  assert.equal(codexUsageLimit(done({ message: "slow down", codex_error_info: "rate_limit_exceeded" })), null);
  assert.equal(codexTurnError(done(null)), null);
  assert.equal(codexUsageLimit({ type: "event_msg", payload: { type: "token_count", rate_limits: { primary: { used_percent: 100 } } } }), null);
  assert.equal(codexUsageLimit({ type: "response_item", payload: { type: "function_call_output", output: message } }), null);
});

test("Codexのturnエラーの文は、応答の本文とURLを落とした1行にする", () => {
  const line = (message, info = "other") => codexTurnErrorLine({ message, info });
  // 実物（2026-10-07、codex 0.160.1、偽のmodelの401）: 状態の後ろに応答の文とURLが続く。
  assert.equal(line("unexpected status 401 Unauthorized: fixture: token expired, url: http://127.0.0.1:43221/v1/responses", "http_connection_failed"),
    "unexpected status 401 Unauthorized");
  assert.equal(line("unexpected status 502 Bad Gateway: <html>\n<body>secret-token=abc</body>\n</html>, url: https://example.test/v1, cf-ray: 1, request id: 2"),
    "unexpected status 502 Bad Gateway");
  // Codex自身の文はそのまま。
  assert.equal(line("We’re currently experiencing high demand, which may cause temporary errors.", "internal_server_error"),
    "We’re currently experiencing high demand, which may cause temporary errors.");
  assert.equal(line("stream disconnected before completion: Transport error: network error: error decoding response body"),
    "stream disconnected before completion: Transport error: network error: error decoding response body");
  // ほかの文に混ざったURLは伏せ、改行は畳み、長さを切る。
  assert.equal(line("stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses?key=abc)\n  caused by: timeout"),
    "stream disconnected before completion: error sending request for url (…) caused by: timeout");
  const long = line("x".repeat(500));
  assert.equal(long.length, 200);
  assert.ok(long.endsWith("…"));
});
