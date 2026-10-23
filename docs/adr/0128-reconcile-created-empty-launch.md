# ADR 0128: Reconcile an already-created empty launch

## Decision

A lost launch result can leave a live managed harness behind an unknown launch slot. Closing that harness discards a usable generation. Add an explicit `agent_execution` action `reconcile_launch`, with the original request and exact target launch; no new tool, delivery ID, payload or retry queue.

Within the shared metadata transaction, require an unknown launch slot with its original native ID and server PID/start identity, send:not_issued, tracking/submitted_unknown state, no input boundary, no competing target slot, no pending parent effect and no stop/interruption. A private synchronous runtime probe rechecks native creator metadata and managed generation, raw initial_prompt:none and no initial prompt delivery, plus the same live/idle harness readiness used by startup. Caller scalar fields are identifiers, never proof. Missing injected probes remain unsupported.

Set launch accepted, bind that existing target with a null input boundary, reopen completion and remove only that slot. This is present-generation reconciliation, not recovery of the original RPC receipt. Preserve reservation, source, claims and all other records. Do not launch, send, close, regenerate metadata or fabricate a generation. A later send uses the original reference once through normal source/target admission. Repeated reconciliation of the same accepted target does not mutate the record. While send is still not_issued it must recheck the current managed generation, raw no-input/readiness evidence, stop/interruption and absence of competing session slots or pending parent effects in the same metadata transaction. A historical acceptance must not clear a later generation's host uncertainty. Once send has progressed, the repeated action only returns status and does not grant another send.

Issued RPCs cannot be adopted while their owner may continue. Unknown input or unknown managed generation also remains unresolved. There is no TTL, whole-process inventory barrier, automatic slot deletion or body replay. Original callback failure paths may change only their still-owned issued stage and slot, so late callbacks cannot undo reconciliation or overwrite a subsequent send.

## Verification

A synthetic native SDK/tmux/fake-Codex launch leaves a real created managed generation and an unknown slot. MCP reconciliation accepts it with native create/input counters unchanged, original metadata bytes and generation unchanged. Raw missing/sent prompt state refuses without graph changes. Service tests cover one later body, idempotence, issued, stop, native/server/generation mismatch, competing slots, input uncertainty and late callbacks. All fixtures use the repository isolated seat environment, never installed sessions or authentication.
