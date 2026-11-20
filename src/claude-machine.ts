// Claude machine launch mode (a471, ruling 13). The pane runs claude-machine-host, which only holds one resident
// `claude -p --input-format stream-json --output-format stream-json` process: the stream is data in files, never a screen.
// Contract: docs/architecture/claude-machine-stream.md.
export type ClaudeMachineState = "starting" | "idle" | "busy" | "blocked" | "exited";
export type ClaudeMachineReason = "tool_approval" | "unknown_dialog";
/** A request waiting for an answer; `stream_offset` / `stream_end` are where its line sits in the stream file (bytes). */
export interface ClaudeMachinePending { request_id: string; subtype: string; tool_name: string | null; stream_offset: number; stream_end: number }
/** What the host derives from the events (claude-machine-state.json). */
export interface ClaudeMachineStateFile {
  schema: "aiterm.claude-machine-state.v1";
  state: ClaudeMachineState;
  reason: ClaudeMachineReason | null;
  pending: ClaudeMachinePending[];
  input_bytes_consumed: number;
  last_result: { at: string; subtype: unknown; terminal_reason: unknown; is_error: boolean } | null;
  exited: boolean;
  at: string;
}

/** Flags added to the TUI argv for the machine process. */
export const CLAUDE_MACHINE_FLAGS = [
  "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-hook-events",
  "--permission-prompt-tool", "stdio",
] as const;

// ---- Aiterm's own observers ----
// Aiterm's internal observers (pty_observe, the send gates, the wake and hibernate checks) read screen text for every harness. A machine
// seat has no screen to read: its state comes from the events (the state file), and this is the same state in the one-line form those
// observers already understand. Nothing is drawn by the host and nothing is parsed from a pane.
export const CLAUDE_MACHINE_PREFIX = "[aiterm-machine] state=";
const MARKER_RE = /^\[aiterm-machine\] state=(starting|idle|busy|blocked|exited)(?: reason=(tool_approval|unknown_dialog))?[ \t]*$/;
export interface ClaudeMachineMarker { state: ClaudeMachineState; reason: ClaudeMachineReason | null }

export function claudeMachineMarkerLine(state: ClaudeMachineState, reason: ClaudeMachineReason | null = null): string {
  return `${CLAUDE_MACHINE_PREFIX}${state}${reason ? ` reason=${reason}` : ""}`;
}

/** The state of a synthesized observer screen, or null when the text is not one. */
export function claudeMachineMarker(screen: string): ClaudeMachineMarker | null {
  const lines = screen.split(/\r?\n/u);
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = MARKER_RE.exec(lines[i]);
    if (match) return { state: match[1] as ClaudeMachineState, reason: (match[2] as ClaudeMachineReason | undefined) ?? null };
  }
  return null;
}
