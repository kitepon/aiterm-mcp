import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileExecutionStore } from '../dist/execution-store.js';
import { ExecutionService } from '../dist/execution-service.js';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
import { createExecutionParentAdapter } from '../dist/execution-parent.js';
import { createParentSourceEvidence } from '../dist/execution-parent-source.js';
import { createParentQueueEndpointEvidence } from '../dist/execution-parent-queue.js';
import { createParentManagerExecution } from '../dist/execution-parent-manager.js';
import { ParentDeliveryManager } from '../dist/parent-delivery.js';
const A = { session_id: 'bot-a', launch_id: 'a'.repeat(32) }, B = { session_id: 'bot-b', launch_id: 'b'.repeat(32) };
const point = (launch, cursor = null) => ({ launch, boundary: cursor === null ? null
  : { event_cursor: cursor, operation_id: null, turn_id: null, steer_id: null } });
const id = '00000000-0000-4000-8000-000000000001', session = '00000000-0000-4000-8000-000000000002';
const actor = { pid: 202, started_identity: '2026-10-21T20:00:01Z' }, harness = { pid: 201, started_identity: '2026-10-21T20:00:00Z' };
const request = { kind: 'mcp', process_pid: actor.pid, process_started_identity: actor.started_identity,
  request_id: 91, tool: 'pty_send', target_session_id: B.session_id };
const until = async check => { const deadline = performance.now() + 1000; while (!check()) {
  assert.ok(performance.now() < deadline); await new Promise(done => setTimeout(done, 2));
} };
async function fixture(t, { accepted = true, ready = false, changeExecution } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'parent-recovery-')), store = new FileExecutionStore(join(root, 'graph'));
  const live = new Map([A, B].map(launch => [launch.session_id, structuredClone(launch)]));
  const observe = session_id => ({ schema: 'aiterm.pty-observe-result.v1', session_id,
    exists: live.has(session_id), launch_id: live.get(session_id)?.launch_id ?? null });
  const runtime = createExecutionRuntime({ sourceEnvironment: { AITERM_SESSION_ID: A.session_id, AITERM_AGENT_LAUNCH_ID: A.launch_id },
    observeSession: observe, observeSessionSync: observe,
    observeDone: async () => assert.fail('recovery must not create completion evidence'),
    guardedClose: async () => assert.fail('no close') });
  const service = new ExecutionService(store, runtime, 200);
  await service.execute({ action: 'register', source_session_id: A.session_id,
    reservation: { schema: 'aiterm.execution-reservation.v1', request, source: point(A),
      target: { session_id: B.session_id, expected_launch_id: B.launch_id } } });
  if (accepted) await service.invoke({ schema: 'aiterm.execution-ref.v1', request }, 'send', async () => ({ value: null, target: point(B, 17) }));
  const endpoint = { kind: 'claude', session_id: session, request_id: 'toolu_original', hook_root: join(root, 'hooks') };
  mkdirSync(join(endpoint.hook_root, endpoint.request_id), { recursive: true });
  const invocation = join(endpoint.hook_root, endpoint.request_id, 'request.json');
  writeFileSync(invocation, JSON.stringify({ request_id: endpoint.request_id, session_id: session, agent_id: null,
    parent_pid: harness.pid, parent_started_identity: harness.started_identity }));
  let nativeRows = [{ ...harness, parent_pid: 1 }, { ...actor, parent_pid: harness.pid }];
  const sourceEvidence = createParentSourceEvidence({ decode: () => assert.fail('recovery cannot decode a current request'),
    observeParentProcess: session_id => ({ schema: 'aiterm.execution-parent-process.v1', source: point(live.get(session_id) ?? A),
      harness: 'claude-code', harness_process: harness, processes: nativeRows }) });
  const verifyParentEndpoint = createParentQueueEndpointEvidence({ actor, sourceEvidence, claudeHookRoot: endpoint.hook_root });
  const adapter = createExecutionParentAdapter({ store, service, sourceEvidence, observeSessionGeneration: observe, verifyParentEndpoint });
  const proof = { schema: 'aiterm.parent-source.v1', request, source: point(A), client_name: 'claude-code',
    mcp_process: actor, harness_process: harness, endpoint: { vendor: 'claude', session_id: session, request_id: endpoint.request_id } };
  const child = point(B, 17); child.boundary.operation_id = 'sha256:' + '1'.repeat(64);
  await adapter.bind(id, request, child, endpoint, proof);
  writeFileSync(join(endpoint.hook_root, endpoint.request_id, 'delivery.json'), JSON.stringify({ delivery_id: id }));
  let watched = 0, submissions = 0, legacyChecks = 0;
  const execution = { captureEndpointEvidence() { assert.fail('no proof recapture'); }, bind: () => assert.fail('no recovery bind'),
    verifyRecovery: (...args) => adapter.verifyRecovery(...args), async submit() { submissions++; return { queued_submission_id: 'synthetic-queue' }; } };
  changeExecution?.(execution);
  const managerRoot = join(root, 'manager');
  const manager = new ParentDeliveryManager({ root: managerRoot, execution, dependencies: {
    processes: () => [{ pid: process.pid, started_identity: 'synthetic-manager' }], exists: () => false,
    verify: async () => { legacyChecks++; assert.fail('no static endpoint verification in private recovery'); },
    observe: async (_session, options) => { watched++; return new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(Error('synthetic cleanup')), { once: true })); },
    answer: async () => assert.fail('no answer extraction during recovery') } });
  await manager.recover();
  t.after(async () => { await manager.close(); rmSync(root, { recursive: true, force: true }); });
  const record = { schema: 'aiterm.parent-delivery.v1', delivery_id: id, created_at: '2026-10-21T20:00:00Z', updated_at: '2026-10-21T20:00:00Z',
    parent: endpoint, boundary: { session_id: B.session_id, launch_id: B.launch_id, vendor: 'claude', harness: 'claude-code',
      event_cursor: 17, operation_id: child.boundary.operation_id }, state: ready ? 'ready' : 'waiting',
    text: ready ? 'original saved answer' : null, child_outcome: ready ? 'done' : null, child_turn_id: ready ? 'original-native-turn' : null,
    error: null, queued_submission_id: null, execution: { request, source_evidence: proof } };
  const stage = (value = record) => {
    const directory = join(managerRoot, 'active', 'synthetic-old-owner'); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'owner.json'), JSON.stringify({ pid: 44444, started_identity: 'synthetic-old', closed: true, removal_safe: true }));
    writeFileSync(join(directory, id + '.json'), JSON.stringify(value));
  };
  const diagnostic = () => JSON.parse(readFileSync(join(managerRoot, 'results', id + '.json')));
  return { root, store, service, adapter, endpoint, proof, child, record, stage, manager, diagnostic, live, execution,
    invocation, setRows: rows => { nativeRows = rows; }, counts: () => ({ watched, submissions, legacyChecks }) };
}
test('private recovery joins original accepted receipt and stronger before_send boundary read-only without canonical alias upgrades', async t => {
  const f = await fixture(t), file = join(f.root, 'graph', 'relations.json'), before = readFileSync(file, 'utf8');
  f.stage(); await f.manager.recover();
  assert.deepEqual(f.counts(), { watched: 1, submissions: 0, legacyChecks: 0 });
  assert.equal(readFileSync(file, 'utf8'), before);
  const status = await f.service.execute({ action: 'status', request });
  assert.deepEqual(status.relation.target, point(B, 17)); assert.equal(status.relation.target.boundary.turn_id, null);
  assert.equal(status.relation.completion, 'open'); assert.equal(status.relation.target_fence, 'open');
});
test('owner reference, boundary, endpoint and proof substitutions remain unknown without reconstructing the graph', async t => {
  const changes = [r => { r.execution.request.request_id++; r.execution.source_evidence.request.request_id++; },
    r => { r.boundary.event_cursor++; }, r => { r.boundary.operation_id = null; },
    r => { r.parent.request_id = 'toolu_other'; }, r => { r.execution.source_evidence.mcp_process.pid++; },
    r => { delete r.execution.source_evidence; }, r => { delete r.execution; }];
  for (const change of changes) {
    const f = await fixture(t); const record = structuredClone(f.record); change(record);
    const before = readFileSync(join(f.root, 'graph', 'relations.json'), 'utf8');
    f.stage(record); await f.manager.recover();
    assert.equal(f.diagnostic().state, 'unknown'); assert.deepEqual(f.diagnostic().execution, record.execution);
    assert.deepEqual(f.counts(), { watched: 0, submissions: 0, legacyChecks: 0 });
    assert.equal(readFileSync(join(f.root, 'graph', 'relations.json'), 'utf8'), before);
  }
});
test('unaccepted, preparing, issued and unknown original sends cannot recover waiting or ready from a local done body', async t => {
  for (const phase of ['not_sent', 'preparing', 'issued', 'unknown']) {
    const f = await fixture(t, { accepted: false, ready: true });
    await f.store.transaction(state => { state.records[0].operations.send = phase; });
    f.stage(); await f.manager.recover(); const saved = f.diagnostic();
    assert.equal(saved.state, 'unknown'); assert.equal(saved.text, 'original saved answer'); assert.equal(saved.child_outcome, 'done');
    assert.equal(saved.child_turn_id, 'original-native-turn'); assert.deepEqual(saved.execution, f.record.execution);
    assert.deepEqual(f.counts(), { watched: 0, submissions: 0, legacyChecks: 0 });
  }
});
test('missing graph rejects before watchers, remains unavailable on store reconstruction and never generates empty state', async t => {
  const f = await fixture(t); f.stage(); rmSync(join(f.root, 'graph', 'relations.json')); await f.manager.recover();
  assert.equal(f.diagnostic().state, 'unknown'); assert.deepEqual(f.counts(), { watched: 0, submissions: 0, legacyChecks: 0 });
  const next = new FileExecutionStore(join(f.root, 'graph')); let calls = 0;
  await assert.rejects(next.transaction(() => { calls++; }), error => error.code === 'EXECUTION_STATE_UNAVAILABLE');
  assert.equal(calls, 0); assert.equal(existsSync(join(f.root, 'graph', 'relations.json')), false);
});
test('generation, native actor and current hook owner loss reject recovery using only the old source proof', async t => {
  for (const change of [f => f.live.set(A.session_id, { ...A, launch_id: 'e'.repeat(32) }),
    f => f.live.delete(B.session_id), f => f.setRows([{ ...harness, parent_pid: 1 }]),
    f => writeFileSync(f.invocation, JSON.stringify({ request_id: f.endpoint.request_id, session_id: session, agent_id: null,
      parent_pid: 999, parent_started_identity: 'different-harness' }))]) {
    const f = await fixture(t); change(f); f.stage(); await f.manager.recover();
    assert.equal(f.diagnostic().state, 'unknown'); assert.deepEqual(f.diagnostic().execution.source_evidence, f.proof);
    assert.deepEqual(f.counts(), { watched: 0, submissions: 0, legacyChecks: 0 });
  }
});
test('existing return reservation never becomes replay permission from a ready owner record', async t => {
  const f = await fixture(t, { ready: true });
  await f.service.execute({ action: 'register', source_session_id: A.session_id,
    reservation: { schema: 'aiterm.execution-reservation.v1',
      request: { kind: 'delivery', delivery_id: id, target_session_id: A.session_id }, source: point(A),
      target: { session_id: A.session_id, expected_launch_id: A.launch_id } } });
  f.stage(); await f.manager.recover(); assert.equal(f.diagnostic().state, 'unknown');
  assert.equal(f.diagnostic().text, f.record.text); assert.equal(f.counts().submissions, 0);
});
test('pending admission is invisible to beforeChange capture and a stop during read rejects before watching', async t => {
  let enter, release; const entered = new Promise(done => { enter = done; }), resume = new Promise(done => { release = done; });
  const f = await fixture(t, { changeExecution(execution) {
    const verify = execution.verifyRecovery;
    execution.verifyRecovery = async (...args) => { enter(); await resume; return verify(...args); };
  } });
  f.stage(); const recovering = f.manager.recover(); await entered;
  await f.manager.beforeChange(B.session_id);
  assert.equal(f.counts().watched, 0);
  await f.store.transaction(state => { state.stopping.push(A); }); release(); await recovering;
  assert.equal(f.diagnostic().state, 'unknown'); assert.deepEqual(f.counts(), { watched: 0, submissions: 0, legacyChecks: 0 });
});
test('private manager requires exact true recovery acknowledgement; missing or truthy callbacks retain saved ready evidence', async t => {
  for (const callback of [undefined, async () => undefined, async () => ({ accepted: true })]) {
    const f = await fixture(t, { ready: true, changeExecution(execution) { execution.verifyRecovery = callback; } });
    f.stage(); await f.manager.recover(); assert.equal(f.diagnostic().state, 'unknown');
    assert.equal(f.diagnostic().text, f.record.text); assert.equal(f.counts().submissions, 0);
  }
});
test('factory forwards recovery to the same selected adapter without recapturing current ingress or invoking native admission', async () => {
  let count = 0;
  const provider = { DELIVERY_ADMISSION_CONTRACT: { schema: 'steer.delivery-admission.v1', native_context: true,
    cursor_profile_parameter: true, serialized_required: true, multi_delivery_emit: true }, withDeliveryEffect() {} };
  const args = [id, request, point(B, 17), { thread_id: session, codex_home: '/synthetic' }, { original: true }];
  const execution = createParentManagerExecution({ profile: {}, provider, native: {}, parent: {
    async verifyRecovery(...actual) { count++; assert.deepEqual(actual, args); return true; },
    captureEndpointEvidence() { assert.fail('no fresh capture'); } } });
  assert.equal(await execution.verifyRecovery(...args), true); assert.equal(count, 1);
});

test('ready recovery validates saved receipt without interpreting body or local done as native completion', async t => {
  const f = await fixture(t, { ready: true }), file = join(f.root, 'graph', 'relations.json'), before = readFileSync(file, 'utf8');
  f.stage(); await f.manager.recover(); await until(() => f.manager.status(B.session_id)[0]?.state === 'submitted');
  assert.deepEqual(f.counts(), { watched: 0, submissions: 1, legacyChecks: 0 });
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(f.diagnostic().text, 'original saved answer');
  const status = await f.service.execute({ action: 'status', request });
  assert.equal(status.relation.completion, 'open'); assert.equal(status.relation.target_fence, 'open');
});

test('a different canonical accepted cursor or retired original branch cannot authorize recovery of the old owner', async t => {
  for (const change of [record => { record.relation.target.boundary.event_cursor = 18; },
    record => { record.relation.completion = 'completed'; record.relation.target_fence = 'closed'; record.relation.lifecycle = 'retired'; }]) {
    const f = await fixture(t); await f.store.transaction(state => { change(state.records[0]); });
    f.stage(); await f.manager.recover(); assert.equal(f.diagnostic().state, 'unknown');
    assert.equal(f.diagnostic().boundary.event_cursor, 17); assert.equal(f.counts().watched, 0);
  }
});
