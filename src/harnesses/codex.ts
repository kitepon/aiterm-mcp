import { authUrl, authUserCode, type AgentAuthPlan, type AgentAuthStatus, type AgentAuthPane } from "../agent-auth.js";
// Codex 固有の制御。完了正本は root rollout transcript の task_complete（ADR 0022）。
// core 所有のサービス（transcript 行読取・rate limit 検知）は引数で注入し、
// 依存方向を core → harnesses → agent-shared の一方向に保つ。
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { AitermError } from "../errors.js";
import { spawnAgentControlCommand } from "../agent-resolver.js";
import * as steer from "aiterm-steer-delivery";
import { AITERM_PROFILE } from "../steer-profile.js";
import { catalogInvalid, catalogUnavailable, checkedCatalog, type AgentModelCatalog, type AgentModelChoice } from "../model-catalog.js";
import {
  shq,
  subagentInstruction,
  writeScopeLaunchNote,
  safeStatSize,
  readFileRange,
  sleep,
  agentMetadataPath,
  writeAgentMetadata,
  agentEventPath,
  createEmpty0600,
  agentLineageFields,
  AGENT_DONE_POLL_MS,
  AGENT_EVENT_MAX_BYTES,
  AGENT_EVENT_TAIL_BYTES,
  AGENT_TURN_BOUNDARY_TAIL_BYTES,
  readTailLinesNewestFirst,
  CODEX_TRANSCRIPT_INCREMENT_MAX_BYTES,
  agentHarness,
} from "../agent-shared.js";
import type { AgentKind, AgentMetadata, AgentDoneEvent, AgentWaitObservation, InitialPromptState, AgentLineageContext, HarnessPaneObservation } from "../agent-shared.js";

export function realCodexHome(): string {
  return process.env.CODEX_HOME || path.join(process.env.HOME ?? os.homedir(), ".codex");
}

// config.toml の top-level model / model_reasoning_effort ピンを起動報告用に読む。TOML パーサは
// 持ち込まず基本形（key = "値"）だけ解決する。行はあるが値を解析できない場合も「継承あり」として
// 正直に報告する（黙って CLI 既定扱いにしない）。
export type CodexConfigPin = { present: boolean; value: string | null };
export function readCodexConfigPins(configPath: string): { model: CodexConfigPin; effort: CodexConfigPin } {
  let body: string;
  try {
    body = fs.readFileSync(configPath, "utf8");
  } catch {
    return { model: { present: false, value: null }, effort: { present: false, value: null } };
  }
  const rows = body.split(/\r?\n/);
  let firstTable = rows.findIndex((l) => /^\s*\[/.test(l));
  if (firstTable === -1) firstTable = rows.length;
  const pick = (key: string): CodexConfigPin => {
    for (const l of rows.slice(0, firstTable)) {
      const m = l.match(new RegExp(`^\\s*(?:"${key}"|'${key}'|${key})\\s*=\\s*(.*)$`));
      if (m) {
        const v = m[1].trim().match(/^"([^"\\]*)"\s*(?:#.*)?$/);
        return { present: true, value: v ? v[1] : null };
      }
    }
    return { present: false, value: null };
  };
  return { model: pick("model"), effort: pick("model_reasoning_effort") };
}

export function codexConfigSummary(configPath: string): string {
  let body: string;
  try {
    body = fs.readFileSync(configPath, "utf8");
  } catch {
    return "";
  }
  const rows = body.split(/\r?\n/);
  const mcpServers = rows.filter((line) => /^\s*\[mcp_servers\./.test(line)).length;
  const firstTable = rows.findIndex((line) => /^\s*\[/.test(line));
  const topLevel = rows.slice(0, firstTable === -1 ? rows.length : firstTable);
  const valueOf = (key: string): string | null => {
    const row = topLevel.find((line) => new RegExp(`^\\s*(?:"${key}"|'${key}'|${key})\\s*=\\s*(.+?)\\s*(?:#.*)?$`).test(line));
    if (!row) return null;
    const raw = row.match(/=\s*(.+?)(?:\s+#.*)?$/)?.[1].trim() ?? null;
    if (!raw) return null;
    const quoted = raw.match(/^(?:"([^"\\]*)"|'([^'\\]*)')$/);
    return quoted ? quoted[1] ?? quoted[2] : raw;
  };
  const bits = [`mcp_servers ${mcpServers} 個継承`];
  const approvalPolicy = valueOf("approval_policy");
  const sandboxMode = valueOf("sandbox_mode");
  if (approvalPolicy) bits.push(`approval_policy=${approvalPolicy}`);
  if (sandboxMode) bits.push(`sandbox_mode=${sandboxMode}`);
  return `共有 config: ${bits.join(" / ")}`;
}

export function findLatestCodexTranscript(codexHome: string, harnessSessionId: string): string | null {
  const sessionsDir = path.join(codexHome, "sessions");
  let latestFile: string | null = null;
  let latestMtime = -Infinity;
  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(file);
        continue;
      }
      if (!entry.isFile() || !entry.name.startsWith("rollout-") || !entry.name.endsWith(".jsonl") || !entry.name.includes(harnessSessionId)) continue;
      try {
        const mtimeMs = fs.statSync(file).mtimeMs;
        if (mtimeMs > latestMtime) {
          latestFile = file;
          latestMtime = mtimeMs;
        }
      } catch {
        // 探索中に消えた transcript は候補にしない。候補が無ければ明示エラーにする。
      }
    }
  };
  visit(sessionsDir);
  return latestFile;
}

export function listCodexTranscripts(codexHome: string): string[] {
  const sessionsDir = path.join(codexHome, "sessions");
  const files: string[] = [];
  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) files.push(file);
    }
  };
  visit(sessionsDir);
  return files.sort();
}

type CodexLaunchVerdict = "match" | "other" | "undecided";

/**
 * rolloutがこの起動のroot会話かを、頭の1MBから読む。
 * - match: Codex CLIのroot会話で、developerの文にこの起動の印がある。
 * - other: root会話でない。または、最初のturnの文脈（turn_context）まで書かれているのに印が無い。後から変わらない。
 * - undecided: 書いている途中などで、まだ決められない。
 * forkedは、ほかの会話から派生した会話（session_metaのforked_from_id）か。派生は元の会話の文を写すので、印だけでは持ち主を決められない。
 */
function codexLaunchVerdict(file: string, meta: AgentMetadata): { verdict: CodexLaunchVerdict; forked: boolean } {
  const createdAt = Date.parse(meta.created_at);
  try {
    const st = fs.statSync(file);
    if (Number.isFinite(createdAt) && st.mtimeMs + 5_000 < createdAt) return { verdict: "other", forked: false };
  } catch {
    return { verdict: "undecided", forked: false };
  }
  const size = Math.min(safeStatSize(file), 1024 * 1024);
  if (size === 0) return { verdict: "undecided", forked: false };
  const marker = `AITERM_AGENT_LAUNCH_ID=${meta.launch_id}`;
  let rootCli = false;
  let forked = false;
  let launchMarker = false;
  let firstTurnContext = false;
  for (const line of readFileRange(file, 0, size).toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    let record: any;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record?.type === "session_meta") {
      rootCli = record?.payload?.originator === "codex-tui" && record?.payload?.source === "cli";
      if (!rootCli) return { verdict: "other", forked: false };
      forked = typeof record?.payload?.forked_from_id === "string" && record.payload.forked_from_id !== "";
    }
    if (record?.type === "turn_context") firstTurnContext = true;
    if (
      record?.type === "response_item" &&
      record?.payload?.type === "message" &&
      record?.payload?.role === "developer" &&
      Array.isArray(record?.payload?.content)
    ) {
      launchMarker ||= record.payload.content.some(
        (item: any) =>
          (item?.type === "input_text" || item?.type === "output_text") &&
          typeof item?.text === "string" &&
          item.text.includes(marker),
      );
    }
    if (rootCli && launchMarker) return { verdict: "match", forked };
  }
  return { verdict: rootCli && firstTurnContext ? "other" : "undecided", forked };
}

export function codexTranscriptMatchesLaunch(file: string, meta: AgentMetadata): boolean {
  return codexLaunchVerdict(file, meta).verdict === "match";
}

export function codexTranscriptSessionId(file: string): string | null {
  const size = Math.min(safeStatSize(file), AGENT_EVENT_TAIL_BYTES);
  if (size === 0) return null;
  const text = readFileRange(file, 0, size).toString("utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record?.type === "session_meta" && typeof record?.payload?.id === "string" && record.payload.id) {
        return record.payload.id;
      }
    } catch {
      // startup中の未完結行は後のpollで読み直す。
    }
  }
  return null;
}

/** rolloutのfile名にある会話ID（UUIDv7）と、そこに入っている作成時刻（ms）。v7でなければnull。 */
function codexRolloutCreation(file: string): { id: string; ms: number } | null {
  const id = /-([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.jsonl$/.exec(path.basename(file))?.[1];
  return id ? { id, ms: Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16) } : null;
}

// 起動ごとの、rolloutの判定の控え（file → この起動の会話か）。頭の読み直しを避ける。決められなかったfileは入れない。
const CODEX_LAUNCH_VERDICT_MEMO_MAX = 64;
const codexLaunchVerdictMemo = new Map<string, Map<string, boolean>>();

function codexLaunchVerdictMemoFor(launchId: string): Map<string, boolean> {
  let memo = codexLaunchVerdictMemo.get(launchId);
  if (!memo) {
    if (codexLaunchVerdictMemo.size >= CODEX_LAUNCH_VERDICT_MEMO_MAX) {
      codexLaunchVerdictMemo.delete(codexLaunchVerdictMemo.keys().next().value as string);
    }
    memo = new Map();
    codexLaunchVerdictMemo.set(launchId, memo);
  }
  return memo;
}

/** 結び付けた会話（vendor_session_id）のroot rollout。会話の切り替えは追わない。完了の読み位置（cursor）はこのfileの位置。 */
export function codexBoundTranscript(meta: AgentMetadata): string | null {
  if (meta.kind !== "codex" || !meta.codex_home || !meta.vendor_session_id) return null;
  return findLatestCodexTranscript(meta.codex_home, meta.vendor_session_id);
}

/**
 * 結び付けた会話より後に書かれた、この起動の別の会話のroot rollout。無ければnull（ADR 0105）。
 * Codexは、入力欄の /new・/clear で、processを生かしたまま新しい会話（別のrollout）へ移る。古いrolloutには何も書かない。
 * 新しい会話の候補は、次を全部満たすrolloutだけ。
 * - 会話IDがUUIDv7で、その作成時刻がこの席の起動より後。
 * - 結び付けた会話のrolloutより後に書かれている（mtime）。
 * - Codex CLIのroot会話で、派生（forked_from_id）でなく、developerの文にこの起動の印がある。
 *   印は起動時に渡したdeveloper_instructionsから来るので、派生でない会話が持つなら、この席のprocessが始めた会話。
 *   派生は元の会話の文を写すので、別の端末で派生させた会話を拾わないよう、追わない。
 * 候補が複数なら、最後に書かれた物。
 */
function codexSwitchedTranscript(meta: AgentMetadata, bound: string): string | null {
  if (!meta.codex_home || meta.hook_route !== "shared_codex_home") return null;
  const launchedAt = Date.parse(meta.created_at);
  if (!Number.isFinite(launchedAt)) return null;
  let boundMtime: number;
  try { boundMtime = fs.statSync(bound).mtimeMs; } catch { return null; }
  const memo = codexLaunchVerdictMemoFor(meta.launch_id);
  let latest: string | null = null;
  let latestMtime = boundMtime;
  for (const file of listCodexTranscripts(meta.codex_home)) {
    if (file === bound || memo.get(file) === false) continue;
    const creation = codexRolloutCreation(file);
    if (!creation || creation.ms + 5_000 < launchedAt) continue;
    let mtime: number;
    try { mtime = fs.statSync(file).mtimeMs; } catch { continue; }
    if (mtime <= latestMtime) continue;
    let own = memo.get(file);
    if (own === undefined) {
      const { verdict, forked } = codexLaunchVerdict(file, meta);
      if (verdict === "undecided") continue;
      own = verdict === "match" && !forked;
      memo.set(file, own);
    }
    if (!own) continue;
    latest = file;
    latestMtime = mtime;
  }
  return latest;
}

/** この起動の、今の会話のroot rollout。結び付けた会話から、同じprocessの新しい会話へ移っていれば、新しい方。 */
export function codexRootTranscript(meta: AgentMetadata): string | null {
  if (meta.kind !== "codex" || !meta.codex_home) return null;
  if (meta.vendor_session_id) {
    const bound = findLatestCodexTranscript(meta.codex_home, meta.vendor_session_id);
    return bound ? codexSwitchedTranscript(meta, bound) ?? bound : null;
  }
  if (meta.hook_route === "shared_codex_home") {
    const matches = listCodexTranscripts(meta.codex_home).filter((file) => codexTranscriptMatchesLaunch(file, meta));
    if (matches.length > 1) {
      throw new AitermError("共有CODEX_HOMEに同じlaunch markerのroot rolloutが複数あります。sessionを閉じて起動し直してください。", 2);
    }
    return matches[0] ?? null;
  }
  return listCodexTranscripts(meta.codex_home)[0] ?? null;
}

/** rolloutの会話ID。結び付けた会話のrolloutならそのID、会話が切り替わった後のrolloutなら、その頭に書かれたID。 */
function codexRolloutSessionId(meta: AgentMetadata, transcript: string): string | null {
  if (meta.vendor_session_id && path.basename(transcript).includes(meta.vendor_session_id)) return meta.vendor_session_id;
  return codexTranscriptSessionId(transcript) ?? codexRolloutCreation(transcript)?.id ?? meta.vendor_session_id;
}

/**
 * 今の会話のroot rolloutを返し、席の登録の会話ID（vendor_session_id）をその会話へ合わせる。
 * 会話が切り替わっていた時は、ここで結び付け直す。呼ぶのは席の持ち主（送信の道）だけ。完了待ちは書かない。
 */
export function bindCodexTranscriptSession(meta: AgentMetadata): string | null {
  const transcript = codexRootTranscript(meta);
  if (!transcript) return null;
  const harnessSessionId = meta.vendor_session_id ? codexRolloutSessionId(meta, transcript) : codexTranscriptSessionId(transcript);
  if (harnessSessionId && meta.vendor_session_id !== harnessSessionId) {
    meta.vendor_session_id = harnessSessionId;
    writeAgentMetadata(meta);
  }
  return transcript;
}

export function codexCompletionEvent(
  meta: AgentMetadata,
  harnessSessionId: string | null,
  record: any,
): AgentDoneEvent | null {
  if (
    record?.type !== "event_msg" ||
    record?.payload?.type !== "task_complete" ||
    typeof record?.payload?.turn_id !== "string" ||
    !record.payload.turn_id
  ) return null;
  return {
    type: "agent_done",
    vendor: "codex",
    aiterm_session: meta.aiterm_session,
    launch_id: meta.launch_id,
    vendor_session_id: harnessSessionId,
    turn_id: record.payload.turn_id,
    operation_id: null,
    reason: "Codex transcript task_complete",
    done_status: "turn_done",
    stop_hook_active: false,
    at: typeof record.timestamp === "string" ? record.timestamp : new Date().toISOString(),
  };
}

// Codexはturnがエラーで終わると、task_completeへ本文と種類を書く（macbookの実記録 2026-08-07、codex 0.158にも同じ欄）。
//   {"type":"task_complete","last_agent_message":null,
//    "error":{"message":"You've hit your usage limit. Visit … or try again at Aug 8th, 2026 12:35 PM.","codex_error_info":"usage_limit_exceeded"}}
// 種類は値の無いものが文字列、値を持つものが{"種類":{…}}になる。
export function codexTurnError(record: any): { message: string; info: string | null } | null {
  if (record?.type !== "event_msg" || record?.payload?.type !== "task_complete") return null;
  const error = record.payload.error;
  if (error === null || typeof error !== "object") return null;
  const raw = error.codex_error_info;
  const info = typeof raw === "string" ? raw
    : raw !== null && typeof raw === "object" && !Array.isArray(raw) ? Object.keys(raw)[0] ?? null : null;
  const message = typeof error.message === "string" ? error.message.trim() : "";
  if (!message && !info) return null;
  return { message: message || info!, info };
}

// 呼んだ側の画面にそのまま出る1行の文。Codexの文は、応答の本文・URLを含む事がある
// （実物 2026-10-07、codex 0.160.1: "unexpected status 401 Unauthorized: <応答の文>, url: http://…/v1/responses"）。
// 「unexpected status」はHTTPの状態までで切り、ほかの文はURLを伏せる。改行は畳み、長さを切る。
const CODEX_ERROR_LINE_MAX = 200;
export function codexTurnErrorLine(error: { message: string; info: string | null }): string {
  const flat = error.message.replace(/\s+/g, " ").trim();
  const status = /^unexpected status (\d{3}(?: [A-Za-z][A-Za-z' -]*)?)/.exec(flat);
  const text = status ? `unexpected status ${status[1].trim()}` : flat.replace(/https?:\/\/[^\s)\]>"']+/gi, "…");
  return text.length > CODEX_ERROR_LINE_MAX ? `${text.slice(0, CODEX_ERROR_LINE_MAX - 1)}…` : text;
}

// 利用上限はtask_completeのcodex_error_infoで見分ける。token_countのused_percentは100%のまま
// 返事が続くことがある（macbookの実記録で7千件以上）ので上限の印にしない。
// rate_limit_exceededは短い間の混雑で、Codexが自分で再試行するので上限に数えない。
export function codexUsageLimit(record: any): string | null {
  const error = codexTurnError(record);
  return error?.info === "usage_limit_exceeded" ? error.message : null;
}

// 完了待ちが、会話の切り替えを確かめる間隔。送った文はすぐ記録へ書かれるので、普通のturnはここへ来ない。
const CODEX_SWITCH_CHECK_MS = 3_000;

type CodexTurnBoundary = { type: "task_started" | "task_complete" | "turn_aborted"; turn_id: unknown; reason: unknown };

/**
 * この起動のroot rolloutの、末尾から見て最初のturnの境界。
 * Codexはturnの開始でtask_started、終わりでtask_complete、止めた時はturn_aborted（reasonはinterrupted）を書く（0.160.1の実記録）。
 * rolloutが無い、この起動に結び付かない、書いている途中、境界が読む範囲に無い時はnull。
 */
function codexLatestTurnBoundary(meta: AgentMetadata): CodexTurnBoundary | null {
  let transcript: string | null;
  try { transcript = codexRootTranscript(meta); } catch { return null; }
  if (!transcript) return null;
  const lines = readTailLinesNewestFirst(transcript, AGENT_TURN_BOUNDARY_TAIL_BYTES);
  if (!lines) return null;
  for (const line of lines) {
    if (!line.includes("task_started") && !line.includes("task_complete") && !line.includes("turn_aborted")) continue;
    let record: any;
    try { record = JSON.parse(line); } catch { return null; }
    if (record?.type !== "event_msg") continue;
    const type = record?.payload?.type;
    if (type === "task_started" || type === "task_complete" || type === "turn_aborted")
      return { type, turn_id: record.payload.turn_id, reason: record.payload.reason };
  }
  return null;
}

/**
 * この起動のroot rolloutで、最後のturnが終わっていて、次のturnが始まっていないか。
 * 末尾から見て最初の境界が、task_completeか、止めた時のturn_abortedの時だけtrue。
 * rolloutが無い、この起動に結び付かない、書いている途中、境界が読む範囲に無い時はfalse（分からない時は「終わった」と数えない）。
 */
export function codexTurnSettled(meta: AgentMetadata): boolean {
  const boundary = codexLatestTurnBoundary(meta);
  if (boundary?.type === "task_complete") return typeof boundary.turn_id === "string" && boundary.turn_id !== "";
  // 見たのはEscで止めた時の形だけ。他の理由（別のturnへの置き換え等）は、次のturnが続くかも知れないので数えない。
  return boundary?.type === "turn_aborted" && boundary.reason === "interrupted";
}

/**
 * この起動のroot rolloutの上で動いているturnのID。末尾から見て最初の境界がtask_startedの時だけ返す。
 * rolloutが無い、この起動に結び付かない、書いている途中、境界が読む範囲に無い時はnull（分からない時は「動いている」と数えない）。
 * Codexは、processが生きている間、turnの終わりを必ず書く。書かずに終わるのは落ちた時なので、呼ぶ側はprocessの生死も見る。
 */
export function codexRunningTurn(meta: AgentMetadata): string | null {
  const boundary = codexLatestTurnBoundary(meta);
  return boundary?.type === "task_started" && typeof boundary.turn_id === "string" && boundary.turn_id !== "" ? boundary.turn_id : null;
}

export function latestCodexCompletion(
  meta: AgentMetadata,
  readTranscriptLines: (file: string) => string[],
): AgentDoneEvent | null {
  const transcript = codexRootTranscript(meta);
  if (!transcript) return null;
  const harnessSessionId = codexRolloutSessionId(meta, transcript);
  let latest: AgentDoneEvent | null = null;
  for (const line of readTranscriptLines(transcript)) {
    if (!line.trim()) continue;
    try {
      latest = codexCompletionEvent(meta, harnessSessionId, JSON.parse(line)) ?? latest;
    } catch {
      // Codexが末尾を書込み中なら、その行は次の観測で完結してから読む。
    }
  }
  return latest;
}

export async function observeCodexDone(
  meta: AgentMetadata,
  timeout: number,
  requestedCursor: number | null | undefined,
  signal?: AbortSignal,
): Promise<AgentWaitObservation> {
  const metadataFile = agentMetadataPath(meta.aiterm_session, meta.launch_id);
  // 読み位置（cursor）は、送った時に結び付いていた会話のrolloutの位置。結び付けが済んだ席は、そのrolloutから読み始める。
  const anchored = (): string | null => meta.vendor_session_id ? codexBoundTranscript(meta) : codexRootTranscript(meta);
  let transcript = anchored();
  let startOffset = requestedCursor ?? (transcript ? safeStatSize(transcript) : 0);
  let cursor = startOffset;
  let carry = "";
  let malformedEvents = 0;
  let discardLeadingFragment = false;
  let initializedBoundary = false;
  // 待ち始めてからrolloutが1行も増えない時、会話が切り替わっていないかを見る時刻（ADR 0105）。
  let switchCheckAt = performance.now() + CODEX_SWITCH_CHECK_MS;
  // 切り替わった後の会話では、前の会話の最後の書き込みより後の完了だけを数える。
  let completedAfter: number | null = null;
  const deadline = performance.now() + timeout * 1000;
  const observation = (
    outcome: AgentWaitObservation["outcome"],
    ev: AgentDoneEvent | null = null,
    rateLimit: string | null = null,
    failed: { message: string; info: string | null } | null = null,
  ): AgentWaitObservation => ({
    schema: "aiterm.agent-wait-result.v1",
    session_id: meta.aiterm_session,
    launch_id: meta.launch_id,
    vendor: "codex",
    harness: agentHarness("codex"),
    outcome,
    operation_id: null,
    vendor_session_id: ev?.vendor_session_id ?? meta.vendor_session_id ?? null,
    turn_id: ev?.turn_id ?? null,
    malformed_events: malformedEvents,
    at: ev?.at ?? null,
    rate_limit: rateLimit,
    error: failed ? codexTurnErrorLine(failed) : null,
    error_kind: failed?.info ?? null,
  });

  for (;;) {
    signal?.throwIfAborted();
    if (!fs.existsSync(metadataFile)) return observation("closed");
    transcript ??= anchored();
    if (transcript && meta.vendor_session_id && cursor === startOffset && performance.now() >= switchCheckAt) {
      switchCheckAt = performance.now() + CODEX_SWITCH_CHECK_MS;
      let current: string | null = null;
      try { current = codexRootTranscript(meta); } catch { /* 読めない時は、今のrolloutを見続ける */ }
      if (current && current !== transcript && safeStatSize(transcript) === cursor) {
        // 送った後に、同じprocessの新しい会話へ移っていた。送る時に無かった会話なので、前の会話の最後の書き込みより後の記録が今回の分。
        // 読み位置を指定せずに待ち始めた時は、今までどおり、今より後の完了を待つ。
        const size = safeStatSize(current);
        if (requestedCursor == null) {
          cursor = size;
        } else {
          try { completedAfter = fs.statSync(transcript).mtimeMs; } catch { completedAfter = null; }
          cursor = Math.max(0, size - CODEX_TRANSCRIPT_INCREMENT_MAX_BYTES);
        }
        transcript = current;
        startOffset = cursor;
        carry = "";
        initializedBoundary = false;
        discardLeadingFragment = false;
      }
    }
    if (transcript) {
      if (!initializedBoundary) {
        if (cursor > 0) {
          const previous = readFileRange(transcript, cursor - 1, cursor).toString("utf8");
          discardLeadingFragment = previous !== "\n";
        }
        initializedBoundary = true;
      }
      const size = safeStatSize(transcript);
      if (size < cursor) {
        throw new AitermError("Codex transcript が完了待機中に短くなりました。該当セッションを閉じて起動し直してください。", 2);
      }
      if (size - startOffset > CODEX_TRANSCRIPT_INCREMENT_MAX_BYTES) {
        throw new AitermError("Codex transcript のturn増分が大きすぎます。該当セッションを閉じて起動し直してください。", 2);
      }
      if (size > cursor) {
        carry += readFileRange(transcript, cursor, size).toString("utf8");
        cursor = size;
        const parts = carry.split("\n");
        carry = parts.pop() ?? "";
        if (discardLeadingFragment && parts.length > 0) {
          parts.shift();
          discardLeadingFragment = false;
        }
        const harnessSessionId = meta.vendor_session_id ? codexRolloutSessionId(meta, transcript) : codexTranscriptSessionId(transcript);
        for (const line of parts) {
          if (!line.trim()) continue;
          if (Buffer.byteLength(line, "utf8") > AGENT_EVENT_MAX_BYTES) {
            malformedEvents++;
            continue;
          }
          try {
            const record = JSON.parse(line);
            const done = codexCompletionEvent(meta, harnessSessionId, record);
            if (done && completedAfter !== null) {
              const at = Date.parse(record.timestamp);
              if (Number.isFinite(at) && at <= completedAfter) continue;
            }
            if (done) {
              // 上限の知らせはこのturnの終わりにだけ書かれる。画面やpane logの文字は、上限が明けた後も
              // 残り、道具の出力や依頼文にも現れるので見ない（2026-09-28）。
              const limited = codexUsageLimit(record);
              if (limited) return observation("rate_limited", done, limited);
              // サービスの誤りや通信の失敗で終わったturnも、Codexはtask_completeを書く（errorつき、回答は無い）。
              // 完了として返すと、失敗が空の回答に見える。Claude CodeのAPIエラーと同じく、typedな終了として返す（ADR 0103）。
              const failed = codexTurnError(record);
              return failed ? observation("error", done, null, failed) : observation("done", done);
            }
          } catch {
            malformedEvents++;
          }
        }
      }
    }
    if (performance.now() >= deadline) return observation(timeout === 0 ? "running" : "timeout");
    await sleep(AGENT_DONE_POLL_MS);
  }
}

export function buildCodexAgentCmd(
  bin: string,
  model: string | null,
  effort: string | null,
  prompt: string | null,
  meta: AgentMetadata | null,
): string {
  const parts: string[] = [shq(bin)];
  // `codex --help` で確認した実在フラグ。read-only 宣言だけはCLI sandboxへ落とし、
  // launcher自身が実効能力壁を作る。パス説明はCodex CLIに同等のallowlist引数がないため宣言のまま残す。
  if (meta?.kind === "codex" && meta.write_scope === "read-only") parts.push("--sandbox", "read-only");
  if (meta?.kind === "codex") parts.push("-c", "check_for_update_on_startup=false");
  // model/effort は共有configを書き換えず、CLI引数で明示して起動単位に優先する。
  if (model) parts.push("-m", shq(model));
  if (effort) parts.push("-c", `model_reasoning_effort=${shq(effort)}`);
  if (meta?.kind === "codex" && meta.hook_route === "shared_codex_home") {
    parts.push("-c", `developer_instructions=${shq(subagentInstruction(meta))}`);
  }
  if (prompt) parts.push(shq(prompt)); // 初手プロンプト（任意）
  return parts.join(" ");
}

// 起動応答にモデル/effort の実効値と出所を明示する。codex は端末 config のピン（model /
// model_reasoning_effort）が対話子へ波及する構造のため、引数・端末config継承・CLI既定の
// どれで起動したかを起動時点で可視化し、実効 effort=ultra は proactive 自動委譲 ON を警告する。
export function codexLaunchNote(
  model: string | null,
  effort: string | null,
  meta: AgentMetadata | null,
): string {
  const writeScopeNote = writeScopeLaunchNote("codex", meta?.write_scope);
  const configPath =
    meta?.kind === "codex" && meta.codex_home
      ? path.join(meta.codex_home, "config.toml")
      : path.join(realCodexHome(), "config.toml");
  const pins = readCodexConfigPins(configPath);
  const describePin = (arg: string | null, pin: CodexConfigPin): string =>
    arg
      ? `${arg}（引数）`
      : pin.present
        ? pin.value
          ? `${pin.value}（端末config継承）`
          : "端末config継承（値未解析）"
        : "CLI既定";
  const effectiveEffort = effort ?? (pins.effort.present ? pins.effort.value : null);
  const launch =
    `起動設定: model=${describePin(model, pins.model)} effort=${describePin(effort, pins.effort)}。` +
    (effectiveEffort === "ultra"
      ? "⚠ effort=ultra は max 推論＋proactive 自動委譲 ON（子エージェント自動生成・使用量急増に注意）。"
      : "");
  const summary = meta?.kind === "codex" && meta.codex_home ? codexConfigSummary(configPath) : "";
  return (summary ? `${launch}\n${summary}\n` : launch) + writeScopeNote;
}

export function codexTuiReady(screen: string): boolean {
  if (codexStartupFailure(screen)) return false;
  // 起動直後は製品header、長寿命sessionでは常駐footerがCodex TUIの識別子になる。
  // capture-paneは直近45行だけなので、会話が進むとheaderは正常に画面外へ流れる。
  const codexFrontend = screen.includes("OpenAI Codex")
    || /(^|\n)\s*\S+\s+(?:default|low|medium|high|xhigh|max|ultra)(?:\s+fast)?\s+·\s+\S.*$/m.test(screen);
  return codexFrontend && /(^|\n)[ \t]*[›>](?![ \t]*\d+\.)/.test(screen);
}

// 0.155までは文章のfooter、0.157からは「enter select · esc back」のようなkey hint行になった。
const CODEX_MODAL_FOOTER = /Press enter to confirm or esc to (?:cancel|go back)|enter to submit\s*\|\s*esc to cancel|(?<=^|\n)[ \t]*(?:[^\n]*· )?enter [a-z]+ · (?:[^\n]* · )?esc [a-z]+[ \t]*(?=\n|$)/gi;
const CODEX_DIALOG_HEADING = /Would you like to run the following command\?|Allow the [^\n]+ MCP server to run tool|Hooks need review|Do you trust the contents of this directory|Trust this folder\?|Update available!|Approaching rate limits/g;
const CODEX_MODAL_MARKER = new RegExp(`${CODEX_MODAL_FOOTER.source}|${CODEX_DIALOG_HEADING.source}`, "gi");

function currentCodexDialog(screen: string): string {
  const footers = [...screen.matchAll(CODEX_MODAL_FOOTER)];
  // 過去の完了footerより前の質問・選択番号を、現在のdialogへ持ち込まない。
  const previousFooter = footers.at(-2);
  const current = previousFooter ? screen.slice(previousFooter.index! + previousFooter[0].length) : screen;
  const heading = [...current.matchAll(CODEX_DIALOG_HEADING)].at(-1);
  return heading ? current.slice(heading.index) : current;
}

// Codexは道具を初めて使う時に補助process（code-mode-host）を立て、sessionの終わりまで残す。
// harnessの一部であって利用者の作業ではない。この下で動くprocessは作業として数える。
export function codexHelperProcess(command: string): boolean {
  const first = /^(?:"([^"]+)"|(\S+))/.exec(command);
  return path.posix.basename((first?.[1] ?? first?.[2] ?? "").replace(/\\/g, "/")).replace(/\.exe$/i, "") === "codex-code-mode-host";
}

// Codexは動いている間、入力欄の上へ「◦ Working (5s • esc to interrupt)」の行を出す。見出しの文は作業の内容で変わるが、
// 括弧の中（経過時間、「•」、「esc to interrupt」）の形は変わらない。動作中の印として数えるのは、この形だけにする。
// 会話欄（回答・依頼文）に「esc to interrupt」の語があるだけの席を動作中と読むと、止まっている席への送信が
// 差し込みになり、その回の完了が呼び出し側へ届かない（Codex 0.160.1の実物、2026-10-06）。
// Codexは動作中の行と回答の行が同じ印（•）で始まるので、行頭の印では見分けられない。
const CODEX_INTERRUPT_HINT_RE = /\((?:\d+\s*[hms]\s*)+•\s*esc to interrupt\)/i;
export function codexTuiBusy(screen: string): boolean {
  return CODEX_INTERRUPT_HINT_RE.test(screen);
}

export function codexPaneObservation(screen: string): HarnessPaneObservation {
  const failure = codexStartupFailure(screen);
  if (failure) return { state: "blocked", reason: failure };
  // psmuxはmodalを画面上部へ描き、下の空行もcaptureへ含める。空行を落としてから末尾を取る。
  const tail = screen.replace(/\s+$/, "").split("\n").slice(-24).join("\n");
  // 現在のmodal footerがある時だけ、折返しで上へ出た質問を画面全体から探す。
  const lastComposer = [...tail.matchAll(/(?:^|\n)[ \t]*[›>](?![ \t]*\d+\.)/g)].at(-1)?.index ?? -1;
  const lastDialog = [...tail.matchAll(CODEX_MODAL_MARKER)].at(-1)?.index ?? -1;
  const modal = lastDialog > lastComposer;
  if (!modal) {
    if (codexTuiBusy(tail)) return { state: "busy", reason: "turn_running" };
    if (codexTuiReady(tail)) return { state: "idle", reason: "composer_ready" };
  }
  const current = modal ? currentCodexDialog(screen) : tail;
  if (/Would you like to run the following command\?/.test(current))
    return { state: "blocked", reason: "command_approval" };
  if (/Allow the .+ MCP server to run tool/.test(current))
    return { state: "blocked", reason: "mcp_approval" };
  if (/Hooks need review/.test(current)) return { state: "blocked", reason: "hooks_review" };
  if (codexRateLimitModelSwitchDialog(current)) return { state: "blocked", reason: "rate_limit_model_switch" };
  if (codexLaunchBlockingDialog(current)) return { state: "blocked", reason: "startup_dialog" };
  if (modal) return { state: "blocked", reason: "unknown_dialog" };
  return { state: "unknown", reason: "unrecognized_screen" };
}

/**
 * Codexの利用上限接近modal（0.155.1で確認、0.157で切替先modelとfooterが変わった）。
 * agent_approvalの対象ではないため、選択肢は公開しない。
 * 1はmodel切替、3は今後の表示抑止なので、Aitermが選んでよいのは一時keepの2だけである。
 */
export function codexRateLimitModelSwitchDialog(screen: string): { keepCurrentIndex: 2; selectedIndex: 1 | 2 | 3 | null } | null {
  const current = currentCodexDialog(screen);
  const footer = [...current.matchAll(CODEX_MODAL_FOOTER)].at(-1)?.index ?? -1;
  const composer = [...current.matchAll(/(?:^|\n)[ \t]*[›>](?![ \t]*\d+\.)/g)].at(-1)?.index ?? -1;
  // footerが無いか、現在のcomposerがmodal footerより後なら、scrollbackの古いmodalである。
  if (footer < 0 || composer > footer) return null;
  // 切替先modelは版とアカウントで変わる（gpt-5.6-luna、gpt-6-luna）。質問と選択肢1が同じmodelを指すことだけ確かめる。
  const target = current.match(/(?:^|\n)\s*Switch to (\S+) for lower credit usage\?\s*(?:\n|$)/)?.[1];
  if (!target) return null;
  const switchLabel = `Switch to ${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
  if (!/(?:^|\n)\s*Approaching rate limits\s*(?:\n|$)/.test(current)
    || !new RegExp(`(?:^|\\n)[ \\t]*(?:›[ \\t]*)?1\\. ${switchLabel}(?:[ \\t]{2,}[^\\n]*)?[ \\t]*(?:\\n|$)`).test(current)
    || !/(?:^|\n)[ \t]*(?:›[ \t]*)?2\. Keep current model[ \t]*(?:\n|$)/.test(current)
    || !/(?:^|\n)[ \t]*(?:›[ \t]*)?3\. Keep current model \(never show again\)(?:[ \t]{2,}[^\n]*)?[ \t]*(?:\n|$)/.test(current)) return null;
  const selected = current.match(new RegExp(`(?:^|\\n)[ \\t]*›[ \\t]*([123])\\. (?:${switchLabel}|Keep current model(?: \\(never show again\\))?)(?:[ \\t]{2,}[^\\n]*)?[ \\t]*(?:\\n|$)`))?.[1];
  return { keepCurrentIndex: 2, selectedIndex: selected ? Number(selected) as 1 | 2 | 3 : null };
}

export function codexStartupFailure(screen: string): string | null {
  return /(?:^|\n)[ \t]*[›>]?[ \t]*Error loading config\.toml:/m.test(screen)
    ? "configuration_error" : null;
}

export interface CodexApprovalDialog {
  kind: "command_approval" | "mcp_approval";
  prompt: string;
  canonical: string;
  selected_index: number | null;
  choices: { decision: "approve_once" | "deny"; index: number; label: string }[];
}

export function codexApprovalDialog(screen: string): CodexApprovalDialog | null {
  const observation = codexPaneObservation(screen);
  if (observation.state !== "blocked" || !["command_approval", "mcp_approval"].includes(observation.reason)) return null;
  screen = currentCodexDialog(screen);
  const question = observation.reason === "command_approval"
    ? screen.lastIndexOf("Would you like to run the following command?")
    : [...screen.matchAll(/Allow the [^\n]+ MCP server to run tool[^\n]*\?/g)].at(-1)?.index ?? -1;
  const lines = screen.slice(question).split("\n");
  const choices: CodexApprovalDialog["choices"] = [];
  let selectedIndex: number | null = null;
  let firstChoice = lines.length;
  for (let index = 0; index < lines.length; index++) {
    const match = /^[ \t]*(›[ \t]*)?(\d+)\.[ \t]+(.+)$/.exec(lines[index]);
    if (!match) continue;
    firstChoice = Math.min(firstChoice, index);
    if (match[1]) selectedIndex = Number(match[2]);
    const label = match[3].trim().split(/\s{2,}/)[0];
    const decision = /^(?:Yes, proceed(?: \(y\))?|Allow)$/i.test(label) ? "approve_once"
      : /^(?:No, and tell Codex what to do differently(?: \(esc\))?|Cancel)$/i.test(label) ? "deny" : null;
    if (decision) choices.push({ decision, index: Number(match[2]), label });
  }
  if (new Set(choices.map(choice => choice.decision)).size !== choices.length)
    throw new AitermError("Codex承認の単発選択肢が重複しています", 2);
  return {
    kind: observation.reason as CodexApprovalDialog["kind"],
    prompt: lines.slice(0, firstChoice).join("\n").trim(),
    canonical: lines.map(line => line.replace(/^[ \t]*›[ \t]*/, "").trimEnd()).join("\n").trim(),
    selected_index: selectedIndex, choices,
  };
}

export function codexStartupAction(screen: string, trustProject: boolean): import("../agent-shared.js").StartupAction | null {
  if (codexPaneObservation(screen).state !== "blocked") return null;
  screen = currentCodexDialog(screen);
  let kind: string;
  let wanted: RegExp;
  if (screen.includes("Update available!") && screen.includes("Update now")) {
    kind = "update_deferred"; wanted = /^Not now\b/i;
  } else if (trustProject && screen.includes("Do you trust the contents of this directory")) {
    kind = "workspace_trusted"; wanted = /^Yes, continue\b/i;
  } else if (trustProject && screen.includes("Trust this folder?")) {
    // Codex 0.157 から、信頼の確認は「Folder access」画面になった。
    kind = "workspace_trusted"; wanted = /^Trust and continue\b/i;
  } else if (trustProject && screen.includes("Hooks need review")) {
    kind = "project_hooks_trusted"; wanted = /^Trust all\b/i;
  } else return null;
  const choices = [...screen.matchAll(/^[ \t]*(›[ \t]*)?(\d+)\.[ \t]+(.+)$/gm)];
  const selected = choices.filter(match => match[1]).at(-1);
  const target = choices.filter(match => wanted.test(match[3])).at(-1);
  if (!selected || !target) return null;
  const distance = Number(target[2]) - Number(selected[2]);
  return { kind, keys: [...Array(Math.abs(distance)).fill(distance > 0 ? "Down" : "Up"), "Enter"] };
}

// submit座礁観測のcomposer領域マーカー（ready判定と同じ記号を行頭基準で探す）。
export const CODEX_COMPOSER_MARKER_RE = /^\s*[›>]/;

// Codexの起動前modalダイアログ検知。表示中はheader/footerが描かれず codexTuiReady が
// 恒久falseになるため、ready gate失敗の原因究明用に画面から種別を特定する
// （実被弾 2026-08-25: update確認で初手prompt未送信のまま30秒timeout→40分停滞）。
// 文字列は実機captureの逐語。既知2種に一致しない「Press enter to continue」も
// 同型のmodalとして拾う（種別不明のまま握りつぶさない）。
export function codexLaunchBlockingDialog(screen: string): string | null {
  if (screen.includes("Update available!")
    && (/(^|\n)\s*›?\s*1\.\s+Update now\b/m.test(screen) || screen.includes("Press enter to continue")))
    return "update確認ダイアログ";
  if (screen.includes("Do you trust the contents of this directory")) return "directory trust確認ダイアログ";
  if (screen.includes("Trust this folder?")) return "folder trust確認ダイアログ";
  // ログインが無い・期限が切れた時の最初の画面（Codex 0.160.0）。
  if (screen.includes("Sign in with ChatGPT") && screen.includes("Sign in with Device Code")) return "サインイン画面（ログインが必要）";
  if (screen.includes("Press enter to continue")) return "起動時ダイアログ（種別未特定）";
  return null;
}

export function codexModelChoice(screen: string, model: string): string | null {
  for (const line of screen.slice(screen.lastIndexOf("Select Model and Effort")).split("\n")) {
    const match = line.match(/^\s*(?:›\s*)?(\d+)\.\s+(\S+)/);
    if (match?.[2] === model) return match[1];
  }
  return null;
}

export function codexEffortChoice(screen: string, effort: string): string | null {
  const labels: Record<string, RegExp> = {
    low: /^Low\b/i,
    medium: /^Medium\b/i,
    high: /^High\b/i,
    xhigh: /^Extra high\b/i,
    max: /^Max\b/i,
    ultra: /^Ultra\b/i,
  };
  const wanted = labels[effort.toLowerCase()];
  if (!wanted) return null;
  for (const line of screen.split("\n")) {
    const match = line.match(/^\s*(?:›\s*)?(\d+)\.\s+(.+?)\s{2,}/);
    if (match && wanted.test(match[2])) return match[1];
  }
  return null;
}

export function codexMoreReasoningChoice(screen: string): string | null {
  for (const line of screen.split("\n")) {
    const match = line.match(/^\s*(?:›\s*)?(\d+)\.\s+More reasoning/);
    if (match) return match[1];
  }
  return null;
}

// 回収対象turnの最終assistantメッセージをroot rollout transcriptから抽出する。
// 回答の場所が記録にあれば、中身が空でも文字列を返す。場所が見つからない時（記録の形が変わった時を含む）はnull。
// Codexは回答を空で終えたturnも、textが空のfinal_answerをturn ID付きで残す（0.160.1の実記録 2026-10-06。
// task_completeのlast_agent_messageはnull）。
export function codexTranscriptText(
  meta: AgentMetadata,
  turnId: string | null,
  readTranscriptLines: (file: string) => string[],
  transcriptUnavailable: () => never,
  exactCompletion = false,
): string | null {
  if (!meta.codex_home || !meta.vendor_session_id) transcriptUnavailable();
  // 完了待ちが切り替わった後の会話で完了を見つけた時も、同じ会話から回答を読む（ADR 0105）。
  const transcript = codexRootTranscript(meta);
  if (!transcript) transcriptUnavailable();
  const lines = readTranscriptLines(transcript);
  if (exactCompletion) {
    // 同じturnの本文だけを使う。完了event内の本文と、turn ID付きoutput_textの両形式を扱う。
    const matching = codexTurnAnswer();
    for (const line of lines) {
      let record: any;
      try { record = JSON.parse(line); } catch { continue; }
      const payload = record?.payload;
      matching.add(record, turnId);
      if (record?.type === "event_msg" && payload?.type === "task_complete" && payload.turn_id === turnId) {
        if (typeof payload.last_agent_message === "string") return payload.last_agent_message;
        const text = matching.text();
        if (text !== null) return text;
        transcriptUnavailable();
      }
    }
    transcriptUnavailable();
  }
  const matching = codexTurnAnswer();
  let finalAnswer: string | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    let record: any;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = record?.payload;
    matching.add(record, turnId);
    if (
      record?.type === "event_msg" &&
      payload?.type === "agent_message" &&
      payload?.phase === "final_answer" &&
      typeof payload?.message === "string"
    ) {
      finalAnswer = payload.message;
    }
  }
  // turnの本文が記録にあれば、空でもそれが回答。agent_message（turn IDの無い旧形式）は別turnの物かもしれないので、
  // turnの本文が見つからず、かつ空でない時だけ使う。
  return matching.text() ?? (finalAnswer?.trim() ? finalAnswer : null);
}

// turnのassistant本文を集める。Codexは作業途中の報告をphase=commentary、回答をphase=final_answerで残すので、
// final_answerがあるturnは途中の報告を回答に含めない。phaseの無い旧形式はturnの本文を全部つなぐ。
function codexTurnAnswer() {
  const all: string[] = [];
  const finals: string[] = [];
  return {
    add(record: any, turnId: string | null): void {
      const payload = record?.payload;
      if (record?.type !== "response_item" || payload?.type !== "message" || payload?.role !== "assistant"
        || payload?.internal_chat_message_metadata_passthrough?.turn_id !== turnId || !Array.isArray(payload?.content)) return;
      for (const item of payload.content) {
        if (item?.type !== "output_text" || typeof item.text !== "string") continue;
        all.push(item.text);
        if (payload.phase === "final_answer") finals.push(item.text);
      }
    },
    // turnのassistant本文が1つも無ければnull（回答の場所が見つからない）。
    text(): string | null {
      if (all.length === 0) return null;
      return (finals.length > 0 ? finals : all).join("\n");
    },
  };
}

export function createCodexAgentMetadata(
  name: string,
  cwd: string | null,
  initialPrompt: InitialPromptState,
  overrides: { model?: string | null; effort?: string | null } = {},
  writeScope?: string,
  lineageContext?: AgentLineageContext,
): AgentMetadata {
  const launchId = randomBytes(16).toString("hex");
  const eventFile = agentEventPath(name, launchId);
  createEmpty0600(eventFile);
  const codexHome = realCodexHome();
  const meta: AgentMetadata = {
    kind: "codex",
    aiterm_session: name,
    launch_id: launchId,
    event_file: eventFile,
    created_at: new Date().toISOString(),
    cwd,
    ...(writeScope === undefined ? {} : { write_scope: writeScope }),
    vendor_session_id: null,
    initial_prompt: initialPrompt,
    hook_route: "shared_codex_home",
    completion_route: "codex_transcript",
    ...(lineageContext ? agentLineageFields(lineageContext) : {}),
    node_platform: process.platform,
    codex_home: codexHome,
  };
  writeAgentMetadata(meta);
  return meta;
}

const CODEX_MODELS_TIMEOUT_MS = 30_000;
const CODEX_MODELS_PAGE_LIMIT = 100;
// model/listを無限に辿らない上限。1ページ100件で十分に余る。
const CODEX_MODELS_MAX_PAGES = 20;

/**
 * Codexのmodel候補。公式App Serverの `model/list` を読む（https://learn.chatgpt.com/docs/app-server#list-models-modellist）。
 * 親配送と同じ接続（aiterm-steer-deliveryのwithCodexReceiver）で、threadもturnも作らない。
 * `codex debug models` も同じ内容を返すが、debug用の命令なので使わない。
 */
export async function codexModelChoices(bin: string, includeHidden: boolean): Promise<AgentModelCatalog> {
  const parent = { thread_id: "00000000-0000-4000-8000-000000000000", codex_home: path.resolve(steer.realCodexHome()) };
  let pages: any[];
  try {
    pages = await steer.withCodexReceiver(AITERM_PROFILE, parent, async (request) => {
      const collected: any[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < CODEX_MODELS_MAX_PAGES; page++) {
        const result = await request("model/list", { cursor, limit: CODEX_MODELS_PAGE_LIMIT, includeHidden });
        collected.push(result);
        if (result?.nextCursor === null || result?.nextCursor === undefined) return collected;
        if (typeof result.nextCursor !== "string" || result.nextCursor === cursor) throw catalogInvalid("Codex", "model/listの次ページが不正です");
        cursor = result.nextCursor;
      }
      throw catalogInvalid("Codex", `model/listが${CODEX_MODELS_MAX_PAGES}ページを超えました`);
    }, { executable: bin, timeout_ms: CODEX_MODELS_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof AitermError) throw error;
    throw catalogUnavailable("Codex", error instanceof Error ? error.message : String(error));
  }
  return codexCatalogFromPages(pages);
}

/** `model/list` の応答（全ページ）からmodel候補を作る。 */
export function codexCatalogFromPages(pages: any[]): AgentModelCatalog {
  let defaultModel: string | null = null;
  const models: AgentModelChoice[] = pages.flatMap((page) => {
    if (!Array.isArray(page?.data)) throw catalogInvalid("Codex", "model/listの応答に data がありません");
    return page.data.map((model: any) => {
      if (typeof model?.id !== "string") throw catalogInvalid("Codex", "idの無いmodelがあります");
      if (!Array.isArray(model.supportedReasoningEfforts)) throw catalogInvalid("Codex", `${model.id} に supportedReasoningEfforts がありません`);
      const efforts = model.supportedReasoningEfforts.map((level: any) => {
        if (typeof level?.reasoningEffort !== "string") throw catalogInvalid("Codex", `${model.id} のreasoning effortを読めません`);
        return level.reasoningEffort;
      });
      if (model.isDefault === true) defaultModel = model.id;
      return {
        id: model.id,
        display_name: typeof model.displayName === "string" ? model.displayName : null,
        efforts,
        default_effort: typeof model.defaultReasoningEffort === "string" ? model.defaultReasoningEffort : null,
        hidden: model.hidden === true,
      };
    });
  });
  return checkedCatalog("Codex", {
    source: "codex app-server model/list",
    harness_version: null,
    default_model: defaultModel,
    adapter_efforts: {},
    models,
  });
}


export function codexAuthPlan(): AgentAuthPlan { return { args: ["login", "--device-auth"], env: [] }; }

const CODEX_AUTH_CHECK_TIMEOUT_MS = 15_000;

/**
 * `codex login status`は`auth.json`があるかだけを見る。ログインの期限が切れた後（refresh tokenの失効）も「Logged in」と答える
 * （2026-10-05、Codex 0.160.0、ログインから30日後）。使えるログインかは、公式App Serverに聞く。
 * `getAuthStatus`（`refreshToken:false`）は、Codex自身が要ると判断した時だけtokenを取り直す。取り直しが恒久的に失敗していると、
 * 続く`account/read`が`account: null`を返す。Aitermは資格情報を読まず、生きているログインへ余計な取り直しもかけない。
 */
export async function codexAuthStatus(bin: string, cwd: string, env = process.env): Promise<AgentAuthStatus> {
  const result = spawnAgentControlCommand(bin, ["login", "status"], cwd,
    { cwd, env, encoding: "utf8", timeout: 5000, maxBuffer: 64 * 1024 });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (!result.error && /Not logged in/i.test(output)) return { status: "unauthenticated", message: null };
  if (result.error || result.status !== 0 || !/Logged in/i.test(output)) return { status: "failed", message: "Codex CLIの公式認証状態を確認できません。" };
  const parent = { thread_id: "00000000-0000-4000-8000-000000000000", codex_home: path.resolve(env.CODEX_HOME || steer.realCodexHome()) };
  let read: any;
  try {
    read = await steer.withCodexReceiver(AITERM_PROFILE, parent, async (request) => {
      await request("getAuthStatus", { includeToken: false, refreshToken: false });
      return await request("account/read", { refreshToken: false });
    }, { executable: bin, timeout_ms: CODEX_AUTH_CHECK_TIMEOUT_MS, env });
  } catch (error) {
    // App Serverがこの問い合わせを知らない旧版は、今までどおり公式statusの答えに従う（期限切れは見抜けない）。
    if (error instanceof steer.CodexDeliveryError && error.delivery_code === "CODEX_RECEIVER_REJECTED") return { status: "authenticated", message: null };
    return { status: "failed", message: "Codexのログインが使えるかを、公式App Serverで確認できません。" };
  }
  if (read?.requiresOpenaiAuth === false || (read?.account !== null && typeof read?.account === "object")) return { status: "authenticated", message: null };
  if (read?.account === null) {
    return { status: "unauthenticated", message: "Codexのログインの期限が切れています。agent_authのstartで入り直してください。" };
  }
  return { status: "failed", message: "Codexの公式App Serverが返した認証状態の形式を認識できません。" };
}

export function codexAuthPane(screen: string): AgentAuthPane {
  return { url: authUrl(screen, ["auth.openai.com", "auth0.openai.com", "login.openai.com"]),
    user_code: authUserCode(screen), input_required: false, message: null };
}
