// Screen observations use supplied samples and clocks. They never create a
// session, send text/keys, or mutate agent metadata; core owns those effects.
import type { AgentKind } from "./agent-shared.js";
import { AitermError } from "./errors.js";
import { grokTuiReady, grokTuiBusy, grokPaneObservation, grokLaunchBlockingDialog, assertGrokSandboxNotRejected, GROK_COMPOSER_MARKER_RE } from "./harnesses/grok.js";
import { codexTuiReady, codexTuiBusy, codexPaneObservation, codexRateLimitModelSwitchDialog, CODEX_COMPOSER_MARKER_RE } from "./harnesses/codex.js";
import { claudeTuiReady, claudePaneObservation, claudeLoginMethodMenu, claudeStartupAction, CLAUDE_COMPOSER_MARKER_RE } from "./harnesses/claude.js";
import { cursorTuiReady, cursorPaneObservation, CURSOR_COMPOSER_CONTENT_MARKER_RE } from "./harnesses/cursor.js";


const AGENT_DONE_SETTLE_MIN_MS = 250;
const AGENT_DONE_SCREEN_SETTLE_POLL_MS = 100;
const AGENT_DONE_SCREEN_SETTLE_MAX_POLLS = 5;
const AGENT_DONE_SCREEN_SETTLE_MIN_SAMPLES = 3;
export const AGENT_TUI_READY_TIMEOUT_MS = 30_000;
// 画面が起動コマンドの表示のまま（agentがまだ何も描いていない）で上の待ちが切れた時に、起動から待つ上限。
// Codex親の既定のtool timeout（60秒）の内側に収める。越えると親には時間切れに見えたまま子へ初手が送られる。
export const AGENT_TUI_FIRST_DRAW_TIMEOUT_MS = 50_000;
const LAUNCH_ECHO_TAIL_CHARS = 24;
const LAUNCH_ECHO_MIN_CHARS = 8;
export const AGENT_TUI_READY_POLL_MS = 500;
const AGENT_TUI_READY_STABLE_SAMPLES = 11;
// 上の11回は、起動の途中に一瞬だけ出る入力欄を採らないための確かめ（ADR 0014）。席のharnessが自分の記録で
// 「この起動でturnを1つ終えていて、次のturnを始めていない」と示している時は起動の途中ではないので、短い間隔で
// 続けて確かめるだけで送る（ADR 0097）。記録で示せない時は、今までどおり11回。
const AGENT_TUI_SETTLED_STABLE_SAMPLES = 2;
const AGENT_TUI_SETTLED_POLL_MS = 100;
// submit座礁観測（dispatch後にcomposerへ送信textが残存していないかの有界チェック）
const AGENT_SUBMIT_RESIDUE_DELAY_MS = 250;
const AGENT_SUBMIT_RESIDUE_POLL_MS = 300;
const AGENT_SUBMIT_RESIDUE_MAX_SAMPLES = 5;
const AGENT_SUBMIT_RESIDUE_TAIL_CHARS = 32;
const AGENT_SUBMIT_RESIDUE_MIN_TAIL_CHARS = 8;
const CURSOR_PROMPT_VISIBLE_POLL_MS = 100;
const CURSOR_PROMPT_VISIBLE_MAX_SAMPLES = 50;

export interface AgentScreenSample {
  screen: string;
  logSize: number;
}

export interface AgentScreenSettleResult {
  unstable: boolean;
  samples: number;
}

export interface AgentTuiReadyWaitResult {
  ready: boolean;
  samples: number;
  lastScreen: string;
}
let agentTuiReadyStableSamplesTestOverride: number | null = null;


export function isAgentTuiReady(kind: AgentKind, screen: string): boolean {
  if (kind === "claude") return claudeTuiReady(screen);
  if (kind === "codex") return codexTuiReady(screen);
  if (kind === "cursor") return cursorTuiReady(screen);
  return grokTuiReady(screen);
}

// Codex/Claude は実行中に「(esc to interrupt)」、Cursor は「Working」＋
// 「ctrl+c to stop」を表示する（いずれも実機採取）。startup 側の処理（MCP initialize 等）が
// 走ったまま古い composer がscrollbackに残る画面は入力受付とみなさない。
// Grok は実機で `Waiting for response` / `Responding…` / `[stop]` を表示する。
export function isAgentTuiBusy(kind: AgentKind, screen: string): boolean {
  if (kind === "cursor") return /ctrl\+c to stop/i.test(screen);
  if (kind === "codex") return codexTuiBusy(screen);
  if (kind === "claude") return /esc to interrupt/i.test(screen);
  if (kind === "grok") {
    return grokTuiBusy(screen);
  }
  return false;
}

// ready gate 用: 入力欄マーカーがあっても busy 表示中は ready と数えない。
// frontend 推定（inferAgentFrontend）は「agent TUI が前面か」を見るだけなので isAgentTuiReady のまま。
export function isAgentTuiIdleReady(kind: AgentKind, screen: string): boolean {
  const observation = kind === "grok" ? grokPaneObservation(screen)
    : kind === "codex" ? codexPaneObservation(screen)
    : kind === "claude" ? claudePaneObservation(screen) : cursorPaneObservation(screen);
  return observation.state === "idle";
}

// 起動側が明示応答すべき既知UI。ここで自動承認せず、ready timeoutを待たずに
// `initial_prompt=not_sent`を返してsessionを生かしたままcallerへ制御を戻す。
function isAgentTuiActionRequired(kind: AgentKind, screen: string): boolean {
  if (kind === "grok") return grokLaunchBlockingDialog(screen) !== null;
  if (kind === "codex") {
    return codexPaneObservation(screen).state === "blocked";
  }
  if (kind === "claude") {
    return /new MCP servers? found in this project/iu.test(screen)
      || claudeLoginMethodMenu(screen)
      || claudeStartupAction(screen, false)?.kind === "initial_theme_selected"
      || screen.includes("Is this a project you created or one you trust")
      || screen.includes("trust this folder")
      || (screen.includes("Claude Code running in Bypass Permissions mode") && screen.includes("Yes, I accept"));
  }
  return false;
}

/**
 * 画面の末尾が、Aitermが打った起動コマンドの表示のままかを見る（純粋関数）。
 * 混んだ端末ではagentのTUIが描かれる前にready待ちが切れる。画面の最後の文字列が起動コマンドの一部なら、
 * agentはまだ何も描いていない。空白と行頭の継続prompt（`> `／`>> `）は端末の折返しとshellの表示なので比べない。
 */
export function launchEchoIsLastOnScreen(screen: string, launchLine: string): boolean {
  const command = launchLine.replace(/\s+/g, "");
  const lines = screen.split("\n");
  let tail = "";
  for (let i = lines.length - 1; i >= 0 && tail.length < LAUNCH_ECHO_TAIL_CHARS; i--) {
    tail = lines[i].replace(/^\s*>{1,2}(?:\s|$)/, "").replace(/\s+/g, "") + tail;
  }
  tail = tail.slice(-LAUNCH_ECHO_TAIL_CHARS);
  return tail.length >= LAUNCH_ECHO_MIN_CHARS && command.includes(tail);
}

export async function waitAgentTuiReadyImpl(
  kind: AgentKind,
  sample: () => string,
  sleepFn: (ms: number) => Promise<void>,
  opts: {
    timeoutMs?: number;
    pollMs?: number;
    stableSamples?: number;
    launchLine?: string;
    now?: () => number;
    // harnessの記録で、最後のturnが終わっていて次が始まっていないか。渡した時だけ、短い確かめで通す道を使う。
    turnSettled?: () => boolean;
    settledSamples?: number;
    settledPollMs?: number;
    codexRateLimitRecovery?: boolean;
  } = {},
): Promise<AgentTuiReadyWaitResult> {
  const timeoutMs = opts.timeoutMs ?? AGENT_TUI_READY_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? AGENT_TUI_READY_POLL_MS;
  const stableSamples = opts.stableSamples ?? agentTuiReadyStableSamplesTestOverride ?? AGENT_TUI_READY_STABLE_SAMPLES;
  const settledSamples = opts.settledSamples ?? AGENT_TUI_SETTLED_STABLE_SAMPLES;
  const settledPollMs = opts.settledPollMs ?? AGENT_TUI_SETTLED_POLL_MS;
  const now = opts.now ?? (() => performance.now());
  const start = now();
  let deadline = start + timeoutMs;
  // 呼ぶ側が既定より短い待ちを指定した時は、その待ちを守る（延ばさない）。
  const firstDrawDeadline = timeoutMs >= AGENT_TUI_READY_TIMEOUT_MS ? start + AGENT_TUI_FIRST_DRAW_TIMEOUT_MS : deadline;
  let samples = 0;
  let readyStreak = 0;
  let settledStreak = 0;
  let lastScreen = "";
  for (;;) {
    lastScreen = sample();
    samples++;
    if (kind === "grok") assertGrokSandboxNotRejected(lastScreen);
    if (isAgentTuiIdleReady(kind, lastScreen)) {
      readyStreak++;
      if (readyStreak >= stableSamples) return { ready: true, samples, lastScreen };
      if (opts.turnSettled?.()) {
        settledStreak++;
        if (settledStreak >= settledSamples) return { ready: true, samples, lastScreen };
      } else if (settledStreak > 0) {
        // 記録の上でturnが始まった。短い間隔で数えた分を、11回の確かめへ持ち越さない。
        settledStreak = 0;
        readyStreak = 1;
      }
    } else {
      readyStreak = 0;
      settledStreak = 0;
      // The one keep-current key can be accepted before the TUI redraws.
      // Wait for that exact handled modal to disappear; never resend its key.
      const recoveringModal = opts.codexRateLimitRecovery && kind === "codex"
        && codexRateLimitModelSwitchDialog(lastScreen) !== null;
      if (isAgentTuiActionRequired(kind, lastScreen) && !recoveringModal) return { ready: false, samples, lastScreen };
    }
    if (now() >= deadline) {
      // TUIが一度も描かれていない間に切れた時だけ、決めた上限まで待ちを延ばす。描かれた後の画面は今までどおり扱う。
      if (deadline >= firstDrawDeadline || opts.launchLine === undefined
        || !launchEchoIsLastOnScreen(lastScreen, opts.launchLine)) return { ready: false, samples, lastScreen };
      deadline = firstDrawDeadline;
    }
    await sleepFn(settledStreak > 0 ? settledPollMs : pollMs);
  }
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
  // grok は Windows native 描画（`>`・実測 1.0.4）も ready 判定と同様に受ける。
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

export async function detectAgentSubmitResidueImpl(
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

export interface CursorPromptVisibleResult {
  visible: boolean;
  samples: number;
}

export async function waitCursorPromptVisibleImpl(
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

export async function settleAgentDoneScreenImpl(
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

export function __testSetAgentTuiReadyStableSamples(value: number | null): void {
  if (value !== null && (!Number.isInteger(value) || value < 1 || value > 1000)) {
    throw new AitermError("test ready stable samplesが不正です", 2);
  }
  agentTuiReadyStableSamplesTestOverride = value;
}
