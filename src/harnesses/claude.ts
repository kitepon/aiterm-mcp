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
import { catalogInvalid, catalogUnavailable, checkedCatalog, findJsonLine, processSummary, type AgentModelCatalog } from "../model-catalog.js";
import {
  currentUid,
  writeJson0600,
  shq,
  subagentInstruction,
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
    throw new AitermError("Claude result file が完了eventと一致しません", 2);
  }
  return result.text;
}

const CLAUDE_AUTH_STATUS_TIMEOUT_MS = 5_000;
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
export async function claudeModelChoices(bin: string, cwd: string): Promise<AgentModelCatalog> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-claude-models-"));
  try {
    const settings = path.join(dir, "settings.json");
    fs.writeFileSync(settings, JSON.stringify({ disableAllHooks: true }), { mode: 0o600 });
    const requestId = `aiterm-models-${randomUUID()}`;
    const request = { type: "control_request", request_id: requestId, request: { subtype: "initialize" } };
    const result = await runAgentProtocolCommand(bin, [
      "-p", "--output-format", "stream-json", "--verbose", "--input-format", "stream-json",
      "--no-session-persistence", "--strict-mcp-config", "--settings", settings,
    ], {
      cwd,
      env: process.env,
      input: JSON.stringify(request) + "\n",
      until: requestId,
      timeout: CLAUDE_MODELS_TIMEOUT_MS,
      maxBuffer: CLAUDE_MODELS_MAX_BYTES,
    });
    if (result.error || result.status !== 0) {
      throw catalogUnavailable("Claude Code", result.error?.message || result.stderr?.trim() || `exit=${result.status ?? "unknown"}`);
    }
    return claudeCatalogFromInitialize(result.stdout, requestId, processSummary(result));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
    };
  });
  return checkedCatalog("Claude Code", {
    source: "claude stream-json control_request initialize (models)",
    harness_version: null,
    default_model: choices.some((choice: { id: string }) => choice.id === "default") ? "default" : null,
    adapter_efforts: choices.some((choice: { efforts: string[] }) => choice.efforts.includes("ultracode")) ? { ultracode: CLAUDE_ULTRACODE_NOTE } : {},
    models: choices,
  });
}

export function assertClaudeAuthenticationReady(bin: string): void {
  const result = spawnAgentControlCommand(bin, ["auth", "status", "--json"], process.cwd(), {
    encoding: "utf8",
    timeout: CLAUDE_AUTH_STATUS_TIMEOUT_MS,
    maxBuffer: 64 * 1024,
  });
  let status: unknown = null;
  try {
    status = JSON.parse((result.stdout ?? "").trim());
  } catch {
    status = null;
  }
  if (
    result.error == null &&
    result.status === 0 &&
    status !== null &&
    typeof status === "object" &&
    !Array.isArray(status) &&
    (status as { loggedIn?: unknown }).loggedIn === true
  ) {
    return;
  }
  if (
    status !== null &&
    typeof status === "object" &&
    !Array.isArray(status) &&
    (status as { loggedIn?: unknown }).loggedIn === false
  ) {
    throw new AitermError(
      "Claude Codeの認証を利用できません。sessionは作成していません。" +
        "通常端末で `claude doctor` を実行し、Keychain／credential storeを直してから一度だけ `claude auth login` を実行してください。" +
        "aiterm相関付きClaude session内で /login を繰り返さないでください。",
      2,
    );
  }
  const timedOut = result.error && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  throw new AitermError(
    `Claude Codeの認証状態を起動前に確認できません${timedOut ? "（5秒でtimeout）" : ""}。sessionは作成していません。` +
      "`claude auth status --json` と `claude doctor` が成功することを通常端末で確認してください。",
    2,
  );
}

export function buildClaudeAgentCmd(
  bin: string,
  model: string | null,
  effort: string | null,
  prompt: string | null,
  meta: AgentMetadata | null,
): string {
  const parts: string[] = [shq(bin)];
  if (meta?.kind === "claude") {
    parts.push(
      "--dangerously-skip-permissions",
      "--setting-sources",
      shq("user,project,local"),
      "--settings",
      shq(meta.claude_settings ?? ""),
      "--session-id",
      shq(meta.vendor_session_id ?? ""),
      "--append-system-prompt",
      shq(subagentInstruction(meta)),
    );
  }
  if (model) parts.push("--model", shq(model));
  if (effort) parts.push("--effort", shq(effort));
  if (prompt) parts.push(shq(prompt)); // 初手プロンプト（任意）
  return parts.join(" ");
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

export function claudeTuiReady(screen: string): boolean {
  if (!screen.includes("Claude Code") && !claudeComposerBox(screen)) return false;
  if (claudeLoginMethodMenu(screen)) return false;
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
  if (claudeLoginMethodMenu(screen)) return { state: "blocked", reason: "vendor_onboarding_required" };
  if (/Do you want to proceed\?/.test(tail) && /(?:^|\n)\s*[❯>]?\s*\d+\.\s+(?:Yes|No)\s*$/m.test(tail))
    return { state: "blocked", reason: "tool_approval" };
  if (claudeTuiBusy(screen)) return { state: "busy", reason: "turn_running" };
  if (claudeTuiReady(screen)) return { state: "idle", reason: "composer_ready" };
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
    claudeConfigDir(),
    "projects",
    claudeProjectSlug(meta.cwd ?? process.cwd()),
    `${meta.vendor_session_id}.jsonl`,
  );
}

export interface ClaudeApiError {
  text: string;
  at: string | null;
}

export function claudeApiErrorFromLine(line: string): ClaudeApiError | null {
  if (!line.trim()) return null;
  let record: any;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  if (record?.type !== "assistant" || record?.isApiErrorMessage !== true) return null;
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
  };
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
    if (error?.at && Date.parse(error.at) >= startedAtMs) return error;
  }
  return null;
}


export function claudeAuthPlan(onboarding = false): AgentAuthPlan { return { args: onboarding ? [] : ["auth", "login"], env: [] }; }

export function claudeAuthStatus(bin: string, cwd: string, env = process.env): AgentAuthStatus {
  const result = spawnAgentControlCommand(bin, ["auth", "status", "--json"], cwd,
    { cwd, env, encoding: "utf8", timeout: 5000, maxBuffer: 64 * 1024 });
  let status: any;
  try { status = JSON.parse(result.stdout); } catch { return { status: "failed", message: "Claude Codeの公式認証状態を読めません。" }; }
  if (!result.error && result.status === 0 && status?.loggedIn === true) return { status: "authenticated", verify_onboarding: true, message: null };
  if (!result.error && status?.loggedIn === false) return { status: "unauthenticated", message: null };
  return { status: "failed", message: "Claude Codeの公式認証状態の確認に失敗しました。" };
}

export function claudeAuthPane(screen: string, onboarding = false): AgentAuthPane {
  const url = authUrl(screen, ["claude.ai", "console.anthropic.com", "platform.claude.com"]);
  const input = /Paste (?:the )?code|Enter (?:the )?(?:authorization )?code|Choose the text style|Select login method:|Press (?:Enter|Return)|do you trust|trust this folder/i.test(screen);
  const complete = onboarding && (claudeTuiReady(screen) || /Is this a project you created or one you trust/.test(screen));
  return { url, user_code: null, input_required: input && !complete,
    message: complete ? null : input ? "Claude Codeの公式画面で入力または初回案内の選択を完了してください。" : null,
    onboarding_complete: complete };
}
