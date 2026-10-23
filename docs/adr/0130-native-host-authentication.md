# ADR 0130: Admit the existing authentication contract in the native entry

## Problem and decision

The native dispatcher rejected agent_auth/start with no session name, and BellTeam ref-less named authentication controls, before calling the existing v1 handler. Authentication also uses an ordinary login PTY, not managed agent metadata. Merely adding a name or exempting all authentication from admission would leave creation, input and cancellation unbound.

Use the serving SDK process PID/start identity and actual request ID as the existing native management reference. For omitted auth-start names, a private runtime allocator chooses only a fresh terminal name before admission; the normal native creation frame reserves and creates it. It is not a delivery ID, credential or synthetic generation proof. Missing injected allocation/probe functions have no native fallback.

An authenticated no-op keeps the v1 authenticated/session_id:null receipt and performs no terminal/server creation. For a real login, bind the actual new-session native/server receipt to an auth generation and save those non-secret fields in the existing auth metadata. Private generation observation verifies the creator stamp before and after reading the metadata. Do not invent managed agent metadata or enroll legacy unstamped sessions.

Admit named status/onboarding and cancellation under the same per-stage source/target generation and slot gates. Cancellation is a close result, with confirmed native absence after the existing close. A missing session returns the existing failed/already-cancelled v1 receipt without creating a replacement. Phase writes after CLI observation use metadata preparation admission. A proven native auth PTY, and only such a PTY, also accepts the host's existing ref-less pty_send/pty_key calls; ordinary Bot messages retain their original delivery reference requirement.

No auth command is downgraded to a read. Existing status-without-session retains its existing official-CLI status behavior. Unknown issued effects remain unknown and cannot be replayed or cleared by status. Authentication commands, URL parsing and credential storage remain owned by each official CLI/harness adapter; no real account or credential is used in tests.

## Acceptance

The native SDK test fails against 0.61.6 before the handler. Isolated SDK/tmux/fake-CLI tests cover automatic/explicit start, live creator/generation proof, auth-only input/keys, result polling, cancel/absence, cold authenticated no-op with no server, and same-generation Claude login-to-onboarding. Missing creator stamps refuse without graph changes. Existing dispatcher, authentication and native-server tests keep their refusal/receipt contracts. Native tests are POSIX-only; a Windows skip is not native support evidence. Public receipt schema stays aiterm.agent-auth-result.v1.
