# ADR 0143: a machine seat's output is data, passed through; nothing re-reads a screen

Status: adopted (0.70.84, a471, Owner ruling 13, 2026-11-20 20:0x JST). Replaces the screen-based part of [ADR 0142](0142-claude-machine-launch-mode.md)
(host-drawn text, the state line read back from the pane, the approval and question text parsed from the screen); the machine launch mode itself,
the opt-in launch (now the `claude-machine` harness, ADR 0144), the native session as the one holder on every OS and the recipe stay.

## Cause

0.70.82 and 0.70.83 rendered claude's stream to text in the pane and read the state, the tool approval and an AskUserQuestion back from that
text. The Owner's reading: the stream-json lines are already data, so rendering them to text for Aiterm to parse again adds a fragile step and
cannot carry what the chat needs (multi-select, free text, thinking, tool results). 「機械データを垂れ流しでいいんだから」.

## Decision

- The host does not render or interpret. Every stdout line of `claude -p` is appended unchanged to a per-launch stream file; every line Aiterm
  appends to the input file is written unchanged to claude's stdin; the state (idle / busy / blocked / exited, the pending requests with their
  place in the stream) is derived from the events into a state file.
- Two public tools, `stream_read` (cursor, long poll) and `stream_send` (user message, control request, control response; a type allow-list, no
  rewriting), carry the data. Existing tools keep their receipts on a machine seat and use the same files inside.
- AskUserQuestion has no Aiterm shape: it is a `can_use_tool` control_request line in the stream and a control_response the caller builds.
  BellTeam execution routes, conversation (N102) decides how each kind is shown and builds the answer.
- The native session holds the process and its pipes only, the same mechanism on every OS; no socket, no pane typing, no pane reading.
- Removed for machine seats: the host's text rendering, the pane state lines, the screen-parsed approval and question, the `answer` decision,
  `question_pending`, the digit keys of `pty_key`, the state-line filter of `pty_read`.
- Kept as an internal adapter: Aiterm's own observers read a one-line form of the state file where they read screen text for other harnesses.
  Nothing is drawn and no pane is read.

## Consequences

- The thinking text is empty unless asked for; the host asks (`set_max_thinking_tokens` with `thinking_display: "summarized"`, no cap) after
  initialize, so the stream carries the vendor's thinking summaries (measured on Opus, Sonnet, Fable).
- The stream file lives until the seat is closed; an earlier launch's cursor stays readable while its file exists (a reader cut by a restart can
  drain the tail).
- A remote terminal needs 0.70.84 for the stream tools (0.70.82 / 0.70.83 are the screen-based form).
