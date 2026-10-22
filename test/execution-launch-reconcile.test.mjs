import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileExecutionStore } from '../dist/execution-store.js';
import { ExecutionService } from '../dist/execution-service.js';
import { runDeferredBoundExecution } from '../dist/execution-tools.js';
import { guardTmuxExecution } from '../dist/execution-effect.js';

const options = { skip: process.platform === 'win32' ? 'POSIX private graph checkpoint' : false };
const target = { session_id: 'fixture-created', launch_id: 'b'.repeat(32) };
const native = { schema: 'aiterm.execution-native.v1', native_id: '$7', server: { pid: 4711, started_identity: 'Thu Oct 22 19:45:08 2026' } };
async function fixture() {
  const store = new FileExecutionStore(mkdtempSync(join(tmpdir(), 'launch-reconcile-')));
  let live = false, observations = 0;
  let observation = { target, native, initial_prompt: 'none', initial_prompt_delivery: null, harness_alive: true, ready: true };
  const runtime = { sourceEvidence: async () => ({ runtime_launch: null, caller_bound: true, invocation_boundary: null }),
    observe: async () => live ? { state: 'present', launch: target } : { state: 'absent' },
    observeSync: () => live ? { state: 'present', launch: target } : { state: 'absent' },
    observeCreatedLaunchSync: () => { observations++; return structuredClone(observation); },
    nativeSessionSync: () => ({ state: 'present', native_id: native.native_id, server: native.server }),
    completion: async () => ({ state: 'completed', fence: 'closed' }),
    close: async () => assert.fail('reconciliation never closes'), coverage: async () => 'incomplete' };
  const service = new ExecutionService(store, runtime);
  const request = { kind: 'delivery', delivery_id: 'existing-created-launch', target_session_id: target.session_id };
  await service.execute({ action: 'register', source_session_id: null, reservation: {
    schema: 'aiterm.execution-reservation.v1', request, source: { launch: null, boundary: null },
    target: { session_id: target.session_id, expected_launch_id: null } } });
  live = true;
  await store.transaction(state => {
    const record = state.records[0]; record.operations.launch = 'unknown'; record.relation.phase = 'submitted_unknown';
    record.relation.completion = 'unknown'; record.relation.target = { launch: target, boundary: null };
    state.slots.push({ session_id: target.session_id, expected_launch_id: target.launch_id, stage: 'launch', state: 'unknown', request,
      created_native_id: native.native_id, created_server: native.server });
  });
  const action = { action: 'reconcile_launch', request, target };
  return { store, service, runtime, request, action, observations: () => observations, live: value => { live = value; },
    observation: change => { observation = { ...observation, ...change }; } };
}

test('reconciles one created generation with no native call, then the same delivery sends exactly once', options, async () => {
  const f = await fixture(), before = f.store.snapshot().records[0];
  const reconciled = await f.service.execute(f.action);
  assert.equal(reconciled.operations.launch, 'accepted'); assert.equal(reconciled.operations.send, 'not_issued');
  assert.deepEqual(reconciled.reservation, before.reservation); assert.deepEqual(reconciled.relation.target, before.relation.target);
  assert.deepEqual(f.store.snapshot().slots, []); assert.equal(f.observations(), 1);
  const again = await f.service.execute(f.action); assert.deepEqual(again, reconciled);
  let sends = 0;
  const meta = { 'aiterm/execution': { schema: 'aiterm.execution-ref.v1', request: f.request } };
  const send = () => runDeferredBoundExecution(f.service, meta, 'send', target.session_id, async () => {
    guardTmuxExecution(['send-keys', '-t', target.session_id, 'synthetic first body']); sends++;
    return { result: { content: [] }, target: { launch: target,
      boundary: { event_cursor: 17, operation_id: null, turn_id: null, steer_id: null } } };
  });
  assert.equal((await send()).isError, undefined); assert.equal((await send()).isError, true); assert.equal(sends, 1);
});

for (const change of ['issued', 'send-issued', 'missing-native', 'wrong-native', 'wrong-server', 'wrong-generation', 'unknown-input', 'initial-delivery', 'missing-runtime', 'not-ready', 'stopped', 'duplicate-slot'])
  test(`launch reconciliation preserves state on ${change}`, options, async () => {
    const f = await fixture();
    if (change === 'issued') await f.store.transaction(state => { state.records[0].operations.launch = 'issued'; state.slots[0].state = 'issued'; });
    if (change === 'send-issued') await f.store.transaction(state => { state.records[0].operations.send = 'issued'; });
    if (change === 'missing-native') await f.store.transaction(state => { delete state.slots[0].created_native_id; });
    if (change === 'wrong-native') f.observation({ native: { ...native, native_id: '$8' } });
    if (change === 'wrong-server') f.observation({ native: { ...native, server: { ...native.server, pid: 4712 } } });
    if (change === 'initial-delivery') f.observation({ initial_prompt_delivery: { status: 'sent' } });
    if (change === 'missing-runtime') delete f.runtime.observeCreatedLaunchSync;
    if (change === 'wrong-generation') f.observation({ target: { ...target, launch_id: 'c'.repeat(32) } });
    if (change === 'unknown-input') f.observation({ initial_prompt: 'sent' });
    if (change === 'not-ready') f.observation({ ready: false });
    if (change === 'stopped') await f.store.transaction(state => { state.stopping.push(target); });
    if (change === 'duplicate-slot') await f.store.transaction(state => { state.slots.push({ ...state.slots[0], request: { ...f.request, delivery_id: 'another' } }); });
    const before = f.store.snapshot();
    await assert.rejects(f.service.execute(f.action)); assert.deepEqual(f.store.snapshot(), before);
  });

test('reconciliation binds an existing observed launch when creation stopped before graph generation binding', options, async () => {
  const f = await fixture();
  await f.store.transaction(state => { state.slots[0].expected_launch_id = null; state.records[0].relation.target = null; });
  const result = await f.service.execute(f.action);
  assert.deepEqual(result.relation.target, { launch: target, boundary: null }); assert.equal(result.operations.launch, 'accepted');
});

for (const outcome of ['return', 'throw']) test(`late original launch ${outcome} cannot overwrite a reconciled generation`, options, async () => {
  const f = await fixture();
  f.live(false);
  await f.store.transaction(state => {
    const r = state.records[0]; r.operations.launch = 'not_issued'; r.relation.phase = 'reserved';
    r.relation.completion = 'open'; r.relation.target = null; state.slots = [];
  });
  let started, release;
  const ready = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const pending = f.service.invoke({ schema: 'aiterm.execution-ref.v1', request: f.request }, 'launch', async () => {
    started(); await gate;
    if (outcome === 'throw') throw new Error('late original response');
    return { value: 'late original response', target: { launch: target, boundary: null } };
  });
  const rejected = assert.rejects(pending);
  await ready; f.live(true);
  await f.store.transaction(state => {
    const r = state.records[0]; r.operations.launch = 'unknown'; r.relation.completion = 'unknown';
    Object.assign(state.slots[0], { state: 'unknown', expected_launch_id: target.launch_id,
      created_native_id: native.native_id, created_server: native.server });
  });
  await f.service.execute(f.action);
  const reconciled = f.store.snapshot(); release(); await rejected;
  assert.deepEqual(f.store.snapshot(), reconciled);
});
