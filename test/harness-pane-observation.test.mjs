import assert from "node:assert/strict";
import test from "node:test";
import { grokPaneObservation, grokEnvTokens } from "../dist/harnesses/grok.js";
import { codexHelperProcess, codexPaneObservation, codexApprovalDialog, codexRateLimitModelSwitchDialog, codexStartupAction, codexTurnError, codexUsageLimit } from "../dist/harnesses/codex.js";

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
import { claudeStartupAction, claudePaneObservation, claudeTuiReady, claudeUsageLimit } from "../dist/harnesses/claude.js";
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

test("Claudeの利用上限は入力欄の下の知らせから返す", () => {
  assert.deepEqual(claudeUsageLimit(CLAUDE_USAGE_LIMIT_SCREEN), {
    message: "Usage limit reached · continuing automatically at 4:10pm",
  });
  // 色付きの描画でも同じ。
  assert.deepEqual(claudeUsageLimit(CLAUDE_USAGE_LIMIT_SCREEN.replace("  ⚠ Usage", "  \x1b[38;5;231m⚠ Usage")), {
    message: "Usage limit reached · continuing automatically at 4:10pm",
  });
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
