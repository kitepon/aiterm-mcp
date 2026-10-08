// Codexの席で、processが生きたまま会話が切り替わった後（入力欄の /new・/clear）も、今の会話の記録を読む（ADR 0105）。
// Codex 0.160.1は、新しい会話を別のrolloutへ書く。古いrolloutには何も書かない。新しいrolloutは、最初のturnで出来る。
// 今までは最初の会話のrolloutを見続けて、その後のturnの完了を拾えなかった（完了待ちが時間切れ）。
// 別の起動の会話・派生した会話・app-serverの会話を拾わない事を、手で書いた記録で確かめる。tmuxは使わない。
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-ccs-"));
process.env.XDG_RUNTIME_DIR = process.env.TMPDIR;
const codexHome = path.join(process.env.TMPDIR, "codex-home");
const rolloutDir = path.join(codexHome, "sessions", "2026", "10", "08");
fs.mkdirSync(rolloutDir, { recursive: true, mode: 0o700 });

const shared = await import(new URL("../dist/agent-shared.js", import.meta.url).href);
const codex = await import(new URL("../dist/harnesses/codex.js", import.meta.url).href);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const LAUNCHED = Date.parse("2026-10-08T00:00:00.000Z");
let serial = 0;
/** 作成時刻（ms）を持つUUIDv7の形の会話ID。 */
function sessionId(createdMs) {
  const time = createdMs.toString(16).padStart(12, "0");
  return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-${(++serial).toString(16).padStart(12, "0")}`;
}
const event = (type, extra = {}, at = new Date()) => JSON.stringify({ timestamp: new Date(at).toISOString(), type: "event_msg", payload: { type, ...extra } });
const developer = (launchId) => JSON.stringify({ type: "response_item", payload: { type: "message", role: "developer",
  content: [{ type: "input_text", text: `AITERM_AGENT_LAUNCH_ID=${launchId}` }] } });
const CONTEXT = JSON.stringify({ type: "turn_context", payload: { turn_id: "turn" } });

/** rolloutを1つ書く。mtimeは最後に書かれた時刻。 */
function rollout({ id = sessionId(LAUNCHED + 1000), launchId, originator = "codex-tui", source = "cli", forkedFrom = null, lines = [], mtime, head = true }) {
  const file = path.join(rolloutDir, `rollout-2026-10-08T00-00-00-${id}.jsonl`);
  const meta = { id, originator, source, ...(forkedFrom ? { forked_from_id: forkedFrom } : {}) };
  fs.writeFileSync(file, [JSON.stringify({ type: "session_meta", payload: meta }),
    ...(head ? [developer(launchId), CONTEXT] : []), ...lines].join("\n") + "\n");
  if (mtime !== undefined) fs.utimesSync(file, new Date(mtime), new Date(mtime));
  return { id, file };
}

/** 最初の会話（bound）へ結び付いた席の登録。 */
function seat(name) {
  const launchId = (++serial).toString(16).padStart(32, "0");
  const bound = rollout({ launchId, lines: [event("task_started", { turn_id: "turn-a" }, LAUNCHED + 2000),
    event("task_complete", { turn_id: "turn-a", last_agent_message: "最初の会話の答え" }, LAUNCHED + 3000)], mtime: Date.now() - 60_000 });
  const meta = {
    kind: "codex", aiterm_session: name, launch_id: launchId, event_file: shared.agentEventPath(name, launchId),
    created_at: new Date(LAUNCHED).toISOString(), cwd: null, vendor_session_id: bound.id, initial_prompt: "none",
    hook_route: "shared_codex_home", completion_route: "codex_transcript", node_platform: process.platform, codex_home: codexHome,
  };
  shared.writeAgentMetadata(meta);
  return { meta, bound, launchId };
}
const later = (extra = {}) => ({ id: sessionId(LAUNCHED + 60_000), mtime: Date.now() - 30_000, ...extra });

test("同じ起動の新しい会話が、結び付けた会話より後に書かれていれば、そちらの記録を読む", () => {
  const { meta, bound, launchId } = seat("switch-follow");
  assert.equal(codex.codexRootTranscript(meta), bound.file);
  const next = rollout(later({ launchId, lines: [event("task_started", { turn_id: "turn-b" })] }));
  assert.equal(codex.codexRootTranscript(meta), next.file);
  assert.equal(codex.codexBoundTranscript(meta), bound.file, "読み位置の元になる記録は、結び付けた会話のまま");
  assert.equal(codex.codexRunningTurn(meta), "turn-b", "動いているturnも、今の会話から読む");
  // 元の会話へ後から書かれたら、元の会話が今の会話。
  fs.appendFileSync(bound.file, event("task_started", { turn_id: "turn-a2" }) + "\n");
  assert.equal(codex.codexRootTranscript(meta), bound.file);
});

test("別の起動・派生・app-server・古い記録は、新しい会話として拾わない", async (t) => {
  const other = "f".repeat(32);
  const cases = [
    ["別の起動の印を持つ会話", (launchId) => later({ launchId: other })],
    ["ほかの会話から派生した会話（forked_from_id）", (launchId) => later({ launchId, forkedFrom: sessionId(LAUNCHED + 1000) })],
    ["app-server経由の会話（sourceがcliでない）", (launchId) => later({ launchId, source: "vscode" })],
    ["結び付けた会話より前に書かれた会話", (launchId) => later({ launchId, mtime: Date.now() - 120_000 })],
    ["この席の起動より前に作られた会話", (launchId) => later({ launchId, id: sessionId(LAUNCHED - 60_000) })],
    ["会話IDがUUIDv7でない記録", (launchId) => later({ launchId, id: `sess-${++serial}` })],
  ];
  for (const [name, build] of cases) {
    await t.test(name, () => {
      const { meta, bound, launchId } = seat(`switch-skip-${serial}`);
      rollout(build(launchId));
      assert.equal(codex.codexRootTranscript(meta), bound.file);
    });
  }
});

test("書いている途中で決められない記録は、次に読んだ時に決める", () => {
  const { meta, bound, launchId } = seat("switch-undecided");
  const next = rollout(later({ launchId, head: false }));
  assert.equal(codex.codexRootTranscript(meta), bound.file, "session_metaだけでは決めない");
  fs.appendFileSync(next.file, developer(launchId) + "\n" + CONTEXT + "\n");
  fs.utimesSync(next.file, new Date(Date.now() - 30_000), new Date(Date.now() - 30_000));
  assert.equal(codex.codexRootTranscript(meta), next.file);
});

test("送る道は、席の登録を今の会話へ結び付け直す", () => {
  const { meta, bound, launchId } = seat("switch-bind");
  assert.equal(codex.bindCodexTranscriptSession(meta), bound.file);
  assert.equal(meta.vendor_session_id, bound.id);
  const next = rollout(later({ launchId }));
  assert.equal(codex.bindCodexTranscriptSession(meta), next.file);
  assert.equal(meta.vendor_session_id, next.id);
  const saved = JSON.parse(fs.readFileSync(shared.agentMetadataPath(meta.aiterm_session, launchId), "utf8"));
  assert.equal(saved.vendor_session_id, next.id);
  assert.equal(codex.codexBoundTranscript(meta), next.file);
});

test("完了待ち: 送った後に出来た新しい会話の完了を拾い、回答も同じ会話から読む", async () => {
  const { meta, bound, launchId } = seat("switch-wait");
  const cursor = fs.statSync(bound.file).size;
  const waiting = codex.observeCodexDone(meta, 20, cursor);
  await sleep(300);
  // 送った文で出来た新しい会話。古い時刻の完了（前の会話の最後の書き込みより前）は、今回の完了に数えない。
  const next = rollout({ id: sessionId(Date.now()), launchId, lines: [
    event("task_complete", { turn_id: "turn-old", last_agent_message: "古い答え" }, Date.now() - 120_000),
    event("task_started", { turn_id: "turn-b" }),
    event("task_complete", { turn_id: "turn-b", last_agent_message: "新しい会話の答え" }),
  ] });
  const done = await waiting;
  assert.equal(done.outcome, "done");
  assert.equal(done.turn_id, "turn-b");
  assert.equal(done.vendor_session_id, next.id);
  // 完了待ちは席の登録を書き換えない（結び付け直すのは、次に送る時）。
  assert.equal(meta.vendor_session_id, bound.id);
  const lines = (file) => fs.readFileSync(file, "utf8").split("\n");
  const unavailable = () => { throw new Error("transcript unavailable"); };
  assert.equal(codex.codexTranscriptText(meta, "turn-b", lines, unavailable, true), "新しい会話の答え");
});

test("完了待ち: 読み位置なしで待ち始めた時は、切り替わった先の、今より後の完了を待つ", async () => {
  const { meta, launchId } = seat("switch-wait-now");
  const next = rollout({ id: sessionId(Date.now()), launchId, lines: [
    event("task_started", { turn_id: "turn-b" }), event("task_complete", { turn_id: "turn-b", last_agent_message: "前の答え" }),
  ] });
  const waiting = codex.observeCodexDone(meta, 20, null);
  await sleep(4500);
  fs.appendFileSync(next.file, event("task_started", { turn_id: "turn-c" }) + "\n" + event("task_complete", { turn_id: "turn-c", last_agent_message: "後の答え" }) + "\n");
  const done = await waiting;
  assert.equal(done.outcome, "done");
  assert.equal(done.turn_id, "turn-c");
});

test("完了待ち: 結び付けた会話が増えている間は、ほかの記録を見に行かない", async () => {
  const { meta, bound, launchId } = seat("switch-wait-bound");
  const cursor = fs.statSync(bound.file).size;
  const waiting = codex.observeCodexDone(meta, 20, cursor);
  await sleep(200);
  fs.appendFileSync(bound.file, event("task_started", { turn_id: "turn-a2" }) + "\n");
  // 後から出来た同じ起動の会話があっても、読み始めた会話の完了を待つ。
  await sleep(200);
  rollout({ id: sessionId(Date.now()), launchId, lines: [event("task_complete", { turn_id: "turn-x", last_agent_message: "別の会話" })] });
  await sleep(3500);
  fs.appendFileSync(bound.file, event("task_complete", { turn_id: "turn-a2", last_agent_message: "元の会話の答え" }) + "\n");
  const done = await waiting;
  assert.equal(done.turn_id, "turn-a2");
  assert.equal(done.vendor_session_id, bound.id);
});
