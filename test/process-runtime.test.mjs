import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { parsePosixProcessTable, parseCpuTime, processSubtree, processIdentity, readRuntimeProcesses, backgroundProcesses } from "../dist/process-runtime.js";

test("POSIX process表の開始識別とargv digestを保持する", () => {
  const rows = parsePosixProcessTable(" 123 1 123 S Wed Sep  9 20:11:12 2026 1:02.34 /bin/bash -l\n 124 123 124 T+ Wed Sep  9 20:11:13 2026 00:01.20 node worker.mjs\n");
  assert.equal(rows[0].stopped, false);
  assert.equal(rows[1].stopped, true);
  assert.equal(rows[0].cpu_seconds, 62.34);
  assert.equal(rows[0].started_identity, "Wed Sep  9 20:11:12 2026");
  assert.equal(rows[0].argv_digest, createHash("sha256").update("/bin/bash -l").digest("hex"));
  assert.deepEqual(processSubtree(rows, 123).map(row => row.pid), [123, 124]);
  assert.equal("command" in processIdentity(rows[0]), false);
  assert.equal(parseCpuTime("2-03:04:05.50"), 183845.5);
});

test("background活動から起動直後の足場processを除く", () => {
  const root = { pid: 1, started_identity: "2026-09-10T00:00:00.000Z" };
  const rows = [root, { pid: 2, started_identity: "2026-09-10T00:00:59.000Z" },
    { pid: 3, started_identity: "2026-09-10T00:01:00.000Z" }];
  assert.deepEqual(backgroundProcesses(rows, root).map(row => row.pid), [3]);
});

test("実process表から自身のnative PIDを観測できる", () => {
  const own = readRuntimeProcesses().find(row => row.pid === process.pid);
  assert.ok(own);
  assert.ok(own.cpu_seconds >= 0);
  assert.match(own.argv_digest, /^[a-f0-9]{64}$/);
});
