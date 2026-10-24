# Remove shared tracking admission from delivery

Owner directed removal of the shared execution tracking lock from ordinary
delivery and stopping: recording must not prevent the tool from functioning.
Accepted implementation source efc5ba95f85f7864fba074c772206e1285228892 is based
on official0.61.16. This is a routing removal, not a shorter tracking timeout.

- The native compatibility MCP CLI constructs ordinary Aiterm handlers and
  direct agent_stop. It never constructs the tracking participant, dispatcher,
  store or registration controls. Standard index remains18 tools; the native
  compatibility entry provides19 including direct stop.
- All three parent-hook CLI modes call the ordinary provider without an
  execution worker or delivery_admission callback. Hook setup replaces owned
  native hook entries with standard scripts, preserving foreign configuration.
- Stop uses ordinary agent metadata lineage and sends normal keys leaves-first.
  No shared execution graph access or writer-lock acquisition/wait is performed.
  Failure to read lineage still forwards the explicit root key. Key acceptance
  is not an assertion that a native process has finished.
- A host must remove mandatory ExecutionBridge registration before ordinary
  dispatch. The legacy native CLI arguments remain usable for its direct stop
  control. A concrete BellTeam integration patch is supplied as a proposal;
  producer work does not modify that consumer repository or operate production.

Validation on this fixed source:

- Linux preflight16; seven new unique cases pass. Actual isolated SDK11PTY
  text delivery succeeds with an old writer-lock file and corrupt old graph.
  Direct stop order and root forwarding on lineage failure pass; MCP compatibility
  entry does not need a tracking provider. Claude/Cursor/Codex hook modes receive
  the ordinary profile. Migration installs the standard hook scripts.
- Four changed hook-configuration contracts pass, including foreign-entry
  preservation/idempotence and no requirement for retired native admission.
  One Windows-only hook refusal case is outside this POSIX run. Metadata15 passes.
- macOS14/Node22 fixed-source run40098908158, workflow
  db36a85da70911897dbbea910dba54c991e6f378: preflight16, new7 and changed hook4
  pass; one Windows-only case skipped. No real Bot fault, production operation,
  original request replay or new restriction/queue/retry is introduced.
- Original failure logs are retained: a missing helper brace refused the first
  build and was corrected before runtime tests. Initial native delivery assertions
  passed but cleanup used an already-closed SDK; fixture cleanup was corrected to
  close its own isolated terminals directly and that case alone was rerun.

Older tracking factories remain historical injected library fixtures, not CLI or
ordinary hook routes. Old graph/unknown records are not deleted or reclassified.
Production restoration requires consumer integration plus deployment and an
actual fresh delivery/response, not merely publication of this producer package.
No old full/native/consumer success group is repeated by this promotion.
