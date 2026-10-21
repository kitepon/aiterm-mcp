import './seat-env.mjs';
import test from 'node:test';
// These integration cases require the private POSIX file/directory checkpoint.
const posixCheckpoint = process.platform === 'win32' ? 'private native graph requires POSIX directory fsync' : false;
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileExecutionStore } from '../dist/execution-store.js';
import { ExecutionService } from '../dist/execution-service.js';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
import { createHash } from 'node:crypto';
import { createClaudeParentRecordDiagnosis } from '../dist/execution-parent-claude-records.js';
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
async function fixture(t, { accepted = true, ready = false, changeExecution, actorObserver, recordDiagnosis } = {}) {
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
  const endpoint = { kind: 'claude', session_id: session, request_id: 'toolu_original', hook_root: join(root, recordDiagnosis === true ? 'claude-parent-hooks' : 'hooks') };
  mkdirSync(join(endpoint.hook_root, endpoint.request_id), { recursive: true });
  const invocation = join(endpoint.hook_root, endpoint.request_id, 'request.json');
  writeFileSync(invocation, JSON.stringify({ request_id: endpoint.request_id, session_id: session, agent_id: null,
    parent_pid: harness.pid, parent_started_identity: harness.started_identity }));
  let nativeRows = [{ ...harness, parent_pid: 1 }, { ...actor, parent_pid: harness.pid }];
  const sourceEvidence = createParentSourceEvidence({ decode: () => assert.fail('recovery cannot decode a current request'),
    observeParentProcess: session_id => ({ schema: 'aiterm.execution-parent-process.v1', source: point(live.get(session_id) ?? A),
      harness: 'claude-code', harness_process: harness, processes: nativeRows }) });
  const verifyParentEndpoint = createParentQueueEndpointEvidence({ actor, sourceEvidence, claudeHookRoot: endpoint.hook_root });
  const adapter = createExecutionParentAdapter({ store, service, sourceEvidence, observeSessionGeneration: observe, verifyParentEndpoint,
    diagnoseClaudeRecords: recordDiagnosis === true ? createClaudeParentRecordDiagnosis({ stateRoot: root, assertScope() {} }) : recordDiagnosis,
    observeActors: pids => actorObserver ? actorObserver(pids) : nativeRows.filter(row => pids.includes(row.pid)).map(({ pid, started_identity }) => ({ pid, started_identity })) });
  const proof = { schema: 'aiterm.parent-source.v1', request, source: point(A), client_name: 'claude-code',
    mcp_process: actor, harness_process: harness, endpoint: { vendor: 'claude', session_id: session, request_id: endpoint.request_id } };
  const child = point(B, 17); child.boundary.operation_id = 'sha256:' + '1'.repeat(64);
  await adapter.bind(id, request, child, endpoint, proof);
  writeFileSync(join(endpoint.hook_root, endpoint.request_id, 'delivery.json'), JSON.stringify({ delivery_id: id }));
  let watched = 0, submissions = 0, legacyChecks = 0;
  const execution = { captureEndpointEvidence() { assert.fail('no proof recapture'); }, bind: () => assert.fail('no recovery bind'),
    verifyRecovery: (...args) => adapter.verifyRecovery(...args), diagnoseClaim: (...args) => adapter.diagnoseClaim(...args), async submit() { submissions++; return { queued_submission_id: 'synthetic-queue' }; } };
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
test('private recovery joins original accepted receipt and stronger before_send boundary read-only without canonical alias upgrades', { skip: posixCheckpoint }, async t => {
  const f = await fixture(t), file = join(f.root, 'graph', 'relations.json'), before = readFileSync(file, 'utf8');
  f.stage(); await f.manager.recover();
  assert.deepEqual(f.counts(), { watched: 1, submissions: 0, legacyChecks: 0 });
  assert.equal(readFileSync(file, 'utf8'), before);
  const status = await f.service.execute({ action: 'status', request });
  assert.deepEqual(status.relation.target, point(B, 17)); assert.equal(status.relation.target.boundary.turn_id, null);
  assert.equal(status.relation.completion, 'open'); assert.equal(status.relation.target_fence, 'open');
});
test('owner reference, boundary, endpoint and proof substitutions remain unknown without reconstructing the graph', { skip: posixCheckpoint }, async t => {
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
test('unaccepted, preparing, issued and unknown original sends cannot recover waiting or ready from a local done body', { skip: posixCheckpoint }, async t => {
  for (const phase of ['not_sent', 'preparing', 'issued', 'unknown']) {
    const f = await fixture(t, { accepted: false, ready: true });
    await f.store.transaction(state => { state.records[0].operations.send = phase; });
    f.stage(); await f.manager.recover(); const saved = f.diagnostic();
    assert.equal(saved.state, 'unknown'); assert.equal(saved.text, 'original saved answer'); assert.equal(saved.child_outcome, 'done');
    assert.equal(saved.child_turn_id, 'original-native-turn'); assert.deepEqual(saved.execution, f.record.execution);
    assert.deepEqual(f.counts(), { watched: 0, submissions: 0, legacyChecks: 0 });
  }
});
test('missing graph rejects before watchers, remains unavailable on store reconstruction and never generates empty state', { skip: posixCheckpoint }, async t => {
  const f = await fixture(t); f.stage(); rmSync(join(f.root, 'graph', 'relations.json')); await f.manager.recover();
  assert.equal(f.diagnostic().state, 'unknown'); assert.deepEqual(f.counts(), { watched: 0, submissions: 0, legacyChecks: 0 });
  const next = new FileExecutionStore(join(f.root, 'graph')); let calls = 0;
  await assert.rejects(next.transaction(() => { calls++; }), error => error.code === 'EXECUTION_STATE_UNAVAILABLE');
  assert.equal(calls, 0); assert.equal(existsSync(join(f.root, 'graph', 'relations.json')), false);
});
test('generation, native actor and current hook owner loss reject recovery using only the old source proof', { skip: posixCheckpoint }, async t => {
  for (const change of [f => f.live.set(A.session_id, { ...A, launch_id: 'e'.repeat(32) }),
    f => f.live.delete(B.session_id), f => f.setRows([{ ...harness, parent_pid: 1 }]),
    f => writeFileSync(f.invocation, JSON.stringify({ request_id: f.endpoint.request_id, session_id: session, agent_id: null,
      parent_pid: 999, parent_started_identity: 'different-harness' }))]) {
    const f = await fixture(t); change(f); f.stage(); await f.manager.recover();
    assert.equal(f.diagnostic().state, 'unknown'); assert.deepEqual(f.diagnostic().execution.source_evidence, f.proof);
    assert.deepEqual(f.counts(), { watched: 0, submissions: 0, legacyChecks: 0 });
  }
});
test('existing return reservation never becomes replay permission from a ready owner record', { skip: posixCheckpoint }, async t => {
  const f = await fixture(t, { ready: true });
  await f.service.execute({ action: 'register', source_session_id: A.session_id,
    reservation: { schema: 'aiterm.execution-reservation.v1',
      request: { kind: 'delivery', delivery_id: id, target_session_id: A.session_id }, source: point(A),
      target: { session_id: A.session_id, expected_launch_id: A.launch_id } } });
  f.stage(); await f.manager.recover(); assert.equal(f.diagnostic().state, 'unknown');
  assert.equal(f.diagnostic().text, f.record.text); assert.equal(f.counts().submissions, 0);
});
test('pending admission is invisible to beforeChange capture and a stop during read rejects before watching', { skip: posixCheckpoint }, async t => {
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
test('private manager requires exact true recovery acknowledgement; missing or truthy callbacks retain saved ready evidence', { skip: posixCheckpoint }, async t => {
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

test('ready recovery validates saved receipt without interpreting body or local done as native completion', { skip: posixCheckpoint }, async t => {
  const f = await fixture(t, { ready: true }), file = join(f.root, 'graph', 'relations.json'), before = readFileSync(file, 'utf8');
  f.stage(); await f.manager.recover(); await until(() => f.manager.status(B.session_id)[0]?.state === 'submitted');
  assert.deepEqual(f.counts(), { watched: 0, submissions: 1, legacyChecks: 0 });
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(f.diagnostic().text, 'original saved answer');
  const status = await f.service.execute({ action: 'status', request });
  assert.equal(status.relation.completion, 'open'); assert.equal(status.relation.target_fence, 'open');
});

test('a different canonical accepted cursor or retired original branch cannot authorize recovery of the old owner', { skip: posixCheckpoint }, async t => {
  for (const change of [record => { record.relation.target.boundary.event_cursor = 18; },
    record => { record.relation.completion = 'completed'; record.relation.target_fence = 'closed'; record.relation.lifecycle = 'retired'; }]) {
    const f = await fixture(t); await f.store.transaction(state => { change(state.records[0]); });
    f.stage(); await f.manager.recover(); assert.equal(f.diagnostic().state, 'unknown');
    assert.equal(f.diagnostic().boundary.event_cursor, 17); assert.equal(f.counts().watched, 0);
  }
});

const diagnose = f => f.adapter.diagnoseClaim(id, request, f.child, f.endpoint, f.proof);
const enrollForDiagnosis = f => f.store.transaction(state => { state.participants.push({ actor, roles: ['mcp', 'parent_producer'] }); });
const stageClaim = f => { f.stage(); writeFileSync(join(f.root, 'manager', 'claims', B.session_id + '.json'), JSON.stringify(f.record)); };

test('claim diagnosis reads original accepted cursor and exact actor without upgrading receipt, native fence or clearance', { skip: posixCheckpoint }, async t => {
  const pids = [], f = await fixture(t, { actorObserver(ids) { pids.push([...ids]); return ids.map(pid => ({ pid, started_identity: actor.started_identity })); } });
  await enrollForDiagnosis(f);
  const file = join(f.root, 'graph', 'relations.json'), before = readFileSync(file, 'utf8');
  const result = await diagnose(f);
  assert.equal(result.binding, 'matched'); assert.equal(result.original.input, 'receipt_recorded');
  assert.deepEqual(result.original.target, point(B, 17)); assert.equal(result.original.target.boundary.turn_id, null);
  assert.equal(result.native_endpoint, 'not_observed'); assert.equal(result.native_fence, 'unknown');
  assert.equal(result.clearance, 'retained'); assert.equal(result.retry, 'none');
  assert.equal(result.inventory.participant_discovery, 'unproven'); assert.equal(result.inventory.relation_coverage, 'incomplete');
  assert.equal(result.inventory.participants[0].native_identity, 'matched'); assert.deepEqual(pids, [[actor.pid]]);
  result.original.target.boundary.event_cursor = 999;
  assert.equal(readFileSync(file, 'utf8'), before); assert.equal(f.counts().watched, 0);
});

test('only explicit unsent/not_sent metadata distinguishes recorded non-issuance; preparing/issued/unknown and merely reserved do not', { skip: posixCheckpoint }, async t => {
  for (const phase of ['not_issued', 'preparing', 'issued', 'unknown', 'not_sent']) {
    const f = await fixture(t, { accepted: false });
    await f.store.transaction(state => { state.records[0].operations.send = phase; if (phase === 'not_sent') state.records[0].relation.phase = 'unsent'; });
    const result = await diagnose(f);
    assert.equal(result.original.input, phase === 'not_sent' ? 'not_sent_recorded' : 'unconfirmed');
    assert.equal(result.returning, null); assert.ok(result.missing.includes('return_request_unrecorded'));
    assert.equal(result.clearance, 'retained'); assert.equal(result.native_fence, 'unknown');
  }
});

test('lost binding never becomes inferred correspondence; matching unsent source metadata remains a diagnostic fact only', { skip: posixCheckpoint }, async t => {
  const f = await fixture(t, { accepted: false });
  await f.store.transaction(state => { state.parent_deliveries = []; state.records[0].operations.send = 'not_sent'; state.records[0].relation.phase = 'unsent'; });
  const result = await diagnose(f);
  assert.equal(result.binding, 'missing'); assert.equal(result.original.input, 'not_sent_recorded');
  assert.ok(result.missing.includes('binding_missing')); assert.equal(result.clearance, 'retained');
  assert.equal((await f.store.transaction(state => state.parent_deliveries, { readOnly: true })).length, 0);
});

test('existing mismatched source proof, request, cursor or endpoint cannot pick another latest record or actor', { skip: posixCheckpoint }, async t => {
  const f = await fixture(t); await enrollForDiagnosis(f);
  for (const args of [[id, { ...request, request_id: 92 }, f.child, f.endpoint, f.proof],
    [id, request, point(B, 18), f.endpoint, f.proof], [id, request, f.child, { ...f.endpoint, request_id: 'toolu_changed' }, f.proof],
    [id, request, f.child, f.endpoint, undefined]]) {
    const result = await f.adapter.diagnoseClaim(...args);
    assert.notEqual(result.binding, 'matched'); assert.ok(result.original === null || result.original.input === 'unconfirmed');
    assert.equal(result.clearance, 'retained'); assert.equal(result.retry, 'none');
  }
  await f.store.transaction(state => { state.records[0].source.point = point({ ...A, launch_id: 'e'.repeat(32) }); });
  const inconsistent = await diagnose(f);
  assert.equal(inconsistent.original.input, 'unconfirmed');
  assert.ok(inconsistent.missing.includes('original_correspondence_unconfirmed'));
});

test('same-name replacement slots are excluded while exact or generation-missing slots and orphan effects remain visible', { skip: posixCheckpoint }, async t => {
  const f = await fixture(t); await enrollForDiagnosis(f);
  await f.store.transaction(state => {
    state.slots.push({ session_id: B.session_id, expected_launch_id: B.launch_id, stage: 'send', state: 'unknown', request },
      { session_id: B.session_id, expected_launch_id: null, stage: 'configure', state: 'unknown', request: null },
      { session_id: B.session_id, expected_launch_id: 'e'.repeat(32), stage: 'send', state: 'issued', request: null });
    state.parent_effects.push({ delivery_id: id, stage: 'emit', state: 'unknown', actor: { pid: 303, started_identity: '2026-10-21T20:00:03Z' } });
  });
  const result = await diagnose(f);
  assert.equal(result.slots.length, 2); assert.equal(result.parent_effects.length, 1);
  assert.equal(result.parent_effects[0].actor.pid, 303); assert.ok(result.missing.includes('related_slots_present'));
  assert.ok(result.missing.includes('native_actor_inventory_incomplete'));
  assert.equal(result.original.input, 'receipt_recorded'); assert.equal(result.clearance, 'retained');
});

test('source PID absent, reused or async observations stay unavailable and never imply completion or current caller substitution', { skip: posixCheckpoint }, async t => {
  for (const actorObserver of [() => [], () => [{ pid: actor.pid, started_identity: '2026-10-21T20:01:00Z' }],
    () => Promise.reject(Error('synthetic asynchronous native probe missing'))]) {
    const f = await fixture(t, { actorObserver }); await enrollForDiagnosis(f); const result = await diagnose(f);
    assert.notEqual(result.inventory.participants[0].native_identity, 'matched');
    assert.ok(result.missing.includes('native_actor_inventory_incomplete')); assert.equal(result.native_fence, 'unknown');
    assert.equal(result.clearance, 'retained'); assert.equal(result.original.input, 'receipt_recorded');
  }
});

test('local ready/done state and source actor status do not replace the original missing receipt or create a parent return', { skip: posixCheckpoint }, async t => {
  const f = await fixture(t, { accepted: false, ready: true }); await enrollForDiagnosis(f); stageClaim(f);
  const claimFile = join(f.root, 'manager', 'claims', B.session_id + '.json'), before = readFileSync(claimFile, 'utf8');
  const result = await f.manager.diagnoseClaim(B.session_id);
  assert.equal(result.owner_record, 'matched'); assert.equal(result.record_state, 'ready');
  assert.equal(result.original_storage_owner, 'unproven'); assert.equal(result.graph.original.input, 'unconfirmed');
  assert.equal(result.graph.returning, null); assert.equal(result.clearance, 'retained');
  assert.equal(JSON.stringify(result).includes('original saved answer'), false);
  assert.equal(readFileSync(claimFile, 'utf8'), before); assert.equal(f.counts().submissions, 0);
});

test('diagnosis remains read-only after service failure and reports graph loss without clearing the claim or bootstrapping state', { skip: posixCheckpoint }, async t => {
  const f = await fixture(t); stageClaim(f);
  f.manager.serviceError = Error('synthetic existing checkpoint failure');
  const claimFile = join(f.root, 'manager', 'claims', B.session_id + '.json'), before = readFileSync(claimFile, 'utf8');
  rmSync(join(f.root, 'graph', 'relations.json'));
  const result = await f.manager.diagnoseClaim(B.session_id);
  assert.equal(result.graph, null); assert.equal(result.graph_error, 'EXECUTION_STATE_UNAVAILABLE');
  assert.equal(result.clearance, 'retained'); assert.equal(readFileSync(claimFile, 'utf8'), before);
  assert.equal(existsSync(join(f.root, 'graph', 'relations.json')), false);
  await assert.rejects(f.manager.beforeChange(B.session_id), /synthetic existing checkpoint failure/);
});

test('missing, duplicate or mismatched owner records and adapter absence stay explicit and never use the current manager as origin', { skip: posixCheckpoint }, async t => {
  for (const change of ['missing', 'mismatch', 'duplicate', 'adapter']) {
    const f = await fixture(t, { ready: true }); stageClaim(f);
    const oldFile = join(f.root, 'manager', 'active', 'synthetic-old-owner', id + '.json');
    if (change === 'missing') rmSync(oldFile);
    if (change === 'mismatch') { const record = structuredClone(f.record); record.boundary.event_cursor = 18; writeFileSync(oldFile, JSON.stringify(record)); }
    if (change === 'duplicate') writeFileSync(join(f.root, 'manager', 'results', id + '.json'), JSON.stringify(f.record));
    if (change === 'adapter') f.execution.diagnoseClaim = undefined;
    const result = await f.manager.diagnoseClaim(B.session_id);
    assert.equal(result.original_storage_owner, 'unproven'); assert.equal(result.clearance, 'retained');
    if (change !== 'adapter') assert.equal(result.owner_record, 'unconfirmed');
    else { assert.equal(result.graph, null); assert.ok(result.missing.includes('execution_diagnosis_unavailable')); }
    assert.equal(JSON.stringify(result).includes('original saved answer'), false); assert.equal(f.counts().watched, 0);
  }
});

test('parent return uses the same canonical child receipt and distinguishes accepted from explicit unsent without a fence upgrade', { skip: posixCheckpoint }, async t => {
  for (const sent of [true, false]) {
    const f = await fixture(t); let issued = 0;
    const reply = await f.adapter.submit(id, f.endpoint, async (_binding, _endpoint, issue) => {
      if (!sent) throw Error('synthetic pre-effect refusal'); issue(); issued++; return { queued_submission_id: 'existing-synthetic-queue-receipt' };
    });
    assert.equal(!!reply.isError, !sent); assert.equal(issued, sent ? 1 : 0);
    const result = await diagnose(f);
    assert.equal(result.returning.input, sent ? 'receipt_recorded' : 'not_sent_recorded');
    assert.equal(result.original.input, 'receipt_recorded'); assert.deepEqual(result.original.target, point(B, 17));
    assert.equal(result.native_fence, 'unknown'); assert.equal(result.clearance, 'retained');
    assert.equal(result.parent_effects.length, 0);
  }
});

test('private diagnosis rejects a path or different child before callback and probes no unrelated declared actors', { skip: posixCheckpoint }, async t => {
  const observed = [], f = await fixture(t, { actorObserver(pids) { observed.push(pids); return pids.map(pid => ({ pid, started_identity: actor.started_identity })); } });
  await enrollForDiagnosis(f);
  await f.store.transaction(state => { state.participants.push({ actor: { pid: 909, started_identity: '2026-10-21T20:00:09Z' }, roles: ['mcp'] }); });
  stageClaim(f);
  for (const invalid of ['../bot-b', 'bot.b']) await assert.rejects(f.manager.diagnoseClaim(invalid));
  writeFileSync(join(f.root, 'manager', 'claims', 'bot-c.json'), JSON.stringify(f.record));
  await assert.rejects(f.manager.diagnoseClaim('bot-c'), error => error.code === 'EXECUTION_CONFLICT');
  assert.equal(observed.length, 0);
  const result = await f.manager.diagnoseClaim(B.session_id); assert.equal(result.owner_record, 'matched');
  assert.deepEqual(observed, [[actor.pid]]); assert.equal(result.graph.inventory.participants.length, 1);
});


test('manager claim diagnosis joins real stored Claude invocation and named Stop/result through the accepted original graph receipt without finishing the branch', { skip: posixCheckpoint }, async t => {
  const f = await fixture(t, { recordDiagnosis: true }); stageClaim(f);
  mkdirSync(join(f.root, 'agents'));
  const stem = join(f.root, 'agents', B.session_id + '.' + B.launch_id), text = 'synthetic child result, excluded from diagnostics';
  const digest = createHash('sha256').update(text).digest('hex'), resultBytes = Buffer.byteLength(text);
  writeFileSync(stem + '.agent.json', JSON.stringify({ kind: 'claude', aiterm_session: B.session_id, launch_id: B.launch_id,
    vendor_session_id: session, event_file: stem + '.events.jsonl', result_file: stem + '.claude-result.json' }));
  const prefix = JSON.stringify({ type: 'prior' }) + '\n'; assert.equal(Buffer.byteLength(prefix), 17);
  writeFileSync(stem + '.events.jsonl', prefix + JSON.stringify({ type: 'agent_done', vendor: 'claude', aiterm_session: B.session_id,
    launch_id: B.launch_id, vendor_session_id: session, turn_id: null, operation_id: f.child.boundary.operation_id,
    reason: 'Stop', done_status: 'turn_done', result_digest: digest, result_bytes: resultBytes }) + '\n');
  writeFileSync(stem + '.claude-result.json', JSON.stringify({ schema: 'aiterm.claude-turn-result.v2', operation_id: f.child.boundary.operation_id,
    vendor_session_id: session, result_digest: digest, result_bytes: resultBytes, text }));
  const graphFile = join(f.root, 'graph', 'relations.json'), claimFile = join(f.root, 'manager', 'claims', B.session_id + '.json');
  const beforeGraph = readFileSync(graphFile, 'utf8'), beforeClaim = readFileSync(claimFile, 'utf8');
  const value = await f.manager.diagnoseClaim(B.session_id);
  assert.equal(value.graph.claude_records.child_stop, 'recorded'); assert.equal(value.graph.claude_records.parent_invocation, 'matched');
  assert.equal(value.graph.native_fence, 'unknown'); assert.equal(value.graph.claude_records.interruption, 'unconfirmed');
  assert.equal(value.graph.claude_records.session_preserved, 'unconfirmed'); assert.equal(value.clearance, 'retained');
  assert.deepEqual(value.graph.original.target, point(B, 17), 'canonical operation and turn stay null');
  assert.equal(JSON.stringify(value).includes(text), false); assert.equal(readFileSync(graphFile, 'utf8'), beforeGraph);
  assert.equal(readFileSync(claimFile, 'utf8'), beforeClaim); assert.deepEqual(f.counts(), { watched: 0, submissions: 0, legacyChecks: 0 });
});

test('graph refuses file correlation for unaccepted send, source/binding/cursor mismatch or an unrelated locally completed result', { skip: posixCheckpoint }, async t => {
  for (const mode of ['unaccepted', 'source', 'binding', 'cursor']) {
    const f = await fixture(t, { recordDiagnosis: () => assert.fail('unverified original graph may not select Claude records') });
    await f.store.transaction(state => {
      if (mode === 'unaccepted') state.records[0].operations.send = 'unknown';
      if (mode === 'source') state.records[0].source.status = 'unknown';
      if (mode === 'binding') state.parent_deliveries[0].endpoint_digest = 'f'.repeat(64);
      if (mode === 'cursor') state.records[0].relation.target.boundary.event_cursor++;
    });
    const result = await diagnose(f); assert.equal(result.claude_records, null); assert.equal(result.native_fence, 'unknown');
    assert.equal(result.clearance, 'retained');
  }
});

test('async, thrown or proof-upgrading injected record diagnosis cannot certify native interruption or replace the accepted receipt', { skip: posixCheckpoint }, async t => {
  for (const observer of [() => Promise.resolve({ child_stop: 'recorded' }), () => Promise.reject(Error('synthetic delayed read')),
    () => { throw Error('synthetic unavailable records'); }, () => ({ parent_invocation: 'matched', delivery_binding: 'matched',
      child_stop: 'recorded', missing: [], native_input: 'confirmed', interruption: 'interrupted', session_preserved: 'confirmed',
      native_fence: 'closed', clearance: 'released', retry: 'allowed' })]) {
    const f = await fixture(t, { recordDiagnosis: observer }); const before = readFileSync(join(f.root, 'graph', 'relations.json'), 'utf8');
    const result = await diagnose(f); assert.equal(result.claude_records, null); assert.equal(result.original.input, 'receipt_recorded');
    assert.ok(result.missing.includes('claude_records_diagnosis_unavailable')); assert.equal(result.native_fence, 'unknown');
    assert.equal(readFileSync(join(f.root, 'graph', 'relations.json'), 'utf8'), before);
  }
});
