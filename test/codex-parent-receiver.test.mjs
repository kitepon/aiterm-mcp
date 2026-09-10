import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { codexParentFromRequest, verifyCodexParent, submitCodexParentAnswer, CodexDeliveryError } from "../dist/codex-parent-receiver.js";

const fixture = fileURLToPath(new URL("./fixtures/codex-parent-receiver.mjs", import.meta.url));
const parentId = "11111111-2222-4333-8444-555555555555";
const runtime = (mode, log) => ({ executable: process.execPath, args: [fixture, mode, ...(log ? [log] : [])], timeout_ms: 1_000 });
const parent = { thread_id: parentId, codex_home: path.join(os.tmpdir(), "Codex 親の環境") };

test("Codex親はMCP metadataのthreadIdだけから取得し、他の親は従来経路を維持する", () => {
  assert.equal(codexParentFromRequest("claude-code", { threadId: parentId }), null);
  assert.equal(codexParentFromRequest(undefined, { threadId: parentId }), null);
  assert.equal(codexParentFromRequest("codex-mcp-client", { threadId: parentId }).thread_id, parentId);
  for (const metadata of [undefined, {}, { threadId: "別の値" }]) {
    assert.throws(() => codexParentFromRequest("codex-mcp-client", metadata), (error) => error.delivery_code === "CODEX_PARENT_ID_UNAVAILABLE");
  }
});

test("公式キューのpreflightは親をload／resumeせず、保存済み宛先と対応を確認する", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm receiver "));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const log = path.join(root, "requests.jsonl");
  await verifyCodexParent(parent, runtime("normal", log));
  const calls = fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(calls.map((call) => call.method), ["initialize", "initialized", "thread/read", "thread/queue/list"]);
  assert.ok(calls.every((call) => call.codex_home === parent.codex_home));
  await assert.rejects(verifyCodexParent(parent, runtime("native-child")), (error) => error.delivery_code === "CODEX_PARENT_UNSUPPORTED");
});

test("長い回答本文をargvへ載せずJSONで送り、改行・引用符・日本語を維持する", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm receiver "));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const log = path.join(root, "requests.jsonl");
  const text = '日本語\n引用符"と\\、絵文字🐱\n'.repeat(6000);
  const result = await submitCodexParentAnswer(parent, "delivery-id", text, runtime("normal", log));
  assert.deepEqual(result, { queued_submission_id: "fixture-queue-id" });
  const calls = fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
  const request = calls.find((call) => call.method === "thread/queue/add");
  assert.deepEqual(request.params, { threadId: parentId, input: [{ type: "text", text, text_elements: [] }], clientUserMessageId: "delivery-id" });
});

test("受信口の明確な拒否は未送信として返し、再送しない", async () => {
  await assert.rejects(submitCodexParentAnswer(parent, "delivery-id", "回答", runtime("reject")), (error) => {
    assert.ok(error instanceof CodexDeliveryError);
    assert.equal(error.delivery_code, "CODEX_RECEIVER_REJECTED");
    assert.equal(error.outcome_unknown, false);
    assert.match(error.message, /入力が上限を超えました/);
    return true;
  });
});

test("送信後のprocess終了・timeout・不正応答は配送結果不明として保持する", async () => {
  for (const mode of ["exit", "timeout", "invalid", "no-id"]) {
    await assert.rejects(submitCodexParentAnswer(parent, "delivery-id", "回答", runtime(mode)), (error) => error instanceof CodexDeliveryError && error.outcome_unknown === true);
  }
});

test("実行ファイルが無ければ子への依頼前に接続不能を返す", async () => {
  await assert.rejects(verifyCodexParent(parent, { executable: path.join(os.tmpdir(), "存在しないcodex"), timeout_ms: 1_000 }), (error) => error.delivery_code === "CODEX_RECEIVER_TRANSPORT_FAILED" && error.outcome_unknown === false);
});
