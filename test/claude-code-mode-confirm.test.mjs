// Code Mode's first-start confirm (CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1, Claude Code 2.1.327; a442c) draws its two choices without an index,
// the cursor first on "No, start without it". Aiterm used to read the lowest ❯ row as an idle composer. Layout rebuilt from the screen
// part inside the 2.1.327 executable (Select: hideIndexes, cancelFirst, focus cancel; foot "Enter to confirm · Esc to start without it").
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentPaneObservation, isAgentTuiIdleReady, waitAgentTuiReadyImpl } from "../dist/agent-screen-observation.js";
import { claudeCodeModeConfirm, claudeLiveSelectMenu, claudePaneObservation, claudeStartupAction } from "../dist/harnesses/claude.js";
import { wantsCodeMode } from "../dist/settings-env.js";

const RULE = "────────────────";
const dialog = (cursor = "No") => [
  "Welcome to Claude Code v2.1.327",
  "",
  "  Code Mode (experimental)",
  "  In Code Mode, Claude works by writing and running JavaScript that calls its tools, instead of calling them one at a time.",
  "  This is an early experiment. It can behave differently from normal Claude Code, and it may change or be removed in any release.",
  "",
  `  ${cursor === "No" ? "❯" : " "} No, start without it`,
  `  ${cursor === "Yes" ? "❯" : " "} Yes, turn on Code Mode`,
  "",
  "  Tell us how it goes with /feedback",
  "  Enter to confirm · Esc to start without it",
].join("\n");
const composer = ["Claude Code v2.1.327", "● 直前の回答", RULE, "❯ ", RULE, "  ⏵⏵ bypass permissions on (shift+tab to cycle)"].join("\n");

test("Code Mode's confirm is a blocked dialog, never composer_ready, whichever row the cursor is on", () => {
  for (const cursor of ["No", "Yes"]) {
    const screen = dialog(cursor);
    assert.equal(claudeCodeModeConfirm(screen), true, cursor);
    assert.equal(claudeLiveSelectMenu(screen)?.kind, "unknown", cursor);
    assert.deepEqual(claudePaneObservation(screen), { state: "blocked", reason: "unknown_dialog" }, cursor);
    assert.deepEqual(agentPaneObservation("claude", screen), { state: "blocked", reason: "unknown_dialog" }, cursor);
    assert.equal(isAgentTuiIdleReady("claude", screen), false, cursor);
  }
  assert.equal(claudeCodeModeConfirm(dialog("No").replaceAll("❯", ">")), true, "a terminal that draws > for the cursor");
});

test("a seat that only talks about the confirm, or that moved on to its composer, stays idle", () => {
  const talk = ["● Claude Code asks: ", "    No, start without it", "    Yes, turn on Code Mode", "    Enter to confirm · Esc to start without it", RULE, "❯ ", RULE].join("\n");
  assert.equal(claudeCodeModeConfirm(talk), false);
  assert.equal(claudeCodeModeConfirm(composer), false);
  assert.deepEqual(claudePaneObservation(composer), { state: "idle", reason: "composer_ready" });
  // one row alone (a quote, or a half-drawn frame) is not the dialog
  assert.equal(claudeCodeModeConfirm(dialog("No").replace("  Yes, turn on Code Mode\n", "")), false);
});

test("a launch that meets the confirm stops waiting at once instead of reaching the ready deadline", async () => {
  let clock = 0;
  const result = await waitAgentTuiReadyImpl("claude", () => dialog("No"), async ms => { clock += ms; }, { timeoutMs: 30000, now: () => clock });
  assert.equal(result.ready, false);
  assert.equal(result.samples, 1);
  assert.equal(clock, 0);
});

test("a442h: only a launch that asked for Code Mode is answered, only on exactly this confirm, by moving to Yes first", () => {
  const no = claudeStartupAction(dialog("No"), false, true);
  assert.equal(no.kind, "code_mode_enabled");
  assert.deepEqual(no.keys, ["Down", "Enter"]);
  assert.match("❯ Yes, turn on Code Mode", no.selected);
  assert.doesNotMatch("❯ No, start without it", no.selected);
  assert.deepEqual(claudeStartupAction(dialog("Yes"), false, true).keys, ["Enter"], "a cursor already on Yes needs Enter only");
  assert.deepEqual(claudeStartupAction(dialog("Yes").replaceAll("❯", ">"), false, true).keys, ["Enter"]);
  // without the caller's request, or on any other screen, nothing is answered
  assert.equal(claudeStartupAction(dialog("No"), false), null);
  assert.equal(claudeStartupAction(dialog("No"), true), null);
  assert.equal(claudeStartupAction(dialog("No").replace("  Yes, turn on Code Mode\n", ""), false, true), null);
  assert.equal(claudeStartupAction(composer, true, true), null);
  assert.equal(claudeStartupAction(["● quoting", "    No, start without it", "    Yes, turn on Code Mode", RULE, "❯ ", RULE].join("\n"), true, true), null);
});

test("wantsCodeMode is true only for CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1", () => {
  assert.equal(wantsCodeMode({ CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: "1" }), true);
  for (const other of [undefined, null, {}, { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: "0" }, { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: "true" }, { OTHER: "1" }])
    assert.equal(wantsCodeMode(other), false, JSON.stringify(other));
});
