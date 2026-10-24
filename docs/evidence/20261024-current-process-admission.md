# Current-process actor observation acceptance

Runtime source: 4452f0ea4fceaae5989b5fd8102801237c729bd6, based on official 0.61.13.
Only execution-parent-worker changes at runtime. The native local runtime retains
its verified own-process PID/start identity; foreign actors, server/source/target
generations, participant declarations and injected runtime checks remain fresh.

The original runtime failed the new redundant-probe regression. The corrected
Linux build and three new isolated tests passed. The same intercepted native
adapter, with ten scope assertions, reduced self-identity subprocess probes from
12 to 1; no actual OS subprocess or agent was used by that comparison.

Fixed-source hosted gates:

- macOS 14 / Node 22: run 40090780282, product 4452f0e, harness 34232eb;
  preflight 16 passed, new relevant tests 3 passed, no failed/skipped cases.
- Windows 2022 / Node 22: run 40090782138, same product/harness;
  preflight 13 passed / 3 platform exclusions, relevant tests 1 passed / 2 POSIX
  exclusions, no failures. This is not acceptance of native Windows execution
  checkpoints or POSIX-only runtime composition.

Consumer contract/package review: Trony's saved trony-acceptance.json dated
2026-10-24T11:36:07.385611+00:00, 17 evidence hashes / 117 package files /
109 JavaScript files matched; one runtime module changed and 108 stayed equal.
No consumer source change or required finding; no consumer/native success group
was rerun. Previous whole-product successes remain historical evidence, not new
full regression acceptance for this change. Main/tag metadata gates must not
silently rerun those old groups.

This is a bounded admission-overhead correction. It does not clear unknown sends,
identify the original c739 failure, establish whole-service recovery, or repair
all long metadata-lock observations. No production seat, send replay, restart,
unknown-state mutation or deployment is part of this release acceptance.
