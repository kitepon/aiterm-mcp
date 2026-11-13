import * as fs from "node:fs";
import type { AgentMetadata } from "./agent-shared.js";
import { claudeSessionTranscriptPath } from "./harnesses/claude.js";

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

/**
 * Claude's own count of unfinished background tasks of this seat, from its transcript: an async Agent launch
 * (toolUseResult.isAsync + agentId) or a background Bash (toolUseResult.backgroundTaskId) with no <task-notification>
 * naming it yet. Launches before this launch's metadata was created belong to an earlier process and are not counted.
 * null: not a Claude seat, or the transcript cannot be read.
 */
export function claudeBackgroundTasks(meta: AgentMetadata): BackgroundTasks | null {
  const file = meta.kind === "claude" ? claudeSessionTranscriptPath(meta) : null;
  if (!file) return null;
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
      for (const line of lines) if (line) applyClaudeTranscriptLine(line, state.open, state.done, state.inputs);
    } catch { return null; } finally { if (fd !== null) fs.closeSync(fd); }
  }
  const start = Date.parse(meta.created_at);
  const live = [...state.open.values()].filter(task => !Number.isFinite(start) || Date.parse(task.since) >= start - 1000);
  const oldest = live.reduce<BackgroundTask | null>((first, task) => !first || task.since < first.since ? task : first, null);
  return { count: live.length, oldest };
}

/** The harness's own statement of unfinished background tasks; null where the harness gives none Aiterm reads (a68). */
export function harnessBackgroundTasks(meta: AgentMetadata): BackgroundTasks | null {
  return meta.kind === "claude" ? claudeBackgroundTasks(meta) : null;
}
