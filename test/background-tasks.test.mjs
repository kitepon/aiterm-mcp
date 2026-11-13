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
