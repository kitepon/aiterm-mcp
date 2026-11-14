// 起動記録の選択・検証・旧形式の読取。書込と進行状態は呼出元が所有する。
import * as fs from "node:fs";
import * as path from "node:path";
import { AitermError } from "./errors.js";
import { executionNativeBindingSchema } from "./execution-close.js";
import { OPERATION_ID_RE, agentManagedClaudeSettingsPath, agentClaudeResultPath, agentClaudeCallerPromptPath, agentClaudeCallerMcpPath } from "./harnesses/claude.js";
import { agentCodexCallerPromptPath, agentCodexCallerMcpPath } from "./harnesses/codex.js";
import { resolveAndValidateGrokAuth, agentGrokCallerPromptPath, agentGrokCallerAgentPath } from "./harnesses/grok.js";
import { agentCursorCallerPromptPath, agentCursorCallerPluginDir } from "./harnesses/cursor.js";
import { agentAntigravityCallerDir } from "./harnesses/antigravity.js";
import { assertSessionName, agentsDir, readAgentGeneration, selectAgentMetadataFile,
  agentEventPath, agentLineageFields,
  LAUNCH_ID_RE, AGENT_LINEAGE_RE, type AgentForkOf, type AgentMetadata, type InitialPromptState,
  type StartupProcessShape } from "./agent-shared.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

/** A fork seat's source (ADR 0140). Malformed is refused: dropping it would resume the fork writable. */
function forkOfField(v: any): { fork_of?: AgentForkOf } {
  if (v === undefined) return {};
  if (!v || typeof v.session_id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(v.session_id)
    || typeof v.vendor_session_id !== "string" || !UUID_RE.test(v.vendor_session_id)
    || (v.fork_id !== undefined && typeof v.fork_id !== "string") || (v.first_input !== undefined && typeof v.first_input !== "string")
    || !v.write_ban || typeof v.write_ban.path !== "string" || !path.isAbsolute(v.write_ban.path)
    || !["landlock", "seatbelt", "restricted-token"].includes(v.write_ban.method)) throw new AitermError("agent metadata fork_of が不正です", 2);
  return { fork_of: { session_id: v.session_id, vendor_session_id: v.vendor_session_id, ...(v.fork_id === undefined ? {} : { fork_id: v.fork_id }),
    write_ban: { path: v.write_ban.path, method: v.write_ban.method }, ...(v.first_input === undefined ? {} : { first_input: v.first_input }) } };
}

export function loadAgentMetadata(name: string): AgentMetadata {
  assertSessionName(name);
  const dir = agentsDir();
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${name}.`) && f.endsWith(".agent.json"));
  if (files.length === 0) {
    if (readAgentGeneration(name)) throw new AitermError("AGENT_RESUME_UNCONFIRMED: 現在の起動記録がありません。", 2);
    throw new AitermError(
      `session '${name}' は agent_done 管理セッションではありません。claude_agent／codex_agent 等の launcher で起動してください。`,
      2,
    );
  }
  const selectedFile = selectAgentMetadataFile(name, files);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, selectedFile), "utf8"));
  } catch (e) {
    throw new AitermError(`agent metadata を読めません: ${(e as Error).message}`, 2);
  }
  const m = raw as Partial<AgentMetadata>;
  if (
    (m.kind !== "claude" && m.kind !== "codex" && m.kind !== "grok" && m.kind !== "cursor" && m.kind !== "antigravity") ||
    m.aiterm_session !== name ||
    typeof m.launch_id !== "string" ||
    !LAUNCH_ID_RE.test(m.launch_id)
  ) {
    throw new AitermError(`agent metadata が不正です: ${files[0]}`, 2);
  }
  const generation = readAgentGeneration(name);
  if (m.resumed_from !== undefined && (typeof m.resumed_from !== "string" || !LAUNCH_ID_RE.test(m.resumed_from)
    || generation?.launch_id !== m.launch_id || generation.previous_launch_id !== m.resumed_from))
    throw new AitermError("AGENT_RESUME_UNCONFIRMED: 復帰した起動世代が一致しません。", 2);
  const resumeFields = m.resumed_from === undefined ? {} : { resumed_from: m.resumed_from };
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
  const parsedNative = m.execution_native === undefined ? null : executionNativeBindingSchema.safeParse(m.execution_native);
  if (parsedNative && !parsedNative.success) throw new AitermError("agent native bindingが不正です", 2);
  if (m.windows_launch_exit_tracked !== undefined && m.windows_launch_exit_tracked !== true)
    throw new AitermError("Windows launch exit metadataが不正です", 2);
  const executableFields = {
    ...(m.windows_launch_exit_tracked === true ? { windows_launch_exit_tracked: true as const } : {}),
    ...(m.agent_executable === undefined ? {} : { agent_executable: m.agent_executable }),
    ...(parsedNative?.success ? { execution_native: parsedNative.data } : {}),
  };
  // 席のファストの状態と、起動・設定替えで渡したmodel（ADR 0114）。この項目より前の版が書いた控えには無い。
  const fastFields = {
    ...(typeof m.fast === "boolean" ? { fast: m.fast as boolean } : {}),
    ...(typeof m.model === "string" || m.model === null ? { model: m.model as string | null } : {}),
  };
  const startupShapes = Array.isArray(m.startup_process_shapes) && m.startup_process_shapes.every((shape: any) =>
    shape && typeof shape.identity === "string" && (shape.parent === null || typeof shape.parent === "string") && typeof shape.argv_digest === "string")
    ? { startup_process_shapes: m.startup_process_shapes as StartupProcessShape[] } : {};
  const startupFields = Array.isArray(m.startup_processes) && m.startup_processes.every((identity: unknown) => typeof identity === "string")
    ? { startup_processes: m.startup_processes as string[], ...startupShapes } : {};
  if (m.kind === "antigravity") {
    if (m.hook_route !== "shared_antigravity_home" || typeof m.antigravity_home !== "string" || !path.isAbsolute(m.antigravity_home)
      || (m.vendor_session_id != null && (typeof m.vendor_session_id !== "string" || !UUID_RE.test(m.vendor_session_id)))) throw new AitermError("Antigravity metadataが不正です", 2);
    return { kind: "antigravity", aiterm_session: name, launch_id: m.launch_id, event_file: expectedEvent,
      cwd: typeof m.cwd === "string" ? m.cwd : null, created_at: typeof m.created_at === "string" ? m.created_at : "",
      vendor_session_id: m.vendor_session_id ?? null, initial_prompt: normalizeInitialPromptState(m.initial_prompt),
      hook_route: "shared_antigravity_home", antigravity_home: m.antigravity_home, node_platform: process.platform,
      ...(typeof m.write_scope === "string" ? { write_scope: m.write_scope } : {}),
      ...(m.antigravity_caller_mcp_dir === agentAntigravityCallerDir(name) ? { antigravity_caller_mcp_dir: m.antigravity_caller_mcp_dir } : {}),
      ...deliveryFields, ...executableFields, ...fastFields, ...startupFields, ...loadAgentLineageFields(m, true) };
  }
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
      (m.claude_home !== undefined && (typeof m.claude_home !== "string" || !path.isAbsolute(m.claude_home))) ||
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
      ...forkOfField(m.fork_of),
      vendor_session_id: m.vendor_session_id,
      initial_prompt: normalizeInitialPromptState(m.initial_prompt),
      ...deliveryFields,
      ...executableFields,
      ...fastFields,
      ...resumeFields,
      ...startupFields,
      launch_operation_id: launchOperationId,
      launch_request_digest: launchRequestDigest,
      hook_route: "shared_claude_settings",
      ...loadAgentLineageFields(m, true),
      node_platform: process.platform,
      claude_settings: expectedSettings,
      ...(m.claude_caller_prompt_file === agentClaudeCallerPromptPath(name) ? { claude_caller_prompt_file: m.claude_caller_prompt_file } : {}),
      ...(m.claude_caller_mcp_file === agentClaudeCallerMcpPath(name) ? { claude_caller_mcp_file: m.claude_caller_mcp_file } : {}),
      ...(m.claude_home === undefined ? {} : { claude_home: m.claude_home }),
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
      ...forkOfField(m.fork_of),
      vendor_session_id: typeof m.vendor_session_id === "string" ? m.vendor_session_id : null,
      initial_prompt: normalizeInitialPromptState(m.initial_prompt),
      ...deliveryFields,
      ...executableFields,
      ...fastFields,
      ...resumeFields,
      ...startupFields,
      hook_route: "shared_codex_home",
      completion_route: "codex_transcript",
      ...loadAgentLineageFields(m, true),
      node_platform: process.platform,
      ...(m.codex_caller_prompt_file === agentCodexCallerPromptPath(name) ? { codex_caller_prompt_file: m.codex_caller_prompt_file } : {}),
      ...(m.codex_caller_mcp_file === agentCodexCallerMcpPath(name) ? { codex_caller_mcp_file: m.codex_caller_mcp_file } : {}),
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
      ...fastFields,
      ...resumeFields,
      ...startupFields,
      hook_route: "shared_cursor_home",
      completion_route: "cursor_transcript",
      ...loadAgentLineageFields(m, true),
      node_platform: process.platform,
      ...(m.cursor_caller_prompt_file === agentCursorCallerPromptPath(name) ? { cursor_caller_prompt_file: m.cursor_caller_prompt_file } : {}),
      ...(m.cursor_caller_mcp_dir === agentCursorCallerPluginDir(name) ? { cursor_caller_mcp_dir: m.cursor_caller_mcp_dir } : {}),
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
    ...fastFields,
      ...startupFields,
    hook_route: "shared_grok_home",
    completion_route: "grok_transcript",
    ...loadAgentLineageFields(m, true),
    node_platform: process.platform,
    ...(m.grok_caller_prompt_file === agentGrokCallerPromptPath(name) ? { grok_caller_prompt_file: m.grok_caller_prompt_file } : {}),
    ...(m.grok_caller_mcp_file === agentGrokCallerAgentPath(name) ? { grok_caller_mcp_file: m.grok_caller_mcp_file } : {}),
    grok_home: recordedGrokHome,
    grok_auth_path: expectedAuthPath,
  };
}

export function tryLoadAgentMetadata(name: string): AgentMetadata | null {
  try {
    return loadAgentMetadata(name);
  } catch {
    return null;
  }
}
