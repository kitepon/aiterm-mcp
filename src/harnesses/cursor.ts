// Cursor Agent CLI 固有の制御。通常 ~/.cursor を共有し、完了正本は
// launch markerで一意にbindした agent transcript の turn_ended とする。
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { AitermError } from "../errors.js";
import { spawnAgentControlCommand } from "../agent-resolver.js";
import {
  AGENT_DONE_POLL_MS,
  AGENT_EVENT_MAX_BYTES,
  agentEventPath,
  agentHarness,
  agentLineageFields,
  agentMetadataPath,
  createEmpty0600,
  readFileRange,
  safeStatSize,
  shq,
  sleep,
  subagentInstruction,
  writeAgentMetadata,
  writeScopeLaunchNote,
} from "../agent-shared.js";
import type {
  AgentDoneEvent,
  AgentKind,
  AgentLineageContext,
  AgentMetadata,
  AgentWaitObservation,
  InitialPromptState,
} from "../agent-shared.js";

const CURSOR_TRANSCRIPT_MATCH_MAX_BYTES = 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Cursor Agentはextended keyboard protocolを有効にするため、通常のtmux Enterではなく
// CSI-uのEnterを送る。呼び出し側へCursor固有の端末方言を漏らさない。
export const CURSOR_SUBMIT_SEQUENCE = "\x1b[13u";

export function realCursorHome(): string {
  return path.join(process.env.HOME ?? os.homedir(), ".cursor");
}

// Cursor公式CLIの workspace ID と同じ変換（utils/workspace-paths.js）。
export function cursorWorkspaceId(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

export function cursorTranscriptRoot(meta: AgentMetadata): string | null {
  if (meta.kind !== "cursor" || !meta.cursor_home) return null;
  return path.join(meta.cursor_home, "projects", cursorWorkspaceId(meta.cwd ?? process.cwd()), "agent-transcripts");
}

export function cursorTranscriptForSession(meta: AgentMetadata, harnessSessionId: string): string | null {
  const root = cursorTranscriptRoot(meta);
  if (!root || !UUID_RE.test(harnessSessionId)) return null;
  return path.join(root, harnessSessionId, `${harnessSessionId}.jsonl`);
}

export function listCursorTranscripts(meta: AgentMetadata): string[] {
  const root = cursorTranscriptRoot(meta);
  if (!root) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && UUID_RE.test(entry.name))
    .map((entry) => path.join(root, entry.name, `${entry.name}.jsonl`))
    .filter((file) => {
      try { return fs.statSync(file).isFile(); } catch { return false; }
    })
    .sort();
}

export function cursorTranscriptMatchesLaunch(file: string, meta: AgentMetadata): boolean {
  const createdAt = Date.parse(meta.created_at);
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || (Number.isFinite(createdAt) && st.mtimeMs + 5_000 < createdAt)) return false;
  } catch {
    return false;
  }
  const size = Math.min(safeStatSize(file), CURSOR_TRANSCRIPT_MATCH_MAX_BYTES);
  if (size === 0) return false;
  const marker = `AITERM_AGENT_LAUNCH_ID=${meta.launch_id}`;
  for (const line of readFileRange(file, 0, size).toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (
        record?.role === "user" &&
        Array.isArray(record?.message?.content) &&
        record.message.content.some((item: any) => item?.type === "text" && typeof item?.text === "string" && item.text.includes(marker))
      ) return true;
    } catch {
      // Cursorが末尾を書込み中なら次のpollで完結してから読む。
    }
  }
  return false;
}

export function cursorTranscript(meta: AgentMetadata): string | null {
  if (meta.kind !== "cursor") return null;
  if (meta.vendor_session_id) {
    const bound = cursorTranscriptForSession(meta, meta.vendor_session_id);
    return bound && fs.existsSync(bound) ? bound : null;
  }
  const matches = listCursorTranscripts(meta).filter((file) => cursorTranscriptMatchesLaunch(file, meta));
  if (matches.length > 1) {
    throw new AitermError("共有Cursor homeに同じlaunch markerのtranscriptが複数あります。sessionを閉じて起動し直してください。", 2);
  }
  return matches[0] ?? null;
}

export function cursorTranscriptSessionId(file: string): string | null {
  const id = path.basename(path.dirname(file));
  return UUID_RE.test(id) ? id : null;
}

export function bindCursorTranscriptSession(meta: AgentMetadata): string | null {
  const transcript = cursorTranscript(meta);
  if (!transcript) return null;
  const harnessSessionId = cursorTranscriptSessionId(transcript);
  if (harnessSessionId && !meta.vendor_session_id) {
    meta.vendor_session_id = harnessSessionId;
    writeAgentMetadata(meta);
  }
  return transcript;
}

export function cursorCompletionEvent(
  meta: AgentMetadata,
  harnessSessionId: string | null,
  record: any,
  turnId: string,
): AgentDoneEvent | null {
  if (meta.kind !== "cursor" || record?.type !== "turn_ended" || typeof record?.status !== "string") return null;
  return {
    type: "agent_done",
    vendor: "cursor",
    aiterm_session: meta.aiterm_session,
    launch_id: meta.launch_id,
    vendor_session_id: harnessSessionId,
    turn_id: turnId,
    operation_id: null,
    reason: `Cursor transcript turn_ended:${record.status}`,
    done_status: "turn_done",
    stop_hook_active: false,
    at: new Date().toISOString(),
  };
}

type CursorTranscriptState = {
  userTurns: number;
  terminalRecord: any | null;
  malformedEvents: number;
};

function cursorTranscriptState(file: string): CursorTranscriptState {
  let userTurns = 0;
  let terminalRecord: any | null = null;
  let malformedEvents = 0;
  let lastRecordWasTurnEnded = false;
  let body: string;
  try {
    body = fs.readFileSync(file, "utf8");
  } catch {
    return { userTurns, terminalRecord, malformedEvents };
  }
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, "utf8") > AGENT_EVENT_MAX_BYTES) {
      malformedEvents++;
      lastRecordWasTurnEnded = false;
      continue;
    }
    let record: any;
    try { record = JSON.parse(line); } catch {
      malformedEvents++;
      lastRecordWasTurnEnded = false;
      continue;
    }
    if (record?.role === "user") userTurns++;
    lastRecordWasTurnEnded = record?.type === "turn_ended" && typeof record?.status === "string";
    terminalRecord = lastRecordWasTurnEnded ? record : null;
  }
  return { userTurns, terminalRecord: lastRecordWasTurnEnded ? terminalRecord : null, malformedEvents };
}

// Cursorは次turn開始時に直前の末尾 turn_ended 行を置換するため、byte EOFは安定境界にならない。
// transcriptに残り続けるuser record数を、Cursor harnessだけの単調なcompletion cursorとして使う。
export function cursorTurnBoundary(meta: AgentMetadata): number {
  const transcript = cursorTranscript(meta);
  return transcript ? cursorTranscriptState(transcript).userTurns : 0;
}

export function latestCursorCompletion(
  meta: AgentMetadata,
  readTranscriptLines: (file: string) => string[],
): AgentDoneEvent | null {
  const transcript = cursorTranscript(meta);
  if (!transcript) return null;
  const harnessSessionId = meta.vendor_session_id ?? cursorTranscriptSessionId(transcript);
  // callerとの共通signatureを保つ。Cursorのturn境界はbyte列でなくuser turn数を使う。
  void readTranscriptLines;
  const state = cursorTranscriptState(transcript);
  return state.terminalRecord
    ? cursorCompletionEvent(meta, harnessSessionId, state.terminalRecord, `cursor:${state.userTurns}`)
    : null;
}

export async function observeCursorDone(
  meta: AgentMetadata,
  timeout: number,
  requestedCursor: number | null | undefined,
  detectRateLimit: (kind: AgentKind, aitermSession: string) => string | null,
): Promise<AgentWaitObservation> {
  const metadataFile = agentMetadataPath(meta.aiterm_session, meta.launch_id);
  let transcript = cursorTranscript(meta);
  const startBoundary = requestedCursor ?? (transcript ? cursorTranscriptState(transcript).userTurns : 0);
  let malformedEvents = 0;
  const deadline = performance.now() + timeout * 1000;
  const observation = (
    outcome: AgentWaitObservation["outcome"],
    ev: AgentDoneEvent | null = null,
    rateLimit: string | null = null,
  ): AgentWaitObservation => ({
    schema: "aiterm.agent-wait-result.v1",
    session_id: meta.aiterm_session,
    launch_id: meta.launch_id,
    vendor: "cursor",
    harness: agentHarness("cursor"),
    outcome,
    operation_id: null,
    vendor_session_id: ev?.vendor_session_id ?? meta.vendor_session_id ?? null,
    turn_id: ev?.turn_id ?? null,
    malformed_events: malformedEvents,
    at: ev?.at ?? null,
    rate_limit: rateLimit,
    error: null,
  });

  for (;;) {
    if (!fs.existsSync(metadataFile)) return observation("closed");
    transcript ??= cursorTranscript(meta);
    if (transcript) {
      const state = cursorTranscriptState(transcript);
      malformedEvents = state.malformedEvents;
      if (state.userTurns > startBoundary && state.terminalRecord) {
        const harnessSessionId = meta.vendor_session_id ?? cursorTranscriptSessionId(transcript);
        const done = cursorCompletionEvent(meta, harnessSessionId, state.terminalRecord, `cursor:${state.userTurns}`);
        if (done) return observation("done", done);
      }
    }
    const limited = detectRateLimit(meta.kind, meta.aiterm_session);
    if (limited) return observation("rate_limited", null, limited);
    if (performance.now() >= deadline) return observation(timeout === 0 ? "running" : "timeout");
    await sleep(AGENT_DONE_POLL_MS);
  }
}

export function cursorTranscriptText(
  meta: AgentMetadata,
  readTranscriptLines: (file: string) => string[],
  transcriptUnavailable: () => never,
): string {
  const transcript = cursorTranscript(meta);
  if (!transcript) transcriptUnavailable();
  let current: string[] = [];
  let completed: string[] | null = null;
  for (const line of readTranscriptLines(transcript)) {
    if (!line.trim()) continue;
    let record: any;
    try { record = JSON.parse(line); } catch { continue; }
    if (record?.role === "user") current = [];
    if (record?.role === "assistant" && Array.isArray(record?.message?.content)) {
      for (const part of record.message.content) {
        if (part?.type === "text" && typeof part?.text === "string") current.push(part.text);
      }
    }
    if (record?.type === "turn_ended") completed = [...current];
  }
  if (completed === null) transcriptUnavailable();
  return completed.join("\n");
}

export function createCursorAgentMetadata(
  name: string,
  cwd: string | null,
  initialPrompt: InitialPromptState,
  writeScope: string | undefined,
  lineage: AgentLineageContext,
): AgentMetadata {
  const launchId = randomBytes(16).toString("hex");
  const eventFile = agentEventPath(name, launchId);
  createEmpty0600(eventFile);
  const meta: AgentMetadata = {
    kind: "cursor",
    aiterm_session: name,
    launch_id: launchId,
    event_file: eventFile,
    created_at: new Date().toISOString(),
    cwd,
    ...(writeScope === undefined ? {} : { write_scope: writeScope }),
    vendor_session_id: null,
    initial_prompt: initialPrompt,
    hook_route: "shared_cursor_home",
    completion_route: "cursor_transcript",
    ...agentLineageFields(lineage),
    node_platform: process.platform,
    cursor_home: realCursorHome(),
  };
  writeAgentMetadata(meta);
  return meta;
}

export function validateCursorModelEffort(model: string | null, effort: string | null): void {
  if (!effort) return;
  if (!model) throw new AitermError("Cursor CLIで reasoning_effort を指定する時は model も指定してください", 2);
  if (model.includes("[") || model.includes("]")) {
    throw new AitermError("Cursor CLIのmodelへ既にparameter overrideがあります。reasoning_effortとの二重指定はできません", 2);
  }
}

export function cursorModelArgument(model: string | null, effort: string | null): string | null {
  if (!model) return null;
  return effort ? `${model}-${effort}` : model;
}

const CURSOR_AUTH_TIMEOUT_MS = 5_000;
const CURSOR_MODELS_TIMEOUT_MS = 5_000;
const CURSOR_MODELS_MAX_BYTES = 256 * 1024;

export function cursorModelCatalog(bin: string, cwd: string): string[] {
  const result = spawnAgentControlCommand(bin, ["models"], cwd, {
    cwd,
    encoding: "utf8",
    env: process.env,
    timeout: CURSOR_MODELS_TIMEOUT_MS,
    maxBuffer: CURSOR_MODELS_MAX_BYTES,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || `exit=${result.status ?? "unknown"}`;
    throw new AitermError(`Cursor model catalog を取得できません: ${detail}`, 2);
  }
  const text = result.stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  if (!/^Available models\s*$/m.test(text)) {
    throw new AitermError("Cursor model catalog の出力形式が不正です（Available models がありません）", 2);
  }
  const models = text.split(/\r?\n/)
    .map((line) => line.match(/^([^\s]+)\s+-\s+.+$/)?.[1] ?? null)
    .filter((value): value is string => value !== null);
  if (models.length === 0) throw new AitermError("Cursor model catalog に利用可能なmodelがありません", 2);
  return models;
}

export function assertCursorModelAvailable(bin: string, cwd: string, model: string, effort: string | null): void {
  const effective = cursorModelArgument(model, effort) as string;
  const models = cursorModelCatalog(bin, cwd);
  const available = effort ? models.includes(effective) : models.includes(model) || models.some((id) => id.startsWith(`${model}-`));
  if (!available) {
    throw new AitermError(
      `Cursor model catalog に ${JSON.stringify(effective)} がありません。` +
        "modelとreasoning_effortから作る正規IDが存在しないため、別modelへfallbackせず中止しました",
      2,
    );
  }
}

const CURSOR_EFFORT_LABELS: Readonly<Record<string, string>> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  "extra-high": "Extra High",
  max: "Max",
};

export function cursorEffortNavigation(screen: string, effort: string): { down: number; label: string } {
  const label = CURSOR_EFFORT_LABELS[effort.toLowerCase()];
  if (!label) throw new AitermError(`Cursorのreasoning_effort ${JSON.stringify(effort)} は未対応です`, 2);
  const choices = screen.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(→\s*)?[●○◯]\s+(.+?)(?:\s+✓)?\s*$/);
    return match ? [{ selected: !!match[1], label: match[2] }] : [];
  });
  const current = choices.findIndex((choice) => choice.selected);
  const target = choices.findIndex((choice) => choice.label === label);
  if (current < 0 || target < 0) {
    throw new AitermError(`Cursorのmodel parameter画面に reasoning effort ${label} がありません`, 2);
  }
  return { down: (target - current + choices.length) % choices.length, label };
}

export function assertCursorAuthenticationReady(bin: string): void {
  const result = spawnAgentControlCommand(bin, ["status"], process.cwd(), {
    encoding: "utf8",
    timeout: CURSOR_AUTH_TIMEOUT_MS,
    maxBuffer: 64 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.error == null && result.status === 0 && !/not logged in|unauthenticated|sign in/i.test(output)) return;
  if (/not logged in|unauthenticated|sign in/i.test(output)) {
    throw new AitermError(
      "Cursor Agent CLIが未認証です。sessionは作成していません。通常端末で公式の `agent login` を一度だけ完了してください。",
      2,
    );
  }
  const timedOut = result.error && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  throw new AitermError(
    `Cursor Agent CLIの認証状態を起動前に確認できません${timedOut ? "（5秒でtimeout）" : ""}。sessionは作成していません。` +
      "通常端末で `agent status` が成功することを確認してください。",
    2,
  );
}

export function buildCursorAgentCmd(
  bin: string,
  model: string | null,
  effort: string | null,
  prompt: string | null,
  meta: AgentMetadata | null,
): string {
  validateCursorModelEffort(model, effort);
  const parts = [shq(bin)];
  const modelArg = cursorModelArgument(model, effort);
  if (modelArg) parts.push("--model", shq(modelArg));
  // managed agentは人の対話承認を待てない。Cursor公式の無人運転フラグで
  // workspace・MCP server・各tool callの確認をadapter内に閉じ込める。
  parts.push("--force", "--approve-mcps", "--trust");
  if (meta?.kind === "cursor" && meta.write_scope === "read-only") parts.push("--mode", "ask");
  if (prompt) {
    const value = meta ? cursorPromptWithLineage(meta, prompt) : prompt;
    parts.push(shq(value));
  }
  return parts.join(" ");
}

export function cursorPromptWithLineage(meta: AgentMetadata, prompt: string): string {
  return `${subagentInstruction(meta)}\n\n${prompt}`;
}

export function cursorLaunchNote(model: string | null, effort: string | null, meta: AgentMetadata | null): string {
  const effective = cursorModelArgument(model, effort);
  const modelNote = effective ? ` model=${JSON.stringify(effective)}（引数）` : " model=Cursor CLI既定";
  return `${modelNote}${writeScopeLaunchNote("cursor", meta?.write_scope)}`;
}

export const CURSOR_COMPOSER_MARKER_RE = /(?:^|\n)\s*(?:>|→|->)\s*(?:\n|$)/m;
// 送信後の残留検出では、本文が矢印と同じ行に残る現行UIもcomposerとして扱う。
// ready判定には使わない。本文入りcomposerを入力待ちと誤認させないため。
export const CURSOR_COMPOSER_CONTENT_MARKER_RE = /^\s*(?:->|>|→)(?:\s|$)/;
const CURSOR_FOLLOWUP_MARKER_RE = /(?:^|\n)\s*(?:→|->)\s*Add a follow-up\b/im;
const CURSOR_START_PROMPT_MARKER_RE = /(?:^|\n)\s*(?:→|->)\s*Plan,\s*search,\s*build anything\s*(?:\n|$)/im;

export function cursorTuiReady(screen: string): boolean {
  if (CURSOR_FOLLOWUP_MARKER_RE.test(screen)) return true;
  return /Cursor Agent/i.test(screen) &&
    (CURSOR_COMPOSER_MARKER_RE.test(screen) || CURSOR_START_PROMPT_MARKER_RE.test(screen));
}

export function cursorPaneObservation(screen: string): import("../agent-shared.js").HarnessPaneObservation {
  const tail = screen.split("\n").slice(-32).join("\n");
  if (/ctrl\+c to stop/i.test(tail)) return { state: "busy", reason: "turn_running" };
  if (cursorTuiReady(tail)) return { state: "idle", reason: "composer_ready" };
  return { state: "unknown", reason: "unrecognized_screen" };
}
