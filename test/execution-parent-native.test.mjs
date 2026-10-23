// Historical destructive close/admission fixtures use closeCascade explicitly.
// These are not acceptance evidence for the session-preserving stop control.
import './seat-env.mjs';
import test from 'node:test';
// These integration cases require the private POSIX file/directory checkpoint.
const posixCheckpoint = process.platform === 'win32' ? 'private native graph requires POSIX directory fsync' : false;
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
import { FileExecutionStore } from '../dist/execution-store.js';
import { ExecutionService } from '../dist/execution-service.js';
import { createExecutionParentAdapter } from '../dist/execution-parent.js';
import { createParentNativeAdmission } from '../dist/execution-parent-native.js';

const A = { session_id: 'bot-a', launch_id: 'a'.repeat(32) }, B = { session_id: 'bot-b', launch_id: 'b'.repeat(32) };
const point = (launch, cursor = null) => ({ launch, boundary: cursor === null ? null
  : { event_cursor: cursor, operation_id: null, turn_id: null, steer_id: null } });
const id = '00000000-0000-4000-8000-000000000001';
const endpoint = { kind: 'synthetic-codex', thread_id: 'existing-native-thread' };
const request = { kind: 'delivery', delivery_id: 'original-dispatch', target_session_id: B.session_id };
const returning = { kind: 'delivery', delivery_id: id, target_session_id: A.session_id };
const pause = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve }; };
async function fixture(drainTimeoutMs = 60) {
  const store = new FileExecutionStore(mkdtempSync(join(tmpdir(), 'parent-native-'))), live = new Map([A, B].map(value => [value.session_id, value]));
  let aliasValid = true;
  const observe = session_id => ({ schema: 'aiterm.pty-observe-result.v1', session_id,
    exists: live.has(session_id), launch_id: live.get(session_id)?.launch_id ?? null });
  const verify = (parent, actual) => aliasValid && parent.launch.launch_id === A.launch_id && actual.thread_id === endpoint.thread_id;
  const runtime = createExecutionRuntime({ sourceEnvironment: { AITERM_SESSION_ID: A.session_id, AITERM_AGENT_LAUNCH_ID: A.launch_id },
    observeSession: observe, observeSessionSync: observe, async observeDone() { throw Error('unused'); },
    async guardedClose(expected) { assert.deepEqual(live.get(expected.session_id), expected); live.delete(expected.session_id); } });
  const service = new ExecutionService(store, runtime, drainTimeoutMs);
  await service.execute({ action: 'register', source_session_id: A.session_id,
    reservation: { schema: 'aiterm.execution-reservation.v1', request,
      source: point(A), target: { session_id: B.session_id, expected_launch_id: B.launch_id } } });
  await service.invoke({ schema: 'aiterm.execution-ref.v1', request }, 'send', async () => ({ value: null, target: point(B, 17) }));
  const parent = createExecutionParentAdapter({ store, service, observeSessionGeneration: observe, verifyParentEndpoint: verify });
  await parent.bind(id, request, point(B, 17), endpoint);
  assert.equal((await parent.submit(id, endpoint, async (_, __, issue) => { issue(); return { queued_submission_id: 'existing-queue-id' }; })).isError, undefined);
  const bindings = { store, actor: { pid: 12345, started_identity: 'synthetic-native-process-start' },
    observeSessionGenerationSync: observe, verifyParentEndpoint: verify };
  return { store, live, service, parent, bindings, native: createParentNativeAdmission(bindings),
    alias(value) { aliasValid = value; }, closeCascade: () => service.closeCascade({ schema: 'aiterm.cascade-stop-request.v1', roots: [B] }),
    state: () => store.transaction(state => structuredClone(state), { readOnly: true }) };
}
test('emit and wake join the same accepted delivery without submitting it again or completing its execution', { skip: posixCheckpoint }, async () => {
  const f = await fixture(); let effects = 0;
  for (const stage of ['emit', 'wake']) {
    const result = await f.native.run(id, stage, endpoint, async (fixed, issue) => {
      assert.deepEqual(fixed, endpoint); issue(); effects++; return 'native-accepted-' + stage;
    });
    assert.equal(result.error, undefined); assert.equal(result.value, 'native-accepted-' + stage);
  }
  const state = await f.state(); assert.equal(effects, 2); assert.equal(state.slots.length, 0);
  assert.deepEqual(state.parent_effects.map(value => value.state), ['accepted', 'accepted']);
  assert.equal(state.records.length, 2); assert.equal(state.records[1].relation.completion, 'open');
  const duplicate = await f.native.run(id, 'emit', endpoint, async (_, issue) => { issue(); effects++; });
  assert.equal(duplicate.error.code, 'EXECUTION_CONFLICT'); assert.equal(effects, 2);
});
test('stop can finish while an emit is only preparing; its late callback cannot restart the parent', { skip: posixCheckpoint }, async () => {
  const f = await fixture(), entered = pause(), release = pause(); let effects = 0;
  const pending = f.native.run(id, 'emit', endpoint, async (_, issue) => {
    entered.resolve(); await release.promise; issue(); effects++; return 'emitted';
  });
  await entered.promise; const result = await f.closeCascade();
  assert.deepEqual(result.targets.map(value => value.launch.session_id), [B.session_id, A.session_id]);
  release.resolve(); assert.equal((await pending).error.effect, 'not_started'); assert.equal(effects, 0);
});
test('stop drains an issued emit phase and finish cannot retire the relation while its native slot is open', { skip: posixCheckpoint }, async () => {
  // The drain bound must outlive this test's own release; a loaded host (macOS, 2026-10-23) fired the 2ms check after the 60ms default had expired.
  const f = await fixture(5000), entered = pause(), release = pause(); let effects = 0;
  const pending = f.native.run(id, 'emit', endpoint, async (_, issue) => {
    issue(); effects++; entered.resolve(); await release.promise; return 'emitted';
  });
  await entered.promise;
  await assert.rejects(f.service.execute({ action: 'finish', request: returning, evidence: { kind: 'not_sent' } }), error => error.code === 'EXECUTION_UNCONFIRMED');
  const stopped = f.closeCascade(); await new Promise(resolve => setTimeout(resolve, 2)); assert.equal(f.live.size, 2);
  release.resolve(); assert.equal((await pending).value, 'emitted');
  assert.deepEqual((await stopped).targets.map(value => value.outcome), ['closed', 'closed']); assert.equal(effects, 1);
});
test('a lost issued native receipt survives reconstruction, is never retried and blocks expected close', { skip: posixCheckpoint }, async () => {
  const f = await fixture(); let effects = 0;
  const failed = await f.native.run(id, 'wake', endpoint, async (_, issue) => { issue(); effects++; throw Error('synthetic lost native response'); });
  assert.equal(failed.error.effect, 'possible');
  const retry = await createParentNativeAdmission(f.bindings).run(id, 'wake', endpoint, async (_, issue) => { issue(); effects++; });
  assert.equal(retry.error.effect, 'possible'); assert.equal(effects, 1);
  const stopped = await f.closeCascade();
  assert.equal(stopped.status, 'partial'); assert.equal(stopped.targets.find(value => value.launch.session_id === A.session_id).outcome, 'unknown');
  const state = await f.state(); assert.equal(state.parent_effects[0].state, 'unknown'); assert.equal(state.slots[0].state, 'unknown');
});
test('missing native proof or an endpoint replacement before emission refuses before any effect', { skip: posixCheckpoint }, async () => {
  const f = await fixture(); let effects = 0;
  const missing = await createParentNativeAdmission({ store: f.store, actor: null }).run(id, 'emit', endpoint, async (_, issue) => { issue(); effects++; });
  assert.equal(missing.error.code, 'EXECUTION_UNSUPPORTED');
  const changed = await f.native.run(id, 'emit', endpoint, async (_, issue) => {
    f.alias(false); try { issue(); effects++; } catch { /* no false receipt */ } return 'false-emitted';
  });
  assert.equal(changed.error.code, 'EXECUTION_STALE_GENERATION'); assert.equal(changed.value, undefined); assert.equal(effects, 0);
});
test('an accepted queued delivery may finish its native phase after the child naturally closes, without inventing a new source', { skip: posixCheckpoint }, async () => {
  const f = await fixture(); f.live.delete(B.session_id); let effects = 0;
  const result = await f.native.run(id, 'emit', endpoint, async (_, issue) => { issue(); effects++; return 'emitted'; });
  assert.equal(result.error, undefined); assert.equal(effects, 1);
  const state = await f.state(); assert.equal(state.records.length, 2); assert.deepEqual(state.records[1].relation.source.launch, B);
});
test('a genuine native receipt is retained when its post-effect generation proof is lost', { skip: posixCheckpoint }, async () => {
  const f = await fixture(); let effects = 0;
  const result = await f.native.run(id, 'emit', endpoint, async (_, issue) => {
    issue(); effects++; f.live.set(A.session_id, { ...A, launch_id: 'e'.repeat(32) }); return 'genuine-native-accepted';
  });
  assert.equal(result.value, 'genuine-native-accepted'); assert.equal(result.error.effect, 'possible'); assert.equal(effects, 1);
  assert.equal((await f.state()).slots[0].expected_launch_id, A.launch_id);
});
test('escaped phase callbacks are bound to a finished frame and cannot act in another turn', { skip: posixCheckpoint }, async () => {
  const f = await fixture(); let escaped, effects = 0;
  const result = await f.native.run(id, 'emit', endpoint, async (_, issue) => { escaped = issue; return 'not-issued'; });
  assert.equal(result.error.effect, 'not_started');
  assert.throws(() => { escaped(); effects++; }); assert.equal(effects, 0);
});
test('one hook output joins multiple existing deliveries and keeps every child fence without a new batch ID', { skip: posixCheckpoint }, async () => {
  // The successful multi-child drain is not the 60ms timeout test.
  const f = await fixture(5000), C = { session_id: 'bot-c', launch_id: 'c'.repeat(32) };
  const second = '00000000-0000-4000-8000-000000000002';
  const next = { kind: 'delivery', delivery_id: 'original-ac', target_session_id: C.session_id };
  f.live.set(C.session_id, C);
  await f.service.execute({ action: 'register', source_session_id: A.session_id,
    reservation: { schema: 'aiterm.execution-reservation.v1', request: next, source: point(A),
      target: { session_id: C.session_id, expected_launch_id: C.launch_id } } });
  await f.service.invoke({ schema: 'aiterm.execution-ref.v1', request: next }, 'send', async () => ({ value: null, target: point(C, 23) }));
  await f.parent.bind(second, next, point(C, 23), endpoint);
  await f.parent.submit(second, endpoint, async (_, __, issue) => { issue(); return { queued_submission_id: 'second-existing-queue-id' }; });
  const entered = pause(), release = pause(); let effects = 0;
  const native = f.native.run([id, second], 'emit', endpoint, async (_, issue) => {
    issue(); effects++; entered.resolve(); await release.promise; return 'one-output';
  });
  await entered.promise;
  const state = await f.state(); assert.equal(state.slots.length, 1);
  assert.deepEqual(state.slots[0].sources, [B, C]);
  assert.equal(state.parent_effects.length, 2);
  await assert.rejects(f.service.execute({ action: 'finish', request: { kind: 'delivery', delivery_id: second, target_session_id: A.session_id },
    evidence: { kind: 'not_sent' } }), error => error.code === 'EXECUTION_UNCONFIRMED');
  const stopping = f.service.closeCascade({ schema: 'aiterm.cascade-stop-request.v1', roots: [C] });
  // Wait for the actual durable stop fence instead of assuming a 2ms sleep
  // schedules the stop before a loaded runner's fsync/commit work.
  const deadline = Date.now() + 4000;
  while (!f.store.snapshot().stopping.some(value => value.launch_id === C.launch_id)) {
    assert.ok(Date.now() < deadline, 'stop fence was not persisted');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  release.resolve();
  assert.equal((await native).value, 'one-output'); assert.equal(effects, 1);
  assert.equal((await stopping).targets.every(value => value.outcome === 'closed'), true);
});
test('receiver preflight waits for the issued queue receipt without holding a native slot or retrying input', { skip: posixCheckpoint }, async () => {
  const f = await fixture(), second = '00000000-0000-4000-8000-000000000002';
  await f.parent.bind(second, request, point(B, 17), endpoint);
  const entered = pause(), release = pause(); let queued = 0, emitted = 0;
  const queue = f.parent.submit(second, endpoint, async (_, __, issue) => {
    issue(); queued++; entered.resolve(); await release.promise; return { queued_submission_id: 'second-queue-id' };
  });
  await entered.promise;
  const emitting = f.native.run(second, 'emit', endpoint, async (_, issue) => { issue(); emitted++; return 'emitted'; });
  await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal((await f.state()).parent_effects.length, 0); assert.equal(emitted, 0);
  release.resolve(); assert.equal((await queue).isError, undefined);
  assert.equal((await emitting).value, 'emitted'); assert.equal(queued, 1); assert.equal(emitted, 1);
});
test('native hook context is fixed at ingress and must match the actual endpoint resolver rather than only the parent name', { skip: posixCheckpoint }, async () => {
  const f = await fixture(), context = { conversation_id: 'native-conversation' }, entered = pause(), release = pause();
  const native = createParentNativeAdmission({ ...f.bindings,
    verifyParentEndpoint: (_, __, ctx) => ctx?.conversation_id === 'native-conversation' });
  let effects = 0;
  const rejected = await native.run(id, 'emit', endpoint, async (_, issue) => { issue(); effects++; }, { conversation_id: 'wrong-native-conversation' });
  assert.equal(rejected.error.code, 'EXECUTION_STALE_GENERATION');
  const running = native.run(id, 'emit', endpoint, async (_, issue) => { entered.resolve(); await release.promise; issue(); effects++; return 'emitted'; }, context);
  await entered.promise; context.conversation_id = 'later-conversation'; release.resolve();
  assert.equal((await running).value, 'emitted'); assert.equal(effects, 1);
});
test('each delivery in one native output needs its own evidence both at preflight and the actual issue boundary', { skip: posixCheckpoint }, async () => {
  const f = await fixture(), second = '00000000-0000-4000-8000-000000000002';
  await f.parent.bind(second, request, point(B, 17), endpoint);
  await f.parent.submit(second, endpoint, async (_, __, issue) => { issue(); return { queued_submission_id: 'second-queue' }; });
  let secondValid = false, effects = 0;
  const native = createParentNativeAdmission({ ...f.bindings,
    verifyParentEndpoint: (_, __, ___, binding) => binding.delivery_id === id || secondValid });
  const first = await native.run([id, second], 'emit', endpoint, async () => { assert.fail('invalid second delivery must fail preflight'); });
  assert.equal(first.error.code, 'EXECUTION_STALE_GENERATION');
  secondValid = true;
  const later = await native.run([id, second], 'emit', endpoint, async (_, issue) => {
    secondValid = false; issue(); effects++; return 'not-emitted';
  });
  assert.equal(later.error.effect, 'not_started'); assert.equal(effects, 0);
  assert.equal((await f.state()).parent_effects.length, 0);
});
test('pending/rejected endpoint verification promises cannot authorize a native output', { skip: posixCheckpoint }, async () => {
  const f = await fixture(); let effects = 0;
  for (const verifyParentEndpoint of [async () => true, async () => { throw Error('missing native proof'); }]) {
    const result = await createParentNativeAdmission({ ...f.bindings, verifyParentEndpoint })
      .run(id, 'emit', endpoint, async (_, issue) => { issue(); effects++; });
    assert.equal(result.error.code, 'EXECUTION_UNSUPPORTED'); assert.equal(result.error.effect, 'not_started');
  }
  assert.equal(effects, 0);
});
