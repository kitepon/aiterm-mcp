import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as core from "../dist/core.js";
import { codexTurnSettled } from "../dist/harnesses/codex.js";
import { grokTurnSettled } from "../dist/harnesses/grok.js";

// 2026-10-07: 起きていて動いていないCodexの席へ新しいturnで送ると、pty_sendが受け付けを返すまで毎回5.7秒かかっていた
// （連携元の本番の記録17通が5,686〜5,858ms。実物のCodex 0.160.1・Grok 1.0.46・Cursor 2026.10.01でも5.4〜5.6秒）。
// 入力受付の確かめを500msおきに11回続ける決まり（ADR 0014）は、起動の途中に一瞬だけ出る入力欄を採らないための物だが、
// Codex・Grok・Cursorでは2通目以降の文にも毎回通していた。席のharnessが自分の記録で「この起動でturnを1つ終えていて、
// 次のturnを始めていない」と示している時は、短い間隔で2回確かめるだけで送る（ADR 0097）。
const IDLE = "OpenAI Codex\n› ";
const STARTING = "OpenAI Codex\n◦ Starting MCP servers";
const BUSY = "OpenAI Codex\n› \n• Working (1s • esc to interrupt)";
const TRUST = "Do you trust the contents of this directory?\n› 1. Yes, continue";
const wait = (samples, opts) => core.__testWaitAgentTuiReady("codex", samples, { timeoutMs: 100_000, pollMs: 500, ...opts });

test("入力受付の確かめ: 記録でturnが終わっている席は、100msおきに2回続けて入力待ちなら通す", async () => {
  const result = await wait([IDLE], { settled: [true] });
  assert.equal(result.ready, true);
  assert.equal(result.samples, 2);
  assert.deepEqual(result.sleeps, [100]);
});

test("入力受付の確かめ: 記録で示せない席は、今までどおり500msおきに11回続けて確かめる", async () => {
  for (const opts of [{}, { settled: [false] }]) {
    const result = await wait([IDLE], opts);
    assert.equal(result.ready, true);
    assert.equal(result.samples, 11);
    assert.deepEqual(result.sleeps, Array(10).fill(500));
  }
});

test("入力受付の確かめ: 確かめている間に記録の上でturnが始まったら、短い道をやめて11回を数え直す", async () => {
  const result = await wait([IDLE], { settled: [true, false] });
  assert.equal(result.ready, true);
  // 1回目は短い道の1つ目。2回目でturnの開始を見て、そこから11回。
  assert.equal(result.samples, 12);
  assert.deepEqual(result.sleeps, [100, ...Array(10).fill(500)]);
});

test("入力受付の確かめ: 待っている間にturnが終わったら、そこから短い道で通す（終わり際に届いた文）", async () => {
  const result = await wait([IDLE], { settled: [false, false, true] });
  assert.equal(result.ready, true);
  assert.equal(result.samples, 4);
  assert.deepEqual(result.sleeps, [500, 500, 100]);
});

test("入力受付の確かめ: 記録でturnが終わっていても、画面が入力待ちでなければ通さない", async () => {
  const busy = await wait([BUSY], { settled: [true], timeoutMs: 0 });
  assert.equal(busy.ready, false);
  assert.equal(busy.samples, 1);
  // 承認の画面は、今までどおり待たずに返す。
  const blocked = await wait([TRUST], { settled: [true] });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.samples, 1);
  // 入力待ちの後に画面が崩れたら、数え直す。
  const flapped = await wait([IDLE, STARTING, IDLE, IDLE], { settled: [true] });
  assert.equal(flapped.ready, true);
  assert.equal(flapped.samples, 4);
  assert.deepEqual(flapped.sleeps, [100, 500, 100]);
});

const event = (type, extra = {}) => JSON.stringify({ type: "event_msg", payload: { type, ...extra } });
const START = event("task_started", { turn_id: "turn-1" });
const DONE = event("task_complete", { turn_id: "turn-1", last_agent_message: "答え" });

function codexFixture(t, { bound = true } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "settled-codex-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, "sessions", "2026", "10", "07");
  mkdirSync(dir, { recursive: true });
  const meta = { kind: "codex", codex_home: home, hook_route: "shared_codex_home", launch_id: "launch-settled",
    created_at: new Date(Date.now() - 60_000).toISOString(), vendor_session_id: bound ? "sess-settled" : null };
  const file = path.join(dir, "rollout-2026-10-07T00-00-00-sess-settled.jsonl");
  const head = (launch = meta.launch_id) => [
    JSON.stringify({ type: "session_meta", payload: { id: "sess-settled", originator: "codex-tui", source: "cli" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "developer",
      content: [{ type: "input_text", text: `AITERM_AGENT_LAUNCH_ID=${launch}` }] } }),
  ];
  return { meta, file, head, write: lines => writeFileSync(file, lines.join("\n") + "\n") };
}

test("Codexの記録: 最後の境界がturnの終わりの時だけ「turnが終わっていて次が始まっていない」と読む", t => {
  const { meta, file, head, write } = codexFixture(t);
  assert.equal(codexTurnSettled(meta), false, "記録が無い（起動直後）");
  write(head());
  assert.equal(codexTurnSettled(meta), false, "turnがまだ無い");
  write([...head(), START]);
  assert.equal(codexTurnSettled(meta), false, "turnが動いている");
  write([...head(), START, DONE]);
  assert.equal(codexTurnSettled(meta), true);
  // 会話の中身に境界の語があっても、境界とは数えない。
  write([...head(), START, DONE, JSON.stringify({ type: "response_item", payload: { type: "message", role: "user",
    content: [{ type: "input_text", text: "task_started と task_complete の話" }] } })]);
  assert.equal(codexTurnSettled(meta), true);
  write([...head(), START, DONE, event("task_started", { turn_id: "turn-2" })]);
  assert.equal(codexTurnSettled(meta), false, "次のturnが始まった");
  // Escで止めたturnも終わっている（Codex 0.160.1の実記録: task_startedの後にturn_aborted、reasonはinterrupted）。
  write([...head(), START, event("turn_aborted", { turn_id: "turn-1", reason: "interrupted" })]);
  assert.equal(codexTurnSettled(meta), true);
  // 見ていない理由の中断は、終わったと数えない。
  write([...head(), START, event("turn_aborted", { turn_id: "turn-1", reason: "replaced" })]);
  assert.equal(codexTurnSettled(meta), false);
  // 書いている途中の行がある時は、終わったと数えない（次の境界かも知れない）。
  write([...head(), START, DONE]);
  appendFileSync(file, '{"type":"event_msg","payload":{"type":"task_sta');
  assert.equal(codexTurnSettled(meta), false);
  // 境界が末尾の読む範囲（1MiB）に無い時は、分からないのでfalse。
  write([...head(), START, DONE, JSON.stringify({ type: "response_item", payload: { type: "function_call_output", output: "x".repeat(1024 * 1024 + 10) } })]);
  assert.equal(codexTurnSettled(meta), false);
});

test("Codexの記録: この起動に結び付かないrolloutは読まない", t => {
  const { meta, head, write } = codexFixture(t, { bound: false });
  // 同じ置き場にある、別の起動のrollout（終わったturnがある）。
  write([...head("another-launch"), START, DONE]);
  assert.equal(codexTurnSettled(meta), false);
  write([...head(), START, DONE]);
  assert.equal(codexTurnSettled(meta), true);
  assert.equal(codexTurnSettled({ ...meta, kind: "grok" }), false);
});

test("Grokの記録: 最後の境界が完了のturn_endedの時だけ「turnが終わっていて次が始まっていない」と読む", t => {
  const home = mkdtempSync(path.join(tmpdir(), "settled-grok-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const meta = { kind: "grok", grok_home: home, cwd: path.resolve("settled-grok-cwd"), vendor_session_id: "grok-settled" };
  const dir = path.join(home, "sessions", encodeURIComponent(meta.cwd), meta.vendor_session_id);
  const write = records => { mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, "events.jsonl"), records.map(r => JSON.stringify(r)).join("\n") + "\n"); };
  assert.equal(grokTurnSettled(meta), false, "記録が無い（起動直後）");
  write([{ type: "mcp_init_completed" }]);
  assert.equal(grokTurnSettled(meta), false, "turnがまだ無い");
  write([{ type: "turn_started", turn_number: 0 }]);
  assert.equal(grokTurnSettled(meta), false, "turnが動いている");
  write([{ type: "turn_started", turn_number: 0 }, { type: "turn_ended", outcome: "completed", ts: "t1" }]);
  assert.equal(grokTurnSettled(meta), true);
  // エラーで打ち切られたturnも、終わっている。
  write([{ type: "turn_started", turn_number: 0 }, { type: "turn_ended", outcome: "error", ts: "t1" }]);
  assert.equal(grokTurnSettled(meta), true);
  // 差し込みの継ぎ目（send now）は終わりではない。直後に同じ作業のturnが始まる。
  write([{ type: "turn_started", turn_number: 0 }, { type: "turn_ended", outcome: "cancelled", cancellation_context: { trigger: "send_now" }, ts: "t1" }]);
  assert.equal(grokTurnSettled(meta), false);
  write([{ type: "turn_started", turn_number: 0 }, { type: "turn_ended", outcome: "completed", ts: "t1" }, { type: "turn_started", turn_number: 1 }]);
  assert.equal(grokTurnSettled(meta), false, "次のturnが始まった");
  write([{ type: "turn_started", turn_number: 0 }, { type: "turn_ended", outcome: "completed", ts: "t1" }]);
  appendFileSync(path.join(dir, "events.jsonl"), '{"type":"turn_sta');
  assert.equal(grokTurnSettled(meta), false, "書いている途中の行がある");
});
