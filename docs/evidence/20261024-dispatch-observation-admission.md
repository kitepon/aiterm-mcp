# Dispatch observation outside shared admission

Accepted runtime source: 7050b95989e87015391cc94104ab1c949b9deb38, based on
official 0.61.15. Only execution-service.js changes among 109 runtime JS files.
Registration observes source/target outside the writer mutex and rechecks the
existing reservation and current admission metadata before insertion. Returned
launch/send binding freezes the original issued slot, observes outside the
mutex and rechecks that same slot, issued state and observed generation.
The synchronous native effect gate remains unchanged. Late request cancellation
retains a genuine action receipt; uncertainty is never replay permission.

Focused acceptance:

- Baseline official .15: all four new contention cases fail. Holding one
  returned receipt's observation makes all ten other registered room invokes
  fail BUSY. The isolated fixture uses the actual durable store and service,
  injected observations and a 60ms lock deadline, without real native effects.
- Linux: eight new cases pass, including eleven send/empty-launch targets,
  blocked registration/source observation, concurrent unknown slot, a new
  target blocker, changed generation and late request cancellation. Fifteen
  directly affected existing lifecycle/dispatcher/creation contracts pass.
  Preflight16 passes. No old full/native/consumer success group is rerun.
- Hosted macOS14/Node22: run40096565355, fixed product7050b959 and workflow
  bc86d91dae8ca05353edd04cf9acd4f9adb1c047. Preflight16 and new8 pass, no
  failure or skip. New durable POSIX fixture cases remain outside unsupported
  Windows composition; no new Windows execution or acceptance is claimed.
- Trony acceptance at 2026-10-24T13:07:10.342979+00:00: required findings0,
  trony-acceptance.json SHA256
  151f527a9259d069e47b0f4e27b67b3245ad44f3892b615b571580bc2c9d17fb.
  All24 acceptance evidence hashes directly matched, with the producer's
  original16 and package117/109JS unchanged. Three new in-process consumer
  cases connect real RoomMessenger/AitermClient/ExecutionBridge to the candidate
  handlers/service/store. Other10 complete during held registration/receipt
  observation; all11 effects occur once. A concurrent unknown keeps its failed
  original slot while other10 succeed. One responder still delivers to11.
  Notify/native are synthetic; no real AitermTransport/MCP wire/live room.

The production test's actual mutex holder/holding call remains uncaptured.
This fixes two demonstrated delivery blocking paths, not a proven historical
sole cause or production restoration. Nondeferred/management/interruption
observation paths are unchanged. No new restriction, queue, retry, replay,
unknown cleanup, live-seat fault test or production adoption is introduced.
Publication metadata verification is separate from the accepted runtime above.
