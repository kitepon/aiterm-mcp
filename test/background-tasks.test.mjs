import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const bt = await import("../dist/background-tasks.js");
const { claudeSessionTranscriptPath } = await import("../dist/harnesses/claude.js");

// Rows shaped as Claude 2.1.32x writes them (2026-11-11/13 transcripts): async Agent launch, background Bash, task-notification.
const agentUse = { type: "assistant", timestamp: "2026-11-13T10:00:00.000Z", message: { content: [{ type: "tool_use", id: "toolu_A", name: "Agent", input: { description: "Static client token inventory", prompt: "…" } }] } };
const agentResult = { type: "user", timestamp: "2026-11-13T10:00:01.000Z", message: { content: [{ type: "tool_result", tool_use_id: "toolu_A" }] },
  toolUseResult: { isAsync: true, status: "async_launched", agentId: "ab0d5c20cb4590cde", description: "Static client token inventory" } };
const shellUse = { type: "assistant", timestamp: "2026-11-13T10:01:00.000Z", message: { content: [{ type: "tool_use", id: "toolu_B", name: "Bash", input: { command: "sleep 150", description: "Sleep 150 seconds", run_in_background: true } }] } };
const shellResult = { type: "user", timestamp: "2026-11-13T10:01:01.000Z", message: { content: [{ type: "tool_result", tool_use_id: "toolu_B" }] },
  toolUseResult: { stdout: "", stderr: "", interrupted: false, backgroundTaskId: "b57ate4n7" } };
const notify = id => ({ type: "queue-operation", operation: "enqueue", timestamp: "2026-11-13T10:05:00.000Z",
  content: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n</task-notification>` });

test("Claude transcript: an async agent and a background shell are open until their task-notification", () => {
  const open = new Map(), done = new Set(), inputs = new Map();
  for (const row of [agentUse, agentResult, shellUse, shellResult]) bt.applyClaudeTranscriptLine(JSON.stringify(row), open, done, inputs);
  assert.deepEqual([...open.entries()], [
    ["ab0d5c20cb4590cde", { kind: "agent", label: "Static client token inventory", since: "2026-11-13T10:00:01.000Z" }],
    ["b57ate4n7", { kind: "shell", label: "Sleep 150 seconds", since: "2026-11-13T10:01:01.000Z" }]]);
  bt.applyClaudeTranscriptLine(JSON.stringify(notify("ab0d5c20cb4590cde")), open, done, inputs);
  assert.deepEqual([...open.keys()], ["b57ate4n7"]);
  bt.applyClaudeTranscriptLine(JSON.stringify({ type: "user", timestamp: "2026-11-13T10:06:00.000Z", toolUseResult: { shell_id: "b57ate4n7" } }), open, done, inputs);
  assert.equal(open.size, 0, "a stop tool's result ends the shell too");
});

test("labels are masked like descriptors", () => {
  assert.equal(bt.taskLabel("curl https://x/y", "shell"), "…");
  assert.equal(bt.taskLabel("TOKEN=abc ./run", "shell"), "…");
  assert.equal(bt.taskLabel("", "agent"), "agent");
  assert.equal(bt.taskLabel("x".repeat(50), "agent").length, 40);
});

test("claudeBackgroundTasks reads the seat's transcript incrementally and ignores launches before this launch", () => {
  const home = fs.mkdtempSync(path.join(process.env.HOME, "bt-claude-"));
  const meta = { kind: "claude", vendor_session_id: "11111111-2222-4333-8444-555555555555", claude_home: home, cwd: home,
    created_at: "2026-11-13T10:00:30.000Z", aiterm_session: "s", launch_id: "0".repeat(32) };
  const file = claudeSessionTranscriptPath(meta);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // The agent was launched by an earlier process of this seat (before created_at): not counted.
  fs.writeFileSync(file, [agentUse, agentResult, shellUse].map(row => JSON.stringify(row)).join("\n") + "\n");
  assert.deepEqual(bt.claudeBackgroundTasks(meta), { count: 0, oldest: null });
  fs.appendFileSync(file, JSON.stringify(shellResult) + "\n");
  assert.deepEqual(bt.claudeBackgroundTasks(meta), { count: 1, oldest: { kind: "shell", label: "Sleep 150 seconds", since: "2026-11-13T10:01:01.000Z" } });
  fs.appendFileSync(file, JSON.stringify(notify("b57ate4n7")));
  assert.equal(bt.claudeBackgroundTasks(meta).count, 1, "a row without its newline is not read yet");
  fs.appendFileSync(file, "\n");
  assert.equal(bt.claudeBackgroundTasks(meta).count, 0);
  assert.equal(bt.claudeBackgroundTasks({ ...meta, kind: "codex" }), null);
  assert.equal(bt.harnessBackgroundTasks({ ...meta, kind: "grok" }), null, "other harnesses give no statement yet");
});

// Grok 1.0.77 updates.jsonl rows (captured 2026-11-14 01:13 JST, a test seat with a background subagent and `sleep 70`).
const grokRow = (timestamp, update) => JSON.stringify({ timestamp, method: "_x.ai/session/update", params: { sessionId: "s", update } });
test("Grok updates.jsonl: subagents and backgrounded commands are open until finished/completed or a non-running snapshot", () => {
  const open = new Map(), done = new Set();
  const rows = [
    grokRow(1794586385, { sessionUpdate: "task_backgrounded", task_id: "2626c48f", command: "sleep 70" }),
    grokRow(1794586385, { sessionUpdate: "background_tasks", tasks: [{ task_id: "2626c48f", command: "sleep 70", description: "sleep 70 in background", kind: "bash", status: "running", started_at: "2026-11-13T16:13:05.201931788+00:00" }] }),
    grokRow(1794586385, { sessionUpdate: "subagent_spawned", subagent_id: "01a1d5af", description: "sleep 60 then reply", subagent_type: "general-purpose" }),
  ];
  for (const row of rows) bt.applyGrokUpdateLine(row, open, done);
  assert.deepEqual([...open.entries()], [
    ["2626c48f", { kind: "shell", label: "sleep 70", since: "2026-11-13T16:13:05.000Z" }],
    ["01a1d5af", { kind: "agent", label: "sleep 60 then reply", since: "2026-11-13T16:13:05.000Z" }]]);
  bt.applyGrokUpdateLine(grokRow(1794586448, { sessionUpdate: "subagent_finished", subagent_id: "01a1d5af", status: "completed" }), open, done);
  assert.deepEqual([...open.keys()], ["2626c48f"]);
  bt.applyGrokUpdateLine(grokRow(1794586455, { sessionUpdate: "background_tasks", tasks: [{ task_id: "2626c48f", kind: "bash", status: "completed" }] }), open, done);
  assert.equal(open.size, 0, "a snapshot that no longer says running closes it");
  bt.applyGrokUpdateLine(grokRow(1794586456, { sessionUpdate: "task_backgrounded", task_id: "2626c48f", command: "sleep 70" }), open, done);
  assert.equal(open.size, 0, "a finished task is not reopened");
});

// Codex 0.169 subagent rollout (captured 2026-11-14 01:23 JST): session_meta names the root thread and thread_source "subagent".
test("Codex subagent rollouts: working while task_started outnumbers task_complete/turn_aborted, under the seat's root thread", () => {
  const child = { ino: 1, offset: 0, partial: "", head: undefined, running: 0, since: null };
  bt.applyCodexChildLine(JSON.stringify({ timestamp: "2026-11-13T16:23:30.000Z", type: "session_meta", payload: { id: "01a1d5b9", session_id: "01a1d5b8", parent_thread_id: "01a1d5b8",
    thread_source: "subagent", agent_path: "/root/sleep_once", agent_nickname: "Franklin" } }), child);
  assert.deepEqual(child.head, { root: "01a1d5b8", label: "sleep_once" });
  bt.applyCodexChildLine(JSON.stringify({ timestamp: "2026-11-13T16:23:31.000Z", type: "event_msg", payload: { type: "task_started" } }), child);
  assert.equal(child.running, 1); assert.equal(child.since, "2026-11-13T16:23:31.000Z");
  bt.applyCodexChildLine(JSON.stringify({ timestamp: "2026-11-13T16:24:35.000Z", type: "event_msg", payload: { type: "task_complete" } }), child);
  assert.equal(child.running, 0);
  const root = { ino: 1, offset: 0, partial: "", head: undefined, running: 0, since: null };
  bt.applyCodexChildLine(JSON.stringify({ type: "session_meta", payload: { id: "01a1d5b8", session_id: "01a1d5b8", thread_source: "user" } }), root);
  assert.equal(root.head, null, "the root thread itself is not a subagent");
});

test("the named task is the oldest agent when any agent is open; otherwise the oldest shell or other", () => {
  const shell = { kind: "shell", label: "sleep 100", since: "2026-11-14T01:00:00.000Z" };
  const agent = { kind: "agent", label: "review", since: "2026-11-14T01:05:00.000Z" };
  assert.deepEqual(bt.representativeTask([shell, agent]), agent, "an agent wins over an older shell");
  assert.deepEqual(bt.representativeTask([shell]), shell);
  assert.equal(bt.representativeTask([]), null);
});

// Antigravity 1.5.8 transcript_full.jsonl steps (captured 2026-11-14 02:15 JST, a test seat with a background `sleep 70`).
test("Antigravity transcript: a background task is open from its 'running as a background task' step until 'Task id ... finished'", () => {
  const open = new Map(), done = new Set();
  bt.applyAntigravityStepLine(JSON.stringify({ step_index: 3, type: "GENERIC", status: "RUNNING", created_at: "2026-11-13T17:15:36Z",
    content: "Created At: 2026-11-13T17:15:36Z\nTool is running as a background task with task id: aebdf7bd-04db-47dc-a690-0e9d2b0ebf3d/task-3\nTask Description: sleep 70\nTask logs are available at: file:///x/task-3.log" }), open, done);
  assert.deepEqual([...open.entries()], [["aebdf7bd-04db-47dc-a690-0e9d2b0ebf3d/task-3", { kind: "shell", label: "sleep 70", since: "2026-11-13T17:15:36.000Z" }]]);
  bt.applyAntigravityStepLine(JSON.stringify({ step_index: 5, type: "SYSTEM_MESSAGE", status: "DONE", created_at: "2026-11-13T17:16:46Z",
    content: "<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-13T17:16:46Z sender=aebdf7bd-04db-47dc-a690-0e9d2b0ebf3d/task-3 priority=MESSAGE_PRIORITY_HIGH content=Task id \"aebdf7bd-04db-47dc-a690-0e9d2b0ebf3d/task-3\" finished with result:\nCommand exited with code 0." }), open, done);
  assert.equal(open.size, 0);
});
