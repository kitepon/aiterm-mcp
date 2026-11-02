# Offline checkpoint reader component (H1, partial candidate)

[Rendered diagram](resume-checkpoint.svg) / [DOT](resume-checkpoint.dot).

`src/resume-checkpoint.ts` owns the strict bounded envelope and record chain. It reuses existing lifecycle/attempt/native/template/resolution/origin/proof/failure schemas and preserves original record bytes. The Codex metadata subset is strict: unknown provenance is refused rather than discarded. Failed and hibernated sources are distinct; a failed attempt is never rewritten.

`src/resume-checkpoint-files.ts:createOfflineResumeCheckpoint` reads the explicitly configured Linux state base. It checks ownership, permissions, canonical non-symlink paths, bounded regular files, unchanged reads and the retained vendor root device/inode/prefix. It neither creates missing directories nor writes metadata, locks, queues or native state. Source shutdown and restart prevention remain the supply caller's prerequisite; successful encoding is not a source-stop receipt.

The exact encoded stream limit is 16 MiB including its final LF. Each decoded record is bounded to 4 MiB; the chain is bounded to 64 generations and 512 records. The bundle contains only derived record paths; it cannot request arbitrary file reads or silently truncate history.

The public `aiterm-resume-state` bin, restore journal/partial recovery, stream CLI receipts, package staging, and checkpoint→restore→R1-C integration are **not implemented by this component commit**. The diagram keeps these planned operations separate. No MCP registration or normal mutation admission changed.

Direct checks: `test/resume-checkpoint.test.mjs`, 11 passed; build exit 0. This covers encoded round trips, original failed bytes, unsupported metadata, changed recipe/proof/vendor/path, canonical framing/digests/bounds, source bytes unchanged, missing-state no mkdir, symlinks/permissions and replaced root. The initial reader fixture used a different TMPDIR socket and was corrected; its failure is retained in the author's raw evidence. No real vendor/container/Host acceptance is claimed.
