// C7 native transcript read on the terminal (remote-terminal.md R9). Lines are returned only up to the
// offset the Claude Stop hook recorded for the latest completed turn, never the unfinished tail.
import * as fs from "node:fs";
import { AitermError } from "./errors.js";
import { loadAgentMetadata } from "./agent-metadata-reader.js";

export interface TranscriptCursor { claudeSessionId: string; offset: number }
export interface TranscriptReadResult {
  schema: "aiterm.transcript-read.v1";
  entries: string[];
  cursor: TranscriptCursor;
  complete_through: number | null;
  more: boolean;
}

const DEFAULT_MAX = 4 * 1024 * 1024;

function latestCompletion(eventFile: string, vendorSessionId: string): { path: string; offset: number } | null {
  let text: string;
  try { text = fs.readFileSync(eventFile, "utf8"); } catch { return null; }
  let found: { path: string; offset: number } | null = null;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let event: any;
    try { event = JSON.parse(line); } catch { continue; }
    if (event?.type === "agent_done" && event.vendor_session_id === vendorSessionId
      && typeof event.transcript_path === "string" && Number.isSafeInteger(event.transcript_offset) && event.transcript_offset >= 0)
      found = { path: event.transcript_path, offset: event.transcript_offset };
  }
  return found;
}

export function readCompletedTranscript(sessionName: string, cursor: TranscriptCursor | null, maxBytes = DEFAULT_MAX): TranscriptReadResult {
  const meta = loadAgentMetadata(sessionName);
  if (meta.kind !== "claude" || !meta.vendor_session_id)
    throw new AitermError("TRANSCRIPT_UNSUPPORTED: only Claude Code seats have a native transcript cursor", 2);
  return readTranscriptRange(meta.event_file, meta.vendor_session_id, cursor, maxBytes);
}

export function readTranscriptRange(eventFile: string, id: string, cursor: TranscriptCursor | null, maxBytes = DEFAULT_MAX): TranscriptReadResult {
  // A fresh conversation (new seat or account switch) starts from its beginning.
  const start = cursor && cursor.claudeSessionId === id ? cursor.offset : 0;
  if (!Number.isSafeInteger(start) || start < 0) throw new AitermError("TRANSCRIPT_CURSOR_INVALID: offset must be a non-negative integer", 2);
  const done = latestCompletion(eventFile, id);
  const unchanged = { schema: "aiterm.transcript-read.v1" as const, entries: [], cursor: { claudeSessionId: id, offset: start }, complete_through: done?.offset ?? null, more: false };
  if (!done || done.offset === start) return unchanged;
  if (start > done.offset) throw new AitermError("TRANSCRIPT_CURSOR_AHEAD: the cursor is past the latest completed turn", 2);
  const length = Math.min(done.offset - start, Math.max(1, maxBytes));
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(done.path, "r");
  let read: number;
  try { read = fs.readSync(fd, buffer, 0, length, start); } finally { fs.closeSync(fd); }
  const end = buffer.subarray(0, read).lastIndexOf(0x0a) + 1;
  if (end === 0) {
    if (read < done.offset - start) throw new AitermError("TRANSCRIPT_LINE_TOO_LONG: one line exceeds max_bytes", 2);
    return unchanged;
  }
  const entries: string[] = [];
  let at = 0;
  while (at < end) {
    const next = buffer.indexOf(0x0a, at) + 1;
    entries.push(buffer.subarray(at, next).toString("utf8"));
    at = next;
  }
  return { schema: "aiterm.transcript-read.v1", entries, cursor: { claudeSessionId: id, offset: start + end },
    complete_through: done.offset, more: start + end < done.offset };
}
