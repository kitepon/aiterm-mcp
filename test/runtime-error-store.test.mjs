import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  RuntimeErrorStore,
  defaultRuntimeErrorPaths,
  recordRuntimeError,
  runtimeErrorStoreDiagnostic,
  validateRuntimeObservation,
  windowsPrivateDaclCommand,
  windowsPrivateDaclVerifyCommand,
} from "../dist/runtime-error-store.js";
import { expectedHostProfiles } from "../dist/runtime-error-os.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_URL = pathToFileURL(path.join(HERE, "..", "dist", "core.js")).href;
const STORE_URL = pathToFileURL(path.join(HERE, "..", "dist", "runtime-error-store.js")).href;
const actualProfile = () => process.platform === "darwin" ? "mac"
  : process.platform === "win32" ? "windows-native"
    : (process.env.WSL_DISTRO_NAME || /microsoft/i.test(os.release()) ? "wsl" : "server");

test("native Linux factory config accepts server and workstation profiles without widening WSL", () => {
  assert.deepEqual(expectedHostProfiles("linux", {}, "6.8.0-generic"), ["server", "linux"]);
  assert.deepEqual(expectedHostProfiles("linux", { WSL_DISTRO_NAME: "Ubuntu" }, "6.8.0-microsoft"), ["wsl"]);
});

function applyWindowsPrivateAcl(target, kind = "file") {
  if (process.platform !== "win32") return;
  const command = windowsPrivateDaclCommand(target, kind);
  const result = spawnSync(command.command, command.args, { encoding: "utf8", windowsHide: true, env: command.env });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

function fixture(enabled = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-runtime-errors-"));
  const configPath = path.join(root, "config.json");
  const storePath = path.join(root, "state", "runtime-errors.json");
  const platform = process.platform === "win32" ? "win32" : "darwin";
  const profile = platform === "win32" ? "windows-native" : "mac";
  fs.writeFileSync(configPath, JSON.stringify({
    schema_version: "1.0",
    host: { id: "test-host", profile },
    collection: { enabled },
    reporting: { enabled: false },
  }), { mode: 0o600 });
  applyWindowsPrivateAcl(configPath);
  let now = Date.parse("2026-07-13T00:00:00.000Z");
  const stderr = [];
  const store = new RuntimeErrorStore({
    configPath,
    storePath,
    platform,
    arch: "arm64",
    productVersion: "0.12.1-test",
    now: () => new Date(now),
    stderr: (line) => stderr.push(line),
  });
  return {
    root, configPath, storePath, store, stderr, platform, profile,
    tick(ms = 1000) { now += ms; },
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

test("collection は missing/disabled/malformed config で fail closed", () => {
  const f = fixture(false);
  try {
    assert.equal(f.store.collectionStatus(), "disabled");
    assert.equal(f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" }), false);
    assert.equal(fs.existsSync(f.storePath), false);

    fs.rmSync(f.configPath);
    assert.equal(f.store.collectionStatus(), "disabled");
    fs.writeFileSync(f.configPath, "{broken");
    assert.equal(f.store.collectionStatus(), "malformed");
    assert.equal(f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" }), false);

    fs.writeFileSync(f.configPath, JSON.stringify({ collection: { enabled: "true" } }));
    assert.equal(f.store.collectionStatus(), "malformed");
  } finally { f.cleanup(); }
});

test("canonical config は dotagents schema と同値の exact/length/conditional/profile 契約で fail closed", () => {
  const f = fixture();
  const base = {
    schema_version: "1.0",
    host: { id: "test-host", profile: f.profile },
    collection: { enabled: true },
    reporting: { enabled: false },
  };
  const write = (value) => fs.writeFileSync(f.configPath, JSON.stringify(value), { mode: 0o600 });
  try {
    assert.equal(f.store.collectionStatus(), "enabled");
    for (const invalid of [
      { ...base, extra: true },
      { ...base, host: { ...base.host, extra: true } },
      { ...base, host: { id: "a".repeat(65), profile: f.profile } },
      { ...base, host: { id: "test-host", profile: f.profile === "mac" ? "server" : "mac" } },
      { ...base, collection: { enabled: true, extra: true } },
      { ...base, reporting: { enabled: false, extra: true } },
      { ...base, reporting: { enabled: true } },
      { ...base, reporting: { enabled: true, endpoint: "file:///tmp/x", credential_file: "x" } },
      { ...base, reporting: { enabled: true, endpoint: "https://example.invalid", credential_file: "" } },
      { ...base, reporting: { enabled: true, endpoint: `https://example.invalid/${"a".repeat(2048)}`, credential_file: "x" } },
    ]) {
      write(invalid);
      assert.equal(f.store.collectionStatus(), "malformed", JSON.stringify(invalid).slice(0, 200));
    }
    write({ ...base, reporting: { enabled: true, endpoint: "https://example.invalid/report", credential_file: "/private/token" } });
    assert.equal(f.store.collectionStatus(), "enabled", "reporting field はschema検証だけ行いcredential file本文は読まない");
  } finally { f.cleanup(); }
});

test("収集 API は固定 code だけを受け、raw payload/privacy field を拒否する", () => {
  assert.deepEqual(validateRuntimeObservation({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" }), {
    code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE",
  });
  for (const value of [
    new Error("secret"),
    { code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE", exception: new Error("raw") },
    { code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE", stderr: "raw" },
    { code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE", stdout: "raw" },
    { code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE", stack: "raw" },
    { code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE", prompt: "raw" },
    { code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE", pty: "raw" },
    { code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE", transcript: "raw" },
    { code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE", event: {} },
    { code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE", path: "/Users/name/private" },
    { code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE", file_contents: "raw" },
    { code: "UNKNOWN" },
  ]) assert.throws(() => validateRuntimeObservation(value), /allowlist|field|object/);
});

test("同じ固定 failure は SHA-256 fingerprint で集約し count/first/last/sequence を更新する", () => {
  const f = fixture();
  try {
    assert.equal(f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" }), true);
    f.tick();
    assert.equal(f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" }), true);
    const snap = f.store.snapshot();
    assert.equal(snap.cursor, 2);
    assert.equal(snap.acknowledged_cursor, 0);
    assert.equal(snap.records.length, 1);
    const [record] = snap.records;
    assert.match(record.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(record.occurrence_count, 2);
    assert.equal(record.first_seen, "2026-07-13T00:00:00.000Z");
    assert.equal(record.last_seen, "2026-07-13T00:00:01.000Z");
    assert.equal(record.sequence, 2);
    assert.equal(record.status, "open");
    assert.equal(record.resolved_at, null);
    assert.equal(record.reason_code, null);
    assert.deepEqual(Object.keys(record).sort(), [
      "arch", "component", "error_code", "fingerprint", "first_seen", "last_seen",
      "message_template", "occurrence_count", "os", "product", "product_version",
      "reason_code", "resolved_at", "sequence", "severity", "state_schema_version", "status",
    ].sort());
    assert.doesNotMatch(JSON.stringify(snap), /Users|stderr|stack|prompt|transcript|event|secret/i);
  } finally { f.cleanup(); }
});

test("保存 state は top/record exact・固定定義・fingerprint 再計算を通り、snapshot は DTO projection だけ返す", () => {
  const f = fixture();
  try {
    f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" });
    const original = JSON.parse(fs.readFileSync(f.storePath, "utf8"));
    const write = (value) => fs.writeFileSync(f.storePath, JSON.stringify(value) + "\n", { mode: 0o600 });

    write({ ...original, injected: "/Users/private" });
    assert.throws(() => f.store.snapshot(), /schema/);
    assert.equal(f.store.diagnostic().status, "unverified");

    write({ ...original, records: [{ ...original.records[0], stderr: "secret" }] });
    assert.throws(() => f.store.snapshot(), /schema/);

    write({ ...original, records: [{ ...original.records[0], fingerprint: "0".repeat(64) }] });
    assert.throws(() => f.store.snapshot(), /schema/);

    write({ ...original, records: [{
      ...original.records[0], status: "resolved", reason_code: "operator_resolved",
      resolved_at: "2026-07-12T23:59:59.000Z",
    }] });
    assert.throws(() => f.store.snapshot(), /schema/);

    write(original);
    const snapshot = f.store.snapshot();
    assert.deepEqual(Object.keys(snapshot).sort(), ["acknowledged_cursor", "collection", "cursor", "records", "schema_version"].sort());
    assert.deepEqual(Object.keys(snapshot.records[0]).sort(), [
      "arch", "component", "error_code", "fingerprint", "first_seen", "last_seen", "message_template",
      "occurrence_count", "os", "product", "product_version", "reason_code", "resolved_at",
      "sequence", "severity", "state_schema_version", "status",
    ].sort());
  } finally { f.cleanup(); }
});

test("POSIX config/store は every read で owner/private mode を再検証する", {
  skip: process.platform === "win32" ? "POSIX mode 専用" : undefined,
}, () => {
  const f = fixture();
  try {
    fs.chmodSync(f.configPath, 0o644);
    assert.equal(f.store.collectionStatus(), "malformed");
    fs.chmodSync(f.configPath, 0o600);
    f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" });
    fs.chmodSync(f.storePath, 0o644);
    assert.throws(() => f.store.snapshot(), /mode/);
    assert.equal(f.store.diagnostic().status, "unverified");
    fs.chmodSync(f.storePath, 0o600);
    fs.chmodSync(path.dirname(f.storePath), 0o755);
    assert.throws(() => f.store.snapshot(), /owner\/mode/);
  } finally { f.cleanup(); }
});

test("bakery ticket queue は dead owner の固有ticketだけを回収する", () => {
  const f = fixture();
  try {
    f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" });
    const queue = `${f.storePath}.lock-queue`;
    fs.mkdirSync(queue, { recursive: true, mode: 0o700 });
    const ticket = path.join(queue, `0000000000000001-${"a".repeat(32)}.ticket`);
    fs.writeFileSync(ticket, JSON.stringify({ pid: 99999999, start_id: "dead:start", token: "a".repeat(32) }) + "\n", { mode: 0o600 });
    assert.equal(f.store.record({ code: "AITERM.PERSISTENCE_WRITE_FAILED" }), true);
    assert.equal(fs.existsSync(ticket), false);
  } finally { f.cleanup(); }
});

function runLockLstatSubprocess(f, target, patch) {
  const script = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    const input = ${JSON.stringify({ target, patch, storeUrl: STORE_URL, options: {
      configPath: f.configPath, storePath: f.storePath, platform: f.platform, arch: process.arch, productVersion: "0.12.1-test",
    } })};
    const originalLstat = fs.lstatSync;
    let calls = 0;
    fs.lstatSync = (candidate, ...args) => {
      if (candidate !== input.target) return originalLstat(candidate, ...args);
      calls += 1;
      const stat = originalLstat(candidate, ...args);
      if (input.patch === "vanish") {
        fs.unlinkSync(candidate);
        stat.nlink = 0;
      } else {
        Object.assign(stat, input.patch);
      }
      return stat;
    };
    syncBuiltinESMExports();
    const { RuntimeErrorStore } = await import(input.storeUrl);
    const store = new RuntimeErrorStore(input.options);
    try {
      const result = store.record({ code: "AITERM.PERSISTENCE_WRITE_FAILED" });
      const snapshot = store.snapshot();
      const record = snapshot.records.find((item) => item.error_code === "AITERM.PERSISTENCE_WRITE_FAILED");
      console.log(JSON.stringify({ calls, result, exists: fs.existsSync(input.target), occurrence_count: record?.occurrence_count ?? null }));
    } catch (error) {
      console.log(JSON.stringify({ calls, error: error instanceof Error ? error.message : String(error) }));
    }
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test("lock queue は choosing/ticket とも snapshot 後の nlink=0 正当unlinkを置換として skip する", {
  skip: process.platform === "win32" ? "POSIX lstat 専用" : undefined,
}, () => {
  for (const [kind, token] of [["choosing", "b".repeat(32)], ["ticket", "c".repeat(32)]]) {
    const f = fixture();
    try {
      f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" });
      const queue = `${f.storePath}.lock-queue`;
      const target = path.join(queue, kind === "choosing" ? `choosing-${token}.json` : `0000000000000000-${token}.ticket`);
      fs.writeFileSync(target, JSON.stringify({ pid: 99999999, start_id: "dead:start", token }) + "\n", { mode: 0o600 });
      const result = runLockLstatSubprocess(f, target, "vanish");
      assert.deepEqual(result, { calls: 1, result: true, exists: false, occurrence_count: 1 }, kind);
    } finally { f.cleanup(); }
  }
});

test("lock queue の nlink>2・owner・mode 不正は公開注入点なしでも pre-open 検証で拒否する", {
  skip: process.platform === "win32" ? "POSIX lstat 専用" : undefined,
}, () => {
  for (const [name, patch] of [["nlink>2", { nlink: 3 }], ["owner", { uid: process.getuid() + 1 }], ["mode", { mode: 0o100644 }]]) {
    const f = fixture();
    try {
      f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" });
      const queue = `${f.storePath}.lock-queue`;
      const target = path.join(queue, `0000000000000000-${"d".repeat(32)}.ticket`);
      fs.writeFileSync(target, JSON.stringify({ pid: 99999999, start_id: "dead:start", token: "d".repeat(32) }) + "\n", { mode: 0o600 });
      const result = runLockLstatSubprocess(f, target, patch);
      assert.equal(result.calls, 1, name);
      assert.match(result.error, /lock が不正/, name);
    } finally { f.cleanup(); }
  }
});

test("lock queue 本文の置換フレーズは choosing/ticket とも typed disappearance と誤分類せず残す", {
  skip: process.platform === "win32" ? "POSIX lstat 専用" : undefined,
}, () => {
  for (const [kind, token] of [["choosing", "e".repeat(32)], ["ticket", "f".repeat(32)]]) {
    const f = fixture();
    try {
      f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" });
      const queue = `${f.storePath}.lock-queue`;
      const target = path.join(queue, kind === "choosing" ? `choosing-${token}.json` : `0000000000000000-${token}.ticket`);
      fs.writeFileSync(target, "置換されました", { mode: 0o600 });
      assert.throws(() => f.store.record({ code: "AITERM.PERSISTENCE_WRITE_FAILED" }), undefined, kind);
      assert.equal(fs.existsSync(target), true, `${kind}: 改竄 entry を skip/削除してはいけない`);
    } finally { f.cleanup(); }
  }
});

test("20 process の同時観測をbakery ticket queueで全件保持する", {
  skip: process.platform === "win32" ? "bakery排他はPOSIX matrix、Windowsはnative DACL/store試験で固定" : undefined,
}, async () => {
  const f = fixture();
  try {
    const script = `import {RuntimeErrorStore} from ${JSON.stringify(STORE_URL)}; new RuntimeErrorStore(${JSON.stringify({
      configPath: f.configPath, storePath: f.storePath, platform: f.platform, arch: process.arch, productVersion: "0.12.1-test",
    })}).record({code:"AITERM.PTY_DEPENDENCY_UNAVAILABLE"});`;
    const outcomes = await Promise.all(Array.from({ length: 20 }, () => new Promise((resolve) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("exit", (code) => resolve({ code, stderr }));
    })));
    assert.deepEqual(outcomes, Array.from({ length: 20 }, () => ({ code: 0, stderr: "" })));
    assert.equal(f.store.snapshot().records[0].occurrence_count, 20);
  } finally { f.cleanup(); }
});

test("bakery queueの期限は総待ち時間でなく同じ先頭ownerの無進捗時間を測る", {
  skip: process.platform === "win32" ? "process identity fixtureはPOSIX専用" : undefined,
}, async () => {
  const f = fixture();
  let cleaner;
  try {
    f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" });
    const queue = `${f.storePath}.lock-queue`;
    const value = spawnSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8" }).stdout.trim();
    const startId = `${f.platform}:${value}`;
    const first = path.join(queue, `0000000000000001-${"1".repeat(32)}.ticket`);
    const second = path.join(queue, `0000000000000002-${"2".repeat(32)}.ticket`);
    fs.writeFileSync(first, `${JSON.stringify({ pid: process.pid, start_id: startId, token: "1".repeat(32) })}\n`, { mode: 0o600 });
    fs.writeFileSync(second, `${JSON.stringify({ pid: process.pid, start_id: startId, token: "2".repeat(32) })}\n`, { mode: 0o600 });
    const script = `
      import fs from "node:fs";
      const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      console.log("ready");
      sleep(900); fs.unlinkSync(${JSON.stringify(first)});
      sleep(900); fs.unlinkSync(${JSON.stringify(second)});
    `;
    cleaner = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "ignore"] });
    await new Promise((resolve, reject) => {
      cleaner.stdout.once("data", resolve);
      cleaner.once("error", reject);
    });
    let result;
    let recordError;
    try { result = f.store.record({ code: "AITERM.PERSISTENCE_WRITE_FAILED" }); }
    catch (error) { recordError = error; }
    const cleanerExit = await new Promise((resolve) => cleaner.once("exit", resolve));
    if (recordError) throw recordError;
    assert.equal(cleanerExit, 0);
    assert.equal(result, true);
  } finally {
    if (cleaner?.exitCode === null) cleaner.kill("SIGKILL");
    f.cleanup();
  }
});

test("採番前choosing公開は後発ticketのcritical section入場を止める", {
  skip: process.platform === "win32" ? "process identity fixtureはPOSIX専用" : undefined,
}, async () => {
  const f = fixture();
  try {
    const queue = `${f.storePath}.lock-queue`;
    fs.mkdirSync(queue, { recursive: true, mode: 0o700 });
    const token = "b".repeat(32);
    let startId;
    if (f.platform === "linux") {
      const stat = fs.readFileSync(`/proc/${process.pid}/stat`, "utf8");
      startId = `linux:${stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]}`;
    } else {
      const value = spawnSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8" }).stdout.trim();
      startId = `${f.platform}:${value}`;
    }
    const choosing = path.join(queue, `choosing-${token}.json`);
    fs.writeFileSync(choosing, `${JSON.stringify({ pid: process.pid, start_id: startId, token })}\n`, { mode: 0o600 });
    const script = `import {RuntimeErrorStore} from ${JSON.stringify(STORE_URL)}; new RuntimeErrorStore(${JSON.stringify({
      configPath: f.configPath, storePath: f.storePath, platform: f.platform, arch: process.arch, productVersion: "0.12.1-test",
    })}).record({code:"AITERM.PTY_DEPENDENCY_UNAVAILABLE"});`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "ignore" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(child.exitCode, null, "live choosingがある間は後発ticketを入場させない");
    fs.unlinkSync(choosing);
    const code = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(code, 0);
    assert.equal(f.store.snapshot().records[0].occurrence_count, 1);
  } finally { f.cleanup(); }
});

test("hanging telemetry worker/FIFO相当は main をblockせず timeoutで固定診断、diagnosticsもbounded", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-runtime-hang-"));
  try {
    const worker = path.join(root, "hang.mjs");
    const lateMarker = path.join(root, "late-marker");
    fs.writeFileSync(worker, `import{writeFileSync}from"node:fs";process.on("SIGTERM",()=>{});setTimeout(()=>writeFileSync(${JSON.stringify(lateMarker)},"late"),120);setInterval(()=>{},1000);\n`, { mode: 0o600 });
    const stderr = [];
    const started = Date.now();
    assert.equal(recordRuntimeError("AITERM.PTY_DEPENDENCY_UNAVAILABLE", {
      workerPath: worker, timeoutMs: 50, stderr: (line) => stderr.push(line),
    }), true);
    assert.ok(Date.now() - started < 200, "record scheduling は同期I/Oを待たない");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(stderr, ["aiterm: runtime error store unavailable\n"]);
    assert.equal(fs.existsSync(lateMarker), false, "deadline後のworker副作用をSIGKILLで止める");

    const diagnosticStarted = Date.now();
    const diagnostic = await runtimeErrorStoreDiagnostic({ workerPath: worker, timeoutMs: 50 });
    // Windowsはtimeout後のchild強制終了とhandle回収にself-hosted高負荷時400ms超を要する。
    // 50ms deadline自体はworker副作用で検証し、呼出し全体はOS別の有界上限で固定する。
    const diagnosticBoundMs = process.platform === "win32" ? 1000 : 250;
    assert.ok(Date.now() - diagnosticStarted < diagnosticBoundMs);
    assert.deepEqual(diagnostic, {
      status: "unverified", collection: "malformed", record_count: null, unacknowledged_count: null,
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Windows既定worker期限は2秒超の正常なDACL境界を失敗扱いにしない", {
  skip: process.platform !== "win32" ? "Windows private DACL境界専用" : undefined,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-runtime-windows-deadline-"));
  try {
    const worker = path.join(root, "slow-success.mjs");
    fs.writeFileSync(worker, `
const [action] = process.argv.slice(2);
setTimeout(() => {
  if (action === "diagnostic") process.stdout.write(JSON.stringify({status:"ready",collection:"enabled",record_count:0,unacknowledged_count:0}) + "\\n");
}, 2250);
`, { mode: 0o600 });
    const stderr = [];
    assert.equal(recordRuntimeError("AITERM.PTY_DEPENDENCY_UNAVAILABLE", {
      workerPath: worker, stderr: (line) => stderr.push(line),
    }), true);
    const diagnostic = await runtimeErrorStoreDiagnostic({ workerPath: worker });
    assert.deepEqual(diagnostic, {
      status: "ready", collection: "enabled", record_count: 0, unacknowledged_count: 0,
    });
    assert.deepEqual(stderr, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("canonical config が実FIFOでも telemetry child 隔離により main process はblockしない", {
  skip: process.platform === "win32" ? "mkfifo はPOSIX専用（Windows timeout境界はhanging worker testで固定）" : undefined,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-runtime-fifo-"));
  const configHome = path.join(root, "config");
  const fifo = path.join(configHome, "dotagents", "factory-reporter.json");
  fs.mkdirSync(path.dirname(fifo), { recursive: true });
  assert.equal(spawnSync("mkfifo", [fifo]).status, 0);
  fs.chmodSync(fifo, 0o600);
  const saved = process.env.XDG_CONFIG_HOME;
  const stderr = [];
  try {
    process.env.XDG_CONFIG_HOME = configHome;
    const started = Date.now();
    recordRuntimeError("AITERM.PTY_DEPENDENCY_UNAVAILABLE", {
      timeoutMs: 200, stderr: (line) => stderr.push(line),
    });
    assert.ok(Date.now() - started < 200);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(stderr, [], "FIFOはcanonical configでないためfail-closedし、store failureとは扱わない");
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolve/reopen と monotonic cursor acknowledgement を固定する", () => {
  const f = fixture();
  try {
    f.store.record({ code: "AITERM.PERSISTENCE_WRITE_FAILED" });
    const fp = f.store.snapshot().records[0].fingerprint;
    f.tick();
    assert.equal(f.store.resolve(fp), true);
    assert.equal(f.store.snapshot().records[0].status, "resolved");
    assert.equal(f.store.snapshot().records[0].reason_code, "operator_resolved");
    assert.match(f.store.snapshot().records[0].resolved_at, /Z$/);
    f.tick();
    assert.equal(f.store.reopen(fp), true);
    let snap = f.store.snapshot();
    assert.equal(snap.records[0].status, "open");
    assert.equal(snap.cursor, 3);
    assert.equal(f.store.acknowledge(2).acknowledged_cursor, 2);
    assert.throws(() => f.store.acknowledge(1), /monotonic/);
    assert.throws(() => f.store.acknowledge(4), /cursor/);
    assert.equal(f.store.acknowledge(3).acknowledged_cursor, 3);
  } finally { f.cleanup(); }
});

test("retention は acknowledged resolved record だけ compact し、unacked は捨てない", () => {
  const f = fixture();
  try {
    const store = new RuntimeErrorStore({
      configPath: f.configPath,
      storePath: f.storePath,
      platform: f.platform,
      arch: "arm64",
      productVersion: "test",
      maxRecords: 2,
    });
    store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" });
    const first = store.snapshot().records[0].fingerprint;
    store.resolve(first);
    store.acknowledge(2);
    store.record({ code: "AITERM.PERSISTENCE_WRITE_FAILED" });
    store.record({ code: "AITERM.VENDOR_LAUNCHER_FAILED" });
    assert.equal(store.snapshot().records.some((r) => r.fingerprint === first), false);

    const f2 = fixture();
    try {
      const bounded = new RuntimeErrorStore({
        configPath: f2.configPath, storePath: f2.storePath, platform: f2.platform, arch: process.arch,
        productVersion: "test", maxRecords: 2,
      });
      bounded.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" });
      bounded.record({ code: "AITERM.PERSISTENCE_WRITE_FAILED" });
      assert.throws(() => bounded.record({ code: "AITERM.VENDOR_LAUNCHER_FAILED" }), /unacknowledged|capacity/);
      assert.equal(bounded.snapshot().records.length, 2);
    } finally { f2.cleanup(); }
  } finally { f.cleanup(); }
});

test("store は owner-private + atomic replacement、store failure wrapper は固定 stderr", () => {
  const f = fixture();
  try {
    f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" });
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(path.dirname(f.storePath)).mode & 0o777, 0o700);
      assert.equal(fs.statSync(f.storePath).mode & 0o777, 0o600);
    }
    assert.deepEqual(fs.readdirSync(path.dirname(f.storePath)).sort(), [
      path.basename(f.storePath), `${path.basename(f.storePath)}.lock-queue`,
    ].sort());

    fs.rmSync(f.storePath);
    fs.mkdirSync(f.storePath);
    assert.equal(f.store.tryRecord({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" }), false);
    assert.deepEqual(f.stderr, ["aiterm: runtime error store unavailable\n"]);
  } finally { f.cleanup(); }
});

test("Windows native の canonical config/state path と current SID only DACL command/readback を純粋層で固定する", () => {
  assert.deepEqual(defaultRuntimeErrorPaths({
    platform: "win32", home: "C:\\Users\\Kite", localAppData: "D:\\Local",
  }), {
    configPath: "D:\\Local\\dotagents\\factory-reporter\\config.json",
    storePath: "D:\\Local\\aiterm-mcp\\runtime-errors.json",
  });
  const command = windowsPrivateDaclCommand("D:\\Local\\aiterm-mcp", "directory");
  assert.match(command.command, /PowerShell[\\/]7[\\/]pwsh\.exe$/iu);
  assert.equal(command.env.AITERMMCP_ACL_PATH, "D:\\Local\\aiterm-mcp");
  assert.equal(command.env.AITERMMCP_ACL_KIND, "directory");
  assert.match(command.args.at(-1), /WindowsIdentity.*GetCurrent/);
  assert.match(command.args.at(-1), /SetAccessRuleProtection\(\$true,\$false\)/);
  assert.match(command.args.at(-1), /rules\.Count -ne 1/);
  assert.match(command.args.at(-1), /IdentityReference\.Value -ne \$sid\.Value/);
  assert.match(command.args.at(-1), /GetOwner\(\[Security\.Principal\.SecurityIdentifier\]\)/);
  assert.match(command.args.at(-1), /FileSystemRights.*FullControl/);
  const verify = windowsPrivateDaclVerifyCommand("D:\\Local\\dotagents\\factory-reporter\\config.json", "file");
  assert.equal(verify.command, command.command); assert.match(verify.args.at(-1), /FileSystemAclExtensions.*GetAccessControl/); assert.doesNotMatch(verify.args.at(-1), /SetAccessControl/);
});

test("aiterm-runtime-errors CLI は snapshot/ack を JSON で公開し network を使わない", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-runtime-cli-"));
  try {
    const configHome = path.join(root, "config");
    const stateHome = path.join(root, "state");
    const defaults = defaultRuntimeErrorPaths({
      platform: process.platform, home: root, localAppData: root,
      xdgConfigHome: configHome, xdgStateHome: stateHome,
    });
    fs.mkdirSync(path.dirname(defaults.configPath), { recursive: true });
    fs.writeFileSync(defaults.configPath, JSON.stringify({
      schema_version: "1.0",
      host: { id: "test-host", profile: actualProfile() },
      collection: { enabled: true },
      reporting: { enabled: true, endpoint: "https://must-not-connect.invalid", credential_file: "/must/not/read" },
    }), { mode: 0o600 });
    applyWindowsPrivateAcl(defaults.configPath);
    const env = { ...process.env, HOME: root, USERPROFILE: root, LOCALAPPDATA: root, XDG_CONFIG_HOME: configHome, XDG_STATE_HOME: stateHome };
    const entry = path.join(HERE, "..", "dist", "runtime-errors-cli.js");
    let result = spawnSync(process.execPath, [entry, "snapshot"], { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    let body = JSON.parse(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.snapshot.collection, "enabled");
    assert.equal(body.snapshot.cursor, 0);
    result = spawnSync(process.execPath, [entry, "ack", "--cursor", "0"], { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    body = JSON.parse(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.snapshot.acknowledged_cursor, 0);
    if (process.platform !== "win32") {
      const npmBinLink = path.join(root, "aiterm-runtime-errors");
      fs.symlinkSync(entry, npmBinLink);
      result = spawnSync(process.execPath, [npmBinLink, "snapshot"], { env, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      body = JSON.parse(result.stdout);
      assert.equal(body.ok, true);
      assert.equal(body.command, "snapshot");
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function runOwnedFailure(invocation, extraEnv = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-runtime-owner-"));
  const configHome = path.join(root, "config");
  const stateHome = path.join(root, "state");
  const tmp = path.join(root, "tmp");
  fs.mkdirSync(path.join(configHome, "dotagents"), { recursive: true });
  fs.mkdirSync(tmp);
  fs.writeFileSync(path.join(configHome, "dotagents", "factory-reporter.json"), JSON.stringify({
    schema_version: "1.0",
    host: { id: "test-host", profile: actualProfile() },
    collection: { enabled: true },
    reporting: { enabled: false },
  }), { mode: 0o600 });
  const script = `
    const core = await import(${JSON.stringify(CORE_URL)});
    try { ${invocation}; } catch {}
    const { RuntimeErrorStore } = await import(${JSON.stringify(STORE_URL)});
    const store = new RuntimeErrorStore();
    let snapshot;
    for (let i=0;i<40;i++) {
      snapshot=store.snapshot();
      if (snapshot.records.length > 0) break;
      await new Promise((resolve)=>setTimeout(resolve,50));
    }
    console.log(JSON.stringify(snapshot));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: root,
      TMPDIR: tmp,
      XDG_CONFIG_HOME: configHome,
      XDG_STATE_HOME: stateHome,
      ...extraEnv,
    },
  });
  const snapshot = JSON.parse(result.stdout.trim().split("\n").at(-1));
  fs.rmSync(root, { recursive: true, force: true });
  return { result, snapshot };
}

test("PTY dependency failure は core owner layer で固定 code を一度だけ記録する", {
  skip: process.platform === "win32" ? "POSIX の fake tmux script fixture は Windows で実行不可（Windows は AITERM_PSMUX の native psmux）" : undefined,
}, () => {
  const { result, snapshot } = runOwnedFailure(
    'core.openSession("owner-pty", "bash")',
    { AITERM_TMUX: "/definitely/missing/tmux" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(snapshot.records.length, 1);
  assert.equal(snapshot.records[0].error_code, "AITERM.PTY_DEPENDENCY_UNAVAILABLE");
  assert.equal(snapshot.records[0].occurrence_count, 1);
});

test("vendor launcher failure は openAgent owner layer で固定 code を一度だけ記録する", {
  skip: process.platform === "win32" ? "/definitely/missing 形の POSIX パス fixture は Windows の bin 解決と噛み合わない（POSIX 3 環境で検証）" : undefined,
}, () => {
  const { result, snapshot } = runOwnedFailure(
    'core.openAgent("codex", {})',
    { CODEX_BIN: "/definitely/missing/codex" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(snapshot.records.length, 1);
  assert.equal(snapshot.records[0].error_code, "AITERM.VENDOR_LAUNCHER_FAILED");
  assert.equal(snapshot.records[0].occurrence_count, 1);
});

test("tmux mid-run ENOENT は typed telemetry-owned PTY failure 1件だけで上位vendorへ再計上しない", {
  skip: process.platform === "win32" ? "POSIX の fake tmux script fixture は Windows で実行不可（Windows は AITERM_PSMUX の native psmux）" : undefined,
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-vanish-tmux-"));
  try {
    const fakeTmux = path.join(root, "tmux");
    fs.writeFileSync(fakeTmux, "#!/bin/sh\ncase \" $* \" in *\" -V \"*) rm -f \"$0\"; exit 0;; *) exit 0;; esac\n", { mode: 0o700 });
    const { result, snapshot } = runOwnedFailure(
      'core.openAgent("codex", {})',
      { AITERM_TMUX: fakeTmux, CODEX_BIN: "/bin/echo" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(snapshot.records.length, 1);
    assert.equal(snapshot.records[0].error_code, "AITERM.PTY_DEPENDENCY_UNAVAILABLE");
    assert.equal(snapshot.records[0].occurrence_count, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("pipe-pane persistence failure は openSession owner layer で固定 code を一度だけ記録する", {
  skip: process.platform === "win32" ? "POSIX の fake tmux script fixture は Windows で実行不可（Windows は AITERM_PSMUX の native psmux）" : undefined,
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-fake-tmux-"));
  try {
    const fakeTmux = path.join(root, "tmux");
    fs.writeFileSync(fakeTmux, "#!/bin/sh\ncase \" $* \" in *\" -V \"*) echo 'tmux 3.6'; exit 0;; *\" pipe-pane \"*) rm -f \"$0\"; echo pipe-failed >&2; exit 1;; *\" list-sessions \"*|*\" has-session \"*) exit 1;; *) exit 0;; esac\n");
    fs.chmodSync(fakeTmux, 0o700);
    const { result, snapshot } = runOwnedFailure(
      'core.openSession("owner-persist", "bash")',
      { AITERM_TMUX: fakeTmux },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(snapshot.records.length, 1);
    assert.equal(snapshot.records[0].error_code, "AITERM.PERSISTENCE_WRITE_FAILED");
    assert.equal(snapshot.records[0].occurrence_count, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
