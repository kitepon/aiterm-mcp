import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { codexParentFromRequest, verifyCodexParent, submitCodexParentAnswer, CodexDeliveryError } from "../dist/codex-parent-receiver.js";

const fixture = fileURLToPath(new URL("./fixtures/codex-parent-receiver.mjs", import.meta.url));
const parentId = "11111111-2222-4333-8444-555555555555";
// 応答の待ちは既定（15秒）のまま使う。上限は要求ごとで、最初の要求（initialize）の待ちは、偽の受信口のprocessが起きる時間を含む。
// 1秒にしていた間、混んだ端末で起動が間に合わず、どの試験も「initializeの応答を確認できません」で落ちた
// （2026-09-30・10-04 macOS、10-11 Windows。この fileの3本で4回）。応答はすぐ返るので、速い端末では遅くならない。
const runtime = (mode, log) => ({ executable: process.execPath, args: [fixture, mode, ...(log ? [log] : [])] });
// 応答が来ない時の待ち切れだけを短く確かめる。上限は要求のたびに読まれるので、起動を含む最初の要求には既定の長さを返す。
const runtimeWithShortAnswerWait = (mode, ms) => {
  let requests = 0;
  return { ...runtime(mode), get timeout_ms() { return ++requests === 1 ? undefined : ms; } };
};
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
  const unknown = (code) => (error) => {
    assert.ok(error instanceof CodexDeliveryError);
    assert.equal(error.delivery_code, code);
    assert.equal(error.outcome_unknown, true);
    return true;
  };
  await assert.rejects(submitCodexParentAnswer(parent, "delivery-id", "回答", runtime("exit")), unknown("CODEX_RECEIVER_TRANSPORT_FAILED"));
  await assert.rejects(submitCodexParentAnswer(parent, "delivery-id", "回答", runtimeWithShortAnswerWait("timeout", 200)), unknown("CODEX_RECEIVER_TIMEOUT"));
  await assert.rejects(submitCodexParentAnswer(parent, "delivery-id", "回答", runtime("invalid")), unknown("CODEX_RECEIVER_TRANSPORT_FAILED"));
  await assert.rejects(submitCodexParentAnswer(parent, "delivery-id", "回答", runtime("no-id")), unknown("CODEX_RECEIVER_INVALID_RESPONSE"));
});

test("実行ファイルが無ければ子への依頼前に接続不能を返す", async () => {
  await assert.rejects(verifyCodexParent(parent, { executable: path.join(os.tmpdir(), "存在しないcodex") }), (error) => error.delivery_code === "CODEX_RECEIVER_TRANSPORT_FAILED" && error.outcome_unknown === false);
});
