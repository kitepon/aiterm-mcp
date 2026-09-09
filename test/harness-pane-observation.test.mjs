import assert from "node:assert/strict";
import test from "node:test";
import { grokPaneObservation, grokEnvTokens } from "../dist/harnesses/grok.js";
import { codexPaneObservation, codexApprovalDialog, codexStartupAction } from "../dist/harnesses/codex.js";
import { claudeStartupAction, claudePaneObservation } from "../dist/harnesses/claude.js";
import { paneTokenHint } from "../dist/harnesses/pane-tokens.js";

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
