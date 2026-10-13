// 差し込みを追う口と「席の今の番」（ADR 0122）。harnessの記録を手で書いて、待ちが返す番と、文の行き先を確かめる。席は開かない。
// 記録の形は、Codex 0.162.1とClaude Code 2.1.296の実記録（2026-10-13）から取った。
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-sf-"));
process.env.XDG_RUNTIME_DIR = process.env.TMPDIR;
process.env.CLAUDE_CONFIG_DIR = path.join(process.env.TMPDIR, "claude");

const load = (file) => import(new URL(`../dist/${file}`, import.meta.url).href);
const { agentMetadataPath } = await load("agent-shared.js");
const { claudeSessionTranscriptPath } = await load("harnesses/claude.js");
const { observeCodexDone } = await load("harnesses/codex.js");
const { interimFromNow, interimFromToken, interimRequestFromMeta, parseInterimFrom, readInterimWords } = await load("interim-words.js");
const follow = await load("steer-follow.js");
const { parseArgs } = await load("aiterm-wait-cli.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 記録の時刻は、今の時計から数える。待ちは「番が終わってから何秒たったか」を、記録の時刻と今の時計で比べる。
const BASE = Date.now();
const at = (seconds) => new Date(BASE + Math.round(seconds * 1000)).toISOString();
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
let serial = 0;
const launchId = () => (++serial).toString(16).padStart(32, "0");
const TEXT = "追加の頼み：  表も\n付けて、数は3つに絞ってくだされ";

/** 待ちを起こす。今までの待ちへ渡した時は、渡された位置を覚えて、決めた結果を返す。 */
function waitSteer(seat, entry, options = {}) {
  const handed = [];
  const result = follow.observeSteerDone(seat.meta, entry, options.timeout ?? 5, {
    plain: async (cursor) => {
      handed.push(cursor);
      return { schema: "aiterm.agent-wait-result.v1", session_id: seat.meta.aiterm_session, launch_id: seat.meta.launch_id, vendor: seat.meta.kind,
        outcome: "done", operation_id: null, vendor_session_id: null, turn_id: "plain", malformed_events: 0, at: null, rate_limit: null, error: null, error_kind: null };
    },
    parseDone: (line) => {
      try {
        const value = JSON.parse(line);
        return value.type === "agent_done" ? value : null;
      } catch { return null; }
    },
    rateLimit: () => options.rateLimit ?? null,
    now: options.now,
  });
  return { result, handed };
}
/** 待ちがまだ返っていない事を確かめる。 */
async function stillWaiting(waiting, ms = 350) {
  const state = await Promise.race([waiting.result.then(() => "returned"), sleep(ms).then(() => "waiting")]);
  assert.equal(state, "waiting");
}

// ---------------------------------------------------------------- Codex

const codexEvent = (type, seconds, extra = {}) => JSON.stringify({ timestamp: at(seconds), type: "event_msg", payload: { type, ...extra } });
const started = (turn, seconds) => codexEvent("task_started", seconds, { turn_id: turn, started_at: 1791898293 });
const complete = (turn, seconds, extra = {}) => codexEvent("task_complete", seconds, { turn_id: turn, last_agent_message: "答え", ...extra });
const codexUser = (turn, text, seconds, kinds = ["user.text"]) => JSON.stringify({ timestamp: at(seconds), type: "response_item",
  payload: { type: "message", role: "user", content: [{ type: "input_text", text }],
    ...(turn === null ? {} : { internal_chat_message_metadata_passthrough: { turn_id: turn, content_item_kinds: kinds } }) } });
const codexSaid = (turn, phase, text, seconds) => JSON.stringify({ timestamp: at(seconds), type: "response_item",
  payload: { type: "message", role: "assistant", phase, content: [{ type: "output_text", text }], internal_chat_message_metadata_passthrough: { turn_id: turn } } });

function codexSeat(lines = []) {
  const home = fs.mkdtempSync(path.join(process.env.TMPDIR, "codex-"));
  const dir = path.join(home, "sessions", "2026", "10", "13");
  fs.mkdirSync(dir, { recursive: true });
  const launch = launchId();
  const session = `01a13576-15fd-7583-9c76-${launch.slice(-12)}`;
  const meta = { kind: "codex", aiterm_session: `sf_codex_${serial}`, launch_id: launch, codex_home: home, hook_route: "shared_codex_home",
    completion_route: "codex_transcript", created_at: new Date(Date.now() - 60_000).toISOString(), vendor_session_id: session };
  const file = path.join(dir, `rollout-2026-10-13T12-00-00-${session}.jsonl`);
  fs.writeFileSync(file, [
    JSON.stringify({ type: "session_meta", payload: { id: session, originator: "codex-tui", source: "cli" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: `AITERM_AGENT_LAUNCH_ID=${launch}` }] } }),
    ...lines,
  ].join("\n") + "\n");
  fs.writeFileSync(agentMetadataPath(meta.aiterm_session, launch), "{}\n");
  return { meta, file, append: (...added) => fs.appendFileSync(file, added.join("\n") + "\n"),
    steer: (text = TEXT, extra = {}) => ({ ...follow.recordSteer(meta, interimFromNow(meta, fs.statSync(file).size), text), ...extra }) };
}

test("Codex: 動いている番が取り込んだ文は、その番の終わりで返り、same_turn", async () => {
  const seat = codexSeat([started("turn-a", 0)]);
  const entry = seat.steer();
  const waiting = waitSteer(seat, entry);
  // 前提の文の行（番の頭に入る物）は、利用者の入力として数えない。
  seat.append(codexUser("turn-a", "# AGENTS.md instructions", 1, ["agents_md.instructions", "environments.environment_context"]),
    codexUser("turn-a", `Aitermが届ける文です。\n${TEXT}`, 2), codexSaid("turn-a", "commentary", "表を足す", 3));
  await stillWaiting(waiting);
  seat.append(complete("turn-a", 5));
  const result = await waiting.result;
  assert.equal(result.outcome, "done");
  assert.equal(result.turn_id, "turn-a");
  assert.equal(result.at, at(5));
  assert.equal(result.vendor_session_id, seat.meta.vendor_session_id);
  assert.deepEqual(result.steer, { placement: "same_turn", taken_at: at(2) });
  assert.deepEqual(waiting.handed, []);
});

test("Codex: 番の後で文が新しい番を始めた時は、前の番の終わりでは返らず、新しい番の終わりで返り、next_turn", async () => {
  const seat = codexSeat([started("turn-a", 0)]);
  const waiting = waitSteer(seat, seat.steer());
  seat.append(complete("turn-a", 1));
  await stillWaiting(waiting);
  seat.append(started("turn-b", 2), codexUser("turn-b", TEXT, 2.1), complete("turn-b", 9));
  const result = await waiting.result;
  assert.equal(result.outcome, "done");
  assert.equal(result.turn_id, "turn-b");
  assert.deepEqual(result.steer, { placement: "next_turn", taken_at: at(2.1) });
});

test("Codex: 文の行に番のIDが無い記録では、行が書かれた時に動いていた番の終わりで返る", async () => {
  const seat = codexSeat([started("turn-a", 0)]);
  const waiting = waitSteer(seat, seat.steer());
  seat.append(codexUser(null, TEXT, 1), complete("turn-a", 4));
  const result = await waiting.result;
  assert.equal(result.turn_id, "turn-a");
  assert.equal(result.steer.placement, "same_turn");
});

test("Codex: 文を取った番が誤りや利用上限で終わった時は、その終わり方で返す", async () => {
  const failed = codexSeat([started("turn-a", 0)]);
  const first = waitSteer(failed, failed.steer());
  failed.append(codexUser("turn-a", TEXT, 1), complete("turn-a", 2, { last_agent_message: null, error: { message: "boom", codex_error_info: "internal_server_error" } }));
  const error = await first.result;
  assert.equal(error.outcome, "error");
  assert.equal(error.error_kind, "internal_server_error");
  assert.equal(error.steer.placement, "same_turn");

  const limited = codexSeat([started("turn-a", 0)]);
  const second = waitSteer(limited, limited.steer());
  limited.append(codexUser("turn-a", TEXT, 1),
    complete("turn-a", 2, { last_agent_message: null, error: { message: "You've hit your usage limit.", codex_error_info: "usage_limit_exceeded" } }));
  const limit = await second.result;
  assert.equal(limit.outcome, "rate_limited");
  assert.equal(limit.rate_limit, "You've hit your usage limit.");
});

test("Codex: 打った後に利用者の行も番の終わりも無く、動いている番も無い時は、not_taken", async () => {
  // 番が終わった直後に打って、文が会話へ入らなかった形。
  const seat = codexSeat([started("turn-a", 0), complete("turn-a", 1)]);
  const entry = seat.steer();
  const early = await waitSteer(seat, entry, { timeout: 0 }).result;
  assert.equal(early.outcome, "running", "打ってすぐは、入っていないと決めない");
  const late = await waitSteer(seat, entry, { now: () => Date.parse(entry.at) + 31_000 }).result;
  assert.equal(late.outcome, "not_taken");
  assert.deepEqual(late.steer, { placement: "unknown", taken_at: null });
  assert.equal(late.turn_id, null);

  // 番が動いている間は、利用者の行がまだ無くても待つ（Codexは次の道具の後で取り込む）。
  const running = codexSeat([started("turn-a", 0)]);
  const patient = running.steer();
  const waited = await waitSteer(running, patient, { timeout: 1, now: () => Date.parse(patient.at) + 31_000 }).result;
  assert.equal(waited.outcome, "timeout");
});

test("Codex: 番は終わったが文を見分けられない時は、打った後の最初の番の終わりで返し、unknown。ほかの入力も無ければnot_taken", async () => {
  const seat = codexSeat([started("turn-a", 0)]);
  const waiting = waitSteer(seat, seat.steer(), { now: () => Date.parse(at(2)) + 9_000 });
  seat.append(codexUser("turn-a", "形を変えて入った別の文", 1), complete("turn-a", 2));
  const result = await waiting.result;
  assert.equal(result.outcome, "done");
  assert.equal(result.turn_id, "turn-a");
  assert.deepEqual(result.steer, { placement: "unknown", taken_at: null });

  const empty = codexSeat([started("turn-a", 0)]);
  const lost = waitSteer(empty, empty.steer(), { now: () => Date.parse(at(2)) + 9_000 });
  empty.append(complete("turn-a", 2));
  assert.equal((await lost.result).outcome, "not_taken");
});

test("Codex: 待っている間に席が閉じたらclosed。記録が無い席は、今までの待ちへ渡してunknown", async () => {
  const seat = codexSeat([started("turn-a", 0)]);
  const waiting = waitSteer(seat, seat.steer());
  await stillWaiting(waiting, 200);
  fs.rmSync(agentMetadataPath(seat.meta.aiterm_session, seat.meta.launch_id));
  assert.equal((await waiting.result).outcome, "closed");

  const gone = codexSeat([started("turn-a", 0)]);
  const entry = gone.steer();
  fs.rmSync(gone.file);
  const handed = waitSteer(gone, entry);
  const result = await handed.result;
  assert.equal(result.turn_id, "plain");
  assert.deepEqual(result.steer, { placement: "unknown", taken_at: null });
  assert.deepEqual(handed.handed, [entry.event_cursor]);
});

// ---------------------------------------------------------------- Claude Code

function claudeSeat(lines = []) {
  const launch = launchId();
  const cwd = fs.mkdtempSync(path.join(process.env.TMPDIR, "work-"));
  const meta = { kind: "claude", aiterm_session: `sf_claude_${serial}`, launch_id: launch, cwd, hook_route: "shared_claude_settings",
    created_at: new Date().toISOString(), vendor_session_id: `53b24e89-e076-46dc-941e-${launch.slice(-12)}`,
    event_file: path.join(process.env.TMPDIR, `events-${launch}.jsonl`) };
  const file = claudeSessionTranscriptPath(meta);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((line) => line + "\n").join(""));
  fs.writeFileSync(meta.event_file, "");
  fs.writeFileSync(agentMetadataPath(meta.aiterm_session, launch), "{}\n");
  const stop = (text, seconds) => fs.appendFileSync(meta.event_file, JSON.stringify({ type: "agent_done", vendor: "claude",
    aiterm_session: meta.aiterm_session, launch_id: launch, vendor_session_id: meta.vendor_session_id, turn_id: null, operation_id: null, reason: "Stop",
    done_status: "turn_done", stop_hook_active: false, result_digest: sha256(text), result_bytes: Buffer.byteLength(text), at: at(seconds) }) + "\n");
  return { meta, file, stop, append: (...added) => fs.appendFileSync(file, added.join("\n") + "\n"),
    steer: (text = TEXT) => follow.recordSteer(meta, interimFromNow(meta, fs.statSync(meta.event_file).size), text) };
}
const queue = (operation, seconds, extra = {}) => JSON.stringify({ type: "queue-operation", operation, timestamp: at(seconds), sessionId: "s", ...extra });
const said = (text, stop, seconds, extra = {}) => JSON.stringify({ type: "assistant", timestamp: at(seconds),
  message: { role: "assistant", stop_reason: stop, content: [{ type: "text", text }] }, ...extra });
const prompted = (text, seconds, extra = {}) => JSON.stringify({ type: "user", timestamp: at(seconds), promptId: "p", origin: { kind: "human" },
  message: { role: "user", content: text }, ...extra });
const toolResult = (seconds) => JSON.stringify({ type: "user", timestamp: at(seconds), message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } });
const HEAD = [prompted("最初の頼み", -10), said("調べる", "tool_use", -9)];

test("Claude Code: 道具の合間に取り込まれた文は、その番の終わりで返り、same_turn", async () => {
  const seat = claudeSeat(HEAD);
  const waiting = waitSteer(seat, seat.steer());
  seat.append(queue("enqueue", 1, { content: `Aitermが届ける文です。\n${TEXT}` }), toolResult(1.5),
    queue("remove", 2, { content: `Aitermが届ける文です。\n${TEXT}`, reason: "absorbed_mid_turn", commandUuid: "c", deliveryId: "d" }),
    JSON.stringify({ type: "attachment", timestamp: at(2), attachment: { type: "queued_command", prompt: TEXT } }),
    said("子の途中の文", "end_turn", 3, { isSidechain: true }), said("表を足した。答え", "end_turn", 5));
  await stillWaiting(waiting);
  seat.stop("表を足した。答え", 5.06);
  const result = await waiting.result;
  assert.equal(result.outcome, "done");
  assert.equal(result.at, at(5.06));
  assert.equal(result.vendor_session_id, seat.meta.vendor_session_id);
  assert.deepEqual(result.steer, { placement: "same_turn", taken_at: at(2) });
});

test("Claude Code: 取り込まれずに番が終わった文は、前の番のStopでは返らず、その文が始めた番の終わりで返り、next_turn", async () => {
  const seat = claudeSeat(HEAD);
  const waiting = waitSteer(seat, seat.steer());
  // 前の番と次の番の答えが同じ文でも、前の番のStop（次の番の開始と0.1秒しか離れない）を取らない。
  seat.append(queue("enqueue", 1, { content: TEXT }), said("了解", "end_turn", 2));
  seat.stop("了解", 2.06);
  await stillWaiting(waiting);
  seat.append(queue("dequeue", 2.1), prompted(TEXT, 2.15), said("調べる", "tool_use", 3), toolResult(4), said("了解", "end_turn", 8));
  await stillWaiting(waiting);
  seat.stop("了解", 8.06);
  const result = await waiting.result;
  assert.equal(result.outcome, "done");
  assert.equal(result.at, at(8.06));
  assert.deepEqual(result.steer, { placement: "next_turn", taken_at: at(2.15) });
});

test("Claude Code: 入力待ちの席へ入った文は、待ち行列を通らずに番を始め、next_turn", async () => {
  const seat = claudeSeat(HEAD);
  const waiting = waitSteer(seat, seat.steer());
  seat.append(prompted(TEXT, 1), said("答え", "end_turn", 3));
  seat.stop("答え", 3.05);
  assert.deepEqual((await waiting.result).steer, { placement: "next_turn", taken_at: at(1) });
});

test("Claude Code: 文を取った番がAPIエラーで終わった時は、errorで返す", async () => {
  const seat = claudeSeat(HEAD);
  const waiting = waitSteer(seat, seat.steer());
  seat.append(prompted(TEXT, 1), said("API Error: 529 Overloaded", "stop_sequence", 2, { isApiErrorMessage: true, apiErrorStatus: 529 }));
  const result = await waiting.result;
  assert.equal(result.outcome, "error");
  assert.equal(result.error, "API Error: 529 Overloaded");
  assert.equal(result.steer.placement, "next_turn");
});

test("Claude Code: 打った後、待ち行列の行も番を始めた文の行も無い時は、not_taken。ほかの入力が在る間は決めない", async () => {
  const seat = claudeSeat(HEAD);
  const entry = seat.steer();
  assert.equal((await waitSteer(seat, entry, { timeout: 0 }).result).outcome, "running");
  // 子の仕事の知らせ（task-notification）は、利用者の入力に数えない。
  seat.append(queue("enqueue", 1, { content: "<task-notification>\n<task-id>x</task-id>" }));
  const late = await waitSteer(seat, entry, { now: () => Date.parse(entry.at) + 31_000 }).result;
  assert.equal(late.outcome, "not_taken");
  assert.deepEqual(late.steer, { placement: "unknown", taken_at: null });

  const busy = claudeSeat(HEAD);
  const other = busy.steer();
  busy.append(queue("enqueue", 1, { content: "別の人が打った文" }));
  assert.equal((await waitSteer(busy, other, { timeout: 1, now: () => Date.parse(other.at) + 31_000 }).result).outcome, "timeout");
});

test("Claude Code: 番は終わったが文が取り込まれも次の番にもならない時は、最初のStopで返してunknown", async () => {
  const seat = claudeSeat(HEAD);
  const waiting = waitSteer(seat, seat.steer(), { now: () => Date.parse(at(2.06)) + 9_000 });
  seat.append(queue("enqueue", 1, { content: TEXT }), said("前の答え", "end_turn", 2));
  seat.stop("前の答え", 2.06);
  const result = await waiting.result;
  assert.equal(result.outcome, "done");
  assert.equal(result.at, at(2.06));
  assert.deepEqual(result.steer, { placement: "unknown", taken_at: null });
});

test("Claude Code: 会話の記録が短くなった時と、利用上限の知らせが出た時", async () => {
  const seat = claudeSeat(HEAD);
  const entry = seat.steer();
  const waiting = waitSteer(seat, entry);
  await stillWaiting(waiting, 200);
  fs.writeFileSync(seat.file, "");
  const result = await waiting.result;
  assert.equal(result.turn_id, "plain");
  assert.deepEqual(result.steer, { placement: "unknown", taken_at: null });
  assert.deepEqual(waiting.handed, [entry.event_cursor]);

  const limited = claudeSeat(HEAD);
  const limit = await waitSteer(limited, limited.steer(), { rateLimit: "You've hit your session limit" }).result;
  assert.equal(limit.outcome, "rate_limited");
  assert.equal(limit.rate_limit, "You've hit your session limit");
});

test("GrokとCursorは、打った後の最初の完了を、文を取った番の終わりとして返す", async () => {
  for (const kind of ["grok", "cursor"]) {
    const seat = { meta: { kind, aiterm_session: `sf_${kind}`, launch_id: launchId() } };
    const waiting = waitSteer(seat, { steer_id: "0123456789abcdef", at: at(0), event_cursor: 7, interim_from: "v1:7:u:2", needle: "" });
    const result = await waiting.result;
    assert.equal(result.turn_id, "plain");
    assert.deepEqual(result.steer, { placement: "same_turn", taken_at: null });
    assert.deepEqual(waiting.handed, [7]);
  }
});

// ---------------------------------------------------------------- 控えと位置

test("差し込みの控え: 打つ直前の位置と文の頭を残し、IDで引ける", () => {
  const seat = codexSeat([started("turn-a", 0)]);
  const size = fs.statSync(seat.file).size;
  const entry = follow.recordSteer(seat.meta, interimFromNow(seat.meta, size), TEXT);
  assert.match(entry.steer_id, /^[0-9a-f]{16}$/);
  assert.equal(entry.event_cursor, size);
  assert.deepEqual(parseInterimFrom(entry.interim_from), { event_cursor: size, unit: "byte", boundary: size });
  assert.equal(entry.needle, TEXT.replace(/\s+/gu, ""));
  const second = follow.recordSteer(seat.meta, interimFromNow(seat.meta, size), "二つめの文です");
  assert.deepEqual(follow.readSteerEntry(seat.meta, entry.steer_id), entry);
  assert.deepEqual(follow.readSteerEntry(seat.meta, second.steer_id), second);
  assert.equal(follow.readSteerEntry(seat.meta, "ffffffffffffffff"), null);
  assert.throws(() => follow.readSteerEntry(seat.meta, "../x"), /steer の値が不正/);
  assert.equal(path.basename(follow.steerLedgerPath(seat.meta.aiterm_session, seat.meta.launch_id)), `${seat.meta.aiterm_session}.${seat.meta.launch_id}.steers.jsonl`);
});

test("差し込みの控え: 文の見分けは空白を除いた先頭160字。短すぎる文と、画像の行は使わない", () => {
  assert.equal(follow.steerNeedle("  了解 \n しました "), "了解しました");
  assert.equal(follow.steerNeedle("ok"), "");
  assert.equal(follow.steerNeedle("あ".repeat(400)).length, 160);
  assert.equal(follow.steerNeedle("この絵を見て\n\n[aiterm 添付画像 1/1] /tmp/x.png"), "この絵を見て");
});

test("合間の言葉: 読み始める位置を渡すと、その位置より後の言葉を、1から数えて返す", () => {
  const seat = codexSeat([started("turn-a", 0), codexSaid("turn-a", "commentary", "打つ前の言葉", 1)]);
  const from = interimFromNow(seat.meta, 42);
  assert.deepEqual(from, { event_cursor: 42, unit: "byte", boundary: fs.statSync(seat.file).size });
  seat.append(codexUser("turn-a", TEXT, 2), codexSaid("turn-a", "commentary", "表を足す", 3), codexSaid("turn-a", "commentary", "数を絞る", 4),
    codexSaid("turn-a", "final_answer", "答え", 5));
  const words = readInterimWords(seat.meta, 0, from);
  assert.equal(words.event_cursor, 42);
  assert.equal(words.last_seq, 2);
  assert.deepEqual(words.words.map((word) => [word.seq, word.text]), [[1, "表を足す"], [2, "数を絞る"]]);
  assert.deepEqual(readInterimWords(seat.meta, 1, from).words.map((word) => word.text), ["数を絞る"]);

  const token = interimFromToken(from);
  assert.deepEqual(interimRequestFromMeta({ "aiterm/caller": "BellTeam", "aiterm/interim_from": token, "aiterm/interim_after": 1 }), { after: 1, from });
  assert.deepEqual(interimRequestFromMeta({ "aiterm/caller": "BellTeam", "aiterm/interim_from": "v9:1:b:2" }), { after: 0, from: null, from_invalid: true });
  assert.equal(interimRequestFromMeta({ "aiterm/caller": "Other", "aiterm/interim_from": token }), null);
});

test("aiterm-wait: --steer を受け、--operation とは併用できない", () => {
  assert.deepEqual(parseArgs(["--session", "s1", "--cursor", "12", "--steer", "0123456789abcdef"]),
    { session: "s1", operationId: null, timeout: 600, cursor: 12, steer: "0123456789abcdef" });
  assert.equal(parseArgs(["--session", "s1"]).steer, null);
  assert.throws(() => parseArgs(["--session", "s1", "--steer", "xyz"]), /--steer が不正/);
  assert.throws(() => parseArgs(["--session", "s1", "--steer", "0123456789abcdef", "--operation", `sha256:${"a".repeat(64)}`]), /併用できません/);
});

// ---------------------------------------------------------------- 席の今の番

test("席の今の番: 最後の境界が番の開始なら動いている。位置は開始の印の行の頭", async () => {
  follow.__testResetSeatTurns();
  const seat = codexSeat();
  assert.deepEqual(follow.codexSeatTurn(seat.meta), { state: "idle" }, "番がまだ1つも無い");
  const offset = fs.statSync(seat.file).size;
  seat.append(started("turn-a", 0), codexSaid("turn-a", "commentary", "見てくる", 1));
  const running = follow.codexSeatTurn(seat.meta);
  assert.deepEqual(running, { state: "running", turn_id: "turn-a", started_at: at(0), event_cursor: offset,
    interim_from: interimFromToken({ event_cursor: offset, unit: "byte", boundary: offset }) });
  // その位置から読むと、番の頭からの合間の言葉が取れる。その位置から待つと、その番の終わりで返る。
  assert.deepEqual(readInterimWords(seat.meta, 0, parseInterimFrom(running.interim_from)).words.map((word) => word.text), ["見てくる"]);
  assert.equal((await observeCodexDone(seat.meta, 0, running.event_cursor)).outcome, "running");
  seat.append(complete("turn-a", 5));
  const done = await observeCodexDone(seat.meta, 2, running.event_cursor);
  assert.equal(done.outcome, "done");
  assert.equal(done.turn_id, "turn-a");
  assert.deepEqual(follow.codexSeatTurn(seat.meta), { state: "idle" });
  const next = fs.statSync(seat.file).size;
  seat.append(started("turn-b", 6));
  assert.equal(follow.codexSeatTurn(seat.meta).event_cursor, next);
  seat.append(codexEvent("turn_aborted", 7, { turn_id: "turn-b", reason: "interrupted" }));
  assert.deepEqual(follow.codexSeatTurn(seat.meta), { state: "idle" });
});

test("席の今の番: 初めて見る席は、開始の印が末尾から1MiBより前でも見つける。末尾を書いている途中は分からない", () => {
  follow.__testResetSeatTurns();
  const seat = codexSeat();
  const offset = fs.statSync(seat.file).size;
  seat.append(started("turn-long", 0));
  const filler = codexEvent("agent_message", 1, { message: "x".repeat(64 * 1024) });
  for (let index = 0; index < 24; index += 1) seat.append(filler);
  assert.ok(fs.statSync(seat.file).size - offset > 1024 * 1024);
  const running = follow.codexSeatTurn(seat.meta);
  assert.equal(running.state, "running");
  assert.equal(running.turn_id, "turn-long");
  assert.equal(running.event_cursor, offset);

  follow.__testResetSeatTurns();
  fs.appendFileSync(seat.file, '{"timestamp":"2026-10-13T12:00:09.000Z","type":"event_msg","payload":{"type":"task_comp');
  assert.equal(follow.codexSeatTurn(seat.meta), null, "書いている途中の行が終わるまで、決めない");
  fs.appendFileSync(seat.file, 'lete","turn_id":"turn-long"}}\n');
  assert.deepEqual(follow.codexSeatTurn(seat.meta), { state: "idle" });

  // 増えた分を読んでいる時に、末尾が行の途中でも、そろった行までで決める。
  fs.appendFileSync(seat.file, started("turn-next", 10) + '\n{"timestamp":"2026-10-13T12:00:11.000Z","type":"event_msg","payload":{"type":"task_comp');
  assert.equal(follow.codexSeatTurn(seat.meta).turn_id, "turn-next");
  fs.appendFileSync(seat.file, 'lete","turn_id":"turn-next"}}\n');
  assert.deepEqual(follow.codexSeatTurn(seat.meta), { state: "idle" });
});

test("席の今の番: 番の頭から待つと、番が16MiBより多く書いた後でも、その番の終わりで返る", async () => {
  follow.__testResetSeatTurns();
  const seat = codexSeat();
  seat.append(started("turn-huge", 0));
  const running = follow.codexSeatTurn(seat.meta);
  // 道具の出力のような長い行と、短い行を混ぜて17MiB。途中に、改行で終わる前の番の終わりは無い。
  const long = codexEvent("exec_command_output", 1, { output: "y".repeat(900 * 1024) });
  for (let index = 0; index < 19; index += 1) seat.append(long, codexSaid("turn-huge", "commentary", `途中 ${index}`, 2));
  assert.ok(fs.statSync(seat.file).size - running.event_cursor > 16 * 1024 * 1024);
  assert.equal((await observeCodexDone(seat.meta, 0, running.event_cursor)).outcome, "running");
  seat.append(complete("turn-huge", 9));
  const done = await observeCodexDone(seat.meta, 5, running.event_cursor);
  assert.equal(done.outcome, "done");
  assert.equal(done.turn_id, "turn-huge");
  assert.equal(done.at, at(9));
});

test("席の今の番: Codexでない席と、会話がまだ結び付いていない席は、分からない", () => {
  follow.__testResetSeatTurns();
  const seat = codexSeat([started("turn-a", 0)]);
  assert.equal(follow.codexSeatTurn({ ...seat.meta, vendor_session_id: null }), null);
  assert.equal(follow.codexSeatTurn({ ...seat.meta, kind: "claude" }), null);
  assert.equal(follow.codexSeatTurn({ ...seat.meta, vendor_session_id: "01a13576-0000-7000-8000-000000000000" }), null, "記録が無い");
});
