# ADR 0131: Admit the synchronous created-launch segment and close empty exited failures

## Decision

The asynchronous launcher previously admitted startup/readiness continuations but called synchronous `openAgent` without owning native admission. A separate writer could acquire the graph mutex after managed generation binding and before `send` checked its execution context. The context refused with EXECUTION_BUSY, leaving a stamped managed shell and unknown launch before the CLI command was submitted. This is a distinct reproducible interval from the earlier writer after CLI input.

Keep public synchronous `openAgent` semantics. Split CLI resolution/validation from its synchronous creation function. The asynchronous launcher waits for existing native admission before initial context checks and the actual create/metadata/bind/CLI segment. Resolve authentication, catalog and executable prerequisites outside that mutex. Retain per-native-effect gates and durable issuance; no native retry, extra ID, timeout extension or lock held over readiness awaits is introduced. Grok/Cursor user-default preservation still encloses validation and launch.

If a returned unknown launch has left a shell with an exited harness, the live/idle reconcile action remains unsuitable. Admit an explicit existing management `pty_close` for that failed generation only when its unknown launch slot retains original native/server and managed identity, its send is not_issued, its input boundary is null, raw initial_prompt is none, initial prompt delivery is absent and a private synchronous probe proves harness_alive false with harness_exited. Recheck the evidence and exact native identity before the close effect. Missing probes, raw input uncertainty, issued RPCs, live harnesses and other slot/generation/native/server states remain blocked. Arguments and stored scalar claims cannot supply this runtime evidence.

Release only those recoverable slots after the existing close primitive succeeds and confirms absence. Preserve original failed records, reservations, source and operation states. Late callbacks cannot issue against their missing/unknown slot, and the old request is never replayed. A fresh ordinary request can subsequently create a new generation; no close, launch or body is automatic.

## Verification

Isolated SDK/native/tmux/fake-Codex fixtures reproduce the pre-fix throw at send→assertExecutionContext→FileExecutionStore.transactionSync after generation binding, with create1/CLI input0/raw none/unknown launch. The candidate produces create1/CLI input1/accepted launch/send not_issued. A separate initial-handler writer is awaited; coordinated stop, unknown-slot and changed-generation writers continue to fence subsequent input.

An isolated created shell deliberately failed before CLI submission is rejected by the old management close. Candidate close rejects missing/sent raw prompt, initial delivery, mismatched creator, issued launch and live harness; it closes the proven exited shell once, retains its failed record, preserves an unrelated session, rejects original-request replay and permits a fresh reservation. These fixtures do not identify every historical production throw; saved records without a native stack cannot distinguish all post-effect failures.
