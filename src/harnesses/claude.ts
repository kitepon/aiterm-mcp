import { authUrl, type AgentAuthPlan, type AgentAuthStatus, type AgentAuthPane } from "../agent-auth.js";
// Claude Code 固有の制御。完了正本は launch 固有 Stop hook が書く event/result（ADR 0025）。
// core 所有のサービス（transcript 不在エラー）は引数で注入し、
// 依存方向を core → harnesses → agent-shared の一方向に保つ。
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AitermError } from "../errors.js";
import { modeBitsWorldAccessible } from "../tmux-runtime.js";
import { runAgentProtocolCommand, spawnAgentControlCommand } from "../agent-resolver.js";
import { claudeCatalogRoot } from "../claude-catalog-root.js";
import { catalogInvalid, catalogUnavailable, checkedCatalog, findJsonLine, processSummary, type AgentModelCatalog } from "../model-catalog.js";
import type { FastModeFailure } from "../fast-mode.js";
import {
  currentUid,
  writeJson0600,
  shq,
  subagentInstruction,
  AGENT_DEFAULT_PREFACE,
  writeScopeLaunchNote,
  agentEventPath,
  createEmpty0600,
  writeAgentMetadata,
  agentLineageFields,
  assertSessionName,
  agentsDir,
  LAUNCH_ID_RE,
  AGENT_EVENT_TAIL_BYTES,
  readFileRange,
} from "../agent-shared.js";
import type { AgentMetadata, AgentDoneEvent, InitialPromptState, AgentLineageContext } from "../agent-shared.js";

export const OPERATION_ID_RE = /^sha256:[0-9a-f]{64}$/;
export const CLAUDE_RESULT_MAX_BYTES = 4 * 1024 * 1024;
export const CLAUDE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

export function agentManagedClaudeSettingsPath(name: string, launchId: string): string {
  assertSessionName(name);
  if (!LAUNCH_ID_RE.test(launchId)) throw new AitermError(`launch_id が不正です: ${launchId}`, 2);
  return path.join(agentsDir(), `${name}.${launchId}.claude-settings.json`);
}

export function agentClaudeCallerPromptPath(name: string): string {
  assertSessionName(name);
  return path.join(agentsDir(), `${name}.claude-caller-prompt.md`);
}

export function agentClaudeCallerMcpPath(name: string): string {
  assertSessionName(name);
  return path.join(agentsDir(), `${name}.claude-caller-mcp.json`);
}

const CALLER_PROMPT_MAX = 512 * 1024;

/** Keep the caller's launch instructions and MCP servers beside the seat's own state; argv carries only the paths. */
export function writeClaudeCallerFiles(meta: AgentMetadata, prompt: string | null, mcp: Record<string, unknown> | null): void {
  if (prompt !== null) {
    if (!prompt.trim() || Buffer.byteLength(prompt, "utf8") > CALLER_PROMPT_MAX)
      throw new AitermError("append_system_prompt must be non-empty and at most 512 KiB", 2);
    const file = agentClaudeCallerPromptPath(meta.aiterm_session);
    fs.writeFileSync(file, prompt, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    meta.claude_caller_prompt_file = file;
  }
  if (mcp !== null) {
    const servers = (mcp as { mcpServers?: unknown }).mcpServers;
    if (Object.keys(mcp).some(key => key !== "mcpServers") || !servers || typeof servers !== "object" || Array.isArray(servers))
      throw new AitermError("mcp_config must be {mcpServers: {...}}", 2);
    const file = agentClaudeCallerMcpPath(meta.aiterm_session);
    writeJson0600(file, mcp);
    meta.claude_caller_mcp_file = file;
  }
}

export function agentClaudeResultPath(name: string, launchId: string): string {
  assertSessionName(name);
  if (!LAUNCH_ID_RE.test(launchId)) throw new AitermError(`launch_id が不正です: ${launchId}`, 2);
  return path.join(agentsDir(), `${name}.${launchId}.claude-result.json`);
}

export function agentClaudeOperationPath(name: string, launchId: string): string {
  assertSessionName(name);
  if (!LAUNCH_ID_RE.test(launchId)) throw new AitermError(`launch_id が不正です: ${launchId}`, 2);
  return path.join(agentsDir(), `${name}.${launchId}.claude-operation.json`);
}

export function agentClaudeApprovalReceiptPath(name: string, launchId: string): string {
  assertSessionName(name);
  if (!LAUNCH_ID_RE.test(launchId)) throw new AitermError(`launch_id が不正です: ${launchId}`, 2);
  return path.join(agentsDir(), `${name}.${launchId}.claude-approval.json`);
}

export function agentClaudeDispatchReceiptPath(name: string, launchId: string, operationId: string): string {
  assertSessionName(name);
  if (!LAUNCH_ID_RE.test(launchId)) throw new AitermError(`launch_id が不正です: ${launchId}`, 2);
  const validated = validateOperationId(operationId);
  return path.join(agentsDir(), `${name}.${launchId}.${validated.slice("sha256:".length)}.claude-dispatch`);
}

function claudeHookScriptPath(): string {
  // この module は dist/harnesses/ に置かれるが、stop hook 実体は dist/ 直下に build される。
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "claude-stop-hook.js");
}

// hook は子の pane の環境で動くので、PATH に node が無い親（Codexが起動したMCP等）でも動くよう絶対pathで呼ぶ。
// process.execPath は Homebrew では Cellar の版付き実体を指し、runtime の更新でその実体だけが消えて
// 生成済みの hook が exit 127 になる。Cellar の実体は同じ formula の opt（更新でも残る）へ置き換える。
export function hookNodeExecutable(execPath = process.execPath, exists: (file: string) => boolean = fs.existsSync): string {
  const brew = /^(.*)\/Cellar\/(node(?:@\d+)?)\/[^/]+\/bin\/node$/.exec(execPath);
  if (!brew) return execPath;
  const opt = `${brew[1]}/opt/${brew[2]}/bin/node`;
  return exists(opt) ? opt : "node";
}

function nodeHookCommand(hookScript: string): string {
  return `${shq(hookNodeExecutable())} ${shq(hookScript)}`;
}

export function createClaudeCorrelationSettings(
  name: string,
  launchId: string,
  model: string | null,
  effort: string | null,
): string {
  const hookScript = claudeHookScriptPath();
  if (!fs.existsSync(hookScript)) {
    throw new AitermError(`Claude Stop hook wrapper が見つかりません。npm run build を実行してください: ${hookScript}`, 2);
  }
  const settings = agentManagedClaudeSettingsPath(name, launchId);
  writeJson0600(settings, {
    ...(model ? { model } : {}),
    ...(effort ? { effortLevel: effort } : {}),
    // 席は必ず通常の速度で始める（ADR 0114）。--settingsは利用者の設定より強いので、共有の設定にfastModeが残っていても効かない。
    // ここへtrueは入れない: 後で/fast offにしても、機種を替えた時にClaude Codeがこの値を見てfastへ戻す。
    fastMode: false,
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: nodeHookCommand(hookScript),
              timeout: 10,
            },
          ],
        },
      ],
    },
  });
  return settings;
}

export function validateOperationId(operationId: unknown): string {
  if (typeof operationId !== "string" || !OPERATION_ID_RE.test(operationId)) {
    throw new AitermError("operation_id は sha256:<64 lowercase hex> で指定してください", 2);
  }
  return operationId;
}

export function readClaudeResultText(
  meta: AgentMetadata,
  done: AgentDoneEvent,
  operationId: string | null,
  transcriptUnavailable: () => never,
  mismatch: () => never = () => { throw new AitermError("TRANSCRIPT_RESULT_MISMATCH: Claude result file が完了eventと一致しません", 2); },
): string {
  if (meta.kind !== "claude" || !meta.result_file || !done.result_digest || done.result_bytes == null) {
    transcriptUnavailable();
  }
  let st: fs.Stats;
  try {
    st = fs.lstatSync(meta.result_file);
  } catch {
    transcriptUnavailable();
  }
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    st.uid !== currentUid() ||
    st.nlink !== 1 ||
    modeBitsWorldAccessible(st.mode) ||
    st.size > CLAUDE_RESULT_MAX_BYTES + 4096
  ) {
    throw new AitermError("Claude result file の安全検証に失敗しました", 2);
  }
  let result: any;
  try {
    result = JSON.parse(fs.readFileSync(meta.result_file, "utf8"));
  } catch {
    throw new AitermError("Claude result file を読めません", 2);
  }
  const keys = result && typeof result === "object" && !Array.isArray(result) ? Object.keys(result).sort() : [];
  if (
    keys.join(",") !== "operation_id,result_bytes,result_digest,schema,text,vendor_session_id" ||
    result.schema !== "aiterm.claude-turn-result.v2" ||
    result.operation_id !== done.operation_id ||
    (operationId !== null && result.operation_id !== operationId) ||
    result.vendor_session_id !== meta.vendor_session_id ||
    result.result_digest !== done.result_digest ||
    result.result_bytes !== done.result_bytes ||
    typeof result.text !== "string" ||
    Buffer.byteLength(result.text, "utf8") !== done.result_bytes ||
    createHash("sha256").update(result.text, "utf8").digest("hex") !== done.result_digest
  ) {
    mismatch();
  }
  return result.text;
}

const CLAUDE_MODELS_TIMEOUT_MS = 30_000;
const CLAUDE_MODELS_MAX_BYTES = 4 * 1024 * 1024;

// ultracodeはClaude Codeのsession設定で、`--effort ultracode` で有効になる（2.1.285実測：警告なしで受け付け、
// 未知の値は「Unknown --effort value」と警告して無視）。initializeのModelInfoは対応modelを返さないため、
// effortに対応したmodelへadapterが足し、その事実をadapter_effortsで示す。
const CLAUDE_ULTRACODE_NOTE =
  "Claude Codeの--effortが受け付けるsession設定（dynamic workflow）。initializeのModelInfoは対応modelを返さないため、Aitermがeffort対応modelへ足している";

/**
 * Claude Codeのmodel候補。公式Agent SDKのsupportedModels()と同じく、stream-jsonの制御要求 `initialize`
 * （SDKの公開型 SDKControlRequest／SDKControlInitializeResponse）の応答にある models を読む。
 * promptは送らず、sessionを保存せず、利用者のhookとMCP serverを起動しない。
 */
export async function claudeModelChoices(bin: string, cwd: string, env = process.env): Promise<AgentModelCatalog> {
  // Run in the catalog-only root so other processes writing the shared config cannot flip the list
  // (harness-contracts.md C1-C4). A cold root answers differently until its flag and catalog caches settle.
  let own = claudeCatalogRoot(env);
  if (!own) {
    const shared = await claudeModelChoicesOnce(bin, cwd, env);
    own = claudeCatalogRoot(env);
    if (!own) return shared;
  }
  let catalog!: AgentModelCatalog;
  for (let attempt = 0; attempt < CLAUDE_CATALOG_SETTLE_RUNS; attempt++) {
    catalog = await claudeModelChoicesOnce(bin, cwd, own.env);
    const digest = createHash("sha256").update(JSON.stringify(catalog)).digest("hex");
    if (digest === own.lastDigest()) return catalog;
    own.remember(digest);
  }
  return catalog;
}

const CLAUDE_CATALOG_SETTLE_RUNS = 4;

async function claudeModelChoicesOnce(bin: string, cwd: string, env: NodeJS.ProcessEnv): Promise<AgentModelCatalog> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-claude-models-"));
  try {
    const settings = path.join(dir, "settings.json");
    // fastMode: true を付けて聞くと、応答の fast_mode_disabled_reason が「このアカウントで使えない訳」になる
    // （付けないと sdk_opt_in_required が返るだけ）。promptは送らないので、fastで流れる番は無い。
    fs.writeFileSync(settings, JSON.stringify({ disableAllHooks: true, fastMode: true }), { mode: 0o600 });
    // Claude Codeは、起きてすぐは「fastの可否を確かめている最中（pending）」と答える事がある（その端末で初めて聞いた時。Windowsで見た）。
    // 少し置いて聞き直すと、アカウントの答え（使える、または使えない訳）が返る。
    for (let attempt = 0; ; attempt++) {
      const requestId = `aiterm-models-${randomUUID()}`;
      const request = { type: "control_request", request_id: requestId, request: { subtype: "initialize" } };
      const result = await runAgentProtocolCommand(bin, [
        "-p", "--output-format", "stream-json", "--verbose", "--input-format", "stream-json",
        "--no-session-persistence", "--strict-mcp-config", "--settings", settings,
      ], {
        cwd,
        env,
        input: JSON.stringify(request) + "\n",
        until: requestId,
        timeout: CLAUDE_MODELS_TIMEOUT_MS,
        maxBuffer: CLAUDE_MODELS_MAX_BYTES,
      });
      if (result.error || result.status !== 0) {
        throw catalogUnavailable("Claude Code", result.error?.message || result.stderr?.trim() || `exit=${result.status ?? "unknown"}`);
      }
      if (attempt < CLAUDE_FAST_PENDING_RETRIES && claudeFastStatePending(result.stdout, requestId)) {
        await new Promise((resolve) => setTimeout(resolve, CLAUDE_FAST_PENDING_WAIT_MS));
        continue;
      }
      return claudeCatalogFromInitialize(result.stdout, requestId, processSummary(result));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const CLAUDE_FAST_PENDING_RETRIES = 2;
const CLAUDE_FAST_PENDING_WAIT_MS = 1_500;

/** initializeの応答が、fastの可否を「確かめている最中」と答えているか。 */
export function claudeFastStatePending(stdout: string, requestId: string): boolean {
  const response = findJsonLine(stdout, (value) => value?.type === "control_response" && value.response?.request_id === requestId);
  return response?.response?.response?.fast_mode_disabled_reason === "pending";
}

// initializeの応答の fast_mode_disabled_reason と、Claude Codeが画面に出す文（2.1.296）。
const CLAUDE_FAST_DISABLED_TEXT: Readonly<Record<string, string>> = {
  extra_usage_disabled: "Fast mode requires usage credits",
  free: "Fast mode requires a paid subscription",
  preference: "Fast mode has been disabled by your organization",
  network_error: "Fast mode unavailable due to network connectivity issues",
  not_first_party: "Fast mode is only available when using the Anthropic API directly",
  disabled_by_env: "Fast mode is not available",
  model_not_allowed: "Opus is not in your organization's allowed models",
  unknown: "Fast mode is currently unavailable",
};

/**
 * initializeの応答の理由から、fastを使えない時の断りを作る。
 * 使える時（理由なし）と、まだ分からない時（pending）・聞き方の都合（sdk_opt_in_required）はnull。
 */
export function claudeFastUnavailable(reason: unknown): FastModeFailure | null {
  if (typeof reason !== "string" || !reason || reason === "pending" || reason === "sdk_opt_in_required") return null;
  const text = CLAUDE_FAST_DISABLED_TEXT[reason];
  return {
    code: "FAST_MODE_UNAVAILABLE",
    message: `FAST_MODE_UNAVAILABLE: Claude Codeが、このアカウントではファストを使えないと答えました（${reason}${text ? `: ${text}` : ""}）。`,
  };
}

/** stream-jsonのcontrol_response（initialize）からmodel候補を作る。 */
export function claudeCatalogFromInitialize(stdout: string, requestId: string, summary = ""): AgentModelCatalog {
  const response = findJsonLine(stdout, (value) => value?.type === "control_response" && value.response?.request_id === requestId);
  if (!response) throw catalogInvalid("Claude Code", `initializeの応答がありません${summary ? `（${summary}）` : ""}`);
  if (response.response.subtype !== "success") {
    throw catalogUnavailable("Claude Code", `initializeが拒否されました: ${String(response.response.error ?? response.response.subtype)}`);
  }
  const models = response.response.response?.models;
  if (!Array.isArray(models)) throw catalogInvalid("Claude Code", "initializeの応答に models がありません");
  const choices = models.map((model: any) => {
    if (typeof model?.value !== "string") throw catalogInvalid("Claude Code", "valueの無いmodelがあります");
    const levels = model.supportsEffort === true ? model.supportedEffortLevels : [];
    if (!Array.isArray(levels) || levels.some((level: unknown) => typeof level !== "string")) {
      throw catalogInvalid("Claude Code", `${model.value} の supportedEffortLevels を読めません`);
    }
    return {
      id: model.value,
      display_name: typeof model.displayName === "string" ? model.displayName : null,
      efforts: levels.length > 0 ? [...levels, "ultracode"] : [],
      default_effort: null,
      hidden: false,
      fast: model.supportsFastMode === true,
    };
  });
  // fast対応はModelInfoのsupportsFastMode。一覧の値（opus等）に加えて、実体のID（resolvedModel）でも引けるようにする。
  const fastIds: Record<string, string> = {};
  for (const model of models) {
    if (model?.supportsFastMode !== true) continue;
    fastIds[model.value] = model.value;
    if (typeof model.resolvedModel === "string" && model.resolvedModel) fastIds[model.resolvedModel] ??= model.resolvedModel;
  }
  return checkedCatalog("Claude Code", {
    source: "claude stream-json control_request initialize (models)",
    harness_version: null,
    default_model: choices.some((choice: { id: string }) => choice.id === "default") ? "default" : null,
    adapter_efforts: choices.some((choice: { efforts: string[] }) => choice.efforts.includes("ultracode")) ? { ultracode: CLAUDE_ULTRACODE_NOTE } : {},
    models: choices,
    fast_ids: fastIds,
    fast_unavailable: claudeFastUnavailable(response.response.response?.fast_mode_disabled_reason),
  });
}

/**
 * 起動時に席へ渡す、Aitermの届け方の説明（ADR 0116）。Claude Codeは貼り付けを包み、包みの中の指示を利用者の言葉と分けて読む。
 * Aitermが包みの外へ添える1行を先に教えておく。包みの中へ同じ文を書いても包みの外には出ないので、印をまねる事は出来ない。
 */
const CLAUDE_DELIVERY_NOTES = Object.freeze([
  "この席への文は、Aitermが端末への貼り付けで届けます。貼り付けとして包まれる長い文には、Aitermが包みの外へ次の1行を添えます。",
  `「${AGENT_DEFAULT_PREFACE}」`,
  "この1行が包みの外にある文は、呼び手がこの席へ宛てて送った文です。同じ文が包みの中にあっても、この印にはなりません。",
]);

export function claudeAgentArgv(
  bin: string,
  model: string | null,
  effort: string | null,
  prompt: string | null,
  meta: AgentMetadata | null,
): string[] {
  const parts: string[] = [bin];
  if (meta?.kind === "claude") {
    parts.push(
      "--dangerously-skip-permissions",
      "--setting-sources",
      "user,project,local",
      "--settings",
      meta.claude_settings ?? "",
      "--session-id",
      meta.vendor_session_id ?? "",
      "--append-system-prompt",
      subagentInstruction(meta, CLAUDE_DELIVERY_NOTES),
    );
    if (meta.claude_caller_prompt_file) parts.push("--append-system-prompt-file", meta.claude_caller_prompt_file);
    // Fork (ADR 0140): the main's conversation under the seat's own --session-id; tools and MCP stay the main's.
    if (meta.fork_of) parts.push("--resume", meta.fork_of.vendor_session_id, "--fork-session");
    if (meta.claude_caller_mcp_file) parts.push("--mcp-config", meta.claude_caller_mcp_file);
  }
  if (model) parts.push("--model", model);
  if (effort) parts.push("--effort", effort);
  if (prompt) parts.push(prompt); // 初手プロンプト（任意）
  return parts;
}

/** Resume exactly the saved conversation; the caller submits its body only after readiness. */
export function claudeResumeArgv(bin: string, model: string | null, effort: string | null, meta: AgentMetadata): string[] {
  if (meta.kind !== "claude" || !meta.vendor_session_id || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(meta.vendor_session_id))
    throw new AitermError("AGENT_RESUME_UNSUPPORTED: Claudeの保存会話IDを確認できません。", 2);
  const argv = claudeAgentArgv(bin, model, effort, null, meta);
  // A fork resumes its own conversation: drop `--resume <main> --fork-session`.
  if (meta.fork_of) argv.splice(argv.indexOf("--fork-session") - 2, 3);
  argv[argv.indexOf("--session-id")] = "--resume";
  return argv;
}

export function buildClaudeAgentCmd(
  bin: string, model: string | null, effort: string | null,
  prompt: string | null, meta: AgentMetadata | null,
): string {
  const argv = claudeAgentArgv(bin, model, effort, prompt, meta);
  const values = new Set(["--setting-sources", "--settings", "--session-id", "--resume", "--append-system-prompt", "--append-system-prompt-file", "--mcp-config", "--model", "--effort"]);
  return argv.map((arg, index) => index === 0 || values.has(argv[index - 1]) || (prompt && index === argv.length - 1)
    ? shq(arg) : arg).join(" ");
}

export function claudeLaunchNote(
  model: string | null,
  effort: string | null,
  meta: AgentMetadata | null,
): string {
  const writeScopeNote = writeScopeLaunchNote("claude", meta?.write_scope);
  return `起動設定: model=${model ?? "CLI既定"} effort=${effort ?? "CLI既定"}。${writeScopeNote}`;
}

// 会話が長くなると、起動時の見出し「Claude Code」は取得範囲から流れ出る。入力欄は❯行のすぐ上と下を罫線で挟む形で、
// 起動時の確認画面や通常shellの❯とは見分けられる。見出しが無い時はこの形でClaude CodeのTUIと判断する。
function claudeComposerBox(screen: string): boolean {
  const lines = screen.split(/\r?\n/u);
  const rule = /^\s*─{8,}\s*$/u;
  let marker = lines.length - 1;
  while (marker >= 0 && !/^\s*❯/u.test(lines[marker])) marker--;
  return marker > 0 && rule.test(lines[marker - 1]) && lines.slice(marker + 1).some(line => rule.test(line));
}

function claudeSecurityNotes(screen: string): boolean {
  const lines = screen.split(/\r?\n/u);
  const lastMarker = lines.map(line => /^\s*❯/u.test(line)).lastIndexOf(true);
  return lines.slice(lastMarker + 1).some(line => /^\s*Security notes:\s*$/.test(line))
    && /Press (?:Enter|Return) to continue/u.test(lines.slice(lastMarker + 1).join("\n"));
}

// Claude Code 2.1.318 (grove): "Updates to Consumer Terms and Policies" with "Accept terms · Help improve our AI models: ON/OFF".
export function claudeConsumerTermsUpdate(screen: string): boolean {
  const tail = screen.split("\n").slice(-32).join("\n");
  return tail.includes("Updates to Consumer Terms and Policies") && /^\s*[❯>]?\s*(?:\d+\.\s*)?Accept terms\b/mu.test(tail);
}

export function claudeTuiReady(screen: string): boolean {
  if (!screen.includes("Claude Code") && !claudeComposerBox(screen)) return false;
  if (claudeLoginMethodMenu(screen) || claudeSecurityNotes(screen)) return false;
  const lastMarker = screen.split(/\r?\n/u).filter((line) => /^\s*❯/u.test(line)).at(-1)?.trim();
  if (!lastMarker) return false;
  // Claude Code 2.1.251 のworkspace trust UIも選択カーソルに❯を使う。
  // 最後のmarker行だけを見ることで、古いtrust表示がscrollbackに残っていても
  // その下に描画された現在のcomposerを優先する。
  return !/^❯\s*(?:\d+\.|\[|Enable selected\b|No,\s*exit\b|Yes,\s*I trust this folder\b)/iu.test(lastMarker);
}

// Claude Codeは動いている間、入力欄の上へ進行行を出し続ける（2.1.291の実画面 2026-10-06）。
//   ✻ Swirling… (running UserPromptSubmit hook · 0s)
//   * Swirling…
//   ✶ Slithering… (3s · ↓ 225 tokens · thought for 2s)
//   ✢ コマンド実行中… (12s · ↓ 1.0k tokens · thinking)   ← 作業の一覧を使う時は、進行中の項目の文になる
//     ⎿  ◼ 下の命令を1回だけ動かす                      ← 一覧は進行行の下へ字下げで並ぶ
// 終わると同じ位置が「✻ Cogitated for 11s · done 4:45 AM」へ変わる（「…」が無く、「·」で区切る）。
const CLAUDE_PROGRESS_LINE_RE = /^[·✢✳✶✻✽*∗] [^·…\s][^·…]*…(?: \(.*\))?\s*$/u;

// 入力欄の上の罫線から上へ、空行と字下げの行を飛ばし、行頭から始まる最初の行が進行行かを見る。
// 会話欄の行（「●」の回答、「❯」の依頼文、字下げの道具の出力）は進行行の形にならない。
function claudeTurnProgress(screen: string): boolean {
  const lines = screen.split(/\r?\n/u);
  let marker = lines.length - 1;
  while (marker >= 0 && !CLAUDE_COMPOSER_MARKER_RE.test(lines[marker])) marker--;
  if (marker <= 0 || !/^\s*─{8,}\s*$/u.test(lines[marker - 1])) return false;
  for (let i = marker - 2; i >= 0; i--) {
    if (lines[i].trim() === "" || /^\s/u.test(lines[i])) continue;
    return CLAUDE_PROGRESS_LINE_RE.test(lines[i]);
  }
  return false;
}

// 足元の「esc to interrupt」は、貼り付けの知らせ（paste again to expand）へ置き換わる間は出ない。複数行のpromptを
// 送った後の約8秒がそうで、その間は動いているのに入力待ちと読んでいた（2.1.291、2026-10-06）。進行行も動作中の印にする。
export function claudeTuiBusy(screen: string): boolean {
  return claudeInterruptHint(screen) || claudeTurnProgress(screen);
}

// 「esc to interrupt」は、Claude Codeが動いている間に自分で出す印である。会話欄（回答・依頼文・道具の出力）や、
// 入力欄へ打ちかけの文にこの語があっても、動作中の印にしない。Aitermの中身を話している席は、止まった後も
// 画面にこの語が残り、動作中と読まれ続けていた。
// 入力欄（すぐ上が罫線の「❯」行）を見つけた時は、次の行だけを見る。
//   - 入力欄の下の罫線より後（足元の行）。
//   - 入力欄より上の、行頭から始まる行（古い版の進行行「✻ Musing… (esc to interrupt)」）。会話欄の行は
//     回答の印（「●」。macOSは「⏺」）か依頼文の印（「❯」「>」）で始まるか、字下げされている。
// 会話欄と見分けられない行は、今までどおり印にする（動いている席を入力待ちと読む方が害が大きい）。
// 入力欄の無い画面も、今までどおり末尾のどこにあっても印にする。
const CLAUDE_INTERRUPT_HINT_RE = /esc to interrupt/i;
function claudeInterruptHint(screen: string): boolean {
  const lines = screen.split("\n").slice(-32);
  const rule = /^\s*─{8,}\s*$/u;
  let marker = lines.length - 1;
  while (marker >= 0 && !CLAUDE_COMPOSER_MARKER_RE.test(lines[marker])) marker--;
  if (marker <= 0 || !rule.test(lines[marker - 1])) return CLAUDE_INTERRUPT_HINT_RE.test(lines.join("\n"));
  const below = lines.findIndex((line, i) => i > marker && rule.test(line));
  const footer = below < 0 ? marker + 1 : below + 1;
  return lines.some((line, i) => CLAUDE_INTERRUPT_HINT_RE.test(line)
    && (i >= footer || (i < marker - 1 && !/^(?:\s|[●⏺❯>])/u.test(line))));
}

export function claudePaneObservation(screen: string): import("../agent-shared.js").HarnessPaneObservation {
  const tail = screen.split("\n").slice(-32).join("\n");
  if (claudeLoginMethodMenu(screen) || claudeSecurityNotes(screen)) return { state: "blocked", reason: "vendor_onboarding_required" };
  if (/Do you want to proceed\?/.test(tail) && /(?:^|\n)\s*[❯>]?\s*\d+\.\s+(?:Yes|No)\s*$/m.test(tail))
    return { state: "blocked", reason: "tool_approval" };
  if (claudeTuiBusy(screen)) return { state: "busy", reason: "turn_running" };
  if (claudeTuiReady(screen)) return { state: "idle", reason: "composer_ready" };
  // The account holder's own choice (terms and model-training data); never answered by Aiterm. After ready, so a seat
  // that merely talks about this screen stays idle.
  if (claudeConsumerTermsUpdate(screen)) return { state: "blocked", reason: "vendor_onboarding_required" };
  if (/new MCP servers? found in this project/i.test(tail)) return { state: "blocked", reason: "project_mcp_consent" };
  if (claudeStartupAction(screen, false)) return { state: "blocked", reason: "startup_dialog" };
  return { state: "unknown", reason: "unrecognized_screen" };
}

// 利用上限で止まっているClaude Codeは、入力欄の下の枠線と権限表示の間へ知らせを出す（BellTeamコンテナの実画面 2026-09-28）。
//   ❯
//   ────────
//   ⚠ Usage limit reached · continuing automatically at 4:10pm · esc to cancel
//   ⏵⏵ bypass permissions on (shift+tab to cycle)
// 次のturnが始まると足元は描き直されて知らせは消える。会話欄の「● Usage limit reached」や依頼文の引用は
// 上限が明けても画面やpane logに残るので、今の状態として数えない。
export function claudeUsageLimit(screen: string): { message: string } | null {
  const lines = screen.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").split("\n");
  let composer = lines.length - 1;
  while (composer >= 0 && !CLAUDE_COMPOSER_MARKER_RE.test(lines[composer])) composer--;
  if (composer < 0) return null;
  const rule = lines.findIndex((line, i) => i > composer && /^\s*─{8,}\s*$/u.test(line));
  if (rule < 0) return null;
  for (const line of lines.slice(rule + 1)) {
    const hit = /^\s*(?:⚠\s*)?(Usage limit reached\b.*?)\s*(?:·\s*esc to cancel\s*)?$/iu.exec(line);
    if (hit) return { message: hit[1] };
  }
  return null;
}

// 利用枠に当たったClaude Code（2.1.296）は、番をAPIエラーで終えたあと自分で `/rate-limit-options` を開き、入力欄の代わりに
// 選ぶ画面を出す（BellTeamコンテナの実画面 2026-10-13。枠に当たっていない時に手で開くと、2の行が無い3行になる）。
//   ❯ /rate-limit-options
//   ────────
//     What do you want to do?
//
//     ❯ 1. Stop and wait for limit to reset
//       2. Wait here, then continue automatically at Oct 16, 8am
//       3. Switch to usage credits
//       4. Upgrade your plan
//
//     Enter to confirm · Esc to cancel
// この画面は貼り付けを捨て、Enterで選択中の行を選ぶ。打鍵の数字はEnter無しでその番を選び、「j」「k」は選択を動かす（実物で確かめた）。
// 開いている間は入力欄も足元の行も描かれないので、画面の最後の行が案内である事を、今開いている印にする。
// 会話欄に残った同じ文や引用の下には、入力欄と足元の行が描かれる。
export interface ClaudeSelectMenu { kind: "rate_limit_options" | "unknown"; heading: string | null }
const CLAUDE_SELECT_MENU_FOOT_RE = /^\s*Enter to confirm · Esc to cancel\s*$/u;
const CLAUDE_SELECT_MENU_ROW_RE = /^\s*(?:❯\s*)?\d+\.\s+\S/u;
export function claudeLiveSelectMenu(screen: string): ClaudeSelectMenu | null {
  const lines = screen.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").split(/\r?\n/u);
  let foot = lines.length - 1;
  while (foot >= 0 && lines[foot].trim() === "") foot--;
  if (foot < 0 || !CLAUDE_SELECT_MENU_FOOT_RE.test(lines[foot])) return null;
  // 案内から上へ、選ぶ行と空行を飛ばした最初の行が見出し。選ぶ行が1つも無い物は選ぶ画面と数えない。
  let rows = 0;
  let head = foot - 1;
  for (; head >= 0; head--) {
    if (lines[head].trim() === "") continue;
    if (!CLAUDE_SELECT_MENU_ROW_RE.test(lines[head])) break;
    rows++;
  }
  if (rows === 0) return null;
  const heading = head >= 0 ? lines[head].trim() : null;
  const rateLimit = heading === "What do you want to do?"
    && lines.slice(head + 1, foot).some((line) => /\bStop and wait for limit to reset\b/u.test(line));
  return { kind: rateLimit ? "rate_limit_options" : "unknown", heading };
}

// `/model` を引数なしで開いた選ぶ画面（2.1.293・2.1.296の実画面 2026-10-12）。Enterは選んだ値を端末の
// ~/.claude/settings.json へ新しい会話の既定として保存し、sはこの会話だけに使う。
//   Select model
//   Switch between Claude models. Your pick becomes the default for new
//   sessions. For other/previous model names, specify with --model.
//     1.  Default (recommended)  Opus 5.5 · Best for everyday, complex tasks
//   ↑ 2.  Opus 5.5               For complex work and everyday tasks
//   ❯ 4.  Sonnet 5.5 ✔           Most efficient for simpler tasks
//   ↓ 5.  Haiku 5.5              Fastest for quick answers
//      … +8 models
//   ◐ Medium effort (default) ←/→ to adjust       ← 非対応の行では「○ Effort not supported for Haiku 4.5」
//   Enter to set as default · s to use this session only · Esc to cancel
// 2.1.322は会話ごとに、別名の行と、2列目にその別名が今指す機種を出す形にもなる（キロ氏の再現 2026-11-10）。
//     1.  Default (recommended)  Opus 5.5 · Best for everyday, complex tasks
//   ❯ 2.  Opus ✔                 Opus 5.5 · Best for everyday, complex tasks
//     3.  Fable                  Fable 5.1 · Most capable for your hardest and …
// `resolved` はその2列目の機種名。説明だけの2列目（上の形）ではnull。
export interface ClaudeModelPickerRow { index: number; label: string; cursor: boolean; current: boolean; resolved: string | null }
export interface ClaudeModelPicker { rows: ClaudeModelPickerRow[]; effort: string | null; session_only: boolean }

function lastLineIndex(lines: string[], re: RegExp): number {
  for (let i = lines.length - 1; i >= 0; i--) if (re.test(lines[i])) return i;
  return -1;
}

export function claudeModelPicker(screen: string): ClaudeModelPicker | null {
  const lines = screen.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").split(/\r?\n/u);
  const head = lastLineIndex(lines, /^\s*Select model\s*$/u);
  if (head < 0) return null;
  const body = lines.slice(head + 1);
  const foot = body.findIndex((line) => /\bEsc to cancel\b/u.test(line));
  if (foot < 0) return null;
  const rows: ClaudeModelPickerRow[] = [];
  let effort: string | null = null;
  for (const line of body.slice(0, foot)) {
    const row = /^\s*([❯↓↑]\s+)?(\d+)\.\s+(.*?)\s*$/u.exec(line);
    if (row) {
      const [name, second = ""] = row[3].split(/\s{2,}/u);
      rows.push({
        index: Number(row[2]),
        label: name.replace(/\s*✔$/u, ""),
        cursor: row[1]?.includes("❯") === true,
        current: /✔$/u.test(name),
        resolved: /^([A-Z][\w.-]*(?: [A-Z][\w.-]*)* \d+(?:\.\d+)?)(?:\s+·\s.*)?$/u.exec(second)?.[1] ?? null,
      });
      continue;
    }
    const level = /(?:^|\s)(low|medium|high|xhigh|max) effort\b/iu.exec(line);
    if (level) effort = level[1].toLowerCase();
  }
  if (rows.length === 0) return null;
  return { rows, effort, session_only: /\bs to use this session only\b/u.test(body[foot]) };
}

/**
 * 指定されたmodel（catalogのID・別名・表示名）が、選ぶ画面のどの行かを決める。
 * `claude-opus-5-5` は「Opus 5.5」、別名の `opus` はその系統で番号が一番若い行（catalogの並びで最新）。
 */
export function claudeModelPickerRow(rows: ClaudeModelPickerRow[], model: string): ClaudeModelPickerRow | null {
  const want = model.trim().toLowerCase();
  const sorted = [...rows].sort((a, b) => a.index - b.index);
  return claudePickerRowByName(sorted, claudeModelDisplayName(want))
    ?? (want === "default" ? sorted.find((row) => /^default\b/iu.test(row.label)) : undefined)
    ?? (/^[a-z]+$/u.test(want) ? sorted.find((row) => row.label.toLowerCase().startsWith(`${want} `) && /^\S+ \d/u.test(row.label)) : undefined)
    ?? null;
}

/** `claude-fable-5-2` → `fable 5.2`。IDの形でなければ小文字にしただけの物。 */
export function claudeModelDisplayName(model: string): string {
  const want = model.trim().toLowerCase();
  const id = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/u.exec(want);
  return id ? `${id[1]} ${id[2]}${id[3] ? `.${id[3]}` : ""}` : want;
}

/** 名前が1列目と同じ行。無ければ、2列目の機種名が同じ行（Default行を除き、1行だけの時）。 */
export function claudePickerRowByName(rows: ClaudeModelPickerRow[], name: string): ClaudeModelPickerRow | null {
  const want = name.trim().toLowerCase();
  const byLabel = rows.find((row) => row.label.toLowerCase() === want);
  if (byLabel) return byLabel;
  const byResolved = rows.filter((row) => !/^default\b/iu.test(row.label) && row.resolved?.toLowerCase() === want);
  return byResolved.length === 1 ? byResolved[0] : null;
}

// 会話が今のmodelでcacheされている時だけ、sの後に出る確かめ（2.1.293・2.1.296）。
//   Switch model?
//   Your next response will be slower and use more tokens
//   ❯ 1. Yes, switch to Opus 5.5
//     2. No, go back
export function claudeModelSwitchConfirm(screen: string): "yes_selected" | "other_selected" | null {
  const lines = screen.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").split(/\r?\n/u);
  const head = lastLineIndex(lines, /^\s*Switch model\?\s*$/u);
  if (head < 0) return null;
  const body = lines.slice(head + 1);
  if (!body.some((line) => /^\s*(?:❯\s*)?1\.\s*Yes, switch to\b/u.test(line))) return null;
  return body.some((line) => /^\s*❯\s*1\.\s*Yes, switch to\b/u.test(line)) ? "yes_selected" : "other_selected";
}

// 選ぶ画面を閉じた後、最後の `/model` の下に出る1件の知らせ。長い機種名では折り返す。
//   ❯ /model
//     ⎿  Set model to Opus 5.5 for this session only with high effort
//     ⎿  Set model to Opus 5.5 and saved as your default for new sessions
//     ⎿  Kept model as Sonnet 5.5
export type ClaudeModelSwitchScope = "session_only" | "saved_as_default" | "kept" | "blocked";
export function claudeModelSwitchResult(screen: string): { scope: ClaudeModelSwitchScope; line: string } | null {
  const lines = screen.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").split(/\r?\n/u);
  const command = lastLineIndex(lines, /^\s*❯\s*\/model\s*$/u);
  if (command < 0) return null;
  const start = lines.findIndex((line, i) => i > command && /^\s*⎿\s+\S/u.test(line));
  if (start < 0) return null;
  const parts = [lines[start].replace(/^\s*⎿\s+/u, "").trim()];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s{3,}\S/u.test(line) || /^\s*⎿/u.test(line)) break;
    parts.push(line.trim());
  }
  const line = parts.join(" ");
  if (/\bblocked by a PreModelSwitch hook\b/u.test(line)) return { scope: "blocked", line };
  if (/^Kept model as\b/u.test(line)) return { scope: "kept", line };
  if (!/^(?:Set model to|Model set to)\b/u.test(line)) return null;
  if (/\bsaved as your default\b/u.test(line)) return { scope: "saved_as_default", line };
  return /\bfor this session only\b/u.test(line) ? { scope: "session_only", line } : null;
}

// Claude Code 2.1.282 は選択肢へ「1.」などの番号を付ける。番号の有無のどちらも受ける。
export function claudeLoginMethodMenu(screen: string): boolean {
  const tail = screen.split("\n").slice(-32).join("\n");
  const lastMarker = tail.split(/\r?\n/u).filter(line => /^\s*❯/u.test(line)).at(-1)?.trim();
  return tail.includes("Select login method:")
    && /^❯\s*(?:\d+\.\s*)?(?:Claude account with subscription|Anthropic Console account|3rd-party platform)/u.test(lastMarker ?? "");
}

export function claudeStartupAction(screen: string, trustProject: boolean): import("../agent-shared.js").StartupAction | null {
  const tail = screen.split("\n").slice(-32).join("\n");
  const lastMarker = tail.split(/\r?\n/u).filter(line => /^\s*❯/u.test(line)).at(-1)?.trim();
  if (tail.includes("Choose the text style that looks best with your terminal")
    && /^❯\s*[1-7]\.\s*(?:Auto \(match terminal\)|Dark mode|Light mode)/u.test(lastMarker ?? ""))
    return { kind: "initial_theme_selected", keys: ["Enter"] };
  // 既存launcherで扱っていた2確認は従来の起動契約を維持する。
  if (screen.includes("Is this a project you created or one you trust")
    && screen.includes("No, exit") && screen.includes("Yes, I trust this folder"))
    return { kind: "workspace_trusted", keys: ["Down", "Enter"], selected: /^❯\s*(?:\d+\.\s*)?Yes, I trust this folder\b/u };
  if (screen.includes("Claude Code running in Bypass Permissions mode")
    && screen.includes("No, exit") && screen.includes("Yes, I accept"))
    return { kind: "configured_permission_mode_confirmed", keys: ["Down", "Enter"], selected: /^❯\s*(?:\d+\.\s*)?Yes, I accept\b/u };
  if (!trustProject) return null;
  if (/New MCP server found in this project:/.test(screen))
    return { kind: "project_mcp_enabled", keys: ["Down", "Enter"] };
  if (/new MCP servers found in this project/i.test(screen) && screen.includes("Enable selected")) {
    const selected = screen.split("\n").filter(line => /\[✔\]/u.test(line));
    if (selected.length && selected.some(line => /❯/.test(line)))
      return { kind: "project_mcp_enabled", keys: [...selected.map(() => "Down"), "Enter"] };
  }
  return null;
}

// submit座礁観測のcomposer領域マーカー（ready判定と同じ記号を行頭基準で探す）。
export const CLAUDE_COMPOSER_MARKER_RE = /^\s*❯/;

export function createClaudeAgentMetadata(
  name: string,
  cwd: string | null,
  initialPrompt: InitialPromptState,
  launchOperationId: string | null,
  launchRequestDigest: string | null,
  lineageContext: AgentLineageContext,
  model: string | null,
  effort: string | null,
  claudeHome: string = claudeConfigDir(),
): AgentMetadata {
  // Claude Codeはリンクを解決したcwdでproject slugを作る。起動時に固定し、記録の監視時に再解決しない。
  const transcriptCwd = cwd === null ? null : fs.realpathSync(cwd);
  const launchId = randomBytes(16).toString("hex");
  const eventFile = agentEventPath(name, launchId);
  const resultFile = agentClaudeResultPath(name, launchId);
  createEmpty0600(eventFile);
  createEmpty0600(resultFile);
  const claudeSettings = createClaudeCorrelationSettings(name, launchId, model, effort);
  const meta: AgentMetadata = {
    kind: "claude",
    aiterm_session: name,
    launch_id: launchId,
    event_file: eventFile,
    created_at: new Date().toISOString(),
    cwd: transcriptCwd,
    vendor_session_id: randomUUID(),
    initial_prompt: initialPrompt,
    launch_operation_id: launchOperationId,
    launch_request_digest: launchRequestDigest,
    hook_route: "shared_claude_settings",
    ...agentLineageFields(lineageContext),
    node_platform: process.platform,
    claude_settings: claudeSettings,
    claude_home: path.resolve(cwd ?? process.cwd(), claudeHome),
    result_file: resultFile,
  };
  writeAgentMetadata(meta);
  return meta;
}

// ---------------------------------------------------------------- APIエラー終了の検知（会話記録）
// Claude CodeはAPIエラー（529 Overloaded等）でturnを打ち切る時、Stop hookを走らせない。
// 代わりに会話記録（<config dir>/projects/<cwd slug>/<session-id>.jsonl）へ
// `type:"assistant", isApiErrorMessage:true, apiErrorStatus:<code>` の1行を書く（実測 2026-09-03、
// BellTeamのチャイム席で70分の待機を生んだ529）。完了eventだけを待つと永久に running になるため、
// dispatch後に増えた記録行からこの印を読み、outcome=error として親へ返す。

export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? path.join(process.env.HOME ?? os.homedir(), ".claude");
}

// Claude Codeのproject slug: cwdの英数字以外を1文字ずつ "-" にする（実測: "/Users/kite/.throughline-x" → "-Users-kite--throughline-x"）。
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

export function claudeSessionTranscriptPath(meta: AgentMetadata): string | null {
  if (meta.kind !== "claude" || !meta.vendor_session_id) return null;
  return path.join(
    meta.claude_home ?? claudeConfigDir(),
    "projects",
    claudeProjectSlug(meta.cwd ?? process.cwd()),
    `${meta.vendor_session_id}.jsonl`,
  );
}

export interface ClaudeApiError {
  text: string;
  at: string | null;
  status: number | null;
  session_id: string | null;
  uuid: string | null;
  parent_uuid: string | null;
  /** The CLI's own error kind (`error` field, e.g. "rate_limit"); the limit record carries no apiErrorStatus. */
  kind: string | null;
}

export function claudeApiErrorFromLine(line: string): ClaudeApiError | null {
  if (!line.trim()) return null;
  let record: any;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  if (record?.type !== "assistant" || record?.isApiErrorMessage !== true || record.isSidechain === true) return null;
  const content = record?.message?.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part: any) => (typeof part?.text === "string" ? part.text : "")).join("")
      : "";
  const status = record?.apiErrorStatus;
  return {
    text: text.trim() || (status != null ? `API Error: ${String(status)}` : "API Error"),
    at: typeof record?.timestamp === "string" ? record.timestamp : null,
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    session_id: typeof record.sessionId === "string" ? record.sessionId : null,
    uuid: typeof record.uuid === "string" ? record.uuid : null,
    parent_uuid: typeof record.parentUuid === "string" ? record.parentUuid : null,
    kind: typeof record.error === "string" ? record.error : null,
  };
}

export function claudeFailureCategory(error: ClaudeApiError): "capacity" | "rate_limited" | "transient" | "authentication" | "other" {
  if (error.status === 429 || error.kind === "rate_limit" || /^You've (?:reached your [^.\r\n]{1,80} limit\.|hit your (?:[a-z0-9-]+ ){0,3}limit\b)/i.test(error.text)) return "rate_limited";
  // The real record (2.1.310, 2.1.319): error "authentication_failed", no apiErrorStatus, "Login expired · Please run /login".
  if (error.kind === "authentication_failed" || error.status === 401
    || (error.kind === null && error.status === null && /Please run \/login|OAuth token (?:has been )?revoked|Invalid API key/i.test(error.text))) return "authentication";
  if (error.status === 529) return "capacity";
  return error.status !== null && error.status >= 500 ? "transient" : "other";
}

// 利用上限のAPIエラー（error:"rate_limit"）ではStopも発火する（実測 2026-11-09、Fable上限で19回）。
// Stopの時点で、その番の最後のassistant記録がAPIエラーなら、その番は誤りで終わっている。
// 次の番の記録はStopより後に書かれるので、Stopの時刻までの最後の記録だけを見る。
export function claudeApiErrorEndingTurn(meta: AgentMetadata, stopAt: string): ClaudeApiError | null {
  const file = claudeSessionTranscriptPath(meta);
  const stop = Date.parse(stopAt);
  if (!file || !Number.isFinite(stop)) return null;
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const lines = readFileRange(file, Math.max(0, size - AGENT_EVENT_TAIL_BYTES), size).toString("utf8").split("\n");
  lines.pop();
  for (const line of lines.reverse()) {
    let record: any;
    try { record = JSON.parse(line); } catch { continue; }
    if ((record?.type !== "assistant" && record?.type !== "user") || record.isSidechain === true
      || (record.sessionId && record.sessionId !== meta.vendor_session_id)) continue;
    const at = Date.parse(record.timestamp);
    if (!Number.isFinite(at) || at > stop) continue;
    // 先にuser行（この番の入力かtool結果）が来たら、この番の最後の答えはまだ書かれていない。前の番の誤りを持ち出さない。
    return record.type === "assistant" ? claudeApiErrorFromLine(line) : null;
  }
  return null;
}

// Stopが発火しないエラー終了を、現在のturn開始後の会話記録だけから判定する。
export function claudeApiErrorAfter(meta: AgentMetadata, startedAtMs: number): ClaudeApiError | null {
  const file = claudeSessionTranscriptPath(meta);
  if (!file) return null;
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const lines = readFileRange(file, Math.max(0, size - AGENT_EVENT_TAIL_BYTES), size).toString("utf8").split("\n");
  lines.pop(); // 改行まで書かれた記録だけを扱う。
  for (const line of lines.reverse()) {
    const error = claudeApiErrorFromLine(line);
    if (error?.at && (error.session_id === null || error.session_id === meta.vendor_session_id) && Date.parse(error.at) >= startedAtMs) return error;
  }
  return null;
}


// ---- login "oauth_token" (BellTeam Claude 2nd slot, Owner ruling 2026-11-09): `claude setup-token` prints a 1-year token once;
// Aiterm, as the PTY owner, writes it to the slot's token file. The CLI keeps no copy, so the file is the credential.
const OAUTH_TOKEN_RE = /sk-ant-oat01-[A-Za-z0-9_-]{20,}/g;

/** The only accepted token file: `<HOME>/.bellteam-accounts/claude/<slot>/oauth-token`. Anything else is refused before any start. */
export function claudeOauthTokenFile(file: unknown): string {
  const home = process.env.HOME ?? os.homedir();
  const slot = typeof file === "string" && path.isAbsolute(file) && path.basename(file) === "oauth-token" ? path.basename(path.dirname(file)) : "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(slot) || file !== path.join(home, ".bellteam-accounts", "claude", slot, "oauth-token"))
    throw new AitermError("AGENT_AUTH_TOKEN_FILE_REJECTED: token_fileは<HOME>/.bellteam-accounts/claude/<slot>/oauth-tokenだけを受けます。開始していません。", 2);
  return file;
}

export function claudeSetupTokenPlan(): AgentAuthPlan { return { args: ["setup-token"], env: [] }; }

/** The token on the setup-token screen, only when exactly one distinct token is shown. */
export function claudeOauthToken(screen: string): string | null {
  const found = new Set(screen.match(OAUTH_TOKEN_RE) ?? []);
  return found.size === 1 ? [...found][0] : null;
}

/** Authenticated iff the token file is this user's non-empty regular 0600 file (POSIX; Windows has no such mode bits). */
export function claudeOauthTokenPresent(file: string): boolean {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(file); } catch { return false; }
  if (!stat.isFile() || stat.size === 0) return false;
  return process.platform === "win32" || ((stat.mode & 0o777) === 0o600 && stat.uid === process.getuid!());
}

/** tmp + fsync + rename in the same directory, then fsync the directory. An older token is replaced (the Owner's relogin). */
export function writeClaudeOauthToken(file: string, token: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.oauth-token.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  const bytes = Buffer.from(token, "utf8");
  try {
    const fd = fs.openSync(tmp, "wx", 0o600);
    try { fs.writeSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } catch (error) { try { fs.unlinkSync(tmp); } catch { /* not created */ } throw error; }
  finally { bytes.fill(0); }
  if (process.platform !== "win32") { const fd = fs.openSync(dir, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
}

export function claudeAuthPlan(onboarding = false): AgentAuthPlan { return { args: onboarding ? [] : ["auth", "login"], env: [] }; }

export function claudeAuthStatus(bin: string, cwd: string, env = process.env): AgentAuthStatus {
  const result = spawnAgentControlCommand(bin, ["auth", "status", "--json"], cwd,
    { cwd, env, encoding: "utf8", timeout: 5000, maxBuffer: 64 * 1024 });
  let status: any;
  try { status = JSON.parse(result.stdout); } catch { return { status: "failed", message: "Claude Codeの公式認証状態を読めません。" }; }
  // The e-mail is display text for which account this root holds, not a credential.
  if (!result.error && result.status === 0 && status?.loggedIn === true) return { status: "authenticated", verify_onboarding: true, message: null,
    account_label: typeof status.email === "string" && status.email ? status.email : null };
  if (!result.error && status?.loggedIn === false) return { status: "unauthenticated", message: null };
  return { status: "failed", message: "Claude Codeの公式認証状態の確認に失敗しました。" };
}

/** Current official Claude authorization request. `code=true` requests a
 * displayed authorization code; a callback's `code=<credential>` remains
 * private. Keep this exception at the vendor owner, not the shared filter. */
export function claudeAuthorizationUrl(screen: string): string | null {
  const legacy = authUrl(screen, ["claude.ai", "console.anthropic.com", "platform.claude.com"]);
  if (legacy) return legacy;
  for (const match of screen.matchAll(/https:\/\/[^\s<>"']+/gu)) {
    const candidate = match[0].replace(/[).,;]+$/u, "");
    let url: URL;
    try { url = new URL(candidate); } catch { continue; }
    if (url.hostname !== "claude.com" || url.pathname !== "/cai/oauth/authorize"
      || url.searchParams.getAll("code").length !== 1 || url.searchParams.get("code") !== "true"
      || url.searchParams.get("response_type") !== "code"
      || url.searchParams.get("code_challenge_method") !== "S256"
      || !/^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get("code_challenge") ?? "")) continue;
    url.searchParams.delete("code");
    if (authUrl(url.href, ["claude.com"]) !== null) return candidate;
  }
  return null;
}

/** One current-phase parse owns UI choices, selected item and composer occupancy. */
export function claudeAuthInput(screen: string): Pick<AgentAuthPane, "ui" | "native_input"> {
  const lines = screen.split("\n");
  let phase: { kind: "theme" | "login" | "code" | "unknown"; at: number } | null = null;
  for (const [at, line] of lines.entries()) {
    if (line.includes("Choose the text style that looks best with your terminal")) phase = { kind: "theme", at };
    else if (line.includes("Select login method:")) phase = { kind: "login", at };
    else if (/^\s*(?:Paste (?:the )?code|Enter (?:the )?(?:authorization )?code)/i.test(line)) phase = { kind: "code", at };
    else if (/Press (?:Enter|Return)|do you trust|trust this folder/i.test(line)) phase = { kind: "unknown", at };
  }
  if (!phase || phase.kind === "unknown") return {};
  if (phase.kind === "code") {
    const empty = /^(?:Paste (?:the )?code(?: here)?(?: if prompted)?|Enter (?:the )?(?:authorization )?code)\s*[:>]?\s*$/i.test(lines[phase.at].trim())
      && lines.slice(phase.at + 1).every(line => !line.trim());
    return { native_input: { kind: "authorization_code", empty }, ...(empty ? { ui: {
      stage: "paste_code" as const, title: "公式ページの認証コードを入力", message: "公式ページを開いて認証し、表示されたコードをこの画面の伏せ字欄へ貼り付けてください。",
      input: "authorization_code" as const, choices: [],
    } } : {}) };
  }
  const theme = phase.kind === "theme";
  const rows: { id: string; label: string; cursor: boolean }[] = [];
  for (const line of lines.slice(phase.at + 1)) {
    const match = /^\s*(❯)?\s*([1-7])\.\s*(.+?)\s*$/.exec(line);
    if (!match) {
      // A later composer/cursor or unrecognised numbered row is not this menu.
      if (/^\s*❯|^\s*\d+[.)]/.test(line)) return {};
      continue;
    }
    const allowed = theme ? /^(?:Auto \(match terminal\)|(?:Dark|Light) mode(?: \([^\n]+\))?)$/ : /^(?:Claude account with subscription|Anthropic Console account|3rd-party platform)$/;
    if (!allowed.test(match[3])) return {};
    rows.push({ id: `option-${match[2]}`, label: match[3], cursor: !!match[1] });
  }
  const selected = rows.filter(row => row.cursor);
  if (!rows.length || selected.length !== 1 || new Set(rows.map(row => row.id)).size !== rows.length) return {};
  return { native_input: { kind: "choice", selected_id: selected[0].id }, ui: {
    stage: "select", title: theme ? "表示テーマを選ぶ" : "Claudeのログイン方法を選ぶ", message: "公式CLIに表示された選択肢を選んでください。",
    input: "choice", choices: rows.map(({ id, label }) => ({ id, label })),
  } };
}

export function claudeAuthPane(screen: string, onboarding = false): AgentAuthPane {
  const url = claudeAuthorizationUrl(screen);
  const input = /Paste (?:the )?code|Enter (?:the )?(?:authorization )?code|Choose the text style|Select login method:|Press (?:Enter|Return)|do you trust|trust this folder/i.test(screen);
  const complete = onboarding && (claudeTuiReady(screen) || /Is this a project you created or one you trust/.test(screen));
  return { url, user_code: null, input_required: input && !complete,
    message: complete ? null : input ? "Claude Codeの公式画面で入力または初回案内の選択を完了してください。" : null,
    onboarding_complete: complete, ...(complete ? {} : claudeAuthInput(screen)) };
}

// ---- ファスト。Claude Codeの `/fast on`・`/fast off` は、結果を1行で返す（2.1.296）。
//   on: 「↯ Fast mode ON · …」（対応していないmodelでは「 · model set to …」が付き、Opusへ替わる。送る前に一覧で断る）
//   off: 「Fast mode OFF」 / 使えない: 「Fast mode unavailable: <訳>」 / 変えなかった: 「Fast mode was not …」「Fast mode unchanged (cancelled)」

export type ClaudeFastResult =
  | { state: "on" | "off"; line: string }
  | { state: "unavailable" | "unchanged"; line: string };

/** `/fast on|off` を送る前の画面と後の画面から、増えた結果の行を読む。まだ出ていなければnull。 */
export function claudeFastResult(before: string, after: string): ClaudeFastResult | null {
  const count = (screen: string, test: RegExp) => screen.split("\n").filter((line) => test.test(line)).length;
  const kinds: [ClaudeFastResult["state"], RegExp][] = [
    ["unavailable", /Fast mode unavailable:|Fast mode is (?:not available|only available|currently unavailable)|Fast mode requires/],
    ["unchanged", /Fast mode (?:was not |unchanged)|fast mode may still have been/],
    ["on", /Fast mode ON/],
    ["off", /Fast mode OFF/],
  ];
  for (const [state, test] of kinds) {
    if (count(after, test) <= count(before, test)) continue;
    const lines = after.split("\n");
    let index = lines.length - 1;
    while (index > 0 && !test.test(lines[index])) index--;
    // 使えない訳は次の行へ折り返す事がある（「… /usage-credits to」「turn them on」）。続きの行を1つだけ足す。
    const next = lines[index + 1]?.trim() ?? "";
    const tail = state === "unavailable" && next && !/^[❯>─╭╰│]/u.test(next) ? ` ${next}` : "";
    return { state, line: `${lines[index].replace(/^\s*⎿\s*/u, "").trim()}${tail}` };
  }
  return null;
}

/** 入力欄の近くに、ファストが入っている印（↯）が出ているか。 */
export function claudeFastIndicatorShown(screen: string): boolean {
  return screen.split("\n").slice(-8).some((line) => line.includes("\u21AF"));
}

// The ordinary interactive cancel gesture; not a process termination signal.
export const CLAUDE_INTERRUPT_KEY = "Escape" as const;
