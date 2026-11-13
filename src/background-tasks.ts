import * as fs from "node:fs";
import path from "node:path";
import type { AgentMetadata } from "./agent-shared.js";
import { claudeSessionTranscriptPath } from "./harnesses/claude.js";
import { grokSessionDirectory } from "./harnesses/grok.js";
import { codexRootTranscript, codexRolloutSessionId } from "./harnesses/codex.js";

/** A harness's own unfinished background task (a68): in-process agents, background shells. */
export type BackgroundTask = { kind: "agent" | "shell" | "other"; label: string; since: string };
export type BackgroundTasks = { count: number; oldest: BackgroundTask | null };

type TranscriptState = { ino: number; offset: number; partial: string; open: Map<string, BackgroundTask>;
  done: Set<string>; inputs: Map<string, string> };
// One state per transcript, kept by the long-lived reader (seat-turns worker, server): each read parses only new bytes.
const states = new Map<string, TranscriptState>();

/** Masked like process descriptors: a value that may carry a secret, or a long one, is shortened. */
export function taskLabel(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return fallback;
  if (/=|:\/\/|@/.test(text)) return "…";
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/** Apply one Claude transcript row to the open/done sets (pure on its inputs; exported for tests). */
export function applyClaudeTranscriptLine(line: string, open: Map<string, BackgroundTask>, done: Set<string>, inputs: Map<string, string>): void {
  // A completion (completed, failed, killed) is a <task-notification> naming the task, queued or delivered.
  for (const match of line.matchAll(/<task-id>([^<\s]+)<\/task-id>/g)) { done.add(match[1]); open.delete(match[1]); }
  if (!line.includes("\"tool_use") && !line.includes("toolUseResult")) return;
  let row: any;
  try { row = JSON.parse(line); } catch { return; }
  const at = typeof row?.timestamp === "string" && Number.isFinite(Date.parse(row.timestamp)) ? new Date(row.timestamp).toISOString() : null;
  for (const part of Array.isArray(row?.message?.content) ? row.message.content : []) {
    if (part?.type === "tool_use" && typeof part.id === "string" && part.input && typeof part.input === "object") {
      inputs.set(part.id, taskLabel(part.input.description ?? part.input.command, ""));
      if (inputs.size > 256) inputs.delete(inputs.keys().next().value!);
    }
  }
  const result = row?.toolUseResult;
  if (!result || typeof result !== "object" || !at) return;
  const toolUseId = Array.isArray(row?.message?.content) ? row.message.content.find((part: any) => typeof part?.tool_use_id === "string")?.tool_use_id : undefined;
  const label = (fallback: string) => (toolUseId && inputs.get(toolUseId)) || fallback;
  if (result.isAsync === true && typeof result.agentId === "string" && !done.has(result.agentId))
    open.set(result.agentId, { kind: "agent", label: taskLabel(result.description, label("agent")), since: at });
  else if (typeof result.backgroundTaskId === "string" && !done.has(result.backgroundTaskId))
    open.set(result.backgroundTaskId, { kind: "shell", label: label("shell"), since: at });
  // A stop tool's own result also ends the task it names.
  for (const key of ["shell_id", "task_id"]) if (typeof result[key] === "string") { done.add(result[key]); open.delete(result[key]); }
}

/** The task a caller names: the oldest unfinished agent, or with no agent the oldest shell/other (Kiro, a68 card order). */
export function representativeTask(tasks: BackgroundTask[]): BackgroundTask | null {
  const pool = tasks.some(task => task.kind === "agent") ? tasks.filter(task => task.kind === "agent") : tasks;
  return pool.reduce<BackgroundTask | null>((first, task) => !first || task.since < first.since ? task : first, null);
}

type LineApply = (line: string, open: Map<string, BackgroundTask>, done: Set<string>, inputs: Map<string, string>) => void;

/** Apply new complete lines of a harness record to its kept state; null when the file cannot be read. */
function readRecord(file: string, apply: LineApply): TranscriptState | null {
  let stat: fs.Stats;
  try { stat = fs.statSync(file); } catch { return null; }
  let state = states.get(file);
  if (!state || state.ino !== stat.ino || stat.size < state.offset)
    states.set(file, state = { ino: stat.ino, offset: 0, partial: "", open: new Map(), done: new Set(), inputs: new Map() });
  if (stat.size > state.offset) {
    let fd: number | null = null;
    try {
      fd = fs.openSync(file, "r");
      const buffer = Buffer.alloc(stat.size - state.offset);
      const read = fs.readSync(fd, buffer, 0, buffer.length, state.offset);
      state.offset += read;
      const lines = (state.partial + buffer.subarray(0, read).toString("utf8")).split("\n");
      state.partial = lines.pop() ?? "";
      for (const line of lines) if (line) apply(line, state.open, state.done, state.inputs);
    } catch { return null; } finally { if (fd !== null) fs.closeSync(fd); }
  }
  return state;
}

/** Tasks opened since this launch's metadata was created (earlier ones belonged to an earlier process), and the oldest. */
function liveTasks(meta: AgentMetadata, state: TranscriptState): BackgroundTasks {
  const start = Date.parse(meta.created_at);
  const live = [...state.open.values()].filter(task => !Number.isFinite(start) || Date.parse(task.since) >= start - 1000);
  const oldest = representativeTask(live);
  return { count: live.length, oldest };
}

/**
 * Claude's own count of unfinished background tasks of this seat, from its transcript: an async Agent launch
 * (toolUseResult.isAsync + agentId) or a background Bash (toolUseResult.backgroundTaskId) with no <task-notification>
 * naming it yet. null: not a Claude seat, or the transcript cannot be read.
 */
export function claudeBackgroundTasks(meta: AgentMetadata): BackgroundTasks | null {
  const file = meta.kind === "claude" ? claudeSessionTranscriptPath(meta) : null;
  const state = file ? readRecord(file, applyClaudeTranscriptLine) : null;
  return state ? liveTasks(meta, state) : null;
}

/**
 * Apply one Grok updates.jsonl row (1.0.77, captured 2026-11-14): subagent_spawned / subagent_finished,
 * task_backgrounded / task_completed, and the background_tasks snapshot (each task's status and kind).
 */
export function applyGrokUpdateLine(line: string, open: Map<string, BackgroundTask>, done: Set<string>): void {
  if (!/"sessionUpdate":"(?:subagent_|task_|background_tasks)/.test(line)) return;
  let row: any;
  try { row = JSON.parse(line); } catch { return; }
  const update = row?.params?.update;
  const at = Number.isFinite(row?.timestamp) ? new Date(row.timestamp * 1000).toISOString() : null;
  const close = (id: unknown) => { if (typeof id === "string") { done.add(id); open.delete(id); } };
  const add = (id: unknown, task: BackgroundTask | null) => { if (typeof id === "string" && task && !done.has(id) && !open.has(id)) open.set(id, task); };
  switch (update?.sessionUpdate) {
    case "subagent_spawned": if (at) add(update.subagent_id, { kind: "agent", label: taskLabel(update.description, "agent"), since: at }); break;
    case "subagent_finished": close(update.subagent_id); break;
    case "task_backgrounded": if (at) add(update.task_id, { kind: "shell", label: taskLabel(update.command, "shell"), since: at }); break;
    case "task_completed": close(update.task_snapshot?.task_id ?? update.task_id); break;
    case "background_tasks":
      for (const task of Array.isArray(update.tasks) ? update.tasks : []) {
        if (task?.status !== "running") { close(task?.task_id); continue; }
        const since = typeof task.started_at === "string" && Number.isFinite(Date.parse(task.started_at)) ? new Date(task.started_at).toISOString() : at;
        const kind = task.kind === "bash" ? "shell" : task.kind === "subagent" ? "agent" : "other";
        if (since) add(task.task_id, { kind, label: taskLabel(task.description ?? task.command, kind), since });
      }
      break;
  }
}

/** Grok's own count of unfinished background tasks of this seat, from its session's updates.jsonl; null if unreadable. */
export function grokBackgroundTasks(meta: AgentMetadata): BackgroundTasks | null {
  const dir = meta.kind === "grok" ? grokSessionDirectory(meta) : null;
  const state = dir ? readRecord(path.join(dir, "updates.jsonl"), applyGrokUpdateLine) : null;
  return state ? liveTasks(meta, state) : null;
}

type CodexChild = { ino: number; offset: number; partial: string; head: { root: string; label: string } | null | undefined;
  running: number; since: string | null };
const codexChildren = new Map<string, CodexChild>();

/** Apply one rollout row of a possible Codex subagent: its session_meta head, then task_started / task_complete / turn_aborted. */
export function applyCodexChildLine(line: string, child: CodexChild): void {
  let row: any;
  if (child.head === undefined) {
    try { row = JSON.parse(line); } catch { child.head = null; return; }
    const meta = row?.type === "session_meta" ? row.payload : null;
    child.head = meta?.thread_source === "subagent" && typeof meta.session_id === "string"
      ? { root: meta.session_id, label: taskLabel(String(meta.agent_path ?? "").split("/").pop() || meta.agent_nickname, "agent") } : null;
    return;
  }
  if (!child.head || !/"type":"(?:task_started|task_complete|turn_aborted)"/.test(line)) return;
  try { row = JSON.parse(line); } catch { return; }
  const type = row?.type === "event_msg" ? row.payload?.type : null;
  if (type === "task_started") { child.running++; if (typeof row.timestamp === "string") child.since = row.timestamp; }
  else if (type === "task_complete" || type === "turn_aborted") child.running = Math.max(0, child.running - 1);
}

/** Rollout files under CODEX_HOME/sessions/YYYY/MM/DD created (UUIDv7 in the name) at or after `start`. */
function codexRolloutsSince(home: string, start: number): string[] {
  const files: string[] = [];
  for (let day = start - 86_400_000; day <= Date.now() + 86_400_000; day += 86_400_000) {
    const date = new Date(day), dir = path.join(home, "sessions", String(date.getUTCFullYear()),
      String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0"));
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      const id = /-([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jsonl$/.exec(name);
      if (id && Number.parseInt(id[1] + id[2], 16) >= start - 1000) files.push(path.join(dir, name));
    }
  }
  return files;
}

/**
 * Codex's own count of its working subagents for this seat (0.169): each subagent thread writes its own rollout whose
 * session_meta names the root thread (`session_id`) and `thread_source: "subagent"`; it is working while it has more
 * task_started than task_complete/turn_aborted. Rollouts created before this launch are not read. null when the seat's
 * root thread is not known yet.
 */
export function codexBackgroundTasks(meta: AgentMetadata): BackgroundTasks | null {
  if (meta.kind !== "codex" || !meta.codex_home) return null;
  let root: string | null;
  try { const transcript = codexRootTranscript(meta); root = transcript ? codexRolloutSessionId(meta, transcript) : null; } catch { return null; }
  if (!root) return null;
  const start = Date.parse(meta.created_at);
  if (!Number.isFinite(start)) return null;
  const live: BackgroundTask[] = [];
  for (const file of codexRolloutsSince(meta.codex_home, start)) {
    let stat: fs.Stats;
    try { stat = fs.statSync(file); } catch { continue; }
    let child = codexChildren.get(file);
    if (!child || child.ino !== stat.ino || stat.size < child.offset)
      codexChildren.set(file, child = { ino: stat.ino, offset: 0, partial: "", head: undefined, running: 0, since: null });
    if (child.head !== null && stat.size > child.offset) {
      let fd: number | null = null;
      try {
        fd = fs.openSync(file, "r");
        const buffer = Buffer.alloc(stat.size - child.offset);
        const read = fs.readSync(fd, buffer, 0, buffer.length, child.offset);
        child.offset += read;
        const lines = (child.partial + buffer.subarray(0, read).toString("utf8")).split("\n");
        child.partial = lines.pop() ?? "";
        for (const line of lines) if (line) applyCodexChildLine(line, child);
      } catch { continue; } finally { if (fd !== null) fs.closeSync(fd); }
    }
    if (child.head?.root === root && child.running > 0 && child.since) live.push({ kind: "agent", label: child.head.label, since: child.since });
  }
  const oldest = representativeTask(live);
  return { count: live.length, oldest };
}

/** The harness's own statement of unfinished background tasks; null where the harness gives none Aiterm reads (a68). */
export function harnessBackgroundTasks(meta: AgentMetadata): BackgroundTasks | null {
  return meta.kind === "claude" ? claudeBackgroundTasks(meta) : meta.kind === "grok" ? grokBackgroundTasks(meta)
    : meta.kind === "codex" ? codexBackgroundTasks(meta) : null;
}
