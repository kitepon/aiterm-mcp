# ADR 0133: Bounded read-only observation while the native server exits

## Decision

macOS can return `server exited unexpectedly` after accepting the last native session close, before the server finishes teardown. A single such read cannot prove either presence or absence. Managed auth cancel then retains an unknown slot, even when a subsequent exact scoped read would establish absence.

Both private native listing readers re-observe only exit code 1, empty stdout and the exact trimmed stderr `server exited unexpectedly`. Pause 20 ms between reads and stop after 500 ms. Reuse the existing caller's issued slot, native admission and managed/native/server identity checks. No close, input, process creation or other effect is repeated; no new persistent state, ID, queue or consumer retry is introduced.

The transient diagnostic never proves absence. Keep `absentExecutionServer` unchanged: exit code 1, empty stdout and the exact selected socket diagnostic. Do not import the public session listing's broad absence regex. A successful listing still passes existing strict parsing, server process identity checks and generation validation. Other errors, malformed or conflicting output and bounded exhaustion retain unknown. A replacement generation cannot authorize a new effect. A native receipt observed before a later proof failure remains preserved with existing execution error metadata and unknown state.

The BellTeam consumer agreed to this product-owned contract, without accepting unverified source or claiming all OS gates passed. BellTeam adds no independent re-observation or success conversion.

## Verification

Synthetic native listings cover teardown followed by both exact absence diagnostics, bounded exhaustion, other socket, permission errors, conflicting stdout, wrong exit status, extra diagnostics and malformed success. Real MCP SDK composition with synthetic native I/O checks one close, the same issued slot during reads, original unknown record preservation and either final slot release or retained management unknown. Replacement managed, native and server identity cases refuse effects. OS product gates remain separate from these focused boundaries.
