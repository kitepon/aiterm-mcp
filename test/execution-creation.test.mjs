// Historical destructive close/admission fixtures use closeCascade explicitly.
// These are not acceptance evidence for the session-preserving stop control.
import './seat-env.mjs';
import test from 'node:test';
// These integration cases require the private POSIX file/directory checkpoint.
const posixCheckpoint = process.platform === 'win32' ? 'private native graph requires POSIX directory fsync' : false;
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileExecutionStore } from '../dist/execution-store.js';
import { ExecutionService } from '../dist/execution-service.js';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
import { createExecutionDispatcher } from '../dist/execution-dispatch.js';
import { agentMetadataPath, stateRoot } from '../dist/agent-shared.js';
import { SOCK } from '../dist/tmux-runtime.js';
import { createExecutionParticipant } from '../dist/execution-participant.js';
import { runDeferredBoundExecution } from '../dist/execution-tools.js';
import { withExecutionEffectScope, guardTmuxExecution, captureExecutionCreatedNative,
  bindExecutionCreatedLaunch, prepareExecutionCreation } from '../dist/execution-effect.js';
import { EXECUTION_ERROR_META_KEY as ERROR, EXECUTION_REQUEST_META_KEY as REQUEST } from '../dist/execution-wire.js';

// Nothing in this file can launch a native binary, CLI, seat or PTY. Actual
// core/runtime functions below see only the synthetic complete command decoder.
const originals = { spawnSync: childProcess.spawnSync, spawn: childProcess.spawn };
const originalKill = process.kill;
let runner;
childProcess.spawnSync = (...args) => { assert.ok(runner, 'no unowned process call'); return runner(...args); };
childProcess.spawn = () => assert.fail('no async native process is permitted');
syncBuiltinESMExports();
process.kill = (pid, signal) => { assert.equal(pid, 4711); assert.equal(signal, 0); return true; };
const core = await import('../dist/core.js');
test.after(() => { Object.assign(childProcess, originals); process.kill = originalKill; syncBuiltinESMExports(); });
test.afterEach(() => { runner = null; });
const A = { session_id: 'bot-source', launch_id: 'a'.repeat(32) };
const syntheticServer = { pid: 4711, started_identity: 'synthetic-native-server' };
const posix = { skip: process.platform === 'win32' ? 'POSIX native command fixture' : false };
let serial = 0;
function fixture(t, scenario = 'accepted') {
  const name = 'bot-created-' + (++serial), directory = mkdtempSync(join(tmpdir(), 'created-launch-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  process.env.CODEX_BIN = process.execPath; // exists, but is never executed
  process.env.AITERM_TMUX = 'tmux';
  let store = new FileExecutionStore(directory);
  const native = new Map([[A.session_id, { id: '$70', name: A.session_id }]]);
  if (scenario === 'no-server') native.clear();
  if (scenario === 'mixed-server') native.set('bot-other', { id: '$69', name: 'bot-other' });
  const effects = [], queries = [], errors = [];
  let source = { ...A }, creates = 0, requests = 0, service, serverStarted = 'Wed Oct 21 09:00:00 2026', probes = 0;
  const ok = stdout => ({ status: 0, stdout: stdout ?? '', stderr: '' });
  const command = args => {
    queries.push(args[0]);
    const target = args.includes('-t') ? args[args.indexOf('-t') + 1] : null;
    const find = raw => [...native.values()].find(value => raw?.replace(/:.*$/, '') === value.id || raw?.replace(/^=/, '').replace(/:.*$/, '') === value.name);
    if (args[0] === 'show-environment') return ok(scenario === 'environment-gap' && args.includes('-g') ? 'MISSING=synthetic\n' : '');
    if (args[0] === 'list-commands') return ok('paste-buffer [-dprS] [-b buffer-name] [-t target-pane]\n');
    if (args[0] === 'has-session') return { ...ok(''), status: find(target) ? 0 : 1 };
    if (args[0] === 'list-sessions') {
      const format = args[args.indexOf('-F') + 1];
      if (format === '#{pid}\t#{session_id}\t#{session_name}')
        return ok([...native.values()].map(value => (scenario === 'mixed-server' && value.name === 'bot-other' ? '4712' : '4711')
          + '\t' + value.id + '\t' + value.name).join('\n'));
      if (format === '#{session_id}\t#{session_name}') return ok([...native.values()].map(value => value.id + '\t' + value.name).join('\n'));
      if (format === '#{session_name}\t#{pane_current_command}\t#{session_attached}\t#{window_width}\t#{window_height}')
        return ok([...native.values()].map(value => value.name + '\tbash\t0\t80\t24').join('\n'));
      if (format === '#{session_name}') return ok([...native.values()].map(value => value.name).join('\n'));
      assert.fail('unexpected native session listing format');
    }
    if (args[0] === 'new-session') {
      assert.ok(args.includes('-P')); assert.equal(args[args.indexOf('-F') + 1], '#{session_id}\t#{session_name}\t#{pid}');
      creates++; const createdId = '$' + (70 + creates); native.set(name, { id: createdId, name }); effects.push('create');
      if (scenario === 'replaced') native.set(name, { id: '$72', name });
      if (scenario === 'server-restarted') serverStarted = 'Wed Oct 21 09:01:00 2026';
      return { ...ok(scenario === 'malformed' ? 'unrelated output' : createdId + '\t' + name + '\t' + (scenario === 'receipt-server-mismatch' ? '4712' : '4711') + '\n'),
        status: scenario === 'failed-after-create' ? 1 : 0 };
    }
    if (['set-option', 'pipe-pane', 'set-environment', 'paste-buffer', 'send-keys', 'kill-session'].includes(args[0])) {
      if (target) {
        assert.match(target, new RegExp('^\\$' + (70 + creates) + '(?::[\\d.]*)?$'), 'post-create effects must address only the receipt native ID');
        assert.ok(find(target), 'the captured physical session must still exist');
        effects.push(args[0]);
        if (args[0] === 'kill-session') native.delete(name);
        if (args[0] === 'pipe-pane' && scenario === 'source-stop')
          store.transactionSync(state => { state.stopping.push(A); });
      }
      return ok('');
    }
    if (['load-buffer', 'delete-buffer'].includes(args[0])) {
      effects.push(args[0]);
      if (args[0] === 'load-buffer' && scenario === 'managed-replaced') native.set(name, { id: '$72', name });
      return ok('');
    }
    assert.fail('unexpected synthetic native command: ' + args[0]);
  };
  runner = (bin, args) => {
    if (bin === 'launchctl') { assert.deepEqual(args, ['managername']); return ok('Aqua\n'); }
    if (bin === '/bin/ps') {
      assert.deepEqual(args, ['-o', 'pid=,lstart=', '-p', '4711']); probes++;
      if (scenario === 'owner-reused-before-create' && probes > 1) serverStarted = 'Wed Oct 21 09:01:00 2026';
      return ok(scenario === 'owner-missing' ? '' : '4711 ' + serverStarted + '\n');
    }
    assert.equal(bin, 'tmux', 'no real harness/process probe is allowed');
    if (args.length === 1 && args[0] === '-V') return ok('tmux 3.3a\n');
    if (args[0] === '-f') { assert.equal(args[1], '/dev/null'); args = args.slice(2); }
    assert.equal(args[0], '-S'); args = args.slice(2);
    let stdout = '';
    for (;;) {
      const end = args.indexOf(';'), part = end < 0 ? args : args.slice(0, end);
      const result = command(part); stdout += result.stdout;
      if (result.status !== 0 || end < 0) return { ...result, stdout };
      args = args.slice(end + 1);
    }
  };
  const observe = session => session === A.session_id ? { schema: 'aiterm.pty-observe-result.v1', session_id: session,
    exists: !!source, launch_id: source?.launch_id ?? null } : core.observeExecutionSessionGeneration(session);
  const runtime = createExecutionRuntime({ sourceEnvironment: { AITERM_SESSION_ID: A.session_id, AITERM_AGENT_LAUNCH_ID: A.launch_id },
    observeSession: observe, observeSessionSync: observe,
    ...(scenario === 'missing-reader' ? {} : { observeNativeSessionsSync: core.observeExecutionNativeCreationScope }),
    async observeDone() { assert.fail('no native completion fixture'); },
    async guardedClose(expected) {
      if (expected.session_id === A.session_id) source = null;
      else {
        assert.equal(expected.session_id, name);
        service.withExpectedCloseEffect(expected, () => core.closeExpectedAgentSession(expected));
      }
    } });
  service = new ExecutionService(store, runtime, 5);
  let dispatcher = createExecutionDispatcher({ service,
    sourceEnvironment: { AITERM_SESSION_ID: A.session_id, AITERM_AGENT_LAUNCH_ID: A.launch_id },
    nativeIdentity: { pid: 1234, started_identity: 'synthetic-serving-process' }, initializedClientName: () => 'codex',
    observeSessionGeneration: observe });
  if (scenario === 'participant') {
    const actor = { pid: process.pid, started_identity: '2026-10-21T12:00:00Z' };
    const scope = { state_root: stateRoot(), multiplexer: { kind: 'socket', key: SOCK } };
    const unsupported = () => assert.fail('no native parent fixture');
    const participant = createExecutionParticipant({ expectedScope: scope,
      profile: { id: 'synthetic-native-close', state_root: () => scope.state_root },
      provider: { withDeliveryEffect() {}, DELIVERY_ADMISSION_CONTRACT: { schema: 'steer.delivery-admission.v1', native_context: true,
        cursor_profile_parameter: true, serialized_required: true, multi_delivery_emit: true },
        submitClaudeParentAnswer: unsupported, submitCodexParentAnswer: unsupported, submitCursorParentAnswer: unsupported },
      runtime: { scope: () => structuredClone(scope), actor: () => ({ ...actor }),
        observeParentProcess: unsupported, decodeParent: () => null,
        sourceEnvironment: () => ({ AITERM_SESSION_ID: A.session_id, AITERM_AGENT_LAUNCH_ID: A.launch_id }),
        observeSessionGeneration: observe, observeNativeSessions: core.observeExecutionNativeCreationScope,
        closeExpectedSession: core.closeExpectedAgentSession, observeDone: unsupported },
      parentDependencies: { processes: () => [{ ...actor }], exists: () => true, now: () => 0, wall: () => 0,
        observe: unsupported, answer: unsupported, verify: unsupported }, claudeRuntime: { running: () => true } });
    service = participant.service; store = participant.store; dispatcher = participant.dispatcher;
    t.after(() => participant.server.close());
  }
  return { name, store, service, runtime, native, effects, queries, errors, creates: () => creates,
    restartServer: () => { serverStarted = 'Wed Oct 21 09:02:00 2026'; },
    async launch() {
      return dispatcher.dispatch('agent_launch', { session_name: name }, { requestId: 41 + requests++ }, async () => {
        let session;
        try { [session] = core.openAgent('codex', { session_name: name, agent_done: true }); }
        catch (error) { errors.push(String(error.stack)); throw error; }
        const seen = observe(session);
        return { content: [], structuredContent: { session_id: session, launch_id: seen.launch_id, initial_prompt: null } };
      });
    } };
}
test('composed participant connects actual creation metadata and core expected close through its own durable slot', { ...(posix), skip: posixCheckpoint || (posix).skip }, async t => {
  const f = fixture(t, 'participant'), receipt = await f.launch();
  assert.equal(receipt.isError, undefined);
  const expected = { session_id: f.name, launch_id: receipt.structuredContent.launch_id };
  const stopped = await f.service.closeCascade({ schema: 'aiterm.cascade-stop-request.v1', roots: [expected] });
  assert.equal(stopped.targets[0].outcome, 'closed'); assert.equal(stopped.status, 'partial');
  assert.equal(stopped.relation_coverage, 'incomplete'); assert.equal(f.native.has(f.name), false);
  assert.equal(f.effects.filter(value => value === 'kill-session').length, 1);
  const again = await f.service.closeCascade({ schema: 'aiterm.cascade-stop-request.v1', roots: [expected] });
  assert.equal(again.targets[0].outcome, 'already_closed');
  assert.equal(f.effects.filter(value => value === 'kill-session').length, 1);
});
test('only an exact new-session receipt binds native ownership, and every later target is rewritten to that ID', { skip: posixCheckpoint }, () => {
  const received = [], launch = { session_id: 'bot-new', launch_id: 'b'.repeat(32) };
  withExecutionEffectScope('bot-new', () => {}, () => {
    prepareExecutionCreation();
    guardTmuxExecution(['new-session', '-d', '-s', 'bot-new']);
    captureExecutionCreatedNative('$9\tbot-new\t4711\n');
    assert.deepEqual(guardTmuxExecution(['send-keys', '-t', 'bot-new:3.2', 'Enter']), ['send-keys', '-t', '$9:3.2', 'Enter']);
    assert.deepEqual(guardTmuxExecution(['has-session', '-t', '=bot-new:']), ['has-session', '-t', '$9:']);
    bindExecutionCreatedLaunch(launch);
  }, { prepare: () => syntheticServer, verifyServer() {}, native: (...args) => received.push(args), launch: value => received.push(value) });
  assert.deepEqual(received, [['bot-new', '$9', 4711], launch]);
});
test('malformed, other-seat and changed native receipts poison the frame instead of enabling another create', { skip: posixCheckpoint }, () => {
  for (const receipt of ['', '$9\tother\t4711\n', '$9\tbot-new\t4711\nextra\n', '$9\tbot-new\t4711\n$10\tbot-new\t4711\n']) {
    let captured = 0;
    assert.throws(() => withExecutionEffectScope('bot-new', () => {}, () => {
      prepareExecutionCreation();
      guardTmuxExecution(['new-session', '-d', '-s', 'bot-new']);
      try { captureExecutionCreatedNative(receipt); } catch { /* no swallowed success */ }
      assert.throws(() => guardTmuxExecution(['send-keys', '-t', 'bot-new', 'Enter']));
    }, { prepare: () => syntheticServer, verifyServer() {}, native: () => { captured++; }, launch() {} }));
    assert.equal(captured, 0);
  }
  for (const change of ['receipt', 'create']) {
    let captured = 0;
    assert.throws(() => withExecutionEffectScope('bot-new', () => {}, () => {
      prepareExecutionCreation();
      guardTmuxExecution(['new-session', '-d', '-s', 'bot-new']); captureExecutionCreatedNative('$9\tbot-new\t4711\n');
      if (change === 'receipt') captureExecutionCreatedNative('$10\tbot-new\t4711\n');
      else guardTmuxExecution(['new-session', '-d', '-s', 'bot-new']);
    }, { prepare: () => syntheticServer, verifyServer() {}, native: () => { captured++; }, launch() {} }));
    assert.equal(captured, 1, 'the original native receipt is never rebound or retried');
  }
});
test('actual core create, physical shell setup, internally generated launch and launcher input share one bound request', { ...(posix), skip: posixCheckpoint || (posix).skip }, async t => {
  const f = fixture(t), result = await f.launch();
  assert.equal(result.isError, undefined, JSON.stringify({ result, effects: f.effects, queries: f.queries, errors: f.errors }));
  assert.equal(f.creates(), 1); assert.ok(f.effects.includes('pipe-pane')); assert.ok(f.effects.includes('send-keys'));
  const state = await f.store.transaction(state => structuredClone(state), { readOnly: true });
  assert.equal(state.records[0].operations.launch, 'accepted'); assert.equal(state.records[0].relation.target.launch.session_id, f.name);
  assert.match(state.records[0].relation.target.launch.launch_id, /^[a-f0-9]{32}$/); assert.deepEqual(state.slots, []);
});
test('receipt loss, a missing native reader or physical replacement keeps the issued slot and never configures a replacement', { ...(posix), skip: posixCheckpoint || (posix).skip }, async t => {
  for (const scenario of ['malformed', 'replaced', 'failed-after-create', 'server-restarted', 'receipt-server-mismatch']) {
    const f = fixture(t, scenario), result = await f.launch();
    assert.equal(result.isError, true); assert.equal(result._meta[ERROR].effect, 'possible');
    assert.equal(f.creates(), 1); assert.deepEqual(f.effects, ['create']);
    const state = await f.store.transaction(state => structuredClone(state), { readOnly: true });
    assert.equal(state.slots[0].state, 'unknown'); assert.equal(state.records[0].operations.launch, 'unknown');
    if (!['malformed', 'receipt-server-mismatch'].includes(scenario)) assert.equal(state.slots[0].created_native_id, '$71');
    assert.ok(f.native.has(f.name), 'no name-based cleanup kills a same-name session');
  }
});
test('missing native server ownership is rejected before any create or persistent issued slot', { ...(posix), skip: posixCheckpoint || (posix).skip }, async t => {
  for (const scenario of ['missing-reader', 'owner-missing', 'owner-reused-before-create', 'no-server', 'mixed-server']) {
    const f = fixture(t, scenario), result = await f.launch();
    assert.equal(result.isError, true); assert.equal(result._meta[ERROR].effect, 'not_started');
    assert.equal(f.creates(), 0); assert.deepEqual(f.effects, []);
    const state = await f.store.transaction(state => structuredClone(state), { readOnly: true });
    assert.deepEqual(state.slots, []); assert.ok(state.records.length <= 1);
    assert.ok(state.records.every(record => record.operations.launch === 'not_sent'));
  }
});
test('native creation provenance survives RPC completion and a reconstructed service uses the actual guarded close primitive', { ...(posix), skip: posixCheckpoint || (posix).skip }, async t => {
  const f = fixture(t), accepted = await f.launch(); assert.equal(accepted.isError, undefined);
  const launch = { session_id: f.name, launch_id: accepted.structuredContent.launch_id };
  const file = agentMetadataPath(f.name, launch.launch_id), saved = JSON.parse(readFileSync(file));
  assert.deepEqual(saved.execution_native, { schema: 'aiterm.execution-native.v1', native_id: '$71',
    server: { pid: 4711, started_identity: 'Wed Oct 21 09:00:00 2026' } });
  const reconstructed = new ExecutionService(f.store, f.runtime, 5);
  const result = await reconstructed.closeCascade({ schema: 'aiterm.cascade-stop-request.v1', roots: [launch] });
  assert.equal(result.status, 'partial', 'native closure does not manufacture complete relation coverage');
  assert.equal(result.targets[0].outcome, 'closed'); assert.equal(f.effects.filter(value => value === 'kill-session').length, 1);
  assert.equal(f.native.has(f.name), false); assert.equal(f.native.has(A.session_id), true);
});
test('old metadata cannot prove a same-name replacement, restarted server, missing stamp or malformed native stamp', { ...(posix), skip: posixCheckpoint || (posix).skip }, async t => {
  for (const change of ['native-id', 'server', 'missing', 'malformed']) {
    const f = fixture(t), accepted = await f.launch(); assert.equal(accepted.isError, undefined);
    const launch = { session_id: f.name, launch_id: accepted.structuredContent.launch_id };
    const file = agentMetadataPath(f.name, launch.launch_id), saved = JSON.parse(readFileSync(file));
    if (change === 'native-id') f.native.set(f.name, { id: '$72', name: f.name });
    if (change === 'server') f.restartServer();
    if (change === 'missing') { delete saved.execution_native; writeFileSync(file, JSON.stringify(saved)); }
    if (change === 'malformed') { saved.execution_native.server.started_identity = ''; writeFileSync(file, JSON.stringify(saved)); }
    const beforeRead = readFileSync(file);
    assert.deepEqual(core.observeExecutionSessionGeneration(f.name), { schema: 'aiterm.pty-observe-result.v1',
      session_id: f.name, exists: true, launch_id: null });
    const stopped = await f.service.closeCascade({ schema: 'aiterm.cascade-stop-request.v1', roots: [launch] });
    assert.equal(stopped.targets[0].outcome, 'unknown');
    assert.equal(f.effects.includes('kill-session'), false); assert.ok(f.native.has(f.name));
    assert.deepEqual(readFileSync(file), beforeRead, 'observation does not enroll or repair stale metadata');
  }
});
test('a stopped generation stays retired when actual core creates new work under the same name and a different native ID', { ...(posix), skip: posixCheckpoint || (posix).skip }, async t => {
  const f = fixture(t), first = await f.launch(); assert.equal(first.isError, undefined);
  const old = { session_id: f.name, launch_id: first.structuredContent.launch_id };
  assert.equal((await f.service.closeCascade({ schema: 'aiterm.cascade-stop-request.v1', roots: [old] })).targets[0].outcome, 'closed');
  const second = await f.launch(); assert.equal(second.isError, undefined, JSON.stringify({ result: second, errors: f.errors }));
  const replacement = { session_id: f.name, launch_id: second.structuredContent.launch_id };
  assert.notEqual(replacement.launch_id, old.launch_id); assert.equal(f.native.get(f.name).id, '$72'); assert.equal(f.creates(), 2);
  const staleStop = await f.service.closeCascade({ schema: 'aiterm.cascade-stop-request.v1', roots: [old] });
  assert.equal(staleStop.targets[0].outcome, 'replaced'); assert.ok(f.native.has(f.name));
  assert.equal(f.effects.filter(value => value === 'kill-session').length, 1);
  const state = await f.store.transaction(state => structuredClone(state), { readOnly: true });
  assert.equal(state.records[0].relation.lifecycle, 'retired');
  assert.equal(state.records[1].relation.lifecycle, 'tracking'); assert.deepEqual(state.records[1].relation.target.launch, replacement);
});
test('guarded environment verification failure closes only the captured native ID without replaying new-session', { ...(posix), skip: posixCheckpoint || (posix).skip }, async t => {
  const f = fixture(t, 'environment-gap'), result = await f.launch();
  assert.equal(result.isError, true); assert.equal(result._meta[ERROR].effect, 'possible'); assert.equal(f.creates(), 1);
  assert.deepEqual(f.effects, ['create', 'set-option', 'kill-session']); assert.equal(f.native.has(f.name), false);
  const state = await f.store.transaction(state => structuredClone(state), { readOnly: true });
  assert.equal(state.slots[0].created_native_id, '$71'); assert.equal(state.records[0].operations.launch, 'unknown');
});
test('replacement after managed metadata binding cannot receive launcher input or name-based cleanup', { ...(posix), skip: posixCheckpoint || (posix).skip }, async t => {
  const f = fixture(t, 'managed-replaced'), result = await f.launch();
  assert.equal(result.isError, true); assert.equal(result._meta[ERROR].effect, 'possible');
  assert.equal(f.creates(), 1); assert.deepEqual(f.effects, ['create', 'set-option', 'pipe-pane', 'load-buffer']);
  const state = await f.store.transaction(state => structuredClone(state), { readOnly: true });
  assert.equal(state.slots[0].created_native_id, '$71'); assert.equal(state.slots[0].state, 'unknown');
  assert.match(state.slots[0].expected_launch_id, /^[a-f0-9]{32}$/);
  assert.equal(state.records[0].relation.target.launch.launch_id, state.slots[0].expected_launch_id);
  assert.equal(f.native.get(f.name).id, '$72');
});
test('a source stop between shell setup and metadata publication suppresses the launcher command', { ...(posix), skip: posixCheckpoint || (posix).skip }, async t => {
  const f = fixture(t, 'source-stop'), result = await f.launch();
  assert.equal(result.isError, true); assert.equal(result._meta[ERROR].effect, 'possible');
  assert.equal(f.creates(), 1); assert.deepEqual(f.effects, ['create', 'set-option', 'pipe-pane']);
  const state = await f.store.transaction(state => structuredClone(state), { readOnly: true });
  assert.equal(state.slots[0].created_native_id, '$71'); assert.equal(state.records[0].operations.launch, 'unknown');
  assert.equal(state.records[0].relation.target, null);
});
test('late genuine launch binding survives a source fence, records the reached launch and refuses further input', { skip: posixCheckpoint }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'late-creation-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new FileExecutionStore(directory), B = { session_id: 'bot-late', launch_id: 'b'.repeat(32) };
  let physical = false, generation = null, commands = 0;
  const observe = session => session === A.session_id ? { state: 'present', launch: A }
    : physical ? { state: 'present', launch: generation } : { state: 'absent' };
  const service = new ExecutionService(store, { observe: async session => observe(session), observeSync: observe,
    nativeSessionSync: () => ({ ...(physical ? { state: 'present', native_id: '$81' } : { state: 'absent' }),
      server: { pid: 4711, started_identity: 'synthetic-native-server' } }),
    sourceEvidence: async () => ({ runtime_launch: A, caller_bound: true, invocation_boundary: null }),
    completion: async () => ({ state: 'unknown', fence: 'unknown' }), close: async () => assert.fail('no close fixture'),
    coverage: async () => 'incomplete' });
  const request = { kind: 'delivery', delivery_id: 'existing-late-create', target_session_id: B.session_id };
  await service.execute({ action: 'register', source_session_id: A.session_id,
    reservation: { schema: 'aiterm.execution-reservation.v1', request, source: { launch: A, boundary: null },
      target: { session_id: B.session_id, expected_launch_id: null } } });
  const result = await runDeferredBoundExecution(service, { [REQUEST]: { schema: 'aiterm.execution-ref.v1', request } },
    'launch', B.session_id, async () => {
      prepareExecutionCreation();
      guardTmuxExecution(['new-session', '-s', B.session_id]); commands++; physical = true;
      captureExecutionCreatedNative('$81\t' + B.session_id + '\t4711\n');
      await store.transaction(state => { state.stopping.push(A); });
      generation = B; bindExecutionCreatedLaunch(B);
      const bound = await store.transaction(state => structuredClone(state), { readOnly: true });
      assert.deepEqual(bound.records[0].relation.target, { launch: B, boundary: null });
      assert.ok(bound.stopping.some(value => value.launch_id === B.launch_id));
      guardTmuxExecution(['send-keys', '-t', B.session_id, 'Enter']); commands++;
      return { result: { content: [] }, target: { launch: B, boundary: null } };
    });
  assert.equal(commands, 1); assert.equal(result.isError, true); assert.equal(result._meta[ERROR].effect, 'possible');
  const state = await store.transaction(state => structuredClone(state), { readOnly: true });
  assert.equal(state.records[0].operations.launch, 'unknown'); assert.equal(state.slots[0].created_native_id, '$81');
  const reconstructed = new ExecutionService(new FileExecutionStore(directory), {});
  const recovered = await reconstructed.execute({ action: 'status', request });
  assert.deepEqual(recovered.relation.target.launch, B); assert.equal(recovered.stopping, true);
});
