# ADR 0142: Claude machine launch mode (claude -p stream-json under an Aiterm host)

Status: adopted (0.70.82, a471). Owner 2026-11-20 「Claudeを機械の口に切り替えてみたい」; ruling by Tronie after the spike (plan_claude-machine-interface-20261120.md).

## Cause

Every Claude seat is the Claude Code screen (TUI) in a native session: Aiterm types into the composer and reads the screen for
ready, busy, dialogs and the model picker. Each vendor screen change breaks one reader (picker rows, rate-limit menu, Code Mode
confirm, ...). Claude Code also runs as `claude -p --input-format stream-json --output-format stream-json` with the same hooks,
settings, MCP and transcript, and a control channel (interrupt, set_model, ...).

## Decision

`agent_launch interface: "machine"` (claude-code only, opt-in per launch and saved in the resume recipe) puts a small host,
`claude-machine-host`, in the seat's native session in place of the TUI. The host owns one `claude -p` stream-json process. Everything
else stays: public tools and receipts, the Stop hook completion, transcript reading, the operation marker, recipe and resume, the
native session as the one process owner on every OS (Tronie, item 8 of the ruling).

The host's own screen is the only screen Aiterm reads for such a seat: a state line at column 0 (`[aiterm-machine] state=...`), plain
text of the stream, and the vendor's approval text drawn by the host in the form `parseClaudeApprovalScreen` already reads. Input stays
paste + Enter and Escape/C-c into the host, so the send path, steer and the admission order do not fork by mode.

## Why not the alternatives

- Keep the screen readers and the vendor TUI: the fragility this task is about.
- Control socket/pipe owned by Aiterm: a second transport per OS (unix socket, named pipe) and a fork in every send/observe/approve path.
  The pane is already the one durable, identity-checked channel on all three OSes. A socket can replace the typed input later without
  changing the contracts here.
- A host that fakes the Claude TUI: it would bind our host to the vendor screen again.

## Consequences

- No Code Mode in a machine seat (`-p` has no REPL tool on 2.1.328/2.1.329). Stated to the Owner by Tronie; `settings_env` is accepted and ignored.
- No usage-limit hold: `-p` ends the turn at once with 429; the existing limit and failover reading applies (transcript row is the same).
- `-p` writes an interrupt into the transcript only at the next input: the host records each `result` in `claude-machine-end.json`.
- `system/init` is not the ready signal; the initialize reply is. Idle waits for the turn's Stop hooks (Throughline records before the next input).
- Transcript rows differ in `entrypoint`, `promptSource`, `turnOrigin`, `origin`; hook input lacks `scratchpad_dir` and SessionStart `model` (a471-throughline).
- A refused machine launch (`REMOTE_AITERM_TOO_OLD`, `AGENT_MACHINE_UNAVAILABLE`) leaves no seat, so the caller may launch the TUI once.
