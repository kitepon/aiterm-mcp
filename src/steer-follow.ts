// 差し込みを追う口と「席の今の番」（ADR 0122）。BellTeamのためにある。
// BellTeamは、席への送信が「動いている番への差し込み」で返った時、その番を自分で始めていないと、終わりも答えも知る道が無かった
// （実被弾 2026-10-13: Aitermの子の結果で始まったCodexの番へ指揮官氏の文が3通差し込まれ、席は答えたのに会話画面に何も出なかった）。
// ここが持つのは3つ。
//   1. 差し込みの控え: 打つ直前の位置と、文の頭。待ちが、harnessの記録の中からその文を見つけるために読む。
//   2. 差し込みを追う待ち: その文を取った番の終わりを返す。取り込まれたか、次の番になったか、会話へ入らなかったかを分けて返す。
//   3. 席の今の番: 記録の上で動いている番の位置（Codex）。画面は読まない。
// 利用者向けのツール説明と引数には出さない（合間の言葉と同じ。interim-words.ts の冒頭）。要らないものと見て消さないこと。
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { AitermError } from "./errors.js";
import {
  AGENT_DONE_POLL_MS,
  AGENT_EVENT_MAX_BYTES,
  AGENT_RATE_LIMIT_POLL_MS,
  AGENT_TURN_BOUNDARY_TAIL_BYTES,
  agentHarness,
  agentMetadataPath,
  agentsDir,
  assertSessionName,
  LAUNCH_ID_RE,
  readFileRange,
  safeStatSize,
  scanLinesNewestFirst,
  sleep,
} from "./agent-shared.js";
import type { AgentDoneEvent, AgentMetadata, AgentSteerFate, AgentWaitObservation } from "./agent-shared.js";
import { claudeApiErrorFromLine, claudeSessionTranscriptPath } from "./harnesses/claude.js";
import {
  codexBoundTranscript,
  codexCompletionEvent,
  codexRolloutSessionId,
  codexRootTranscript,
  codexRunningTurn,
  codexTranscriptSessionId,
  codexTurnError,
  codexTurnErrorLine,
  codexUsageLimit,
} from "./harnesses/codex.js";
import { interimFromToken, parseInterimFrom } from "./interim-words.js";
import type { InterimFrom } from "./interim-words.js";

/** 差し込みの返りの_metaで返すキー。 */
export const STEER_RESULT_META_KEY = "aiterm/steer";
/** pty_listの結果の_metaで返すキー。 */
export const SEAT_TURNS_RESULT_META_KEY = "aiterm/seat_turns";

// ---------------------------------------------------------------- 差し込みの控え

const STEER_ID_RE = /^[0-9a-f]{16}$/;
// 控えは追記する。大きくなったら、新しい方だけを残して書き直す（待ちが読むのは、打った直後から番の終わりまでの間）。
const STEER_LEDGER_MAX_BYTES = 256 * 1024;
const STEER_LEDGER_KEEP = 100;
// 文の見分けに使うのは、空白を除いた先頭。記録の側は、harnessが前後に何かを足しても、この並びを含む。
const STEER_NEEDLE_CHARS = 160;
// これより短い文は、ほかの入力と取り違えるので見分けに使わない。
const STEER_NEEDLE_MIN_CHARS = 4;
// 画像を付けた文の後ろに足す行（core.attachImages）。harnessが書き換える所なので、見分けに使わない。
const ATTACHED_IMAGE_BLOCK = "\n\n[aiterm 添付画像 ";

export interface SteerEntry {
  schema: "aiterm.steer-entry.v1";
  steer_id: string;
  /** 打つ直前の時刻。 */
  at: string;
  /** 打つ直前の完了の位置（dispatchの返りのevent_cursorと同じ意味）。 */
  event_cursor: number;
  /** 打つ直前の記録の位置（合間の言葉を読み始める所。文の行もここより後に書かれる）。 */
  interim_from: string;
  /** 文の見分けに使う並び。短すぎる文は空。 */
  needle: string;
}

export function steerLedgerPath(name: string, launchId: string): string {
  assertSessionName(name);
  if (!LAUNCH_ID_RE.test(launchId)) throw new AitermError(`launch_id が不正です: ${launchId}`, 2);
  return path.join(agentsDir(), `${name}.${launchId}.steers.jsonl`);
}

const squeeze = (text: string): string => text.replace(/\s+/gu, "");

export function steerNeedle(text: string): string {
  const cut = text.indexOf(ATTACHED_IMAGE_BLOCK);
  const needle = squeeze(cut < 0 ? text : text.slice(0, cut)).slice(0, STEER_NEEDLE_CHARS);
  return needle.length >= STEER_NEEDLE_MIN_CHARS ? needle : "";
}

function parseSteerEntry(line: string): SteerEntry | null {
  if (!line.trim()) return null;
  let value: any;
  try { value = JSON.parse(line); } catch { return null; }
  if (value?.schema !== "aiterm.steer-entry.v1" || typeof value.steer_id !== "string" || !STEER_ID_RE.test(value.steer_id)
    || typeof value.at !== "string" || !Number.isSafeInteger(value.event_cursor) || value.event_cursor < 0
    || parseInterimFrom(value.interim_from) === null || typeof value.needle !== "string") return null;
  return value as SteerEntry;
}

/**
 * 差し込みを打つ直前に、位置と文の頭を控える。書けなかった時はnull（差し込みは止めない。呼び手は待つ手がかりを受け取らないだけ）。
 */
export function recordSteer(meta: AgentMetadata, from: InterimFrom, body: string): SteerEntry | null {
  try {
    const file = steerLedgerPath(meta.aiterm_session, meta.launch_id);
    const entry: SteerEntry = {
      schema: "aiterm.steer-entry.v1",
      steer_id: randomBytes(8).toString("hex"),
      at: new Date().toISOString(),
      event_cursor: from.event_cursor,
      interim_from: interimFromToken(from),
      needle: steerNeedle(body),
    };
    if (safeStatSize(file) > STEER_LEDGER_MAX_BYTES) {
      const kept = fs.readFileSync(file, "utf8").split("\n").filter(line => parseSteerEntry(line)).slice(-STEER_LEDGER_KEEP);
      const temporary = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, kept.map(line => `${line}\n`).join(""), { mode: 0o600 });
      fs.renameSync(temporary, file);
    }
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    return entry;
  } catch {
    return null;
  }
}

export function readSteerEntry(meta: AgentMetadata, steerId: string): SteerEntry | null {
  if (!STEER_ID_RE.test(steerId)) throw new AitermError("steer の値が不正です", 2);
  let body: string;
  try { body = fs.readFileSync(steerLedgerPath(meta.aiterm_session, meta.launch_id), "utf8"); } catch { return null; }
  const lines = body.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const entry = parseSteerEntry(lines[index]);
    if (entry?.steer_id === steerId) return entry;
  }
  return null;
}

// ---------------------------------------------------------------- 差し込みを追う待ち

// 番が終わった後、その文が次の番を始めるのを待つ間。harnessは番の終わりの直後に待ち行列の文を動かす（実物で0.1秒ほど）。
const STEER_AFTER_TURN_GRACE_MS = 8_000;
// 打ってから、会話の記録に何も現れないまま「入っていない」と決めるまでの間。Claude Codeは打った時点で待ち行列の行を書く。
const STEER_NOT_TAKEN_GRACE_MS = 30_000;
// 動いている番が在るかを記録で見直す間隔（Codex。番の開始の印までさかのぼって読む）。
const STEER_RUNNING_CHECK_MS = 5_000;
// 1回の見回りで読む上限。長い番の途中から待ち始めても、まとめて読まない。
const STEER_READ_CHUNK_BYTES = 4 * 1024 * 1024;
// Stopの知らせの時刻は、最後の文の行の時刻の少し後（実物で50〜70ミリ秒）。時計の刻みの分だけ許す。
const CLAUDE_STOP_AFTER_ANSWER_SLACK_MS = 250;

export interface SteerWaitDeps {
  signal?: AbortSignal;
  /** 打った後の最初の完了を待つ、今までの待ち。文を見分ける道が無いharnessと、記録を読めない時に使う。 */
  plain: (cursor: number, timeoutSeconds: number) => Promise<AgentWaitObservation>;
  /** 席の完了の知らせ（event file）の1行を読む。席の物でない行と読めない行はnull。 */
  parseDone: (line: string) => AgentDoneEvent | null;
  /** 利用上限の知らせ（画面）。見回りの間隔は呼ぶ側が空ける。 */
  rateLimit: () => string | null;
  now?: () => number;
}

const fate = (placement: AgentSteerFate["placement"], takenAt: string | null = null): AgentSteerFate => ({ placement, taken_at: takenAt });

/** 記録の増えた分を、行ごとに読む。行の途中で終わった分は次の回へ持ち越す。 */
class LineFollower {
  private carry: Buffer = Buffer.alloc(0);
  private dropFirst: boolean;
  constructor(private readonly file: string, public offset: number) {
    // 読み始めが行の途中なら、最初の切れ端は読まない。
    this.dropFirst = offset > 0 && readFileRange(file, offset - 1, offset).toString("utf8") !== "\n";
  }
  /** 読める所まで読んで、そろった行を返す。fileが短くなった時はnull。 */
  read(): string[] | null {
    const size = safeStatSize(this.file);
    if (size < this.offset) return null;
    if (size === this.offset) return [];
    const end = Math.min(size, this.offset + STEER_READ_CHUNK_BYTES);
    const chunk = readFileRange(this.file, this.offset, end);
    this.offset += chunk.length;
    const joined = this.carry.length ? Buffer.concat([this.carry, chunk]) : chunk;
    const last = joined.lastIndexOf(0x0a);
    if (last < 0) {
      this.carry = joined;
      return [];
    }
    this.carry = joined.subarray(last + 1);
    const lines = joined.subarray(0, last).toString("utf8").split("\n");
    if (this.dropFirst) {
      lines.shift();
      this.dropFirst = false;
    }
    return lines;
  }
  /** まだ読んでいない分が在るか。 */
  get behind(): boolean { return safeStatSize(this.file) > this.offset; }
}

function baseObservation(meta: AgentMetadata): Omit<AgentWaitObservation, "outcome" | "steer"> {
  return {
    schema: "aiterm.agent-wait-result.v1",
    session_id: meta.aiterm_session,
    launch_id: meta.launch_id,
    vendor: meta.kind,
    harness: agentHarness(meta.kind),
    operation_id: null,
    vendor_session_id: meta.vendor_session_id ?? null,
    turn_id: null,
    malformed_events: 0,
    at: null,
    rate_limit: null,
    error: null,
    error_kind: null,
  };
}

/**
 * 差し込んだ文を取った番の終わりを待つ。
 * CodexとClaude Codeは、harnessの記録の中から文を見つけて、その番の終わりを返す。
 * GrokとCursorは「今すぐ送る」で必ず動いている番へ入る（入らなければ差し込みが誤りで返る）ので、打った後の最初の完了が、その番の終わり。
 */
export async function observeSteerDone(
  meta: AgentMetadata,
  entry: SteerEntry,
  timeoutSeconds: number,
  deps: SteerWaitDeps,
): Promise<AgentWaitObservation> {
  if (meta.kind === "codex") return observeCodexSteerDone(meta, entry, timeoutSeconds, deps);
  if (meta.kind === "claude") return observeClaudeSteerDone(meta, entry, timeoutSeconds, deps);
  return { ...await deps.plain(entry.event_cursor, timeoutSeconds), steer: fate("same_turn") };
}

// ------------------------------------------------ Codex

/**
 * Codexの記録の、利用者の文の行。文でなければnull。
 * 番の頭に入る前提の文（AGENTS.md・環境）も、userの行として書かれる。行の種類が書いてある版（0.162.1の実記録では
 * 利用者の入力が`user.text`、前提の文が`agents_md.instructions`など）では、利用者の入力だけを数える。
 */
function codexUserText(record: any): string | null {
  const payload = record?.payload;
  if (record?.type === "response_item" && payload?.type === "message" && payload?.role === "user" && Array.isArray(payload.content)) {
    const kinds = payload.internal_chat_message_metadata_passthrough?.content_item_kinds;
    if (Array.isArray(kinds) && !kinds.some((kind: unknown) => typeof kind === "string" && kind.startsWith("user."))) return null;
    return payload.content.map((item: any) => (typeof item?.text === "string" ? item.text : "")).join("");
  }
  if (record?.type === "event_msg" && payload?.type === "user_message" && typeof payload.message === "string") return payload.message;
  return null;
}

/**
 * Codex: 文は、取られた時に、その番のturn_idを付けたuserの行として記録へ書かれる（0.162.1の実記録 2026-10-13。打って約1秒）。
 * その行のturn_idのtask_completeが、文を取った番の終わり。番の開始の印が打った位置より後に在れば、文が新しい番を始めている。
 */
async function observeCodexSteerDone(
  meta: AgentMetadata,
  entry: SteerEntry,
  timeoutSeconds: number,
  deps: SteerWaitDeps,
): Promise<AgentWaitObservation> {
  const now = deps.now ?? (() => Date.now());
  const anchored = (): string | null => {
    try { return meta.vendor_session_id ? codexBoundTranscript(meta) : codexRootTranscript(meta); } catch { return null; }
  };
  const transcript = anchored();
  if (!transcript) return { ...await deps.plain(entry.event_cursor, timeoutSeconds), steer: fate("unknown") };
  const metadataFile = agentMetadataPath(meta.aiterm_session, meta.launch_id);
  const harnessSessionId = meta.vendor_session_id ? codexRolloutSessionId(meta, transcript) : codexTranscriptSessionId(transcript);
  const follower = new LineFollower(transcript, entry.event_cursor);
  const sentAt = Date.parse(entry.at);
  const deadline = performance.now() + timeoutSeconds * 1000;
  let malformedEvents = 0;
  let sawUser = false;
  let openTurn: string | null = null;
  const startedAfter = new Set<string>();
  let taken: { turn: string | null; fate: AgentSteerFate } | null = null;
  // 文を見つける前に終わった、最初の番（見分けられなかった時に返す）。
  let first: { done: AgentDoneEvent; record: any; seenAt: number } | null = null;
  let runningCheckAt = 0;
  let quietSince = performance.now();

  const finish = (done: AgentDoneEvent, record: any, steer: AgentSteerFate): AgentWaitObservation => {
    const observed = { ...baseObservation(meta), vendor_session_id: done.vendor_session_id ?? meta.vendor_session_id ?? null,
      turn_id: done.turn_id, malformed_events: malformedEvents, at: done.at, steer };
    const limited = codexUsageLimit(record);
    if (limited) return { ...observed, outcome: "rate_limited", rate_limit: limited };
    const failed = codexTurnError(record);
    return failed ? { ...observed, outcome: "error", error: codexTurnErrorLine(failed), error_kind: failed.info } : { ...observed, outcome: "done" };
  };
  const pending = (outcome: AgentWaitObservation["outcome"]): AgentWaitObservation =>
    ({ ...baseObservation(meta), outcome, malformed_events: malformedEvents, steer: taken?.fate ?? fate("unknown") });

  for (;;) {
    deps.signal?.throwIfAborted();
    if (!fs.existsSync(metadataFile)) return pending("closed");
    const lines = follower.read();
    if (lines === null) throw new AitermError("Codex transcript が完了待機中に短くなりました。該当セッションを閉じて起動し直してください。", 2);
    if (lines.length) quietSince = performance.now();
    for (const line of lines) {
      if (!line.trim()) continue;
      if (Buffer.byteLength(line, "utf8") > AGENT_EVENT_MAX_BYTES) {
        malformedEvents++;
        continue;
      }
      let record: any;
      try { record = JSON.parse(line); } catch {
        malformedEvents++;
        continue;
      }
      const payload = record?.payload;
      if (record?.type === "event_msg" && payload?.type === "task_started" && typeof payload.turn_id === "string") {
        openTurn = payload.turn_id;
        startedAfter.add(payload.turn_id);
        continue;
      }
      const text = codexUserText(record);
      if (text !== null) {
        sawUser = true;
        if (!taken && entry.needle && squeeze(text).includes(entry.needle)) {
          const tagged = payload?.internal_chat_message_metadata_passthrough?.turn_id;
          const turn = typeof tagged === "string" && tagged ? tagged : openTurn;
          taken = { turn, fate: fate(turn !== null && startedAfter.has(turn) ? "next_turn" : "same_turn",
            typeof record.timestamp === "string" ? record.timestamp : null) };
        }
        continue;
      }
      const done = codexCompletionEvent(meta, harnessSessionId, record);
      if (!done) continue;
      if (openTurn === done.turn_id) openTurn = null;
      // 文の行にturn_idが無い版では、行が書かれた時に動いていた番（その後の最初の完了）を、文を取った番と数える。
      if (taken && (taken.turn === null || taken.turn === done.turn_id)) return finish(done, record, taken.fate);
      if (!taken && !first) {
        const stamped = Date.parse(record.timestamp);
        first = { done, record, seenAt: Number.isFinite(stamped) ? stamped : now() };
      }
    }
    if (!taken && !follower.behind) {
      if (first) {
        // 番は終わったのに、文が次の番を始めない。ほかの利用者の行が在れば、見分けを誤ったかも知れないので、今までの意味（最初の番の終わり）で返す。
        if (now() - first.seenAt >= STEER_AFTER_TURN_GRACE_MS) {
          return sawUser ? finish(first.done, first.record, fate("unknown")) : pending("not_taken");
        }
      } else if (!sawUser && Number.isFinite(sentAt) && now() - sentAt >= STEER_NOT_TAKEN_GRACE_MS && performance.now() >= runningCheckAt) {
        runningCheckAt = performance.now() + STEER_RUNNING_CHECK_MS;
        // 打った後に利用者の行も番の終わりも無く、動いている番も無い。文は会話へ入っていない。
        if (codexRunningTurn(meta) === null) return pending("not_taken");
      }
      // 待っている間に、同じprocessの新しい会話へ移っていた時（/new など。ADR 0105）は、文の行をこの記録では追えない。今までの待ちへ渡す。
      if (performance.now() - quietSince >= STEER_RUNNING_CHECK_MS) {
        quietSince = performance.now();
        let current: string | null = null;
        try { current = codexRootTranscript(meta); } catch { /* 読めない時は、今の記録を見続ける */ }
        if (current && current !== transcript) {
          const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
          return { ...await deps.plain(entry.event_cursor, remaining), steer: fate("unknown") };
        }
      }
    }
    if (performance.now() >= deadline) return pending(timeoutSeconds === 0 ? "running" : "timeout");
    await sleep(AGENT_DONE_POLL_MS);
  }
}

// ------------------------------------------------ Claude Code

function claudeTextBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part: any) => (part?.type === "text" && typeof part.text === "string" ? part.text : "")).join("");
}

/** 番を始めた利用者の文の行（道具の結果の行、子の行、圧縮の要約は含めない）。文でなければnull。 */
function claudePromptText(record: any): string | null {
  if (record?.type !== "user" || record.isSidechain === true || record.isCompactSummary === true || record.isMeta === true) return null;
  const content = record.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.some((part: any) => part?.type === "tool_result")) return null;
  const text = claudeTextBlocks(content);
  return text ? text : null;
}

/**
 * Claude Code: 番の最中に打った文は、待ち行列へ入る（queue-operationのenqueue。contentに文の全文）。
 * 道具の合間に取り込まれるとremove（reason: absorbed_mid_turn。contentは同じ）、取り込まれずに番が終わるとdequeueの後にuserの行になる。
 * 入力待ちの席へ打った文は、待ち行列を通らずにuserの行になる（2.1.296の実記録 2026-10-13）。
 * その番の終わりは、文が取られた行より後に書かれた答えを持つ完了。Stopのhookが書く知らせのresult_digestは、最後の文
 * （stop_reasonがend_turnの行のtext）のsha256と同じ（実物で3席）。時刻の近さで選ぶと、前の番のStop（次の番の開始と0.1秒しか
 * 離れない）を取り違える。
 */
async function observeClaudeSteerDone(
  meta: AgentMetadata,
  entry: SteerEntry,
  timeoutSeconds: number,
  deps: SteerWaitDeps,
): Promise<AgentWaitObservation> {
  const now = deps.now ?? (() => Date.now());
  const from = parseInterimFrom(entry.interim_from);
  const transcript = claudeSessionTranscriptPath(meta);
  if (!transcript || !from || from.unit !== "byte") return { ...await deps.plain(entry.event_cursor, timeoutSeconds), steer: fate("unknown") };
  const metadataFile = agentMetadataPath(meta.aiterm_session, meta.launch_id);
  const record = new LineFollower(transcript, from.boundary);
  let events = new LineFollower(meta.event_file, entry.event_cursor);
  const sentAt = Date.parse(entry.at);
  const deadline = performance.now() + timeoutSeconds * 1000;
  let malformedEvents = 0;
  // 待ち行列に入った、こちらの文（removeのcontentと比べる）。
  let queued: string | null = null;
  // こちらの文でない入力（待ち行列の行か、番を始めた文）が在ったか。在る時は、見分けを誤ったかも知れないので「入っていない」と言わない。
  let otherInput = false;
  let taken: AgentSteerFate | null = null;
  // 文が取られた後に書かれた、sidechainでないassistantの文の指紋と、その行の時刻。
  const answers = new Map<string, number>();
  const stops: AgentDoneEvent[] = [];
  let rateLimitAt = 0;

  const observed = (outcome: AgentWaitObservation["outcome"], done: AgentDoneEvent | null, steer: AgentSteerFate): AgentWaitObservation => ({
    ...baseObservation(meta), outcome, operation_id: done?.operation_id ?? null,
    vendor_session_id: done?.vendor_session_id ?? meta.vendor_session_id ?? null, malformed_events: malformedEvents, at: done?.at ?? null, steer,
  });

  for (;;) {
    deps.signal?.throwIfAborted();
    if (!fs.existsSync(metadataFile)) return observed("closed", null, taken ?? fate("unknown"));
    const lines = record.read();
    if (lines === null) {
      // 会話の記録が短くなった（書き直された）。控えた位置が使えないので、今までの待ち（打った後の最初の完了）へ渡す。
      const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
      return { ...await deps.plain(entry.event_cursor, remaining), steer: taken ?? fate("unknown") };
    }
    for (const line of lines) {
      if (!line.trim()) continue;
      let parsed: any;
      try { parsed = JSON.parse(line); } catch { continue; }
      const stamp = typeof parsed?.timestamp === "string" ? parsed.timestamp : null;
      if (parsed?.type === "queue-operation") {
        const content = typeof parsed.content === "string" ? parsed.content : "";
        if (parsed.operation === "enqueue") {
          if (!taken && queued === null && entry.needle && squeeze(content).includes(entry.needle)) queued = content;
          else if (!content.startsWith("<task-notification>")) otherInput = true;
        } else if (parsed.operation === "remove" && !taken && queued !== null && content === queued) {
          taken = fate("same_turn", stamp);
        }
        continue;
      }
      const prompt = claudePromptText(parsed);
      if (prompt !== null) {
        if (!taken && entry.needle && squeeze(prompt).includes(entry.needle)) taken = fate("next_turn", stamp);
        else if (!prompt.startsWith("<task-notification>")) otherInput = true;
        continue;
      }
      if (!taken || parsed?.type !== "assistant" || parsed.isSidechain === true) continue;
      // Stopが来ない終わり方（APIエラー）は、今までの待ちと同じく、誤りとして返す。
      const failed = claudeApiErrorFromLine(line);
      if (failed) return { ...observed("error", null, taken), at: failed.at, error: failed.text };
      const text = claudeTextBlocks(parsed.message?.content);
      const at = stamp ? Date.parse(stamp) : NaN;
      answers.set(createHash("sha256").update(text, "utf8").digest("hex"), Number.isFinite(at) ? at : -Infinity);
    }
    const added = events.read();
    if (added === null) {
      events = new LineFollower(meta.event_file, 0);
      stops.length = 0;
      continue;
    }
    for (const line of added) {
      if (!line.trim()) continue;
      const done = deps.parseDone(line);
      if (done) stops.push(done);
    }
    if (taken) {
      for (const done of stops) {
        const written = done.result_digest ? answers.get(done.result_digest) : undefined;
        if (written === undefined) continue;
        const at = Date.parse(done.at);
        if (Number.isFinite(at) && at + CLAUDE_STOP_AFTER_ANSWER_SLACK_MS >= written) return observed("done", done, taken);
      }
    } else if (!record.behind && !events.behind) {
      if (stops.length) {
        // 番は終わったのに、文が取り込まれも次の番にもなっていない。
        const ended = Date.parse(stops[0].at);
        if (now() - (Number.isFinite(ended) ? ended : now()) >= STEER_AFTER_TURN_GRACE_MS) {
          return queued !== null || otherInput ? observed("done", stops[0], fate("unknown")) : observed("not_taken", null, fate("unknown"));
        }
      } else if (queued === null && !otherInput && Number.isFinite(sentAt) && now() - sentAt >= STEER_NOT_TAKEN_GRACE_MS) {
        // 打った後、待ち行列の行も番を始めた文の行も無い。文は会話へ入っていない（選ぶ画面に消えた、など）。
        return observed("not_taken", null, fate("unknown"));
      }
    }
    if (performance.now() >= rateLimitAt) {
      rateLimitAt = performance.now() + AGENT_RATE_LIMIT_POLL_MS;
      const limited = deps.rateLimit();
      if (limited) return { ...observed("rate_limited", null, taken ?? fate("unknown")), rate_limit: limited };
    }
    if (performance.now() >= deadline) return observed(timeoutSeconds === 0 ? "running" : "timeout", null, taken ?? fate("unknown"));
    await sleep(AGENT_DONE_POLL_MS);
  }
}

// ---------------------------------------------------------------- 席の今の番

export type SeatTurn =
  | { state: "running"; turn_id: string; started_at: string | null; event_cursor: number; interim_from: string }
  | { state: "idle" };

interface CodexTurnMark { type: "task_started" | "task_complete" | "turn_aborted"; turn_id: string | null; at: string | null; offset: number }

interface CodexSeatTrack { key: string; file: string; offset: number; last: CodexTurnMark | null; resolvedAt: number }

// 席ごとに、記録をどこまで読んだかと、最後の番の境界を覚える。次の回は増えた分だけを読む（全席を数秒おきに聞かれても重くならないように）。
const codexSeatTracks = new Map<string, CodexSeatTrack>();
const CODEX_SEAT_TRACKS_MAX = 512;
// 記録が増えていない席で、今の会話の記録を探し直す間隔。探し直しは会話の置き場を一覧するので、聞かれるたびにはやらない。
// 席の中で会話を移した後（/new など。ADR 0105）、次の送信が席を結び付け直すまでの間も、新しい会話の番を読むためにある。
const CODEX_SEAT_RESOLVE_MS = 60_000;
// 会話がまだ結び付いていない席（起こしてから、2つめの送信までの間）で、記録が見つからなかった時に、次に探すまでの間。
// 結び付く前の席は、会話の置き場の一覧と、起動より後に書かれた記録の頭から、この起動の印を探す。聞かれるたびにはやらない。
const CODEX_SEAT_UNBOUND_RETRY_MS = 5_000;
const codexSeatUnresolved = new Map<string, { key: string; retryAt: number }>();

function codexTurnMark(line: string, offset: number): CodexTurnMark | undefined {
  if (!line.includes("task_started") && !line.includes("task_complete") && !line.includes("turn_aborted")) return undefined;
  let record: any;
  try { record = JSON.parse(line); } catch { return undefined; }
  const type = record?.type === "event_msg" ? record?.payload?.type : null;
  if (type !== "task_started" && type !== "task_complete" && type !== "turn_aborted") return undefined;
  return { type, turn_id: typeof record.payload.turn_id === "string" && record.payload.turn_id ? record.payload.turn_id : null,
    at: typeof record.timestamp === "string" ? record.timestamp : null, offset };
}

function codexSeatTranscript(meta: AgentMetadata): string | null {
  try { return codexRootTranscript(meta); } catch { return null; }
}

/**
 * Codexの席の、記録の上の今の番。番の開始の印（task_started）が最後の境界なら動いている。
 * 動いている番のevent_cursorとinterim_fromは、開始の印の行の頭（そこから待てば、その番の終わりで返り、番の頭からの合間の言葉を読める）。
 * 記録がまだ無い・末尾を書いている途中の席はnull（分からない）。
 * 会話を結び付ける前の席（vendor_session_idがまだ無い）も、この起動の印を持つ記録から読む。席の登録は書き換えない。
 * 起こしたばかりの席は、最初の送信の時に記録がまだ無く、2つめの送信まで結び付かない。子の結果が2つめの番を始める席は、この形になる
 * （実物 2026-10-13: 最初の番の間も、終わった後も、会話のIDは席の登録に入っていなかった）。
 * harnessが落ちた席は、終わりの印が書かれないので、動いていると読んだままになる（呼び手は、席が閉じた事を待ちのclosedで知る）。
 */
export function codexSeatTurn(meta: AgentMetadata, now: number = performance.now()): SeatTurn | null {
  if (meta.kind !== "codex") return null;
  const key = `${meta.launch_id}:${meta.vendor_session_id ?? ""}`;
  const id = meta.aiterm_session;
  let track = codexSeatTracks.get(id);
  if (track && track.key === key && safeStatSize(track.file) === track.offset && now - track.resolvedAt >= CODEX_SEAT_RESOLVE_MS) {
    track.resolvedAt = now;
    const current = codexSeatTranscript(meta);
    if (current && current !== track.file) track = undefined;
  }
  if (!track || track.key !== key || !fs.existsSync(track.file)) {
    const unresolved = codexSeatUnresolved.get(id);
    if (unresolved && unresolved.key === key && now < unresolved.retryAt) return null;
    const file = codexSeatTranscript(meta);
    if (!file) {
      codexSeatTracks.delete(id);
      if (meta.vendor_session_id) codexSeatUnresolved.delete(id);
      else {
        codexSeatUnresolved.delete(id);
        if (codexSeatUnresolved.size >= CODEX_SEAT_TRACKS_MAX) codexSeatUnresolved.delete(codexSeatUnresolved.keys().next().value as string);
        codexSeatUnresolved.set(id, { key, retryAt: now + CODEX_SEAT_UNBOUND_RETRY_MS });
      }
      return null;
    }
    codexSeatUnresolved.delete(id);
    track = { key, file, offset: -1, last: null, resolvedAt: now };
    codexSeatTracks.delete(id);
    if (codexSeatTracks.size >= CODEX_SEAT_TRACKS_MAX) codexSeatTracks.delete(codexSeatTracks.keys().next().value as string);
    codexSeatTracks.set(id, track);
  }
  const size = safeStatSize(track.file);
  if (track.offset < 0 || size < track.offset) {
    // 初めて見る席（と、記録が短くなった席）は、末尾からさかのぼって最後の境界を探す。長い番の開始の印は、末尾から遠い。
    // 読んだ事にする位置は、さかのぼる前に取った大きさ。その後に足された行は、次の回に増えた分として読む（同じ行を2回読んでも結果は同じ）。
    track.offset = -1;
    if (size > 0 && readFileRange(track.file, size - 1, size)[0] !== 0x0a) return null;
    const mark = scanLinesNewestFirst(track.file, codexTurnMark, AGENT_TURN_BOUNDARY_TAIL_BYTES);
    if (mark === null) return null;
    track.last = mark ?? null;
    track.offset = size;
  } else if (size > track.offset) {
    let offset = track.offset;
    while (offset < size) {
      const chunk = readFileRange(track.file, offset, Math.min(size, offset + STEER_READ_CHUNK_BYTES));
      if (chunk.length === 0) break;
      const last = chunk.lastIndexOf(0x0a);
      if (last < 0) {
        // 行が読む範囲に収まらない。末尾を書いている途中なら、そろうのを次の回まで待つ。
        // 範囲を使い切った長い行（道具の出力など）は境界の行ではないので、その行の終わりまで読み飛ばす。
        if (chunk.length < STEER_READ_CHUNK_BYTES) break;
        offset += chunk.length;
        continue;
      }
      for (let from = 0; from <= last;) {
        const index = chunk.indexOf(0x0a, from);
        const mark = codexTurnMark(chunk.subarray(from, index).toString("utf8"), offset + from);
        if (mark) track.last = mark;
        from = index + 1;
      }
      offset += last + 1;
    }
    track.offset = offset;
  }
  const last = track.last;
  if (last?.type === "task_started" && last.turn_id) {
    return { state: "running", turn_id: last.turn_id, started_at: last.at, event_cursor: last.offset,
      interim_from: interimFromToken({ event_cursor: last.offset, unit: "byte", boundary: last.offset }) };
  }
  return { state: "idle" };
}

/** 試験用: 席ごとの読み位置の覚えを捨てる。 */
export function __testResetSeatTurns(): void {
  codexSeatTracks.clear();
  codexSeatUnresolved.clear();
}
