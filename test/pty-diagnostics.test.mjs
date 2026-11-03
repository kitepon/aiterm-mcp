import "./seat-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readOnlyPtyListDiagnostic } from "../dist/core.js";
import { SOCK, isWin, PtyDiagnosticError, PTY_DIAGNOSTIC_TIMEOUT_MS } from "../dist/tmux-runtime.js";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAitermServer } from "../dist/index.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { pathToFileURL } from "node:url";

test("cold same-socket ENOENT is not_applicable", { skip: isWin }, () => {
  const value = readOnlyPtyListDiagnostic(() => ({ code: 1, stdout: "", stderr: `error connecting to ${SOCK} (No such file or directory)` }));
  assert.deepEqual(value, { status: "not_applicable", session_count: null });
});

test("only exact same-socket absence with exit1/empty stdout is absent", () => {
  const absent = { code: 1, stdout: "", stderr: `no server running on ${SOCK}\n` };
  assert.deepEqual(readOnlyPtyListDiagnostic(() => absent, true), {
    status: "not_applicable", session_count: null, reason_code: "socket_absent",
  });
  for (const response of [
    { ...absent, code: 2 }, { ...absent, stdout: "conflicting" },
    { ...absent, stderr: "no server running on /other/socket" },
    { ...absent, stderr: `${absent.stderr}additional diagnostic` },
    { ...absent, stderr: `error connecting to ${SOCK} (Connection refused)` },
    { ...absent, stderr: "failed to connect: unknown" },
    { code: 0, stdout: "one\n", stderr: "unexpected stderr" },
  ]) assert.deepEqual(readOnlyPtyListDiagnostic(() => response, true), {
    status: "unverified", session_count: null, reason_code: "native_failure",
  });
  for (const stdout of ["", "one\ntwo\n"]) {
    const result = readOnlyPtyListDiagnostic(() => ({ code: 0, stdout, stderr: "" }), true);
    assert.equal(result.reason_code, "listed"); assert.equal(result.session_count, stdout ? 2 : 0);
  }
});

test("safe reason codes distinguish permissions and dependency/timeout exceptions without text", () => {
  const permission = readOnlyPtyListDiagnostic(() => ({ code: 1, stdout: "", stderr: `error connecting to ${SOCK} (Permission denied)` }), true);
  assert.deepEqual(permission, { status: "unverified", session_count: null, reason_code: "permission_denied" });
  for (const reason_code of ["dependency_unavailable", "permission_denied", "timeout", "output_limit", "signal", "native_failure"]) {
    assert.deepEqual(readOnlyPtyListDiagnostic(() => { throw new PtyDiagnosticError(reason_code); }, true), {
      status: "unverified", session_count: null, reason_code,
    });
  }
  const value = readOnlyPtyListDiagnostic(() => { throw new Error('/secret/path raw stderr and private text'); }, true);
  assert.deepEqual(value, { status: "unverified", session_count: null, reason_code: "native_failure" });
  assert.doesNotMatch(JSON.stringify(value), /secret|private|stderr/);
});

async function fakeNative(label, response, body) {
  const runtime = await import(`../dist/tmux-runtime.js?diagnostic=${label}`);
  const saved = childProcess.spawnSync, oldTmux = process.env.AITERM_TMUX, oldPsmux = process.env.AITERM_PSMUX;
  process.env.AITERM_TMUX = 'fake-diagnostic-backend'; process.env.AITERM_PSMUX = 'fake-diagnostic-backend';
  const calls = [];
  childProcess.spawnSync = (bin, args, options) => {
    calls.push({ bin, args, options });
    return response(bin, args, options);
  };
  syncBuiltinESMExports();
  try { await body(runtime, calls); }
  finally {
    childProcess.spawnSync = saved; syncBuiltinESMExports();
    if (oldTmux === undefined) delete process.env.AITERM_TMUX; else process.env.AITERM_TMUX = oldTmux;
    if (oldPsmux === undefined) delete process.env.AITERM_PSMUX; else process.env.AITERM_PSMUX = oldPsmux;
  }
}
const success = (stdout = '') => ({ status: 0, stdout, stderr: '', signal: null });
const version = () => success(isWin ? 'psmux 3.3.9' : 'tmux 3.4');

test("resolution and one listing share the same deadline; ordinary native remains unchanged", async () => {
  const oldNow = Object.getOwnPropertyDescriptor(performance, 'now'); let now = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  try {
    await fakeNative('budget', (_bin, args) => {
      if (args[0] === '-V') { now = 1700; return version(); }
      assert.deepEqual(args.slice(2), ['list-sessions', '-F', '#{session_name}']);
      return success('one\n');
    }, (runtime, calls) => {
      assert.equal(runtime.readOnlyTmuxList().stdout, 'one\n'); assert.equal(calls.length, 2);
      assert.equal(calls[0].options.timeout, PTY_DIAGNOSTIC_TIMEOUT_MS);
      assert.equal(calls[1].options.timeout, 3300);
      for (const {options} of calls) {
        assert.equal(options.killSignal, 'SIGKILL'); assert.equal(options.maxBuffer, 1024 * 1024);
      }
      runtime.tmuxCommand(false, 'list-sessions', '-F', '#{session_name}');
      assert.equal(calls.at(-1).options.timeout, undefined);
      assert.equal(calls.at(-1).options.maxBuffer, 64 * 1024 * 1024);
    });
    now = 0;
    await fakeNative('expired', () => { now = PTY_DIAGNOSTIC_TIMEOUT_MS + 1; return version(); }, (runtime, calls) => {
      assert.throws(() => runtime.readOnlyTmuxList(), { reasonCode: 'timeout' });
      assert.equal(calls.length, 1, 'no listing after budget expired');
    });
  } finally {
    if (oldNow) Object.defineProperty(performance, 'now', oldNow); else delete performance.now;
  }
});

test("spawn failure codes remain safe at both dependency and list boundaries", async () => {
  for (const [code, reasonCode] of [['ENOENT', 'dependency_unavailable'], ['EACCES', 'permission_denied'],
    ['EPERM', 'permission_denied'], ['ETIMEDOUT', 'timeout'], ['ENOBUFS', 'output_limit'], ['EIO', 'native_failure']]) {
    for (const boundary of ['version', 'list']) {
      await fakeNative(code + boundary, (_bin, args) => args[0] === '-V' && boundary === 'list' ? version() : {
        error: Object.assign(new Error('/secret raw error'), { code }), status: null, signal: 'SIGTERM', stdout: '', stderr: '/secret raw stderr',
      }, (runtime, calls) => {
        assert.throws(() => runtime.readOnlyTmuxList(), { reasonCode });
        assert.equal(calls.length, boundary === 'version' ? 1 : 2);
      });
    }
  }
  await fakeNative('signal', (_bin, args) => args[0] === '-V' ? version() : {
    status: null, stdout: '', stderr: '', signal: 'SIGTERM',
  }, runtime => assert.throws(() => runtime.readOnlyTmuxList(), { reasonCode: 'signal' }));
});

test("same diagnostics RPC preserves v1 and opts into v2 safe reason/budget", async () => {
  const server = createAitermServer(), client = new Client({ name: 'diagnostic-fixture', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  const saved = childProcess.spawnSync;
  childProcess.spawnSync = (_bin, args) => {
    if (args[0] === '-V') return version();
    if (args.includes('list-sessions')) return { status: 1, stdout: '', stderr: `error connecting to ${SOCK} (Permission denied)`, signal: null };
    return { status: 1, stdout: '', stderr: '', signal: null };
  };
  syncBuiltinESMExports();
  try {
    const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/factory-diagnostics-schema.json', import.meta.url), 'utf8'));
    const tool = (await client.listTools()).tools.find(t => t.name === 'diagnostics');
    assert.deepEqual(tool.inputSchema.properties.format.enum, ['v1', 'v2']);
    for (const args of [{}, {format: 'v1'}, {format: 'v2'}]) {
      const result = await client.callTool({ name: 'diagnostics', arguments: args });
      assert.equal(result.isError, undefined); assert.equal(result.content.length, 2);
      const diagnostic = JSON.parse(result.content[0].text);
      assert.equal(diagnostic.diagnostic_schema, `aiterm-mcp.factory-diagnostics.${args.format ?? 'v1'}`);
      assert.equal(diagnostic.overall, 'unverified');
      assert.deepEqual(Object.keys(diagnostic), fixture.top_level_fields);
      assert.deepEqual(Object.keys(diagnostic.pty_list), args.format === 'v2' ? fixture.v2.pty_list_fields : fixture.pty_list_fields);
      assert.deepEqual(diagnostic.pty_list, { access: 'read_only', status: 'unverified', session_count: null,
        ...(args.format === 'v2' ? { reason_code: 'permission_denied', timeout_ms: 5000 } : {}) });
      assert.equal(JSON.parse(result.content[1].text).diagnostic_schema, 'aiterm-mcp.parent-delivery-diagnostics.v1');
      assert.doesNotMatch(JSON.stringify(diagnostic), /Permission denied|claude.sock|error connecting/);
    }
  } finally {
    childProcess.spawnSync = saved; syncBuiltinESMExports(); await client.close(); await server.close();
  }
});

test("hung fake backend is killed within the shared real subprocess budget", { skip: isWin }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pty-diagnostic-timeout-'));
  try {
    const backend = path.join(root, 'backend'), pidFile = path.join(root, 'pid');
    fs.writeFileSync(backend, `#!${process.execPath}\nif(process.argv.includes('-V')){console.log('tmux 3.4')}else{require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)}\n`, { mode: 0o700 });
    const url = pathToFileURL(path.resolve('dist/tmux-runtime.js')).href;
    const script = `import{readOnlyTmuxList}from${JSON.stringify(url)};const t=performance.now();try{readOnlyTmuxList();process.exitCode=1}catch(e){console.log(JSON.stringify({reason:e.reasonCode,elapsed:performance.now()-t}))}`;
    const child = childProcess.spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, AITERM_TMUX: backend }, encoding: 'utf8', timeout: 8000,
    });
    assert.equal(child.status, 0, child.stderr);
    const value = JSON.parse(child.stdout);
    assert.equal(value.reason, 'timeout'); assert.ok(value.elapsed >= 4500 && value.elapsed < 7000, child.stdout);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("broad failed-to-connect permission never proves absence", () => {
  const value = readOnlyPtyListDiagnostic(() => ({ code: 1, stdout: "", stderr: `failed to connect to ${SOCK}: Permission denied` }));
  assert.deepEqual(value, { status: "unverified", session_count: null });
});
