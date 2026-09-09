// harness中立の共有プリミティブ。core と harnesses/ の両方が依存する最下層で、
// tmux-runtime / errors 以外の内部moduleへ依存しない（依存方向: core → harnesses → agent-shared）。
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { AitermError } from "./errors.js";

/** 既存launcher／stateとの互換に残す内部profile名。新規公開APIの選択軸は AgentHarness。 */
export type AgentKind = "claude" | "codex" | "grok" | "composer" | "cursor";
export type AgentHarness = "claude-code" | "codex-cli" | "grok-cli" | "cursor-cli";
export type InitialPromptState = "none" | "not_sent" | "sent" | "pending" | "done" | "failed";

export interface HarnessPaneObservation {
  state: "busy" | "idle" | "blocked" | "unknown";
  reason: string;
}

export interface InitialPromptDelivery {
  status: "not_requested" | "not_sent" | "submitted_unconfirmed" | "started";
  reason: string;
  turn_started: boolean | null;
}

export interface StartupAction {
  kind: string;
  keys: string[];
}

export interface AgentStartupResult {
  status: "ready" | "not_checked" | "blocked";
  reason: string;
}

export interface AgentMetadata {
  kind: AgentKind;
  aiterm_session: string;
  launch_id: string;
  event_file: string;
  created_at: string;
  cwd: string | null;
  // launcher の能力宣言。省略時は能力制限なし。
  write_scope?: string;
  vendor_session_id: string | null;
  initial_prompt: InitialPromptState;
  initial_prompt_delivery?: InitialPromptDelivery;
  initial_prompt_cursor?: number | null;
  agent_executable?: string;
  launch_operation_id?: string | null;
  launch_request_digest?: string | null;
  hook_route: "shared_claude_settings" | "shared_codex_home" | "shared_grok_home" | "shared_cursor_home";
  completion_route?: "codex_transcript" | "grok_transcript" | "cursor_transcript";
  agent_role?: "subagent";
  parent_session_id?: string;
  delegation_depth?: number;
  lineage?: string;
  delegation_allowed?: true;
  node_platform: NodeJS.Platform;
  codex_home?: string;
  claude_settings?: string;
  result_file?: string;
  grok_home?: string;
  grok_auth_path?: string | null;
  cursor_home?: string;
}

export const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

import { currentUid, runtimeStateBase } from "./state-root.js";
export { currentUid, runtimeStateBase };

export function safeStatSize(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

export function readFileRange(p: string, from: number, to: number): Buffer {
  const len = Math.max(0, to - from);
  if (len === 0) return Buffer.alloc(0);
  let fd: number | undefined;
  try {
    fd = fs.openSync(p, "r");
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
}

export function writeJson0600(p: string, v: unknown): void {
  // truncate-in-place はクラッシュ/ENOSPC の窓で空・途中 JSON を残すので、temp→rename の原子的置換にする
  const tmp = `${p}.${randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    /* noop */
  }
  try {
    fs.renameSync(tmp, p);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* noop */
    }
    throw e;
  }
}

export function writeText0600(p: string, text: string): void {
  fs.writeFileSync(p, text, { mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* noop */
  }
}

export function createEmpty0600(p: string): void {
  // O_EXCL が「既存 path なら失敗」を保証するため、新規作成の一意性はこれで足りる。
  // O_NOFOLLOW は撤去した（オーナー裁定 2026-08-19）。
  const fd = fs.openSync(p, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  fs.closeSync(fd);
}

// 単一引用符で安全に包む（' は '\'' で脱出）。send は raw:true で送るため自前で quote する。
export function shq(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export const LAUNCH_ID_RE = /^[0-9a-f]{32}$/;
export const AGENT_DONE_POLL_MS = 100;
export const AGENT_EVENT_MAX_BYTES = 1024 * 1024;
export const AGENT_EVENT_TAIL_BYTES = 64 * 1024;
export const CODEX_TRANSCRIPT_INCREMENT_MAX_BYTES = 16 * 1024 * 1024;
export const GROK_TRANSCRIPT_INCREMENT_MAX_BYTES = 16 * 1024 * 1024;

// session 名はファイルパス（logpath 等）と pipe-pane の /bin/sh 文字列へ流れる。英数 _ - のみ・64字に
// 限定し、パストラバーサル（../）とシェルインジェクション（' でのクオート破り・$・; 等）を全入口で断つ。
export function assertSessionName(name: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name))
    throw new AitermError(`session 名は英数字と _ - のみ・64文字以内にしてください: ${JSON.stringify(name)}`, 2);
}

export function stateRoot(): string {
  const uid = currentUid();
  const base = runtimeStateBase();
  return path.join(base, `aiterm-mcp-${uid}`);
}

export function ensureStateRoot(): string {
  // state root は OS が与えるper-user runtime dir（Windows隔離時TMPDIR／XDG_RUNTIME_DIR／os.tmpdir()）の下に作る。
  // 以前はここで symlink・owner・mode を検査していたが、共有 /tmp に敵対的な同居主体がいる
  // 前提の防御であり、対応 OS の既定配置では成立しない（オーナー裁定 2026-08-19）。
  // 作成時の 0o700 は検査ではなく妥当な既定として残す。経路の異常は以降の
  // open/stat が OS エラーとしてそのまま露出させる。
  const root = stateRoot();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(root, "agents"), { recursive: true, mode: 0o700 });
  return root;
}

export function agentsDir(): string {
  return path.join(ensureStateRoot(), "agents");
}

export function agentEventPath(name: string, launchId: string): string {
  assertSessionName(name);
  if (!LAUNCH_ID_RE.test(launchId)) throw new AitermError(`launch_id が不正です: ${launchId}`, 2);
  return path.join(agentsDir(), `${name}.${launchId}.events.jsonl`);
}

export function agentMetadataPath(name: string, launchId: string): string {
  assertSessionName(name);
  if (!LAUNCH_ID_RE.test(launchId)) throw new AitermError(`launch_id が不正です: ${launchId}`, 2);
  return path.join(agentsDir(), `${name}.${launchId}.agent.json`);
}

export function agentWaitLockPath(name: string, launchId: string): string {
  assertSessionName(name);
  if (!LAUNCH_ID_RE.test(launchId)) throw new AitermError(`launch_id が不正です: ${launchId}`, 2);
  return path.join(agentsDir(), `${name}.${launchId}.wait.lock`);
}

export interface AgentDoneEvent {
  type: "agent_done";
  vendor: AgentKind;
  aiterm_session: string;
  launch_id: string;
  vendor_session_id: string | null;
  turn_id: string | null;
  operation_id: string | null;
  reason: string;
  // turn_error: harness自身の記録でturnがエラー終了と分かった（Grok turn_ended outcome=error）。
  done_status: "turn_done" | "turn_error";
  stop_hook_active?: boolean;
  result_digest?: string;
  result_bytes?: number;
  at: string;
}

export interface AgentWaitObservation {
  schema: "aiterm.agent-wait-result.v1";
  session_id: string;
  launch_id: string;
  vendor: AgentKind;
  harness: AgentHarness;
  // running は timeout=0（待たずに一度だけ観測する照会）専用の「まだ終わっていない」。
  // timeout は「指定秒だけ待って終わらなかった」で、両者を1語に潰さない（ADR 0018）。
  // rate_limited は harness の利用上限バナーを pane log で観測した「モデルが応答できない」。
  // 完了でも沈黙でもない typed な回答として親へ返す（実被弾 2026-08-22: Grok weekly limit で
  // 完了 event が永遠に出ず、waiter は timeout の沈黙か auth 誤診しか返せなかった）。
  // error は harness 自身の記録で「turn がエラーで打ち切られた」と分かった typed な終了。
  // 完了 event（Stop hook 等）は来ないため、待ち続けると永久に running になる
  // （実被弾 2026-09-03: Claude Code の 529 Overloaded で Stop hook が走らず、待機が 70 分続いた）。
  outcome: "done" | "running" | "timeout" | "closed" | "rate_limited" | "error";
  operation_id: string | null;
  vendor_session_id: string | null;
  turn_id: string | null;
  malformed_events: number;
  at: string | null;
  rate_limit: string | null;
  // outcome=error の時だけ harness の記録にあるエラー本文（例: "API Error: 529 Overloaded ..."）。
  error: string | null;
}

export function writeAgentMetadata(meta: AgentMetadata): void {
  writeJson0600(agentMetadataPath(meta.aiterm_session, meta.launch_id), meta);
}

export function agentLabel(kind: AgentKind): string {
  return kind === "claude"
    ? "Claude Code"
    : kind === "composer"
    ? "Grok Build(Composer)"
    : kind === "grok"
      ? "Grok Build(Grok)"
      : kind === "cursor"
        ? "Cursor Agent CLI"
        : "Codex";
}

export function agentHarness(kind: AgentKind): AgentHarness {
  return kind === "claude"
    ? "claude-code"
    : kind === "codex"
      ? "codex-cli"
      : kind === "cursor"
        ? "cursor-cli"
        : "grok-cli";
}

export function subagentInstruction(meta: AgentMetadata): string {
  if (
    meta.agent_role !== "subagent" ||
    !meta.parent_session_id ||
    !Number.isSafeInteger(meta.delegation_depth) ||
    !meta.lineage ||
    meta.delegation_allowed !== true
  ) {
    throw new AitermError("sub-agent instructionに必要なlineage metadataがありません", 2);
  }
  return [
    "<aiterm_subagent_context>",
    "あなたはaitermから起動されたsub-agentであり、root agentではありません。",
    `AITERM_AGENT_LAUNCH_ID=${meta.launch_id}`,
    `role=${meta.agent_role}`,
    `parent_session_id=${meta.parent_session_id}`,
    `delegation_depth=${meta.delegation_depth}`,
    `lineage=${meta.lineage}`,
    "delegation_allowed=true",
    "任務の所有権を保ち、結果を親へ返してください。必要なら追加のsub-agentへ委譲してよいです。",
    "ただし、同じ任務全体を同型agentへ反射的に丸投げして自己複製ループを作らないでください。",
    "</aiterm_subagent_context>",
  ].join("\n");
}

// launch noteのwrite_scope説明。文言はkindに依存する分岐まで含めて単一実装で持つ
// （harness別noteへ複製すると文言が発散する）。
export function writeScopeLaunchNote(kind: AgentKind, writeScope: string | undefined): string {
  return writeScope === undefined
    ? ""
    : kind === "cursor" && writeScope === "read-only"
      ? `\n能力宣言: write_scope=${JSON.stringify(writeScope)}。Cursor Agent CLIへ --mode ask を付与し、書込みを実効禁止。`
    : (kind === "codex" || kind === "grok" || kind === "composer") && writeScope === "read-only"
      ? `\n能力宣言: write_scope=${JSON.stringify(writeScope)}。${agentLabel(kind)} CLIへ --sandbox read-only を付与し、書込みを実効禁止。` +
        (kind === "codex" ? "" : "MCPツール許可は --always-approve で自動承認（sandbox内のため能力拡大なし）。")
      : `\n能力宣言: write_scope=${JSON.stringify(writeScope)}。パス単位のsandbox allowlistに対応するCLI引数がないため宣言の記録のみ（構造的unsupported）。`;
}

export interface AgentLineageContext {
  agentRole: "subagent";
  parentSessionId: string;
  delegationDepth: number;
  lineage: string;
  delegationAllowed: true;
}
export function agentLineageFields(context: AgentLineageContext): Pick<
  AgentMetadata,
  "agent_role" | "parent_session_id" | "delegation_depth" | "lineage" | "delegation_allowed"
> {
  return {
    agent_role: context.agentRole,
    parent_session_id: context.parentSessionId,
    delegation_depth: context.delegationDepth,
    lineage: context.lineage,
    delegation_allowed: context.delegationAllowed,
  };
}
