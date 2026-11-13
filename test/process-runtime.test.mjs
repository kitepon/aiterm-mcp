import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { createHash } from "node:crypto";
import { parsePosixProcessTable, parseCpuTime, processSubtree, processIdentity, readRuntimeProcesses, readProcessIdentities, backgroundProcesses, parsePosixElapsed, processElapsedSeconds, readRuntimeProcessesShared } from "../dist/process-runtime.js";
import { spawnCollect } from "../dist/spawn-collect.js";

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

test('Darwin session leaders separate detached trees when sess is redacted to zero',()=>{
 const row=(pid,parent,pgid,stat)=>`${pid} ${parent} ${pgid} 0 ${stat} Sun Nov 1 12:00:00 2026 00:00.01 node`;
 const rows=parsePosixProcessTable([row(10,1,10,'Ss'),row(11,10,11,'S'),row(20,10,20,'Ss'),row(21,20,21,'S'),row(30,1,30,'S'),row(31,32,31,'S'),row(32,31,32,'S')].join('\n'),true,'darwin');
 const byPid=new Map(rows.map(r=>[r.pid,r]));
 assert.equal(byPid.get(10).session_identity,byPid.get(11).session_identity);
 assert.equal(byPid.get(20).session_identity,byPid.get(21).session_identity);
 assert.notEqual(byPid.get(10).session_identity,byPid.get(20).session_identity);
 for(const pid of [30,31,32])assert.equal(byPid.get(pid).session_identity,null);
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

test("pidを指定した開始時刻の照会は、全process一覧と一致し終了後のpid再利用を区別する", () => {
  const own = readRuntimeProcesses().find(row => row.pid === process.pid);
  assert.deepEqual(readProcessIdentities([process.pid]), [{ pid: process.pid, started_identity: own.started_identity }]);
  assert.deepEqual(readProcessIdentities([]), []);
  // 終了した子のpidは別processへ再利用され得る。終了前に開始時刻を保存し、同じprocessが残っていない事を確かめる。
  const probe = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import { readProcessIdentities } from ${JSON.stringify(new URL("../dist/process-runtime.js", import.meta.url).href)}; process.stdout.write(JSON.stringify(readProcessIdentities([process.pid])[0]));`,
  ], { encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  const gone = JSON.parse(probe.stdout);
  assert.equal(gone.pid, probe.pid);
  assert.ok(gone.started_identity);
  for (const row of readProcessIdentities([gone.pid])) assert.notEqual(row.started_identity, gone.started_identity);
  const mixed = readProcessIdentities([gone.pid, process.pid]);
  assert.deepEqual(mixed.filter(row => row.pid === process.pid), [{ pid: process.pid, started_identity: own.started_identity }]);
  for (const row of mixed.filter(row => row.pid === gone.pid)) assert.notEqual(row.started_identity, gone.started_identity);
});

test("Windowsの開始時刻の照会は、CommandLineを読めないprocessも返す", { skip: process.platform !== "win32" }, () => {
  // pid 4（System）はCommandLineを持たない。pidが使い回された先を「別のprocess」と確かめるには、こういうprocessの行が要る。
  assert.equal(readRuntimeProcesses().some(row => row.pid === 4), false);
  assert.deepEqual(readProcessIdentities([4]).map(row => row.pid), [4]);
});

test("processの経過時間: psの「[[日-]時:]分:秒」を秒にする", () => {
  assert.equal(parsePosixElapsed("      00:05"), 5);
  assert.equal(parsePosixElapsed("01:35:06"), 5706);
  assert.equal(parsePosixElapsed("05-01:28:34"), 5 * 86400 + 5314);
  assert.equal(parsePosixElapsed(""), null);
  assert.equal(parsePosixElapsed("Mon Oct  5"), null);
});

test("processの経過時間: 生きているprocessは経過を返し、終了したprocessはnullを返す", () => {
  const own = processElapsedSeconds(process.pid);
  assert.ok(typeof own === "number" && own >= 0 && own < 3600, String(own));
  const gone = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(gone.status, 0);
  assert.equal(processElapsedSeconds(gone.pid), null);
  assert.throws(() => processElapsedSeconds(0), /pidが不正/);
});

test("the shared process table is shared only by calls made before its read started", async () => {
  const first = readRuntimeProcessesShared();
  // Started after the first read began: only a later read can see it.
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},5000)"], { stdio: "ignore" });
  try {
    const second = readRuntimeProcessesShared(), third = readRuntimeProcessesShared();
    const [a, b, c] = await Promise.all([first, second, third]);
    assert.notEqual(a, b);
    assert.equal(b, c);
    assert.ok(b.some(row => row.pid === child.pid));
    assert.ok(b.some(row => row.pid === process.pid));
    const fourth = await readRuntimeProcessesShared();
    assert.notEqual(fourth, b);
  } finally { child.kill(); }
});

test("spawnCollect reports status, timeout and output limit in the spawnSync form", { skip: process.platform === "win32" }, async () => {
  const ok = await spawnCollect(process.execPath, ["-e", "process.stdout.write('x');process.exit(3)"], { timeout: 10000, maxBuffer: 1024 });
  assert.equal(ok.status, 3); assert.equal(ok.stdout, "x"); assert.equal(ok.error, undefined);
  const slow = await spawnCollect(process.execPath, ["-e", "setTimeout(()=>{},10000)"], { timeout: 100, maxBuffer: 1024 });
  assert.equal(slow.error?.code, "ETIMEDOUT"); assert.equal(slow.status, null);
  const big = await spawnCollect(process.execPath, ["-e", "process.stdout.write('y'.repeat(4096))"], { timeout: 10000, maxBuffer: 16 });
  assert.equal(big.error?.code, "ENOBUFS");
  const missing = await spawnCollect("/nonexistent/aiterm-probe", [], { timeout: 1000, maxBuffer: 16 });
  assert.equal(missing.error?.code, "ENOENT");
});
