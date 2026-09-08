// Grok / Composer 固有の制御。Composer は grok CLI の別モデル起動プリセットであり、
// モデル既定値と表示名以外は Grok と完全共通（実測 2026-08-23 棚卸し・docs/32）。
// core 所有のサービス（transcript 行読取・rate limit 検知）は引数で注入し、
// 依存方向を core → harnesses → agent-shared の一方向に保つ。
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { AitermError } from "../errors.js";
import { spawnAgentControlCommand } from "../agent-resolver.js";
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
  GROK_TRANSCRIPT_INCREMENT_MAX_BYTES,
  agentHarness,
} from "../agent-shared.js";
import type { AgentKind, AgentMetadata, AgentDoneEvent, AgentWaitObservation, InitialPromptState, AgentLineageContext } from "../agent-shared.js";

const GROK_MODELS_MAX_BYTES = 1024 * 1024;
const GROK_MODELS_TIMEOUT_MS = 15_000;

// grok CLI はモデル未指定だと端末側 default に従うため、ツール契約として既定 slug を固定する。
// codex は既定 slug を持たず端末 config／CLI 既定に委ねる（起動応答で実効値を報告する）。
// 製品既定は検証済みGrok catalog世代へ固定する。callerの明示modelはlive catalogで別途照合する。
export const GROK_MODEL_DEFAULTS: Record<"grok" | "composer", string> = {
  grok: "grok-4.6",
  composer: "grok-composer-2.5-fast",
};

export function realGrokHome(): string {
  return path.resolve(process.env.GROK_HOME || path.join(process.env.HOME ?? os.homedir(), ".grok"));
}

export function resolveAndValidateGrokAuth(srcHome: string): string | null {
  const inheritedSet = Object.prototype.hasOwnProperty.call(process.env, "GROK_AUTH_PATH");
  const inherited = process.env.GROK_AUTH_PATH;
  if (inheritedSet && (!inherited || !path.isAbsolute(inherited))) throw new AitermError("GROK_AUTH_PATH は空でない絶対パスで指定してください", 2);
  const authPath = inherited ?? path.join(srcHome, "auth.json");
  if (fs.existsSync(authPath)) return authPath;
  if (!inheritedSet && process.env.XAI_API_KEY) return null;
  throw new AitermError("Grok 認証正本が見つかりません。先に grok login が必要です", 2);
}

export function grokModelCatalog(bin: string, cwd: string): string[] {
  const result = spawnAgentControlCommand(bin, ["models"], cwd, {
    cwd,
    encoding: "utf8",
    env: process.env,
    timeout: GROK_MODELS_TIMEOUT_MS,
    maxBuffer: GROK_MODELS_MAX_BYTES,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || `exit=${result.status ?? "unknown"}`;
    throw new AitermError(`Grok model catalog を取得できません: ${detail}`, 2);
  }
  const text = result.stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const marker = "Available models:";
  const start = text.indexOf(marker);
  if (start < 0) throw new AitermError("Grok model catalog の出力形式が不正です（Available models がありません）", 2);
  const models: string[] = [];
  for (const line of text.slice(start + marker.length).split(/\r?\n/)) {
    const match = line.match(/^\s{2}[-*]\s+(.+?)(?:\s+\(default\))?\s*$/);
    if (match?.[1]) models.push(match[1]);
  }
  if (models.length === 0) throw new AitermError("Grok model catalog に利用可能なmodelがありません", 2);
  return models;
}

export function assertGrokModelAvailable(bin: string, cwd: string, model: string): void {
  const models = grokModelCatalog(bin, cwd);
  if (!models.includes(model)) {
    throw new AitermError(
      `Grok model catalog に ${JSON.stringify(model)} がありません。利用可能: ${models.join(", ")}。` +
        "別modelへfallbackせず起動を中止しました",
      2,
    );
  }
}

export function grokSessionDirectory(meta: AgentMetadata): string | null {
  if ((meta.kind !== "grok" && meta.kind !== "composer") || !meta.grok_home || !meta.vendor_session_id) return null;
  const cwd = meta.cwd ?? process.cwd();
  return path.join(meta.grok_home, "sessions", encodeURIComponent(cwd), meta.vendor_session_id);
}

export function grokEventsTranscript(meta: AgentMetadata): string | null {
  const dir = grokSessionDirectory(meta);
  return dir ? path.join(dir, "events.jsonl") : null;
}

export function grokCompletionEvent(meta: AgentMetadata, record: any): AgentDoneEvent | null {
  if (
    (meta.kind !== "grok" && meta.kind !== "composer") ||
    record?.type !== "turn_ended" ||
    (record?.outcome !== "completed" && record?.outcome !== "cancelled" && record?.outcome !== "error")
  ) return null;
  const turnId = typeof record?.ts === "string" || typeof record?.ts === "number" ? String(record.ts) : null;
  return {
    type: "agent_done",
    vendor: meta.kind,
    aiterm_session: meta.aiterm_session,
    launch_id: meta.launch_id,
    vendor_session_id: meta.vendor_session_id,
    turn_id: turnId,
    operation_id: null,
    reason: `Grok transcript turn_ended:${record.outcome}`,
    // Grok CLIはAPIエラー等でturnを打ち切る時も turn_ended を書き、outcome だけが error になる
    // （実測: 手元の events.jsonl に outcome=error が17件）。完了と同じ境界だが結果は無い。
    done_status: record.outcome === "error" ? "turn_error" : "turn_done",
    stop_hook_active: false,
    at: typeof record?.ts === "string" ? record.ts : new Date().toISOString(),
  };
}

export function latestGrokCompletion(
  meta: AgentMetadata,
  readTranscriptLines: (file: string) => string[],
): AgentDoneEvent | null {
  const transcript = grokEventsTranscript(meta);
  if (!transcript || !fs.existsSync(transcript)) return null;
  let latest: AgentDoneEvent | null = null;
  for (const line of readTranscriptLines(transcript)) {
    if (!line.trim()) continue;
    try {
      latest = grokCompletionEvent(meta, JSON.parse(line)) ?? latest;
    } catch {
      // 末尾書込み中のlineは次の観測で完結してから読む。
    }
  }
  return latest;
}

export function grokInitializationComplete(meta: AgentMetadata): boolean {
  const transcript = grokEventsTranscript(meta);
  if (!transcript || !fs.existsSync(transcript)) return false;
  const size = safeStatSize(transcript);
  const from = Math.max(0, size - GROK_TRANSCRIPT_INCREMENT_MAX_BYTES);
  const lines = readFileRange(transcript, from, size).toString("utf8").split("\n");
  if (from > 0) lines.shift();
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const record = JSON.parse(line);
      if (record?.type === "mcp_init_completed") return true;
      if (record?.type === "mcp_init_started") return false;
    } catch {
      // 末尾書込み中や無関係な破損lineはready判定を進めない。
    }
  }
  return false;
}

export async function observeGrokDone(
  meta: AgentMetadata,
  timeout: number,
  requestedCursor: number | null | undefined,
  detectRateLimit: (kind: AgentKind, aitermSession: string) => string | null,
): Promise<AgentWaitObservation> {
  const metadataFile = agentMetadataPath(meta.aiterm_session, meta.launch_id);
  const transcript = grokEventsTranscript(meta);
  if (!transcript) throw new AitermError("Grok transcriptのsession相関情報がありません", 2);
  const startOffset = requestedCursor ?? safeStatSize(transcript);
  let cursor = startOffset;
  let carry = "";
  let malformedEvents = 0;
  let discardLeadingFragment = false;
  let initializedBoundary = false;
  const deadline = performance.now() + timeout * 1000;
  const observation = (
    outcome: AgentWaitObservation["outcome"],
    ev: AgentDoneEvent | null = null,
    rateLimit: string | null = null,
  ): AgentWaitObservation => ({
    schema: "aiterm.agent-wait-result.v1",
    session_id: meta.aiterm_session,
    launch_id: meta.launch_id,
    vendor: meta.kind,
    harness: agentHarness(meta.kind),
    outcome,
    operation_id: null,
    vendor_session_id: meta.vendor_session_id,
    turn_id: ev?.turn_id ?? null,
    malformed_events: malformedEvents,
    at: ev?.at ?? null,
    rate_limit: rateLimit,
    error: ev?.done_status === "turn_error" ? ev.reason : null,
  });

  for (;;) {
    if (!fs.existsSync(metadataFile)) return observation("closed");
    if (fs.existsSync(transcript)) {
      if (!initializedBoundary) {
        if (cursor > 0) {
          const previous = readFileRange(transcript, cursor - 1, cursor).toString("utf8");
          discardLeadingFragment = previous !== "\n";
        }
        initializedBoundary = true;
      }
      const size = safeStatSize(transcript);
      if (size < cursor) {
        throw new AitermError("Grok transcript が完了待機中に短くなりました。該当セッションを閉じて起動し直してください。", 2);
      }
      if (size - startOffset > GROK_TRANSCRIPT_INCREMENT_MAX_BYTES) {
        throw new AitermError("Grok transcript のturn増分が大きすぎます。該当セッションを閉じて起動し直してください。", 2);
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
        for (const line of parts) {
          if (!line.trim()) continue;
          if (Buffer.byteLength(line, "utf8") > AGENT_EVENT_MAX_BYTES) {
            malformedEvents++;
            continue;
          }
          try {
            const done = grokCompletionEvent(meta, JSON.parse(line));
            if (done) return observation(done.done_status === "turn_error" ? "error" : "done", done);
          } catch {
            malformedEvents++;
          }
        }
      }
    }
    {
      const limited = detectRateLimit(meta.kind, meta.aiterm_session);
      if (limited) return observation("rate_limited", null, limited);
    }
    if (performance.now() >= deadline) return observation(timeout === 0 ? "running" : "timeout");
    await sleep(AGENT_DONE_POLL_MS);
  }
}

export function buildGrokAgentCmd(
  kind: "grok" | "composer",
  bin: string,
  model: string | null,
  effort: string | null,
  prompt: string | null,
  meta: AgentMetadata | null,
): string {
  const parts: string[] = [shq(bin)];
  // grok / composer は同じ grok CLI をモデル違いで起動する。
  parts.push("--no-auto-update");
  // 無人起動の対象cwdはCLIの公式folder trust指定で登録し、確認画面にpromptを消費させない。
  if (meta?.kind === "grok" || meta?.kind === "composer") parts.push("--no-alt-screen", "--trust");
  parts.push("--model", shq(model ?? GROK_MODEL_DEFAULTS[kind]));
  if (effort) parts.push("--reasoning-effort", shq(effort));
  if ((meta?.kind === "grok" || meta?.kind === "composer") && meta.write_scope === "read-only") {
    // read-only は sandbox が実効書込み禁止を作るため、MCP ツール許可ダイアログの自動承認を
    // 付けても能力は増えない。無人 subagent が初回 MCP 使用の許可待ちで停止する実障害への対処。
    // read-only 以外の launch には付けない＝権限拡大しない。
    parts.push("--sandbox", "read-only", "--always-approve");
  }
  if ((meta?.kind === "grok" || meta?.kind === "composer") && meta.hook_route === "shared_grok_home") {
    parts.push("--session-id", shq(meta.vendor_session_id ?? ""), "--rules", shq(subagentInstruction(meta)));
  }
  if ((meta?.kind === "grok" || meta?.kind === "composer") && prompt) parts.push("--verbatim");
  if (prompt) parts.push(shq(prompt)); // 初手プロンプト（任意）
  return parts.join(" ");
}

export function grokLaunchNote(
  kind: "grok" | "composer",
  model: string | null,
  effort: string | null,
  meta: AgentMetadata | null,
): string {
  const writeScopeNote = writeScopeLaunchNote(kind, meta?.write_scope);
  return (
    `起動設定: model=${model ?? GROK_MODEL_DEFAULTS[kind]}（${model ? "引数" : "ツール既定"}）。` +
    `effort=${effort ?? "CLI／model既定"}。` + writeScopeNote
  );
}

// grok/composer: 検証済み auth 正本をそのままの path 形で渡す。Windows では native 強制により
// harness は Windows process なので、Windows ドライブパスが正しい形（WSL 形への変換はしない）。
export function grokEnvTokens(meta: AgentMetadata): string[] {
  return [
    ...(meta.grok_auth_path ? [`GROK_AUTH_PATH=${shq(meta.grok_auth_path)}`] : []),
    "GROK_DISABLE_AUTOUPDATER=1",
  ];
}

export function assertGrokSandboxNotRejected(screen: string): void {
  // Grok 1.0.13はsandboxを適用できないと入力欄を作らず終了する。
  // CLIが確定した拒否だけを拾い、警告単独や入力欄の引用では判定しない。
  const failure = screen.match(/^[ \t]*error: could not apply the 'read-only' sandbox profile;[^\n]*/m);
  if (!failure) return;
  const warning = screen.match(/^[ \t]*warning: sandbox could not be applied:[\s\S]*?(?=\n[ \t]*error:)/m);
  throw new AitermError(
    "GROK_SANDBOX_STARTUP_FAILED: Grok CLIがread-only sandboxを適用できず起動を拒否しました。文字列は送信していません。\n" +
      `${warning?.[0] ?? ""}\n${failure[0]}\n` +
      "CLIが示した設定の問題を、その設定の管理元で修正してください。修正後はpty_closeで対象sessionを閉じ、agent_launchで起動し直してください。",
    2,
  );
}

export function grokLaunchBlockingDialog(screen: string): string | null {
  const trustAt = screen.lastIndexOf("Do you trust the contents of this directory?");
  if (trustAt < 0) return null;
  const afterTrust = screen.slice(trustAt);
  if (!afterTrust.includes("Yes, proceed") || !afterTrust.includes("No, quit")) return null;
  // 古い確認画面より後に現在の入力欄がある場合は、scrollbackだけを根拠に停止しない。
  if (/(?:^|\n)[ \t]*(?:│[ \t]*)?[❯>]/u.test(afterTrust)) return null;
  return "folder trust確認ダイアログ";
}

export function grokTuiReady(screen: string): boolean {
  if (grokLaunchBlockingDialog(screen)) return false;
  // Grok Build 0.2.117 は起動完了後に製品名を消し、model footerだけを残す。
  // Composerも同じfrontendでmodel名だけが異なるため、両方をharness UIの根拠にする。
  // Windows native grok.exe（1.0.4 実測）は入力欄markerを `❯` でなく `>` で描画するため両方を受ける。
  const grokFrontend = screen.includes("Grok Build") || /\b(?:Grok|Composer)\s+[\w.()-]+/.test(screen);
  return grokFrontend && /(^|\n|\s)[❯>]/.test(screen);
}

export function grokTuiBusy(screen: string): boolean {
  // [hooks: 成功/失敗]は完了後も残る結果表示であり、実行中の根拠にはならない。
  return screen.includes("Waiting for response")
    || screen.includes("Responding…")
    || screen.includes("Responding...")
    || screen.includes("[stop]");
}

// submit座礁観測のcomposer領域マーカー（Windows native描画の `>` も ready 判定と同様に受ける）。
export const GROK_COMPOSER_MARKER_RE = /(^|\s)[❯>]/;

export function grokFooterHasConfiguration(screen: string, model: string | null, effort: string | null): boolean {
  const modelMatch = model?.match(/^grok-(\d+(?:\.\d+)*)$/) ?? null;
  if (model && !modelMatch) return false;
  const modelLabel = modelMatch ? `Grok ${modelMatch[1]}` : null;
  return screen.split("\n").some((line) => {
    if (!line.includes("·")) return false;
    if (modelLabel && !line.includes(`${modelLabel} (`)) return false;
    if (effort && !line.includes(`(${effort})`)) return false;
    return modelLabel !== null || effort !== null;
  });
}

// 最後のuser発話以降に確定した最後のassistantメッセージをchat_history.jsonlから抽出する。
export function grokTranscriptText(
  meta: AgentMetadata,
  readTranscriptLines: (file: string) => string[],
  transcriptUnavailable: () => never,
): string {
  if (!meta.grok_home || !meta.vendor_session_id) transcriptUnavailable();
  // cwd 未指定で起動した TUI はサーバープロセスの cwd を継承する。metadata に null が残る既存
  // launch との互換のため、その実際の起動 cwd を path 導出に使う（launch 側は変更しない）。
  const cwd = meta.cwd ?? process.cwd();
  const transcript = path.join(
    meta.grok_home,
    "sessions",
    encodeURIComponent(cwd),
    meta.vendor_session_id,
    "chat_history.jsonl",
  );
  const lines = readTranscriptLines(transcript);
  let lastUser = -1;
  const records: any[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      records.push(record);
      if (record?.type === "user" && !("synthetic_reason" in record)) lastUser = records.length - 1;
    } catch {
      // 外部 transcript の壊れた1行は残りの完結行を読む妨げにしない。
    }
  }
  const replies = records
    .slice(lastUser + 1)
    .filter((record) => record?.type === "assistant" && typeof record?.content === "string")
    .map((record) => record.content.trim())
    .filter(Boolean);
  return replies.at(-1) ?? "";
}

export function createGrokAgentMetadata(
  kind: "grok" | "composer",
  name: string,
  cwd: string | null,
  initialPrompt: InitialPromptState,
  authPath: string | null,
  writeScope?: string,
  lineageContext?: AgentLineageContext,
): AgentMetadata {
  const launchId = randomBytes(16).toString("hex");
  const eventFile = agentEventPath(name, launchId);
  createEmpty0600(eventFile);
  const grokHome = realGrokHome();
  const meta: AgentMetadata = {
    kind,
    aiterm_session: name,
    launch_id: launchId,
    event_file: eventFile,
    created_at: new Date().toISOString(),
    cwd,
    ...(writeScope === undefined ? {} : { write_scope: writeScope }),
    vendor_session_id: randomUUID(),
    initial_prompt: initialPrompt,
    hook_route: "shared_grok_home",
    completion_route: "grok_transcript",
    ...(lineageContext ? agentLineageFields(lineageContext) : {}),
    node_platform: process.platform,
    grok_home: grokHome,
    grok_auth_path: authPath,
  };
  writeAgentMetadata(meta);
  return meta;
}
