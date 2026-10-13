// runtime-error-storeの試験のうち、解決・再開・保持、保存の守り、CLI、記録する層。準備は runtime-error-store-support.mjs。
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  RUNTIME_ERROR_DEFINITIONS,
  RuntimeErrorStore,
  defaultRuntimeErrorPaths,
  recordRuntimeError,
  runtimeErrorStoreDiagnostic,
  validateRuntimeObservation,
  windowsPrivateDaclCommand,
  windowsPrivateDaclVerifyCommand,
} from "../dist/runtime-error-store.js";
import { expectedHostProfiles } from "../dist/runtime-error-os.js";
import { HERE, CORE_URL, STORE_URL, actualProfile, applyWindowsPrivateAcl, fixture } from "./runtime-error-store-support.mjs";

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
