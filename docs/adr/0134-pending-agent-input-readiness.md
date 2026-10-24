# 0134: Select pending ordinary input again before native issuance

Status: accepted

## Context

An ordinary Codex send can observe the same idle-looking screen twice while a
recorded turn continues, select dispatch, and then see a busy indicator during
readiness waiting. The dispatch-only wait rejects that legitimate input after
30 seconds. A confirmed exited harness can also consume the same wait before
refusal. These are independently reproduced product behaviors; the original
screen sequence of the reported delivery was not retained.

## Decision

Only an ordinary pending send may terminate its readiness observation by
selecting the existing steer path. Core owns that choice and all effects;
agent-screen-observation owns samples, time and early return. The original
request, source, target and send lock remain unchanged. Launch/configuration
readiness waits do not acquire this ability.

Confirm the captured launch and check for proven harness exit before ordinary
send preparation, during readiness sampling, and inside native admission before
paste and Enter. A missing target or a confirmed dead harness refuses without
waiting for the readiness deadline. An unresolved process observation does not
become a death assertion. Modal precedence and each harness's existing running
turn rules still apply, including Grok's unaccepted prompt refusal and Cursor's
recorded completion after a stale busy indicator.

The execution service still validates source/target generations, stop fences,
and unresolved operation slots immediately before effects. This change does
not relax that admission. No catch of a failed native operation reenters send.
Exit after paste prevents Enter and retains `possible`/unknown issuance; it
cannot become `not_started` or permission to replay the request.

## Validation

An isolated real-tmux/fake-harness fixture controls screen samples and native
interleavings through the actual dispatcher, service and file store. It checks
one accepted steer, immediate known-exit refusal, startup/modal preservation,
stop/source/target/unknown-slot fences at rerouting, exit during preparation,
and possible effect without replay after paste. Portable observation tests
cover the opt-in early return without changing other readiness callers. The
POSIX fixture is not native Windows or real CLI acceptance evidence.
