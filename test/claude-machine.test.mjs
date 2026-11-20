// a471: Claude machine launch mode. The seat's pane runs claude-machine-host; Aiterm reads its state line where it reads the TUI,
// the host turns pane keys into stream-json messages, and the machine argv / recipe carry the interface.
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeMachineMarker, claudeMachineMarkerLine } from "../dist/claude-machine.js";
import { parseMachineQuestion } from "../dist/core.js";
import { ClaudeMachineHost, parseHostArgs } from "../dist/claude-machine-host.js";
import { claudePaneObservation, claudeTuiBusy, claudeTuiReady, claudeAgentArgv, buildClaudeAgentCmd, claudeResumeArgv } from "../dist/harnesses/claude.js";
import { agentResumeRecipeSchema } from "../dist/agent-lifecycle.js";

const RULE = "────────────────";
const tuiComposer = ["Claude Code v2.1.327", "● 直前の回答", RULE, "❯ ", RULE, "  ⏵⏵ bypass permissions on (shift+tab to cycle)"].join("\n");

test("the state line is read newest-first, only at column 0, and never from a TUI screen", () => {
  const screen = ["[aiterm-machine] state=idle", "» hi", "[aiterm-machine] state=busy", "working"].join("\n");
  assert.deepEqual(claudeMachineMarker(screen), { state: "busy", reason: null });
  assert.deepEqual(claudeMachineMarker(claudeMachineMarkerLine("blocked", "tool_approval")), { state: "blocked", reason: "tool_approval" });
  // A TUI seat that quotes the line in its answer indents it or puts a bullet before it.
  assert.equal(claudeMachineMarker("● [aiterm-machine] state=idle\n  [aiterm-machine] state=idle"), null);
  assert.equal(claudeMachineMarker(tuiComposer), null);
  assert.equal(claudeMachineMarker("[aiterm-machine] state=weird"), null);
});

test("pane observation maps the state line to the same states the TUI readers give", () => {
  assert.deepEqual(claudePaneObservation("[aiterm-machine] state=idle"), { state: "idle", reason: "composer_ready" });
  assert.deepEqual(claudePaneObservation("[aiterm-machine] state=busy"), { state: "busy", reason: "turn_running" });
  assert.deepEqual(claudePaneObservation("[aiterm-machine] state=blocked reason=tool_approval"), { state: "blocked", reason: "tool_approval" });
  assert.deepEqual(claudePaneObservation("[aiterm-machine] state=blocked reason=unknown_dialog"), { state: "blocked", reason: "unknown_dialog" });
  assert.equal(claudePaneObservation("[aiterm-machine] state=starting").state, "unknown");
  assert.equal(claudeTuiReady("[aiterm-machine] state=idle"), true);
  assert.equal(claudeTuiBusy("[aiterm-machine] state=busy"), true);
  assert.equal(claudeTuiBusy("[aiterm-machine] state=idle"), false);
  assert.deepEqual(claudePaneObservation(tuiComposer), { state: "idle", reason: "composer_ready" });
});

const makeHost = () => {
  const sent = [], printed = [], ends = [];
  let n = 0;
  const host = new ClaudeMachineHost({ send: l => sent.push(JSON.parse(l)), print: t => printed.push(t), id: () => `id${++n}`, recordEnd: e => ends.push(e) });
  const out = () => printed.join("");
  const child = o => host.onChildLine(JSON.stringify(o));
  const ready = () => { host.start(); child({ type: "control_response", response: { subtype: "success", request_id: sent.at(-1).request_id, response: {} } }); };
  return { host, sent, out, child, ready, ends };
};
const paste = (host, text) => { host.onInput("\x1b[200~" + text + "\x1b[201~"); host.onInput("\r"); };

test("host: initialize reply makes it idle; a pasted line plus Enter is one user message and the seat is busy", () => {
  const { host, sent, out, ready } = makeHost();
  host.start();
  assert.equal(host.state, "starting");
  assert.equal(sent[0].request.subtype, "initialize");
  host.onChildLine(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: sent[0].request_id, response: {} } }));
  assert.equal(host.state, "idle");
  paste(host, "line one\nline two");
  assert.equal(host.state, "busy");
  assert.deepEqual(sent[1], { type: "user", message: { role: "user", content: "line one\nline two" }, parent_tool_use_id: null, uuid: "id2" });
  assert.match(out(), /\[aiterm-machine\] state=busy/);
  void ready;
});

test("host: idle only after the result AND the Stop hooks that started have answered", () => {
  const { host, child, ready } = makeHost();
  ready();
  paste(host, "go");
  child({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } });
  child({ type: "system", subtype: "hook_started", hook_event: "Stop", hook_id: "h1" });
  child({ type: "result", subtype: "success", terminal_reason: "completed", user_message_uuids: ["id2"] });
  assert.equal(host.state, "busy", "Throughline's Stop hook has not finished");
  child({ type: "system", subtype: "hook_response", hook_event: "Stop", hook_id: "h1" });
  assert.equal(host.state, "idle");
});

test("host: a turn that starts without our input (asyncRewake) makes it busy, and the result ends it", () => {
  const { host, child, ready, ends } = makeHost();
  ready();
  child({ type: "assistant", message: { content: [{ type: "text", text: "woken" }] } });
  assert.equal(host.state, "busy");
  child({ type: "result", subtype: "success", terminal_reason: "completed" });
  assert.equal(host.state, "idle");
  assert.equal(ends.at(-1).terminal_reason, "completed");
});

test("host: Escape interrupts a running turn and does nothing when idle; the interrupt is recorded for Aiterm", () => {
  const { host, sent, child, ready, ends } = makeHost();
  ready();
  host.onInput("\x1b");
  assert.equal(sent.length, 1, "idle: no request");
  paste(host, "long");
  host.onInput("\x1b");
  assert.equal(sent.at(-1).request.subtype, "interrupt");
  child({ type: "result", subtype: "error_during_execution", terminal_reason: "aborted_tools", is_error: true });
  assert.equal(host.state, "idle");
  assert.equal(ends.at(-1).terminal_reason, "aborted_tools");
});

test("host: a tool request is drawn as Do you want to proceed? 1. Yes 2. No and answered by digit + Enter", () => {
  const { host, sent, out, child, ready } = makeHost();
  ready();
  paste(host, "run it");
  child({ type: "control_request", request_id: "q1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } });
  assert.equal(host.state, "blocked");
  assert.match(out(), /Do you want to proceed\?\n❯ 1\. Yes\n  2\. No\n\[aiterm-machine\] state=blocked reason=tool_approval/);
  host.onInput("2"); host.onInput("\r");
  assert.deepEqual(sent.at(-1), { type: "control_response", response: { subtype: "success", request_id: "q1", response: { behavior: "deny", message: "Denied from the Aiterm seat" } } });
  assert.equal(host.state, "busy");
  child({ type: "control_request", request_id: "q2", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } });
  host.onInput("1"); host.onInput("\r");
  assert.equal(sent.at(-1).response.response.behavior, "allow");
});

test("host: AskUserQuestion is an unknown_dialog answered with the chosen label; ExitPlanMode is allowed as the hook does", () => {
  const { host, sent, child, ready } = makeHost();
  ready();
  paste(host, "ask");
  child({ type: "control_request", request_id: "a1", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion",
    input: { questions: [{ question: "Red or blue?", options: [{ label: "Red" }, { label: "Blue" }] }] } } });
  assert.equal(host.state, "blocked");
  host.onInput("2"); host.onInput("\r");
  assert.deepEqual(sent.at(-1).response.response.updatedInput.answers, { "Red or blue?": "Blue" });
  child({ type: "control_request", request_id: "p1", request: { subtype: "can_use_tool", tool_name: "ExitPlanMode", input: { plan: "x" } } });
  assert.equal(sent.at(-1).response.response.behavior, "allow");
  assert.equal(sent.at(-1).response.response.updatedPermissions[0].mode, "bypassPermissions");
});

test("host: /aiterm-config becomes set_model / apply_flag_settings and answers with a config line", () => {
  const { host, sent, out, child, ready } = makeHost();
  ready();
  paste(host, '/aiterm-config {"model":"sonnet","effort":"high","fast":false}');
  assert.equal(host.state, "idle", "a host command is not a turn");
  assert.deepEqual(sent.at(-1).request, { subtype: "set_model", model: "sonnet" });
  child({ type: "control_response", response: { subtype: "success", request_id: sent.at(-1).request_id } });
  assert.deepEqual(sent.at(-1).request, { subtype: "apply_flag_settings", settings: { effortLevel: "high" } });
  child({ type: "control_response", response: { subtype: "success", request_id: sent.at(-1).request_id } });
  assert.deepEqual(sent.at(-1).request, { subtype: "apply_flag_settings", settings: { fastMode: false } });
  child({ type: "control_response", response: { subtype: "success", request_id: sent.at(-1).request_id } });
  assert.match(out(), /\[aiterm-machine\] config=ok model=sonnet effort=high fast=false/);
});

test("host: a first prompt is sent once after initialize", () => {
  const sent = [];
  const host = new ClaudeMachineHost({ send: l => sent.push(JSON.parse(l)), print: () => {}, id: () => "x" + sent.length });
  host.firstPrompt = "first";
  host.start();
  host.onChildLine(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: sent[0].request_id } }));
  assert.equal(sent[1].message.content, "first");
  assert.equal(host.firstPrompt, null);
});

test("host arguments split the host's own flags from the claude command", () => {
  assert.deepEqual(parseHostArgs(["--end-file", "/e", "--first-prompt-file", "/p", "--", "claude", "--model", "m"]),
    { claude: ["claude", "--model", "m"], firstPrompt: "/p", endFile: "/e" });
});

const meta = (extra = {}) => ({ kind: "claude", aiterm_session: "seat1", launch_id: "a".repeat(32), claude_settings: "/s/settings.json",
  vendor_session_id: "12345678-1234-1234-1234-123456789abc", agent_executable: "/bin/claude",
  agent_role: "subagent", parent_session_id: "host-root", delegation_depth: 1, lineage: "host-root>claude:seat1", delegation_allowed: true, ...extra });

test("machine argv: host first, then --end-file, then claude's own argv; the TUI argv is unchanged", () => {
  const tui = claudeAgentArgv("/bin/claude", "opus", "high", null, meta());
  assert.equal(tui[0], "/bin/claude");
  const machine = claudeAgentArgv("/bin/claude", "opus", "high", null, meta({ claude_interface: "machine" }));
  assert.match(machine[1], /claude-machine-host\.js$/);
  const dash = machine.indexOf("--");
  // On Windows the claude command itself is resolved like the TUI launch line (shim or script wrapper); its arguments are the same.
  assert.deepEqual(machine.slice(machine.length - (tui.length - 1)), tui.slice(1));
  if (process.platform !== "win32") assert.deepEqual(machine.slice(dash + 1), tui);
  assert.equal(machine[2], "--end-file");
  const resumed = claudeResumeArgv("/bin/claude", "opus", "high", meta({ claude_interface: "machine" }));
  assert.ok(resumed.includes("--resume") && !resumed.includes("--session-id"));
  const cmd = buildClaudeAgentCmd("/bin/claude", "opus", "high", null, meta({ claude_interface: "machine" }));
  assert.match(cmd, /^'[^']*node[^']*' '[^']*claude-machine-host\.js' --end-file '/);
  if (process.platform !== "win32") assert.ok(cmd.includes(" -- '/bin/claude' --dangerously-skip-permissions"));
});

test("the resume recipe keeps the interface and rejects other values", () => {
  const base = { schema: "aiterm.agent-resume.v1", launch_id: "b".repeat(32), kind: "claude", vendor_session_id: "12345678-1234-1234-1234-123456789abc",
    executable: "/bin/claude", cwd: "/w", configuration_root: "/c", model: "opus", reasoning_effort: "high", fast: false, environment: {} };
  assert.equal(agentResumeRecipeSchema.parse({ ...base, interface: "machine" }).interface, "machine");
  assert.equal(agentResumeRecipeSchema.parse(base).interface, undefined);
  assert.throws(() => agentResumeRecipeSchema.parse({ ...base, interface: "tui" }));
});

test("a pending AskUserQuestion is read back from the host's screen: question, numbered options, a digest bound to this question", () => {
  const { host, child, out, ready } = makeHost();
  ready();
  paste(host, "ask");
  child({ type: "control_request", request_id: "a1", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion",
    input: { questions: [{ question: "Red or blue?", options: [{ label: "Red" }, { label: "Blue" }] }] } } });
  const screen = out();
  const q = parseMachineQuestion(screen, "a".repeat(32));
  assert.equal(q.prompt, "Red or blue?");
  assert.deepEqual(q.options, [{ index: 1, label: "Red" }, { index: 2, label: "Blue" }]);
  assert.match(q.digest, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(parseMachineQuestion(screen.replace("Blue", "Green"), "a".repeat(32)).digest, q.digest);
  assert.notEqual(parseMachineQuestion(screen, "b".repeat(32)).digest, q.digest);
  assert.equal(parseMachineQuestion("[aiterm-machine] state=idle", "a".repeat(32)), null);
  // A tool approval is not a question.
  const tool = makeHost();
  tool.ready();
  paste(tool.host, "run");
  tool.child({ type: "control_request", request_id: "t1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } });
  assert.equal(parseMachineQuestion(tool.out(), "a".repeat(32)), null);
});
