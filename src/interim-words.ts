// 合間の言葉: agent sessionがturnの途中で書き、そのあと道具を使った言葉。
// BellTeamのためにある。BellTeamは実行中のBotが何をしているかを会話画面へ出すため、
// pty_observeのMCP要求の_metaに caller="BellTeam" を入れて呼び、結果の_metaでこれを受け取る。
// 利用者向けのツール説明と引数には出さない（BellTeam以外のAIに指定させないため）。要らないものと見て消さないこと。
//
// 最後の回答と思考は含めない。APIエラーやsession limitの知らせは、記録に書かれていれば含める。
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
import { codexBoundTranscript, codexRootTranscript, codexTurnError, codexTurnErrorLine } from "./harnesses/codex.js";
import { grokSessionDirectory } from "./harnesses/grok.js";
import { cursorTranscript } from "./harnesses/cursor.js";

/** BellTeamが要求の_metaへ入れる呼び手の印。値が "BellTeam" の時だけ合間の言葉を返す。 */
export const INTERIM_CALLER_META_KEY = "aiterm/caller";
export const INTERIM_CALLER = "BellTeam";
/** 前回受け取った最後のseq。これより後の言葉だけを返す。 */
export const INTERIM_AFTER_META_KEY = "aiterm/interim_after";
/** 結果の_metaで返すキー。 */
export const INTERIM_RESULT_META_KEY = "aiterm/interim_words";

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

/** 要求の_metaがBellTeamの印を持つ時だけ、前回のseqを返す。それ以外はnull（何も足さない）。 */
export function interimRequestFromMeta(meta: unknown): { after: number } | null {
  if (!meta || typeof meta !== "object") return null;
  const record = meta as Record<string, unknown>;
  if (record[INTERIM_CALLER_META_KEY] !== INTERIM_CALLER) return null;
  const after = record[INTERIM_AFTER_META_KEY];
  return { after: typeof after === "number" && Number.isSafeInteger(after) && after > 0 ? after : 0 };
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

/** 現在（または直前）のturnで書かれた合間の言葉のうち、seqがafterより後のもの。 */
export function readInterimWords(meta: AgentMetadata, after: number): InterimWordsResult {
  const recorded = readInterimBoundary(meta);
  // dispatchの記録が無ければ、起動時promptのturnだけを記録の先頭から読む。promptなしで起動してまだ送っていない時は無い。
  const launchTurn = !recorded && meta.initial_prompt !== "none";
  let found: Found[] = [];
  if (recorded || launchTurn) {
    const boundary = recorded?.boundary ?? 0;
    if (meta.kind === "claude") found = claudeInterimWords(readLines(claudeSessionTranscriptPath(meta), boundary));
    // 境界は、送った時に結び付いていた会話のrolloutの位置。会話の切り替えは追わない（ADR 0105）。
    else if (meta.kind === "codex") found = codexInterimWords(readLines(meta.vendor_session_id ? codexBoundTranscript(meta) : codexRootTranscript(meta), boundary));
    else if (meta.kind === "grok") found = grokInterimWords(readLines(grokChatHistory(meta)), boundary);
    else found = cursorInterimWords(readLines(cursorTranscript(meta)), boundary);
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
