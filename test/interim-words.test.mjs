import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  claudeInterimWords,
  codexInterimWords,
  cursorInterimWords,
  grokInterimWords,
  interimRequestFromMeta,
} from "../dist/interim-words.js";

const jsonl = (...records) => records.map((record) => JSON.stringify(record));

test("合間の言葉: BellTeamの印がある_metaだけを受け付ける", () => {
  assert.deepEqual(interimRequestFromMeta({ "aiterm/caller": "BellTeam" }), { after: 0 });
  assert.deepEqual(interimRequestFromMeta({ "aiterm/caller": "BellTeam", "aiterm/interim_after": 3 }), { after: 3 });
  assert.deepEqual(interimRequestFromMeta({ "aiterm/caller": "BellTeam", "aiterm/interim_after": -1 }), { after: 0 });
  assert.equal(interimRequestFromMeta({ "aiterm/caller": "bellteam" }), null);
  assert.equal(interimRequestFromMeta({ "aiterm/caller": "Other" }), null);
  assert.equal(interimRequestFromMeta({ "aiterm/interim_after": 3 }), null);
  assert.equal(interimRequestFromMeta(undefined), null);
});

test("合間の言葉: Claudeは道具の前の言葉とAPIエラーの知らせを拾い、思考と最後の回答を除く", () => {
  const lines = jsonl(
    { type: "user", message: { role: "user", content: "調べて" } },
    { type: "assistant", timestamp: "2026-09-28T01:00:00.000Z", message: { stop_reason: "tool_use", content: [{ type: "thinking", thinking: "迷い" }] } },
    { type: "assistant", timestamp: "2026-09-28T01:00:01.000Z", message: { stop_reason: "tool_use", content: [{ type: "text", text: "ちょっと調べてみる" }] } },
    { type: "assistant", timestamp: "2026-09-28T01:00:02.000Z", message: { stop_reason: "tool_use", content: [{ type: "tool_use", name: "Bash" }] } },
    { type: "assistant", isSidechain: true, message: { stop_reason: "tool_use", content: [{ type: "text", text: "子の言葉" }] } },
    { type: "assistant", timestamp: "2026-09-28T01:00:03.000Z", isApiErrorMessage: true, message: { stop_reason: "stop_sequence", content: [{ type: "text", text: "You've hit your session limit" }] } },
    { type: "assistant", timestamp: "2026-09-28T01:00:04.000Z", message: { stop_reason: "end_turn", content: [{ type: "text", text: "最後の回答" }] } },
  );
  assert.deepEqual(claudeInterimWords([...lines, "{\"type\":\"assist"]), [
    { text: "ちょっと調べてみる", kind: "interim", at: "2026-09-28T01:00:01.000Z", turn_id: null },
    { text: "You've hit your session limit", kind: "error", at: "2026-09-28T01:00:03.000Z", turn_id: null },
  ]);
});

test("合間の言葉: Codexはphase=commentaryとturnを終えたエラーを拾う", () => {
  const message = (phase, text) => ({
    timestamp: "2026-09-28T02:00:00.000Z",
    type: "response_item",
    payload: { type: "message", role: "assistant", phase, content: [{ type: "output_text", text }],
      internal_chat_message_metadata_passthrough: { turn_id: "turn-1" } },
  });
  const lines = jsonl(
    { type: "response_item", payload: { type: "reasoning", summary: [] } },
    message("commentary", "見てくる"),
    message("final_answer", "結論"),
    { type: "event_msg", payload: { type: "task_complete", turn_id: "turn-1", last_agent_message: "結論" } },
    { timestamp: "2026-09-28T02:00:05.000Z", type: "event_msg", payload: { type: "task_complete", turn_id: "turn-2",
      last_agent_message: null, error: { message: "You've hit your usage limit.", codex_error_info: "usage_limit_exceeded" } } },
    { timestamp: "2026-09-28T02:00:09.000Z", type: "event_msg", payload: { type: "task_complete", turn_id: "turn-3",
      last_agent_message: null, error: { message: "unexpected status 401 Unauthorized: token expired, url: http://127.0.0.1:1/v1/responses",
        codex_error_info: { http_connection_failed: { http_status_code: 401 } } } } },
  );
  assert.deepEqual(codexInterimWords(lines), [
    { text: "見てくる", kind: "interim", at: "2026-09-28T02:00:00.000Z", turn_id: "turn-1" },
    { text: "You've hit your usage limit.", kind: "error", at: "2026-09-28T02:00:05.000Z", turn_id: "turn-2" },
    // 利用上限のほかの誤りは、応答の本文とURLを落とした1行にする。
    { text: "unexpected status 401 Unauthorized", kind: "error", at: "2026-09-28T02:00:09.000Z", turn_id: "turn-3" },
  ]);
});

test("合間の言葉: Grokは境界より後のturnで、道具を呼んだassistantの言葉だけを拾う", () => {
  const lines = jsonl(
    { type: "user", content: "前の依頼" },
    { type: "assistant", content: "前のturnの言葉", tool_calls: [{ id: "a" }] },
    { type: "assistant", content: "前の回答" },
    { type: "user", content: "今の依頼" },
    { type: "user", content: "<system-reminder>", synthetic_reason: "system_reminder" },
    { type: "reasoning", encrypted_content: "x" },
    { type: "assistant", content: "一つ目を動かす", tool_calls: [{ id: "b" }] },
    { type: "tool_result", content: "ok" },
    { type: "assistant", content: "", tool_calls: [{ id: "c" }] },
    { type: "assistant", content: "終わった" },
  );
  assert.deepEqual(grokInterimWords(lines, 1).map((word) => word.text), ["一つ目を動かす"]);
  assert.deepEqual(grokInterimWords(lines, 0).map((word) => word.text), ["前のturnの言葉", "一つ目を動かす"]);
});

test("合間の言葉: Cursorは道具が続いた言葉だけを拾い、行き先が決まる前の言葉は待つ", () => {
  const assistant = (...content) => ({ role: "assistant", message: { content } });
  const text = (value) => ({ type: "text", text: value });
  const tool = { type: "tool_use", name: "Shell" };
  const lines = jsonl(
    { role: "user", message: { content: [text("前の依頼")] } },
    assistant(text("前の回答")),
    { type: "turn_ended", status: "success" },
    { role: "user", message: { content: [text("調べて")] } },
    assistant(text("調べるね"), tool),
    assistant(text("途中経過")),
    assistant(tool),
    assistant(text("まだ分からない")),
  );
  assert.deepEqual(cursorInterimWords(lines, 1).map((word) => word.text), ["調べるね", "途中経過"]);
  assert.deepEqual(cursorInterimWords([...lines, JSON.stringify({ type: "turn_ended", status: "success" })], 1)
    .map((word) => word.text), ["調べるね", "途中経過"]);
});

test("合間の言葉: pty_observeは_metaのBellTeamの印がある時だけ、dispatch後のturnの言葉を結果の_metaで返す", async () => {
  const root = fs.mkdtempSync(path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", "aiterm-interim-"));
  const env = {
    ...process.env,
    TMPDIR: root,
    XDG_RUNTIME_DIR: path.join(root, "runtime"),
    LOCALAPPDATA: path.join(root, "localappdata"),
    CLAUDE_CONFIG_DIR: path.join(root, "claude"),
  };
  fs.mkdirSync(env.XDG_RUNTIME_DIR, { recursive: true });
  const cwd = path.join(root, "work");
  fs.mkdirSync(cwd);
  const session = "interim_claude";
  const moduleUrl = (file) => JSON.stringify(pathToFileURL(path.resolve("dist", file)).href);
  // agent sessionの記録だけを用意する。paneは要らない（言葉は記録から読む）。
  const prepared = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { createClaudeAgentMetadata, claudeSessionTranscriptPath } = await import(${moduleUrl("harnesses/claude.js")});
    const { recordInterimBoundary } = await import(${moduleUrl("interim-words.js")});
    const fs = await import("node:fs");
    const path = await import("node:path");
    const meta = createClaudeAgentMetadata(${JSON.stringify(session)}, ${JSON.stringify(cwd)}, "none", null, null,
      { agentRole: "subagent", parentSessionId: "host-root", delegationDepth: 1, lineage: "host-root>claude:${session}", delegationAllowed: true }, null, null);
    const file = claudeSessionTranscriptPath(meta);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const line = (text, stop) => JSON.stringify({ type: "assistant", timestamp: "2026-09-28T03:00:00.000Z",
      message: { stop_reason: stop, content: [{ type: "text", text }] } }) + "\\n";
    fs.writeFileSync(file, line("前のturnの言葉", "tool_use") + line("前の回答", "end_turn"));
    recordInterimBoundary(meta, 7, null);
    fs.appendFileSync(file, line("一つ目", "tool_use") + line("二つ目", "tool_use") + line("回答", "end_turn"));
  `], { env, encoding: "utf8" });
  assert.equal(prepared.status, 0, prepared.stderr);

  const client = new Client({ name: "interim-test", version: "1" });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve("dist/index.js")], env, stderr: "pipe" }));
    const tools = await client.listTools();
    const published = JSON.stringify(tools.tools);
    assert.ok(!/BellTeam|interim|aiterm\/caller/i.test(published), "説明にも引数にも出さない");

    const plain = await client.callTool({ name: "pty_observe", arguments: { session_id: session } });
    assert.equal(plain._meta, undefined);
    const other = await client.callTool({ name: "pty_observe", arguments: { session_id: session }, _meta: { "aiterm/caller": "Other" } });
    assert.equal(other._meta, undefined);
    const ignoredArgument = await client.callTool({ name: "pty_observe", arguments: { session_id: session, "aiterm/caller": "BellTeam" } });
    assert.equal(ignoredArgument._meta, undefined);

    const first = await client.callTool({ name: "pty_observe", arguments: { session_id: session }, _meta: { "aiterm/caller": "BellTeam" } });
    const { observed_at: _a, ...firstObservation } = first.structuredContent;
    const { observed_at: _b, ...plainObservation } = plain.structuredContent;
    assert.deepEqual(firstObservation, plainObservation);
    const words = first._meta["aiterm/interim_words"];
    assert.equal(words.error, undefined);
    assert.equal(words.schema, "aiterm.interim-words.v1");
    assert.equal(words.session_id, session);
    assert.equal(words.harness, "claude-code");
    assert.equal(words.event_cursor, 7);
    assert.equal(words.last_seq, 2);
    assert.deepEqual(words.words.map((word) => [word.seq, word.text]), [[1, "一つ目"], [2, "二つ目"]]);

    const next = await client.callTool({ name: "pty_observe", arguments: { session_id: session },
      _meta: { "aiterm/caller": "BellTeam", "aiterm/interim_after": 1 } });
    assert.deepEqual(next._meta["aiterm/interim_words"].words.map((word) => word.text), ["二つ目"]);

    const missing = await client.callTool({ name: "pty_observe", arguments: { session_id: "interim_none" }, _meta: { "aiterm/caller": "BellTeam" } });
    assert.equal(missing._meta, undefined);
  } finally {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
