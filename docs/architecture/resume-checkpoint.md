# Offline resume checkpoint and restore (H1)

[Rendered diagram](resume-checkpoint.svg) / [DOT](resume-checkpoint.dot).

`src/resume-checkpoint.ts` owns the strict bounded envelope and record chain. It reuses existing lifecycle/attempt/native/template/resolution/origin/proof/failure schemas and preserves original record bytes. The Codex metadata subset is strict: unknown provenance is refused rather than discarded. Failed and hibernated sources are distinct; a failed attempt is never rewritten.

`src/resume-checkpoint-files.ts:createOfflineResumeCheckpoint` reads the explicitly configured Linux state base. It checks ownership, permissions, canonical non-symlink paths, bounded regular files, unchanged reads and the retained vendor root device/inode/prefix. It neither creates missing directories nor writes metadata, locks, queues or native state. Source shutdown and restart prevention remain the supply caller's prerequisite; successful encoding is not a source-stop receipt.

The exact encoded stream limit is 16 MiB including its final LF. Each decoded record is bounded to 4 MiB; the chain is bounded to 64 generations and 512 records. The bundle contains only derived record paths; it cannot request arbitrary file reads or silently truncate history.

The `aiterm-resume-state` bin is `dist/resume-state-cli.js`. Checkpoint writes the private bounded bundle to stdout and one safe six-field receipt to stderr. Restore reads stdin, checks the expected session/launch/SHA and writes a safe receipt to stdout. Receipt limit: 512 bytes including LF. Fixed error: `aiterm: RESUME_STATE_UNCONFIRMED` + LF, 33 bytes; exit 2. Bundle limit is independent of receipt bytes. All source shutdown, writer exclusion, private storage and boot-adoption requirements remain caller responsibilities.

`restoreOfflineResumeCheckpoint` requires the caller's existing startup admission; normal bootstrap/clients and concurrent restores must not run. It validates the complete bundle, environment/UID/socket and retained vendor proof before any target directory is created. Known absence of the target native is required and rechecked. The immutable same-digest journal owns a private staging directory; complete files are fsynced and linked into place. The generation pointer is reserved before ancestor records; current metadata is published last. A partial restore continues only for the same digest and exact completed files. Existing different bytes, target generations or unknown entries are refused. It does not start a native, worker, queue or input. A source-stop receipt is not inferred from destination absence.

Close/kill cleanup includes the restore journal and its staging directory. Boot adoption and preventing replay after normal bootstrap are runtime responsibilities; the CLI's `already_restored` only means its exact restored files remain unchanged.

Direct contract checks are in `test/resume-checkpoint.test.mjs` and `test/resume-checkpoint-core.test.mjs`. They cover strict records, stream separation, exact-byte restore, crash retry and subsequent ordinary recovery. Isolated fixtures do not establish real vendor, container or Host acceptance.

Crash retry discards only validated private staging names and creates each pending file with O_EXCL. A leftover hardlink is never opened for truncation. The codec requires the ordinary Codex reader completion route and complete valid lineage; explicit credential variable names are rejected in templates as well as recipes.

The CLI resolves the invoked path and its module path before comparing them, so the ordinary npm bin symlink executes the same entry as a direct Node invocation. Argument validation and the bounded stream/error contract are unchanged. The installed-style symlink regression lives in `test/resume-checkpoint.test.mjs`.
