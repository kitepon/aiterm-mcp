import './seat-env.mjs';
import test from 'node:test';
// These integration cases require the private POSIX file/directory checkpoint.
const posixCheckpoint = process.platform === 'win32' ? 'private native graph requires POSIX directory fsync' : false;
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { emptyExecutionState, FileExecutionStore, executionStateSchema } from '../dist/execution-store.js';
import { ParticipantExecutionStore } from '../dist/execution-participant-store.js';
import { executionParticipantInventory } from '../dist/execution-inventory.js';
import { ExecutionService } from '../dist/execution-service.js';
import { planCascadeStop } from '../dist/execution-contract.js';

const old = { pid: 47, started_identity: '2026-10-21T11:00:00Z' };
const replacement = { ...old, started_identity: '2026-10-21T12:00:00Z' };
const hook = { pid: 49, started_identity: '2026-10-21T11:00:02Z' };
const A = { session_id: 'inventory-a', launch_id: 'a'.repeat(32) }, B = { session_id: 'inventory-b', launch_id: 'b'.repeat(32) };
const point = launch => ({ launch, boundary: null });
const request = (actor = old, id = 42) => ({ kind: 'mcp', process_pid: actor.pid,
  process_started_identity: actor.started_identity, request_id: id, tool: 'pty_send', target_session_id: B.session_id });
const relation = req => ({ request: req, source_session_id: A.session_id, source: point(A), target: point(B),
  phase: 'invoked', completion: 'open', target_fence: 'open', lifecycle: 'tracking' });
const record = (req = request()) => ({ schema: 'aiterm.execution-record.v1',
  reservation: { schema: 'aiterm.execution-reservation.v1', request: req,
    source: point(A), target: { session_id: B.session_id, expected_launch_id: B.launch_id } },
  source_session_id: A.session_id, source: { status: 'verified', reason: 'matched', point: point(A), boundary_status: 'missing' },
  relation: relation(req), operations: { launch: 'not_issued', send: 'accepted' }, stopping: false });
const code = name => error => error.code === name;
function fixture(t, actor = old) {
  const dir = mkdtempSync(join(tmpdir(), 'execution-inventory-'));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  const native = { actor: structuredClone(actor), available: true }, assertScope = () => {
    if (!native.available || JSON.stringify(native.actor) !== JSON.stringify(actor)) throw Object.assign(Error('scope missing'), { code: 'EXECUTION_UNSUPPORTED' });
  };
  return { dir, native, raw: new FileExecutionStore(dir), store: new ParticipantExecutionStore(dir, actor, assertScope),
    observe: pids => pids.includes(native.actor.pid) ? [structuredClone(native.actor)] : [] };
}
test('even an empty or fully registered inventory cannot prove launch, fence, population or complete coverage', () => {
  const state = emptyExecutionState();
  const empty = executionParticipantInventory(state);
  assert.equal(empty.participant_discovery, 'unproven'); assert.equal(empty.native_fence, 'unknown');
  assert.equal(empty.relation_coverage, 'incomplete'); assert.deepEqual(empty.participants, []);
  state.participants.push({ actor: old, roles: ['mcp', 'parent_producer', 'parent_worker'] }); state.records.push(record());
  const full = executionParticipantInventory(state, () => [old]);
  assert.deepEqual(full.participants[0].missing, []); assert.equal(full.participants[0].native_identity, 'matched');
  assert.equal(full.native_fence, 'unknown'); assert.equal(full.relation_coverage, 'incomplete');
  assert.equal('source' in full.participants[0], false); assert.equal(state.records[0].relation.target_fence, 'open');
});
test('missing registration cannot be inferred from an active MCP request, a role declaration or a matching native PID', { skip: posixCheckpoint }, () => {
  const state = emptyExecutionState(); state.records.push(record());
  const before = structuredClone(state), missing = executionParticipantInventory(state, () => [old]);
  assert.deepEqual(missing.participants[0].missing, ['unregistered_actor']);
  assert.deepEqual(state, before); assert.deepEqual(planCascadeStop([A], state.records.map(r => r.relation)).targets, [A, B]);
  state.participants.push({ actor: old, roles: ['parent_worker'] });
  assert.deepEqual(executionParticipantInventory(state, () => [old]).participants[0].missing, ['role_missing']);
});
test('retired MCP history is omitted, while an unresolved native slot still preserves its exact old request', () => {
  const state = emptyExecutionState(), r = record(); r.relation.phase = 'unsent'; r.relation.lifecycle = 'retired'; state.records.push(r);
  assert.deepEqual(executionParticipantInventory(state).participants, []);
  state.slots.push({ session_id: B.session_id, expected_launch_id: B.launch_id, stage: 'send', state: 'unknown', request: request() });
  const entry = executionParticipantInventory(state, () => [old]).participants[0];
  assert.deepEqual(entry.references, [{ kind: 'mcp', request: request() }]); assert.deepEqual(entry.missing, ['unregistered_actor']);
});
test('same PID with a new start never inherits the old request or erases its uncertain slot, including reconstruction', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); f.store.enroll(['mcp']);
  await f.raw.transaction(state => { state.records.push(record()); state.slots.push({ session_id: B.session_id,
    expected_launch_id: B.launch_id, stage: 'send', state: 'unknown', request: request() }); });
  const next = new ParticipantExecutionStore(f.dir, replacement, () => {}); next.enroll(['parent_worker']);
  const entries = next.inventory(() => [replacement]).participants;
  assert.equal(entries.length, 2); assert.equal(entries[0].native_identity, 'replaced');
  assert.deepEqual(entries[0].references.map(r => r.request), [request()]); assert.deepEqual(entries[0].missing, ['native_replaced']);
  assert.equal(entries[1].native_identity, 'matched'); assert.deepEqual(entries[1].references, []);
  new ParticipantExecutionStore(f.dir, replacement, () => {}).enroll(['parent_worker']);
  assert.equal((await f.raw.transaction(state => state.participants, { readOnly: true })).length, 2);
  assert.equal((await f.raw.transaction(state => state.slots, { readOnly: true }))[0].state, 'unknown');
});
test('an unenrolled or removed participant cannot enter metadata admission, and inventory diagnoses without repairing it', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); let callbacks = 0;
  assert.throws(() => f.store.transactionSync(() => { callbacks++; }), code('EXECUTION_UNSUPPORTED'));
  f.store.enroll(['mcp']); await f.raw.transaction(state => { state.records.push(record()); state.participants = []; });
  const before = readFileSync(join(f.dir, 'relations.json'), 'utf8');
  assert.throws(() => f.store.transactionSync(() => { callbacks++; }), code('EXECUTION_UNSUPPORTED'));
  await assert.rejects(f.store.transaction(() => { callbacks++; }), code('EXECUTION_UNSUPPORTED'));
  assert.deepEqual(f.store.inventory(f.observe).participants[0].missing, ['unregistered_actor']);
  assert.equal(readFileSync(join(f.dir, 'relations.json'), 'utf8'), before); assert.equal(callbacks, 0);
});
test('deferred native issuance rechecks a removed role after preflight without auto-enrollment or an issued slot', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); f.store.enroll(['mcp']);
  const runtime = { async sourceEvidence() { return { runtime_launch: A, caller_bound: true, invocation_boundary: null }; },
    async observe(session) { return this.observeSync(session); }, observeSync(session) { return { state: 'present', launch: session === A.session_id ? A : B }; },
    async completion() { throw Error('not used'); }, async close() { throw Error('not used'); }, async coverage() { return 'incomplete'; } };
  const service = new ExecutionService(f.store, runtime), r = record();
  await service.execute({ action: 'register', reservation: r.reservation, source_session_id: A.session_id }); let effects = 0;
  await assert.rejects(service.invokeDeferred({ schema: 'aiterm.execution-ref.v1', request: request() }, 'send', async issue => {
    await f.raw.transaction(state => { state.participants[0].roles = ['parent_worker']; }); issue(); effects++; return { value: null, target: point(B) };
  }, B.session_id), code('EXECUTION_UNSUPPORTED'));
  assert.equal(effects, 0); assert.deepEqual(await f.raw.transaction(state => state.slots, { readOnly: true }), []);
  assert.deepEqual(f.store.inventory(f.observe).participants[0].missing, ['role_missing']);
});
test('parent native phases and orphaned uncertain effects keep existing delivery/actor references without fabricating another ID', () => {
  const state = emptyExecutionState(), delivery_id = '00000000-0000-4000-8000-000000000001';
  state.parent_effects.push({ delivery_id, actor: hook, stage: 'emit', state: 'unknown' });
  assert.deepEqual(executionParticipantInventory(state, () => [hook]).participants[0].references,
    [{ kind: 'parent_effect', delivery_id, stage: 'emit', state: 'unknown' }]);
  state.parent_effects[0].state = 'accepted';
  assert.equal(executionParticipantInventory(state).participants[0].references[0].state, 'accepted'); // orphaned acceptance is not branch completion
});
test('parent receipt does not retire actor references; exact finished original/return branches do, without name-based revival', () => {
  const state = emptyExecutionState(), delivery_id = '00000000-0000-4000-8000-000000000001';
  const original = record(), req = { kind: 'delivery', delivery_id, target_session_id: A.session_id };
  const returning = record(req); returning.reservation.target = { session_id: A.session_id, expected_launch_id: A.launch_id };
  returning.reservation.source = point(B); returning.source_session_id = B.session_id; returning.source.point = point(B);
  returning.relation.source_session_id = B.session_id; returning.relation.source = point(B); returning.relation.target = point(A);
  state.records.push(original, returning);
  state.parent_deliveries.push({ delivery_id, request: request(), parent: point(A), child: point(B), endpoint_digest: 'f'.repeat(64) });
  state.parent_effects.push({ delivery_id, actor: hook, stage: 'emit', state: 'accepted' });
  executionStateSchema.parse(state);
  const current = executionParticipantInventory(state, () => [old, hook]);
  assert.equal(current.participants.find(row => row.actor.pid === old.pid).references.some(ref => ref.kind === 'parent_source'), true);
  assert.equal(current.participants.find(row => row.actor.pid === hook.pid).references[0].state, 'accepted');
  for (const r of state.records) { r.relation.completion = 'interrupted'; r.relation.target_fence = 'closed'; r.relation.lifecycle = 'retired'; }
  assert.deepEqual(executionParticipantInventory(state).participants, []);
  const unrelated = record(request(replacement, 'new-work-on-same-seats')); state.records.push(unrelated);
  const later = executionParticipantInventory(state, () => [replacement]);
  assert.deepEqual(later.participants.map(row => row.actor), [replacement]);
  assert.equal(later.participants[0].references.every(ref => ref.kind === 'mcp'), true);
});
test('native failure followed by lost metadata admission remains possible and retains the issued slot', { skip: posixCheckpoint }, async t => {
  const f = fixture(t); f.store.enroll(['mcp']);
  const runtime = { async sourceEvidence() { return { runtime_launch: A, caller_bound: true, invocation_boundary: null }; },
    async observe(session) { return this.observeSync(session); }, observeSync(session) { return { state: 'present', launch: session === A.session_id ? A : B }; } };
  const service = new ExecutionService(f.store, runtime);
  await service.execute({ action: 'register', reservation: record().reservation, source_session_id: A.session_id }); let effects = 0;
  await assert.rejects(service.invokeDeferred({ schema: 'aiterm.execution-ref.v1', request: request() }, 'send', async issue => {
    issue(); effects++; f.raw.transactionSync(state => { state.participants = []; }); throw Error('native response lost');
  }, B.session_id), error => error.effect === 'possible' && error.code === 'EXECUTION_UNCONFIRMED');
  assert.equal(effects, 1); assert.equal(f.raw.transactionSync(state => state.slots, { readOnly: true })[0].state, 'issued');
});
test('successful close/configure followed by registration loss never becomes a pre-effect refusal or reusable slot', { skip: posixCheckpoint }, async t => {
  for (const stage of ['close', 'configure']) {
    const f = fixture(t); f.store.enroll(['mcp']); let present = true, effects = 0;
    const runtime = { async observe() { return present ? { state: 'present', launch: B } : { state: 'absent' }; } };
    const service = new ExecutionService(f.store, runtime);
    await assert.rejects(service.changeSession(B, stage, async () => {
      effects++; if (stage === 'close') present = false; f.raw.transactionSync(state => { state.participants = []; });
    }), error => error.code === 'EXECUTION_UNCONFIRMED' && error.effect === 'possible');
    assert.equal(effects, 1); assert.equal(f.raw.transactionSync(state => state.slots, { readOnly: true })[0].state, 'issued');
  }
});
test('missing/malformed/async/duplicate/unrelated native identities never pass as a matching process or as completion', () => {
  const state = emptyExecutionState(); state.participants.push({ actor: old, roles: ['mcp'] });
  for (const observe of [undefined, () => [], () => [{ ...old, started_identity: null }], () => [{ ...old, started_identity: 'invalid' }],
    () => [old, old], () => [old, hook], () => Promise.resolve([old]), () => Promise.reject(Error('async unavailable')), () => { throw Error('unavailable'); }]) {
    const value = executionParticipantInventory(state, observe);
    assert.equal(value.participants[0].native_identity, 'unavailable'); assert.equal(value.native_fence, 'unknown');
  }
});
test('old private state missing declarations reads as missing; corrupt/duplicate state fails closed without reset', { skip: posixCheckpoint }, t => {
  const f = fixture(t), path = join(f.dir, 'relations.json'), previous = emptyExecutionState(); delete previous.participants;
  writeFileSync(path, JSON.stringify(previous));
  assert.deepEqual(f.raw.transactionSync(state => state.participants, { readOnly: true }), []);
  assert.equal('participants' in JSON.parse(readFileSync(path, 'utf8')), false);
  const duplicate = { ...emptyExecutionState(), participants: [{ actor: old, roles: ['mcp'] }, { actor: old, roles: ['parent_worker'] }] };
  assert.equal(executionStateSchema.safeParse(duplicate).success, false);
  writeFileSync(path, JSON.stringify(duplicate));
  assert.throws(() => f.store.inventory(f.observe), code('EXECUTION_STATE_UNAVAILABLE'));
  assert.equal(readFileSync(path, 'utf8'), JSON.stringify(duplicate));
  writeFileSync(path, '{'); assert.throws(() => f.store.inventory(f.observe), code('EXECUTION_STATE_UNAVAILABLE'));
});
