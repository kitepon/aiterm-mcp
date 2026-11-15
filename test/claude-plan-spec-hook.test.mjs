import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
// harness-contracts.md "EnterPlanModeの前に仕様を書かせる": the hook turns the first spec-less EnterPlanMode of a prompt back, once.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "plan-spec-hook-"));
process.env.AITERM_STATE_BASE = base;
const agents = path.join(base, `aiterm-mcp-${process.getuid?.() ?? 0}`, "agents");
fs.mkdirSync(agents, { recursive: true });
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

const { planSpecDecision, specEvidence } = await import("../dist/claude-plan-spec-hook.js");
const HOOK = path.join(import.meta.dirname, "..", "dist", "claude-plan-spec-hook.js");
const seat = { AITERM_SESSION_ID: "seat", AITERM_AGENT_LAUNCH_ID: "launch" };
const fast = { waitMs: 150, pollMs: 25 };
const SPEC = "計画したい内容: ログイン画面の入力検証を直す。範囲は src/login の中だけで、既存の公開契約と他の画面は変えない。守る条件は、今ある試験を壊さない事。終わりの形は、新しい試験が通り、空のパスワードが断られる事。";

const row = (messageId, ...content) => JSON.stringify({ type: "assistant", message: { id: messageId, content } });
const user = (content) => JSON.stringify({ type: "user", message: { role: "user", content } });
const result = () => user([{ type: "tool_result", tool_use_id: "x", content: "ok" }]);
const text = (value) => ({ type: "text", text: value });
const toolUse = (id) => ({ type: "tool_use", id, name: "EnterPlanMode", input: {} });
const transcriptFile = (...lines) => {
  const file = path.join(base, `t-${Math.random().toString(16).slice(2)}.jsonl`);
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
};
let promptCounter = 0;
const call = (transcript_path, extra = {}) => ({ hook_event_name: "PreToolUse", tool_name: "EnterPlanMode", tool_input: {}, session_id: "s",
  prompt_id: `p${promptCounter += 1}`, tool_use_id: "toolu_1", transcript_path, ...extra });
const denied = (decision) => decision?.hookSpecificOutput?.permissionDecision === "deny";

test("specEvidence counts the assistant text of this prompt up to the call, and says whether the call's row is readable", () => {
  const ev = (rows, id = "t1") => specEvidence(rows.join("\n"), id);
  assert.deepEqual(ev([user("go"), row("m1", text("abc"), toolUse("t1"))]), { visible: true, chars: 3 });
  assert.deepEqual(ev([user("go"), row("m1", { type: "thinking", thinking: "x" }), row("m1", text(SPEC)), row("m1", toolUse("t1"))]), { visible: true, chars: SPEC.length });
  assert.deepEqual(ev([user("go"), row("m0", text("older")), result(), row("m1", toolUse("t1"))]), { visible: true, chars: 5 }, "an earlier message of the same prompt counts; a tool_result row does not end the prompt");
  assert.deepEqual(ev([row("m0", text("before the prompt")), user([{ type: "text", text: "go" }]), row("m1", toolUse("t1"))]), { visible: true, chars: 0 }, "text before the last real prompt does not count");
  assert.deepEqual(ev([user("go"), row("m1", text("abcd")), JSON.stringify({ type: "attachment" }), row("m1", toolUse("t1"))]), { visible: true, chars: 4 }, "a bookkeeping row is skipped");
  assert.deepEqual(ev([user("go"), row("m1", text("after"), toolUse("t2"))]), { visible: false, chars: 5 }, "the call's row is not there yet; earlier text still counts");
  assert.deepEqual(specEvidence("{broken\n" + [user("go"), row("m1", text("ok"), toolUse("t1"))].join("\n"), "t1"), { visible: true, chars: 2 }, "a foreign line is skipped");
});

test("a spec of 80+ characters written before the call lets it through", async () => {
  const file = transcriptFile(user("go"), row("m1", text(SPEC)), row("m1", toolUse("toolu_1")));
  assert.equal(await planSpecDecision(call(file), seat, fast), null);
});

test("a spec written in an earlier message of the prompt lets it through even when the call's own row is not readable (2.1.325 interactive)", async () => {
  const file = transcriptFile(user("go"), row("m0", text(SPEC)), result());
  assert.equal(await planSpecDecision(call(file), seat, fast), null);
});

test("no spec: turned back once with the instruction; the second call of the same prompt is never turned back", async () => {
  const file = transcriptFile(user("go"), row("m1", toolUse("toolu_1")));
  const payload = call(file);
  const first = await planSpecDecision(payload, seat, fast);
  assert.ok(denied(first));
  assert.match(first.hookSpecificOutput.permissionDecisionReason, /EnterPlanMode/);
  assert.equal(await planSpecDecision(payload, seat, fast), null, "self-exit");
  assert.ok(denied(await planSpecDecision(call(file), seat, fast)), "a new prompt_id is turned back again");
});

test("the tool_use that shows up a little later is waited for", async () => {
  const file = transcriptFile(user("go"));
  setTimeout(() => fs.appendFileSync(file, row("m1", text(SPEC)) + "\n" + row("m1", toolUse("toolu_1")) + "\n"), 60);
  assert.equal(await planSpecDecision(call(file), seat, { waitMs: 1000, pollMs: 25 }), null);
});

test("the call's row is never readable and no earlier text: turned back once, as written-is-unknown", async () => {
  assert.ok(denied(await planSpecDecision(call(transcriptFile(user("go"))), seat, fast)));
});

test("anything unexpected gets no decision", async () => {
  const file = transcriptFile(user("go"), row("m1", toolUse("toolu_1")));
  const good = call(file);
  for (const [what, payload, env] of [
    ["another tool", { ...good, tool_name: "Bash" }, seat],
    ["another hook event", { ...good, hook_event_name: "PermissionRequest" }, seat],
    ["not an Aiterm seat", good, {}],
    ["no seat/launch id for the state file", good, { AITERM_AGENT_KIND: "claude" }],
    ["no prompt_id", { ...good, prompt_id: undefined }, seat],
    ["no transcript", { ...good, transcript_path: undefined }, seat],
    ["a transcript that is not there", { ...good, transcript_path: path.join(base, "none.jsonl") }, seat],
    ["a relative transcript path", { ...good, transcript_path: "t.jsonl" }, seat],
    ["null", null, seat], ["a string", "EnterPlanMode", seat],
  ]) assert.equal(await planSpecDecision(payload, env, fast), null, what);
});

test("a state file that cannot be written lets the call through (the second call could not be let through otherwise)", async () => {
  const blocked = { AITERM_SESSION_ID: "no/such/dir", AITERM_AGENT_LAUNCH_ID: "launch" };
  assert.equal(await planSpecDecision(call(transcriptFile(user("go"), row("m1", toolUse("toolu_1")))), blocked, fast), null);
});

test("run as the hook: stdout is the decision on a turn-back and empty otherwise, always exit 0", () => {
  const run = (input, env) => spawnSync(process.execPath, [HOOK], { input, encoding: "utf8",
    env: { PATH: process.env.PATH, AITERM_STATE_BASE: base, ...env } });
  const file = transcriptFile(user("go"), row("m1", text(SPEC)), row("m1", toolUse("toolu_1")));
  const noSpec = transcriptFile(user("go"), row("m1", toolUse("toolu_1")));
  const pass = run(JSON.stringify(call(file)), seat);
  assert.equal(pass.status, 0); assert.equal(pass.stdout, "");
  const hit = run(JSON.stringify(call(noSpec)), seat);
  assert.equal(hit.status, 0);
  assert.equal(JSON.parse(hit.stdout).hookSpecificOutput.permissionDecision, "deny");
  for (const [input, env] of [["{broken", seat], ["", seat], [JSON.stringify(call(noSpec)), {}]]) {
    const miss = run(input, env);
    assert.equal(miss.status, 0); assert.equal(miss.stdout, "");
  }
});
