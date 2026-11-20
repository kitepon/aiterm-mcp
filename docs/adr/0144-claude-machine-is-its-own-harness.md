# ADR 0144: machine mode is its own harness, claude-machine (機械Claude)

Status: adopted (0.70.85, a471, Owner ruling 14, 2026-11-20 21:0x JST: 「新しい機械Claude（試験中の名前）みたいなハーネスだね」「従来機能の悪影響も対処しやすい」).
Replaces the `interface` argument of [ADR 0142](0142-claude-machine-launch-mode.md); builds on [ADR 0143](0143-machine-seat-stream-is-data.md).

## Decision

- `agent_launch(harness: "claude-machine")` starts the machine seat. `harness` is the one choice; the `interface` argument, the recipe's
  `interface` and the metadata's `claude_interface` are gone. A hibernated seat wakes in the harness the launch names (the same conversation
  resumes `claude-code` to `claude-machine` and back); a wake that names none, and a `pty_send` auto-resume, keep the saved harness.
- The claude (TUI) harness is back to its pre-a471 shape: `harnesses/claude.ts`, the screen readers and the launch argv know nothing of the machine.
  Everything of the machine harness is in `harnesses/claude-machine.ts` (argv, observation line reader, interrupt evidence, state and file
  paths), `claude-machine-host.ts` (the host), `claude-machine-stream.ts` (the data path), plus thin hand-offs in `core.ts` and one line in the
  observation dispatcher.
- Every public `harness` field of such a seat is `claude-machine`; `vendor` and `provider` stay `claude`. Where the vendor itself is meant it stays
  `claude-code`: the native Goal object's `kind`, and the private execution graph (managed interruption, parent proofs).
- A remote below 0.70.85 refuses `claude-machine` by name (`REMOTE_AITERM_TOO_OLD`, raised before anything is sent); an older local Aiterm rejects the
  harness value in its schema, so a caller probes `agent_launch` inputSchema.properties.harness.enum.

## Why `kind` stays `claude`

The hooks, the Stop hook's completion events, the transcript readers, the operation marker and the parent-delivery proofs are files keyed by the
vendor (`claude`) and the launch; the Owner's ruling shares exactly these. A separate vendor kind would copy or rewire all of them for no
isolation gain. The isolation is in who reads the screen, who sends input and who observes: those are the harness.
