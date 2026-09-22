import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import {
  cursorParentFromRequest, handleCursorHook, isCursorMcpClient, prepareCursorDelivery, receiveCursorAnswer,
} from "../dist/cursor-parent-receiver.js";
import { cursorReceiveProcess, main as receiveMain } from "../dist/cursor-parent-receive.js";

const hooks = (dir) => {
  const file = path.join(dir, "hooks.json");
  fs.writeFileSync(file, JSON.stringify({ version: 1, hooks: {
    postToolUse: [{ command: "node cursor-parent-hook.js", timeout: 15 }],
    afterMCPExecution: [{ command: "node cursor-parent-hook.js", timeout: 15 }],
  } }));
  return file;
};

test("Cursor clientだけを親にし、hookが無ければ送信前に止める", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-cursor-id-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(isCursorMcpClient("cursor-vscode"), true);
  assert.equal(isCursorMcpClient("cursor-vscode (via mcp-remote 0.1.29)"), true);
  assert.equal(isCursorMcpClient("codex-mcp-client"), false);
  assert.equal(isCursorMcpClient("claude-code"), false);
  assert.equal(isCursorMcpClient(undefined), false);
  assert.equal(cursorParentFromRequest("codex-mcp-client"), null);
  assert.equal(cursorParentFromRequest("claude-code"), null);
  const hookRoot = path.join(dir, "hook");
  assert.throws(() => cursorParentFromRequest("cursor-vscode", { hookRoot, hooksFile: path.join(dir, "missing.json") }), /CURSOR_PARENT_HOOK_UNAVAILABLE/);
  const parent = cursorParentFromRequest("cursor-vscode (via mcp-remote 0.1.29)", { hookRoot, hooksFile: hooks(dir) });
  assert.equal(parent.kind, "cursor");
  assert.equal(parent.hook_root, hookRoot);
});

test("旧readerのparent schemaはCursor記録を受け取らない", () => {
  const legacy = z.union([
    z.object({ thread_id: z.uuid(), codex_home: z.string() }).strict(),
    z.object({ kind: z.literal("claude"), request_id: z.string(), session_id: z.uuid(), hook_root: z.string() }).strict(),
  ]);
  assert.equal(legacy.safeParse({ kind: "cursor", hook_root: "/tmp/cursor" }).success, false);
});

test("dispatch結果から会話へ束縛し、本文を作られた順に差し込む", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-cursor-bind-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const hookRoot = path.join(dir, "hook");
  const parent = { kind: "cursor", hook_root: hookRoot };
  const first = randomUUID();
  const second = randomUUID();
  prepareCursorDelivery(parent, first);
  prepareCursorDelivery(parent, second);
  const text = "回答\n\"引用\"\n" + "あ".repeat(32_000);
  await handleCursorHook(JSON.stringify({
    hook_event_name: "afterMCPExecution", conversation_id: "conv/evil", tool_name: "agent_launch",
    result_json: JSON.stringify({ structuredContent: { parent_delivery: { delivery_id: first } } }),
  }), hookRoot);
  assert.equal(fs.existsSync(path.join(hookRoot, "deliveries", first, "bind.json")), false);
  await handleCursorHook(JSON.stringify({
    hook_event_name: "postToolUse", conversation_id: "conv-1", tool_name: "Shell", tool_output: "not json",
  }), hookRoot);
  await handleCursorHook(JSON.stringify({
    hook_event_name: "afterMCPExecution", conversation_id: "conv-1", tool_name: "mcp__aiterm__agent_launch",
    result_json: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ parent_delivery: { delivery_id: second } }) }] }),
  }), hookRoot);
  await handleCursorHook(JSON.stringify({
    hook_event_name: "postToolUse", conversation_id: "conv-1", tool_name: "MCP:pty_send",
    tool_output: JSON.stringify({ structuredContent: { parent_delivery: { delivery_id: first } } }),
  }), hookRoot);
  const later = new Date(Date.now() + 1000).toISOString();
  const earlier = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(path.join(hookRoot, "deliveries", second, "bind.json"), JSON.stringify({ conversation_id: "conv-1", created_at: later }));
  fs.writeFileSync(path.join(hookRoot, "deliveries", first, "bind.json"), JSON.stringify({ conversation_id: "conv-1", created_at: earlier }));
  fs.writeFileSync(path.join(hookRoot, "deliveries", first, "answer.json"), JSON.stringify({ delivery_id: first, text }));
  fs.writeFileSync(path.join(hookRoot, "deliveries", second, "answer.json"), JSON.stringify({ delivery_id: second, text: "二つ目" }));
  const injected = await handleCursorHook(JSON.stringify({ hook_event_name: "postToolUse", conversation_id: "conv-1", tool_name: "Read" }), hookRoot);
  assert.equal(injected.additional_context, `${text}\n\n二つ目`);
  assert.equal(fs.existsSync(path.join(hookRoot, "conversations", "conv-1", first)), false);
  const again = await handleCursorHook(JSON.stringify({ hook_event_name: "postToolUse", conversation_id: "conv-1", tool_name: "Read" }), hookRoot);
  assert.equal(again.additional_context, undefined);
});

test("hookと受け口は同じ回答を一度だけ出す", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-cursor-claim-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const hookRoot = path.join(dir, "hook");
  const id = randomUUID();
  prepareCursorDelivery({ kind: "cursor", hook_root: hookRoot }, id);
  fs.writeFileSync(path.join(hookRoot, "deliveries", id, "bind.json"), JSON.stringify({ conversation_id: "conv-1", created_at: new Date().toISOString() }));
  fs.mkdirSync(path.join(hookRoot, "conversations", "conv-1"), { recursive: true });
  fs.writeFileSync(path.join(hookRoot, "conversations", "conv-1", id), "");
  fs.writeFileSync(path.join(hookRoot, "deliveries", id, "answer.json"), JSON.stringify({ delivery_id: id, text: "一度だけ" }));
  const [received, injected] = await Promise.all([
    receiveCursorAnswer(hookRoot, id, 1000),
    handleCursorHook(JSON.stringify({ hook_event_name: "postToolUse", conversation_id: "conv-1", tool_name: "Shell" }), hookRoot),
  ]);
  const texts = [received.outcome === "delivered" ? received.text : null, injected.additional_context ?? null].filter(Boolean);
  assert.deepEqual(texts, ["一度だけ"]);
  const claim = JSON.parse(fs.readFileSync(path.join(hookRoot, "deliveries", id, "claim.json"), "utf8"));
  assert.ok(claim.channel === "hook" || claim.channel === "receiver");
});

test("受け口は本文、hook先行、timeout、引数不正を分ける", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-cursor-receive-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const hookRoot = path.join(dir, "hook");
  const id = randomUUID();
  prepareCursorDelivery({ kind: "cursor", hook_root: hookRoot }, id);
  fs.writeFileSync(path.join(hookRoot, "deliveries", id, "claim.json"), JSON.stringify({ channel: "hook", at: new Date().toISOString() }));
  fs.writeFileSync(path.join(hookRoot, "deliveries", id, "answer.json"), JSON.stringify({ delivery_id: id, text: "hook済み" }));
  assert.deepEqual(await receiveCursorAnswer(hookRoot, id, 1000), { outcome: "delivered_by_hook" });
  const missing = randomUUID();
  prepareCursorDelivery({ kind: "cursor", hook_root: hookRoot }, missing);
  assert.deepEqual(await receiveCursorAnswer(hookRoot, missing, 20), { outcome: "timeout" });
  assert.equal(await receiveMain(["--delivery", "nope"]), 1);
  const processInfo = cursorReceiveProcess(id, "/usr/local/bin/node");
  assert.equal(processInfo.executable, "/usr/local/bin/node");
  assert.deepEqual(processInfo.args.slice(1), ["--delivery", id]);
  assert.equal(processInfo.windows_start_process_argument_list, null);
});
