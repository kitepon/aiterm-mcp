// Claude machine seat (a471, ruling 13): reading claude's stream and sending it data, through the per-launch files the host keeps.
// Contract: docs/architecture/claude-machine-stream.md. Nothing here parses a screen; a line is only parsed to check what may be sent.
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { AitermError } from "./errors.js";
import { claudeMachineMarkerLine, type ClaudeMachinePending, type ClaudeMachineReason, type ClaudeMachineState } from "./claude-machine.js";
import { agentClaudeMachineFilePath, readClaudeMachineState } from "./harnesses/claude-machine.js";
import type { AgentMetadata } from "./agent-shared.js";

type Seat = Pick<AgentMetadata, "aiterm_session" | "launch_id">;
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));

export const STREAM_READ_MAX_LINES = 1000;
export const STREAM_READ_MAX_WAIT_MS = 30_000;
const STREAM_READ_MAX_BYTES = 8 * 1024 * 1024;
const SEND_MAX_LINES = 20;
const CONTROL_SUBTYPES = new Set(["interrupt", "set_model", "apply_flag_settings", "set_permission_mode", "set_max_thinking_tokens"]);

export interface ClaudeMachineView { state: ClaudeMachineState; reason: ClaudeMachineReason | null; pending: ClaudeMachinePending[] }

/** The seat's state from the host's state file (derived from the events). No file yet = the host has not reported: starting. */
export function claudeMachineView(seat: Seat): ClaudeMachineView {
  const file = readClaudeMachineState(seat);
  return file ? { state: file.state, reason: file.reason, pending: file.pending } : { state: "starting", reason: null, pending: [] };
}

/** The state in the one-line form Aiterm's own screen-based observers already read for every harness. Not drawn anywhere. */
export function claudeMachineObserverScreen(seat: Seat): string {
  const view = claudeMachineView(seat);
  return claudeMachineMarkerLine(view.state, view.reason);
}

export function parseStreamCursor(seat: Seat, cursor: string | undefined): number {
  if (cursor === undefined || cursor === "") return 0;
  const match = /^([a-f0-9]{32}):(\d{1,15})$/.exec(cursor);
  if (!match) throw new AitermError("STREAM_CURSOR_INVALID: cursor is the value stream_read returned", 2);
  if (match[1] !== seat.launch_id) throw new AitermError(`STREAM_CURSOR_STALE: the seat has a newer launch; read again from the start. launch_id=${seat.launch_id}`, 2);
  return Number(match[2]);
}

export interface ClaudeStreamRead { lines: string[]; cursor: string; at_end: boolean; state: ClaudeMachineView }

/** Whole lines of the launch's stream from the cursor, exactly as claude wrote them. */
export async function readClaudeStream(seat: Seat, o: { cursor?: string; max_lines?: number; wait_ms?: number } = {}): Promise<ClaudeStreamRead> {
  const start = parseStreamCursor(seat, o.cursor);
  const maxLines = Math.min(Math.max(1, o.max_lines ?? 200), STREAM_READ_MAX_LINES);
  const deadline = performance.now() + Math.min(Math.max(0, o.wait_ms ?? 0), STREAM_READ_MAX_WAIT_MS);
  const file = agentClaudeMachineFilePath(seat.aiterm_session, seat.launch_id, "stream");
  const before = readClaudeMachineState(seat)?.at;
  for (;;) {
    let size = 0;
    try { size = fs.statSync(file).size; } catch { /* not created yet */ }
    if (start > size) throw new AitermError("STREAM_CURSOR_INVALID: the cursor is beyond the end of the stream", 2);
    const lines: string[] = [];
    let offset = start;
    let more = false; // another whole line is waiting beyond what this read returned
    if (size > start) {
      const fd = fs.openSync(file, "r");
      try {
        const buffer = Buffer.alloc(Math.min(size - start, STREAM_READ_MAX_BYTES));
        const n = fs.readSync(fd, buffer, 0, buffer.length, start);
        let at = 0, next: number;
        while (lines.length < maxLines && (next = buffer.indexOf(10, at)) >= 0 && next < n) {
          lines.push(buffer.subarray(at, next).toString("utf8"));
          at = next + 1;
        }
        offset = start + at;
        more = size - start > buffer.length || (lines.length >= maxLines && buffer.subarray(at, n).includes(10));
      } finally { fs.closeSync(fd); }
    }
    const current = readClaudeMachineState(seat);
    const state = current ? { state: current.state, reason: current.reason, pending: current.pending } : claudeMachineView(seat);
    const changed = current?.at !== before;
    if (lines.length > 0 || changed || performance.now() >= deadline)
      return { lines, cursor: `${seat.launch_id}:${offset}`, at_end: !more, state };
    await sleep(100);
  }
}

/** The one stream line that starts at byte `offset` (a pending request's line), as claude wrote it; null if it is not whole yet. */
export function readClaudeStreamLine(seat: Seat, offset: number): string | null {
  const fd = fs.openSync(agentClaudeMachineFilePath(seat.aiterm_session, seat.launch_id, "stream"), "r");
  try {
    const buffer = Buffer.alloc(STREAM_READ_MAX_BYTES);
    const n = fs.readSync(fd, buffer, 0, buffer.length, offset);
    const end = buffer.subarray(0, n).indexOf(10);
    return end < 0 ? null : buffer.subarray(0, end).toString("utf8");
  } finally { fs.closeSync(fd); }
}

export interface ClaudeStreamSendItem { type: string; uuid?: string; request_id?: string; input_cursor: number }

function sendError(code: string, text: string): AitermError { return new AitermError(`${code}: ${text}`, 2); }

/** Check one object against the allowed shapes; only a missing uuid / request_id is filled in. The line itself is not rewritten. */
function checkStreamInput(line: unknown, pending: ClaudeMachinePending[]): { json: Record<string, unknown>; item: Omit<ClaudeStreamSendItem, "input_cursor"> } {
  if (!line || typeof line !== "object" || Array.isArray(line)) throw sendError("STREAM_INPUT_INVALID", "each line is a JSON object");
  const json = { ...(line as Record<string, unknown>) };
  if (json.type === "user") {
    const message = json.message as { role?: unknown; content?: unknown } | undefined;
    if (!message || message.role !== "user" || !(typeof message.content === "string" ? message.content.length > 0 : Array.isArray(message.content) && message.content.length > 0))
      throw sendError("STREAM_INPUT_INVALID", "user needs message {role:\"user\", content}");
    if (json.parent_tool_use_id === undefined) json.parent_tool_use_id = null;
    if (typeof json.uuid !== "string") json.uuid = randomUUID();
    return { json, item: { type: "user", uuid: json.uuid as string } };
  }
  if (json.type === "control_request") {
    const request = json.request as { subtype?: unknown } | undefined;
    if (!request || typeof request.subtype !== "string" || !CONTROL_SUBTYPES.has(request.subtype))
      throw sendError("STREAM_INPUT_INVALID", `control_request subtype is one of ${[...CONTROL_SUBTYPES].join(", ")}`);
    if (typeof json.request_id !== "string") json.request_id = `aiterm-${randomUUID()}`;
    return { json, item: { type: "control_request", request_id: json.request_id as string } };
  }
  if (json.type === "control_response") {
    const response = json.response as { subtype?: unknown; request_id?: unknown } | undefined;
    if (!response || (response.subtype !== "success" && response.subtype !== "error") || typeof response.request_id !== "string")
      throw sendError("STREAM_INPUT_INVALID", "control_response needs response {subtype: success|error, request_id}");
    if (!pending.some(p => p.request_id === response.request_id))
      throw sendError("STREAM_REQUEST_NOT_PENDING", `no request ${response.request_id} is waiting for an answer`);
    return { json, item: { type: "control_response", request_id: response.request_id } };
  }
  throw sendError("STREAM_INPUT_INVALID", "type is one of user, control_request, control_response");
}

/** Append checked lines to the seat's input file (one write). The host forwards them to claude unchanged, in order. */
export function appendClaudeInput(seat: Seat, lines: unknown[]): ClaudeStreamSendItem[] {
  if (lines.length < 1 || lines.length > SEND_MAX_LINES) throw sendError("STREAM_INPUT_INVALID", `send 1 to ${SEND_MAX_LINES} lines`);
  const view = claudeMachineView(seat);
  if (view.state === "exited") throw sendError("STREAM_SEAT_NOT_RUNNING", "the seat's claude has exited; wake the seat first");
  const checked = lines.map(line => checkStreamInput(line, view.pending));
  const file = agentClaudeMachineFilePath(seat.aiterm_session, seat.launch_id, "input");
  const text = checked.map(c => `${JSON.stringify(c.json)}\n`).join("");
  try { fs.appendFileSync(file, text, { mode: 0o600 }); }
  catch (error) { throw sendError("STREAM_SEND_FAILED", `the input file could not be written (${(error as NodeJS.ErrnoException).code ?? "error"})`); }
  const end = fs.statSync(file).size;
  return checked.map(c => ({ ...c.item, input_cursor: end }));
}

/** Wait until the host has taken the input up to `bytes` (its state file says so), so what was sent is in claude's hands. */
export async function waitClaudeInputConsumed(seat: Seat, bytes: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  const consumed = () => (readClaudeMachineState(seat)?.input_bytes_consumed ?? 0) >= bytes;
  do {
    if (consumed()) return true;
    await sleep(50);
  } while (performance.now() < deadline);
  // A busy event loop can carry the sleep past the deadline; the host may have taken the input meanwhile, so look once more (a496e).
  return consumed();
}

/** One control request and claude's answer to it, read from the stream (the answer line is the one with the same request_id). */
export async function claudeControlRequest(seat: Seat, request: Record<string, unknown>, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  const file = agentClaudeMachineFilePath(seat.aiterm_session, seat.launch_id, "stream");
  let from = 0;
  try { from = fs.statSync(file).size; } catch { /* empty */ }
  const [item] = appendClaudeInput(seat, [{ type: "control_request", request }]);
  const deadline = performance.now() + timeoutMs;
  let cursor = from;
  do {
    const read = await readClaudeStream(seat, { cursor: `${seat.launch_id}:${cursor}`, max_lines: STREAM_READ_MAX_LINES });
    cursor = Number(read.cursor.split(":")[1]);
    for (const raw of read.lines) {
      if (!raw.includes(item.request_id!)) continue;
      try { const line = JSON.parse(raw); if (line.type === "control_response" && line.response?.request_id === item.request_id) return line.response; } catch { /* not JSON */ }
    }
    await sleep(100);
  } while (performance.now() < deadline);
  throw sendError("STREAM_RESPONSE_UNCONFIRMED", `no answer to ${item.request_id} within ${timeoutMs} ms`);
}
