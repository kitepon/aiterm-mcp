import { isHostControllerClient, hostControllerLabel, LEGACY_INTERIM_CALLER } from "./host-controller.js";
// Controller-requested interim words; final answers and thinking are excluded.
// See docs/architecture/host-controller.md for the initialize role and caller marker.
// ハーネスごとの見分け方（2026-09-28 記録で確認）:
//   Claude Code: text block で message.stop_reason="tool_use"。isApiErrorMessage の行は知らせ。
//   Codex:       assistant message の phase="commentary"。task_complete の error はturnを終えた知らせ。
//   Grok:        content が空でなく tool_calls を持つ assistant。
//   Cursor:      assistant の text のあとに tool_use が続くもの（Cursorは道具が終わってから行を書くので遅れて届く）。
import * as fs from "node:fs";
import * as path from "node:path";
import { AitermError } from "./errors.js";
import {
  agentHarness,
  agentsDir,
  assertSessionName,
  LAUNCH_ID_RE,
  readFileRange,
  safeStatSize,
  writeJson0600,
} from "./agent-shared.js";
import type { AgentHarness, AgentMetadata } from "./agent-shared.js";
import { claudeSessionTranscriptPath } from "./harnesses/claude.js";
import { codexBoundTranscript, codexRootTranscript, codexResumeCursor, codexResumeTurnId, codexTurnError, codexTurnErrorLine } from "./harnesses/codex.js";
import { grokSessionDirectory } from "./harnesses/grok.js";
import { cursorTranscript } from "./harnesses/cursor.js";

/** Controller caller label in request metadata; see host-controller.md. */
export const INTERIM_CALLER_META_KEY = "aiterm/caller";
/** 前回受け取った最後のseq。これより後の言葉だけを返す。 */
export const INTERIM_AFTER_META_KEY = "aiterm/interim_after";
/** 結果の_metaで返すキー。 */
export const INTERIM_RESULT_META_KEY = "aiterm/interim_words";
/**
 * 読み始める位置。差し込みの返りと「席の今の番」が渡す文字列（中身は呼び手に読ませない）。
 * 指定した時は、最後のdispatchの境界ではなく、その位置より後の言葉を返す（ADR 0122）。
 */
export const INTERIM_FROM_META_KEY = "aiterm/interim_from";

/**
 * 合間の言葉を読み始める位置。event_cursorは、その位置を渡した返り（差し込み・席の今の番）の完了の位置で、結果へそのまま写す。
 * unitが"byte"ならboundaryは記録のbyte位置、"user"なら記録中のuser発話の数（Grok）。
 */
export interface InterimFrom {
  event_cursor: number;
  unit: "byte" | "user";
  boundary: number;
}

export function interimFromToken(from: InterimFrom): string {
  return `v1:${from.event_cursor}:${from.unit === "byte" ? "b" : "u"}:${from.boundary}`;
}

export function parseInterimFrom(token: unknown): InterimFrom | null {
  if (typeof token !== "string") return null;
  const match = /^v1:(\d{1,15}):([bu]):(\d{1,15})$/.exec(token);
  if (!match) return null;
  return { event_cursor: Number(match[1]), unit: match[2] === "b" ? "byte" : "user", boundary: Number(match[3]) };
}

export interface InterimWord {
  /** turn内で1から数える順番。同じturnでは読み直しても変わらない。 */
  seq: number;
  text: string;
  /** "error" はAPIエラーやsession limitの知らせ。 */
  kind: "interim" | "error";
  /** 記録に時刻がある時だけ（Claude・Codex）。 */
  at: string | null;
  /** 記録がturnの印を持つ時だけ（Codex）。 */
  turn_id: string | null;
}

export interface InterimWordsResult {
  schema: "aiterm.interim-words.v1";
  session_id: string;
  launch_id: string;
  harness: AgentHarness;
  /** このturnを始めたdispatchのreceipt.event_cursor。起動時promptのturnとturn開始前はnull。 */
  event_cursor: number | null;
  /** Claudeのdurable operationで始めたturnの時だけ。 */
  operation_id: string | null;
  /** turn内で書かれた言葉の数（=最後のseq）。次回の aiterm/interim_after に渡す。 */
  last_seq: number;
  words: InterimWord[];
}

interface InterimBoundary {
  schema: "aiterm.interim-boundary.v1";
  event_cursor: number;
  operation_id: string | null;
  // Claude・Codexは記録のbyte位置、Grok・Cursorは記録中のuser発話の数。
  boundary: number;
  dispatched_at: string;
}

export function agentInterimBoundaryPath(name: string, launchId: string): string {
  assertSessionName(name);
  if (!LAUNCH_ID_RE.test(launchId)) throw new AitermError(`launch_id が不正です: ${launchId}`, 2);
  return path.join(agentsDir(), `${name}.${launchId}.interim.json`);
}

/** Controller name marker, with the historical marker retained for compatibility. */
export function interimCallerFromMeta(meta: unknown, clientName?: string, capabilities?: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const caller = (meta as Record<string, unknown>)[INTERIM_CALLER_META_KEY];
  return caller === LEGACY_INTERIM_CALLER || (isHostControllerClient(clientName, capabilities) && caller === hostControllerLabel(clientName));
}

/**
 * 要求の_metaがcontrollerの印を持つ時だけ、前回のseqを返す。それ以外はnull（何も足さない）。
 * 読み始める位置（aiterm/interim_from）が付いていれば、fromに入れる。付いているのに読めない時はfromがnullでfrom_invalidがtrue
 * （最後のdispatchの言葉を黙って返すと、呼び手は別の番の言葉を出してしまう）。
 */
export function interimRequestFromMeta(meta: unknown, clientName?: string, capabilities?: unknown): { after: number; from?: InterimFrom | null; from_invalid?: true } | null {
  if (!interimCallerFromMeta(meta, clientName, capabilities)) return null;
  const record = meta as Record<string, unknown>;
  const raw = record[INTERIM_AFTER_META_KEY];
  const after = typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : 0;
  if (record[INTERIM_FROM_META_KEY] === undefined) return { after };
  const from = parseInterimFrom(record[INTERIM_FROM_META_KEY]);
  return from ? { after, from } : { after, from: null, from_invalid: true };
}

function parse(line: string): any {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    // 書込み途中の末尾行と、byte境界で切れた先頭行は読まない。
    return null;
  }
}

type Found = Omit<InterimWord, "seq">;

// ---------------------------------------------------------------- Claude Code

function claudeText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part: any) => (part?.type === "text" && typeof part.text === "string" ? part.text : "")).join("");
}

export function claudeInterimWords(lines: readonly string[]): Found[] {
  const words: Found[] = [];
  for (const line of lines) {
    const record = parse(line);
    if (record?.type !== "assistant" || record.isSidechain === true) continue;
    const at = typeof record.timestamp === "string" ? record.timestamp : null;
    if (record.isApiErrorMessage === true) {
      const text = claudeText(record.message?.content).trim();
      if (text) words.push({ text, kind: "error", at, turn_id: null });
      continue;
    }
    if (record.message?.stop_reason !== "tool_use") continue;
    const text = claudeText(record.message?.content).trim();
    if (text) words.push({ text, kind: "interim", at, turn_id: null });
  }
  return words;
}

// ---------------------------------------------------------------- Codex

export function codexInterimWords(lines: readonly string[]): Found[] {
  const words: Found[] = [];
  for (const line of lines) {
    const record = parse(line);
    const payload = record?.payload;
    // エラーで終わったturnは、task_completeへ本文を書く（利用上限もここ）。
    const error = codexTurnError(record);
    if (error) {
      words.push({
        // 利用上限はCodexの利用者向けの文をそのまま出す。ほかの誤りは、完了の返り（error）と同じ1行にする
        // （応答の本文やURLが混ざる文があるため）。
        text: error.info === "usage_limit_exceeded" ? error.message : codexTurnErrorLine(error),
        kind: "error",
        at: typeof record.timestamp === "string" ? record.timestamp : null,
        turn_id: typeof payload.turn_id === "string" && payload.turn_id ? payload.turn_id : null,
      });
      continue;
    }
    if (record?.type !== "response_item" || payload?.type !== "message" || payload?.role !== "assistant"
      || payload?.phase !== "commentary" || !Array.isArray(payload?.content)) continue;
    const text = payload.content
      .map((item: any) => (item?.type === "output_text" && typeof item.text === "string" ? item.text : ""))
      .join("")
      .trim();
    if (!text) continue;
    const turnId = payload.internal_chat_message_metadata_passthrough?.turn_id;
    words.push({
      text,
      kind: "interim",
      at: typeof record.timestamp === "string" ? record.timestamp : null,
      turn_id: typeof turnId === "string" && turnId ? turnId : null,
    });
  }
  return words;
}

// ---------------------------------------------------------------- Grok

function grokRealUser(record: any): boolean {
  return record?.type === "user" && !("synthetic_reason" in record);
}

export function grokUserCount(lines: readonly string[]): number {
  let count = 0;
  for (const line of lines) if (grokRealUser(parse(line))) count++;
  return count;
}

/** boundary+1番目のuser発話（このturnの依頼）以後のassistantのうち、言葉と道具の呼び出しを両方持つもの。 */
export function grokInterimWords(lines: readonly string[], boundary: number): Found[] {
  const words: Found[] = [];
  let users = 0;
  for (const line of lines) {
    const record = parse(line);
    if (grokRealUser(record)) users++;
    if (users <= boundary || record?.type !== "assistant") continue;
    if (!Array.isArray(record.tool_calls) || record.tool_calls.length === 0) continue;
    const text = typeof record.content === "string" ? record.content.trim() : "";
    if (text) words.push({ text, kind: "interim", at: null, turn_id: null });
  }
  return words;
}

// ---------------------------------------------------------------- Cursor

/**
 * boundary+1番目のuser発話（このturnの依頼）以後で、あとにtool_useが続いたtextの塊。
 * 次にuser発話かturn_endedが来た塊はそのturnの最後の回答なので含めない。末尾で行き先が決まっていない塊も待つ。
 */
export function cursorInterimWords(lines: readonly string[], boundary: number): Found[] {
  const words: Found[] = [];
  let users = 0;
  let pending: string[] = [];
  for (const line of lines) {
    const record = parse(line);
    if (!record) continue;
    if (record.role === "user" || record.type === "turn_ended") {
      if (record.role === "user") users++;
      pending = [];
      continue;
    }
    if (record.role !== "assistant" || !Array.isArray(record.message?.content)) continue;
    for (const part of record.message.content) {
      if (part?.type === "text" && typeof part.text === "string") pending.push(part.text);
      else if (part?.type === "tool_use") {
        const text = pending.join("\n").trim();
        if (text && users > boundary) words.push({ text, kind: "interim", at: null, turn_id: null });
        pending = [];
      }
    }
  }
  return words;
}

// ---------------------------------------------------------------- 境界と読み取り

function claudeTranscriptSize(meta: AgentMetadata): number {
  const file = claudeSessionTranscriptPath(meta);
  return file ? safeStatSize(file) : 0;
}

function grokChatHistory(meta: AgentMetadata): string | null {
  const dir = grokSessionDirectory(meta);
  return dir ? path.join(dir, "chat_history.jsonl") : null;
}

function readLines(file: string | null, from = 0): string[] {
  if (!file) return [];
  const size = safeStatSize(file);
  if (size <= from) return [];
  return readFileRange(file, from, size).toString("utf8").split("\n");
}

/**
 * dispatchの送信直前に、このturnの言葉が記録のどこから始まるかを残す。
 * eventCursorはdispatch receiptのevent_cursor（Codex・Cursorでは境界そのもの）。
 * 失敗してもdispatchは止めない。境界が古いままでも、呼び手はevent_cursorの不一致で気づける。
 */
export function recordInterimBoundary(meta: AgentMetadata, eventCursor: number, operationId: string | null): void {
  try {
    let boundary: number;
    if (meta.kind === "claude") boundary = claudeTranscriptSize(meta);
    else if (meta.kind === "grok") boundary = grokUserCount(readLines(grokChatHistory(meta)));
    else boundary = eventCursor;
    const value: InterimBoundary = {
      schema: "aiterm.interim-boundary.v1",
      event_cursor: eventCursor,
      operation_id: operationId,
      boundary,
      dispatched_at: new Date().toISOString(),
    };
    writeJson0600(agentInterimBoundaryPath(meta.aiterm_session, meta.launch_id), value);
  } catch {
    /* 合間の言葉は表示のためだけにある。送信を妨げない。 */
  }
}

function readInterimBoundary(meta: AgentMetadata): InterimBoundary | null {
  let value: any;
  try {
    value = JSON.parse(fs.readFileSync(agentInterimBoundaryPath(meta.aiterm_session, meta.launch_id), "utf8"));
  } catch {
    return null;
  }
  if (value?.schema !== "aiterm.interim-boundary.v1" || !Number.isSafeInteger(value.boundary) || value.boundary < 0
    || !Number.isSafeInteger(value.event_cursor)) return null;
  return value as InterimBoundary;
}

/**
 * 今の時点の読み始めの位置。差し込みを打つ直前に取る（その差し込みより後に書かれた言葉だけを読むため）。
 * Claude・Codex・Cursorは記録のbyte位置、Grokは記録中のuser発話の数（「今すぐ送る」で入った文は、次のuser発話になる）。
 * Cursorは、番が動いている間は記録を足すだけなので、byte位置が動かない（末尾の行を書き換えるのは、次の番の開始の時）。
 */
export function interimFromNow(meta: AgentMetadata, eventCursor: number): InterimFrom {
  if (meta.kind === "grok") return { event_cursor: eventCursor, unit: "user", boundary: grokUserCount(readLines(grokChatHistory(meta))) };
  let file: string | null = null;
  try {
    file = meta.kind === "claude" ? claudeSessionTranscriptPath(meta)
      : meta.kind === "codex" ? (meta.vendor_session_id ? codexBoundTranscript(meta) : codexRootTranscript(meta))
      : meta.kind === "cursor" ? cursorTranscript(meta) : null;
  } catch { /* 記録を決められない時は、頭から */ }
  return { event_cursor: eventCursor, unit: "byte", boundary: file ? safeStatSize(file) : 0 };
}

/** 渡された位置より後に書かれた合間の言葉。位置の単位がharnessと合わない時は、言葉なし。 */
function codexLinesFrom(meta: AgentMetadata, boundary: number): string[] {
  const file = meta.vendor_session_id ? codexBoundTranscript(meta) : codexRootTranscript(meta);
  const retiredTurn = codexResumeTurnId(meta, meta.vendor_session_id);
  return readLines(file, file ? Math.max(boundary, codexResumeCursor(meta, file)) : boundary).filter(line => {
    if (!retiredTurn) return true;
    try {
      const payload = JSON.parse(line)?.payload;
      return payload?.turn_id !== retiredTurn && payload?.internal_chat_message_metadata_passthrough?.turn_id !== retiredTurn;
    } catch { return false; }
  });
}

function interimWordsFrom(meta: AgentMetadata, from: InterimFrom): Found[] {
  if (meta.kind === "grok") return from.unit === "user" ? grokInterimWords(readLines(grokChatHistory(meta)), from.boundary) : [];
  if (from.unit !== "byte") return [];
  if (meta.kind === "claude") return claudeInterimWords(readLines(claudeSessionTranscriptPath(meta), from.boundary));
  if (meta.kind === "codex") return codexInterimWords(codexLinesFrom(meta, from.boundary));
  // 位置より後の行だけを渡すので、user発話の数では絞らない。
  return meta.kind === "cursor" ? cursorInterimWords(readLines(cursorTranscript(meta), from.boundary), -1) : [];
}

/**
 * 現在（または直前）のturnで書かれた合間の言葉のうち、seqがafterより後のもの。
 * fromを渡した時は、最後のdispatchの境界ではなく、その位置より後の言葉（seqはその位置から1で数える）。
 */
export function readInterimWords(meta: AgentMetadata, after: number, from: InterimFrom | null = null): InterimWordsResult {
  if (from) {
    const words = interimWordsFrom(meta, from).map((word, index) => ({ seq: index + 1, ...word }));
    return {
      schema: "aiterm.interim-words.v1",
      session_id: meta.aiterm_session,
      launch_id: meta.launch_id,
      harness: agentHarness(meta.kind),
      event_cursor: from.event_cursor,
      operation_id: null,
      last_seq: words.length,
      words: words.filter((word) => word.seq > after),
    };
  }
  const recorded = readInterimBoundary(meta);
  // dispatchの記録が無ければ、起動時promptのturnだけを記録の先頭から読む。promptなしで起動してまだ送っていない時は無い。
  const launchTurn = !recorded && meta.initial_prompt !== "none";
  let found: Found[] = [];
  if (recorded || launchTurn) {
    const boundary = recorded?.boundary ?? 0;
    if (meta.kind === "claude") found = claudeInterimWords(readLines(claudeSessionTranscriptPath(meta), boundary));
    // 境界は、送った時に結び付いていた会話のrolloutの位置。会話の切り替えは追わない（ADR 0105）。
    else if (meta.kind === "codex") found = codexInterimWords(codexLinesFrom(meta, boundary));
    else if (meta.kind === "grok") found = grokInterimWords(readLines(grokChatHistory(meta)), boundary);
    else if (meta.kind === "cursor") found = cursorInterimWords(readLines(cursorTranscript(meta)), boundary);
  }
  const words = found.map((word, index) => ({ seq: index + 1, ...word }));
  return {
    schema: "aiterm.interim-words.v1",
    session_id: meta.aiterm_session,
    launch_id: meta.launch_id,
    harness: agentHarness(meta.kind),
    event_cursor: recorded?.event_cursor ?? null,
    operation_id: recorded?.operation_id ?? null,
    last_seq: words.length,
    words: words.filter((word) => word.seq > after),
  };
}
