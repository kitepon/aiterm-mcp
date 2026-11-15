import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
// harness-contracts.md "ExitPlanModeの承認": the hook answers only the ExitPlanMode permission request, and only inside an Aiterm seat.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const { planApproval } = await import("../dist/claude-plan-approve-hook.js");
const HOOK = path.join(import.meta.dirname, "..", "dist", "claude-plan-approve-hook.js");
const seat = { AITERM_SESSION_ID: "seat" };
const exitPlan = { hook_event_name: "PermissionRequest", tool_name: "ExitPlanMode", tool_input: { plan: "# Plan", planFilePath: "/p.md" } };

test("ExitPlanMode in an Aiterm seat is allowed as option 1, with the call's own input and the seat's bypass mode", () => {
  assert.deepEqual(planApproval(exitPlan, seat), { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: {
    behavior: "allow", updatedInput: { plan: "# Plan", planFilePath: "/p.md" },
    updatedPermissions: [{ type: "setMode", mode: "bypassPermissions", destination: "session" }] } } });
});

test("anything that does not match exactly gets no decision", () => {
  for (const [what, payload, env] of [
    ["another tool", { ...exitPlan, tool_name: "Bash" }, seat],
    ["AskUserQuestion", { ...exitPlan, tool_name: "AskUserQuestion", tool_input: { questions: [] } }, seat],
    ["another hook event", { ...exitPlan, hook_event_name: "PreToolUse" }, seat],
    ["a plan that is not text", { ...exitPlan, tool_input: { plan: 3 } }, seat],
    ["no input", { ...exitPlan, tool_input: undefined }, seat],
    ["not an Aiterm seat", exitPlan, {}],
    ["null", null, seat], ["a string", "ExitPlanMode", seat],
  ]) assert.equal(planApproval(payload, env), null, what);
});

test("run as the hook: stdout is the decision for ExitPlanMode and empty for everything else, always exit 0", () => {
  const run = (input, env) => spawnSync(process.execPath, [HOOK], { input, encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
  const hit = run(JSON.stringify(exitPlan), seat);
  assert.equal(hit.status, 0);
  assert.equal(JSON.parse(hit.stdout).hookSpecificOutput.decision.behavior, "allow");
  for (const [input, env] of [[JSON.stringify({ ...exitPlan, tool_name: "Write" }), seat], ["{broken", seat], ["", seat], [JSON.stringify(exitPlan), {}]]) {
    const miss = run(input, env);
    assert.equal(miss.status, 0); assert.equal(miss.stdout, "");
  }
});
