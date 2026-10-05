import { authUrl, type AgentAuthPlan, type AgentAuthStatus, type AgentAuthPane } from "../agent-auth.js";
// Cursor Agent CLI 固有の制御。通常 ~/.cursor を共有し、完了正本は
// launch markerで一意にbindした agent transcript の turn_ended とする。
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { AitermError } from "../errors.js";
import { spawnAgentControlCommand } from "../agent-resolver.js";
import { checkedCatalog, type AgentModelCatalog } from "../model-catalog.js";
import {
  AGENT_DONE_POLL_MS,
  CURSOR_SCREEN_POLL_MS,
  pollGate,
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
  readScreen: (aitermSession: string) => string,
  signal?: AbortSignal,
): Promise<AgentWaitObservation> {
  const metadataFile = agentMetadataPath(meta.aiterm_session, meta.launch_id);
  let transcript = cursorTranscript(meta);
  const startBoundary = requestedCursor ?? (transcript ? cursorTranscriptState(transcript).userTurns : 0);
  let malformedEvents = 0;
  const deadline = performance.now() + timeout * 1000;
  // 画面を読むたびにtmuxを1回起動する。完了の見回りより間隔を空け、1回読んだ画面で利用上限とhook拒否の両方を見る。
  const screenDue = pollGate(CURSOR_SCREEN_POLL_MS);
  const observation = (
    outcome: AgentWaitObservation["outcome"],
    ev: AgentDoneEvent | null = null,
    rateLimit: string | null = null,
    error: string | null = null,
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
    error,
  });

  for (;;) {
    signal?.throwIfAborted();
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
    // 最初の周回では必ず読む（timeout=0の照会も1回は読む）。
    if (screenDue()) {
      const screen = readScreen(meta.aiterm_session);
      const limited = cursorUsageLimit(screen)?.message ?? null;
      if (limited) return observation("rate_limited", null, limited);
      // 拒否されたpromptのturnは始まらず、完了も来ない。拒否の表示は数秒で消えるので、見えている間に終わらせる。
      const hookBlocked = cursorHookBlocked(screen);
      if (hookBlocked) return observation("error", null, null, `USER_HOOK_BLOCKED: ${hookBlocked.message}`);
    }
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
  // tool_useで区切った本文の塊を持つ。道具を呼ぶ前の文は作業途中の報告なので、回答は最後の塊だけにする。
  let current: string[][] = [[]];
  let completed: string[][] | null = null;
  for (const line of readTranscriptLines(transcript)) {
    if (!line.trim()) continue;
    let record: any;
    try { record = JSON.parse(line); } catch { continue; }
    if (record?.role === "user") current = [[]];
    if (record?.role === "assistant" && Array.isArray(record?.message?.content)) {
      for (const part of record.message.content) {
        if (part?.type === "text" && typeof part?.text === "string") current.at(-1)!.push(part.text);
        else if (part?.type === "tool_use" && current.at(-1)!.length > 0) current.push([]);
      }
    }
    if (record?.type === "turn_ended") completed = current.map((chunk) => [...chunk]);
  }
  if (completed === null) transcriptUnavailable();
  return (completed.filter((chunk) => chunk.length > 0).at(-1) ?? []).join("\n");
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
  return cursorModelLines(bin, cwd).map((line) => line.id);
}

export function cursorModelLines(bin: string, cwd: string): { id: string; label: string }[] {
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
  const models = text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([^\s]+)\s+-\s+(.+)$/);
    return match ? [{ id: match[1], label: match[2].replace(/[\u200b\s]+$/u, "") }] : [];
  });
  if (models.length === 0) throw new AitermError("Cursor model catalog に利用可能なmodelがありません", 2);
  return models;
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

// Cursorのcatalogは「素のmodel ID + effort（+ -fast）」を連結した完成形で並ぶ。Aitermは起動時にmodelとeffortを
// `${model}-${effort}` へ連結し、稼働中はparameter画面でeffortを選び直す。候補は素のIDとそのIDで作れるeffortにする。
// -fast版やeffortが途中に入るID（claude-4.6-sonnet-medium-thinking等）は連結で作れないので候補にしない
// （BellTeamの裁定 2026-09-03。使う時はeffortなしで完成形をmodelに指定する）。
const CURSOR_EFFORT_TOKENS = ["none", "minimal", "low", "medium", "high", "xhigh", "extra-high", "max"];
const CURSOR_EFFORT_SUFFIXES = [...CURSOR_EFFORT_TOKENS].sort((a, b) => b.length - a.length);
// parameter画面にラベルの無いminimalは稼働中に選び直せないので出さない（cursorEffortNavigation）。
const CURSOR_SELECTABLE_EFFORTS = CURSOR_EFFORT_TOKENS.filter((effort) => effort in CURSOR_EFFORT_LABELS);

function cursorBaseModel(id: string): { base: string; effort: string | null; fast: boolean } | null {
  const fast = id.endsWith("-fast");
  let rest = fast ? id.slice(0, -"-fast".length) : id;
  let effort: string | null = null;
  for (const token of CURSOR_EFFORT_SUFFIXES) {
    if (rest.endsWith(`-${token}`)) {
      rest = rest.slice(0, -(token.length + 1));
      effort = token;
      break;
    }
  }
  const parts = rest.split("-");
  const embedded = parts.some((part) => CURSOR_EFFORT_TOKENS.includes(part) || part === "fast") ||
    CURSOR_EFFORT_TOKENS.some((token) => token.includes("-") && rest.includes(`-${token}`));
  return embedded ? null : { base: rest, effort, fast };
}

export function cursorModelChoices(bin: string, cwd: string): AgentModelCatalog {
  return cursorCatalogFromLines(cursorModelLines(bin, cwd));
}

/** `cursor-agent models` の各行（IDと表示名）から、素のmodel IDとeffortの候補を作る。 */
export function cursorCatalogFromLines(lines: { id: string; label: string }[]): AgentModelCatalog {
  const choices = new Map<string, { efforts: Set<string>; label: string | null }>();
  let defaultModel: string | null = null;
  for (const line of lines) {
    const parsed = cursorBaseModel(line.id);
    if (!parsed) continue;
    const choice = choices.get(parsed.base) ?? { efforts: new Set<string>(), label: null };
    // -fast版だけにあるeffortは `${model}-${effort}` の連結で作れないので数えない。
    if (parsed.effort && !parsed.fast) choice.efforts.add(parsed.effort);
    if (line.id === parsed.base) {
      choice.label = line.label.replace(/\s*\([^)]*\)\s*$/, "");
      if (/\((?:[^)]*,\s*)?default\)\s*$/.test(line.label)) defaultModel = parsed.base;
    }
    choices.set(parsed.base, choice);
  }
  return checkedCatalog("Cursor", {
    source: "cursor-agent models",
    harness_version: null,
    default_model: defaultModel,
    adapter_efforts: {},
    models: [...choices].map(([id, choice]) => ({
      id,
      display_name: choice.label,
      efforts: CURSOR_SELECTABLE_EFFORTS.filter((effort) => choice.efforts.has(effort)),
      default_effort: null,
      hidden: false,
    })),
  });
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

/** 起動argv（先頭が実行ファイル）。paneのshellに合わせた引用は呼び出し側が行う。 */
export function cursorAgentArgv(
  bin: string,
  model: string | null,
  effort: string | null,
  prompt: string | null,
  meta: AgentMetadata | null,
): string[] {
  validateCursorModelEffort(model, effort);
  const parts = [bin];
  const modelArg = cursorModelArgument(model, effort);
  if (modelArg) parts.push("--model", modelArg);
  // managed agentは人の対話承認を待てない。Cursor公式の無人運転フラグで
  // workspace・MCP server・各tool callの確認をadapter内に閉じ込める。
  parts.push("--force", "--approve-mcps", "--trust");
  if (meta?.kind === "cursor" && meta.write_scope === "read-only") parts.push("--mode", "ask");
  if (prompt) parts.push(meta ? cursorPromptWithLineage(meta, prompt) : prompt);
  return parts;
}

export function buildCursorAgentCmd(
  bin: string,
  model: string | null,
  effort: string | null,
  prompt: string | null,
  meta: AgentMetadata | null,
): string {
  // 固定の語彙（--force、--mode ask等）は引用しない。実行ファイル、model、promptだけを引用する。
  const argv = cursorAgentArgv(bin, model, effort, prompt, meta);
  return argv.map((part, index) =>
    index === 0 || argv[index - 1] === "--model" || (prompt !== null && index === argv.length - 1) ? shq(part) : part,
  ).join(" ");
}

/**
 * Windows native paneのPowerShell 7で走らせる起動行。WindowsのCursor Agentは、Git Bash配下で起動すると
 * hookへ渡すJSONの先頭にUTF-8 BOMを付け、BOMを読めない利用者hookが送信を止める（fox実測 2026-09-26:
 * Git Bash配下は全てprompt_historyだけ残りstore.dbが作られず、PowerShell 7 paneからは同じhookで通る）。
 */
export function cursorPwshLaunchLine(cwd: string | null, env: [string, string][], argv: string[]): string {
  const psq = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const parts: string[] = [];
  if (cwd) parts.push(`Set-Location -LiteralPath ${psq(cwd)}`);
  for (const [name, value] of env) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new AitermError("環境変数名が不正です", 2);
    parts.push(`$env:${name}=${psq(value)}`);
  }
  parts.push(`& ${argv.map(psq).join(" ")}`);
  return parts.join("; ");
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

// 利用上限に達したCursorは、transcriptへturn_endedを書かず、入力欄も戻さずに説明を出して止まる（2026.09.26-dd393fe、macOSで実測）。
//   Error: You've hit your usage limit
//   You've saved $766 ... Switch to a different model or set a Spend Limit to continue with Sonnet. ...
//   fallbackModel: / spendLimitHit: true / chatMessage: ...
// 説明は空行か「key: value」行の手前まで。後ろに入力欄や実行中表示があれば別モデルで続けた後の履歴なので上限にしない。
export function cursorUsageLimit(screen: string): { message: string } | null {
  const clean = screen.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const heading = [...clean.matchAll(/^[ \t]*Error:[ \t]*(You'?ve hit your usage limit)[ \t]*$/gim)].at(-1);
  if (!heading) return null;
  const after = clean.slice(heading.index! + heading[0].length);
  if (/ctrl\+c to stop/i.test(after) || CURSOR_FOLLOWUP_MARKER_RE.test(after) || CURSOR_START_PROMPT_MARKER_RE.test(after)
    || after.split("\n").some(line => CURSOR_COMPOSER_CONTENT_MARKER_RE.test(line))) return null;
  const detail: string[] = [];
  for (const line of after.split("\n").slice(1)) {
    if (!line.trim() || /^\s*[A-Za-z]+:(?:\s|$)/.test(line)) break;
    detail.push(line.trim());
  }
  return { message: [`${heading[1]}.`, ...detail].join(" ") };
}

// Cursor Agentはpromptを送る前のhook（beforeSubmitPromptと、互換読込したClaude CodeのUserPromptSubmit）が
// 拒否すると、promptを捨てて入力欄を空に戻し、その下に「Hook blocked with message:」を数秒だけ出す。turnは始まらず、
// transcriptにもuser turnは残らない（v2026.09.26、Windows実機採取 2026-09-27）。
const CURSOR_HOOK_BLOCKED_RE = /^[ \t]*Hook blocked with message:[ \t]*(.*)$/gim;
const CURSOR_HOOK_BLOCKED_MESSAGE_LIMIT = 600;

export function cursorHookBlocked(screen: string): { message: string } | null {
  const clean = screen.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const hit = [...clean.matchAll(CURSOR_HOOK_BLOCKED_RE)].at(-1);
  if (!hit) return null;
  const after = clean.slice(hit.index! + hit[0].length);
  // 拒否の後に新しいturnが動いている画面は、古い表示の名残として数えない。
  if (/ctrl\+c to stop/i.test(after) || CURSOR_FOLLOWUP_MARKER_RE.test(after)) return null;
  const lines = [hit[1].trim()];
  for (const line of after.split("\n").slice(1)) {
    if (!line.trim()) break;
    lines.push(line.trim());
  }
  // hookを動かしたNode自身の警告は拒否の理由ではない。
  const message = lines.filter(line => line && !/ExperimentalWarning|--trace-warnings|^any time$/.test(line)).join(" ");
  return { message: (message || "(hookは理由を出していません)").slice(0, CURSOR_HOOK_BLOCKED_MESSAGE_LIMIT) };
}

// 送信前hookの実行中、Cursorは入力欄の上に「Working」の回転表示だけを出し、入力欄はまだ「Plan, search, build anything」の
// ままで「ctrl+c to stop」も無い（v2026.09.26、Windows実機採取 2026-09-27）。turnはまだ始まっておらず、hookが拒否すればここで終わる。
const CURSOR_SPINNER_WORKING_RE = /^[ \t]*[⠀-⣿]+[ \t]+Working\b/m;

export function cursorPromptHooksRunning(screen: string): boolean {
  const tail = screen.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").split("\n").slice(-32).join("\n");
  return CURSOR_SPINNER_WORKING_RE.test(tail) && CURSOR_START_PROMPT_MARKER_RE.test(tail) && !/ctrl\+c to stop/i.test(tail);
}

export function cursorPaneObservation(screen: string): import("../agent-shared.js").HarnessPaneObservation {
  const tail = screen.split("\n").slice(-32).join("\n");
  if (cursorUsageLimit(tail)) return { state: "blocked", reason: "rate_limited" };
  const hookBlocked = cursorHookBlocked(tail);
  if (hookBlocked) return { state: "blocked", reason: "user_hook_blocked", detail: hookBlocked.message };
  if (/ctrl\+c to stop/i.test(tail)) return { state: "busy", reason: "turn_running" };
  if (cursorTuiReady(tail)) return { state: "idle", reason: "composer_ready" };
  return { state: "unknown", reason: "unrecognized_screen" };
}


export function cursorAuthPlan(): AgentAuthPlan { return { args: ["login"], env: [["NO_OPEN_BROWSER", "1"]] }; }

export function cursorAuthStatus(bin: string, cwd: string, env = process.env): AgentAuthStatus {
  const result = spawnAgentControlCommand(bin, ["status"], cwd,
    { cwd, env, encoding: "utf8", timeout: 5000, maxBuffer: 64 * 1024 });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (!result.error && /not logged in|unauthenticated|sign in/i.test(output)) return { status: "unauthenticated", message: null };
  // 無効なtoken（期限切れ等）の時、公式statusは「Logged in (unable to fetch user details)」と終了0で答える（2026-10-05）。
  // 期限切れか、通信できないだけかは、この答えからは分からない。認証済みとは返さない。
  if (!result.error && /unable to fetch user details/i.test(output)) {
    return { status: "failed", message: "Cursorのログインを確認できません（期限切れか、通信できない状態です）。入り直す時はagent_authのstartにrelogin:trueを付けてください。" };
  }
  // launcherと同じ公式status契約。stderrやアカウント情報はreceiptへ載せない。
  if (!result.error && result.status === 0) return { status: "authenticated", message: null };
  return { status: "failed", message: "Cursor Agent CLIの公式認証状態を確認できません。" };
}

export function cursorAuthPane(screen: string): AgentAuthPane {
  return { url: authUrl(screen, ["cursor.com", "www.cursor.com", "auth.cursor.com"]),
    user_code: null, input_required: false, message: null };
}
