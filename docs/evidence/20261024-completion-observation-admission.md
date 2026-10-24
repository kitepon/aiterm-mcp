# Completion observation outside shared admission

Runtime source fe3536d51b7f5f8c4d33143d88fe7bbeaa566f4f is based on official
0.61.14. The only runtime change is execution-service.js. Completion evidence
for the original request/Point is observed without holding the global metadata
mutex. The commit rechecks the unchanged original record, issued/unknown stages,
original slot, parent effects and the same Point; pending parent return uses
current commit state. Existing settled results remain idempotent.

Focused acceptance already completed:

- Linux: six new unique cases passed plus three directly affected ordinary
  completion lifecycle cases. One invalid cross-session target fixture was
  rejected by the original schema; only the fixture was corrected to change
  the same session's Point boundary and that one case was rerun successfully.
  The original failure log is retained. Build passed before and after rebasing
  over the metadata-only official 0.61.14 release.
- Hosted macOS 14 / Node 22: run40091561460, fixed product fe3536d, harness
  f9deba6; preflight16 and new6 passed, no failure/skip. The new cases require
  POSIX durable execution composition and are outside the unsupported native
  Windows composition; no native Windows acceptance or extra Windows run is
  claimed.
- Trony consumer/source/package review at 2026-10-24T12:08:34.881749+00:00:
  trony-acceptance.json SHA256
  cf0f9e8bca730d9dbf0c3e861f5f122c9f8af564431c7c9a00e14bf958bb7300;
  26 evidence hashes and 3 consumer source hashes directly matched. All117
  package files /109JS matched; service1JS changed and108 stayed equal.
  Actual BellTeam41a AitermClient/ExecutionBridge/DeliveryJob joined the real
  candidate handlers/service/store through an in-process callTool adapter.
  Separate registration progressed in1.06ms while completion was held; a
  concurrently uncertain original request retained unknown/slot1 and the
  accepted receipt. Two new cases, required findings0. Initial wrong
  record.request fixture reference was corrected to reservation.request;
  the original log is retained. No MCP wire/native/real-seat acceptance.

No prior full/native/consumer success group is rerun by this promotion. Main
publication metadata validation is separate from runtime acceptance above.
This release neither identifies the historical production mutex owner nor
proves whole-service recovery. Registration/interrupted observation and actual
effect admission retain their existing shared sections. Unknown-send recovery,
request replay, new retry/ID/guard mechanisms, production adoption and real
session operations are not part of this release.
