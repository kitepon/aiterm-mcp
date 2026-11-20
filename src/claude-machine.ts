// Claude machine launch mode (a471): the pane runs claude-machine-host, which owns `claude -p --input-format stream-json
// --output-format stream-json` and prints this marker on every state change. Aiterm reads the marker where it reads the
// Claude TUI today (claudePaneObservation / claudeTuiReady / claudeTuiBusy); see docs/architecture/claude-machine-host.md.
export type ClaudeMachineState = "starting" | "idle" | "busy" | "blocked";
export type ClaudeMachineReason = "tool_approval" | "unknown_dialog";
export interface ClaudeMachineMarker { state: ClaudeMachineState; reason: ClaudeMachineReason | null }

export const CLAUDE_MACHINE_PREFIX = "[aiterm-machine] state=";
// Visible screen lines. A TUI never prints this at column 0 (assistant text is indented, tool output sits under a gutter).
const MARKER_RE = /^\[aiterm-machine\] state=(starting|idle|busy|blocked)(?: reason=(tool_approval|unknown_dialog))?[ \t]*$/;

export function claudeMachineMarkerLine(state: ClaudeMachineState, reason: ClaudeMachineReason | null = null): string {
  return `${CLAUDE_MACHINE_PREFIX}${state}${reason ? ` reason=${reason}` : ""}`;
}

/** The newest marker on the screen, or null when the screen is not a machine seat's. */
export function claudeMachineMarker(screen: string): ClaudeMachineMarker | null {
  const lines = screen.split(/\r?\n/u);
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = MARKER_RE.exec(lines[i]);
    if (match) return { state: match[1] as ClaudeMachineState, reason: (match[2] as ClaudeMachineReason | undefined) ?? null };
  }
  return null;
}

/** Flags added to the TUI argv for the machine process. The first positional prompt moves to the host (it is a first message). */
export const CLAUDE_MACHINE_FLAGS = [
  "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-hook-events",
  "--permission-prompt-tool", "stdio",
] as const;

const SGR = String.raw`(?:\x1b\[[0-9;?]*[ -/]*[@-~])*`;
/**
 * The text of a machine seat a person reads: without the host's state lines and without what the shell showed before the host started
 * (its prompt and the launch line). Aiterm's own observers read the raw pane instead.
 */
export function claudeMachineVisibleText(text: string): string {
  // A line may start with an escape sequence: the host's first line follows its bracketed-paste request.
  const start = text.search(new RegExp(`^${SGR}\\[aiterm-machine\\] state=starting`, "m"));
  if (start > 0) text = text.slice(start);
  return text.replace(new RegExp(`^${SGR}\\[aiterm-machine\\] [^\\r\\n]*(?:\\r?\\n|$)`, "gm"), "");
}
