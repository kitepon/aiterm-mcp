# ADR 0135: Antigravity CLI as a native harness

Date: 2026-10-30

## Decision

Expose Google Antigravity CLI as `antigravity-cli`, with internal provider `antigravity`, through the existing launcher and PTY APIs. Keep the other four harness IDs and the public tool count unchanged. Resolve `agy` from its official installation location or `ANTIGRAVITY_BIN`.

Use the interactive CLI with its normal HOME, project, authentication, MCP, trust and settings. Headless stream-json supports consecutive turns, but does not expose the interactive control protocol and did not emit configured lifecycle hooks in the tested 1.4.10 fixture. It is not the native session backend.

Add one `aiterm-native` group to the official global hooks file, preserving other groups. Bind SessionStart to the Aiterm launch, exact workspace, native conversation UUID and native transcript path. Inject the existing subagent lineage through the official SessionStart result. Only fully idle Stop events can terminate a turn. Read the last native final response after the latest native USER_INPUT; never expose the separate thinking field or reuse an older turn's answer.

`executionNum` resets to zero for each user message in CLI 1.4.10. A completion identity therefore combines the native USER_INPUT `step_index` with `executionNum`. Bound result files record that identity, conversation UUID, byte count and SHA-256. Repeated Stop events do not create another completion. Unknown termination reasons are errors, not successful answers.

Use the official session-only `--settings` override `queuedMessages: "send-immediately"` for running-turn input. It does not change the user's default. Native model IDs already include effort; preserve them and validate the exact catalog choice. In-place `/model` writes the CLI's user default, so use the existing user-configuration lock and restore only the previous model key after confirming the native selection.

Trust only the exact displayed workspace requested with `trust_project:true`, accepting native path separators and terminal wrapping. A path prefix is insufficient. Keep authentication separate from trust. Authentication status uses the official model query; credentials remain owned by the CLI. Forced relogin currently refuses before issuing input: official `/logout` purges shared credentials and cache, and there is no verified non-destructive force-login command.

## Capability boundaries

The Antigravity parent follows the existing generic `wait_process` and transcript recovery contract. Native automatic parent wake has not been implemented. `/boost` is multi-agent reasoning, not low-latency fast mode. The goal API explicitly reports `native_goal_adapter_not_implemented`; Antigravity itself has `/goal`. These limits must not be represented as successful operations or as absence of the vendor feature.

An isolated Linux fixture with two concurrent native seats found that `${VAR}`, `$VAR` and `${env:VAR}` in global Streamable HTTP `headers` were sent literally in CLI 1.4.10. Do not claim runtime header expansion from that configuration. A shared stdio entry without literal seat IDs did inherit `AITERM_SESSION_ID` and `AITERM_AGENT_LAUNCH_ID` separately for both MCP children, matching their observed launch identities and preserving normal HOME. Both fixtures left the shared configuration bytes unchanged between launches. A consumer needing per-launch HTTP headers can use that measured stdio boundary for its own transport; other expansion syntaxes and the other platforms' stdio inheritance were not verified by this fixture.

## Evidence and acceptance

Focused tests cover catalog validation, authentication menus, exact trust matching, busy/idle observation, additive hook registration, conversation binding, duplicate Stop events, repeated execution number zero, and rejection of a stale answer. Real isolated MCP fixtures on Linux and macOS have verified three turns in one native conversation, model switching with preserved context, and unchanged user default model. The same three-turn and configuration fixture passed on Windows after exact workspace matching and explicit PowerShell hook invocation were corrected. A running-turn message on Linux was received through the native immediate-send path and the original wait returned its final response. A skipped or blocked case is not acceptance.

In the cancellation fixture, Ctrl+C returned the same native process to its idle composer without emitting a Stop event. The key receipt remains unconfirmed, and the waiter returns running rather than inventing a terminal event. A timeout is not a successful cancellation receipt.

Release requires the existing related tests, three-platform CI and published-package checks. The branch remains development source until those gates finish.
