// All native observations, key transport and final preservation/fence proof
// below are synthetic. No product subprocess, seat, CLI or native factory.
import './seat-env.mjs';
import test from 'node:test';
// These integration cases require the private POSIX file/directory checkpoint.
const posixCheckpoint = process.platform === 'win32' ? 'private native graph requires POSIX directory fsync' : false;
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { FileExecutionStore, executionStateSchema } from '../dist/execution-store.js';
import { ExecutionService } from '../dist/execution-service.js';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
import { createExecutionParentAdapter } from '../dist/execution-parent.js';
import { createParentNativeAdmission } from '../dist/execution-parent-native.js';
import { guardTmuxExecution } from '../dist/execution-effect.js';
import { nativeInterruptionObservationSchema } from '../dist/execution-interruption.js';

const launch = (name, generation = name) => ({ session_id: 'bot-' + name, launch_id: generation.repeat(32) });
const A = launch('a'), B = launch('b'), C = launch('c');
const point = (launch, turn = 'original-turn', cursor = 1) => ({ launch,
  boundary: { event_cursor: cursor, operation_id: null, turn_id: turn, steer_id: null } });
const run = point(B), actor = { pid: 201, started_identity: '2026-10-21T09:00:02Z' };
const ref = request => ({ schema: 'aiterm.execution-ref.v1', request });
const request = (name, target = B) => ({ kind: 'delivery', delivery_id: name, target_session_id: target.session_id });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const receipt = () => ({ schema: 'aiterm.pty-key-result.v1', session_id: B.session_id, key: 'Escape',
  outcome: 'accepted', interruption: 'unconfirmed', session_preserved: 'unconfirmed' });
function observation() {
  return { schema: 'aiterm.native-interruption-observation.v1', run: structuredClone(run),
    native: { schema: 'aiterm.execution-native.v1', native_id: '$9', server: { pid: 4711, started_identity: '2026-10-21T09:00:00Z' } },
    harness: 'codex-cli', harness_process: { ...actor }, endpoint: { session_id: 'native-conversation', record_file: { device: 1, inode: 22 } },
    recorded_state: 'running', native_boundary: { type: 'task_started', turn_id: run.boundary.turn_id, reason: null },
    invocation_fence: 'unknown', session_preserved: 'unconfirmed' };
}
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'interrupt-admission-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new FileExecutionStore(directory), live = new Map([A, B, C].map(value => [value.session_id, value]));
  const native = observation(); let keys = 0;
  const runtime = {
    async sourceEvidence(input) { const claim = input.reservation.source;
      return { runtime_launch: claim.launch, caller_bound: true, invocation_boundary: claim.boundary }; },
    async observe(session) { return this.observeSync(session); },
    observeSync(session) { return live.has(session) ? { state: 'present', launch: live.get(session) } : { state: 'absent' }; },
    async completion() { return { state: 'unknown', fence: 'unknown' }; },
    async close() { assert.fail('never close'); }, async coverage() { return 'incomplete'; },
    interruptionSync() { return structuredClone(native); },
  };
  const service = new ExecutionService(store, runtime);
  const register = (name, source = null, target = B, expected = target.launch_id) => service.execute({ action: 'register', source_session_id: source?.launch.session_id ?? null,
    reservation: { schema: 'aiterm.execution-reservation.v1', request: request(name, target),
      source: { launch: source?.launch ?? null, boundary: source?.boundary ?? null },
      target: { session_id: target.session_id, expected_launch_id: expected } } });
  const key = () => { guardTmuxExecution(['send-keys', '-t', '$9', 'Escape']); keys++; return receipt(); };
  const prove = () => Object.assign(native, { recorded_state: 'interrupted',
    native_boundary: { type: 'turn_aborted', turn_id: run.boundary.turn_id, reason: 'interrupted' },
    invocation_fence: 'closed', session_preserved: 'confirmed' }); // SYNTHETIC full proof only
  const read = () => store.transaction(state => structuredClone(state), { readOnly: true });
  return { directory, store, live, native, runtime, service, register, key, prove, read, keys: () => keys };
}
test('per-run admission cancels old unissued work before a delayed native action, without a permanent launch mark', { skip: posixCheckpoint }, async t => {
  const f = fixture(t), record = await f.register('old-preparing'), ready = deferred(), resume = deferred(); let actions = 0;
  const pending = f.service.invokeDeferred(ref(record.reservation.request), 'send', async issue => {
    ready.resolve(); await resume.promise; issue(); actions++; return { value: 'late', target: run };
  }, B.session_id);
  await ready.promise; await f.service.beginInterruption(run);
  await assert.rejects(f.register('new-during-barrier'));
  resume.resolve(); await assert.rejects(pending); assert.equal(actions, 0); assert.equal(f.keys(), 0);
  const state = await f.read(); assert.deepEqual(state.stopping, []);
  assert.equal(state.records[0].operations.send, 'not_sent'); assert.equal(state.records[0].relation.phase, 'unsent');
  assert.equal(state.interruptions[0].phase, 'draining'); assert.deepEqual(state.slots, []);
});
test('issued old RPC drains its genuine receipt before one Esc; final proof reopens the same launch but not the old ref', { skip: posixCheckpoint }, async t => {
  const f = fixture(t), record = await f.register('issued-before-stop'), ready = deferred(), resume = deferred();
  const pending = f.service.invokeDeferred(ref(record.reservation.request), 'send', async issue => {
    issue(); ready.resolve(); await resume.promise; return { value: 'genuine receipt', target: run };
  }, B.session_id);
  await ready.promise; await f.service.beginInterruption(run);
  await assert.rejects(f.service.interruptRun(run, f.key)); assert.equal(f.keys(), 0);
  resume.resolve(); const late = await pending; assert.equal(late.value, 'genuine receipt'); assert.equal(late.record.operations.send, 'accepted');
  assert.deepEqual((await f.read()).stopping, []);
  await f.service.interruptRun(run, f.key); assert.equal(f.keys(), 1);
  await assert.rejects(f.service.settleInterruption(run)); await assert.rejects(f.register('not-before-proof'));
  f.prove(); await f.service.settleInterruption(run);
  const next = await f.register('new-same-launch'); assert.equal(next.reservation.target.expected_launch_id, B.launch_id);
  assert.equal((await f.read()).records[0].relation.completion, 'interrupted');
  await assert.rejects(f.service.invoke(ref(record.reservation.request), 'send', async () => assert.fail('old request replay')));
  await assert.rejects(f.service.interruptRun(run, f.key)); assert.equal(f.keys(), 1);
});
test('interruption creates a durable native slot but no work record/edge, and a reconstructed service never repeats its key', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.service.beginInterruption(run);
  await f.service.interruptRun(run, () => {
    const value = f.key();
    f.store.transactionSync(state => { assert.equal(state.interruptions[0].phase, 'issued'); assert.equal(state.slots[0].stage, 'interrupt'); }, { readOnly: true });
    return value;
  });
  const state = await f.read(); assert.deepEqual(state.records, []); assert.deepEqual(state.stopping, []);
  assert.equal(state.interruptions[0].phase, 'accepted'); assert.equal(state.slots[0].state, 'unknown');
  const reconstructed = new ExecutionService(new FileExecutionStore(f.directory), f.runtime);
  await assert.rejects(reconstructed.interruptRun(run, f.key));
  f.prove(); await reconstructed.settleInterruption(run); await f.register('new-after-reconstruction'); assert.equal(f.keys(), 1);
});
test('lost key reply remains unknown across reconstruction and native abort/absence cannot authorize a retry or reopening', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.service.beginInterruption(run);
  await assert.rejects(f.service.interruptRun(run, () => { f.key(); throw new Error('reply lost after native action'); }), error => error.effect === 'possible');
  assert.equal((await f.read()).interruptions[0].phase, 'unknown');
  const other = new ExecutionService(new FileExecutionStore(f.directory), f.runtime);
  f.prove(); await assert.rejects(other.settleInterruption(run)); await assert.rejects(other.interruptRun(run, f.key));
  f.live.delete(B.session_id); await assert.rejects(other.settleInterruption(run));
  assert.equal(f.keys(), 1); assert.equal((await f.read()).slots[0].state, 'unknown');
});
test('missing/Promise/wrong-run native adapter is rejected before admission; no claim/idle/closed substitute', { skip: posixCheckpoint }, async t => {
  for (const kind of ['missing', 'promise', 'wrong-run', 'idle', 'closed', 'bad-boundary']) {
    const f = fixture(t);
    if (kind === 'missing') delete f.runtime.interruptionSync;
    if (kind === 'promise') f.runtime.interruptionSync = async () => f.native;
    if (kind === 'wrong-run') f.native.run = point(B, 'wrong-turn');
    if (kind === 'idle') f.native.recorded_state = 'already_idle';
    if (kind === 'closed') f.native.recorded_state = 'closed';
    if (kind === 'bad-boundary') f.native.native_boundary.turn_id = 'another';
    await assert.rejects(f.service.beginInterruption(run), undefined, kind);
    assert.deepEqual((await f.read()).interruptions, []); assert.equal(f.keys(), 0);
  }
});
test('accepted Esc is not settle proof: completion, other turn, endpoint/harness/server/generation change and missing fence all hold admission', { skip: posixCheckpoint }, async t => {
  for (const change of ['normal-done', 'other-turn', 'endpoint', 'actor', 'server', 'generation', 'fence', 'preservation']) {
    const f = fixture(t); await f.service.beginInterruption(run); await f.service.interruptRun(run, f.key); f.prove();
    if (change === 'normal-done') { f.native.recorded_state = 'completed'; f.native.native_boundary = { type: 'task_complete', turn_id: run.boundary.turn_id, reason: null }; }
    if (change === 'other-turn') { f.native.recorded_state = 'other_run'; f.native.native_boundary.turn_id = 'new-turn'; }
    if (change === 'endpoint') f.native.endpoint.session_id = 'other-conversation';
    if (change === 'actor') f.native.harness_process.started_identity = '2026-10-21T09:00:03Z';
    if (change === 'server') f.native.native.server.started_identity = '2026-10-21T09:00:03Z';
    if (change === 'generation') f.live.set(B.session_id, launch('b', 'e'));
    if (change === 'fence') f.native.invocation_fence = 'unknown';
    if (change === 'preservation') f.native.session_preserved = 'unconfirmed';
    await assert.rejects(f.service.settleInterruption(run), undefined, change);
    assert.equal((await f.read()).interruptions[0].phase, 'accepted'); assert.equal(f.keys(), 1);
  }
});
test('settled old source run and missing source boundary remain blocked; new native source run and new target work can use the same launch', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.service.beginInterruption(run); await f.service.interruptRun(run, f.key); f.prove(); await f.service.settleInterruption(run);
  await assert.rejects(f.register('old-source', run, C));
  await assert.rejects(f.register('old-turn-other-cursor', point(B, run.boundary.turn_id, 99), C));
  await assert.rejects(f.register('cursor-only-source', point(B, null, 99), C));
  await assert.rejects(f.register('missing-source-boundary', { launch: B, boundary: null }, C));
  const lookup = await f.service.beginInterruption(point(B, run.boundary.turn_id, 99));
  assert.deepEqual(lookup.before.run, run); assert.equal(lookup.phase, 'settled');
  const newRun = point(B, 'next-native-turn', 2);
  await f.register('new-source', newRun, C); await f.register('new-target', null, B);
  assert.deepEqual((await f.read()).stopping, []);
});
test('native identity change and store admission failure before key remain not_sent, and later retry is forbidden', { skip: posixCheckpoint }, async t => {
  for (const change of ['identity', 'lock']) {
    const f = fixture(t); await f.service.beginInterruption(run);
    if (change === 'identity') f.native.native.native_id = '$10';
    else { const old = f.store.transactionSync.bind(f.store); let first = true;
      f.store.transactionSync = (...args) => { if (first) { first = false; throw new Error('admission missing'); } return old(...args); }; }
    await assert.rejects(f.service.interruptRun(run, f.key)); assert.equal(f.keys(), 0);
    assert.equal((await f.read()).interruptions[0].phase, 'not_sent');
    await assert.rejects(f.service.interruptRun(run, f.key));
  }
});
test('metadata failure after the native key preserves the issued journal/slot and cannot become not_started', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.service.beginInterruption(run); const transaction = f.store.transaction.bind(f.store);
  await assert.rejects(f.service.interruptRun(run, () => {
    const value = f.key(); f.store.transaction = async () => { throw new Error('metadata admission lost'); }; return value;
  }), error => error.effect === 'possible');
  f.store.transaction = transaction;
  const state = await f.read(); assert.equal(state.interruptions[0].phase, 'issued'); assert.equal(state.slots[0].state, 'issued');
  const recovered = new ExecutionService(new FileExecutionStore(f.directory), f.runtime);
  await assert.rejects(recovered.interruptRun(run, f.key)); assert.equal(f.keys(), 1);
});
test('public stop stays read-only unsupported even when the private admission adapter is injected', { skip: posixCheckpoint }, async t => {
  const f = fixture(t), before = await f.read();
  const result = await f.service.stop({ schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots: [B] });
  assert.equal(result.targets[0].interruption, 'unsupported'); assert.equal(result.targets[0].key_receipt, 'not_sent');
  assert.deepEqual(await f.read(), before); assert.equal(f.keys(), 0);
});
test('runtime interruption callback is fixed at construction and receives a detached point', () => {
  const original = observation(); const input = structuredClone(run);
  const bindings = { observeSession() {}, async observeDone() {}, observeInterruptionSync(point) { point.boundary.turn_id = 'mutated'; return original; } };
  const runtime = createExecutionRuntime(bindings); bindings.observeInterruptionSync = () => assert.fail('replaced callback');
  assert.deepEqual(runtime.interruptionSync(input), original); assert.deepEqual(input, run);
  assert.equal(nativeInterruptionObservationSchema.safeParse({ ...original, recorded_state: 'interrupted' }).success, false);
});
async function parentFixture(t) {
  const f = fixture(t), parent = point(A, 'parent-turn'), id = '00000000-0000-4000-8000-000000000001';
  const child = await f.register('original-child-dispatch', parent, B);
  await f.service.invoke(ref(child.reservation.request), 'send', async () => ({ value: 'sent child', target: run }));
  const returning = await f.register(id, run, A);
  await f.service.invoke(ref(returning.reservation.request), 'send', async () => ({ value: 'queued parent return', target: parent }));
  const endpoint = { kind: 'synthetic-endpoint' };
  const binding = { delivery_id: id, request: child.reservation.request, parent, child: run,
    endpoint_digest: createHash('sha256').update(JSON.stringify(endpoint)).digest('hex') };
  await f.store.transaction(state => { state.parent_deliveries.push(binding); });
  const observe = session_id => ({ schema: 'aiterm.pty-observe-result.v1', session_id,
    exists: f.live.has(session_id), launch_id: f.live.get(session_id)?.launch_id ?? null });
  const adapter = createExecutionParentAdapter({ store: f.store, service: f.service, observeSessionGeneration: observe,
    verifyParentEndpoint: () => true });
  const native = () => createParentNativeAdmission({ store: new FileExecutionStore(f.directory), actor,
    observeSessionGenerationSync: observe, verifyParentEndpoint: () => true, preparationTimeoutMs: 0 });
  return { ...f, id, endpoint, parent, binding, adapter, parentNative: native };
}
test('old parent queue/dequeue/emit/wake remain fenced after same-launch reopening and process reconstruction', { skip: posixCheckpoint }, async t => {
  const f = await parentFixture(t); await f.service.beginInterruption(run); await f.service.interruptRun(run, f.key);
  f.prove(); await f.service.settleInterruption(run); await f.register('new-request-after-parent-fence');
  let native = 0;
  await assert.rejects(f.adapter.submit(f.id, f.endpoint, async () => { native++; }), error => error.code === 'EXECUTION_STOPPING');
  for (const stage of ['dequeue', 'emit', 'wake']) {
    const result = await f.parentNative().run(f.id, stage, f.endpoint, async (_endpoint, effect) => { effect(); native++; });
    assert.equal(result.error?.code, 'EXECUTION_STOPPING', stage);
  }
  assert.equal(native, 0); assert.deepEqual((await f.read()).parent_effects, []);
});
test('issued parent native effect drains its genuine receipt before Esc; late wake remains stopped', { skip: posixCheckpoint }, async t => {
  const f = await parentFixture(t), issued = deferred(), resume = deferred(); let emits = 0;
  const pending = f.parentNative().run(f.id, 'emit', f.endpoint, async (_endpoint, effect) => {
    effect(); emits++; issued.resolve(); await resume.promise; return 'genuine native emit receipt';
  });
  await issued.promise; await f.service.beginInterruption(run);
  await assert.rejects(f.service.interruptRun(run, f.key)); assert.equal(f.keys(), 0);
  resume.resolve(); const receipt = await pending; assert.equal(receipt.value, 'genuine native emit receipt');
  assert.equal((await f.read()).parent_effects[0].state, 'accepted');
  await f.service.interruptRun(run, f.key); f.prove(); await f.service.settleInterruption(run);
  const wake = await f.parentNative().run(f.id, 'wake', f.endpoint, async () => assert.fail('old wake'));
  assert.equal(wake.error?.code, 'EXECUTION_STOPPING'); assert.equal(emits, 1); assert.equal(f.keys(), 1);
});
test('request tombstones survive record deletion and prevent existing-ID reuse without a new work queue', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.register('old-id'); await f.service.beginInterruption(run);
  await f.service.interruptRun(run, f.key); f.prove(); await f.service.settleInterruption(run);
  await f.store.transaction(state => { state.records = []; });
  await assert.rejects(f.register('old-id'), error => error.code === 'EXECUTION_STOPPING');
  await f.register('fresh-id'); assert.equal((await f.read()).interruptions[0].requests.length, 1);
});
test('unfinished interruption roots survive absent native sessions and reconstruction without scanning settled history', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.service.beginInterruption(run); f.live.delete(B.session_id);
  const reconstructed = new ExecutionService(new FileExecutionStore(f.directory), f.runtime);
  const roots = await reconstructed.roots({ session_id: B.session_id });
  assert.deepEqual(roots.roots, [B]); assert.ok(roots.unresolved.some(value => value.reason === 'interruption_unconfirmed'));
  f.live.set(B.session_id, B); await f.service.interruptRun(run, f.key); f.prove(); await f.service.settleInterruption(run);
  f.live.delete(B.session_id);
  assert.deepEqual((await reconstructed.roots({ session_id: B.session_id })).roots, []);
});
test('duplicate run journal or mismatched interrupt slot is invalid persisted state, never an empty repaired graph', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.service.beginInterruption(run);
  const state = await f.read(); state.interruptions.push(structuredClone(state.interruptions[0]));
  assert.equal(executionStateSchema.safeParse(state).success, false);
  const corrupted = JSON.stringify(state); writeFileSync(join(f.directory, 'relations.json'), corrupted);
  await assert.rejects(f.read()); assert.equal(f.keys(), 0);
  state.interruptions.pop(); state.slots.push({ session_id: B.session_id, expected_launch_id: B.launch_id, stage: 'interrupt', state: 'unknown', request: null, run: point(C) });
  assert.equal(executionStateSchema.safeParse(state).success, false);
  assert.equal(readFileSync(join(f.directory, 'relations.json'), 'utf8'), corrupted);
});
test('late child receipt expands temporary admission through recorded edges without creating a permanent launch stop', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); f.live.delete(C.session_id);
  const record = await f.register('issued-child-launch', run, C, null), issued = deferred(), resume = deferred();
  const pending = f.service.invoke(ref(record.reservation.request), 'launch', async () => {
    issued.resolve(); await resume.promise; f.live.set(C.session_id, C); return { value: 'actual child launch receipt', target: point(C, 'child-turn') };
  });
  await issued.promise; await f.service.beginInterruption(run); await assert.rejects(f.service.interruptRun(run, f.key));
  resume.resolve(); const receipt = await pending; assert.equal(receipt.record.operations.launch, 'accepted');
  await assert.rejects(f.register('new-child-work', null, C));
  await assert.rejects(f.register('from-late-child', point(C, 'child-turn'), A));
  assert.deepEqual((await f.read()).stopping, []); assert.equal(f.keys(), 0);
});
test('concurrent same-run interrupters share one durable claim and cannot overwrite the genuine accepted key as not_sent', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.service.beginInterruption(run);
  const other = new ExecutionService(new FileExecutionStore(f.directory), f.runtime);
  const outcomes = await Promise.allSettled([f.service.interruptRun(run, f.key), other.interruptRun(run, f.key)]);
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(value => value.status === 'rejected').length, 1);
  assert.equal(f.keys(), 1); assert.equal((await f.read()).interruptions[0].phase, 'accepted');
});
test('a preparing claim surviving its caller cannot be reacquired or silently released by reconstruction', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); await f.service.beginInterruption(run);
  await f.store.transaction(state => { state.interruptions[0].phase = 'preparing'; });
  const other = new ExecutionService(new FileExecutionStore(f.directory), f.runtime);
  await assert.rejects(other.interruptRun(run, f.key)); await assert.rejects(other.settleInterruption(run));
  assert.equal((await f.read()).interruptions[0].phase, 'preparing'); assert.equal(f.keys(), 0);
});
