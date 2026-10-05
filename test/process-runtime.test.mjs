import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createHash } from "node:crypto";
import { parsePosixProcessTable, parseCpuTime, processSubtree, processIdentity, readRuntimeProcesses, readProcessIdentities, backgroundProcesses, lazyRelayProcess, aitermProcessProbe, windowsConsoleHost, parsePosixElapsed, processElapsedSeconds } from "../dist/process-runtime.js";

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

test("中継（mcp-lazy）を、起動した実行ファイルの名前で見分ける", () => {
  assert.equal(lazyRelayProcess("/usr/local/bin/mcp-lazy /usr/local/bin/node /srv/aiterm/dist/index.js"), true);
  assert.equal(lazyRelayProcess("/srv/trial/mcp-lazy-0.3.0-7cdb9cc --log-file /tmp/relay.log -- /usr/local/bin/node index.js"), true);
  assert.equal(lazyRelayProcess('"C:\\Program Files\\MCP Lazy\\MCP-Lazy.exe" node.exe index.js'), true);
  assert.equal(lazyRelayProcess("/usr/local/bin/node /srv/mcp-lazy/tools/real-stdio-smoke.mjs"), false);
  assert.equal(lazyRelayProcess("/bin/sh -c mcp-lazy node index.js"), false);
  assert.equal(lazyRelayProcess("/usr/local/bin/lazy-mcp node index.js"), false);
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

test("Aitermがprocess表を引くために起こしたprocessを、コマンドの形で見分ける", () => {
  // 一覧を取るprocessは、自分自身も一覧に載る。実際に起こした形と見分けの形が合っている事を、各OSの実物で確かめる。
  assert.ok(readRuntimeProcesses().some(row => aitermProcessProbe(row.command)));
  assert.equal(aitermProcessProbe("/bin/ps -axww -o pid=,ppid=,pgid=,stat=,lstart=,time=,command="), true);
  assert.equal(aitermProcessProbe("/bin/ps -o pid=,lstart= -p 4242,4243"), true);
  // 実測（Windows 11、2026-10-04）: 席の中のaiterm-mcpが約2.5秒おきに起こしていたPowerShell。
  assert.equal(aitermProcessProbe('"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo -NoProfile -NonInteractive -EncodedCommand JABFAHIAcgBvAHIAQQBjAHQAaQBvAG4AUAByAGUAZgBlAHIAZQBuAGMAZQA9ACcAUwB0AG8AcAAnAAoAWwBDAG8AbgBzAG8AbABlAF0AOgA6AE8AdQB0AHAAdQB0AEUAbgBjAG8AZABpAG4AZwA9AFsAVABlAHgAdAAuAFUAVABGADgARQBuAGMAbwBkAGkAbgBnAF0AOgA6AG4AZQB3ACgAJABmAGEAbABzAGUAKQAKACQAcgBvAHcAcwA9AEAAKABHAGUAdAAtAEMAaQBtAEkAbgBzAHQAYQBuAGMAZQA='), true);
  // 利用者や他の道具が起こすpsとPowerShellは、今までどおり数える側に残す。
  assert.equal(aitermProcessProbe("ps aux"), false);
  assert.equal(aitermProcessProbe("/bin/ps -o pid=,comm= -p 4242"), false);
  assert.equal(aitermProcessProbe('"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo -NoProfile -NonInteractive -Command "Get-Date"'), false);
  assert.equal(aitermProcessProbe('"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo -NoProfile -NonInteractive -EncodedCommand RwBlAHQALQBEAGEAdABlAA=='), false);
});

test("Windowsのconsole hostを実行ファイルの名前で見分ける", () => {
  assert.equal(windowsConsoleHost({ command: "\\??\\C:\\WINDOWS\\system32\\conhost.exe 0x4" }), true);
  assert.equal(windowsConsoleHost({ command: "conhost", executable: "C:\\WINDOWS\\system32\\conhost.exe" }), true);
  assert.equal(windowsConsoleHost({ command: '"C:\\Program Files\\nodejs\\node.exe" conhost.exe' }), false);
});

test("Windowsの開始時刻の照会は、CommandLineを読めないprocessも返す", { skip: process.platform !== "win32" }, () => {
  // pid 4（System）はCommandLineを持たない。pidが使い回された先を「別のprocess」と確かめるには、こういうprocessの行が要る。
  assert.equal(readRuntimeProcesses().some(row => row.pid === 4), false);
  assert.deepEqual(readProcessIdentities([4]).map(row => row.pid), [4]);
});

test("processの経過時間: psの「[[日-]時:]分:秒」を秒にし、照会はAiterm自身の物と見分ける", () => {
  assert.equal(parsePosixElapsed("      00:05"), 5);
  assert.equal(parsePosixElapsed("01:35:06"), 5706);
  assert.equal(parsePosixElapsed("05-01:28:34"), 5 * 86400 + 5314);
  assert.equal(parsePosixElapsed(""), null);
  assert.equal(parsePosixElapsed("Mon Oct  5"), null);
  assert.equal(aitermProcessProbe("/bin/ps -o etime= -p 1234"), true);
  assert.equal(aitermProcessProbe("/bin/ps -o etime="), false);
});

test("processの経過時間: 生きているprocessは経過を返し、終了したprocessはnullを返す", () => {
  const own = processElapsedSeconds(process.pid);
  assert.ok(typeof own === "number" && own >= 0 && own < 3600, String(own));
  const gone = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(gone.status, 0);
  assert.equal(processElapsedSeconds(gone.pid), null);
  assert.throws(() => processElapsedSeconds(0), /pidが不正/);
});
