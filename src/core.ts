/**
 * core — CLI/MCP が共有する純粋ロジック層（Node/TS 版）。
 *
 * 1個のローカル専用 tmux セッションを握り、send でキーストロークを流し、read で画面/出力を
 * トークン削減して受け取る。SSH/docker は専用機能にせず send(id, "ssh host") で中に入る（ネスト）。
 * セッションは tmux サーバ常駐ゆえ、本プロセスが毎回終了しても次回 read で再接続できる。
 *
 * 現行設計: docs/DESIGN.md。旧planは docs/archive/、出力削減は rag/ の RTK を移植。
 */
import { spawn, spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as rtk from "./rtk.js";
import { paneTokenHint } from "./harnesses/pane-tokens.js";
import { readRuntimeProcesses, processSubtree, processIdentity, backgroundProcesses, type NativeProcessIdentity, type RuntimeProcess } from "./process-runtime.js";
import { recordRuntimeError, type RuntimeErrorCode } from "./runtime-error-store.js";
import { AitermError, TelemetryOwnedError, telemetryOwnedFailure, ownTelemetryFailure, ptyDependencyError } from "./errors.js";
import {
  isWin,
  SOCKDIR,
  SOCK,
  WIN_NS,
  tmuxSpawnEnv,
  tmuxCommand,
  sendPsmuxPayload,
  loadPtyBufferChunk,
  pasteBufferBaseArgs,
  TMUX_EMPTY_CONFIG,
  attachCommand,
  normalizePaneCommand,
  appendMarkSentinel,
  markShellCommand,
  settlePaneLog,
  paneCwdArgument,
  sessionEnvironmentLaunch,
} from "./tmux-runtime.js";
import {
  sleep,
  currentUid,
  runtimeStateBase,
  safeStatSize,
  readFileRange,
  writeJson0600,
  writeText0600,
  createEmpty0600,
  shq,
  LAUNCH_ID_RE,
  AGENT_DONE_POLL_MS,
  AGENT_EVENT_MAX_BYTES,
  CODEX_TRANSCRIPT_INCREMENT_MAX_BYTES,
  GROK_TRANSCRIPT_INCREMENT_MAX_BYTES,
  assertSessionName,
  stateRoot,
  ensureStateRoot,
  agentsDir,
  agentEventPath,
  agentMetadataPath,
  agentWaitLockPath,
  writeAgentMetadata,
  AGENT_EVENT_TAIL_BYTES,
  agentLabel,
  agentHarness,
  subagentInstruction,
  agentLineageFields,
} from "./agent-shared.js";
import type {
  AgentKind,
  AgentHarness,
  AgentMetadata,
  InitialPromptState,
  AgentDoneEvent,
  AgentWaitObservation,
  AgentLineageContext,
  InitialPromptDelivery,
  AgentStartupResult,
} from "./agent-shared.js";
import {
  GROK_MODEL_DEFAULTS,
  realGrokHome,
  resolveAndValidateGrokAuth,
  assertGrokModelAvailable,
  grokEventsTranscript,
  grokCompletionEvent,
  latestGrokCompletion,
  observeGrokDone,
  buildGrokAgentCmd,
  grokLaunchNote,
  grokEnvTokens,
  grokTuiReady,
  grokTuiBusy,
  grokPaneObservation,
  grokStartupAction,
  grokLaunchBlockingDialog,
  assertGrokSandboxNotRejected,
  GROK_COMPOSER_MARKER_RE,
  grokFooterHasConfiguration,
  grokTranscriptText,
  createGrokAgentMetadata,
} from "./harnesses/grok.js";
import {
  realCodexHome,
  readCodexConfigPins,
  codexConfigSummary,
  codexRootTranscript,
  findLatestCodexTranscript,
  bindCodexTranscriptSession,
  codexCompletionEvent,
  codexTranscriptSessionId,
  latestCodexCompletion,
  observeCodexDone,
  buildCodexAgentCmd,
  codexLaunchNote,
  codexTuiReady,
  codexPaneObservation,
  codexApprovalDialog,
  codexStartupAction,
  codexLaunchBlockingDialog,
  CODEX_COMPOSER_MARKER_RE,
  codexModelChoice,
  codexEffortChoice,
  codexMoreReasoningChoice,
  codexTranscriptText,
  createCodexAgentMetadata,
} from "./harnesses/codex.js";
import type { CodexConfigPin } from "./harnesses/codex.js";
import {
  OPERATION_ID_RE,
  CLAUDE_RESULT_MAX_BYTES,
  CLAUDE_EFFORTS,
  agentManagedClaudeSettingsPath,
  agentClaudeResultPath,
  agentClaudeOperationPath,
  agentClaudeApprovalReceiptPath,
  agentClaudeDispatchReceiptPath,
  createClaudeCorrelationSettings,
  validateOperationId,
  readClaudeResultText,
  assertClaudeAuthenticationReady,
  buildClaudeAgentCmd,
  claudeLaunchNote,
  claudeTuiReady,
  claudePaneObservation,
  claudeStartupAction,
  CLAUDE_COMPOSER_MARKER_RE,
  createClaudeAgentMetadata,
  claudeSessionTranscriptPath,
  claudeApiErrorFromLine,
  type ClaudeApiError,
} from "./harnesses/claude.js";
import {
  bindCursorTranscriptSession,
  cursorTurnBoundary,
  latestCursorCompletion,
  observeCursorDone,
  cursorTranscriptText,
  assertCursorAuthenticationReady,
  assertCursorModelAvailable,
  buildCursorAgentCmd,
  cursorPromptWithLineage,
  createCursorAgentMetadata,
  cursorLaunchNote,
  cursorEffortNavigation,
  cursorTuiReady,
  cursorPaneObservation,
  CURSOR_SUBMIT_SEQUENCE,
  CURSOR_COMPOSER_CONTENT_MARKER_RE,
  validateCursorModelEffort,
} from "./harnesses/cursor.js";
import { resolveAgentBin, spawnAgentControlCommand, resolveThroughlineBin, runThroughlineHandoffContext, isUsableExecutableFile, isWindowsNativeExecutable, isUsableAgentExecutableFile, agentBinForPaneShell, resolveWinPaneShell } from "./agent-resolver.js";
export { AitermError } from "./errors.js";
export { tmuxSpawnEnv } from "./tmux-runtime.js";
export { agentHarness } from "./agent-shared.js";



// 完了検出
export const DEFAULT_TIMEOUT = 10.0;
const POLL = 0.25;
const STABLE_POLLS = 2; // 連続でログサイズ不変ならば静止とみなす回数
const SHELLS = new Set(["bash", "sh", "zsh", "fish", "dash"]);
// 通常PTYへ複数行をそのままpasteすると、途中で起動したpager/REPLが後続行を
// キー入力として消費する。POSIX shell前面では改行を持たないeval 1行へ包み、
// script全体をshell内部へ取り込んでから実行する。fish等の非POSIX shellや
// ssh/REPL前面は従来の生pasteを維持する。
const ATOMIC_MULTILINE_SHELLS = new Set(["bash", "sh", "zsh", "dash"]);
// mark の sentinel は POSIX シェル構文（; と "$?"）に依存する。これらの非 POSIX 対話シェルが
// 前面のときは "$?" が正しく展開されず sentinel が壊れるので mark を拒否する（B8）。ssh/docker で
// リモート POSIX シェルに入っている場合は前面が "ssh"/"docker" 等で本集合に含まれず＝許可される。
const NON_POSIX_MARK_SHELLS = new Set(["fish", "csh", "tcsh"]);

// mark:true が付ける完了 sentinel の検出正規表現。printf の実出力は rc=<数字>、コマンド行の
// エコーは rc=%d(リテラル)。数字アンカーでエコーに免疫化し、部分一致による早期誤完了を防ぐ（B1）。
// send の printf 書式（`rc=%d`）と対で保守すること。
const MARK_DONE_RE = /<<<AITERM_DONE rc=[0-9]+>>>/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_LINEAGE_RE = /^[A-Za-z0-9_.:-]+(?:>[A-Za-z0-9_.:-]+)*$/;
export type { AgentKind, AgentHarness } from "./agent-shared.js";

const AGENT_DONE_SETTLE_MIN_MS = 250;
const AGENT_DONE_SCREEN_SETTLE_POLL_MS = 100;
const AGENT_DONE_SCREEN_SETTLE_MAX_POLLS = 5;
const AGENT_DONE_SCREEN_SETTLE_MIN_SAMPLES = 3;
const AGENT_SUBMIT_DELAY_MS = 250;
const AGENT_METADATA_NEGATIVE_CACHE_TTL_MS = 2_000;
const AGENT_TUI_READY_TIMEOUT_MS = 30_000;
const AGENT_TUI_READY_POLL_MS = 500;
const AGENT_TUI_READY_STABLE_SAMPLES = 11;
const AGENT_TUI_READY_LINES = 45;
const CLAUDE_APPROVAL_SCREEN_LINES = 80;
// submit座礁観測（dispatch後にcomposerへ送信textが残存していないかの有界チェック）
const AGENT_SUBMIT_RESIDUE_DELAY_MS = 250;
const AGENT_SUBMIT_RESIDUE_POLL_MS = 300;
const AGENT_SUBMIT_RESIDUE_MAX_SAMPLES = 5;
const AGENT_SUBMIT_RESIDUE_TAIL_CHARS = 32;
const AGENT_SUBMIT_RESIDUE_MIN_TAIL_CHARS = 8;
const CURSOR_PROMPT_VISIBLE_POLL_MS = 100;
const CURSOR_PROMPT_VISIBLE_MAX_SAMPLES = 50;

// 出力削減（RTK の CAP 思想を移植）
const MAX_LINES_BEFORE_ELIDE = 60;
const HEAD_LINES = 30;
const TAIL_LINES = 20;
const MAX_LINE_CHARS_BEFORE_ELIDE = 2000;
const LINE_HEAD_CHARS = 1200;
const LINE_TAIL_CHARS = 600;
const DEDUP_MIN_RUN = 3; // 同一行がこれ以上連続したら 1 行＋件数に畳む
const MAX_FULL_BYTES = 8 * 1024 * 1024; // full/range 読取で一度にメモリへ載せる上限（B7）
const MAX_SEND_BYTES = 64 * 1024;
// PTY入力queueはOSを問わず、tmuxが長文を1回で流すと後半を落とすことがある。
// UTF-8境界を守って小さいtmux client roundtripに分け、各回にserver event loopがPTYへdrainできる境界を作る。
const PTY_PASTE_CHUNK_BYTES = 256;
const PTY_PASTE_CHUNK_PAUSE_MS = 10;
const PTY_PASTE_PAUSE_BUFFER = new Int32Array(new SharedArrayBuffer(4));
const SESSION_SEND_LOCK_WAIT_MS = isWin ? 130_000 : 10_000;
const SESSION_SEND_LOCK_POLL_MS = 25;

// CSI/OSC/ESC エスケープ・制御文字
// CSI / OSC(BEL or ST 終端) / DCS・PM・APC・SOS(ESC P/^/_/X … BEL or ST 終端。ペイロード本文ごと除去=B10) / 残る2文字エスケープ
const ANSI_RE =
  /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P^_X][\s\S]*?(?:\x07|\x1b\\)|\x1b[@-_]/g;
const CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g; // \t(09) \n(0a) は残す
const PASTE_MARKERS_RE = /\x1b\[20[01]~/g;

// よく使う制御キーの別名（tmux のキー名へ）
const KEYMAP: Record<string, string> = {
  "ctrl-c": "C-c", "c-c": "C-c", "ctrl-d": "C-d", "c-d": "C-d",
  "ctrl-z": "C-z", "c-z": "C-z", "ctrl-l": "C-l", "ctrl-r": "C-r",
  enter: "Enter", tab: "Tab", esc: "Escape", escape: "Escape",
  up: "Up", down: "Down", left: "Left", right: "Right",
  space: "Space", bspace: "BSpace", backspace: "BSpace",
};








function tmux(...args: string[]): { code: number; stdout: string; stderr: string } {
  return tmuxCommand(true, ...args);
}
function tmuxCleanup(...args: string[]): { code: number; stdout: string; stderr: string } {
  return tmuxCommand(false, ...args);
}

function sessionExists(name: string): boolean {
  return tmux("has-session", "-t", name).code === 0;
}

function paneCurrentCommand(name: string): string {
  const r = tmux("display-message", "-p", "-t", name, "#{pane_current_command}");
  if (r.code !== 0) return "";
  return normalizePaneCommand(r.stdout.trim());
}

// ---- pane 入力の到達性（agent が tty の前面か・tty が raw か）----
// 打鍵が届く先は pane tty の前面プロセスグループだけであり、TUI は raw termios で読む。
// Codex 0.153 はツール実行のあと、①前面を子 shell（bash）へ返したまま agent が背面（STAT S）で
// 動き続ける、②前面へ戻っても termios を子 shell の cooked（icanon/echo）のまま残す、の2形を出す
// （実測 2026-09-04: Codex 席3つが順に該当。貼付本文が bash に落ちて `^[[200~` が生で残り、
// 打鍵が行バッファに溜まって `^L` が echo された）。どちらも PTY の状態であり aiterm が所有する。
// 停止（T）だけでなく背面で動く（S）agent も `fg` で前面へ戻せる。判定は OS が直接教える
// `ps -t <tty>` の STAT `+`／`T` と `stty -f <tty> -a` だけを使い、画面の文字列で推測しない。
const PANE_TTY_SHELLS = new Set([...SHELLS, "tcsh", "csh", "ksh"]);
const AGENT_FOREGROUND_RECOVERY_TIMEOUT_MS = 3_000;
const AGENT_FOREGROUND_RECOVERY_POLL_MS = 200;

export interface PaneTtyProcessState {
  agentPresent: boolean;
  agentForeground: boolean;
  agentStopped: boolean;
  /** agent 以外の非 shell プロセス（agent が起動したツール等）が前面（+）に居る。触らない合図。 */
  toolForeground: boolean;
  foregroundShell: string | null;
}

// harness の実プロセスを command 行から見分ける。agent が起動した子（bash -lc、ssh、git 等）は agent ではない。
const AGENT_COMMAND_PATTERNS: Record<AgentKind, RegExp> = {
  codex: /(^|[\s/])codex([\s]|$)/,
  claude: /(^|[\s/])claude([\s]|$)/,
  grok: /(^|[\s/])grok(-[^\s/]+)?([\s]|$)/,
  composer: /(^|[\s/])(composer|grok(-[^\s/]+)?)([\s]|$)/,
  cursor: /(^|[\s/])(cursor-agent|agent)([\s]|$)/,
};

/**
 * `ps -t <tty> -o stat=,command=` の出力を分類する（純粋関数）。
 * ログイン shell は command が `-zsh` のように先頭 `-` 付きで出るので剥がして判定する。
 */
export function classifyPaneTtyProcesses(psOutput: string, agentPattern: RegExp = /./): PaneTtyProcessState {
  const state: PaneTtyProcessState = {
    agentPresent: false, agentForeground: false, agentStopped: false, toolForeground: false, foregroundShell: null,
  };
  for (const raw of psOutput.split("\n")) {
    const m = raw.trim().match(/^(\S+)\s+(.*)$/);
    if (!m) continue;
    const stat = m[1];
    const command = m[2];
    const base = ((command.split(/\s+/, 1)[0] ?? "").split("/").pop() ?? "").replace(/^-/, "");
    if (PANE_TTY_SHELLS.has(base)) {
      // session leader（STAT の `s`）が pane の login shell。agent が起動した子 shell（`bash -lc …`）は
      // `s` を持たない。前面の子 shell は「ツール実行中」であり、fg も stty も触らない。
      if (stat.includes("+")) {
        if (stat.includes("s")) state.foregroundShell = base;
        else state.toolForeground = true;
      }
      continue;
    }
    if (!agentPattern.test(command)) {
      if (stat.includes("+")) state.toolForeground = true;
      continue;
    }
    state.agentPresent = true;
    if (stat.includes("+")) state.agentForeground = true;
    if (stat.startsWith("T")) state.agentStopped = true;
  }
  return state;
}

/** `stty -a` の出力が cooked（icanon または echo が有効）かを判定する（純粋関数）。 */
export function termiosIsCooked(sttyOutput: string): boolean {
  const tokens = sttyOutput.split(/[\s;]+/);
  return tokens.includes("icanon") || tokens.includes("echo");
}

function paneTtyOf(name: string): string | null {
  const r = tmux("display-message", "-p", "-t", name, "#{pane_tty}");
  if (r.code !== 0) return null;
  const tty = r.stdout.trim();
  return tty.startsWith("/dev/") ? tty : null;
}

/**
 * agent session への打鍵前に、agent が tty の前面で raw で読める状態にする。
 * 戻り値は行った回復（"fg" / "fg_stopped" / "stty_raw"）。何もしなければ空。
 * agent が tty 上に実在しない時は触らない（ready gate が入力受付不能として止める）。
 */
export async function ensureAgentOwnsPaneInput(name: string, kind: AgentKind): Promise<string[]> {
  if (isWin) return [];
  const tty = paneTtyOf(name);
  if (!tty) return [];
  const ttyId = tty.replace(/^\/dev\//, "");
  const psEnv = { ...process.env, LC_ALL: "C" };
  const observe = (): PaneTtyProcessState =>
    classifyPaneTtyProcesses(
      spawnSync("/bin/ps", ["-t", ttyId, "-o", "stat=,command="], { encoding: "utf8", timeout: 5000, env: psEnv }).stdout ?? "",
      AGENT_COMMAND_PATTERNS[kind],
    );
  const recovery: string[] = [];
  let state = observe();
  // agent が起動したツール／子 shell が前面なら、その tty 状態はツールの物。fg も stty も触らず ready gate に任せる。
  if (state.toolForeground) return [];
  if (state.agentPresent && !state.agentForeground) {
    const wasStopped = state.agentStopped;
    tmux("send-keys", "-t", name, "C-u");
    tmux("send-keys", "-l", "-t", name, "fg");
    tmux("send-keys", "-t", name, "Enter");
    const deadline = performance.now() + AGENT_FOREGROUND_RECOVERY_TIMEOUT_MS;
    for (;;) {
      await sleep(AGENT_FOREGROUND_RECOVERY_POLL_MS);
      state = observe();
      if (state.agentForeground) break;
      if (performance.now() >= deadline) {
        throw new AitermError(
          `AGENT_TUI_BACKGROUNDED session=${name} foreground=${state.foregroundShell ?? "不明"}\n` +
            "pane tty 上に agent が実在するが前面プロセスグループでなく、fg でも前面へ戻りません。" +
            "打鍵は shell に落ちるため送信していません。pty_read(screen:true) で画面を確認してください。",
          2,
        );
      }
    }
    recovery.push(wasStopped ? "fg_stopped" : "fg");
  }
  if (state.agentPresent && !state.toolForeground) {
    // 別 tty を指す flag は macOS/BSD が `-f`、Linux（coreutils）が `-F`。OS 差はここ一箇所で吸収する。
    const ttyFlag = process.platform === "linux" ? "-F" : "-f";
    const stty = spawnSync("/bin/stty", [ttyFlag, tty, "-a"], { encoding: "utf8", timeout: 5000, env: psEnv });
    if (stty.status === 0 && termiosIsCooked(stty.stdout ?? "")) {
      const set = spawnSync("/bin/stty", [ttyFlag, tty, "raw", "-echo"], { encoding: "utf8", timeout: 5000, env: psEnv });
      if (set.status !== 0) {
        throw new AitermError(
          `AGENT_TTY_COOKED session=${name}\n` +
            `tty が icanon/echo のままで raw へ戻せません: ${(set.stderr ?? "").trim() || `code=${set.status}`}。送信していません。`,
          2,
        );
      }
      recovery.push("stty_raw");
    }
  }
  return recovery;
}

function paneCurrentCommandForMark(name: string): string {
  const foreground = paneCurrentCommand(name);
  if ((!isWin && foreground !== "ssh") || foreground === "powershell" || foreground === "pwsh") return foreground;
  return markShellCommand(foreground, captureScreen(name, 4));
}

function pasteBufferSupportsNoSanitizeFlag(): boolean {
  const listed = tmux("list-commands");
  if (listed.code !== 0) {
    throw new AitermError(
      `tmux paste-buffer 能力の確認に失敗しました: ${listed.stderr.trim() || `code=${listed.code}`}`,
      2,
    );
  }
  // psmux の list-commands は行頭にインデントを持つため trim して突合する。
  const usage = listed.stdout.split("\n").find((line) => line.trim().startsWith("paste-buffer"));
  if (!usage) throw new AitermError("tmux list-commands にpaste-bufferがありません", 2);
  // tmux 3.4は制御文字を無変換でpasteし、-S自体が無い。3.7は既定でvis(3)変換し、
  // -Sが無変換を選ぶ。version文字比較で推測せず、実際のcommand usageにflagがあるかを見る。
  return /\[-[^\]]*S[^\]]*\]/.test(usage);
}

function splitPtyText(text: string): string[] {
  const chunks: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  for (const codePoint of text) {
    const bytes = Buffer.byteLength(codePoint, "utf8");
    if (chunk && chunkBytes + bytes > PTY_PASTE_CHUNK_BYTES) {
      chunks.push(chunk);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += codePoint;
    chunkBytes += bytes;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function quoteForPrintfB(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/'/g, `'"'"'`);
}

function atomicShellMultiline(text: string): string {
  // POSIX printf %bで元の改行・backslashを復元し、evalは現在shell内で実行する。
  // command substitutionが末尾LFを落とす点は、pty_sendのsubmitを担うEnterと同値。
  return `eval "$(command printf '%b' '${quoteForPrintfB(text)}')"`;
}

function assertSendTextSize(text: string, context = "送信文字列"): void {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_SEND_BYTES) {
    throw new AitermError(`${context}が${MAX_SEND_BYTES} bytesを超えています（${bytes} bytes）`, 2);
  }
}

function existingAgentsDir(): string | null {
  // 既存の agents dir があればその path、無ければ null（作成はしない）。
  // 以前はここで symlink・owner・mode を検査していたが撤去した（オーナー裁定 2026-08-19）。
  // なお「Windows で常に null を返す」形だった頃は close/killAll の agent state 掃除が
  // 常に no-op になり、同名 session の再起動が「agent metadata が複数あります」で
  // 失敗していた（実被弾 2026-08-15）。存在判定だけに絞ることでその轍も踏まない。
  const dir = path.join(runtimeStateBase(), `aiterm-mcp-${currentUid()}`, "agents");
  try {
    return fs.statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

function cleanupAgentState(name: string): void {
  assertSessionName(name);
  agentMetadataNegativeCache.delete(name);
  const dir = existingAgentsDir();
  if (!dir) return;
  const prefix = `${name}.`;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith(prefix)) continue;
      const p = path.join(dir, f);
      try {
        if (
          f.endsWith(".agent.json") ||
          f.endsWith(".events.jsonl") ||
          f.endsWith(".wait.lock") ||
          f.endsWith(".claude-settings.json") ||
          f.endsWith(".claude-mcp.json") ||
          f.endsWith(".claude-result.json") ||
          f.endsWith(".cursor-result.json") ||
          f.endsWith(".claude-operation.json") ||
          f.endsWith(".claude-approval.json") ||
          f.endsWith(".claude-dispatch")
        ) fs.unlinkSync(p);
        else if (f.endsWith(".codex-home") || f.endsWith(".grok-home") || f.endsWith(".cursor-plugin") || f.endsWith(".home")) {
          fs.rmSync(p, { recursive: true, force: true });
        }
      } catch {
        /* stale agent state cleanup is best-effort */
      }
    }
  } catch {
    /* stale agent state cleanup is best-effort */
  }
}

function logpath(name: string): string {
  return path.join(SOCKDIR, name + ".log");
}
function offsetpath(name: string): string {
  return path.join(SOCKDIR, name + ".offset");
}
function lastcmdpath(name: string): string {
  return path.join(SOCKDIR, name + ".lastcmd");
}
// mark:true 送信中フラグ。存在すれば waitCompletion が sentinel 完了検出（MARK_DONE_RE）を有効化する。
function markpath(name: string): string {
  return path.join(SOCKDIR, name + ".mark");
}
function sendLockPath(name: string): string {
  assertSessionName(name);
  return path.join(SOCKDIR, name + ".send.lock");
}

function readOffset(name: string): number {
  try {
    const n = parseInt(fs.readFileSync(offsetpath(name), "utf8").trim(), 10);
    return Number.isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
}
function writeOffset(name: string, off: number): void {
  fs.writeFileSync(offsetpath(name), String(off));
}
function writeLastcmd(name: string, cmd: string): void {
  try {
    fs.writeFileSync(lastcmdpath(name), cmd);
  } catch {
    /* noop */
  }
}
function readLastcmd(name: string): string {
  try {
    return fs.readFileSync(lastcmdpath(name), "utf8");
  } catch {
    return "";
  }
}

export function attachHint(name: string): string {
  const cmd = attachCommand(name);
  return (
    `このセッションを自分の目で見る/介入する:\n` +
    `  ${cmd}\n` +
    `  （抜けるには Ctrl-b d）`
  );
}

// ---------------------------------------------------------------- 出力削減

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4.0);
}

export function stripControl(text: string): string {
  text = text.replace(/\r\n/g, "\n"); // CRLF 正規化
  const out: string[] = [];
  for (let line of text.split("\n")) {
    if (line.includes("\r")) {
      const parts = line.split("\r");
      line = parts[parts.length - 1]; // 行中の\rは進捗上書き＝最終状態だけ残す
    }
    line = line.replace(ANSI_RE, "").replace(CTRL_RE, "");
    out.push(line.replace(/\s+$/, "")); // rstrip
  }
  return out.join("\n");
}

function collapseBlanks(lines: string[]): string[] {
  const out: string[] = [];
  let blanks = 0;
  for (const ln of lines) {
    if (ln === "") {
      blanks++;
      if (blanks <= 1) out.push(ln);
    } else {
      blanks = 0;
      out.push(ln);
    }
  }
  while (out.length && out[0] === "") out.shift();
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

function dedupRuns(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  const n = lines.length;
  while (i < n) {
    let j = i;
    while (j < n && lines[j] === lines[i]) j++;
    const run = j - i;
    if (run >= DEDUP_MIN_RUN && lines[i] !== "") out.push(`${lines[i]}  〈×${run}〉`);
    else out.push(...lines.slice(i, j));
    i = j;
  }
  return out;
}

function surrogateSafeEnd(text: string, end: number): number {
  return end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])
    ? end + 1
    : end;
}

function surrogateSafeStart(text: string, start: number): number {
  return start > 0 && start < text.length && /[\uD800-\uDBFF]/.test(text[start - 1]) && /[\uDC00-\uDFFF]/.test(text[start])
    ? start - 1
    : start;
}

function elideLongLines(lines: string[]): string[] {
  return lines.map((line) => {
    if (line.length <= MAX_LINE_CHARS_BEFORE_ELIDE) return line;
    const headEnd = surrogateSafeEnd(line, LINE_HEAD_CHARS);
    const tailStart = surrogateSafeStart(line, line.length - LINE_TAIL_CHARS);
    const omitted = tailStart - headEnd;
    return `${line.slice(0, headEnd)}… 〈行内 ${omitted} 文字省略。全文は raw:true か line_range で取得〉 …${line.slice(tailStart)}`;
  });
}

/** RTK 4戦略を移植: 制御除去 / 空白正規化 / 連続重複圧縮 / head+tail 折りたたみ。返り値 [body, meta]。 */
export function reduceOutput(raw: string, name: string, elide = true): [string, string] {
  const rawLinesN = (raw.match(/\n/g)?.length ?? 0) + (raw && !raw.endsWith("\n") ? 1 : 0);
  const cleaned = stripControl(raw);
  let lines = collapseBlanks(cleaned.split("\n"));
  lines = dedupRuns(lines);
  let elided = 0;
  if (elide && lines.length > MAX_LINES_BEFORE_ELIDE) {
    elided = lines.length - HEAD_LINES - TAIL_LINES;
    const hint = `… 〈${elided} 行省略。全文は full=true、範囲は line_range="A:B"〉 …`;
    lines = [...lines.slice(0, HEAD_LINES), hint, ...lines.slice(lines.length - TAIL_LINES)];
  }
  if (elide) lines = elideLongLines(lines);
  const body = lines.join("\n");
  const meta =
    `[aiterm ${name}: ${lines.length} 行 / ~${estimateTokens(body)} tok ` +
    `(raw ${rawLinesN} 行 / ~${estimateTokens(raw)} tok)` +
    (elided ? `; ${elided} 行 hidden]` : "]");
  return [body, meta];
}

// ---------------------------------------------------------------- tmux 補助

function autoName(): string {
  const r = tmux("list-sessions", "-F", "#{session_name}");
  const existing = new Set(r.code === 0 ? r.stdout.split(/\s+/).filter(Boolean) : []);
  let i = 1;
  while (existing.has(`t${i}`)) i++;
  return `t${i}`;
}

// 衝突リトライ用の乱数名。線形 t{i} は高並行だと全員が同じ「最小の空き番号」を見て衝突し続ける
// （TOCTOU）ため、2回目以降は 1600万通りの nonce 名に切り替えてリトライ上限内で実質確実に確保する。
function nonceName(): string {
  return `t-${randomBytes(3).toString("hex")}`;
}

function captureScreen(name: string, lines: number): string {
  const args = ["capture-pane", "-p", "-J", "-t", name];
  if (lines) args.push("-S", `-${lines}`);
  const r = tmux(...args);
  return r.code === 0 ? r.stdout : "";
}



/** 完了境界: dead / mark sentinel 一致 / until 一致 / (出力静止 ∧ シェル復帰)=quiescent / (ネスト中＋until/mark無しで出力静止)=nested(未確定・早期返却) / timeout。 */
async function waitCompletion(
  name: string,
  untilStr: string | null,
  untilRegex: boolean,
  timeout: number,
): Promise<[boolean, string]> {
  // 締切は単調時計で測る。Date.now() は NTP 補正やサスペンドで巻き戻り、長時間待ちで誤判定する（Python は time.monotonic）。
  const deadline = performance.now() + timeout * 1000;
  const start = readOffset(name);
  let lastSize: number | null = null;
  let stable = 0;
  // until は既定でリテラル部分一致（`$ ` や `[sudo]` 等がメタ化して永遠に待つ footgun を避ける・B4）。
  // untilRegex:true のときだけ正規表現として解釈し、不正パターンは明示エラーにする（B13 の until 部分）。
  let until: ((s: string) => boolean) | null = null;
  if (untilStr) {
    if (untilRegex) {
      let re: RegExp;
      try {
        re = new RegExp(untilStr);
      } catch (e) {
        throw new AitermError(`until 正規表現が不正です: ${JSON.stringify(untilStr)}（${(e as Error).message}）`, 2);
      }
      until = (s) => re.test(s);
    } else {
      until = (s) => s.includes(untilStr);
    }
  }
  // mark:true 送信中なら sentinel 完了検出を有効化する。エコー（rc=%d）でなく実出力（rc=<数字>）だけに
  // 一致する数字アンカー MARK_DONE_RE を使うため、until のようにエコー部分一致で早期誤完了しない（B1）。
  const markActive = fs.existsSync(markpath(name));
  for (;;) {
    let size = 0;
    try {
      size = fs.statSync(logpath(name)).size;
    } catch {
      size = 0;
    }
    if ((until || markActive) && size > start) {
      // 増分 [start, size] だけを fd で読む（毎 poll で全ファイルを読む O(n^2) を避ける・B6）。
      let neu = "";
      let fd: number | undefined;
      try {
        fd = fs.openSync(logpath(name), "r");
        const len = size - start;
        const buf = Buffer.alloc(len);
        const n = fs.readSync(fd, buf, 0, len, start);
        neu = stripControl(buf.subarray(0, Math.max(0, n)).toString("utf8"));
      } catch {
        neu = ""; // close 等でログが消えた: 次周回の !alive/statSync で決着させる
      } finally {
        if (fd !== undefined) {
          try {
            fs.closeSync(fd);
          } catch {
            /* noop */
          }
        }
      }
      // mark を until より先に判定（sentinel は確証つき完了。until はユーザ指定でエコー誤爆余地あり）。
      if (markActive && MARK_DONE_RE.test(neu)) {
        try {
          fs.unlinkSync(markpath(name)); // 同一 sentinel での再発火を防ぐ
        } catch {
          /* noop */
        }
        await settlePaneLog(logpath(name), POLL);
        return [true, "mark"];
      }
      if (until && until(neu)) return [true, "until"];
    }
    // 出力が伸びている間は生存確認(tmux has-session の spawn)を省く＝伸長は生存の証（B6）。
    // 静止時のみ has-session を叩いて dead を判定する。dead 検出は最大 1 poll 遅れるだけ。
    const growing = lastSize !== null && size > lastSize;
    if (!growing && !sessionExists(name)) {
      await settlePaneLog(logpath(name), POLL);
      return [true, "dead"];
    }
    if (size === lastSize) {
      stable++;
      if (stable >= STABLE_POLLS) {
        const fg = paneCurrentCommand(name);
        // サイズ標本は過去・fg は今、の時間差 race を閉じる: fg 取得（サブプロセス spawn）の間に
        // 出力が伸びていたら「静止」は不成立として周回をやり直す。閉じないと、コマンド完了直後の
        // 出力＋シェル復帰が quiescent に誤帰属され、mark/until が帰属を取り損ねる
        // （macOS CI 実測: sleep 0.6 の mark 送信が via quiescent に化けた・B1 flake の根因）。
        // 次周回の先頭で新増分に対する mark/until 判定が走る。
        if (safeStatSize(logpath(name)) !== size) {
          stable = 0;
        } else if (!until && !markActive && SHELLS.has(fg)) {
          await settlePaneLog(logpath(name), POLL);
          return [true, "quiescent"]; // 出力静止 ∧ シェル復帰 ＝ 確証つき完了
        } else if (!until && !markActive && fg !== "") {
          // ネスト中（前面が ssh/docker/REPL 等でシェル集合外）は quiescence の「シェル復帰」条件を
          // 原理的に満たせない。until も mark も無ければこれ以上待っても確証は増えない（until/dead/
          // quiescent/mark のいずれも発火し得ない）ので、出力静止時点で「未確定」のまま早期返却する。
          // until/markActive のときは指定した証拠を待つべく早期返却せず、shell builtinや
          // 非シェル前面（sleep 等）でも待ち続ける。
          // fg==="" は前面コマンド取得失敗＝ネスト断定不可なので早期返却せず従来どおり timeout まで待つ。
          await settlePaneLog(logpath(name), POLL);
          return [false, "nested"];
        }
      }
    } else {
      stable = 0;
    }
    lastSize = size;
    if (performance.now() >= deadline) return [false, "timeout"];
    await sleep(POLL * 1000);
  }
}

// 完了ステータス → is_complete 表記。確証のある層のみ True（mark/until/dead/quiescent）。
// timeout と nested（ネスト中・出力静止だが確証なし）は False。nested は until/mark を促す注記を添える。
function completionSuffix(status: string): string {
  const complete =
    status === "mark" || status === "until" || status === "dead" || status === "quiescent";
  let s = ` [is_complete=${complete ? "True" : "False"} via ${status}]`;
  if (status === "nested")
    s +=
      " ネスト中（前面が ssh/docker/REPL 等）は出力静止だけでは完了を確定できません。" +
      "until（リモートのプロンプト等の正規表現）か mark:true で完了を指定してください。";
  return s;
}

function rtkRewrite(text: string): string {
  if (text.trim().includes("\n")) return text;
  // timeout 無しだと rtk がハングしたとき send() ごと凍結する。Python は timeout=5。不在は素通し。
  const r = spawnSync("rtk", ["rewrite", text], { encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 });
  if (r.error) return text; // rtk 不在（ENOENT）・タイムアウト（ETIMEDOUT）等は元テキストへ素通し
  if ((r.status === 0 || r.status === 3) && (r.stdout ?? "").trim()) return (r.stdout ?? "").replace(/\n+$/, "");
  return text;
}

// ---------------------------------------------------------------- 操作（return で返す / 失敗は AitermError）

// Windows native pane の既定 shell 解決。裸の "bash" は PATH 上で System32 の
// WSL launcher (bash.exe) に解決されてしまうため、Git for Windows の bash.exe を
// 明示解決する（WSL 非依存の裁定に従う）。AITERM_BASH で上書き可。

export function openSession(name?: string | null, shell = "bash", envVars: string[] = []): [string, string] {
  shell = resolveWinPaneShell(shell);
  for (const key of envVars) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new AitermError("env_varsの環境変数名が不正です", 2);
  }
  try {
    fs.mkdirSync(SOCKDIR, { recursive: true });
  } catch (error) {
    ownTelemetryFailure("AITERM.PERSISTENCE_WRITE_FAILED", error);
  }
  // macOS標準bashの移行bannerを抑止する。環境変数の注入方法はterminal runtimeが所有する。
  const banner =
    process.platform === "darwin" && path.basename(shell) === "bash"
      ? ["BASH_SILENCE_DEPRECATION_WARNING=1"]
      : [];
  // 並行性対策: 複数エージェントが同時に名前なし open すると autoName が同じ t{i} を返し得る（TOCTOU）。
  // 自動採番は初回のみ読みやすい t{i}、衝突したら乱数 nonce 名でリトライする（線形リトライは高並行で
  // 全員が同じ空き番号に殺到してスケールしない）。明示名は既存ならエラー（呼び手責任＝意図的共有と区別）。
  const explicit = !!name;
  let nm = name || autoName();
  assertSessionName(nm);
  for (let attempt = 0; ; attempt++) {
    if (attempt >= 20) throw new AitermError("openSession: 自動採番のリトライ上限（tmux new-session が重複以外で失敗し続けている可能性）", 2);
    if (sessionExists(nm)) {
      if (explicit) throw new AitermError(`session '${nm}' は既に存在します（list で確認）`, 2);
    } else {
      // -f は端末個人の設定ファイルを読まないための空 config。
      const environment = [...banner, ...envVars.filter(key => key !== "AITERM_SESSION_ID" && process.env[key] !== undefined)
        .map(key => `${key}=${process.env[key]}`), `AITERM_SESSION_ID=${nm}`];
      const launch = sessionEnvironmentLaunch(shell, environment);
      const r = tmux("new-session", "-d", "-s", nm, ...launch.args, "-f", TMUX_EMPTY_CONFIG, launch.shell);
      if (r.code === 0) {
        if (launch.register_after_start) for (const entry of environment) {
          const at = entry.indexOf("=");
          const registered = tmux("set-environment", "-t", nm, entry.slice(0, at), entry.slice(at + 1));
          if (registered.code !== 0) {
            tmux("kill-session", "-t", nm);
            throw new AitermError("session環境変数を登録できません", 2);
          }
        }
        break;
      }
      // 自動採番かつ「重複名」由来の失敗（他エージェントが同名を先に取った）なら次名でリトライ。
      const dup = /duplicate|already exists/i.test(r.stderr);
      if (explicit || !dup) throw new AitermError("tmux new-session 失敗: " + r.stderr.trim(), 2);
    }
    nm = nonceName();
    assertSessionName(nm);
  }
  // 新規セッションの .log は必ず truncate する。"a"（追記）だと外部 kill / killAll / クラッシュで
  // 同名 session だけ消えて .log が残った場合、offset=0 と相まって旧出力を新規として返す（B5）。
  // break は new-session 成功後にのみ到達＝作りたての空 session ゆえ切り詰めは安全。lastcmd/mark 残骸も掃除。
  try {
    fs.writeFileSync(logpath(nm), "");
  } catch (error) {
    ownTelemetryFailure("AITERM.PERSISTENCE_WRITE_FAILED", error);
  }
  for (const p of [lastcmdpath(nm), markpath(nm)]) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* noop */
    }
  }
  cleanupAgentState(nm);
  // pipe-pane の引数は tmux 内部の /bin/sh -c で再解釈される（argv ではない）。パスは単一引用符で包み、
  // パス自身の ' は '\'' イディオムでエスケープする（名前は検証済みだが、Windows ユーザー名 O'Brien 等が
  // 一時パスに ' を持ち込み redirect を壊すのを防ぐ。空白対策も兼ねる）。
  // Windows の psmux は `cat > <path>` を in-process の直接ファイルsinkとして処理する
  // （psmux e3e4b71 以降）。パスは Windows 形のまま渡す。
  const pipeTarget = logpath(nm);
  const quoted = `'${pipeTarget.replace(/'/g, "'\\''")}'`;
  const pr = tmux("pipe-pane", "-t", nm, "-o", `cat >> ${quoted}`);
  if (pr.code !== 0) {
    // 配管に失敗した session は pty_read が永遠に空を返す＝成功を装わない。作った session を片付けて明示エラー。
    try { tmuxCleanup("kill-session", "-t", nm); } catch { /* cleanup failure is not a second observation */ }
    try {
      fs.unlinkSync(logpath(nm)); // B14: 直前に作った空 .log も残さない
    } catch {
      /* noop */
    }
    ownTelemetryFailure(
      "AITERM.PERSISTENCE_WRITE_FAILED",
      new AitermError("tmux pipe-pane 失敗（出力ログを配管できないため session を破棄）: " + pr.stderr.trim(), 2),
      2,
    );
  }
  try {
    writeOffset(nm, 0);
  } catch (error) {
    ownTelemetryFailure("AITERM.PERSISTENCE_WRITE_FAILED", error);
  }
  return [nm, attachHint(nm)];
}

export interface SendOpts {
  enter?: boolean;
  mark?: boolean;
  force?: boolean;
  rtk?: boolean;
  raw?: boolean;
  /** agent operation markerを保つ内部送信境界。MCPの公開引数にはしない。 */
  preserveAgentOperation?: boolean;
  /**
   * POSIX tmuxはpaste-buffer -pのpane negotiation、Windows psmuxはready gate通過済み
   * agent TUIへの明示ESC[200~/201~ wrapperで原子化する。
   * agent TUI への prompt 投入専用: TUI が paste を原子的に扱い、チャンク境界での
   * キー解釈（文字化け・Enter 取り落とし）を抑える。通常シェル送信の行単位実行の
   * 挙動を変えないため、公開引数にはせず agent dispatch 経路だけが立てる。
   */
  bracketedPaste?: boolean;
}

function prepareSendText(text: string, o: Pick<SendOpts, "raw">): string {
  if (!o.raw) text = text.replace(PASTE_MARKERS_RE, "").replace(ANSI_RE, "").replace(CTRL_RE, "");
  assertSendTextSize(text);
  return text;
}

export function send(name: string, text: string, o: SendOpts = {}): string {
  assertSessionName(name);
  const enter = o.enter ?? true;
  if (!sessionExists(name)) throw new AitermError(`session '${name}' が無い（open してください）`, 2);
  assertInitialPromptNotPendingForSend(name, !!o.force);
  text = prepareSendText(text, o);
  let fg = "";
  if (o.mark) {
    // mark の sentinel は POSIX シェル構文。前面が fish/csh/tcsh 等の非 POSIX 対話シェルだと "$?" が
    // 壊れて sentinel が成立しない。黙って壊れた完了検出を作らず、明示エラーで until を促す（B8）。
    fg = paneCurrentCommandForMark(name);
    if (NON_POSIX_MARK_SHELLS.has(fg)) {
      throw new AitermError(
        `mark は POSIX シェル(bash/sh/zsh/dash)前提です。前面が ${fg} のため sentinel の "$?" が` +
          `正しく展開されません。until で完了パターンを指定してください。`,
        2,
      );
    }
  }
  const releaseSendLock = acquireSessionSendFileLock(name);
  try {
    // managed Claudeの通常送信は、lastcmd/mark/PTYのどれにも触れる前に拒否する。
    // 拒否した呼び出しが古いmarkを消したり偽のmarkを残すと、後続readが存在しない
    // sentinelを待つため、公開上の拒否は副作用ゼロでなければならない。
    if (!o.preserveAgentOperation && managedClaudeOperation(name) !== undefined) {
      throw new AitermError(
        "aiterm相関付きClaude agent sessionへの通常送信はturn境界を失うため拒否します。" +
          "pty_send（forceなし＝自動dispatch）を使うか、通常対話へ切り替えるならsessionをcloseしてpty_openから手動起動し直してください。",
        2,
      );
    }
    writeLastcmd(name, text); // read rtk の reducer 分類用（書換/mark 前の素のコマンド）
    if (o.rtk) text = rtkRewrite(text);
    if (o.mark) text = appendMarkSentinel(text, fg);
    assertSendTextSize(text, o.rtk || o.mark ? "変換後の送信文字列" : "送信文字列");
    const reportedText = text;
    if (!o.raw && text.includes("\n") && ATOMIC_MULTILINE_SHELLS.has(paneCurrentCommand(name))) {
      text = atomicShellMultiline(text);
    }
    if (o.mark) {
      try {
        fs.writeFileSync(markpath(name), "1"); // waitCompletion に sentinel 完了検出を有効化させる
      } catch {
        /* noop（フラグ書けなくても until/quiescence 経路は生きる） */
      }
    } else {
      // 非 mark 送信は、未消化の古い mark 完了待ちを無効化する（前コマンドの sentinel を待ち続けない）。
      try {
        fs.unlinkSync(markpath(name));
      } catch {
        /* noop */
      }
    }
    // POSIX tmuxはUTF-8安全な256byte pasteへ分割する。Windows psmuxは認証済み
    // server commandでpayload全体を単一SendBytesへ変換し、別processとの交差を構造的に防ぐ。
    if (isWin) {
      const sent = sendPsmuxPayload(true, name, text, !!o.bracketedPaste);
      if (sent.code !== 0) {
        throw new AitermError(
          `psmuxのPTY送信に失敗しました: ${sent.stderr.trim() || `code=${sent.code}`}`,
          2,
        );
      }
    } else {
      const chunks = splitPtyText(text);
      const pasteSupportsNoSanitize = pasteBufferSupportsNoSanitizeFlag();
      const bufferBase = `aiterm-${process.pid}-${randomBytes(8).toString("hex")}`;
      for (let i = 0; i < chunks.length; i += 1) {
        const bufferName = `${bufferBase}-${i}`;
        const partial =
          i > 0
            ? " 先行chunkはPTYに入力済みでEnterは未送信です。再送前に入力を確認・消去してください。"
            : "";
        const loaded = loadPtyBufferChunk(true, bufferName, chunks[i]);
        if (loaded.code !== 0) {
          tmuxCleanup("delete-buffer", "-b", bufferName);
          throw new AitermError(
            `tmux bufferへの送信準備に失敗しました` +
              `（chunk ${i + 1}/${chunks.length}）: ${loaded.stderr.trim() || `code=${loaded.code}`}.${partial}`,
            2,
          );
        }
        const pasteArgs = pasteBufferBaseArgs();
        if (o.bracketedPaste) pasteArgs.push("-p");
        if (pasteSupportsNoSanitize) pasteArgs.push("-S");
        pasteArgs.push("-b", bufferName, "-t", name);
        const pasted = tmux(...pasteArgs);
        if (pasted.code !== 0) {
          tmuxCleanup("delete-buffer", "-b", bufferName);
          throw new AitermError(
            `tmux bufferのPTY送信に失敗しました` +
              `（chunk ${i + 1}/${chunks.length}）: ${pasted.stderr.trim() || `code=${pasted.code}`}.${partial}`,
            2,
          );
        }
        if (i + 1 < chunks.length) {
          Atomics.wait(PTY_PASTE_PAUSE_BUFFER, 0, 0, PTY_PASTE_CHUNK_PAUSE_MS);
        }
      }
    }
    if (enter) {
      const entered = tmux("send-keys", "-t", name, "Enter");
      if (entered.code !== 0) {
        throw new AitermError(
          `文字列はPTYに入力済みですがtmuxへEnterを送れませんでした: ` +
            `${entered.stderr.trim() || `code=${entered.code}`}。再送前に入力を確認・消去してください`,
          2,
        );
      }
    }
    // コードポイント数で数える（JS の .length は UTF-16 単位で絵文字等がズレる。Python は len()=コードポイント）。
    return `sent ${[...reportedText].length} chars to ${name}` + (enter ? " (+Enter)" : "");
  } finally {
    releaseSendLock();
  }
}

export function sendKey(name: string, key: string, o: { preserveAgentOperation?: boolean } = {}): string {
  assertSessionName(name);
  if (!sessionExists(name)) throw new AitermError(`session '${name}' が無い`, 2);
  const k = KEYMAP[key.toLowerCase()] ?? key;
  if (!o.preserveAgentOperation && managedClaudeOperation(name) !== undefined && k !== "C-c") {
    throw new AitermError(
      "aiterm相関付きClaude agent sessionではturn相関を壊さないC-cだけをpty_keyで送れます。" +
        "他の対話操作はpty_send（自動dispatch）、終了はpty_closeを使ってください。",
      2,
    );
  }
  const meta = tryLoadAgentMetadata(name);
  if (meta?.kind === "cursor" && k === "Enter") {
    send(name, CURSOR_SUBMIT_SEQUENCE, {
      enter: false,
      force: true,
      raw: true,
      preserveAgentOperation: o.preserveAgentOperation,
    });
    return `sent key ${k} to ${name}`;
  }
  tmux("send-keys", "-t", name, k);
  return `sent key ${k} to ${name}`;
}

export interface ReadOpts {
  wait?: boolean;
  until?: string | null;
  untilRegex?: boolean; // until を正規表現として扱う（既定 false＝リテラル部分一致）。B4。
  timeout?: number;
  screen?: boolean;
  full?: boolean;
  lines?: number | null;
  range?: [number, number | null] | null;
  raw?: boolean;
  rtk?: boolean;
}

// end 以下で最大の UTF-8 文字境界を返す（B3）。末尾が不完全なマルチバイト列なら、その開始位置まで
// 戻す。pipe-pane が多バイト文字の途中でフラッシュした瞬間の増分読みで先頭/末尾が U+FFFD 化するのを防ぐ。
export function utf8SafeEnd(buf: Buffer, end: number): number {
  if (end <= 0) return 0;
  const isCont = (b: number) => (b & 0xc0) === 0x80; // 継続バイト 10xxxxxx
  let i = end - 1;
  let steps = 0;
  while (i >= 0 && isCont(buf[i]) && steps < 3) {
    i--;
    steps++;
  }
  if (i < 0) return end; // 継続バイトのみの異常列: そのまま
  const lead = buf[i];
  let need: number;
  if (lead < 0x80) need = 1;
  else if ((lead & 0xe0) === 0xc0) need = 2;
  else if ((lead & 0xf0) === 0xe0) need = 3;
  else if ((lead & 0xf8) === 0xf0) need = 4;
  else return end; // 不正な先行バイト: そのまま（stripControl 等に委ねる）
  return end - i >= need ? end : i; // 末尾文字が完結していれば end、不完全なら開始位置まで戻す
}

/** 途中 offset から読んだ Buffer の先頭にある UTF-8 継続バイトを最大3バイト捨てる。 */
export function utf8SafeSliceStart(buf: Buffer): Buffer {
  let start = 0;
  while (start < buf.length && start < 3 && (buf[start] & 0xc0) === 0x80) start++;
  return buf.subarray(start);
}

export async function readOutput(name: string, o: ReadOpts = {}): Promise<string> {
  assertSessionName(name);
  const timeout = o.timeout ?? DEFAULT_TIMEOUT;
  if (!sessionExists(name) && !fs.existsSync(logpath(name))) throw new AitermError(`session '${name}' が無い`, 2);

  // wait は screen より先に処理する。従来 screen は wait ブロックの手前で return し、screen+wait で
  // 完了検出が黙殺されていた（B11）。先に待ってから最終スクリーンを撮る＝TUI の描画完了後に読める。
  let status: string | null = null;
  if (o.wait) {
    const [, st] = await waitCompletion(name, o.until ?? null, o.untilRegex ?? false, timeout);
    status = st;
  }

  if (o.screen) {
    const rawTxt = captureScreen(name, o.lines || 0);
    if (o.raw) return rawTxt;
    const [body, meta] = reduceOutput(rawTxt, name, true);
    return body + "\n" + meta + agentReadMetadataSuffix(name, rawTxt) + (status ? completionSuffix(status) : "");
  }

  // ログ全体を毎回メモリに載せず、必要な範囲だけ fd で読む（B7）。size は statSync で取る。
  let size = 0;
  try {
    size = fs.statSync(logpath(name)).size;
  } catch {
    size = 0;
  }
  const readRange = (from: number, to: number): Buffer => {
    const len = Math.max(0, to - from);
    if (len === 0) return Buffer.alloc(0);
    let fd: number | undefined;
    try {
      fd = fs.openSync(logpath(name), "r");
      const buf = Buffer.alloc(len);
      const n = fs.readSync(fd, buf, 0, len, from);
      return n === len ? buf : buf.subarray(0, Math.max(0, n));
    } catch {
      return Buffer.alloc(0);
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* noop */
        }
      }
    }
  };

  let text: string;
  let nextOffset = size; // 既定/full は offset を末尾へ
  if (o.full || o.range) {
    // full/range は全体が対象だが、巨大ログは末尾 MAX_FULL_BYTES に制限してメモリを守る（B7）。
    let from = 0;
    if (size > MAX_FULL_BYTES) from = size - MAX_FULL_BYTES;
    text = utf8SafeSliceStart(readRange(from, size)).toString("utf8");
    if (from > 0) text = `[… 先頭 ${from} バイトを省略（ログがサイズ上限を超過。close で破棄されます）…]\n` + text;
    if (o.range) {
      const [lo, hi] = o.range;
      text = text.split("\n").slice(lo, hi ?? undefined).join("\n");
    } else if (o.lines) {
      // full + lines は末尾 N 行にする（従来は full 経路で lines を黙殺していた footgun・B11）。
      text = text.split("\n").slice(-o.lines).join("\n");
    }
  } else {
    let off = readOffset(name);
    // psmux server 再起動等でログが作り直されると、残った旧 offset が新ログ長を超え、
    // 空を返して「何も読めない」状態になる。末尾越えは先頭から読み直す（POSIX では no-op）。
    if (off > size) off = 0;
    const initial = readRange(off, size); // 増分のみをメモリに載せる
    const buf = utf8SafeSliceStart(initial);
    // 先頭の継続バイトは捨て、末尾の不完全マルチバイト列は次回へ持ち越す（B3）。
    const safeLen = utf8SafeEnd(buf, buf.length);
    text = buf.subarray(0, safeLen).toString("utf8");
    nextOffset = off + (initial.length - buf.length) + safeLen;
    if (o.lines) text = text.split("\n").slice(-o.lines).join("\n");
  }

  if (!o.range) writeOffset(name, nextOffset);

  if (o.raw) return text.endsWith("\n") ? text : text + "\n";

  if (o.rtk) {
    // コマンド別 reducer（自前移植）を観測出力へ適用
    const cmd = readLastcmd(name);
    if (cmd.trim()) {
      const framed = rtk.stripShellFrame(stripControl(text), cmd);
      const [reduced, rname] = rtk.reduce(cmd, framed);
      if (reduced !== null) {
        const meta = `[aiterm ${name}: rtk:${rname} 適用 / ~${estimateTokens(reduced)} tok (raw ~${estimateTokens(text)} tok)]`;
        const agentMeta = agentReadMetadataSuffix(name);
        if (status) return reduced + "\n" + meta + agentMeta + completionSuffix(status);
        return reduced + "\n" + meta + agentMeta;
      }
    }
    // reducer 非該当 → 汎用削減へフォールバック
  }

  const [body, meta] = reduceOutput(text, name, !o.range);
  const agentMeta = agentReadMetadataSuffix(name);
  if (status) return body + "\n" + meta + agentMeta + completionSuffix(status);
  return body + "\n" + meta + agentMeta;
}

export interface ListedSession {
  session_id: string;
  current_command: string;
  attached: boolean;
  width: number;
  height: number;
  harness: AgentHarness | null;
  environment: Record<string, string | null>;
}

interface ActivitySample {
  session_id: string;
  pane_identity: string;
  screen_digest: string;
  processes: Record<string, number>;
  background_processes: Record<string, number>;
}

export interface SessionObservation {
  schema: "aiterm.pty-observe-result.v1";
  session_id: string;
  observed_at: string;
  exists: boolean;
  harness: AgentHarness | null;
  launch_id: string | null;
  state: "busy" | "idle" | "blocked" | "dead" | "missing" | "unknown";
  reason: string;
  pane_alive: boolean | null;
  harness_alive: boolean | null;
  pane_process: NativeProcessIdentity | null;
  harness_process: NativeProcessIdentity | null;
  process_identity: NativeProcessIdentity | null;
  token_hint: number | null;
  activity: {
    cursor: string | null;
    output_changed: boolean | null;
    cpu_seconds: number | null;
    cpu_delta_seconds: number | null;
    cpu_delta_complete: boolean | null;
    background_cpu_seconds: number | null;
    background_cpu_delta_seconds: number | null;
    background_cpu_delta_complete: boolean | null;
  };
}

function decodeActivityCursor(cursor: string, name: string): ActivitySample {
  let value: any;
  try { value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); }
  catch { throw new AitermError("活動観測cursorを読めません", 2); }
  if (value?.session_id !== name || typeof value.pane_identity !== "string"
    || typeof value.screen_digest !== "string" || !value.processes || typeof value.processes !== "object"
    || Array.isArray(value.processes) || !Object.values(value.processes).every(cpu => typeof cpu === "number" && Number.isFinite(cpu) && cpu >= 0)
    || !value.background_processes || typeof value.background_processes !== "object" || Array.isArray(value.background_processes)
    || !Object.values(value.background_processes).every(cpu => typeof cpu === "number" && Number.isFinite(cpu) && cpu >= 0))
    throw new AitermError("活動観測cursorが対象sessionの形式と一致しません", 2);
  return value;
}

function selectHarnessProcesses(meta: AgentMetadata, rows: RuntimeProcess[], subtree: RuntimeProcess[]): RuntimeProcess[] {
  const matches = (row: RuntimeProcess): boolean => {
    const first = /^(?:"([^"]+)"|(\S+))/.exec(row.command);
    const executable = path.posix.basename((first?.[1] ?? first?.[2] ?? "").replace(/\\/g, "/"))
      .replace(/\.exe$/i, "").replace(/^-/, "").toLowerCase();
    const command = row.command.replace(/\\/g, "/").replace(/\.exe(?=["\s]|$)/gi, "").replace(/"/g, "");
    const tokens = row.command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    const argument = tokens[1]?.replace(/^["']|["']$/g, "").replace(/\\/g, "/");
    const launchedScript = meta.agent_executable !== undefined && argument === meta.agent_executable.replace(/\\/g, "/");
    return launchedScript || (!SHELLS.has(executable) && executable !== "pwsh" && AGENT_COMMAND_PATTERNS[meta.kind].test(command));
  };
  // WindowsのMSYS execでnative親子関係が切れる場合も、launch固有引数で相関する。
  const correlated = rows.filter(row => matches(row) && row.command.includes(meta.launch_id));
  const candidates = correlated.length ? correlated : subtree.filter(matches);
  const roots = candidates.filter(row => !candidates.some(parent => row.parent_pid === parent.pid));
  return roots;
}

export function observeSession(name: string, cursor?: string): SessionObservation {
  assertSessionName(name);
  const previous = cursor === undefined ? null : decodeActivityCursor(cursor, name);
  const listed = listSessionsResult().sessions.find(session => session.session_id === name);
  const result: SessionObservation = {
    schema: "aiterm.pty-observe-result.v1", session_id: name, observed_at: new Date().toISOString(),
    exists: !!listed, harness: null, launch_id: null, state: "missing", reason: "session_missing",
    pane_alive: false, harness_alive: null, pane_process: null, harness_process: null, process_identity: null,
    token_hint: null,
    activity: { cursor: null, output_changed: null, cpu_seconds: null, cpu_delta_seconds: null, cpu_delta_complete: null,
      background_cpu_seconds: null, background_cpu_delta_seconds: null, background_cpu_delta_complete: null },
  };
  if (!listed) return result;
  const pane = tmux("display-message", "-p", "-t", name, "#{pane_pid}\t#{pane_dead}");
  if (pane.code !== 0) throw new AitermError("paneの生存情報を取得できません", 2);
  const [pidText, dead] = pane.stdout.trim().split("\t");
  const panePid = Number(pidText);
  if (!Number.isSafeInteger(panePid) || panePid < 1 || !["0", "1"].includes(dead))
    throw new AitermError("paneの生存情報の形式を認識できません", 2);
  const meta = tryLoadAgentMetadata(name);
  result.harness = meta ? agentHarness(meta.kind) : null;
  result.launch_id = meta?.launch_id ?? null;
  if (dead === "1") {
    result.state = "dead"; result.reason = "pane_dead"; result.harness_alive = meta ? false : null;
    return result;
  }
  const rows = readRuntimeProcesses();
  const root = rows.find(row => row.pid === panePid);
  result.pane_alive = root ? true : null;
  result.state = "unknown"; result.reason = root ? "ordinary_pty" : "native_pane_process_unresolved";
  if (!root) return result;
  result.pane_process = processIdentity(root);
  const subtree = processSubtree(rows, root.pid);
  const candidates = meta ? selectHarnessProcesses(meta, rows, subtree) : [];
  const agent = candidates.length === 1 ? candidates[0] : null;
  if (meta) {
    result.harness_process = agent ? processIdentity(agent) : null;
    // Cursorにはlaunch固有argvがない。Windowsの切れた親子関係だけで死亡を断定しない。
    result.harness_alive = candidates.length ? true : isWin && meta.kind === "cursor" ? null : false;
    if (result.harness_alive === false) { result.state = "dead"; result.reason = "harness_exited"; }
    else if (result.harness_alive === null) result.reason = "harness_process_unresolved";
    else if (!agent) result.reason = "harness_process_ambiguous";
    result.process_identity = result.harness_process;
  } else {
    const leaders = subtree.filter(row => row.parent_pid === root.pid && (isWin || row.process_group_id === row.pid));
    result.process_identity = leaders.length > 1 ? null : processIdentity(leaders[0] ?? root);
    if (leaders.length > 1) result.reason = "process_identity_ambiguous";
  }
  const captured = tmux("capture-pane", "-p", "-J", "-t", name, "-S", "-200");
  if (captured.code !== 0) throw new AitermError("paneの活動観測を取得できません", 2);
  const screen = captured.stdout;
  result.token_hint = meta ? paneTokenHint(screen) : null;
  if (meta && agent) {
    const observation = meta.kind === "grok" || meta.kind === "composer" ? grokPaneObservation(screen)
      : meta.kind === "codex" ? codexPaneObservation(screen)
      : meta.kind === "claude" ? claudePaneObservation(screen) : cursorPaneObservation(screen);
    result.state = observation.state; result.reason = observation.reason;
    if (agent.stopped === true || processSubtree(rows, agent.pid).some(row =>
      row.process_group_id === agent.process_group_id && row.stopped === true)) {
      result.state = "blocked"; result.reason = "harness_stopped";
    }
  }
  const activityRows = agent && !subtree.some(row => row.pid === agent.pid)
    ? [...subtree, ...processSubtree(rows, agent.pid)] : subtree;
  const processes = Object.fromEntries(activityRows.map(row => [`${row.pid}:${row.started_identity}`, row.cpu_seconds]));
  const backgroundCpu = Object.fromEntries(backgroundProcesses(activityRows, root)
    .map(row => [`${row.pid}:${row.started_identity}`, row.cpu_seconds]));
  const sample: ActivitySample = {
    session_id: name, pane_identity: `${root.pid}:${root.started_identity}`,
    screen_digest: createHash("sha256").update(screen).digest("hex"), processes, background_processes: backgroundCpu,
  };
  const comparable = previous?.pane_identity === sample.pane_identity;
  result.activity = {
    cursor: Buffer.from(JSON.stringify(sample)).toString("base64url"),
    output_changed: comparable ? previous.screen_digest !== sample.screen_digest : null,
    cpu_seconds: Object.values(processes).reduce((sum, cpu) => sum + cpu, 0),
    cpu_delta_seconds: comparable ? Object.entries(processes).reduce((sum, [identity, cpu]) => sum + cpu - (previous.processes[identity] ?? 0), 0) : null,
    cpu_delta_complete: comparable ? Object.keys(previous.processes).every(identity => identity in processes) : null,
    background_cpu_seconds: Object.values(backgroundCpu).reduce((sum, cpu) => sum + cpu, 0),
    background_cpu_delta_seconds: comparable ? Object.entries(backgroundCpu).reduce((sum, [identity, cpu]) => sum + cpu - (previous.background_processes[identity] ?? 0), 0) : null,
    background_cpu_delta_complete: comparable ? Object.keys(previous.background_processes).every(identity => identity in backgroundCpu) : null,
  };
  return result;
}

export function listSessionsResult(envKeys: string[] = []): {
  schema: "aiterm.pty-list-result.v1"; observed_at: string; sessions: ListedSession[];
} {
  for (const key of envKeys) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new AitermError("env_keysの環境変数名が不正です", 2);
  }
  const r = tmux("list-sessions", "-F", "#{session_name}\t#{pane_current_command}\t#{session_attached}\t#{window_width}\t#{window_height}");
  const sessions: ListedSession[] = [];
  if (r.code !== 0 && !/no server running|No such file or directory/i.test(r.stderr))
    throw new AitermError("セッション一覧を取得できません: " + r.stderr.trim(), 2);
  if (r.code === 0) for (const line of r.stdout.trim().split("\n").filter(Boolean)) {
    const [name, command, attached, width, height] = line.split("\t");
    assertSessionName(name);
    const environment: Record<string, string | null> = {};
    for (const key of envKeys) {
      const value = tmux("show-environment", "-t", name, key);
      if (value.code !== 0 && !/unknown variable|not found|not set/i.test(value.stderr))
        throw new AitermError("session環境変数を照会できません", 2);
      // psmuxは指定以外の内部キーも出すため、要求されたキーと完全一致した行だけを返す。
      const selected = value.stdout.split(/\r?\n/).find(entry => entry.startsWith(`${key}=`));
      environment[key] = selected === undefined ? null : selected.slice(key.length + 1);
    }
    const meta = tryLoadAgentMetadata(name);
    sessions.push({ session_id: name, current_command: normalizePaneCommand(command), attached: Number(attached) > 0,
      width: Number(width), height: Number(height), harness: meta ? agentHarness(meta.kind) : null, environment });
  }
  return { schema: "aiterm.pty-list-result.v1", observed_at: new Date().toISOString(), sessions };
}

export function listSessions(result = listSessionsResult()): string {
  if (result.sessions.length) {
    return result.sessions
      .map((session) => {
        const name = session.session_id;
        const line = `${name}\t${session.current_command}\t${session.attached ? "attached" : "detached"}\t${session.width}x${session.height}`;
        const meta = tryLoadAgentMetadata(name);
        if (!meta) return line;
        const agent = [
          `agent=${meta.kind}`,
          `harness=${agentHarness(meta.kind)}`,
          "agent_done=true",
          meta.write_scope === undefined ? null : `write_scope=${JSON.stringify(meta.write_scope)}`,
          meta.vendor_session_id ? `vendor_session_id=${meta.vendor_session_id}` : null,
        ]
          .filter(Boolean)
          .join(" ");
        return `${line}\t${agent}`;
      })
      .join("\n");
  }
  return "(セッション無し)";
}

// factory diagnostics 用の安全な状態語彙。通常の未設定と、状態を安全に確定できない失敗を混同しない。
export type DiagnosticStatus = "ready" | "not_applicable" | "unverified";

/**
 * `pty_list` 相当を read-only に照会し、内容を返さず session 件数だけを返す。
 * session 名・前面コマンド・PTY 出力を診断応答へ持ち出さないため、factory が安全に readiness を
 * 見られる。socket 不在は「セッション未設定」であって障害ではない。
 */
export function readOnlyPtyListDiagnostic(runTmux = tmux): { status: DiagnosticStatus; session_count: number | null } {
  try {
    const r = runTmux("list-sessions", "-F", "#{session_name}");
    if (r.code === 0) {
      return { status: "ready", session_count: r.stdout.split(/\r?\n/).filter(Boolean).length };
    }
    // tmux は専用 socket に server がいない通常状態を exit 1 で返す。その他の失敗を「空」と
    // 偽装しないため、メッセージを公開せず unverified に留める。
    if (/no server running|failed to connect/i.test(r.stderr)) {
      return { status: "not_applicable", session_count: null };
    }
  } catch {
    // tmux/psmux 未導入等。絶対 path や生 stderr を診断 JSON に出さない。
  }
  return { status: "unverified", session_count: null };
}

function closeSessionInternal(name: string, observeDependency = true): string {
  assertSessionName(name);
  {
    // 別プロセスの待機は in-memory Set に映らない。生きた file lock があれば close で state を消さない
    const foreign = liveWaitLocks(name);
    if (foreign.length > 0) {
      const d = foreign[0];
      throw new AitermError(
        `agent session '${name}' は別プロセス${d.pid != null ? `（pid ${d.pid}）` : ""}の agent_done 待機中のため close できません`,
        2,
      );
    }
  }
  {
    const sending = liveSendLocks(name);
    if (sending.length > 0) {
      const d = sending[0];
      throw new AitermError(
        `session '${name}' は別プロセス${d.pid != null ? `（pid ${d.pid}）` : ""}の送信中のため close できません`,
        2,
      );
    }
  }
  (observeDependency ? tmux : tmuxCleanup)("kill-session", "-t", name);
  for (const p of [logpath(name), offsetpath(name), lastcmdpath(name), markpath(name), sendLockPath(name)]) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* noop */
    }
  }
  cleanupAgentState(name);
  return `closed ${name}`;
}

export function closeSession(name: string): string {
  return closeSessionInternal(name, true);
}

export type PtyCloseResult = {
  schema: "aiterm.pty-close-result.v1";
  session_id: string;
  outcome: "closed" | "already_closed";
};

/**
 * Durable caller向けのclose receipt。
 *
 * closeSessionInternalのidempotent cleanupは維持し、呼出時点でtmux sessionが
 * 存在したかだけを固定語彙で返す。MCP response loss後も同じsession IDで再試行すれば
 * already_closedとなり、close完了を文字列解析なしで確定できる。
 */
export function closeSessionResult(name: string): PtyCloseResult {
  assertSessionName(name);
  const existed = sessionExists(name);
  closeSessionInternal(name, true);
  return {
    schema: "aiterm.pty-close-result.v1",
    session_id: name,
    outcome: existed ? "closed" : "already_closed",
  };
}

export function killAll(): string {
  {
    // 別プロセスの待機（file lock が生きているもの）も巻き添えにしない
    const foreign = liveWaitLocks(null);
    if (foreign.length > 0) {
      const list = foreign.map((d) => `${d.session}${d.pid != null ? `(pid ${d.pid})` : ""}`).join(",");
      throw new AitermError(`agent_done 待機中の session があるため killAll できません: ${list}`, 2);
    }
  }
  {
    const sending = liveSendLocks(null);
    if (sending.length > 0) {
      const list = sending.map((d) => `${d.session}${d.pid != null ? `(pid ${d.pid})` : ""}`).join(",");
      throw new AitermError(`送信中の session があるため killAll できません: ${list}`, 2);
    }
  }
  tmux("kill-server");
  // B9: SOCKDIR 内の .log/.offset/.lastcmd/.mark/.send.lock 残骸も掃除する。
  try {
    for (const f of fs.readdirSync(SOCKDIR)) {
      if (/\.(log|offset|lastcmd|mark)$/.test(f) || f.endsWith(".send.lock")) {
        try {
          fs.unlinkSync(path.join(SOCKDIR, f));
        } catch {
          /* noop */
        }
      }
    }
  } catch {
    /* SOCKDIR 不在等は無視 */
  }
  const adir = existingAgentsDir();
  if (adir) {
    try {
      for (const f of fs.readdirSync(adir)) {
        if (
          f.endsWith(".agent.json") ||
          f.endsWith(".events.jsonl") ||
          f.endsWith(".wait.lock") ||
          f.endsWith(".claude-settings.json") ||
          f.endsWith(".claude-mcp.json") ||
          f.endsWith(".claude-result.json") ||
          f.endsWith(".claude-operation.json") ||
          f.endsWith(".claude-dispatch") ||
          f.endsWith(".codex-home") ||
          f.endsWith(".grok-home") ||
          f.endsWith(".home")
        ) {
          try {
            fs.rmSync(path.join(adir, f), { recursive: true, force: true });
          } catch {
            /* noop */
          }
        }
      }
    } catch {
      /* agent state dir 不在等は無視 */
    }
  }
  agentMetadataNegativeCache.clear();
  return "killed all sessions on this socket";
}

// ── agent_done: harness の構造化完了記録を PTY 送信の完了境界として使う ────
interface AgentLineageSeed {
  parentSessionId: string;
  delegationDepth: number;
  lineagePrefix: string;
}

function readAgentLineageSeed(): AgentLineageSeed {
  const role = process.env.AITERM_AGENT_ROLE;
  const session = process.env.AITERM_AGENT_SESSION_ID;
  const depthRaw = process.env.AITERM_AGENT_DEPTH;
  const lineage = process.env.AITERM_AGENT_LINEAGE;
  const delegationAllowed = process.env.AITERM_AGENT_DELEGATION_ALLOWED;
  const nested = [role, session, depthRaw, lineage, delegationAllowed].some((value) => value !== undefined);
  if (!nested) {
    return { parentSessionId: "host-root", delegationDepth: 1, lineagePrefix: "host-root" };
  }
  if (
    role !== "subagent" ||
    delegationAllowed !== "true" ||
    !session ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(session) ||
    !depthRaw ||
    !/^\d+$/.test(depthRaw) ||
    !lineage ||
    lineage.length > 4096 ||
    !AGENT_LINEAGE_RE.test(lineage)
  ) {
    throw new AitermError("継承したAITERM sub-agent lineage環境が不正です", 2);
  }
  const parentDepth = Number(depthRaw);
  if (!Number.isSafeInteger(parentDepth) || parentDepth < 1 || parentDepth >= 1_000_000) {
    throw new AitermError("継承したAITERM_AGENT_DEPTHが不正です", 2);
  }
  return { parentSessionId: session, delegationDepth: parentDepth + 1, lineagePrefix: lineage };
}

function createAgentLineageContext(
  kind: AgentKind,
  sessionId: string,
  seed: AgentLineageSeed,
): AgentLineageContext {
  const lineage = `${seed.lineagePrefix}>${kind}:${sessionId}`;
  if (lineage.length > 4096 || !AGENT_LINEAGE_RE.test(lineage)) {
    throw new AitermError("AITERM sub-agent lineageが上限または形式に違反しました", 2);
  }
  return {
    agentRole: "subagent",
    parentSessionId: seed.parentSessionId,
    delegationDepth: seed.delegationDepth,
    lineage,
    delegationAllowed: true,
  };
}

interface ClaudeOperationMarker {
  operationId: string | null;
}

export interface ClaudeOperationResult {
  schema: "aiterm.claude-operation-result.v1";
  action: "issue" | "recover";
  status: "accepted" | "pending" | "completed" | "unknown";
  session_id: string;
  operation_id: string;
  raw_output: string | null;
  reason: "operation_not_found" | "result_unknown" | null;
  // issue時のみdispatch由来のsubmit座礁観測を載せる（recover等はnull）。falseは成立の保証ではない。
  submit_residue: boolean | null;
}

export type ClaudeApprovalDecision = "approve_once" | "deny";

export interface AgentApprovalResult {
  schema: "aiterm.agent-approval-result.v1";
  action: "inspect" | "respond";
  status: "none" | "approval_required" | "submitted" | "blocked";
  session_id: string;
  harness: AgentHarness;
  launch_id: string;
  reason: string;
  kind: string | null;
  prompt: string | null;
  prompt_digest: string | null;
  choices: { decision: ClaudeApprovalDecision; label: string }[];
  selected_choice: ClaudeApprovalDecision | null;
  at: string;
}

export function runAgentApproval(options: {
  action: "inspect" | "respond";
  session_id: string;
  approval_choice?: ClaudeApprovalDecision;
  observed_prompt_digest?: string;
}): AgentApprovalResult {
  const { action, session_id: name, approval_choice: selected, observed_prompt_digest: expected } = options;
  assertSessionName(name);
  if (action === "inspect" && (selected !== undefined || expected !== undefined))
    throw new AitermError("inspectでは承認選択とdigestを指定できません", 2);
  if (action === "respond" && (selected === undefined || expected === undefined))
    throw new AitermError("respondにはapproval_choiceとobserved_prompt_digestが必要です", 2);
  const release = action === "respond" ? acquireSessionSendFileLock(name) : () => {};
  try {
    const meta = loadAgentMetadata(name);
    const result: AgentApprovalResult = {
      schema: "aiterm.agent-approval-result.v1", action, status: "blocked", session_id: name,
      harness: agentHarness(meta.kind), launch_id: meta.launch_id, reason: "harness_unsupported",
      kind: null, prompt: null, prompt_digest: null, choices: [], selected_choice: null, at: new Date().toISOString(),
    };
    if (meta.kind !== "codex") return result;
    const captured = tmux("capture-pane", "-p", "-J", "-t", name, "-S", "-200");
    if (captured.code !== 0) throw new AitermError("現在の承認画面を取得できません", 2);
    const screen = captured.stdout;
    const state = codexPaneObservation(screen);
    const dialog = codexApprovalDialog(screen);
    if (!dialog) {
      result.status = state.state === "blocked" || state.state === "unknown" || action === "respond" ? "blocked" : "none";
      result.reason = state.state === "blocked" ? "unknown_dialog" : state.state === "unknown" ? "unrecognized_screen" : "no_current_dialog";
      return result;
    }
    result.kind = dialog.kind;
    result.prompt = dialog.prompt;
    result.prompt_digest = `sha256:${createHash("sha256").update(`${meta.launch_id}\n${dialog.canonical}`).digest("hex")}`;
    result.choices = dialog.choices.map(({ decision, label }) => ({ decision, label }));
    result.reason = "approval_required";
    result.status = "approval_required";
    if (dialog.selected_index === null || dialog.choices.length === 0) {
      result.status = "blocked"; result.reason = "unsupported_choices";
      return result;
    }
    if (action === "inspect") return result;
    if (expected !== result.prompt_digest) {
      result.status = "blocked"; result.reason = "dialog_changed";
      return result;
    }
    const choice = dialog.choices.find(entry => entry.decision === selected);
    if (!choice) { result.status = "blocked"; result.reason = "choice_unavailable"; return result; }
    const distance = choice.index - dialog.selected_index;
    const keys = [...Array(Math.abs(distance)).fill(distance > 0 ? "Down" : "Up"), "Enter"];
    const sent = tmux("send-keys", "-t", name, ...keys);
    if (sent.code !== 0) throw new AitermError("Codex承認入力を送れませんでした", 2);
    result.status = "submitted"; result.reason = "choice_submitted"; result.selected_choice = selected ?? null;
    return result;
  } finally { release(); }
}

export interface ClaudeApprovalChoice {
  decision: ClaudeApprovalDecision;
  index: number;
  label: string;
}

export interface ClaudeApprovalResult {
  schema: "aiterm.claude-approval-result.v1";
  action: "inspect" | "respond";
  status: "approval_required" | "submitted";
  session_id: string;
  operation_id: string | null;
  prompt_digest: string;
  choices: ClaudeApprovalChoice[];
  selected_choice: ClaudeApprovalDecision | null;
  at: string;
}

interface AgentDoneParseResult {
  event: AgentDoneEvent | null;
  malformed: boolean;
}

interface AgentDoneWaitResult {
  event: AgentDoneEvent | null;
  malformedEvents: number;
}

interface AgentDoneScanResult extends AgentDoneWaitResult {
  ambiguousHarnessSession: boolean;
}

interface AgentScreenSample {
  screen: string;
  logSize: number;
}

interface AgentScreenSettleResult {
  unstable: boolean;
  samples: number;
}

interface AgentTuiReadyWaitResult {
  ready: boolean;
  samples: number;
  lastScreen: string;
}


const DEFAULT_AGENT_DONE_TIMEOUT = 600;
const agentMetadataNegativeCache = new Map<string, number>();
let agentTuiReadyStableSamplesTestOverride: number | null = null;


function writeClaudeOperationMarker(meta: AgentMetadata, operationId: string | null): void {
  if (meta.kind !== "claude") throw new AitermError("operation_id はClaude agent sessionだけで使用できます", 2);
  writeJson0600(agentClaudeOperationPath(meta.aiterm_session, meta.launch_id), {
    schema: "aiterm.claude-operation-marker.v1",
    operation_id: operationId === null ? null : validateOperationId(operationId),
  });
}

function readClaudeOperationMarker(meta: AgentMetadata): ClaudeOperationMarker | null {
  if (meta.kind !== "claude") return null;
  const file = agentClaudeOperationPath(meta.aiterm_session, meta.launch_id);
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new AitermError(`Claude operation markerを確認できません: ${(error as Error).message}`, 2);
  }
  try {
    // parse する入力の上限だけ残す（owner・link 数・mode・O_NOFOLLOW の検査は撤去した）。
    const st = fs.fstatSync(fd);
    if (st.size > 1024) {
      throw new AitermError("Claude operation markerが大きすぎます", 2);
    }
    let value: any;
    try {
      value = JSON.parse(fs.readFileSync(fd, "utf8"));
    } catch {
      throw new AitermError("Claude operation markerを読めません", 2);
    }
    const keys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort() : [];
    if (
      keys.join(",") !== "operation_id,schema" ||
      value.schema !== "aiterm.claude-operation-marker.v1" ||
      (value.operation_id !== null &&
        (typeof value.operation_id !== "string" || !OPERATION_ID_RE.test(value.operation_id)))
    ) {
      throw new AitermError("Claude operation markerが不正です", 2);
    }
    return { operationId: value.operation_id };
  } finally {
    fs.closeSync(fd);
  }
}

function reserveClaudeOperation(meta: AgentMetadata, operationId: string): void {
  const validated = validateOperationId(operationId);
  const active = readClaudeOperationMarker(meta);
  if (active?.operationId === validated) {
    throw new AitermError(
      `operation ${validated} は既にdispatch済みです。再送しません。pty_read(agent_transcript:true, operation_id:...)で回収してください。`,
      2,
    );
  }
  if (active) {
    throw new AitermError(
      `${active.operationId ? `別のoperation ${active.operationId}` : "operation_idなしのClaude turn"} が未解決です。` +
        "Stop結果を回収するか、C-c後もStopが来なければsessionをcloseしてから次のoperationを送ってください。",
      2,
    );
  }
  const receipt = agentClaudeDispatchReceiptPath(meta.aiterm_session, meta.launch_id, validated);
  try {
    createEmpty0600(receipt);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // EEXIST 自体が「この operation は既に dispatch 済み」を意味する。
    // receipt の owner・link 数・mode・symlink 検査は撤去した（オーナー裁定 2026-08-19）。
    throw new AitermError(`operation ${validated} は既にdispatch済みです。再送しません。`, 2);
  }
  try {
    writeClaudeOperationMarker(meta, validated);
  } catch (error) {
    try { fs.unlinkSync(receipt); } catch { /* marker未作成時のrollback失敗は元エラーを優先 */ }
    throw error;
  }
}

function reserveAnonymousClaudeTurn(meta: AgentMetadata): void {
  const active = readClaudeOperationMarker(meta);
  if (active) {
    throw new AitermError(
      `${active.operationId ? `operation ${active.operationId}` : "operation_idなしのClaude turn"} が未解決です。` +
        "Stop結果を回収するかsessionをcloseするまで次のturnを送れません。",
      2,
    );
  }
  writeClaudeOperationMarker(meta, null);
}

function managedClaudeOperation(name: string): ClaudeOperationMarker | null | undefined {
  let meta: AgentMetadata;
  try {
    meta = loadAgentMetadata(name);
  } catch (error) {
    if (error instanceof AitermError && error.message.includes("agent_done 管理セッションではありません")) return undefined;
    throw error;
  }
  if (meta.kind !== "claude") return undefined;
  return readClaudeOperationMarker(meta);
}

function canonicalClaudeApprovalScreen(screen: string): string {
  return stripControl(screen)
    .split("\n")
    .map((line) => line.replace(/^\s*[❯>]\s*/, "").replace(/\s+$/, ""))
    .join("\n")
    .trim();
}

function parseClaudeApprovalScreen(screen: string): {
  promptDigest: string;
  choices: ClaudeApprovalChoice[];
} {
  const canonical = canonicalClaudeApprovalScreen(screen);
  const lines = canonical.split("\n");
  let question = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === "Do you want to proceed?") question = i;
  }
  if (question < 0) {
    throw new AitermError("aiterm相関付きClaudeの承認UIを現在画面で確認できません（Do you want to proceed? がありません）", 2);
  }

  const choices: ClaudeApprovalChoice[] = [];
  const seen = new Set<ClaudeApprovalDecision>();
  for (const line of lines.slice(question + 1)) {
    const match = line.trim().match(/^(\d+)\.\s+(.+?)\s*$/);
    if (!match) continue;
    const index = Number(match[1]);
    const label = match[2];
    const decision: ClaudeApprovalDecision | null = /^yes$/i.test(label)
      ? "approve_once"
      : /^no$/i.test(label)
        ? "deny"
        : null;
    // 「常に許可」等は意図的に公開しない。単発Yes/No以外を自動操作できる契約にしない。
    if (!decision) continue;
    if (!Number.isSafeInteger(index) || index < 1 || seen.has(decision)) {
      throw new AitermError("aiterm相関付きClaudeの承認UI選択肢が一意に解釈できません", 2);
    }
    seen.add(decision);
    choices.push({ decision, index, label });
  }
  if (!seen.has("approve_once") || !seen.has("deny")) {
    throw new AitermError("aiterm相関付きClaudeの承認UIに安全な単発Yes/No選択肢を確認できません", 2);
  }
  return {
    promptDigest: `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`,
    choices,
  };
}

function assertExpectedClaudeOperation(
  meta: AgentMetadata,
  expectedOperationId: string | null,
): ClaudeOperationMarker {
  const active = readClaudeOperationMarker(meta);
  if (!active) throw new AitermError("aiterm相関付きClaudeに未解決のactive operationがありません", 2);
  if (active.operationId !== expectedOperationId) {
    const actual = active.operationId ?? "operation_idなし";
    const expected = expectedOperationId ?? "operation_idなし";
    throw new AitermError(`active operationが一致しません（expected=${expected}, actual=${actual}）`, 2);
  }
  return active;
}

export function runClaudeApproval({
  action,
  session_id: name,
  operation_id: operationIdInput,
  approval_choice: approvalChoice,
  observed_prompt_digest: observedPromptDigest,
}: {
  action: "inspect" | "respond";
  session_id: string;
  operation_id?: string | null;
  approval_choice?: ClaudeApprovalDecision;
  observed_prompt_digest?: string;
}): ClaudeApprovalResult {
  assertSessionName(name);
  if (!sessionExists(name)) throw new AitermError(`session '${name}' が無い`, 2);
  const meta = loadAgentMetadata(name);
  if (meta.kind !== "claude") throw new AitermError("claude_approvalはaiterm相関付きClaude agent sessionだけで使用できます", 2);
  const operationId = operationIdInput == null ? null : validateOperationId(operationIdInput);

  if (action === "inspect") {
    if (approvalChoice != null || observedPromptDigest != null) {
      throw new AitermError("claude_approval inspectにapproval_choice／observed_prompt_digestは指定できません", 2);
    }
    assertExpectedClaudeOperation(meta, operationId);
    const observed = parseClaudeApprovalScreen(captureScreen(name, CLAUDE_APPROVAL_SCREEN_LINES));
    return {
      schema: "aiterm.claude-approval-result.v1",
      action,
      status: "approval_required",
      session_id: name,
      operation_id: operationId,
      prompt_digest: observed.promptDigest,
      choices: observed.choices,
      selected_choice: null,
      at: new Date().toISOString(),
    };
  }

  if (action !== "respond") throw new AitermError(`claude_approval actionが不正です: ${action}`, 2);
  if (approvalChoice == null || observedPromptDigest == null) {
    throw new AitermError("claude_approval respondにはapproval_choiceとobserved_prompt_digestが必要です", 2);
  }
  if (!OPERATION_ID_RE.test(observedPromptDigest)) {
    throw new AitermError("observed_prompt_digestはsha256:<64 lowercase hex>で指定してください", 2);
  }

  const releaseSendLock = acquireSessionSendFileLock(name);
  try {
    // inspect後にoperationまたは画面が変わっていないことを、入力と同じsend lock内で再検証する。
    assertExpectedClaudeOperation(meta, operationId);
    const observed = parseClaudeApprovalScreen(captureScreen(name, CLAUDE_APPROVAL_SCREEN_LINES));
    if (observed.promptDigest !== observedPromptDigest) {
      throw new AitermError("承認UIがinspect後に変化しました。再度inspectしてから判断してください", 2);
    }
    const choice = observed.choices.find((entry) => entry.decision === approvalChoice);
    if (!choice) throw new AitermError(`承認UIに${approvalChoice}の安全な選択肢がありません`, 2);
    const sent = tmux("send-keys", "-t", name, String(choice.index), "Enter");
    if (sent.code !== 0) {
      throw new AitermError(`Claude承認入力を送れませんでした: ${sent.stderr.trim() || `code=${sent.code}`}`, 2);
    }
    const at = new Date().toISOString();
    const result: ClaudeApprovalResult = {
      schema: "aiterm.claude-approval-result.v1",
      action,
      status: "submitted",
      session_id: name,
      operation_id: operationId,
      prompt_digest: observed.promptDigest,
      choices: observed.choices,
      selected_choice: approvalChoice,
      at,
    };
    // prompt本文は保存せず、相関ID・digest・選択だけをowner-only receiptへ残す。
    writeJson0600(agentClaudeApprovalReceiptPath(name, meta.launch_id), result);
    return result;
  } finally {
    releaseSendLock();
  }
}

function hasClaudeDispatchReceipt(meta: AgentMetadata, operationId: string): boolean {
  const file = agentClaudeDispatchReceiptPath(meta.aiterm_session, meta.launch_id, operationId);
  try {
    // receipt は createEmpty0600 が作る空ファイル。存在＝dispatch 済みで足りる。
    // owner・link 数・mode・symlink の検査は撤去した（オーナー裁定 2026-08-19）。
    return fs.statSync(file).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new AitermError(`Claude dispatch receiptを確認できません: ${(error as Error).message}`, 2);
  }
}

function normalizeInitialPromptState(v: unknown): InitialPromptState {
  if (v === true) return "pending";
  if (v === false || v == null) return "none";
  if (
    v === "none" ||
    v === "not_sent" ||
    v === "sent" ||
    v === "pending" ||
    v === "done" ||
    v === "failed"
  ) {
    return v;
  }
  return "none";
}

function setInitialPromptState(meta: AgentMetadata, state: InitialPromptState): void {
  meta.initial_prompt = state;
  writeAgentMetadata(meta);
}

// wait lock の鮮度猶予: lock は open(O_EXCL)→pid 書込みの2段なので、中身が読めない直後の lock を
// stale と誤判定しないための下限。これより古くて pid が読めない lock だけ残骸として回収する。
const WAIT_LOCK_FRESH_MS = 5_000;

interface WaitLockProbe {
  pid: number | null;
  at: string | null;
  live: boolean;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH=不在。EPERM 等の判定不能は生存扱い（誤回収より拒否に倒す）
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

// wait lock が「生きた待機」か「消滅プロセスの残骸」かを判定する。
// 前提: 呼び出し側は in-memory agentWaitLocks を先に確認している。よって pid=自プロセスの lock は
// 例外経路で release が漏れた残骸と確定できる。
function probeWaitLock(p: string): WaitLockProbe {
  let pid: number | null = null;
  let at: string | null = null;
  let ageMs = 0;
  try {
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.isSymbolicLink()) return { pid: null, at: null, live: true };
    ageMs = Math.max(0, Date.now() - st.mtimeMs);
    const v = JSON.parse(fs.readFileSync(p, "utf8").split("\n", 1)[0]) as { pid?: unknown; at?: unknown };
    if (typeof v.pid === "number" && Number.isInteger(v.pid) && v.pid > 0) pid = v.pid;
    if (typeof v.at === "string") at = v.at;
  } catch {
    /* pid 不明のまま鮮度判定に落ちる */
  }
  if (pid == null) return { pid: null, at, live: ageMs < WAIT_LOCK_FRESH_MS };
  if (pid === process.pid) return { pid, at, live: false };
  return { pid, at, live: isPidAlive(pid) };
}

function unlinkStaleWaitLock(p: string): void {
  try {
    const st = fs.lstatSync(p);
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    if (st.isFile() && !st.isSymbolicLink() && (uid == null || st.uid === uid)) fs.unlinkSync(p);
  } catch {
    /* noop */
  }
}

function liveSendLocks(name: string | null): Array<{ session: string; pid: number | null; at: string | null }> {
  let files: string[];
  try {
    files = fs.readdirSync(SOCKDIR);
  } catch {
    return [];
  }
  const out: Array<{ session: string; pid: number | null; at: string | null }> = [];
  for (const f of files) {
    if (!f.endsWith(".send.lock")) continue;
    const session = f.slice(0, -".send.lock".length);
    if (name != null && session !== name) continue;
    const p = path.join(SOCKDIR, f);
    const probe = probeWaitLock(p);
    if (probe.live) out.push({ session, pid: probe.pid, at: probe.at });
    // dead send lockはここでunlinkしない。probe後に別processが同pathへ新しいlive lockを作る
    // ABAが起きると、そのlive lockを消して二重owner化できる。close/killAllがsessionを止めた後に掃除する。
  }
  return out;
}

function acquireSessionSendFileLock(name: string): () => void {
  const p = sendLockPath(name);
  const token = randomBytes(16).toString("hex");
  const nofollow = (fs.constants as Record<string, number>).O_NOFOLLOW ?? 0;
  const deadline = Date.now() + SESSION_SEND_LOCK_WAIT_MS;
  let fd: number | null = null;
  let lastProbe: WaitLockProbe = { pid: null, at: null, live: true };
  while (fd == null) {
    try {
      fd = fs.openSync(p, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | nofollow, 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      lastProbe = probeWaitLock(p);
      if (!lastProbe.live) {
        const detail = lastProbe.pid != null ? `pid ${lastProbe.pid}` : "owner不明";
        throw new AitermError(
          `session '${name}' に前回送信のlock残骸があります（${detail}）。` +
            `自動回収は並行送信の混線を招くため行いません。` +
            `pty_listで対象を確認し、pty_closeでsessionを閉じてから同じIDで再作成してください`,
          2,
        );
      }
      if (Date.now() >= deadline) {
        const detail = lastProbe.pid != null ? `pid ${lastProbe.pid}` : "owner不明";
        throw new AitermError(
          `session '${name}' は別プロセスの送信中です（${detail}）。${SESSION_SEND_LOCK_WAIT_MS}ms待ってもlockを取得できませんでした`,
          2,
        );
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SESSION_SEND_LOCK_POLL_MS);
    }
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token }) + "\n", "utf8");
  } catch (error) {
    try {
      fs.closeSync(fd);
    } catch {
      /* noop */
    }
    // pathを再確認せずunlinkすると、外部置換後のlockを消し得る。書込失敗は残骸としてfail closedし、
    // close/killAllのsession停止後cleanupへ委ねる。
    throw error;
  }
  fs.closeSync(fd);
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* Windows等でmode強制できなくてもOS user temp境界とO_EXCLは維持される */
  }
  return () => {
    try {
      const st = fs.lstatSync(p);
      if (!st.isFile() || st.isSymbolicLink()) return;
      const current = JSON.parse(fs.readFileSync(p, "utf8").split("\n", 1)[0]) as { token?: unknown };
      if (current.token === token) fs.unlinkSync(p);
    } catch {
      /* 別ownerのlockや置換済みpathは消さない */
    }
  };
}

// close/killAll 用: 生きた別プロセス待機の wait lock を列挙する（stale 残骸は数えない）。
function liveWaitLocks(name: string | null): Array<{ session: string; pid: number | null; at: string | null }> {
  const dir = existingAgentsDir();
  if (!dir) return [];
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: Array<{ session: string; pid: number | null; at: string | null }> = [];
  for (const f of files) {
    if (!f.endsWith(".wait.lock")) continue;
    const session = f.slice(0, f.indexOf("."));
    if (name != null && session !== name) continue;
    const probe = probeWaitLock(path.join(dir, f));
    if (probe.live) out.push({ session, pid: probe.pid, at: probe.at });
  }
  return out;
}



function loadAgentLineageFields(m: Partial<AgentMetadata>, required: boolean): ReturnType<typeof agentLineageFields> | {} {
  const present =
    m.agent_role !== undefined ||
    m.parent_session_id !== undefined ||
    m.delegation_depth !== undefined ||
    m.lineage !== undefined ||
    m.delegation_allowed !== undefined;
  if (!present && !required) return {};
  if (
    m.agent_role !== "subagent" ||
    typeof m.parent_session_id !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(m.parent_session_id) ||
    !Number.isSafeInteger(m.delegation_depth) ||
    (m.delegation_depth as number) < 1 ||
    typeof m.lineage !== "string" ||
    m.lineage.length > 4096 ||
    !AGENT_LINEAGE_RE.test(m.lineage) ||
    m.delegation_allowed !== true
  ) {
    throw new AitermError("agent metadata のsub-agent lineageが不正です", 2);
  }
  return agentLineageFields({
    agentRole: "subagent",
    parentSessionId: m.parent_session_id,
    delegationDepth: m.delegation_depth as number,
    lineage: m.lineage,
    delegationAllowed: true,
  });
}

function loadAgentMetadata(name: string): AgentMetadata {
  assertSessionName(name);
  const dir = agentsDir();
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${name}.`) && f.endsWith(".agent.json"));
  if (files.length === 0) {
    throw new AitermError(
      `session '${name}' は agent_done 管理セッションではありません。claude_agent／codex_agent 等の launcher で起動してください。`,
      2,
    );
  }
  if (files.length !== 1) {
    throw new AitermError(`session '${name}' の agent metadata が複数あります。閉じて起動し直してください。`, 2);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8"));
  } catch (e) {
    throw new AitermError(`agent metadata を読めません: ${(e as Error).message}`, 2);
  }
  const m = raw as Partial<AgentMetadata>;
  if (
    (m.kind !== "claude" && m.kind !== "codex" && m.kind !== "grok" && m.kind !== "composer" && m.kind !== "cursor") ||
    m.aiterm_session !== name ||
    typeof m.launch_id !== "string" ||
    !LAUNCH_ID_RE.test(m.launch_id)
  ) {
    throw new AitermError(`agent metadata が不正です: ${files[0]}`, 2);
  }
  const expectedEvent = agentEventPath(name, m.launch_id);
  if (m.event_file !== expectedEvent) {
    throw new AitermError("agent metadata の path が現在の secure state root と一致しません", 2);
  }
  if (m.initial_prompt_delivery !== undefined && (
    !["not_requested", "not_sent", "submitted_unconfirmed", "started"].includes(m.initial_prompt_delivery.status)
    || typeof m.initial_prompt_delivery.reason !== "string"
    || ![true, false, null].includes(m.initial_prompt_delivery.turn_started)
    || (m.initial_prompt_cursor !== null && !Number.isSafeInteger(m.initial_prompt_cursor))))
    throw new AitermError("初手delivery metadataが不正です", 2);
  const deliveryFields = m.initial_prompt_delivery === undefined ? {} : {
    initial_prompt_delivery: m.initial_prompt_delivery, initial_prompt_cursor: m.initial_prompt_cursor,
  };
  const executableFields = m.agent_executable === undefined ? {} : { agent_executable: m.agent_executable };
  if (m.kind === "claude") {
    const expectedSettings = agentManagedClaudeSettingsPath(name, m.launch_id);
    const expectedResult = agentClaudeResultPath(name, m.launch_id);
    const launchOperationId = m.launch_operation_id ?? null;
    const launchRequestDigest = m.launch_request_digest ?? null;
    if (
      m.hook_route !== "shared_claude_settings" ||
      m.claude_settings !== expectedSettings ||
      typeof m.vendor_session_id !== "string" ||
      !UUID_RE.test(m.vendor_session_id) ||
      m.result_file !== expectedResult ||
      ((launchOperationId === null) !== (launchRequestDigest === null)) ||
      (launchOperationId !== null && !OPERATION_ID_RE.test(launchOperationId)) ||
      (launchRequestDigest !== null && !OPERATION_ID_RE.test(launchRequestDigest))
    ) {
      throw new AitermError("agent metadata の path が現在の secure state root と一致しません", 2);
    }
    return {
      kind: "claude",
      aiterm_session: name,
      launch_id: m.launch_id,
      event_file: expectedEvent,
      created_at: typeof m.created_at === "string" ? m.created_at : "",
      cwd: typeof m.cwd === "string" ? m.cwd : null,
      ...(typeof m.write_scope === "string" ? { write_scope: m.write_scope } : {}),
      vendor_session_id: m.vendor_session_id,
      initial_prompt: normalizeInitialPromptState(m.initial_prompt),
      ...deliveryFields,
      ...executableFields,
      launch_operation_id: launchOperationId,
      launch_request_digest: launchRequestDigest,
      hook_route: "shared_claude_settings",
      ...loadAgentLineageFields(m, true),
      node_platform: process.platform,
      claude_settings: expectedSettings,
      result_file: expectedResult,
    };
  }
  if (m.kind === "codex") {
    // codex_home は起動時に記録した per-launch の正本を信じる。現在の process env
    // （realCodexHome()）との等値を要求すると、席専用 CODEX_HOME で起動した正当な
    // session が別の aiterm instance から全部拒否される（2026-08-22 実測: peertable の
    // 席へ pty_key できず円卓が停止した）。検証は形（絶対パス）だけにする。
    const recordedHome = m.codex_home;
    if (m.hook_route !== "shared_codex_home" || m.completion_route !== "codex_transcript"
      || typeof recordedHome !== "string" || !path.isAbsolute(recordedHome)) {
      throw new AitermError("agent metadata の codex_home が不正です（絶対パスの記録が必要）", 2);
    }
    return {
      kind: "codex",
      aiterm_session: name,
      launch_id: m.launch_id,
      event_file: expectedEvent,
      created_at: typeof m.created_at === "string" ? m.created_at : "",
      cwd: typeof m.cwd === "string" ? m.cwd : null,
      ...(typeof m.write_scope === "string" ? { write_scope: m.write_scope } : {}),
      vendor_session_id: typeof m.vendor_session_id === "string" ? m.vendor_session_id : null,
      initial_prompt: normalizeInitialPromptState(m.initial_prompt),
      ...deliveryFields,
      ...executableFields,
      hook_route: "shared_codex_home",
      completion_route: "codex_transcript",
      ...loadAgentLineageFields(m, true),
      node_platform: process.platform,
      codex_home: recordedHome,
    };
  }
  if (m.kind === "cursor") {
    const recordedHome = m.cursor_home;
    if (
      m.hook_route !== "shared_cursor_home" ||
      m.completion_route !== "cursor_transcript" ||
      typeof recordedHome !== "string" ||
      !path.isAbsolute(recordedHome)
    ) {
      throw new AitermError("agent metadata の cursor_home が不正です（絶対パスの記録が必要）", 2);
    }
    return {
      kind: "cursor",
      aiterm_session: name,
      launch_id: m.launch_id,
      event_file: expectedEvent,
      created_at: typeof m.created_at === "string" ? m.created_at : "",
      cwd: typeof m.cwd === "string" ? m.cwd : null,
      ...(typeof m.write_scope === "string" ? { write_scope: m.write_scope } : {}),
      vendor_session_id: typeof m.vendor_session_id === "string" ? m.vendor_session_id : null,
      initial_prompt: normalizeInitialPromptState(m.initial_prompt),
      ...deliveryFields,
      ...executableFields,
      hook_route: "shared_cursor_home",
      completion_route: "cursor_transcript",
      ...loadAgentLineageFields(m, true),
      node_platform: process.platform,
      cursor_home: recordedHome,
    };
  }
  // grok_home も codex_home と同じ理由で per-launch の記録値を正とする（席専用 GROK_HOME）。
  // 認証正本の照合も記録された home に対して行う——現在の env の home と比較すると、
  // 席専用 home で起動した session が別 instance から拒否される。
  const recordedGrokHome = m.grok_home;
  if (
    m.hook_route !== "shared_grok_home" ||
    m.completion_route !== "grok_transcript" ||
    typeof recordedGrokHome !== "string" ||
    !path.isAbsolute(recordedGrokHome) ||
    typeof m.vendor_session_id !== "string" ||
    !UUID_RE.test(m.vendor_session_id)
  ) {
    throw new AitermError("agent metadata の grok_home が不正です（絶対パスの記録が必要）", 2);
  }
  const expectedAuthPath = resolveAndValidateGrokAuth(recordedGrokHome);
  if ((typeof m.grok_auth_path === "string" ? m.grok_auth_path : null) !== expectedAuthPath) {
    throw new AitermError("agent metadata の認証正本が現在の設定と一致しません", 2);
  }
  return {
    kind: m.kind,
    aiterm_session: name,
    launch_id: m.launch_id,
    event_file: expectedEvent,
    created_at: typeof m.created_at === "string" ? m.created_at : "",
    cwd: typeof m.cwd === "string" ? m.cwd : null,
    ...(typeof m.write_scope === "string" ? { write_scope: m.write_scope } : {}),
    vendor_session_id: m.vendor_session_id,
    initial_prompt: normalizeInitialPromptState(m.initial_prompt),
    ...deliveryFields,
    ...executableFields,
    hook_route: "shared_grok_home",
    completion_route: "grok_transcript",
    ...loadAgentLineageFields(m, true),
    node_platform: process.platform,
    grok_home: recordedGrokHome,
    grok_auth_path: expectedAuthPath,
  };
}

function parseAgentDoneEvent(line: string, meta: AgentMetadata): AgentDoneParseResult {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return { event: null, malformed: true };
  }
  const ev = obj as Partial<AgentDoneEvent>;
  if (
    ev.type !== "agent_done" ||
    ev.vendor !== meta.kind ||
    ev.aiterm_session !== meta.aiterm_session ||
    ev.launch_id !== meta.launch_id ||
    ev.done_status !== "turn_done"
  ) {
    return { event: null, malformed: false };
  }
  if (meta.vendor_session_id && ev.vendor_session_id !== meta.vendor_session_id) {
    return { event: null, malformed: false };
  }
  if (
    meta.kind === "claude" &&
    (typeof ev.vendor_session_id !== "string" ||
      !ev.vendor_session_id ||
      (ev.operation_id != null &&
        (typeof ev.operation_id !== "string" || !OPERATION_ID_RE.test(ev.operation_id))) ||
      typeof ev.result_digest !== "string" ||
      !/^[0-9a-f]{64}$/.test(ev.result_digest) ||
      !Number.isInteger(ev.result_bytes) ||
      (ev.result_bytes as number) < 0 ||
      (ev.result_bytes as number) > CLAUDE_RESULT_MAX_BYTES)
  ) {
    return { event: null, malformed: true };
  }
  return {
    event: {
      type: "agent_done",
      vendor: meta.kind,
      aiterm_session: meta.aiterm_session,
      launch_id: meta.launch_id,
      vendor_session_id: typeof ev.vendor_session_id === "string" ? ev.vendor_session_id : null,
      turn_id: typeof ev.turn_id === "string" ? ev.turn_id : null,
      operation_id:
        typeof ev.operation_id === "string" && OPERATION_ID_RE.test(ev.operation_id) ? ev.operation_id : null,
      reason: typeof ev.reason === "string" ? ev.reason : "Stop",
      done_status: "turn_done",
      stop_hook_active: !!ev.stop_hook_active,
      result_digest: typeof ev.result_digest === "string" && /^[0-9a-f]{64}$/.test(ev.result_digest) ? ev.result_digest : undefined,
      result_bytes: Number.isInteger(ev.result_bytes) && (ev.result_bytes as number) >= 0 ? ev.result_bytes : undefined,
      at: typeof ev.at === "string" ? ev.at : new Date().toISOString(),
    },
    malformed: false,
  };
}

function scanAgentDoneLines(
  lines: string[],
  meta: AgentMetadata,
  expectedOperationId: string | null = null,
): AgentDoneScanResult {
  let malformedEvents = 0;
  let candidate: AgentDoneEvent | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, "utf8") > 64 * 1024) {
      malformedEvents++;
      continue;
    }
    const parsed = parseAgentDoneEvent(line, meta);
    if (parsed.malformed) {
      malformedEvents++;
      continue;
    }
    const ev = parsed.event;
    if (!ev) continue;
    if (expectedOperationId && ev.operation_id !== expectedOperationId) continue;
    if (meta.vendor_session_id) return { event: ev, malformedEvents, ambiguousHarnessSession: false };
    if (
      candidate?.vendor_session_id &&
      ev.vendor_session_id &&
      candidate.vendor_session_id !== ev.vendor_session_id
    ) {
      return { event: null, malformedEvents, ambiguousHarnessSession: true };
    }
    if (!candidate) candidate = ev;
  }
  return { event: candidate, malformedEvents, ambiguousHarnessSession: false };
}

function bindAgentHarnessSession(meta: AgentMetadata, ev: AgentDoneEvent): void {
  if (!meta.vendor_session_id && ev.vendor_session_id) {
    meta.vendor_session_id = ev.vendor_session_id;
  }
}

// 復旧案内の aiterm-wait は --cursor 0 を明示する: cursor 省略時の既定は waiter 起動時 EOF のため、
// 案内表示〜実行の間に done event が書かれていると読み飛ばして timeout まで座る。event file は
// per-launch 新規作成＋launch_id フィルタ付き走査なので、0 起点は取りこぼしゼロかつ安全。
function bindCompletedInitialPrompt(meta: AgentMetadata): void {
  if (meta.initial_prompt !== "pending" && meta.initial_prompt !== "sent") return;
  if (meta.kind === "codex") {
    const done = latestCodexCompletion(meta, readTranscriptLines);
    if (!done) {
      throw new AitermError(
        `agent session '${meta.aiterm_session}' は起動時 prompt の完了待ちです。${agentWaitGuide(meta.aiterm_session)}`,
        2,
      );
    }
    bindAgentHarnessSession(meta, done);
    setInitialPromptState(meta, "done");
    return;
  }
  if (meta.kind === "cursor" && meta.completion_route === "cursor_transcript") {
    const done = latestCursorCompletion(meta, readTranscriptLines);
    if (!done) {
      throw new AitermError(
        `agent session '${meta.aiterm_session}' は起動時 prompt の完了待ちです。${agentWaitGuide(meta.aiterm_session)}`,
        2,
      );
    }
    bindAgentHarnessSession(meta, done);
    setInitialPromptState(meta, "done");
    return;
  }
  if ((meta.kind === "grok" || meta.kind === "composer") && meta.completion_route === "grok_transcript") {
    if (!latestGrokCompletion(meta, readTranscriptLines)) {
      throw new AitermError(
        `agent session '${meta.aiterm_session}' は起動時 prompt の完了待ちです。${agentWaitGuide(meta.aiterm_session)}`,
        2,
      );
    }
    setInitialPromptState(meta, "done");
    return;
  }
  const size = safeStatSize(meta.event_file);
  if (size === 0) {
    throw new AitermError(
      `agent session '${meta.aiterm_session}' は起動時 prompt の完了待ちです。${agentWaitGuide(meta.aiterm_session)}`,
      2,
    );
  }
  const text = readFileRange(meta.event_file, 0, size).toString("utf8");
  const lines = text.split("\n");
  const tail = lines.pop() ?? "";
  const scanned = scanAgentDoneLines(lines, meta);
  if (scanned.ambiguousHarnessSession) {
    throw new AitermError("agent event file に複数の vendor_session_id が混在しています。該当セッションを閉じて起動し直してください。", 2);
  }
  if (!scanned.event) {
    const malformed = scanned.malformedEvents ? ` malformed_events=${scanned.malformedEvents}` : "";
    const partial = tail.trim() ? " partial_event=true" : "";
    throw new AitermError(
      `agent session '${meta.aiterm_session}' は起動時 prompt の完了 event をまだ確認できません。${agentWaitGuide(meta.aiterm_session)}${malformed}${partial}`,
      2,
    );
  }
  bindAgentHarnessSession(meta, scanned.event);
  setInitialPromptState(meta, "done");
}

function tryLoadAgentMetadata(name: string): AgentMetadata | null {
  try {
    return loadAgentMetadata(name);
  } catch {
    return null;
  }
}

function latestAgentDoneEvent(meta: AgentMetadata, expectedOperationId: string | null = null): AgentDoneEvent | null {
  if (meta.kind === "codex") return latestCodexCompletion(meta, readTranscriptLines);
  if (meta.kind === "cursor" && meta.completion_route === "cursor_transcript") {
    return latestCursorCompletion(meta, readTranscriptLines);
  }
  if ((meta.kind === "grok" || meta.kind === "composer") && meta.completion_route === "grok_transcript") {
    return latestGrokCompletion(meta, readTranscriptLines);
  }
  const size = safeStatSize(meta.event_file);
  if (size === 0) return null;
  const isTailRead = size > AGENT_EVENT_TAIL_BYTES;
  let text = readFileRange(meta.event_file, isTailRead ? size - AGENT_EVENT_TAIL_BYTES : 0, size).toString("utf8");
  if (isTailRead) {
    const firstNewline = text.indexOf("\n");
    if (firstNewline === -1) return null;
    text = text.slice(firstNewline + 1);
  }
  let latest: AgentDoneEvent | null = null;
  for (const line of text.split("\n")) {
    if (!line.trim() || Buffer.byteLength(line, "utf8") > 64 * 1024) continue;
    const parsed = parseAgentDoneEvent(line, meta);
    if (parsed.event && (!expectedOperationId || parsed.event.operation_id === expectedOperationId)) latest = parsed.event;
  }
  return latest;
}

function completedClaudeOperationEvent(meta: AgentMetadata, operationId: string): AgentDoneEvent | null {
  const size = safeStatSize(meta.event_file);
  if (size === 0) return null;
  if (size > AGENT_EVENT_MAX_BYTES) {
    throw new AitermError("agent event file が大きすぎるためClaude operationを安全に回収できません", 2);
  }
  const text = readFileRange(meta.event_file, 0, size).toString("utf8");
  const lines = text.split("\n");
  const tail = lines.pop() ?? "";
  if (tail.length > 0) throw new AitermError("Claude operation event fileに未完結lineがあります", 2);
  let match: AgentDoneEvent | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, "utf8") > 64 * 1024) {
      throw new AitermError("Claude operation event lineが上限を超えています", 2);
    }
    const parsed = parseAgentDoneEvent(line, meta);
    if (parsed.malformed) throw new AitermError("Claude operation eventが不正です", 2);
    if (!parsed.event || parsed.event.operation_id !== operationId) continue;
    if (match !== null) throw new AitermError("Claude operation completion eventが重複しています", 2);
    match = parsed.event;
  }
  return match;
}

function recoverAgentHarnessSession(meta: AgentMetadata): void {
  if (meta.vendor_session_id) return;
  if (meta.kind === "codex") {
    const transcript = bindCodexTranscriptSession(meta);
    if (!transcript) return;
    if (meta.initial_prompt === "pending" && latestCodexCompletion(meta, readTranscriptLines)) setInitialPromptState(meta, "done");
    return;
  }
  if (meta.kind === "cursor") {
    const transcript = bindCursorTranscriptSession(meta);
    if (!transcript) return;
    if (meta.initial_prompt === "pending" && latestCursorCompletion(meta, readTranscriptLines)) setInitialPromptState(meta, "done");
    return;
  }
  const size = safeStatSize(meta.event_file);
  if (size === 0) return;
  if (size > AGENT_EVENT_MAX_BYTES) {
    throw new AitermError(
      "agent event file が大きすぎるため timeout 後のsessionを安全に回収できません。該当セッションを閉じて起動し直してください。",
      2,
    );
  }
  const text = readFileRange(meta.event_file, 0, size).toString("utf8");
  const lines = text.split("\n");
  lines.pop(); // hook は newline 完結eventだけを確定済みとして扱う。
  const scanned = scanAgentDoneLines(lines, meta);
  if (scanned.ambiguousHarnessSession) {
    throw new AitermError(
      "agent event file に複数の vendor_session_id が混在しています。該当セッションを閉じて起動し直してください。",
      2,
    );
  }
  if (!scanned.event?.vendor_session_id) return;
  bindAgentHarnessSession(meta, scanned.event);
  writeAgentMetadata(meta);
}

function agentCompletionCursor(meta: AgentMetadata): number {
  if ((meta.kind === "grok" || meta.kind === "composer") && meta.completion_route === "grok_transcript") {
    const transcript = grokEventsTranscript(meta);
    return transcript ? safeStatSize(transcript) : 0;
  }
  if (meta.kind === "cursor" && meta.completion_route === "cursor_transcript") {
    bindCursorTranscriptSession(meta);
    return cursorTurnBoundary(meta);
  }
  if (meta.kind !== "codex") return safeStatSize(meta.event_file);
  const transcript = bindCodexTranscriptSession(meta);
  if (meta.completion_route !== "codex_transcript") {
    meta.completion_route = "codex_transcript";
    writeAgentMetadata(meta);
  }
  return transcript ? safeStatSize(transcript) : 0;
}

function transcriptUnavailable(): never {
  throw new AitermError(`transcript がまだありません。ターン完了後に再取得してください。${agentWaitGuide()}`, 2);
}

function transcriptNotFound(vendor: AgentKind): never {
  throw new AitermError(
    `最終 assistant メッセージを特定できませんでした（harness=${agentHarness(vendor)}, vendor=${vendor}）。screen で確認してください。`,
    2,
  );
}

function readTranscriptLines(file: string): string[] {
  try {
    return fs.readFileSync(file, "utf8").split("\n");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") transcriptUnavailable();
    throw new AitermError(`transcript を読めません: ${(e as Error).message}`, 2);
  }
}

const CLAUDE_COMPLETION_MARKER_SETTLE_TIMEOUT_MS = 1_000;

function claudeCompletionWasPublishedAfterMarker(
  meta: AgentMetadata,
  marker: ClaudeOperationMarker,
): boolean {
  let markerStat: fs.Stats;
  let resultStat: fs.Stats;
  try {
    markerStat = fs.lstatSync(agentClaudeOperationPath(meta.aiterm_session, meta.launch_id));
    resultStat = fs.lstatSync(meta.result_file ?? "");
  } catch {
    return false;
  }
  if (resultStat.mtimeMs < markerStat.mtimeMs) return false;
  const done = latestAgentDoneEvent(meta, marker.operationId);
  return done !== null && done.operation_id === marker.operationId;
}

async function settlePublishedClaudeCompletionMarker(
  meta: AgentMetadata,
  marker: ClaudeOperationMarker,
): Promise<ClaudeOperationMarker | null> {
  if (!claudeCompletionWasPublishedAfterMarker(meta, marker)) return marker;
  const deadline = performance.now() + CLAUDE_COMPLETION_MARKER_SETTLE_TIMEOUT_MS;
  let active: ClaudeOperationMarker | null = marker;
  while (active && performance.now() < deadline) {
    await sleep(AGENT_DONE_POLL_MS);
    active = readClaudeOperationMarker(meta);
  }
  return active;
}

export interface AgentTranscriptResult {
  text: string;
  display: string;
  vendor: AgentKind;
  turn_id: string | null;
  harness: string;
  raw_chars: number;
}

/** agent harness の構造化 transcript から直近完了ターンの最終回答と相関情報を読む。 */
export async function readAgentTranscriptResult(
  name: string,
  o: { lines?: number | null; operation_id?: string | null; completion?: AgentWaitObservation; raw?: boolean } = {},
): Promise<AgentTranscriptResult> {
  const meta = loadAgentMetadata(name);
  if (o.completion && (o.completion.outcome !== "done" || o.completion.launch_id !== meta.launch_id || o.completion.session_id !== name)) {
    throw new AitermError("回収対象の完了情報がagent launchと一致しません", 2);
  }
  const operationId = o.operation_id == null ? null : validateOperationId(o.operation_id);
  if (operationId && meta.kind !== "claude") {
    throw new AitermError("operation_id付き回収はClaude agent sessionだけで使用できます", 2);
  }
  if (meta.kind === "claude" && !o.completion) {
    let active = readClaudeOperationMarker(meta);
    if (active) active = await settlePublishedClaudeCompletionMarker(meta, active);
    if (active) {
      const label = active.operationId ? `operation ${active.operationId}` : "operation_idなしのClaude turn";
      throw new AitermError(`${label} はまだ完了していません。Stop完了後に同じsessionから再取得してください。${agentWaitGuide(name)}`, 2);
    }
  }
  // wait timeout は「失敗」ではなく状態不明。後着した同一launchの完了eventから
  // harness session をbindし、promptを再送せず結果だけ回収できるようにする。
  recoverAgentHarnessSession(meta);
  if (!meta.vendor_session_id) {
    throw new AitermError(
      `agent session '${name}' はまだターンが完了していません。agent_done 完了後に再取得してください。${agentWaitGuide(name)}`,
      2,
    );
  }

  const done = latestAgentDoneEvent(meta, operationId);
  if (o.completion && meta.kind !== "codex" && (!done || done.turn_id !== o.completion.turn_id || done.operation_id !== o.completion.operation_id)) {
    throw new AitermError("回収対象の完了情報が置換されました。別の回答は配送しません", 2);
  }
  if (operationId && !done) {
    throw new AitermError(`operation ${operationId} はまだ完了していません。同じoperation_idで後から再取得してください。${agentWaitGuide(name)}`, 2);
  }
  const turnId = o.completion?.turn_id ?? done?.turn_id ?? null;
  let text = "";

  if (meta.kind === "claude") {
    if (!done) transcriptUnavailable();
    text = readClaudeResultText(meta, done, operationId, transcriptUnavailable);
  } else if (meta.kind === "cursor") {
    text = cursorTranscriptText(meta, readTranscriptLines, transcriptUnavailable);
  } else if (meta.kind === "codex") {
    text = codexTranscriptText(meta, turnId, readTranscriptLines, transcriptUnavailable, o.completion !== undefined);
  } else {
    if (!done) transcriptUnavailable();
    text = grokTranscriptText(meta, readTranscriptLines, transcriptUnavailable);
  }

  if (!text.trim()) transcriptNotFound(meta.kind);
  if (o.lines != null) text = text.split("\n").slice(-o.lines).join("\n");
  const rawChars = text.length;
  const [body, outputMeta] = o.raw ? [text, ""] : reduceOutput(text, name, true);
  const transcriptMeta = [
    "agent_transcript",
    `vendor=${meta.kind}`,
    `turn_id=${turnId ?? "unknown"}`,
    `harness=${agentHarness(meta.kind)}`,
    done?.operation_id ? `operation_id=${done.operation_id}` : null,
    `raw_chars=${rawChars}`,
  ].filter(Boolean).join(" ");
  return {
    text: body,
    display: `${body}\n${outputMeta} [${transcriptMeta}]`,
    vendor: meta.kind,
    turn_id: turnId,
    harness: agentHarness(meta.kind),
    raw_chars: rawChars,
  };
}

/** 人間向け互換表示を維持する。機械利用は readAgentTranscriptResult の text を使う。 */
export async function readAgentTranscript(
  name: string,
  o: { lines?: number | null; operation_id?: string | null } = {},
): Promise<string> {
  return (await readAgentTranscriptResult(name, o)).display;
}

function inferAgentFrontend(name: string, meta: AgentMetadata, screen?: string): string {
  const fg = paneCurrentCommand(name);
  const view = screen ?? captureScreen(name, AGENT_TUI_READY_LINES);
  if (isAgentTuiReady(meta.kind, view)) return "agent_tui";
  if (SHELLS.has(fg)) {
    if (/(^|\n)\s*>\s/.test(view)) return "shell_continuation";
    return "shell";
  }
  return "unknown";
}

function agentReadMetadataSuffix(name: string, screen?: string): string {
  const now = Date.now();
  const negativeCacheUntil = agentMetadataNegativeCache.get(name);
  if (negativeCacheUntil && negativeCacheUntil > now) return "";
  let meta: AgentMetadata;
  try {
    meta = loadAgentMetadata(name);
  } catch (e) {
    if (e instanceof AitermError && e.message.includes("agent_done 管理セッションではありません")) {
      agentMetadataNegativeCache.set(name, now + AGENT_METADATA_NEGATIVE_CACHE_TTL_MS);
    }
    return "";
  }
  agentMetadataNegativeCache.delete(name);
  const ev = latestAgentDoneEvent(meta);
  const bits = [
    "agent",
    `vendor=${meta.kind}`,
    `harness=${agentHarness(meta.kind)}`,
    `initial_prompt=${meta.initial_prompt}`,
    `agent_event_seen=${ev ? "true" : "false"}`,
    "completion_attribution=none",
    ev?.turn_id ? `last_turn_id=${ev.turn_id}` : null,
    `frontend=${inferAgentFrontend(name, meta, screen)}`,
  ].filter(Boolean);
  return ` [${bits.join(" ")}]`;
}

function assertInitialPromptNotPendingForSend(name: string, force: boolean): void {
  if (force) return;
  const meta = tryLoadAgentMetadata(name);
  if (!meta) return;
  if (meta.initial_prompt !== "pending" && meta.initial_prompt !== "sent") return;
  throw new AitermError(
    `agent session '${name}' は起動時 prompt の完了待ちです。通常 pty_send は混入防止のため送信しません。` +
      `${agentWaitGuide(name)}完了後に再度 pty_send するか、手動介入が必要な場合だけ force:true を明示してください。`,
    2,
  );
}


// aiterm-wait の exit 契約（CLI と各所の案内文で共有する正）。exit≠完了: outcome が done の時だけ完了。
export const AITERM_WAIT_OUTCOME_NOTE =
  `exit 0=done / 3=timeout（既定${DEFAULT_AGENT_DONE_TIMEOUT}秒・未完了） / 4=closed / 7=error（harnessの記録でturnがAPIエラー等で打ち切られた。結果は無い）。receiptのoutcomeが正で、done以外は未完了`;

export type AgentWaitProcess = {
  executable: string;
  args: string[];
  windows_start_process_argument_list: string | null;
};

function quoteWindowsProcessArgument(value: string): string {
  if (value !== "" && !/[\s"]/u.test(value)) return value;
  let quoted = '"';
  let backslashes = 0;
  for (const char of value) {
    if (char === "\\") {
      backslashes += 1;
    } else if (char === '"') {
      quoted += "\\".repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
    } else {
      quoted += "\\".repeat(backslashes) + char;
      backslashes = 0;
    }
  }
  return quoted + "\\".repeat(backslashes * 2) + '"';
}

export function windowsStartProcessArgumentList(args: string[]): string {
  return args.map(quoteWindowsProcessArgument).join(" ");
}

// npmのplatform別bin shimをcallerに解釈させず、現在稼働中のNodeと同梱CLIを直接起動する。
// Windowsでもbackendはpsmux、対話shellはPowerShell 7のまま。これはwaiter processの入口だけを所有する。
export function agentWaitProcess(
  session: string,
  cursor: number,
  runtime: { executable?: string; cliPath?: string; platform?: NodeJS.Platform } = {},
): AgentWaitProcess {
  const executable = runtime.executable ?? process.execPath;
  const args = [
    runtime.cliPath ?? fileURLToPath(new URL("./aiterm-wait-cli.js", import.meta.url)),
    "--session",
    session,
    "--cursor",
    String(cursor),
  ];
  return {
    executable,
    args,
    windows_start_process_argument_list:
      (runtime.platform ?? process.platform) === "win32"
        ? windowsStartProcessArgumentList(args)
        : null,
  };
}

// 親ホストの識別（MCP initialize の clientInfo.name）。完了待ちコマンドを「親のターンを塞がない
// 起動形」で名指しするためだけに使う。分からない時は汎用文へ落ち、機能は一切変えない。
let parentClientName: string | null = null;

export function setParentClient(name: string | null): void {
  const trimmed = typeof name === "string" ? name.trim() : "";
  parentClientName = trimmed === "" ? null : trimmed;
}

// 完了待ちを親のターンを塞がない形で起動する具体形。ホストが分かる時は実際の呼び出し形を名指しする
// （抽象名詞の「バックグラウンドで」だけでは親が foreground 実行へ落ちるため・ADR 0017）。
export function agentWaitLaunchForm(command: string): string {
  if (parentClientName === "claude-code") {
    return `Bash(command: ${JSON.stringify(command)}, run_in_background: true)`;
  }
  return `\`${command}\` を親のターンを塞がない別プロセスとして起動`;
}

// dispatch / 起動時 prompt 送信後の共通案内。第一文で「待たない」を宣言し、待ち方は後段に置く。
export function agentDispatchGuide(session: string, cursor: number): string {
  if (parentClientName === "codex-mcp-client") {
    return "回答本文はAitermがこのCodex親へ自動配送する。wait起動・ポーリング・通常の回答回収は不要。" +
      "親は作業を続けるかターンを終え、順番待ちから届く子の回答で続行する。";
  }
  const cmd = `aiterm-wait --session ${session} --cursor ${cursor}`;
  return (
    `投げっぱなしでよい＝ここで待たない。親は自分の作業へ戻るか、このターンを終える。\n` +
    `完了通知: ${agentWaitLaunchForm(cmd)}。exit が完了通知（${AITERM_WAIT_OUTCOME_NOTE}）。\n` +
    `foreground 実行は親を最大 ${DEFAULT_AGENT_DONE_TIMEOUT} 秒塞ぐので使わない。回収: pty_read(agent_transcript:true)`
  );
}

// 未完了 session へ触った時の共通案内。ここでも待つのは waiter プロセスであって親ではない。
export function agentWaitGuide(session?: string): string {
  if (parentClientName === "codex-mcp-client") return "回答本文はこのCodex親へ自動配送される。親は作業を続けるかターンを終える。";
  const cmd = `aiterm-wait --session ${session ?? "<session_id>"} --cursor 0`;
  return `完了通知は ${agentWaitLaunchForm(cmd)} で受ける（親はここで待たない・polling 不要）。receipt の outcome=done を確認してから再取得する。`;
}

export type { AgentWaitObservation } from "./agent-shared.js";

// harness 別の利用上限バナー。検知は「報告」専用で、完了判定や自動復旧には使わない。
// 出典（2026-08-22）: grok は live 実バナーで検証、codex/claude はインストール済み実バイナリの
// 埋込文字列から抽出（codex: "You've hit your usage limit for" / claude: "Usage limit reached ·
// continuing automatically when it resets"。Claude Code はリセット時に自動継続する設計なので、
// この報告は「今は上限で止まっている」の観測であり恒久停止を意味しない）。
const AGENT_RATE_LIMIT_PATTERNS: Partial<Record<AgentKind, RegExp[]>> = {
  grok: [/You hit your weekly limit/i, /Weekly limit left:\s*0%/i],
  composer: [/You hit your weekly limit/i, /Weekly limit left:\s*0%/i],
  codex: [/You'?ve hit your usage limit/i],
  claude: [/Usage limit reached/i],
};
const AGENT_RATE_LIMIT_SCAN_BYTES = 16 * 1024;
// pane log の末尾から上限バナーを探す。読めない・無い・対象 harness でないは全て null（誤検知より取りこぼし側へ倒す）。
export function detectAgentRateLimit(kind: AgentKind, aitermSession: string): string | null {
  const patterns = AGENT_RATE_LIMIT_PATTERNS[kind];
  if (!patterns) return null;
  const file = logpath(aitermSession);
  let size: number;
  try { size = fs.statSync(file).size; } catch { return null; }
  if (size === 0) return null;
  let text: string;
  try { text = readFileRange(file, Math.max(0, size - AGENT_RATE_LIMIT_SCAN_BYTES), size).toString("utf8"); } catch { return null; }
  const clean = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  for (const re of patterns) {
    const match = clean.match(re);
    if (match) return match[0];
  }
  return null;
}

// 外部waiterプロセス用の純リーダー観測。lock・PTY・metadata書込・dispatch状態には一切触れない。
// Codex/Cursor/Grokは各harnessのtranscript、Claudeはevent fileを増分走査し、vendor_session_idのbind永続化を
// 行わない（waiterは観測者であって所有者でない）。
export async function observeAgentDone(
  name: string,
  o: { operation_id?: string | null; timeout?: number; cursor?: number | null; signal?: AbortSignal } = {},
): Promise<AgentWaitObservation> {
  const meta = loadAgentMetadata(name);
  const operationId = o.operation_id == null ? null : validateOperationId(o.operation_id);
  if (operationId && meta.kind !== "claude") {
    throw new AitermError("operation_id はClaude agent sessionだけで使用できます", 2);
  }
  if (o.cursor != null && (!Number.isInteger(o.cursor) || o.cursor < 0)) {
    throw new AitermError("cursor は0以上の整数完了境界で指定してください", 2);
  }
  const timeout = o.timeout ?? DEFAULT_AGENT_DONE_TIMEOUT;
  if (meta.kind === "codex" && meta.completion_route === "codex_transcript") {
    return observeCodexDone(meta, timeout, o.cursor, detectAgentRateLimit, o.signal);
  }
  if (meta.kind === "cursor" && meta.completion_route === "cursor_transcript") {
    return observeCursorDone(meta, timeout, o.cursor, detectAgentRateLimit, o.signal);
  }
  if ((meta.kind === "grok" || meta.kind === "composer") && meta.completion_route === "grok_transcript") {
    return observeGrokDone(meta, timeout, o.cursor, detectAgentRateLimit, o.signal);
  }
  const metadataFile = agentMetadataPath(meta.aiterm_session, meta.launch_id);
  // 境界の優先順: dispatch receipt の event_cursor（起動順序に依存しない）→ operation相関
  // （operation_idの一意性で先頭から全走査できる）→ waiter起動時EOF（waiter先行起動が前提）。
  const startOffset = o.cursor ?? (operationId ? 0 : safeStatSize(meta.event_file));
  const deadline = performance.now() + timeout * 1000;
  let cursor = startOffset;
  let carry = "";
  let malformedEvents = 0;
  // Claudeの会話記録はこの観測開始時点の末尾から先だけを読む。過去turnのAPIエラー行を今回の
  // 終了と誤認しないため。dispatch直後に待機を始める親（receiptのwait_process）を前提にする。
  const transcriptFile = claudeSessionTranscriptPath(meta);
  let transcriptCursor = transcriptFile ? safeStatSize(transcriptFile) : 0;
  let transcriptCarry = "";
  const observation = (
    outcome: AgentWaitObservation["outcome"],
    ev: AgentDoneEvent | null = null,
    rateLimit: string | null = null,
    apiError: ClaudeApiError | null = null,
  ): AgentWaitObservation => ({
    schema: "aiterm.agent-wait-result.v1",
    session_id: meta.aiterm_session,
    launch_id: meta.launch_id,
    vendor: meta.kind,
    harness: agentHarness(meta.kind),
    outcome,
    operation_id: ev?.operation_id ?? operationId,
    vendor_session_id: ev?.vendor_session_id ?? meta.vendor_session_id ?? null,
    turn_id: ev?.turn_id ?? null,
    malformed_events: malformedEvents,
    at: ev?.at ?? apiError?.at ?? null,
    rate_limit: rateLimit,
    error: apiError?.text ?? null,
  });
  for (;;) {
    o.signal?.throwIfAborted();
    if (!fs.existsSync(metadataFile)) return observation("closed");
    const size = safeStatSize(meta.event_file);
    if (size < cursor) {
      cursor = 0;
      carry = "";
    }
    if (size > cursor) {
      if (size - cursor > AGENT_EVENT_MAX_BYTES) {
        throw new AitermError("agent event file の増分が大きすぎます。該当セッションを閉じて起動し直してください。", 2);
      }
      carry += readFileRange(meta.event_file, cursor, size).toString("utf8");
      cursor = size;
      const parts = carry.split("\n");
      carry = parts.pop() ?? "";
      const scanned = scanAgentDoneLines(parts, meta, operationId);
      malformedEvents += scanned.malformedEvents;
      if (scanned.ambiguousHarnessSession) {
        throw new AitermError("agent event file に複数の vendor_session_id が混在しています。該当セッションを閉じて起動し直してください。", 2);
      }
      if (scanned.event) return observation("done", scanned.event);
    }
    if (transcriptFile && fs.existsSync(transcriptFile)) {
      const transcriptSize = safeStatSize(transcriptFile);
      if (transcriptSize < transcriptCursor) {
        transcriptCursor = 0;
        transcriptCarry = "";
      }
      if (transcriptSize > transcriptCursor) {
        transcriptCarry += readFileRange(transcriptFile, transcriptCursor, transcriptSize).toString("utf8");
        transcriptCursor = transcriptSize;
        const lines = transcriptCarry.split("\n");
        transcriptCarry = lines.pop() ?? "";
        for (const line of lines) {
          const apiError = claudeApiErrorFromLine(line);
          if (apiError) return observation("error", null, null, apiError);
        }
      }
    }
    // timeout=0 は「待たずに一度だけ見る」照会＝未完了は失敗ではなく running。
    // 1秒以上を指定した待機の未完了は従来どおり timeout で、待ち方の意味は変えない。
    {
      const limited = detectAgentRateLimit(meta.kind, meta.aiterm_session);
      if (limited) return observation("rate_limited", null, limited);
    }
    if (performance.now() >= deadline) return observation(timeout === 0 ? "running" : "timeout");
    await sleep(AGENT_DONE_POLL_MS);
  }
}


function isAgentTuiReady(kind: AgentKind, screen: string): boolean {
  if (kind === "claude") return claudeTuiReady(screen);
  if (kind === "codex") return codexTuiReady(screen);
  if (kind === "cursor") return cursorTuiReady(screen);
  return grokTuiReady(screen);
}

// Codex/Claude は実行中に「(esc to interrupt)」、Cursor は「Working」＋
// 「ctrl+c to stop」を表示する（いずれも実機採取）。startup 側の処理（MCP initialize 等）が
// 走ったまま古い composer がscrollbackに残る画面は入力受付とみなさない。
// Grok/Composer は実機で `Waiting for response` / `Responding…` / `[stop]` を表示する。
function isAgentTuiBusy(kind: AgentKind, screen: string): boolean {
  if (kind === "cursor") return /ctrl\+c to stop/i.test(screen);
  if (kind === "codex" || kind === "claude") return /esc to interrupt/i.test(screen);
  if (kind === "grok" || kind === "composer") {
    return grokTuiBusy(screen);
  }
  return false;
}

// ready gate 用: 入力欄マーカーがあっても busy 表示中は ready と数えない。
// frontend 推定（inferAgentFrontend）は「agent TUI が前面か」を見るだけなので isAgentTuiReady のまま。
function isAgentTuiIdleReady(kind: AgentKind, screen: string): boolean {
  const observation = kind === "grok" || kind === "composer" ? grokPaneObservation(screen)
    : kind === "codex" ? codexPaneObservation(screen)
    : kind === "claude" ? claudePaneObservation(screen) : cursorPaneObservation(screen);
  return observation.state === "idle";
}

// 起動側が明示応答すべき既知UI。ここで自動承認せず、ready timeoutを待たずに
// `initial_prompt=not_sent`を返してsessionを生かしたままcallerへ制御を戻す。
function isAgentTuiActionRequired(kind: AgentKind, screen: string): boolean {
  if (kind === "grok" || kind === "composer") return grokLaunchBlockingDialog(screen) !== null;
  if (kind === "codex") {
    return codexPaneObservation(screen).state === "blocked";
  }
  if (kind === "claude") {
    return /new MCP servers? found in this project/iu.test(screen)
      || screen.includes("Is this a project you created or one you trust")
      || screen.includes("trust this folder")
      || (screen.includes("Claude Code running in Bypass Permissions mode") && screen.includes("Yes, I accept"));
  }
  return false;
}

function isClaudeWorkspaceTrustScreen(screen: string): boolean {
  return screen.includes("Is this a project you created or one you trust")
    && screen.includes("No, exit")
    && screen.includes("Yes, I trust this folder");
}

function isClaudeBypassPermissionsScreen(screen: string): boolean {
  return screen.includes("Claude Code running in Bypass Permissions mode")
    && screen.includes("No, exit")
    && screen.includes("Yes, I accept");
}

function isClaudeManagedLaunchConfirmation(screen: string): boolean {
  return isClaudeWorkspaceTrustScreen(screen) || isClaudeBypassPermissionsScreen(screen);
}

async function waitAgentTuiReadyImpl(
  kind: AgentKind,
  sample: () => string,
  sleepFn: (ms: number) => Promise<void>,
  opts: {
    timeoutMs?: number;
    pollMs?: number;
    stableSamples?: number;
  } = {},
): Promise<AgentTuiReadyWaitResult> {
  const timeoutMs = opts.timeoutMs ?? AGENT_TUI_READY_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? AGENT_TUI_READY_POLL_MS;
  const stableSamples = opts.stableSamples ?? agentTuiReadyStableSamplesTestOverride ?? AGENT_TUI_READY_STABLE_SAMPLES;
  const deadline = performance.now() + timeoutMs;
  let samples = 0;
  let readyStreak = 0;
  let lastScreen = "";
  for (;;) {
    lastScreen = sample();
    samples++;
    if (kind === "grok" || kind === "composer") assertGrokSandboxNotRejected(lastScreen);
    if (isAgentTuiIdleReady(kind, lastScreen)) {
      readyStreak++;
      if (readyStreak >= stableSamples) return { ready: true, samples, lastScreen };
    } else {
      readyStreak = 0;
      if (isAgentTuiActionRequired(kind, lastScreen)) return { ready: false, samples, lastScreen };
    }
    if (performance.now() >= deadline) return { ready: false, samples, lastScreen };
    await sleepFn(pollMs);
  }
}

async function waitAgentTuiReady(
  name: string,
  meta: AgentMetadata,
  timeoutMs = AGENT_TUI_READY_TIMEOUT_MS,
): Promise<AgentTuiReadyWaitResult> {
  return waitAgentTuiReadyImpl(
    meta.kind,
    () => captureScreen(name, AGENT_TUI_READY_LINES),
    sleep,
    { timeoutMs },
  );
}

async function waitAgentTuiReadyByKind(
  name: string,
  kind: AgentKind,
  timeoutMs = AGENT_TUI_READY_TIMEOUT_MS,
): Promise<AgentTuiReadyWaitResult> {
  return waitAgentTuiReadyImpl(
    kind,
    () => captureScreen(name, AGENT_TUI_READY_LINES),
    sleep,
    { timeoutMs },
  );
}

// ---- submit座礁観測 -------------------------------------------------------
// dispatch は非ブロックのため submit の成立自体は保証できない（実被弾: Codex が MCP initialize で
// ハングしたまま prompt が composer に未 submit で座礁し、2時間気づけなかった）。
// ここでは「送信 text の末尾が composer 領域（画面末尾の最後の入力欄マーカー行以降）に残存している」
// という陽性の証拠だけを有界ポーリングで観測し、receipt に載せる。
// residue=true は座礁の強い疑い。false は「残存を観測せず」であり submit 成立の保証ではない
// （TUI が長文 paste を折りたたみ表示する場合は検出できない）。null は判定不能（tail が短い等）。

export interface AgentSubmitResidueResult {
  residue: boolean | null;
  samples: number;
}

function normalizeResidueText(s: string): string {
  return s.replace(/\s+/g, "");
}

function agentSubmitResidueTail(text: string): string | null {
  // 行単位でなく text 全体の正規化末尾から取る: 最終行が短い prompt（「以上」等の締め行）でも
  // 直前行の内容を含む末尾 32 codepoint で観測できる。composer は末尾（カーソル位置）を表示し、
  // submit 済みの transcript echo は長文では先頭側を表示するため、末尾一致は座礁側に偏る。
  const cps = [...normalizeResidueText(text)];
  if (cps.length < AGENT_SUBMIT_RESIDUE_MIN_TAIL_CHARS) return null;
  return cps.slice(-AGENT_SUBMIT_RESIDUE_TAIL_CHARS).join("");
}

function agentSubmitResidueOnScreen(kind: AgentKind, screen: string, tail: string): boolean | null {
  // Cursorは送信成立後のactive turnで明示的な停止UIを出す。scrollbackに残った旧「>」を
  // composerと誤認すると、実際には走っているpromptをsubmit座礁として報告してしまう。
  if (kind === "cursor" && isAgentTuiBusy(kind, screen)) return false;
  const lines = screen.split("\n");
  // 入力欄マーカーは ready 判定と同じ記号を行頭基準で探す。submit 済みの transcript echo は
  // マーカー行より上に出るため、最後のマーカー行以降だけを composer 領域として見る。
  // grok/composer は Windows native 描画（`>`・実測 1.0.4）も ready 判定と同様に受ける。
  const markerRe = kind === "codex"
    ? CODEX_COMPOSER_MARKER_RE
    : kind === "claude"
      ? CLAUDE_COMPOSER_MARKER_RE
      : kind === "cursor"
        ? CURSOR_COMPOSER_CONTENT_MARKER_RE
        : GROK_COMPOSER_MARKER_RE;
  let markerIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (markerRe.test(lines[i])) {
      markerIdx = i;
      break;
    }
  }
  if (markerIdx < 0) return null;
  if (kind === "cursor") {
    // Cursorは長いpasteを入力欄の先頭側だけ表示し、矢印の次行へ本文を折り返すことがある。
    // 最新composerから下部statusを除いた領域にplaceholder以外の本文が残っていれば、
    // 送信文の末尾が画面外でも未submitの陽性証拠とする。
    const composerLines = lines.slice(markerIdx);
    composerLines[0] = composerLines[0].replace(/^\s*(?:->|>|→)\s*/u, "");
    while (composerLines.at(-1)?.trim() === "") composerLines.pop();
    if (/^\s*\/\S.*\s·\s\S/u.test(composerLines.at(-1) ?? "")) composerLines.pop();
    while (composerLines.at(-1)?.trim() === "") composerLines.pop();
    if (/^\s*(?:Auto|Ask)(?:\s|·|$)/iu.test(composerLines.at(-1) ?? "")) composerLines.pop();
    while (composerLines.at(-1)?.trim() === "") composerLines.pop();
    const composerText = composerLines.join("\n").trim();
    if (
      composerText.length > 0
      && !/^(?:Add a follow-up|Plan,\s*search,\s*build anything)\b/iu.test(composerText)
    ) return true;
  }
  return normalizeResidueText(lines.slice(markerIdx).join("")).includes(tail);
}

async function detectAgentSubmitResidueImpl(
  kind: AgentKind,
  text: string,
  sample: () => string,
  sleepFn: (ms: number) => Promise<void>,
  opts: { delayMs?: number; pollMs?: number; maxSamples?: number } = {},
): Promise<AgentSubmitResidueResult> {
  const tail = agentSubmitResidueTail(text);
  if (!tail) return { residue: null, samples: 0 };
  const delayMs = opts.delayMs ?? AGENT_SUBMIT_RESIDUE_DELAY_MS;
  const pollMs = opts.pollMs ?? AGENT_SUBMIT_RESIDUE_POLL_MS;
  const maxSamples = opts.maxSamples ?? AGENT_SUBMIT_RESIDUE_MAX_SAMPLES;
  if (delayMs > 0) await sleepFn(delayMs);
  let samples = 0;
  let last: boolean | null = null;
  for (let i = 0; i < maxSamples; i++) {
    last = agentSubmitResidueOnScreen(kind, sample(), tail);
    samples++;
    // 残存が消えた（または判定不能になった）時点で確定。true だけは描画遅延と区別するため
    // 全サンプル持続した場合にのみ報告する。
    if (last !== true) return { residue: last, samples };
    if (i < maxSamples - 1) await sleepFn(pollMs);
  }
  return { residue: true, samples };
}

async function detectAgentSubmitResidue(name: string, kind: AgentKind, text: string): Promise<AgentSubmitResidueResult> {
  return detectAgentSubmitResidueImpl(kind, text, () => captureScreen(name, AGENT_TUI_READY_LINES), sleep);
}

async function retryCursorSubmitIfResidueImpl(
  kind: AgentKind,
  residue: AgentSubmitResidueResult,
  submit: () => void,
  inspect: () => Promise<AgentSubmitResidueResult>,
): Promise<AgentSubmitResidueResult> {
  if (kind !== "cursor" || residue.residue !== true) return residue;
  submit();
  return inspect();
}

async function retryCursorSubmitIfResidue(
  name: string,
  kind: AgentKind,
  text: string,
  residue: AgentSubmitResidueResult,
): Promise<AgentSubmitResidueResult> {
  return retryCursorSubmitIfResidueImpl(
    kind,
    residue,
    () => sendKey(name, "Enter", { preserveAgentOperation: true }),
    () => detectAgentSubmitResidue(name, kind, text),
  );
}

export interface CursorPromptVisibleResult {
  visible: boolean;
  samples: number;
}

async function waitCursorPromptVisibleImpl(
  text: string,
  sample: () => string,
  sleepFn: (ms: number) => Promise<void>,
  opts: { pollMs?: number; maxSamples?: number } = {},
): Promise<CursorPromptVisibleResult> {
  const tail = agentSubmitResidueTail(text) ?? normalizeResidueText(text);
  const pollMs = opts.pollMs ?? CURSOR_PROMPT_VISIBLE_POLL_MS;
  const maxSamples = opts.maxSamples ?? CURSOR_PROMPT_VISIBLE_MAX_SAMPLES;
  for (let i = 0; i < maxSamples; i++) {
    if (agentSubmitResidueOnScreen("cursor", sample(), tail) === true) {
      return { visible: true, samples: i + 1 };
    }
    if (i < maxSamples - 1) await sleepFn(pollMs);
  }
  return { visible: false, samples: maxSamples };
}

async function waitCursorPromptVisible(name: string, text: string): Promise<CursorPromptVisibleResult> {
  return waitCursorPromptVisibleImpl(
    text,
    () => captureScreen(name, AGENT_TUI_READY_LINES),
    sleep,
  );
}

export function agentSubmitResidueWarning(name: string, residue: boolean | null): string {
  if (residue !== true) return "";
  return (
    `\n警告: submit_residue=true＝送信 text が composer に残存しており submit 未成立の疑いがある` +
    `（実行中 turn への queued message が表示されている可能性もある）。` +
    `pty_read(${name}, screen:true) で状態を確認してから、座礁していれば pty_key(${name}, "Enter") で再 submit、` +
    `破棄するなら pty_key(${name}, "Escape") を使う。盲目的に Enter を送らない（queued だった場合の二重 submit 防止）。`
  );
}

function assertAgentSubmitDelivered(name: string, kind: AgentKind, residue: AgentSubmitResidueResult): void {
  if (kind !== "cursor" || residue.residue !== true) return;
  throw new AitermError(
    `submit_residue=true vendor=${kind} session=${name}\n` +
      "送信 text がcomposerへ残っており、turnを開始できませんでした。",
    2,
  );
}

export function __testAssertAgentSubmitDelivered(
  name: string,
  kind: AgentKind,
  residue: AgentSubmitResidueResult,
): void {
  assertAgentSubmitDelivered(name, kind, residue);
}

async function settleAgentDoneScreenImpl(
  sample: () => AgentScreenSample,
  sleepFn: (ms: number) => Promise<void>,
  opts: {
    minDelayMs?: number;
    pollMs?: number;
    maxPolls?: number;
    minSamples?: number;
  } = {},
): Promise<AgentScreenSettleResult> {
  const minDelayMs = opts.minDelayMs ?? AGENT_DONE_SETTLE_MIN_MS;
  const pollMs = opts.pollMs ?? AGENT_DONE_SCREEN_SETTLE_POLL_MS;
  const maxPolls = opts.maxPolls ?? AGENT_DONE_SCREEN_SETTLE_MAX_POLLS;
  const minSamples = opts.minSamples ?? AGENT_DONE_SCREEN_SETTLE_MIN_SAMPLES;
  if (minDelayMs > 0) await sleepFn(minDelayMs);
  let prev = sample();
  let samples = 1;
  let stableStreak = 1;
  for (let i = 0; i < maxPolls; i++) {
    if (pollMs > 0) await sleepFn(pollMs);
    const current = sample();
    samples++;
    if (current.screen === prev.screen && current.logSize === prev.logSize) {
      stableStreak++;
      if (samples >= minSamples && stableStreak >= 2) return { unstable: false, samples };
    } else {
      stableStreak = 1;
    }
    prev = current;
  }
  return { unstable: true, samples };
}


export async function __testSettleAgentDoneScreen(
  samples: AgentScreenSample[],
  opts: { minDelayMs?: number; pollMs?: number; maxPolls?: number; minSamples?: number } = {},
): Promise<AgentScreenSettleResult & { sleeps: number[] }> {
  if (samples.length === 0) throw new AitermError("screen settle test samples が空です", 2);
  let i = 0;
  const sleeps: number[] = [];
  const result = await settleAgentDoneScreenImpl(
    () => samples[Math.min(i++, samples.length - 1)],
    async (ms) => {
      sleeps.push(ms);
    },
    opts,
  );
  return { ...result, sleeps };
}

export function __testIsAgentTuiReady(kind: AgentKind, screen: string): boolean {
  return isAgentTuiReady(kind, screen);
}

export async function __testWaitAgentTuiReady(
  kind: AgentKind,
  samples: string[],
  opts: { timeoutMs?: number; pollMs?: number; stableSamples?: number } = {},
): Promise<AgentTuiReadyWaitResult & { sleeps: number[] }> {
  if (samples.length === 0) throw new AitermError("agent ready test samples が空です", 2);
  let i = 0;
  const sleeps: number[] = [];
  const result = await waitAgentTuiReadyImpl(
    kind,
    () => samples[Math.min(i++, samples.length - 1)],
    async (ms) => {
      sleeps.push(ms);
    },
    opts,
  );
  return { ...result, sleeps };
}

export function __testIsAgentTuiIdleReady(kind: AgentKind, screen: string): boolean {
  return isAgentTuiIdleReady(kind, screen);
}

export async function __testDetectAgentSubmitResidue(
  kind: AgentKind,
  text: string,
  samples: string[],
  opts: { delayMs?: number; pollMs?: number; maxSamples?: number } = {},
): Promise<AgentSubmitResidueResult & { sleeps: number[] }> {
  let i = 0;
  const sleeps: number[] = [];
  const result = await detectAgentSubmitResidueImpl(
    kind,
    text,
    () => samples[Math.min(i++, samples.length - 1)],
    async (ms) => {
      sleeps.push(ms);
    },
    opts,
  );
  return { ...result, sleeps };
}

export async function __testWaitCursorPromptVisible(
  text: string,
  samples: string[],
  opts: { pollMs?: number; maxSamples?: number } = {},
): Promise<CursorPromptVisibleResult & { sleeps: number[] }> {
  if (samples.length === 0) throw new AitermError("Cursor prompt反映待ちのtest samplesが空です", 2);
  let i = 0;
  const sleeps: number[] = [];
  const result = await waitCursorPromptVisibleImpl(
    text,
    () => samples[Math.min(i++, samples.length - 1)],
    async (ms) => {
      sleeps.push(ms);
    },
    opts,
  );
  return { ...result, sleeps };
}

export async function __testRetryCursorSubmitIfResidue(
  kind: AgentKind,
  first: AgentSubmitResidueResult,
  second: AgentSubmitResidueResult,
): Promise<{ result: AgentSubmitResidueResult; submits: number }> {
  let submits = 0;
  const result = await retryCursorSubmitIfResidueImpl(
    kind,
    first,
    () => { submits++; },
    async () => second,
  );
  return { result, submits };
}

export function __testSetAgentTuiReadyStableSamples(value: number | null): void {
  if (value !== null && (!Number.isInteger(value) || value < 1 || value > 1000)) {
    throw new AitermError("test ready stable samplesが不正です", 2);
  }
  agentTuiReadyStableSamplesTestOverride = value;
}


export interface InitialAgentPromptOpts {
  ready_timeout?: number;
  trust_project?: boolean;
  before_send?: import("./agent-shared.js").BeforeAgentSend;
}

async function sendAgentPromptText(name: string, text: string, kind?: AgentKind): Promise<void> {
  send(name, text, {
    enter: false,
    force: true,
    raw: false,
    mark: false,
    rtk: false,
    preserveAgentOperation: true,
    bracketedPaste: true,
  });
  if (kind === "cursor") {
    const visible = await waitCursorPromptVisible(name, text);
    if (!visible.visible) {
      throw new AitermError(
        `vendor=cursor session=${name}\n` +
          "送信promptがCursorのcomposerへ反映されたことを確認できないため、Enterは送信していません。",
        2,
      );
    }
  } else {
    await sleep(AGENT_SUBMIT_DELAY_MS);
  }
  sendKey(name, "Enter", { preserveAgentOperation: true });
}

export interface InitialAgentPromptResult {
  text: string;
  // 初回 prompt を dispatch した場合のharness完了正本境界。ready 失敗で未送信なら null。
  event_cursor: number | null;
  // submit座礁観測。true=composerに残存を確認（未submitの疑い）/ false=残存を観測せず / null=判定不能・未実施。
  submit_residue: boolean | null;
  initial_prompt: InitialPromptDelivery;
}

function setInitialDelivery(meta: AgentMetadata, value: InitialPromptDelivery, cursor: number | null): void {
  meta.initial_prompt_delivery = value;
  meta.initial_prompt_cursor = cursor;
  writeAgentMetadata(meta);
}

async function prepareAgentInput(name: string, meta: AgentMetadata, options: InitialAgentPromptOpts): Promise<AgentStartupResult> {
  await ensureAgentOwnsPaneInput(name, meta.kind);
  let ready = await waitAgentTuiReady(name, meta, options.ready_timeout ?? AGENT_TUI_READY_TIMEOUT_MS);
  const handled = new Set<string>();
  while (!ready.ready) {
    const action = meta.kind === "codex" ? codexStartupAction(ready.lastScreen, options.trust_project === true)
      : meta.kind === "claude" ? claudeStartupAction(ready.lastScreen, options.trust_project === true)
      : meta.kind === "grok" || meta.kind === "composer" ? grokStartupAction(ready.lastScreen, options.trust_project === true) : null;
    if (!action || handled.has(action.kind)) break;
    handled.add(action.kind);
    for (const key of action.keys) {
      sendKey(name, key, { preserveAgentOperation: true });
      await sleep(AGENT_SUBMIT_DELAY_MS);
    }
    ready = await waitAgentTuiReady(name, meta, options.ready_timeout ?? AGENT_TUI_READY_TIMEOUT_MS);
  }
  if (!ready.ready) {
    const state = meta.kind === "grok" || meta.kind === "composer" ? grokPaneObservation(ready.lastScreen)
      : meta.kind === "codex" ? codexPaneObservation(ready.lastScreen)
      : meta.kind === "claude" ? claudePaneObservation(ready.lastScreen) : cursorPaneObservation(ready.lastScreen);
    return { status: "blocked", reason: state.reason };
  }
  const live = observeSession(name);
  if (live.harness_alive !== true || live.harness_process === null || live.state !== "idle")
    return { status: "blocked", reason: live.reason };
  return { status: "ready", reason: "composer_ready" };
}

export async function sendInitialAgentPrompt(
  name: string,
  text: string,
  o: InitialAgentPromptOpts = {},
): Promise<InitialAgentPromptResult> {
  assertSessionName(name);
  const meta = loadAgentMetadata(name);
  if (meta.initial_prompt === "done") {
    throw new AitermError(`agent session '${name}' の起動時 prompt は既に完了しています`, 2);
  }
  if (meta.initial_prompt === "pending" || meta.initial_prompt === "sent") {
    throw new AitermError(
      `agent session '${name}' は起動時 prompt の完了待ちです。初回応答完了後に再度操作してください。`,
      2,
    );
  }
  setInitialPromptState(meta, "not_sent");
  setInitialDelivery(meta, { status: "not_sent", reason: "preparing", turn_started: false }, null);
  const startup = await prepareAgentInput(name, meta, o);
  if (startup.status !== "ready") {
    setInitialDelivery(meta, { status: "not_sent", reason: startup.reason, turn_started: false }, null);
    throw new AitermError(
      `initial_prompt=not_sent vendor=${meta.kind} ready=false harness=${agentHarness(meta.kind)}\n` +
        `agent session '${name}' の起動準備が完了していないため、promptは送信していません。reason=${startup.reason}`,
      2,
    );
  }
  const promptText = meta.kind === "cursor" ? cursorPromptWithLineage(meta, text) : text;
  const startOffset = agentCompletionCursor(meta);
  try {
    prepareSendText(promptText, { raw: false });
    await o.before_send?.({ session_id: name, launch_id: meta.launch_id, vendor: meta.kind,
      harness: agentHarness(meta.kind), event_cursor: startOffset, operation_id: null });
    if (meta.kind === "claude") {
      prepareSendText(text, { raw: false });
      reserveAnonymousClaudeTurn(meta);
    }
    setInitialDelivery(meta, { status: "submitted_unconfirmed", reason: "dispatch_in_progress", turn_started: null }, startOffset);
    await sendAgentPromptText(name, promptText, meta.kind);
    setInitialPromptState(meta, "pending");
  } catch (e) {
    setInitialPromptState(meta, "failed");
    throw e;
  }
  let residue = await detectAgentSubmitResidue(name, meta.kind, promptText);
  // Cursor現行UIは長いbracketed pasteの直後のEnterを取り落とすことがある。
  // 初回promptには先行turnが無いため、本文がcomposerへ残り続ける実測がある時だけ
  // 同じEnterを一度再送できる。通常dispatchへ再送を広げない。
  if (meta.kind === "cursor" && residue.residue === true) {
    sendKey(name, "Enter", { preserveAgentOperation: true });
    residue = await detectAgentSubmitResidue(name, meta.kind, promptText);
    if (residue.residue === true) {
      setInitialPromptState(meta, "failed");
      throw new AitermError(
        `initial_prompt=failed vendor=cursor harness=${agentHarness(meta.kind)}\n` +
          `起動時promptがCursorのcomposerへ残り、Enter再送後もturnを開始できませんでした。`,
        2,
      );
    }
  }
  try {
    assertAgentSubmitDelivered(name, meta.kind, residue);
  } catch (e) {
    setInitialPromptState(meta, "failed");
    throw e;
  }
  let delivery: InitialPromptDelivery = { status: "submitted_unconfirmed", reason: "start_unconfirmed", turn_started: null };
  const deadline = performance.now() + 3000;
  do {
    const screen = captureScreen(name, AGENT_TUI_READY_LINES);
    const state = meta.kind === "grok" || meta.kind === "composer" ? grokPaneObservation(screen)
      : meta.kind === "codex" ? codexPaneObservation(screen)
      : meta.kind === "claude" ? claudePaneObservation(screen) : cursorPaneObservation(screen);
    if (state.state === "busy") {
      delivery = { status: "started", reason: "turn_running", turn_started: true }; break;
    }
    if (state.state === "blocked" && ["command_approval", "mcp_approval", "tool_approval"].includes(state.reason)) {
      delivery = { status: "started", reason: "approval_required", turn_started: true }; break;
    }
    const completed = await observeAgentDone(name, { cursor: startOffset, timeout: 0 });
    if (completed.outcome === "done") {
      delivery = { status: "started", reason: "turn_completed", turn_started: true }; break;
    }
    if (state.state === "blocked" || completed.outcome === "error" || completed.outcome === "rate_limited") {
      delivery.reason = state.state === "blocked" ? state.reason : completed.outcome; break;
    }
    await sleep(100);
  } while (performance.now() < deadline);
  setInitialDelivery(meta, delivery, startOffset);
  return {
    text:
      `initial_prompt=pending vendor=${meta.kind} event_cursor=${startOffset} harness=${agentHarness(meta.kind)}\n` +
      `起動時 prompt を送信した。${agentDispatchGuide(name, startOffset)}` +
      agentSubmitResidueWarning(name, residue.residue),
    event_cursor: startOffset,
    submit_residue: residue.residue,
    initial_prompt: delivery,
  };
}

export function isAgentSession(name: string): boolean {
  assertSessionName(name);
  return tryLoadAgentMetadata(name) !== null;
}

export interface AgentDispatchReceipt {
  schema: "aiterm.agent-dispatch.v1";
  session_id: string;
  launch_id: string;
  vendor: AgentKind;
  harness: AgentHarness;
  // harness別完了正本の境界（byte offsetとは限らない。Cursorはuser turn数）。
  event_cursor: number;
  operation_id: string | null;
  // submit座礁観測。true=composerに残存を確認（未submitの疑い）/ false=残存を観測せず
  // （submit成立の保証ではない）/ null=判定不能。
  submit_residue: boolean | null;
  // 打鍵前に行った pane 入力の回復（"fg" / "fg_stopped" / "stty_raw"）。何もしなければ空配列。
  pane_input_recovery: string[];
}

export interface AgentConfigureResult {
  schema: "aiterm.agent-configure-result.v1";
  session_id: string;
  provider: AgentKind;
  harness: AgentHarness;
  model: string | null;
  reasoning_effort: string | null;
}

async function waitForScreenText(name: string, text: string, timeoutMs = 3_000): Promise<string> {
  const deadline = performance.now() + timeoutMs;
  do {
    const screen = captureScreen(name, AGENT_TUI_READY_LINES);
    if (screen.includes(text)) return screen;
    await sleep(100);
  } while (performance.now() < deadline);
  throw new AitermError(`${agentLabel(loadAgentMetadata(name).kind)} の ${text} 画面を確認できません`, 2);
}

function lineCounts(screen: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of screen.split("\n").map((value) => value.trim()).filter(Boolean)) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

async function waitForGrokConfigurationResult(
  name: string,
  before: string,
  model: string | null,
  effort: string | null,
  timeoutMs = 3_000,
): Promise<void> {
  const beforeCounts = lineCounts(before);
  const footerAlreadyMatched = grokFooterHasConfiguration(before, model, effort);
  const deadline = performance.now() + timeoutMs;
  do {
    const screen = captureScreen(name, AGENT_TUI_READY_LINES);
    const seen = new Map<string, number>();
    const added = screen.split("\n").map((value) => value.trim()).filter((line) => {
      if (!line) return false;
      const count = (seen.get(line) ?? 0) + 1;
      seen.set(line, count);
      return count > (beforeCounts.get(line) ?? 0);
    });
    const error = added.find((line) =>
      /^(?:Unknown model:|unknown effort level|Usage: \/(?:model|effort)\b|Invalid (?:model|reasoning effort)|.*does not support reasoning effort)/i.test(line));
    if (error) throw new AitermError(`Grokの設定変更に失敗しました: ${error}`, 2);
    if (added.some((line) => /^(?:Switched to |✓?\s*Default model:)/.test(line))) return;
    // Grok Build 1.0.3では成功通知が次の再描画で消えることがある。変更前には無かった
    // target model／effortが常駐footerへ現れた場合も、harness自身の最終状態として受理する。
    if (!footerAlreadyMatched && grokFooterHasConfiguration(screen, model, effort)) return;
    await sleep(100);
  } while (performance.now() < deadline);
  throw new AitermError(`${agentLabel(loadAgentMetadata(name).kind)} の設定変更完了を確認できません`, 2);
}

function sendMenuChoice(name: string, choice: string): void {
  const sent = tmux("send-keys", "-t", name, choice);
  if (sent.code !== 0) {
    throw new AitermError(`agent設定の選択を送れませんでした: ${sent.stderr.trim() || `code=${sent.code}`}`, 2);
  }
}

/** 同じ対話sessionを保ったまま、harness標準の操作でmodel／effortを変更する。 */
export async function configureAgent(
  name: string,
  opts: { model?: string | null; reasoning_effort?: string | null },
): Promise<AgentConfigureResult> {
  assertSessionName(name);
  const model = opts.model?.trim() || null;
  const effort = opts.reasoning_effort?.trim() || null;
  if (!model && !effort) throw new AitermError("model または reasoning_effort を指定してください", 2);
  if ((model && /[\r\n]/.test(model)) || (effort && /[\r\n]/.test(effort))) {
    throw new AitermError("model／reasoning_effort に改行を含められません", 2);
  }
  const meta = loadAgentMetadata(name);
  bindCompletedInitialPrompt(meta);
  const ready = await waitAgentTuiReady(name, meta, AGENT_TUI_READY_TIMEOUT_MS);
  if (!ready.ready) throw new AitermError(`agent session '${name}' は入力待ちではありません`, 2);

  if (meta.kind === "claude") {
    if (model) {
      await sendAgentPromptText(name, `/model ${model}`);
      const modelReady = await waitAgentTuiReady(name, meta, AGENT_TUI_READY_TIMEOUT_MS);
      if (!modelReady.ready) throw new AitermError(`Claudeのmodel変更完了を確認できません`, 2);
    }
    if (effort) {
      await sendAgentPromptText(name, `/effort ${effort}`);
      const effortReady = await waitAgentTuiReady(name, meta, AGENT_TUI_READY_TIMEOUT_MS);
      if (!effortReady.ready) throw new AitermError(`Claudeのeffort変更完了を確認できません`, 2);
    }
    return {
      schema: "aiterm.agent-configure-result.v1",
      session_id: name,
      provider: "claude",
      harness: agentHarness("claude"),
      model,
      reasoning_effort: effort,
    };
  }

  if (meta.kind === "cursor") {
    validateCursorModelEffort(model, effort);
    if (!model) throw new AitermError("Cursorのreasoning_effort変更にはmodelも指定してください", 2);
    const bin = resolveAgentBin("cursor");
    if (!bin) throw new AitermError("Cursor Agent CLI の CLI が見つかりません", 2);
    assertCursorModelAvailable(bin, meta.cwd ?? process.cwd(), model, effort);
    // Cursor TUIの `/model <base model>` はmodelを直接切り替える一方、flatten済みcatalog ID
    // （例: gpt-5.6-luna-high）を渡すとno matchesのfilter画面へ入る。effortは標準model pickerの
    // parameter editorで選び、同じsessionと会話contextを保つ。
    await sendAgentPromptText(name, `/model ${model}`, meta.kind);
    const modelReady = await waitAgentTuiReady(name, meta, AGENT_TUI_READY_TIMEOUT_MS);
    if (!modelReady.ready) throw new AitermError("Cursorのmodel変更完了を確認できません", 2);
    if (effort) {
      await sendAgentPromptText(name, "/model", meta.kind);
      await waitForScreenText(name, "Available models");
      sendMenuChoice(name, "Tab");
      const parameterScreen = await waitForScreenText(name, "Edit Parameters");
      const navigation = cursorEffortNavigation(parameterScreen, effort);
      for (let i = 0; i < navigation.down; i++) sendMenuChoice(name, "Down");
      sendMenuChoice(name, "Enter");
      await waitForScreenText(name, `${navigation.label} ✓`);
      sendMenuChoice(name, "Escape");
      await waitForScreenText(name, "Available models");
      sendMenuChoice(name, "Enter");
      const effortReady = await waitAgentTuiReady(name, meta, AGENT_TUI_READY_TIMEOUT_MS);
      if (!effortReady.ready) throw new AitermError("Cursorのreasoning effort変更完了を確認できません", 2);
    }
    return {
      schema: "aiterm.agent-configure-result.v1",
      session_id: name,
      provider: "cursor",
      harness: agentHarness("cursor"),
      model,
      reasoning_effort: effort,
    };
  }

  if (meta.kind === "grok" || meta.kind === "composer") {
    if (model) {
      const bin = resolveAgentBin(meta.kind);
      if (!bin) throw new AitermError(`${agentLabel(meta.kind)} の CLI が見つかりません`, 2);
      assertGrokModelAvailable(bin, meta.cwd ?? process.cwd(), model);
    }
    const command = model
      ? `/model ${model}${effort ? ` ${effort}` : ""}`
      : `/effort ${effort}`;
    const before = captureScreen(name, AGENT_TUI_READY_LINES);
    await sendAgentPromptText(name, command);
    await waitForGrokConfigurationResult(name, before, model, effort);
    return {
      schema: "aiterm.agent-configure-result.v1",
      session_id: name,
      provider: meta.kind,
      harness: agentHarness(meta.kind),
      model,
      reasoning_effort: effort,
    };
  }

  await sendAgentPromptText(name, "/model");
  const modelScreen = await waitForScreenText(name, "Select Model and Effort");
  if (model) {
    const choice = codexModelChoice(modelScreen, model);
    if (!choice) throw new AitermError(`Codexの/modelに ${model} がありません`, 2);
    sendMenuChoice(name, choice);
  } else {
    sendMenuChoice(name, "Enter");
  }

  let effortScreen = await waitForScreenText(name, "Select Reasoning Level");
  if (effort) {
    let choice = codexEffortChoice(effortScreen, effort);
    if (!choice && (effort === "max" || effort === "ultra")) {
      const more = codexMoreReasoningChoice(effortScreen);
      if (more) {
        sendMenuChoice(name, more);
        effortScreen = await waitForScreenText(name, "Advanced Reasoning");
        choice = codexEffortChoice(effortScreen, effort);
      }
    }
    if (!choice) throw new AitermError(`Codexの/modelに reasoning_effort=${effort} がありません`, 2);
    sendMenuChoice(name, choice);
  } else {
    sendMenuChoice(name, "Enter");
  }
  await waitForScreenText(name, "Model changed to");
  return {
    schema: "aiterm.agent-configure-result.v1",
    session_id: name,
    provider: "codex",
    harness: agentHarness("codex"),
    model,
    reasoning_effort: effort,
  };
}

export function __testCodexConfigureChoices(screen: string, model: string, effort: string): {
  model: string | null;
  effort: string | null;
  more: string | null;
} {
  return {
    model: codexModelChoice(screen, model),
    effort: codexEffortChoice(screen, effort),
    more: codexMoreReasoningChoice(screen),
  };
}

// v0.16.0: 親をブロックする wait 経路は廃止した。send は ready gate と submit 分離を内蔵した
// dispatch として即返り、event_cursor（送信直前のharness完了正本境界）を receipt で返す。
// 完了通知は aiterm-wait（--cursor で境界を渡す）、回収は pty_read / claude_turn recover が担う。
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

/**
 * 画像添付。Claude Code／Codex／Grok／Cursorの4 harnessは、本文に書かれた画像ファイルの絶対パスを
 * 自分のfile読取toolで開いて画像として見る（実測 2026-09-04: 赤青の試験画像を全harnessが正しく答えた）。
 * 入力欄へパスを先打鍵する等のharness別操作は不要であり、呼出し側にharnessの癖を覚えさせない。
 * 添付の表現とpath検査はこの1箇所だけが所有する。検査は外部入力（呼出し側が渡すpath）の境界。
 */
export function attachImages(text: string, images: readonly string[] | undefined): string {
  if (!images || images.length === 0) return text;
  const lines = images.map((image, index) => {
    if (typeof image !== "string" || !path.isAbsolute(image)) {
      throw new AitermError(`image[${index}] は画像ファイルの絶対パスで指定してください: ${String(image)}`, 2);
    }
    if (!IMAGE_EXTENSIONS.has(path.extname(image).toLowerCase())) {
      throw new AitermError(`image[${index}] の拡張子に対応していません（png/jpg/jpeg/gif/webp）: ${image}`, 2);
    }
    let st: fs.Stats;
    try {
      st = fs.statSync(image);
    } catch {
      throw new AitermError(`image[${index}] が読めません: ${image}`, 2);
    }
    if (!st.isFile()) throw new AitermError(`image[${index}] はfileではありません: ${image}`, 2);
    return `[aiterm 添付画像 ${index + 1}/${images.length}] ${image}`;
  });
  const body = text.trim().length > 0 ? text : "添付画像を確認してください。";
  return `${body}\n\n${lines.join("\n")}\n添付画像は上のファイルを読んで確認する。`;
}

export async function dispatchAgentTurn(
  name: string,
  text: string,
  o: { operation_id?: string | null; ready_timeout?: number; force?: boolean; raw?: boolean; before_send?: import("./agent-shared.js").BeforeAgentSend } = {},
): Promise<AgentDispatchReceipt> {
  assertSessionName(name);
  const meta = loadAgentMetadata(name);
  const operationId = o.operation_id == null ? null : validateOperationId(o.operation_id);
  if (operationId && meta.kind !== "claude") {
    throw new AitermError("operation_id はClaude agent sessionだけで使用できます", 2);
  }
  bindCompletedInitialPrompt(meta);
  // Codex/Grok/Composerはbind済みのfollow-upでも毎回idleを確認してからtranscript境界を切る。
  // Grok/Composerはsession IDが起動前から既知でも、共有MCPの初期化完了前には送信しない。
  // 同じcursorへ複数turnを帰属させる余地や、初期化中TUIへの早送信を作らない。
  // Claudeはsession IDを起動時に採番するため「bind済み」では初回を区別できず、起動直後の
  // dispatchがready gateを素通りしていた。composer描画前に貼付とEnterが届くと起動時の一塊の
  // 入力として読まれ、本文だけがcomposerへ残る（実被弾 2026-09-02: 停止中Botへの初回配送）。
  // 完了eventも進行中turnもないClaude sessionだけを起動直後とみなし、他harnessと同じgateを通す。
  const claudeColdStart = meta.kind === "claude"
    && agentCompletionCursor(meta) === 0
    && readClaudeOperationMarker(meta) === null;
  const paneInputRecovery = await ensureAgentOwnsPaneInput(name, meta.kind);
  if (meta.kind !== "claude" || claudeColdStart) {
    const ready = await waitAgentTuiReady(name, meta, o.ready_timeout ?? AGENT_TUI_READY_TIMEOUT_MS);
    if (!ready.ready) {
      throw new AitermError(
        `agent session '${name}' の ${agentLabel(meta.kind)} TUI が入力受付状態になりません。文字列は送信していません。` +
          "少し後で pty_read(screen:true) を確認し、TUI が起動済みなら再度 pty_send してください。",
        2,
      );
    }
  }
  const startOffset = agentCompletionCursor(meta);
  // promptなしで起動したCursorは、最初のdispatch時点ではtranscriptとの相関markerをまだ持たない。
  // その1回だけlaunch contextを加え、以後はbind済みconversationへ通常textだけを送る。
  const dispatchText = meta.kind === "cursor" && !meta.vendor_session_id
    ? `${subagentInstruction(meta)}\n\n${text}`
    : text;
  prepareSendText(dispatchText, { raw: o.raw });
  await o.before_send?.({ session_id: name, launch_id: meta.launch_id, vendor: meta.kind,
    harness: agentHarness(meta.kind), event_cursor: startOffset, operation_id: operationId });
  if (meta.kind === "claude") {
    // durable／anonymousを分岐する前に同じsend preflightを通す。拒否されるpromptの
    // receipt／active markerだけを残して、来ないStopを待つ状態を作らない。
    prepareSendText(text, { raw: o.raw });
    if (operationId) {
      reserveClaudeOperation(meta, operationId);
    } else reserveAnonymousClaudeTurn(meta);
  }
  send(name, dispatchText, {
    enter: false,
    force: o.force,
    raw: o.raw,
    mark: false,
    rtk: false,
    preserveAgentOperation: meta.kind === "claude",
    bracketedPaste: true,
  });
  // Cursorの冷間起動ではbracketed pasteの反映が250msを超えることがある。本文がcomposerへ
  // 現れた実測をsubmit条件にし、未反映のままEnterだけを失う競合を作らない。
  if (meta.kind === "cursor") {
    const visible = await waitCursorPromptVisible(name, dispatchText);
    if (!visible.visible) {
      throw new AitermError(
        `vendor=cursor session=${name}\n` +
          "送信promptがCursorのcomposerへ反映されたことを確認できないため、Enterは送信していません。",
        2,
      );
    }
  } else {
    // Codex TUI は literal text 投入直後の Enter を取り落とすことがある。agent 経路だけ submit を分離する。
    await sleep(AGENT_SUBMIT_DELAY_MS);
  }
  sendKey(name, "Enter", { preserveAgentOperation: meta.kind === "claude" });
  let residue = await detectAgentSubmitResidue(name, meta.kind, dispatchText);
  // Cursorはcomposerへの貼付反映後でも最初のEnterを取り落とすことがある。本文残留を
  // 陽性観測した場合だけ同じEnterを一度再送し、再検査後も残る時は失敗として返す。
  residue = await retryCursorSubmitIfResidue(name, meta.kind, dispatchText, residue);
  assertAgentSubmitDelivered(name, meta.kind, residue);
  return {
    schema: "aiterm.agent-dispatch.v1",
    session_id: meta.aiterm_session,
    launch_id: meta.launch_id,
    vendor: meta.kind,
    harness: agentHarness(meta.kind),
    event_cursor: startOffset,
    operation_id: operationId,
    submit_residue: residue.residue,
    pane_input_recovery: paneInputRecovery,
  };
}

export interface AgentSteerReceipt extends Record<string, unknown> {
  schema: "aiterm.agent-steer.v1";
  session_id: string;
  launch_id: string;
  vendor: AgentKind;
  harness: AgentHarness;
  delivery: "steered" | "idle";
  // 打鍵前に行った pane 入力の回復（"fg" / "fg_stopped" / "stty_raw"）。何もしなければ空配列。
  pane_input_recovery: string[];
}

export async function steerAgentTurn(name: string, text: string): Promise<AgentSteerReceipt> {
  assertSessionName(name);
  const meta = loadAgentMetadata(name);
  if (!["codex", "grok", "composer"].includes(meta.kind)) {
    throw new AitermError("agent_steer はCodex/Grok agent sessionだけで使用できます", 2);
  }
  const receipt = {
    schema: "aiterm.agent-steer.v1" as const,
    session_id: meta.aiterm_session,
    launch_id: meta.launch_id,
    vendor: meta.kind,
    harness: agentHarness(meta.kind),
  };
  // 前面回復は busy 判定より先（bash 前面のままだと画面の実行中マーカーを読んでも打鍵が届かない）。
  const paneInputRecovery = await ensureAgentOwnsPaneInput(name, meta.kind);
  if (!isAgentTuiBusy(meta.kind, captureScreen(name, AGENT_TUI_READY_LINES))) {
    return { ...receipt, delivery: "idle", pane_input_recovery: paneInputRecovery };
  }
  send(name, text, {
    enter: false,
    force: true,
    raw: false,
    mark: false,
    rtk: false,
    bracketedPaste: true,
  });
  await sleep(AGENT_SUBMIT_DELAY_MS);
  sendKey(name, "Enter");
  return { ...receipt, delivery: "steered", pane_input_recovery: paneInputRecovery };
}

export async function runClaudeOperation({
  session_id: name,
  action,
  operation_id: operationIdInput,
  text,
  before_send,
}: {
  session_id: string;
  action: "issue" | "recover";
  operation_id: string;
  text?: string | null;
  before_send?: import("./agent-shared.js").BeforeAgentSend;
}): Promise<ClaudeOperationResult> {
  assertSessionName(name);
  if (action !== "issue" && action !== "recover") {
    throw new AitermError('action は "issue" または "recover" を指定してください', 2);
  }
  const operationId = validateOperationId(operationIdInput);
  const meta = loadAgentMetadata(name);
  if (meta.kind !== "claude") throw new AitermError("claude_turnはaiterm相関付きClaude agent sessionだけで使用できます", 2);

  let dispatchReceipt: AgentDispatchReceipt | null = null;
  if (action === "issue") {
    if (typeof text !== "string" || text.length === 0) {
      throw new AitermError("claude_turn issueには空でないtextが必要です", 2);
    }
    // v0.16.0: issue は dispatch-only。完了通知は aiterm-wait --operation、回収は recover が担う。
    dispatchReceipt = await dispatchAgentTurn(name, text, { operation_id: operationId, before_send });
  } else {
    if (text != null) throw new AitermError("claude_turn recoverにtextは指定できません", 2);
  }

  const inspected = inspectClaudeOperation(meta, operationId, action);
  // issue は dispatch の submit 座礁観測を捨てずに返す（観測を払ったのに信号を返さない契約矛盾を作らない）。
  const result = dispatchReceipt ? { ...inspected, submit_residue: dispatchReceipt.submit_residue } : inspected;
  if (action === "issue" && result.status === "pending") {
    return { ...result, status: "accepted" };
  }
  return result;
}

function inspectClaudeOperation(
  meta: AgentMetadata,
  operationId: string,
  action: "issue" | "recover",
): ClaudeOperationResult {
  const base = {
    schema: "aiterm.claude-operation-result.v1" as const,
    action,
    session_id: meta.aiterm_session,
    operation_id: operationId,
    submit_residue: null as boolean | null,
  };
  const active = readClaudeOperationMarker(meta);
  if (active) {
    if (active.operationId !== operationId) {
      throw new AitermError(
        `${active.operationId ? `別のoperation ${active.operationId}` : "operation_idなしのClaude turn"} が未解決です`,
        2,
      );
    }
    return { ...base, status: "pending", raw_output: null, reason: null };
  }
  if (!hasClaudeDispatchReceipt(meta, operationId)) {
    return { ...base, status: "unknown", raw_output: null, reason: "operation_not_found" };
  }
  const done = completedClaudeOperationEvent(meta, operationId);
  if (!done) return { ...base, status: "unknown", raw_output: null, reason: "result_unknown" };
  if (!meta.vendor_session_id && done.vendor_session_id) {
    bindAgentHarnessSession(meta, done);
    writeAgentMetadata(meta);
  }
  const rawOutput = readClaudeResultText(meta, done, operationId, transcriptUnavailable);
  return { ...base, status: "completed", raw_output: rawOutput, reason: null };
}

// ── 対話型エージェント起動（Claude / Codex / Grok Build(Grok) / Grok Build(Composer)）──────
// aiterm の永続端末に、指定モデルの対話エージェント TUI を起動する。以後は pty_read で画面を
// 読み、pty_send で操作する＝aiterm の対話パラダイムそのもの。モデルはツールごとに固定し、
// reasoning effort は引数で渡す。CLI 未導入環境は明示エラー（動くフリをしない）。

const THROUGHLINE_HANDOFF_CONTEXT_SCHEMA = "throughline.handoff_context.v1";
const PORTABLE_FORK_MISSION_SEPARATOR = "\n\n---\n\n## Portable fork mission\n\n";



export function composePortableForkPrompt(context: string, mission: string): string {
  return context + PORTABLE_FORK_MISSION_SEPARATOR + mission;
}

function portableForkPrompt(
  sourceSessionId: string,
  mission: string,
  supplementFile: string | null,
): string {
  const bin = resolveThroughlineBin();
  if (!bin) {
    throw new AitermError("Throughline CLIが見つかりません。portable forkのsessionは作成していません", 2);
  }
  const result = runThroughlineHandoffContext(bin, sourceSessionId, supplementFile);
  if (result.error || result.status !== 0) {
    throw new AitermError("Throughline handoff-contextの取得に失敗しました。portable forkのsessionは作成していません", 2);
  }

  let value: unknown;
  try {
    value = JSON.parse(result.stdout ?? "");
  } catch {
    value = null;
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as { schema?: unknown }).schema !== THROUGHLINE_HANDOFF_CONTEXT_SCHEMA ||
    (value as { status?: unknown }).status !== "ready" ||
    (value as { sessionId?: unknown }).sessionId !== sourceSessionId ||
    typeof (value as { context?: unknown }).context !== "string" ||
    !(value as { context: string }).context.trim()
  ) {
    throw new AitermError("Throughline handoff-contextの応答が不正です。portable forkのsessionは作成していません", 2);
  }
  return composePortableForkPrompt((value as { context: string }).context, mission);
}

/** harness CLI の存在だけを安全に要約する。認証状態・実行出力・解決先 path は返さない。 */
export function harnessLauncherDiagnostic(kind: AgentKind): DiagnosticStatus {
  try {
    return resolveAgentBin(kind) ? "ready" : "not_applicable";
  } catch {
    return "unverified";
  }
}


function buildAgentCmd(
  kind: AgentKind,
  bin: string,
  model: string | null,
  effort: string | null,
  prompt: string | null,
  meta: AgentMetadata | null = null,
): string {
  if (kind === "claude") return buildClaudeAgentCmd(bin, model, effort, prompt, meta);
  if (kind === "codex") return buildCodexAgentCmd(bin, model, effort, prompt, meta);
  if (kind === "cursor") return buildCursorAgentCmd(bin, model, effort, prompt, meta);
  return buildGrokAgentCmd(kind, bin, model, effort, prompt, meta);
}

function agentEnvPrefix(meta: AgentMetadata | null, sid: string, envVars: string[] = []): string {
  const inherited = envVars.flatMap((name) => {
    const value = process.env[name];
    return value === undefined ? [] : [`${name}=${shq(value)}`];
  });
  const tokens = (() => {
    if (!meta) return inherited;
    const common = [
      ...inherited,
      `AITERM_AGENT_KIND=${shq(meta.kind)}`,
      `AITERM_SESSION_ID=${shq(sid)}`,
      `AITERM_AGENT_SESSION_ID=${shq(sid)}`,
      `AITERM_AGENT_LAUNCH_ID=${shq(meta.launch_id)}`,
      `AITERM_AGENT_ROLE=${shq(meta.agent_role ?? "subagent")}`,
      `AITERM_AGENT_PARENT_SESSION_ID=${shq(meta.parent_session_id ?? "host-root")}`,
      `AITERM_AGENT_DEPTH=${shq(String(meta.delegation_depth ?? 1))}`,
      `AITERM_AGENT_LINEAGE=${shq(meta.lineage ?? `host-root>${meta.kind}:${sid}`)}`,
      `AITERM_AGENT_DELEGATION_ALLOWED=${shq(meta.delegation_allowed === true ? "true" : "false")}`,
    ];
    if (meta.kind === "claude" || meta.kind === "codex" || meta.kind === "cursor") return common;
    return [...grokEnvTokens(meta), ...common];
  })();
  return tokens.length ? tokens.join(" ") + " " : "";
}

function buildAgentLaunchNote(
  kind: AgentKind,
  model: string | null,
  effort: string | null,
  meta: AgentMetadata | null,
): string {
  if (kind === "claude") return claudeLaunchNote(model, effort, meta);
  if (kind === "cursor") return cursorLaunchNote(model, effort, meta);
  if (kind !== "codex") return grokLaunchNote(kind, model, effort, meta);
  return codexLaunchNote(model, effort, meta);
}

function claudeLaunchRequestDigest({
  sessionName,
  model,
  effort,
  cwd,
  agentDone,
}: {
  sessionName: string;
  model: string | null;
  effort: string | null;
  cwd: string | null;
  agentDone: boolean;
}): string {
  const canonical = JSON.stringify({
    schema: "aiterm.claude-agent-launch-request.v1",
    provider: "claude",
    session_name: sessionName,
    model,
    reasoning_effort: effort,
    cwd,
    managed_completion: agentDone,
  });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

function requireMatchingClaudeLaunch(name: string, operationId: string, requestDigest: string): AgentMetadata {
  const meta = loadAgentMetadata(name);
  if (meta.kind !== "claude") {
    throw new AitermError(`session '${name}' は相関対象のClaude agent sessionではありません`, 2);
  }
  if (meta.launch_operation_id !== operationId || meta.launch_request_digest !== requestDigest) {
    throw new AitermError(
      `session '${name}' のClaude launch identityが一致しません。既存sessionをcloseするまで再利用できません`,
      2,
    );
  }
  return meta;
}

function existingAgentLaunchResult(
  kind: AgentKind,
  sid: string,
  model: string | null,
  effort: string | null,
): [string, string] {
  return [
    sid,
    `${agentLabel(kind)} の相関済みlaunchを既存session ${sid} から回収した。` +
      `${buildAgentLaunchNote(kind, model, effort, null)}CLIは再送していません。\n${attachHint(sid)}`,
  ];
}

export function openAgent(
  kind: AgentKind,
  opts: {
    session_name?: string | null;
    model?: string | null;
    reasoning_effort?: string | null;
    cwd?: string | null;
    prompt?: string | null;
    agent_done?: boolean | null;
    launch_operation_id?: string | null;
    write_scope?: string;
    env_vars?: string[];
  } = {},
): [string, string] {
  const label = agentLabel(kind);
  // 前提検証は session を作る前に全部済ませる（失敗の残骸 session を作らない）。
  // model/effort → bin → cwd の順: model/effort 検証は CLI 不在の端末でも同じ結果になる（テスト可能性）。
  let model: string | null = null;
  if (opts.model != null) {
    model = opts.model.trim();
    if (!model) throw new AitermError("model が空文字です（省略するか有効なモデル名を指定してください）", 2);
  }
  const effort = opts.reasoning_effort ?? null;
  const writeScope = opts.write_scope;
  const envVars = opts.env_vars ?? [];
  for (const name of envVars) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new AitermError(`env_vars に無効な環境変数名があります: ${JSON.stringify(name)}`, 2);
    }
  }
  if (effort && kind === "claude" && !CLAUDE_EFFORTS.has(effort)) {
    throw new AitermError("Claude Code の reasoning_effort は low/medium/high/xhigh/max のいずれかです", 2);
  }
  if (kind === "cursor") validateCursorModelEffort(model, effort);
  const agentDone = !!opts.agent_done;
  const launchOperationId = opts.launch_operation_id == null
    ? null
    : validateOperationId(opts.launch_operation_id);
  if (launchOperationId !== null) {
    if (kind !== "claude") {
      throw new AitermError("launch_operation_idはClaude agentだけで指定できます", 2);
    }
    if (!opts.session_name) {
      throw new AitermError("launch_operation_idには明示session_nameが必要です", 2);
    }
    assertSessionName(opts.session_name);
    if (!agentDone) {
      throw new AitermError("launch_operation_idにはagent_done:trueが必要です", 2);
    }
    if (opts.prompt != null) {
      throw new AitermError("launch_operation_id付きlaunchにpromptは指定できません", 2);
    }
  }
  // 継承lineageの破損はsession作成前にfail loudする。root callerにはhost-root/depth 1を割り当てる。
  const lineageSeed = readAgentLineageSeed();
  let bin: string | null;
  try {
    bin = resolveAgentBin(kind);
  } catch (error) {
    ownTelemetryFailure("AITERM.VENDOR_LAUNCHER_FAILED", error, 2);
  }
  if (!bin) {
    const where = kind === "claude"
      ? "~/.local/bin/claude"
      : kind === "codex"
        ? "~/.local/bin/codex"
        : kind === "cursor"
          ? "~/.local/bin/cursor-agent"
          : "~/.grok/bin/grok";
    ownTelemetryFailure("AITERM.VENDOR_LAUNCHER_FAILED", new AitermError(`${label} の CLI が見つかりません（${where} か PATH が必要）`, 2), 2);
  }
  // cwd 検証（session を作る前に。cd 失敗はシェル内で静かに死に「起動した」と偽成功を返すため）。
  let cwd: string | null = null;
  if (opts.cwd != null) {
    if (!opts.cwd.trim()) {
      throw new AitermError("cwd が空文字です（省略するか有効なディレクトリを指定してください）", 2); // A6
    }
    if (opts.cwd.startsWith("~")) {
      // statSync は ~ を展開しない。「存在しません」でなく展開されない旨を正直に伝える（A6）。
      throw new AitermError(`cwd の ~ は展開されません。絶対パスで指定してください: ${opts.cwd}`, 2);
    }
    let st: fs.Stats | null = null;
    try {
      st = fs.statSync(opts.cwd);
    } catch {
      st = null;
    }
    if (!st || !st.isDirectory()) {
      throw new AitermError(`cwd '${opts.cwd}' がディレクトリとして存在しません`, 2);
    }
    cwd = opts.cwd;
  }
  const launchRequestDigest = launchOperationId === null
    ? null
    : claudeLaunchRequestDigest({
        sessionName: opts.session_name as string,
        model,
        effort,
        cwd,
        agentDone,
      });
  if (launchOperationId !== null && sessionExists(opts.session_name as string)) {
    requireMatchingClaudeLaunch(opts.session_name as string, launchOperationId, launchRequestDigest as string);
    return existingAgentLaunchResult("claude", opts.session_name as string, model, effort);
  }
  if (kind === "claude") assertClaudeAuthenticationReady(bin);
  if (kind === "cursor") assertCursorAuthenticationReady(bin);
  // Windows の起動コマンドは native psmux pane の Git Bash で走る（WSL 橋・/mnt/c 変換は
  // e3f5fc8 で全廃。bin/cwd は Windows パスの forward slash 形のまま渡す）。
  // 未検証リスク: npm グローバル導入の codex.cmd/.bat シムの対話 TUI 描画は実 Windows でしか確認
  // できない（CI 非対象。docs/03_audit-sweep-2026-07.md 参照）。native .exe の TUI 描画は
  // grok.exe で実測済み（2026-08-15）。
  // Windows の grok/composer は Windows native の grok.exe だけを起動する（オーナー裁定 2026-08-15:
  // WindowsネイティブはWindowsネイティブで完結させ、WSL2へ持ち込まない）。WSL 側 grok を起動すると
  // harness 実体が WSL process になり、auth・session 記録（events/chat_history）が WSL home 側へ分裂して
  // transcript／completion を回収できない（実被弾: 2026-08-15 olc-plan-review-grok2）。
  if (isWin && (kind === "grok" || kind === "composer") && !isWindowsNativeExecutable(bin)) {
    ownTelemetryFailure(
      "AITERM.VENDOR_LAUNCHER_FAILED",
      new AitermError(
        `Windows の ${label} launcher は Windows native の grok.exe だけを起動できます（現在の解決先: ${bin}）。` +
          "Windows 版 Grok CLI を導入するか、GROK_BIN に grok.exe の絶対パスを指定してください。",
        2,
      ),
      2,
    );
  }
  const binForCmd = agentBinForPaneShell(bin);
  const cwdForCmd = cwd ? paneCwdArgument(cwd) : cwd;
  const grokAuthPath = agentDone && (kind === "grok" || kind === "composer") ? resolveAndValidateGrokAuth(realGrokHome()) : null;
  if (kind === "grok" || kind === "composer") {
    const requestedModel = model ?? (kind === "composer" ? GROK_MODEL_DEFAULTS.composer : null);
    if (requestedModel) assertGrokModelAvailable(bin, cwd ?? process.cwd(), requestedModel);
  }
  if (kind === "cursor" && model) {
    assertCursorModelAvailable(bin, cwd ?? process.cwd(), model, effort);
  }

  let sid: string;
  let hint: string;
  try {
    [sid, hint] = openSession(opts.session_name ?? null, "bash", envVars);
  } catch (error) {
    if (launchOperationId !== null && sessionExists(opts.session_name as string)) {
      requireMatchingClaudeLaunch(opts.session_name as string, launchOperationId, launchRequestDigest as string);
      return existingAgentLaunchResult("claude", opts.session_name as string, model, effort);
    }
    throw error;
  }
  let launchNote = "";
  try {
    const lineageContext = createAgentLineageContext(kind, sid, lineageSeed);
    const meta = agentDone
      ? kind === "claude"
        ? createClaudeAgentMetadata(
            sid,
            cwd,
            opts.prompt ? "pending" : "none",
            launchOperationId,
            launchRequestDigest,
            lineageContext,
            model,
            effort,
          )
        : kind === "codex"
        ? createCodexAgentMetadata(sid, cwd, opts.prompt ? "pending" : "none", { model, effort }, writeScope, lineageContext)
        : kind === "cursor"
          ? createCursorAgentMetadata(sid, cwd, opts.prompt ? "pending" : "none", writeScope, lineageContext)
          : createGrokAgentMetadata(kind, sid, cwd, opts.prompt ? "pending" : "none", grokAuthPath, writeScope, lineageContext)
      : null;
    if (meta) {
      meta.agent_executable = bin;
      writeAgentMetadata(meta);
      agentMetadataNegativeCache.delete(sid);
    }
    launchNote = buildAgentLaunchNote(kind, model, effort, meta);
    const cmd = buildAgentCmd(kind, binForCmd, model, effort, opts.prompt ?? null, meta);
    const envPrefix = agentEnvPrefix(meta, sid, envVars);
    const full = cwdForCmd ? `cd ${shq(cwdForCmd)} && ${envPrefix}${cmd}` : `${envPrefix}${cmd}`;
    // force:true はagent sessionへの手動介入を表す。起動コマンド自体はAitermが組み立てて素送信する。
    send(sid, full, {
      enter: true,
      mark: false,
      force: true,
      rtk: false,
      raw: true,
      preserveAgentOperation: meta?.kind === "claude",
    });
  } catch (e) {
    const failure = telemetryOwnedFailure("AITERM.VENDOR_LAUNCHER_FAILED", e);
    // 起動コマンドを投入できなかった session は空のまま残る＝残骸を作らない。片付けてから元エラーを伝える。
    try {
      closeSessionInternal(sid, false);
    } catch {
      /* 片付け失敗より元エラーの伝達を優先 */
    }
    throw failure;
  }
  const driveHint =
    agentDone
      ? `TUI の描画には数秒かかる。少し置いてから pty_read(${sid}, screen:true) で画面を読み、` +
        `turnはpty_send(${sid}, "...")で送る（自動で非ブロックdispatch。${parentClientName === "codex-mcp-client" ? "回答本文はCodex親へ自動配送する" : "完了通知はaiterm-wait"}）。中断はpty_key(${sid}, "C-c")、` +
        `Stopが来ない場合の解除はpty_close(${sid})を使う。`
      : `TUI の描画には数秒かかる。少し置いてから pty_read(${sid}, screen:true) で画面を読み、` +
        `pty_send(${sid}, "...") で入力・pty_key(${sid}, "Enter"/"Up"/"C-c" 等) で操作する（対話）。`;
  return [
    sid,
    `${label} を session ${sid} で起動した。${launchNote}${agentDone ? "agent_done 待機が有効。" : ""}` +
      `${agentDone ? " 通常のproject／user環境を共有し、aiterm所有の完了相関とsub-agent lineageだけを加算。" : ""}\n${hint}\n` +
      driveHint +
      `起動直後に増分 pty_read すると空/半描画になり得るので screen:true を使う。`,
  ];
}


export class AgentLaunchPromptError extends AitermError {
  constructor(message: string, code: number, readonly session_id: string,
    readonly initial_prompt: InitialPromptDelivery, readonly event_cursor: number | null,
    readonly startup: AgentStartupResult = { status: "blocked", reason: initial_prompt.reason }) {
    super(message, code);
  }
}

export async function openAgentWithInitialPrompt(
  kind: AgentKind,
  opts: {
    session_name?: string | null;
    model?: string | null;
    reasoning_effort?: string | null;
    cwd?: string | null;
    prompt?: string | null;
    ready_timeout?: number | null;
    launch_operation_id?: string | null;
    write_scope?: string;
    throughline_source_session?: string | null;
    throughline_supplement_file?: string | null;
    env_vars?: string[];
    trust_project?: boolean;
    before_send?: import("./agent-shared.js").BeforeAgentSend;
  } = {},
): Promise<[string, string, number | null, boolean | null, InitialPromptDelivery, AgentStartupResult]> {
  const mission = opts.prompt ?? null;
  const sourceSessionId = opts.throughline_source_session ?? null;
  const supplementFile = opts.throughline_supplement_file ?? null;
  if (sourceSessionId !== null && !sourceSessionId.length) {
    throw new AitermError("throughline_source_sessionが空文字です", 2);
  }
  if (supplementFile !== null && !supplementFile.length) {
    throw new AitermError("throughline_supplement_fileが空文字です", 2);
  }
  if (supplementFile !== null && sourceSessionId === null) {
    throw new AitermError("throughline_supplement_file指定時はthroughline_source_sessionが必要です", 2);
  }
  if (sourceSessionId !== null && (mission === null || !mission.trim())) {
    throw new AitermError("throughline_source_session指定時はpromptにmissionが必要です", 2);
  }
  if (sourceSessionId !== null && opts.launch_operation_id != null) {
    throw new AitermError("throughline_source_sessionはlaunch_operation_idと併用できません", 2);
  }
  const prompt = sourceSessionId === null
    ? mission
    : portableForkPrompt(sourceSessionId, mission as string, supplementFile);
  if (opts.launch_operation_id != null && prompt !== null) {
    throw new AitermError("launch_operation_idはpromptなしのClaude相関launchだけで指定できます", 2);
  }
  // v0.16.0: launcher は常に managed（Stop hook つき）で立つ。手動運転したい場合は
  // pty_open で素の PTY を開き、harness CLI を自分で send する。
  // prompt無しはTUIを起動するだけ。prompt有りはharnessを問わず、TUI ready確認後の
  // sendInitialAgentPromptへ一本化する。Grokの--verbatim argvはCLIが本文をqueueへ置いただけで
  // turnを開始しない版があり、event_cursor=0を「実行中」と返すと利用側へ嘘をつく。
  if (!prompt) {
    const [sid, hint] = openAgent(kind, {
      session_name: opts.session_name ?? null,
      model: opts.model ?? null,
      reasoning_effort: opts.reasoning_effort ?? null,
      cwd: opts.cwd ?? null,
      prompt: null,
      agent_done: true,
      launch_operation_id: opts.launch_operation_id ?? null,
      write_scope: opts.write_scope,
      env_vars: opts.env_vars,
    });
    const delivery: InitialPromptDelivery = { status: "not_requested", reason: "not_requested", turn_started: false };
    let startup: AgentStartupResult = { status: "not_checked", reason: "startup_not_requested" };
    if (opts.trust_project === true) {
      try {
        startup = await prepareAgentInput(sid, loadAgentMetadata(sid), {
          trust_project: true, ready_timeout: opts.ready_timeout ?? undefined,
        });
      } catch (error) {
        throw new AgentLaunchPromptError(
          `session_id: ${sid}\n起動準備中に失敗しました。${error instanceof Error ? error.message : String(error)}`,
          error instanceof AitermError ? error.code : 1, sid, delivery, null,
          { status: "blocked", reason: "startup_failed" },
        );
      }
      if (startup.status !== "ready") throw new AgentLaunchPromptError(
        `session_id: ${sid}\n起動準備を完了できませんでした。reason=${startup.reason}`, 2, sid, delivery, null, startup,
      );
    }
    return [sid, hint, null, null, delivery, startup];
  }
  const [sid, hint] = openAgent(kind, {
    session_name: opts.session_name ?? null,
    model: opts.model ?? null,
    reasoning_effort: opts.reasoning_effort ?? null,
    cwd: opts.cwd ?? null,
    prompt: null,
    agent_done: true,
    launch_operation_id: opts.launch_operation_id ?? null,
    write_scope: opts.write_scope,
    env_vars: opts.env_vars,
  });
  try {
    const initial = await sendInitialAgentPrompt(sid, prompt, {
      ready_timeout: opts.ready_timeout ?? undefined,
      trust_project: opts.trust_project,
      before_send: opts.before_send,
    });
    return [sid, `${hint}\n${initial.text}`, initial.event_cursor, initial.submit_residue, initial.initial_prompt,
      { status: "ready", reason: "composer_ready" }];
  } catch (e) {
    const code = e instanceof AitermError ? e.code : 1;
    const message = e instanceof Error ? e.message : String(e);
    const meta = loadAgentMetadata(sid);
    throw new AgentLaunchPromptError(
      `session_id: ${sid}\n` +
        `起動後の初回 prompt 処理で失敗しました。session は調査/復旧用に残しています。\n${message}`,
      code, sid, meta.initial_prompt_delivery ?? { status: "not_sent", reason: "startup_failed", turn_started: false },
      meta.initial_prompt_cursor ?? null,
      { status: meta.initial_prompt_delivery?.status === "submitted_unconfirmed" ? "ready" : "blocked",
        reason: meta.initial_prompt_delivery?.reason ?? "startup_failed" },
    );
  }
}
