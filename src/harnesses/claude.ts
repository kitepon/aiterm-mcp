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
import { spawnAgentControlCommand } from "../agent-resolver.js";
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

// process.execPath は Homebrew 等では Cellar の版付き実体を指す。長寿命 MCP server の起動後に
// runtime が更新されるとその実体だけが消え、既に生成済みの hook が exit 127 になる。
// hook は server と同じ継承 PATH から node を毎回解決し、安定した package script を実行する。
function nodeHookCommand(hookScript: string): string {
  return `${shq("node")} ${shq(hookScript)}`;
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

export function claudeTuiReady(screen: string): boolean {
  if (!screen.includes("Claude Code")) return false;
  const lastMarker = screen.split(/\r?\n/u).filter((line) => /^\s*❯/u.test(line)).at(-1)?.trim();
  if (!lastMarker) return false;
  // Claude Code 2.1.251 のworkspace trust UIも選択カーソルに❯を使う。
  // 最後のmarker行だけを見ることで、古いtrust表示がscrollbackに残っていても
  // その下に描画された現在のcomposerを優先する。
  return !/^❯\s*(?:\d+\.|\[|Enable selected\b|No,\s*exit\b|Yes,\s*I trust this folder\b)/iu.test(lastMarker);
}

export function claudePaneObservation(screen: string): import("../agent-shared.js").HarnessPaneObservation {
  const tail = screen.split("\n").slice(-32).join("\n");
  if (/Do you want to proceed\?/.test(tail) && /(?:^|\n)\s*[❯>]?\s*\d+\.\s+(?:Yes|No)\s*$/m.test(tail))
    return { state: "blocked", reason: "tool_approval" };
  if (/esc to interrupt/i.test(tail)) return { state: "busy", reason: "turn_running" };
  if (claudeTuiReady(screen)) return { state: "idle", reason: "composer_ready" };
  if (/new MCP servers? found in this project/i.test(tail)) return { state: "blocked", reason: "project_mcp_consent" };
  if (claudeStartupAction(screen, false)) return { state: "blocked", reason: "startup_dialog" };
  return { state: "unknown", reason: "unrecognized_screen" };
}

export function claudeStartupAction(screen: string, trustProject: boolean): import("../agent-shared.js").StartupAction | null {
  // 既存launcherで扱っていた2確認は従来の起動契約を維持する。
  if (screen.includes("Is this a project you created or one you trust")
    && screen.includes("No, exit") && screen.includes("Yes, I trust this folder"))
    return { kind: "workspace_trusted", keys: ["Down", "Enter"] };
  if (screen.includes("Claude Code running in Bypass Permissions mode")
    && screen.includes("No, exit") && screen.includes("Yes, I accept"))
    return { kind: "configured_permission_mode_confirmed", keys: ["Down", "Enter"] };
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
