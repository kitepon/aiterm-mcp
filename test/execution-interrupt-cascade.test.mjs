// Private controller only. All native run/key/preservation/fence/coverage
// evidence is synthetic; no CLI, process, public tool or default runtime.
import './seat-env.mjs';
import test from 'node:test';
// These integration cases require the private POSIX file/directory checkpoint.
const posixCheckpoint = process.platform === 'win32' ? 'private native graph requires POSIX directory fsync' : false;
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExecutionService } from '../dist/execution-service.js';
import { FileExecutionStore } from '../dist/execution-store.js';
import { guardTmuxExecution } from '../dist/execution-effect.js';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
import { createExecutionToolHandlers } from '../dist/execution-tools.js';
const launch = name => ({ session_id: 'bot-' + name, launch_id: name.repeat(32) });
const A = launch('a'), B = launch('b'), C = launch('c'), D = launch('d');
const point = launch => ({ launch, boundary: { event_cursor: 17, turn_id: 'native-' + launch.session_id,
  operation_id: null, steer_id: null } });
const input = roots => ({ schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const until = async check => { const deadline = performance.now() + 1000; while (!await check()) {
  assert.ok(performance.now() < deadline, 'fixture synchronization'); await new Promise(done => setTimeout(done, 2));
} };
function fixture(t, timeout = 100) {
  const directory = mkdtempSync(join(tmpdir(), 'interrupt-cascade-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new FileExecutionStore(directory), live = new Map(), observations = new Map(), keys = [];
  let required = [], proof = true, onProof = () => {};
  const add = launch => {
    const index = [A, B, C, D].findIndex(value => value.session_id === launch.session_id) + 1;
    live.set(launch.session_id, launch);
    observations.set(launch.session_id, { schema: 'aiterm.native-interruption-observation.v1', run: point(launch),
      native: { schema: 'aiterm.execution-native.v1', native_id: '$' + index,
        server: { pid: 4711, started_identity: '2026-10-21T07:00:00Z' } }, harness: 'codex-cli',
      harness_process: { pid: 200 + index, started_identity: '2026-10-21T07:00:01Z' },
      endpoint: { session_id: 'native-conversation-' + index, record_file: { device: 1, inode: index } },
      recorded_state: 'running', native_boundary: { type: 'task_started', turn_id: point(launch).boundary.turn_id, reason: null },
      invocation_fence: 'unknown', session_preserved: 'unconfirmed' });
  };
  for (const launch of [A, B, C, D]) add(launch);
  const runtime = {
    observeSync(session) { return live.has(session) ? { state: 'present', launch: live.get(session) } : { state: 'absent' }; },
    async observe(session) { return this.observeSync(session); },
    async sourceEvidence(args) { return { runtime_launch: args.reservation.source.launch, caller_bound: true, invocation_boundary: args.reservation.source.boundary }; },
    async completion() { return { state: 'unknown', fence: 'unknown' }; },
    async close() { assert.fail('never close'); }, async coverage() { return 'complete'; },
    selectInterruptionSync(launch) { return structuredClone(observations.get(launch.session_id)); },
    interruptionSync(run) { const value = observations.get(run.launch.session_id);
      if (value?.recorded_state === 'interrupted') onProof(run); return structuredClone(value); },
    interruptKeySync(run) {
      store.transactionSync(state => { for (const launch of required) assert.ok(state.interruptions.some(row => row.before.run.launch.session_id === launch.session_id), 'admit every reached run before key'); }, { readOnly: true });
      const observation = observations.get(run.launch.session_id);
      guardTmuxExecution(['send-keys', '-t', observation.native.native_id, 'Escape']); keys.push(run.launch.session_id);
      if (proof) Object.assign(observation, { recorded_state: 'interrupted',
        native_boundary: { type: 'turn_aborted', turn_id: run.boundary.turn_id, reason: 'interrupted' },
        invocation_fence: 'closed', session_preserved: 'confirmed' });
      return { schema: 'aiterm.pty-key-result.v1', session_id: run.launch.session_id, key: 'Escape', outcome: 'accepted',
        interruption: 'unconfirmed', session_preserved: 'unconfirmed' };
    },
  };
  const service = new ExecutionService(store, runtime, timeout);
  const register = (id, source, target, expected = target.launch_id) => service.execute({ action: 'register', source_session_id: source.session_id,
    reservation: { schema: 'aiterm.execution-reservation.v1', request: { kind: 'delivery', delivery_id: id, target_session_id: target.session_id },
      source: { launch: source, boundary: point(source).boundary }, target: { session_id: target.session_id, expected_launch_id: expected } } });
  const edge = async (source, target, canonical = point(target)) => {
    const record = await register(source.session_id + '-to-' + target.session_id, source, target);
    await service.invoke({ schema: 'aiterm.execution-ref.v1', request: record.reservation.request }, 'send', async () => ({ value: 'genuine synthetic receipt', target: canonical }));
    return record.reservation.request;
  };
  const read = () => store.transaction(state => structuredClone(state), { readOnly: true });
  return { store, live, observations, keys, runtime, service, register, edge, read, add,
    requireAll(value) { required = value; }, noProof() { proof = false; }, onProof(value) { onProof = value; } };
}
test('controller admits A/B/C before Esc, follows only actual outward edges, and leaves independent D unmodified', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.edge(A, B); await f.edge(B, C); await f.edge(D, B); f.requireAll([A, B, C]);
  const result = await f.service.interruptCascade(input([A]));
  assert.equal(result.status, 'confirmed'); assert.deepEqual(f.keys, [A.session_id, B.session_id, C.session_id]);
  assert.ok(result.targets.every(target => target.interruption === 'interrupted' && target.session_preserved === 'confirmed'));
  assert.equal(f.observations.get(D.session_id).recorded_state, 'running'); assert.deepEqual((await f.read()).stopping, []);
});
test('cycles and duplicate explicit roots do not duplicate native keys', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.edge(A, B); await f.edge(B, A); f.requireAll([A, B]);
  const result = await f.service.interruptCascade(input([A, A]));
  assert.equal(result.status, 'confirmed'); assert.deepEqual(f.keys.sort(), [A.session_id, B.session_id]);
});
test('key acceptance alone holds interruption/session unconfirmed and never retries on another controller call', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); f.noProof();
  const result = await f.service.interruptCascade(input([A]));
  assert.equal(result.status, 'unconfirmed'); assert.equal(result.targets[0].key_receipt, 'accepted');
  assert.equal(result.targets[0].session_preserved, 'unconfirmed');
  await f.service.interruptCascade(input([A])); assert.deepEqual(f.keys, [A.session_id]);
});
test('private control injection without native capabilities stays read-only, and a wire argument cannot enable the host-only mode', { skip: posixCheckpoint }, async t => {
  const f = fixture(t), noSelector = new ExecutionService(f.store, { ...f.runtime, selectInterruptionSync: undefined });
  const result = await createExecutionToolHandlers(noSelector, { interruptCurrentRun: true }).agent_stop(input([A]));
  assert.equal(result.structuredContent.targets[0].interruption, 'unsupported');
  assert.deepEqual(f.keys, []); assert.deepEqual((await f.read()).interruptions, []);
  const attempted = await createExecutionToolHandlers(f.service).agent_stop({ ...input([A]), interruptCurrentRun: true });
  assert.equal(attempted.isError, true); assert.deepEqual(f.keys, []); assert.deepEqual((await f.read()).interruptions, []);
  assert.throws(() => createExecutionToolHandlers(f.service, { interruptCurrentRun: 'true' }), error => error.code === 'EXECUTION_UNSUPPORTED');
});
test('unsupported child admission holds parent release and does not close or guess a key for that child', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.edge(A, B); f.observations.delete(B.session_id);
  const result = await f.service.interruptCascade(input([A]));
  assert.equal(result.status, 'unconfirmed'); assert.deepEqual(f.keys, [A.session_id]);
  assert.equal(result.targets.find(target => target.launch.session_id === B.session_id).interruption, 'unsupported');
  assert.equal((await f.read()).interruptions[0].phase, 'accepted');
});
test('an unsupported branch holds its ancestors while an independent explicit root keeps its confirmed result', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.edge(A, B); f.observations.delete(B.session_id);
  const result = await f.service.interruptCascade(input([A, D]));
  assert.equal(result.status, 'partial'); assert.equal(result.relation_coverage, 'incomplete');
  assert.equal(result.targets.find(value => value.launch.session_id === A.session_id).interruption, 'unconfirmed');
  assert.equal(result.targets.find(value => value.launch.session_id === B.session_id).interruption, 'unsupported');
  assert.equal(result.targets.find(value => value.launch.session_id === D.session_id).interruption, 'interrupted');
  const state = await f.read();
  assert.equal(state.interruptions.find(row => row.before.run.launch.session_id === A.session_id).phase, 'accepted');
  assert.equal(state.interruptions.find(row => row.before.run.launch.session_id === D.session_id).phase, 'settled');
});
test('an absent root still reaches its recorded child but does not prove the old ancestor invocation fence', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.edge(A, B); f.live.delete(A.session_id); f.observations.delete(A.session_id);
  const result = await f.service.interruptCascade(input([A]));
  assert.equal(result.status, 'unconfirmed'); assert.deepEqual(f.keys, [B.session_id]);
  assert.equal(result.targets.find(value => value.launch.session_id === A.session_id).interruption, 'unsupported');
  assert.equal(result.targets.find(value => value.launch.session_id === B.session_id).interruption, 'unconfirmed');
  assert.equal((await f.read()).interruptions[0].phase, 'accepted');
  assert.deepEqual((await f.read()).stopping, []); assert.ok(f.live.has(B.session_id));
});
test('a missing native alias stays local to its branch instead of discarding an independent root proof', { skip: posixCheckpoint }, async t => {
  const f = fixture(t), canonical = point(B); canonical.boundary.turn_id = null;
  const request = await f.edge(A, B, canonical), result = await f.service.interruptCascade(input([A, D]));
  assert.equal(result.status, 'partial');
  assert.equal(result.targets.find(value => value.launch.session_id === D.session_id).interruption, 'interrupted');
  assert.ok(result.targets.filter(value => value.launch.session_id !== D.session_id).every(value => value.interruption === 'unconfirmed'));
  const record = (await f.read()).records.find(value => value.reservation.request.delivery_id === request.delivery_id);
  assert.equal(record.relation.completion, 'open'); assert.deepEqual(record.relation.target, canonical);
});
test('a missing target generation cannot be hidden by a local root abort proof', { skip: posixCheckpoint }, async t => {
  const f = fixture(t), record = await f.register('lost-target-binding', A, B);
  await f.store.transaction(state => {
    const value = state.records.find(value => value.reservation.request.delivery_id === record.reservation.request.delivery_id);
    value.relation.phase = 'submitted_unknown'; value.relation.completion = 'unknown'; value.relation.target = null;
    value.operations.send = 'unknown';
  });
  const result = await f.service.interruptCascade(input([A]));
  assert.equal(result.status, 'unconfirmed'); assert.deepEqual(f.keys, [A.session_id]);
  assert.ok(result.unresolved.some(value => value.reason === 'target_generation_missing'));
  assert.equal((await f.read()).interruptions[0].phase, 'accepted');
});
test('missing canonical native alias preserves the original turn-null receipt and never confirms/retires it', { skip: posixCheckpoint }, async t => {
  const f = fixture(t), canonical = point(B); canonical.boundary.turn_id = null;
  const request = await f.edge(A, B, canonical);
  const result = await f.service.interruptCascade(input([B]));
  assert.equal(result.status, 'unconfirmed'); assert.ok(result.unresolved.some(gap => gap.reason === 'native_canonical_alias_missing'));
  const record = (await f.read()).records.find(record => record.reservation.request.delivery_id === request.delivery_id);
  assert.deepEqual(record.relation.target, canonical); assert.equal(record.relation.completion, 'open'); assert.equal(record.relation.lifecycle, 'tracking');
});
test('an already native-bound canonical turn is re-observed at its original Point instead of replacing its dispatch cursor', { skip: posixCheckpoint }, async t => {
  const f = fixture(t), request = await f.edge(A, B), original = point(B);
  f.runtime.selectInterruptionSync = launch => ({ ...structuredClone(f.observations.get(launch.session_id)),
    run: { ...point(launch), boundary: { ...point(launch).boundary, event_cursor: 99 } } });
  const result = await f.service.interruptCascade(input([B]));
  assert.equal(result.status, 'confirmed'); assert.deepEqual(result.targets[0].run, original);
  assert.deepEqual(f.keys, [B.session_id]);
  const record = (await f.read()).records.find(value => value.reservation.request.delivery_id === request.delivery_id);
  assert.deepEqual(record.relation.target, original); assert.equal(record.relation.completion, 'interrupted');
});
test('native alias re-observation refuses a different conversation/harness/native identity before admission or a key', { skip: posixCheckpoint }, async t => {
  for (const change of ['conversation', 'harness', 'native']) {
    const f = fixture(t), request = await f.edge(A, B);
    f.runtime.selectInterruptionSync = launch => ({ ...structuredClone(f.observations.get(launch.session_id)),
      run: { ...point(launch), boundary: { ...point(launch).boundary, event_cursor: 99 } } });
    f.runtime.interruptionSync = run => {
      const proof = structuredClone(f.observations.get(run.launch.session_id));
      if (change === 'conversation') proof.endpoint.session_id = 'different-native-conversation';
      if (change === 'harness') proof.harness_process.started_identity = '2026-10-21T07:00:02Z';
      if (change === 'native') proof.native.native_id = '$999';
      return proof;
    };
    const result = await f.service.interruptCascade(input([B]));
    assert.equal(result.targets[0].interruption, 'unsupported'); assert.deepEqual(f.keys, []);
    const state = await f.read(); assert.deepEqual(state.interruptions, []);
    assert.equal(state.records.find(value => value.reservation.request.delivery_id === request.delivery_id).relation.completion, 'open');
  }
});
test('multiple canonical cursors for a native turn are not collapsed into one guessed receipt alias', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.edge(A, B);
  const other = point(B); other.boundary.event_cursor++;
  const request = await f.edge(D, B, other), result = await f.service.interruptCascade(input([B]));
  assert.equal(result.status, 'unconfirmed'); assert.ok(result.unresolved.some(value => value.reason === 'native_canonical_alias_missing'));
  assert.deepEqual(f.keys, [B.session_id]);
  const record = (await f.read()).records.find(value => value.reservation.request.delivery_id === request.delivery_id);
  assert.deepEqual(record.relation.target, other); assert.equal(record.relation.completion, 'open');
});
test('an old native turn, operation or steer ref is not enriched from the currently selected native run', { skip: posixCheckpoint }, async t => {
  for (const change of ['turn', 'operation', 'steer']) {
    const f = fixture(t), canonical = point(B);
    if (change === 'turn') canonical.boundary.turn_id = 'old-native-turn';
    if (change === 'operation') canonical.boundary.operation_id = 'sha256:' + 'f'.repeat(64);
    if (change === 'steer') canonical.boundary.steer_id = 'f'.repeat(16);
    const request = await f.edge(A, B, canonical), observed = f.runtime.interruptionSync.bind(f.runtime);
    f.runtime.interruptionSync = run => { assert.deepEqual(run, point(B), 'never claim old receipt as the native-selected run'); return observed(run); };
    const result = await f.service.interruptCascade(input([B]));
    assert.equal(result.status, 'unconfirmed'); assert.ok(result.unresolved.some(value => value.reason === 'native_canonical_alias_missing'));
    const record = (await f.read()).records.find(value => value.reservation.request.delivery_id === request.delivery_id);
    assert.deepEqual(record.relation.target, canonical); assert.equal(record.relation.completion, 'open');
  }
});
test('native-issued RPC timeout keeps all native keys unissued and real late receipt intact', { skip: posixCheckpoint }, async t => {
  const f = fixture(t, 0), record = await f.register('pending-native', A, B), ready = deferred(), release = deferred();
  const pending = f.service.invoke({ schema: 'aiterm.execution-ref.v1', request: record.reservation.request }, 'send', async () => {
    ready.resolve(); await release.promise; return { value: 'late accepted receipt', target: point(B) };
  });
  await ready.promise;
  const result = await f.service.interruptCascade(input([A]));
  assert.equal(result.status, 'unconfirmed'); assert.deepEqual(f.keys, []);
  assert.ok(result.unresolved.some(gap => gap.reason === 'native_issuance_unconfirmed'));
  release.resolve(); assert.equal((await pending).record.operations.send, 'accepted');
});
test('a genuine created-child receipt during drain adds its exact launch before any key', { skip: posixCheckpoint }, async t => {
  const f = fixture(t, 500); await f.edge(A, B); f.live.delete(C.session_id); f.observations.delete(C.session_id);
  const record = await f.register('late-child-create', B, C, null), ready = deferred(), release = deferred();
  const pending = f.service.invoke({ schema: 'aiterm.execution-ref.v1', request: record.reservation.request }, 'launch', async () => {
    ready.resolve(); await release.promise; f.add(C); return { value: 'created child receipt', target: point(C) };
  });
  await ready.promise; f.requireAll([A, B, C]);
  const stopping = f.service.interruptCascade(input([A]));
  await until(async () => (await f.read()).interruptions.length >= 2); assert.deepEqual(f.keys, []);
  release.resolve(); assert.equal((await pending).record.operations.launch, 'accepted');
  const result = await stopping; assert.equal(result.status, 'confirmed'); assert.deepEqual(f.keys, [A.session_id, B.session_id, C.session_id]);
});
test('a replaced generation is never interrupted by reusable seat name', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); f.live.set(A.session_id, { ...A, launch_id: 'f'.repeat(32) });
  const result = await f.service.interruptCascade(input([A]));
  assert.equal(result.status, 'unconfirmed'); assert.deepEqual(f.keys, []); assert.equal(result.targets[0].key_receipt, 'not_sent');
});
test('two controllers share the same journal and native command without replay', { skip: posixCheckpoint }, async t => {
  const f = fixture(t), other = new ExecutionService(new FileExecutionStore(f.store.directory), f.runtime);
  const results = await Promise.all([f.service.interruptCascade(input([A])), other.interruptCascade(input([A]))]);
  assert.deepEqual(f.keys, [A.session_id]); assert.ok(results.some(result => result.status === 'confirmed'));
});
test('public stop remains read-only even with private controller callbacks; missing private capabilities also stay unsupported', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); const result = await f.service.stop(input([A]));
  assert.equal(result.targets[0].interruption, 'unsupported'); assert.deepEqual((await f.read()).interruptions, []);
  delete f.runtime.selectInterruptionSync;
  assert.equal((await f.service.interruptCascade(input([A]))).targets[0].interruption, 'unsupported'); assert.deepEqual(f.keys, []);
});
test('all barrier releases and the final scope commit together, before accepting same-launch new work', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.edge(A, B); let checked = 0;
  f.onProof(run => { if (run.launch.session_id !== B.session_id) return;
    const persisted = JSON.parse(readFileSync(join(f.store.directory, 'relations.json'), 'utf8'));
    assert.equal(persisted.interruptions.find(row => row.before.run.launch.session_id === A.session_id).phase, 'accepted'); checked++;
  });
  assert.equal((await f.service.interruptCascade(input([A]))).status, 'confirmed'); assert.ok(checked > 0);
  assert.ok((await f.read()).interruptions.every(row => row.phase === 'settled'));
});
test('replacement of an earlier target during another proof rolls back all releases and stays possible', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.edge(A, B);
  f.onProof(run => { if (run.launch.session_id === B.session_id) f.live.set(A.session_id, { ...A, launch_id: 'e'.repeat(32) }); });
  await assert.rejects(f.service.interruptCascade(input([A])), error => error.effect === 'possible');
  assert.ok((await f.read()).interruptions.every(row => row.phase === 'accepted')); assert.equal(f.keys.length, 2);
});
test('a late coverage callback rejection cannot erase native key effects with a not_started error', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); f.runtime.coverage = async () => { throw Object.assign(new Error('late callback refused'), { effect: 'not_started' }); };
  await assert.rejects(f.service.interruptCascade(input([A])), error => error.effect === 'possible');
  assert.deepEqual(f.keys, [A.session_id]); assert.equal((await f.read()).interruptions[0].phase, 'accepted');
});
test('unrelated native-issued RPC does not delay the selected cascade or get cancelled', { skip: posixCheckpoint }, async t => {
  const f = fixture(t), record = await f.register('independent-rpc', C, D), ready = deferred(), release = deferred();
  const pending = f.service.invoke({ schema: 'aiterm.execution-ref.v1', request: record.reservation.request }, 'send', async () => {
    ready.resolve(); await release.promise; return { value: 'independent receipt', target: point(D) };
  });
  await ready.promise;
  assert.equal((await f.service.interruptCascade(input([A]))).status, 'confirmed'); assert.deepEqual(f.keys, [A.session_id]);
  release.resolve(); assert.equal((await pending).value, 'independent receipt');
});
test('incomplete relation coverage is partial even when a selected native run is independently confirmed', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); f.runtime.coverage = async () => 'incomplete';
  const result = await f.service.interruptCascade(input([A]));
  assert.equal(result.status, 'partial'); assert.equal(result.relation_coverage, 'incomplete');
  assert.equal(result.targets[0].interruption, 'interrupted');
});
test('actual runtime constructor captures private controller callbacks without enabling the public stop control', { skip: posixCheckpoint }, async t => {
  const f = fixture(t), observe = session_id => ({ schema: 'aiterm.pty-observe-result.v1', session_id,
    exists: f.live.has(session_id), launch_id: f.live.get(session_id)?.launch_id ?? null });
  const bindings = { observeSession: observe, observeSessionSync: observe, async observeDone() { assert.fail('no generic completion'); },
    observeInterruptionSync: f.runtime.interruptionSync, selectInterruptionSync: f.runtime.selectInterruptionSync,
    interruptKeySync: f.runtime.interruptKeySync, async relationCoverage() { return 'complete'; } };
  const runtime = createExecutionRuntime(bindings), service = new ExecutionService(f.store, runtime);
  bindings.selectInterruptionSync = bindings.interruptKeySync = () => assert.fail('mutable options replacement');
  for (const name of ['observeInterruptionSync', 'selectInterruptionSync', 'interruptKeySync'])
    assert.throws(() => createExecutionRuntime({ ...bindings, [name]: 'not a callback' }), error => error.code === 'EXECUTION_UNSUPPORTED');
  assert.equal((await service.stop(input([A]))).targets[0].interruption, 'unsupported'); assert.deepEqual(f.keys, []);
  assert.equal((await service.interruptCascade(input([A]))).status, 'confirmed'); assert.deepEqual(f.keys, [A.session_id]);
});
test('selector receives detached recorded Points without resolving mixed receipts to a latest job or overwriting their bindings', { skip: posixCheckpoint }, async t => {
  for (const ambiguous of [false, true]) {
    const f = fixture(t); f.noProof(); const original = point(B), request = await f.edge(A, B, original);
    if (ambiguous) await f.edge(D, B, { ...original, boundary: { ...original.boundary, event_cursor: original.boundary.event_cursor + 1 } });
    const received = [];
    const runtime = createExecutionRuntime({ observeSession: session_id => ({ schema: 'aiterm.pty-observe-result.v1', session_id,
      exists: true, launch_id: f.live.get(session_id).launch_id }),
      observeSessionSync: session_id => ({ schema: 'aiterm.pty-observe-result.v1', session_id, exists: true, launch_id: f.live.get(session_id).launch_id }),
      async observeDone() { assert.fail('not a finish proof'); }, observeInterruptionSync: f.runtime.interruptionSync,
      selectInterruptionSync(launch, candidates) {
        received.push(structuredClone(candidates));
        if (candidates.length) candidates[0].boundary.event_cursor = 999;
        return f.runtime.selectInterruptionSync(launch);
      }, interruptKeySync: f.runtime.interruptKeySync });
    await new ExecutionService(f.store, runtime).interruptCascade(input([B]));
    assert.deepEqual(received, [ambiguous ? [original, { ...original, boundary: { ...original.boundary, event_cursor: original.boundary.event_cursor + 1 } }] : [original]]);
    assert.deepEqual((await f.service.execute({ action: 'status', request })).relation.target, original);
  }
});

test('source-name hints alone do not cancel another launch request, while selected old requests retain their own stop tombstone', { skip: posixCheckpoint }, async t => {
  const f = fixture(t);
  const hint = { kind: 'delivery', delivery_id: 'unknown-source-hint-only', target_session_id: D.session_id };
  await f.service.execute({ action: 'register', source_session_id: B.session_id, reservation: {
    schema: 'aiterm.execution-reservation.v1', request: hint, source: { launch: null, boundary: null },
    target: { session_id: D.session_id, expected_launch_id: D.launch_id } } });
  const selected = await f.register('known-target-B', A, B), unrelated = await f.register('independent-D-C', D, C);
  const result = await f.service.interruptCascade(input([B]));
  assert.equal(result.status, 'unconfirmed', 'missing source-generation evidence remains a gap');
  const state = await f.read(), record = request => state.records.find(row => JSON.stringify(row.reservation.request) === JSON.stringify(request));
  assert.equal(record(selected.reservation.request).stopping, true); assert.equal(record(selected.reservation.request).operations.send, 'not_sent');
  assert.equal(record(hint).stopping, false); assert.equal(record(hint).operations.send, 'not_issued');
  assert.equal(record(unrelated.reservation.request).stopping, false); assert.equal(record(unrelated.reservation.request).operations.send, 'not_issued');
});
test('a stale explicit root does not cancel a same-name reservation bound to another expected generation', { skip: posixCheckpoint }, async t => {
  const f = fixture(t), replacement = { ...B, launch_id: 'e'.repeat(32) }; f.live.set(B.session_id, replacement);
  const record = await f.register('new-generation-reservation', D, replacement);
  const result = await f.service.interruptCascade(input([B]));
  assert.equal(result.status, 'unconfirmed'); assert.deepEqual(f.keys, []);
  const saved = await f.service.execute({ action: 'status', request: record.reservation.request });
  assert.equal(saved.operations.send, 'not_issued'); assert.equal(saved.stopping, false); assert.deepEqual((await f.read()).stopping, []);
});

test('fully completed old contacts do not acquire a new request stop mark from another current run on the same launch', { skip: posixCheckpoint }, async t => {
  const f = fixture(t), request = await f.edge(A, B);
  await f.store.transaction(state => {
    const record = state.records.find(row => JSON.stringify(row.reservation.request) === JSON.stringify(request));
    record.relation.completion = 'completed'; record.relation.target_fence = 'closed';
  });
  const before = (await f.read()).records[0], current = f.observations.get(B.session_id);
  current.run.boundary.turn_id = 'different-current-native-turn'; current.native_boundary.turn_id = 'different-current-native-turn';
  const result = await f.service.interruptCascade(input([B]));
  assert.equal(result.status, 'confirmed'); assert.deepEqual(f.keys, [B.session_id]);
  assert.deepEqual((await f.read()).records[0], { ...before, relation: { ...before.relation, lifecycle: 'retired' } },
    'normal completed-branch retirement is allowed; no stop mark, operation or execution binding is changed');
});
