// Private controller only. All native run/key/preservation/fence/coverage
// evidence is synthetic; no CLI, process, public tool or default runtime.
import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExecutionService } from '../dist/execution-service.js';
import { FileExecutionStore } from '../dist/execution-store.js';
import { guardTmuxExecution } from '../dist/execution-effect.js';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
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
test('controller admits A/B/C before Esc, follows only actual outward edges, and leaves independent D unmodified', async t => {
  const f = fixture(t); await f.edge(A, B); await f.edge(B, C); await f.edge(D, B); f.requireAll([A, B, C]);
  const result = await f.service.interruptCascade(input([A]));
  assert.equal(result.status, 'confirmed'); assert.deepEqual(f.keys, [A.session_id, B.session_id, C.session_id]);
  assert.ok(result.targets.every(target => target.interruption === 'interrupted' && target.session_preserved === 'confirmed'));
  assert.equal(f.observations.get(D.session_id).recorded_state, 'running'); assert.deepEqual((await f.read()).stopping, []);
});
test('cycles and duplicate explicit roots do not duplicate native keys', async t => {
  const f = fixture(t); await f.edge(A, B); await f.edge(B, A); f.requireAll([A, B]);
  const result = await f.service.interruptCascade(input([A, A]));
  assert.equal(result.status, 'confirmed'); assert.deepEqual(f.keys.sort(), [A.session_id, B.session_id]);
});
test('key acceptance alone holds interruption/session unconfirmed and never retries on another controller call', async t => {
  const f = fixture(t); f.noProof();
  const result = await f.service.interruptCascade(input([A]));
  assert.equal(result.status, 'unconfirmed'); assert.equal(result.targets[0].key_receipt, 'accepted');
  assert.equal(result.targets[0].session_preserved, 'unconfirmed');
  await f.service.interruptCascade(input([A])); assert.deepEqual(f.keys, [A.session_id]);
});
test('unsupported child admission holds parent release and does not close or guess a key for that child', async t => {
  const f = fixture(t); await f.edge(A, B); f.observations.delete(B.session_id);
  const result = await f.service.interruptCascade(input([A]));
  assert.equal(result.status, 'unconfirmed'); assert.deepEqual(f.keys, [A.session_id]);
  assert.equal(result.targets.find(target => target.launch.session_id === B.session_id).interruption, 'unsupported');
  assert.equal((await f.read()).interruptions[0].phase, 'accepted');
});
test('missing canonical native alias preserves the original turn-null receipt and never confirms/retires it', async t => {
  const f = fixture(t), canonical = point(B); canonical.boundary.turn_id = null;
  const request = await f.edge(A, B, canonical);
  const result = await f.service.interruptCascade(input([B]));
  assert.equal(result.status, 'unconfirmed'); assert.ok(result.unresolved.some(gap => gap.reason === 'native_canonical_alias_missing'));
  const record = (await f.read()).records.find(record => record.reservation.request.delivery_id === request.delivery_id);
  assert.deepEqual(record.relation.target, canonical); assert.equal(record.relation.completion, 'open'); assert.equal(record.relation.lifecycle, 'tracking');
});
test('native-issued RPC timeout keeps all native keys unissued and real late receipt intact', async t => {
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
test('a genuine created-child receipt during drain adds its exact launch before any key', async t => {
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
test('a replaced generation is never interrupted by reusable seat name', async t => {
  const f = fixture(t); f.live.set(A.session_id, { ...A, launch_id: 'f'.repeat(32) });
  const result = await f.service.interruptCascade(input([A]));
  assert.equal(result.status, 'unconfirmed'); assert.deepEqual(f.keys, []); assert.equal(result.targets[0].key_receipt, 'not_sent');
});
test('two controllers share the same journal and native command without replay', async t => {
  const f = fixture(t), other = new ExecutionService(new FileExecutionStore(f.store.directory), f.runtime);
  const results = await Promise.all([f.service.interruptCascade(input([A])), other.interruptCascade(input([A]))]);
  assert.deepEqual(f.keys, [A.session_id]); assert.ok(results.some(result => result.status === 'confirmed'));
});
test('public stop remains read-only even with private controller callbacks; missing private capabilities also stay unsupported', async t => {
  const f = fixture(t); const result = await f.service.stop(input([A]));
  assert.equal(result.targets[0].interruption, 'unsupported'); assert.deepEqual((await f.read()).interruptions, []);
  delete f.runtime.selectInterruptionSync;
  assert.equal((await f.service.interruptCascade(input([A]))).targets[0].interruption, 'unsupported'); assert.deepEqual(f.keys, []);
});
test('all barrier releases and the final scope commit together, before accepting same-launch new work', async t => {
  const f = fixture(t); await f.edge(A, B); let checked = 0;
  f.onProof(run => { if (run.launch.session_id !== B.session_id) return;
    const persisted = JSON.parse(readFileSync(join(f.store.directory, 'relations.json'), 'utf8'));
    assert.equal(persisted.interruptions.find(row => row.before.run.launch.session_id === A.session_id).phase, 'accepted'); checked++;
  });
  assert.equal((await f.service.interruptCascade(input([A]))).status, 'confirmed'); assert.ok(checked > 0);
  assert.ok((await f.read()).interruptions.every(row => row.phase === 'settled'));
});
test('replacement of an earlier target during another proof rolls back all releases and stays possible', async t => {
  const f = fixture(t); await f.edge(A, B);
  f.onProof(run => { if (run.launch.session_id === B.session_id) f.live.set(A.session_id, { ...A, launch_id: 'e'.repeat(32) }); });
  await assert.rejects(f.service.interruptCascade(input([A])), error => error.effect === 'possible');
  assert.ok((await f.read()).interruptions.every(row => row.phase === 'accepted')); assert.equal(f.keys.length, 2);
});
test('a late coverage callback rejection cannot erase native key effects with a not_started error', async t => {
  const f = fixture(t); f.runtime.coverage = async () => { throw Object.assign(new Error('late callback refused'), { effect: 'not_started' }); };
  await assert.rejects(f.service.interruptCascade(input([A])), error => error.effect === 'possible');
  assert.deepEqual(f.keys, [A.session_id]); assert.equal((await f.read()).interruptions[0].phase, 'accepted');
});
test('unrelated native-issued RPC does not delay the selected cascade or get cancelled', async t => {
  const f = fixture(t), record = await f.register('independent-rpc', C, D), ready = deferred(), release = deferred();
  const pending = f.service.invoke({ schema: 'aiterm.execution-ref.v1', request: record.reservation.request }, 'send', async () => {
    ready.resolve(); await release.promise; return { value: 'independent receipt', target: point(D) };
  });
  await ready.promise;
  assert.equal((await f.service.interruptCascade(input([A]))).status, 'confirmed'); assert.deepEqual(f.keys, [A.session_id]);
  release.resolve(); assert.equal((await pending).value, 'independent receipt');
});
test('incomplete relation coverage is partial even when a selected native run is independently confirmed', async t => {
  const f = fixture(t); f.runtime.coverage = async () => 'incomplete';
  const result = await f.service.interruptCascade(input([A]));
  assert.equal(result.status, 'partial'); assert.equal(result.relation_coverage, 'incomplete');
  assert.equal(result.targets[0].interruption, 'interrupted');
});
test('actual runtime constructor captures private controller callbacks without enabling the public stop control', async t => {
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
