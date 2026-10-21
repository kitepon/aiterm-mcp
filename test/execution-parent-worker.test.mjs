import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionParentWorker } from '../dist/execution-parent-worker.js';
import { createExecutionParentAdapter } from '../dist/execution-parent.js';
import { createParentSourceEvidence } from '../dist/execution-parent-source.js';
import { withExecutionRequest } from '../dist/execution-context.js';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
import { ExecutionService } from '../dist/execution-service.js';
import { executionStoreDirectory } from '../dist/execution-store.js';
import { readAcceptedParentHookReference } from '../dist/execution-parent-alias.js';
import { createParentNativeAdmission } from '../dist/execution-parent-native.js';

const A = { session_id: 'bot-a', launch_id: 'a'.repeat(32) }, B = { session_id: 'bot-b', launch_id: 'b'.repeat(32) };
const point = (launch, cursor = null) => ({ launch: { ...launch }, boundary: cursor === null ? null
  : { event_cursor: cursor, operation_id: null, turn_id: null, steer_id: null } });
const harness = { pid: 20, started_identity: '2026-10-21T07:00:00Z' };
const mcp = { pid: 22, started_identity: '2026-10-21T07:00:01Z' }, hook = { pid: 24, started_identity: '2026-10-21T07:00:02Z' };
const thread = '00000000-0000-4000-8000-000000000001', id = '00000000-0000-4000-8000-000000000002';
const request = { kind: 'mcp', process_pid: mcp.pid, process_started_identity: mcp.started_identity,
  request_id: 41, tool: 'pty_send', target_session_id: B.session_id };
const contract = () => ({ schema: 'steer.delivery-admission.v1', native_context: true,
  cursor_profile_parameter: true, serialized_required: true, multi_delivery_emit: true });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'parent-worker-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const actual = { state_root: root, multiplexer: { kind: 'socket', key: join(root, 'synthetic-native.sock') } };
  const snapshot = { schema: 'aiterm.execution-parent-process.v1', source: point(A), harness: 'codex-cli', harness_process: { ...harness },
    processes: [{ ...harness, parent_pid: 19 }, { ...mcp, parent_pid: 20 }, { ...hook, parent_pid: 20 }] };
  const observe = session_id => ({ schema: 'aiterm.pty-observe-result.v1', session_id, exists: true,
    launch_id: session_id === A.session_id ? A.launch_id : B.launch_id });
  const profile = { id: 'synthetic-worker', state_root: () => root };
  const provider = { withDeliveryEffect() {}, DELIVERY_ADMISSION_CONTRACT: contract() };
  const runtime = { scope: () => structuredClone(actual), actor: () => ({ ...hook }),
    observeParentProcess: () => structuredClone(snapshot), observeSessionGeneration: observe };
  const options = { profile, provider, expectedScope: structuredClone(actual), runtime, codexHome: join(root, 'native-home') };
  const endpoint = { thread_id: thread, codex_home: options.codexHome };
  const effect = { vendor: 'codex', stage: 'emit', delivery_ids: [id], endpoint,
    native_context: { session_id: thread, turn_id: 'native-turn' } };
  return { root, actual, snapshot, options, endpoint, effect, observe };
}
async function seed(f, worker) {
  const runtime = createExecutionRuntime({ sourceEnvironment: { AITERM_SESSION_ID: A.session_id, AITERM_AGENT_LAUNCH_ID: A.launch_id },
    observeSession: f.observe, observeSessionSync: f.observe, async observeDone() { throw Error('no native completion fixture'); } });
  const service = new ExecutionService(worker.store, runtime);
  await service.execute({ action: 'register', source_session_id: A.session_id, reservation: { schema: 'aiterm.execution-reservation.v1', request,
    source: point(A), target: { session_id: B.session_id, expected_launch_id: B.launch_id } } });
  await service.invoke({ schema: 'aiterm.execution-ref.v1', request }, 'send', async () => ({ value: null, target: point(B, 17) }));
  const sourceEvidence = createParentSourceEvidence({ decode: () => structuredClone(f.endpoint),
    observeParentProcess: () => structuredClone(f.snapshot) });
  const parent = createExecutionParentAdapter({ store: worker.store, service, sourceEvidence,
    observeSessionGeneration: f.observe, verifyParentEndpoint: () => true }); // explicit synthetic queue alias proof
  const proof = withExecutionRequest(request, () => parent.captureEndpointEvidence(f.endpoint), {
    source: point(A), client_name: 'synthetic-native-client', native_identity: mcp, metadata: null });
  await parent.bind(id, request, point(B, 17), f.endpoint, proof);
  await parent.submit(id, f.endpoint, async (_, __, issue) => { issue(); return { queued_submission_id: 'existing-queue' }; });
  return parent;
}
test('old public provider and incomplete injected runtimes fail before any local/native fallback', t => {
  const f = fixture(t); let reads = 0;
  assert.throws(() => createExecutionParentWorker({ ...f.options, provider: undefined, runtime: {
    ...f.options.runtime, scope() { reads++; assert.fail('public old provider must fail before scope or OS reads'); } } }), error => error.code === 'EXECUTION_UNSUPPORTED');
  assert.equal(reads, 0);
  assert.throws(() => createExecutionParentWorker({ ...f.options, runtime: {} }), error => error.code === 'EXECUTION_UNSUPPORTED');
});
test('scope mismatch and missing native actor cannot construct a guarded profile or borrow another store', t => {
  const f = fixture(t);
  for (const expectedScope of [{ ...f.options.expectedScope, state_root: join(f.root, 'other') },
    { ...f.options.expectedScope, multiplexer: { kind: 'namespace', key: 'other-native-server' } }])
    assert.throws(() => createExecutionParentWorker({ ...f.options, expectedScope }), error => error.code === 'EXECUTION_UNSUPPORTED');
  assert.throws(() => createExecutionParentWorker({ ...f.options, runtime: { ...f.options.runtime, actor: () => null } }), error => error.code === 'EXECUTION_UNSUPPORTED');
});
test('process-local worker joins the same store and native delivery evidence without enabling a queue producer or complete coverage', async t => {
  const f = fixture(t), worker = createExecutionParentWorker(f.options); await seed(f, worker);
  assert.equal(worker.store.directory, executionStoreDirectory(f.root, f.actual.multiplexer));
  assert.notEqual(worker.profile, f.options.profile); assert.equal(f.options.profile.delivery_admission, undefined);
  assert.equal(worker.relation_coverage, 'incomplete');
  let effects = 0;
  assert.equal(await worker.profile.delivery_admission.run(f.effect, async () => { effects++; return 'actual-native-emit'; }), 'actual-native-emit');
  assert.equal(effects, 1);
  await assert.rejects(worker.profile.delivery_admission.run({ ...f.effect, stage: 'queue' }, async () => { effects++; }), error => error.code === 'EXECUTION_UNSUPPORTED');
  assert.equal(effects, 1);
});
test('scope and participant capability are rechecked at the actual native boundary after preflight', async t => {
  for (const change of ['scope', 'contract', 'actor']) {
    const f = fixture(t), worker = createExecutionParentWorker(f.options); await seed(f, worker); let effects = 0;
    const result = await worker.native.run(id, 'emit', f.endpoint, async (_, issue) => {
      if (change === 'scope') f.actual.multiplexer.key = join(f.root, 'another-native.sock');
      else if (change === 'contract') f.options.provider.DELIVERY_ADMISSION_CONTRACT.serialized_required = false;
      else f.options.runtime.actor = () => ({ ...hook, started_identity: '2026-10-21T08:00:00Z' });
      issue(); effects++;
    }, f.effect.native_context);
    assert.equal(result.error.effect, 'not_started'); assert.equal(result.error.code, 'EXECUTION_UNSUPPORTED'); assert.equal(effects, 0);
    assert.equal((await worker.store.transaction(state => state.parent_effects, { readOnly: true })).length, 0);
  }
});
test('accepted hook alias supplements the original graph target without a fabricated cursor, source turn or raw metadata', async t => {
  const f = fixture(t), worker = createExecutionParentWorker(f.options); await seed(f, worker);
  const ctx = { ...f.effect.native_context, private_text: 'synthetic context must not persist' };
  assert.equal((await worker.native.run(id, 'emit', f.endpoint, async (_, issue) => { issue(); return 'emitted'; }, ctx)).value, 'emitted');
  const alias = await readAcceptedParentHookReference(worker.store, id);
  assert.deepEqual(alias, { schema: 'aiterm.parent-hook-reference.v1', target: A,
    native: { vendor: 'codex', session_id: thread, turn_id: 'native-turn', hook_event_name: null } });
  const state = await worker.store.transaction(state => structuredClone(state), { readOnly: true });
  assert.equal(state.records[0].relation.source.boundary, null);
  assert.equal(state.records[1].relation.target.boundary, null);
  assert.equal(state.records[1].relation.completion, 'open');
  assert.equal(JSON.stringify(state).includes(ctx.private_text), false);
});
test('issued aliases are not eligible until the real native receipt, and lost outcomes remain ineligible after reconstruction', async t => {
  for (const lost of [false, true]) {
    const f = fixture(t), worker = createExecutionParentWorker(f.options); await seed(f, worker);
    let release, entered; const ready = new Promise(resolve => { entered = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    const running = worker.native.run(id, 'emit', f.endpoint, async (_, issue) => {
      issue(); entered(); await pending;
      if (lost) throw Error('synthetic missing native receipt'); return 'emitted';
    }, f.effect.native_context);
    await ready; assert.equal(await readAcceptedParentHookReference(worker.store, id), null);
    release(); const result = await running;
    if (lost) {
      assert.equal(result.error.effect, 'possible');
      const reconstructed = createExecutionParentWorker(f.options);
      assert.equal(await readAcceptedParentHookReference(reconstructed.store, id), null);
    } else assert.equal((await readAcceptedParentHookReference(worker.store, id)).native.turn_id, 'native-turn');
  }
});
test('a generic resolver cannot infer aliases from similarly named native metadata', async t => {
  const f = fixture(t), worker = createExecutionParentWorker(f.options); await seed(f, worker);
  const generic = createParentNativeAdmission({ store: worker.store, actor: hook,
    observeSessionGenerationSync: f.observe, verifyParentEndpoint: () => true });
  assert.equal((await generic.run(id, 'emit', f.endpoint, async (_, issue) => { issue(); return 'accepted'; }, f.effect.native_context)).value, 'accepted');
  assert.equal(await readAcceptedParentHookReference(worker.store, id), null);
});
test('one native batch output retains separate aliases for every existing delivery without another graph ID', async t => {
  const f = fixture(t), worker = createExecutionParentWorker(f.options), parent = await seed(f, worker);
  const second = '00000000-0000-4000-8000-000000000003', first = await parent.lookup(id);
  await parent.bind(second, request, point(B, 17), f.endpoint, first.source_evidence);
  await parent.submit(second, f.endpoint, async (_, __, issue) => { issue(); return { queued_submission_id: 'second-native-queue' }; });
  let effects = 0;
  assert.equal((await worker.native.run([id, second], 'emit', f.endpoint, async (_, issue) => { issue(); effects++; return 'one-output'; }, f.effect.native_context)).value, 'one-output');
  assert.equal(effects, 1);
  assert.deepEqual(await readAcceptedParentHookReference(worker.store, id), await readAcceptedParentHookReference(worker.store, second));
  assert.deepEqual((await worker.store.transaction(state => state.parent_effects, { readOnly: true })).map(value => value.delivery_id), [id, second]);
});
test('retired or contradictory native references never revive history or select a different session/turn', async t => {
  for (const change of ['retired', 'contradictory']) {
    const f = fixture(t), worker = createExecutionParentWorker(f.options); await seed(f, worker);
    await worker.native.run(id, 'emit', f.endpoint, async (_, issue) => { issue(); return 'emitted'; }, f.effect.native_context);
    await worker.store.transaction(state => {
      if (change === 'retired') {
        const relation = state.records[1].relation;
        relation.completion = 'interrupted'; relation.target_fence = 'closed'; relation.lifecycle = 'retired';
      } else state.parent_effects[0].hook_reference.native = { vendor: 'claude', session_id: thread, tool_use_id: 'different-native-tool' };
    });
    if (change === 'retired') assert.equal(await readAcceptedParentHookReference(worker.store, id), null);
    else await assert.rejects(readAcceptedParentHookReference(worker.store, id), error => error.code === 'EXECUTION_UNCONFIRMED');
  }
});
