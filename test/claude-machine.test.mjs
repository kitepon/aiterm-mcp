// a471 (ruling 13): Claude machine seat. The host only holds claude -p stream-json: claude's stdout lines go unchanged to the stream file,
// the input file's lines go unchanged to claude's stdin, and the state is derived from the events. Aiterm reads and sends them as data.
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { claudeMachineMarker, claudeMachineMarkerLine } from "../dist/claude-machine.js";
import { ClaudeMachineHost, parseHostArgs } from "../dist/claude-machine-host.js";
import { appendClaudeInput, readClaudeStream, claudeMachineView, claudeMachineObserverScreen, readClaudeStreamLine } from "../dist/claude-machine-stream.js";
import { claudePaneObservation, claudeTuiBusy, claudeTuiReady, claudeAgentArgv, buildClaudeAgentCmd, claudeResumeArgv, agentClaudeMachineFilePath } from "../dist/harnesses/claude.js";
import { agentsDir } from "../dist/agent-shared.js";
import { agentResumeRecipeSchema } from "../dist/agent-lifecycle.js";

const RULE = "────────────────";
const tuiComposer = ["Claude Code v2.1.327", "● 直前の回答", RULE, "❯ ", RULE, "  ⏵⏵ bypass permissions on (shift+tab to cycle)"].join("\n");

test("the observer line carries the host's state to the screen-based observers; a TUI screen is never mistaken for it", () => {
  assert.deepEqual(claudeMachineMarker(claudeMachineMarkerLine("blocked", "tool_approval")), { state: "blocked", reason: "tool_approval" });
  assert.equal(claudeMachineMarker("● [aiterm-machine] state=idle\n  [aiterm-machine] state=idle"), null);
  assert.equal(claudeMachineMarker(tuiComposer), null);
  assert.deepEqual(claudePaneObservation("[aiterm-machine] state=idle"), { state: "idle", reason: "composer_ready" });
  assert.deepEqual(claudePaneObservation("[aiterm-machine] state=busy"), { state: "busy", reason: "turn_running" });
  assert.deepEqual(claudePaneObservation("[aiterm-machine] state=blocked reason=unknown_dialog"), { state: "blocked", reason: "unknown_dialog" });
  assert.equal(claudePaneObservation("[aiterm-machine] state=exited").reason, "harness_exited");
  assert.equal(claudeTuiReady("[aiterm-machine] state=idle"), true);
  assert.equal(claudeTuiBusy("[aiterm-machine] state=busy"), true);
  assert.deepEqual(claudePaneObservation(tuiComposer), { state: "idle", reason: "composer_ready" });
});

const makeHost = (options) => {
  const toClaude = [], stream = [], states = [];
  let n = 0;
  const host = new ClaudeMachineHost({ toClaude: l => toClaude.push(JSON.parse(l)), appendStream: l => stream.push(l), writeState: s => states.push(s),
    id: () => `id${++n}`, now: () => "2026-11-20T00:00:00.000Z" }, options);
  const child = o => host.onChildLine(typeof o === "string" ? o : JSON.stringify(o));
  const last = () => states.at(-1);
  const ready = () => { host.start(); child({ type: "control_response", response: { subtype: "success", request_id: toClaude[0].request_id } }); };
  return { host, toClaude, stream, states, child, last, ready };
};
const input = (host, o) => { const line = JSON.stringify(o); host.onInputLine(line, Buffer.byteLength(line) + 1); };

test("host: initialize, then the thinking request; the initialize reply is the ready signal", () => {
  const { host, toClaude, last, ready } = makeHost();
  host.start();
  assert.equal(toClaude[0].request.subtype, "initialize");
  assert.equal(last().state, "starting");
  host.onChildLine(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: toClaude[0].request_id } }));
  assert.equal(last().state, "idle");
  assert.deepEqual(toClaude[1].request, { subtype: "set_max_thinking_tokens", max_thinking_tokens: null, thinking_display: "summarized" });
  void ready;
});

test("host: every claude line reaches the stream unchanged, in order, even one it does not understand", () => {
  const { stream, child, ready } = makeHost();
  ready();
  const lines = ['{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}', '{"type":"future_kind","x":[1,2]}', "not json at all"];
  for (const l of lines) child(l);
  assert.deepEqual(stream.slice(-3), lines);
});

test("host: the caller's line goes to claude unchanged and makes the seat busy; result and its Stop hooks make it idle", () => {
  const { host, toClaude, child, last, ready } = makeHost();
  ready();
  const user = { type: "user", message: { role: "user", content: "go" }, parent_tool_use_id: null, uuid: "u1" };
  input(host, user);
  assert.deepEqual(toClaude.at(-1), user);
  assert.equal(last().state, "busy");
  child({ type: "system", subtype: "hook_started", hook_event: "Stop", hook_id: "h1" });
  child({ type: "result", subtype: "success", terminal_reason: "completed", user_message_uuids: ["u1"] });
  assert.equal(last().state, "busy", "the Stop hook has not answered");
  child({ type: "system", subtype: "hook_response", hook_event: "Stop", hook_id: "h1" });
  assert.equal(last().state, "idle");
  assert.equal(last().last_result.terminal_reason, "completed");
  assert.ok(last().input_bytes_consumed > 0);
});

test("host: a turn that starts without input (asyncRewake) is busy; an interrupt records its end", () => {
  const { host, child, last, ready } = makeHost();
  ready();
  child({ type: "assistant", message: { content: [{ type: "text", text: "woken" }] } });
  assert.equal(last().state, "busy");
  input(host, { type: "control_request", request_id: "i1", request: { subtype: "interrupt" } });
  child({ type: "result", subtype: "error_during_execution", terminal_reason: "aborted_tools", is_error: true });
  assert.equal(last().state, "idle");
  assert.equal(last().last_result.terminal_reason, "aborted_tools");
});

test("host: a can_use_tool request blocks the seat with its place in the stream; the caller's control_response releases it", () => {
  const { host, toClaude, stream, child, last, ready } = makeHost();
  ready();
  input(host, { type: "user", message: { role: "user", content: "ask" } });
  child({ type: "assistant", message: { content: [] } });
  const request = JSON.stringify({ type: "control_request", request_id: "q1", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input: { questions: [] } } });
  const before = stream.reduce((n, l) => n + Buffer.byteLength(l) + 1, 0);
  child(request);
  assert.equal(last().state, "blocked");
  assert.equal(last().reason, "unknown_dialog");
  assert.deepEqual(last().pending, [{ request_id: "q1", subtype: "can_use_tool", tool_name: "AskUserQuestion", stream_offset: before, stream_end: before + Buffer.byteLength(request) + 1 }]);
  input(host, { type: "control_response", response: { subtype: "success", request_id: "q1", response: { behavior: "allow", updatedInput: {} } } });
  assert.equal(last().state, "busy");
  assert.deepEqual(last().pending, []);
  assert.equal(toClaude.at(-1).type, "control_response");
  child({ type: "control_request", request_id: "b1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } });
  assert.equal(last().reason, "tool_approval");
});

test("host: ExitPlanMode is allowed as the hook does; a fork's AskUserQuestion is denied at once, so a fork never holds", () => {
  const plain = makeHost();
  plain.ready();
  plain.child({ type: "control_request", request_id: "p1", request: { subtype: "can_use_tool", tool_name: "ExitPlanMode", input: { plan: "x" } } });
  assert.equal(plain.toClaude.at(-1).response.response.behavior, "allow");
  assert.equal(plain.last().state, "idle");
  const fork = makeHost({ denyQuestions: true });
  fork.ready();
  fork.child({ type: "control_request", request_id: "f1", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input: { questions: [{ question: "?" }] } } });
  assert.equal(fork.toClaude.at(-1).response.response.behavior, "deny");
  assert.notEqual(fork.last().state, "blocked");
  assert.deepEqual(fork.last().pending, []);
});

test("host: a first prompt is sent once after initialize; the claude exit is reported", () => {
  const { host, toClaude, last } = makeHost();
  host.firstPrompt = "first";
  host.start();
  host.onChildLine(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: toClaude[0].request_id } }));
  assert.equal(toClaude.filter(l => l.type === "user" && l.message.content === "first").length, 1);
  host.onChildExit();
  assert.equal(last().state, "exited");
  assert.equal(last().exited, true);
});

test("host arguments split the host's own flags from the claude command", () => {
  const args = parseHostArgs(["--stream-file", "/s", "--input-file", "/i", "--state-file", "/t", "--deny-questions", "--", "claude", "--model", "m"]);
  assert.deepEqual(args.claude, ["claude", "--model", "m"]);
  assert.equal(args.flag("--stream-file"), "/s");
  assert.equal(args.has("--deny-questions"), true);
  assert.equal(args.has("--replay-user-messages"), false);
});

// ---- the stream module: a real seat's files in the isolated state dir ----
const seat = () => ({ aiterm_session: "tstream", launch_id: "c".repeat(32) });
const place = (s, kind, text) => { fs.mkdirSync(agentsDir(), { recursive: true }); fs.writeFileSync(agentClaudeMachineFilePath(s.aiterm_session, s.launch_id, kind), text); };
const stateOf = (extra = {}) => JSON.stringify({ schema: "aiterm.claude-machine-state.v1", state: "idle", reason: null, pending: [], input_bytes_consumed: 0, last_result: null, exited: false, at: "t1", ...extra });

test("stream_read returns whole lines unchanged with an opaque cursor, resumes from it, and refuses another launch's cursor", async () => {
  const s = seat();
  place(s, "stream", '{"a":1}\n{"b":2}\n{"c":3}\n{"partial');
  place(s, "state", stateOf());
  const first = await readClaudeStream(s, { max_lines: 2 });
  assert.deepEqual(first.lines, ['{"a":1}', '{"b":2}']);
  assert.equal(first.at_end, false);
  const second = await readClaudeStream(s, { cursor: first.cursor });
  assert.deepEqual(second.lines, ['{"c":3}']);
  assert.equal(second.at_end, true, "a half-written last line is not a line yet");
  assert.equal(second.state.state, "idle");
  const empty = await readClaudeStream(s, { cursor: second.cursor });
  assert.deepEqual(empty.lines, []);
  await assert.rejects(readClaudeStream(s, { cursor: `${"d".repeat(32)}:0` }), /STREAM_CURSOR_STALE/);
  await assert.rejects(readClaudeStream(s, { cursor: "garbage" }), /STREAM_CURSOR_INVALID/);
  const waited = Date.now();
  await readClaudeStream(s, { cursor: second.cursor, wait_ms: 300 });
  assert.ok(Date.now() - waited >= 250, "wait_ms waits for news");
});

test("stream_send accepts only the three shapes, fills ids, and answers only a request that is pending", () => {
  const s = seat();
  place(s, "input", "");
  place(s, "state", stateOf({ state: "blocked", reason: "unknown_dialog", pending: [{ request_id: "q9", subtype: "can_use_tool", tool_name: "AskUserQuestion", stream_offset: 0, stream_end: 5 }] }));
  const items = appendClaudeInput(s, [
    { type: "user", message: { role: "user", content: "hello" } },
    { type: "control_request", request: { subtype: "set_model", model: "sonnet" } },
    { type: "control_response", response: { subtype: "success", request_id: "q9", response: { behavior: "allow", updatedInput: { answers: { Q: "A" } } } } },
  ]);
  assert.deepEqual(items.map(i => i.type), ["user", "control_request", "control_response"]);
  assert.match(items[0].uuid, /^[0-9a-f-]{36}$/);
  assert.match(items[1].request_id, /^aiterm-/);
  const written = fs.readFileSync(agentClaudeMachineFilePath(s.aiterm_session, s.launch_id, "input"), "utf8").trim().split("\n").map(l => JSON.parse(l));
  assert.deepEqual(written[2], { type: "control_response", response: { subtype: "success", request_id: "q9", response: { behavior: "allow", updatedInput: { answers: { Q: "A" } } } } });
  assert.throws(() => appendClaudeInput(s, [{ type: "control_response", response: { subtype: "success", request_id: "nope" } }]), /STREAM_REQUEST_NOT_PENDING/);
  assert.throws(() => appendClaudeInput(s, [{ type: "control_request", request: { subtype: "initialize" } }]), /STREAM_INPUT_INVALID/);
  assert.throws(() => appendClaudeInput(s, [{ type: "user", message: { role: "assistant", content: "x" } }]), /STREAM_INPUT_INVALID/);
  assert.throws(() => appendClaudeInput(s, [{ type: "mystery" }]), /STREAM_INPUT_INVALID/);
  assert.throws(() => appendClaudeInput(s, []), /STREAM_INPUT_INVALID/);
  place(s, "state", stateOf({ state: "exited", exited: true }));
  assert.throws(() => appendClaudeInput(s, [{ type: "user", message: { role: "user", content: "x" } }]), /STREAM_SEAT_NOT_RUNNING/);
});

test("the pending request's line is read back from its offset; the observer screen follows the state file", () => {
  const s = seat();
  place(s, "stream", '{"x":1}\n{"type":"control_request","request_id":"r"}\n');
  place(s, "state", stateOf({ state: "blocked", reason: "tool_approval" }));
  assert.equal(readClaudeStreamLine(s, 8), '{"type":"control_request","request_id":"r"}');
  assert.equal(claudeMachineObserverScreen(s), "[aiterm-machine] state=blocked reason=tool_approval");
  assert.equal(claudeMachineView(s).state, "blocked");
  fs.rmSync(agentClaudeMachineFilePath(s.aiterm_session, s.launch_id, "state"));
  assert.equal(claudeMachineView(s).state, "starting");
});

const meta = (extra = {}) => ({ kind: "claude", aiterm_session: "seat1", launch_id: "a".repeat(32), claude_settings: "/s/settings.json",
  vendor_session_id: "12345678-1234-1234-1234-123456789abc", agent_executable: "/bin/claude",
  agent_role: "subagent", parent_session_id: "host-root", delegation_depth: 1, lineage: "host-root>claude:seat1", delegation_allowed: true, ...extra });

test("machine argv: host files and flags first, then claude's own argv; a fork adds --deny-questions; the TUI argv is unchanged", () => {
  const tui = claudeAgentArgv("/bin/claude", "opus", "high", null, meta());
  assert.equal(tui[0], "/bin/claude");
  const machine = claudeAgentArgv("/bin/claude", "opus", "high", null, meta({ claude_interface: "machine" }));
  assert.match(machine[1], /claude-machine-host\.js$/);
  const dash = machine.indexOf("--");
  for (const flag of ["--stream-file", "--input-file", "--state-file", "--replay-user-messages"]) assert.ok(machine.slice(0, dash).includes(flag), flag);
  assert.ok(!machine.slice(0, dash).includes("--deny-questions"));
  assert.deepEqual(machine.slice(machine.length - (tui.length - 1)), tui.slice(1));
  const fork = claudeAgentArgv("/bin/claude", "opus", "high", null, meta({ claude_interface: "machine", fork_of: { session_id: "m", vendor_session_id: "12345678-1234-1234-1234-123456789abc", write_ban: { path: "/w", method: "landlock" } } }));
  assert.ok(fork.slice(0, fork.indexOf("--")).includes("--deny-questions"));
  const resumed = claudeResumeArgv("/bin/claude", "opus", "high", meta({ claude_interface: "machine" }));
  assert.ok(resumed.includes("--resume") && !resumed.includes("--session-id"));
  const cmd = buildClaudeAgentCmd("/bin/claude", "opus", "high", null, meta({ claude_interface: "machine" }));
  assert.match(cmd, /^'[^']*node[^']*' '[^']*claude-machine-host\.js' --stream-file '/);
});

test("the resume recipe keeps the interface and rejects other values", () => {
  const base = { schema: "aiterm.agent-resume.v1", launch_id: "b".repeat(32), kind: "claude", vendor_session_id: "12345678-1234-1234-1234-123456789abc",
    executable: "/bin/claude", cwd: "/w", configuration_root: "/c", model: "opus", reasoning_effort: "high", fast: false, environment: {} };
  assert.equal(agentResumeRecipeSchema.parse({ ...base, interface: "machine" }).interface, "machine");
  assert.equal(agentResumeRecipeSchema.parse(base).interface, undefined);
  assert.throws(() => agentResumeRecipeSchema.parse({ ...base, interface: "tui" }));
});
