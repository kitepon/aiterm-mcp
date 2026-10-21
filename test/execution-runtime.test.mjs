import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionRuntime, executionSourceFromEnvironment } from '../dist/execution-runtime.js';
import { assessExecutionSource } from '../dist/execution-contract.js';
import { ExecutionError } from '../dist/execution-wire.js';

const A = { session_id: 'bot-a', launch_id: 'a'.repeat(32) };
const boundary = { event_cursor: 42, operation_id: null, turn_id: null, steer_id: null };
const point = { launch: A, boundary };
const request = { kind: 'delivery', delivery_id: 'existing', target_session_id: 'bot-b' };
const input = { action: 'register', source_session_id: A.session_id,
  reservation: { schema: 'aiterm.execution-reservation.v1', request, source: point,
    target: { session_id: 'bot-b', expected_launch_id: null } } };
const unknown = { state: 'unknown', fence: 'unknown' };
function fixture() {
  const reads = [];
  const observed = { schema: 'aiterm.pty-observe-result.v1', session_id: A.session_id, exists: true, launch_id: A.launch_id };
  const done = { schema: 'aiterm.agent-wait-result.v1', session_id: A.session_id, launch_id: A.launch_id,
    outcome: 'done', operation_id: null, turn_id: null };
  const bindings = { observeSession: async () => observed,
    observeDone: async (session, options) => { reads.push({ session, options }); return done; } };
  return { observed, done, bindings, reads };
}
test('stdio source uses the launching CLI generation and rejects conflicting aliases without inference', async () => {
  const env = { AITERM_SESSION_ID: A.session_id, AITERM_AGENT_SESSION_ID: A.session_id, AITERM_AGENT_LAUNCH_ID: A.launch_id };
  assert.deepEqual(executionSourceFromEnvironment(env), { launch: A, boundary: null });
  assert.deepEqual(executionSourceFromEnvironment({ ...env, AITERM_SESSION_ID: undefined }), { launch: A, boundary: null });
  assert.deepEqual(executionSourceFromEnvironment({ ...env, AITERM_AGENT_SESSION_ID: undefined }), { launch: A, boundary: null });
  for (const partial of [
    { AITERM_AGENT_LAUNCH_ID: undefined }, { AITERM_SESSION_ID: 'other' },
    { AITERM_SESSION_ID: '' }, { AITERM_AGENT_SESSION_ID: '${env:AITERM_AGENT_SESSION_ID}' },
    { AITERM_AGENT_LAUNCH_ID: 'bad' },
  ]) assert.equal(executionSourceFromEnvironment({ ...env, ...partial }), null);
  assert.equal(executionSourceFromEnvironment({ BELLTEAM_BOT_ID: A.session_id,
    AITERM_AGENT_LINEAGE: `host-root>codex:${A.session_id}` }), null);
  const snapshot = executionSourceFromEnvironment(env);
  env.AITERM_AGENT_LAUNCH_ID = 'd'.repeat(32);
  const f = fixture();
  f.bindings.sourceContext = async () => snapshot;
  f.observed.launch_id = env.AITERM_AGENT_LAUNCH_ID;
  const evidence = await createExecutionRuntime(f.bindings).sourceEvidence(input);
  assert.equal(evidence.caller_bound, false);
});
test('only an exact observe schema/session can report absence or a known generation', async () => {
  for (const value of [{ exists: false }, { schema: 'aiterm.pty-observe-result.v1', session_id: 'other', exists: false, launch_id: null },
    { schema: 'aiterm.pty-observe-result.v1', session_id: A.session_id, exists: false, launch_id: 'bad' },
    { schema: 'aiterm.pty-observe-result.v1', session_id: A.session_id, exists: false, launch_id: A.launch_id }]) {
    const runtime = createExecutionRuntime({ ...fixture().bindings, observeSession: async () => value });
    assert.deepEqual(await runtime.observe(A.session_id), { state: 'unknown' });
  }
  const f = fixture(), runtime = createExecutionRuntime(f.bindings);
  assert.deepEqual(await runtime.observe(A.session_id), { state: 'present', launch: A });
  f.observed.exists = false; f.observed.launch_id = null;
  assert.deepEqual(await runtime.observe(A.session_id), { state: 'absent' });
});
test('synchronous generation admission validates the same schema and never awaits a callback', () => {
  const f = fixture();
  assert.equal(createExecutionRuntime(f.bindings).observeSync, undefined);
  const runtime = createExecutionRuntime({ ...f.bindings, observeSessionSync: () => f.observed });
  assert.deepEqual(runtime.observeSync(A.session_id), { state: 'present', launch: A });
  f.observed.session_id = 'other';
  assert.deepEqual(runtime.observeSync(A.session_id), { state: 'unknown' });
  assert.deepEqual(createExecutionRuntime({ ...f.bindings, observeSessionSync: () => Promise.resolve(f.observed) }).observeSync(A.session_id), { state: 'unknown' });
});
test('wire claims alone do not become runtime caller evidence', async () => {
  const f = fixture(), runtime = createExecutionRuntime(f.bindings);
  assert.notEqual(assessExecutionSource(point, await runtime.sourceEvidence(input)).status, 'verified');
  f.bindings.sourceContext = async () => ({ launch: A, boundary: null });
  const verified = assessExecutionSource({ launch: A, boundary: null }, await createExecutionRuntime(f.bindings).sourceEvidence(input));
  assert.equal(verified.status, 'verified');
  assert.equal(verified.point.boundary, null);
});
test('direct runtime snapshots the stdio environment once and still checks the live generation', async () => {
  const f = fixture();
  const env = { AITERM_SESSION_ID: A.session_id, AITERM_AGENT_LAUNCH_ID: A.launch_id };
  const runtime = createExecutionRuntime({ ...f.bindings, sourceEnvironment: env });
  env.AITERM_AGENT_LAUNCH_ID = 'd'.repeat(32);
  assert.equal((await runtime.sourceEvidence(input)).caller_bound, true);
  f.observed.launch_id = env.AITERM_AGENT_LAUNCH_ID;
  assert.equal((await runtime.sourceEvidence(input)).caller_bound, false);
  const legacy = createExecutionRuntime({ ...f.bindings, sourceEnvironment: { AITERM_SESSION_ID: A.session_id } });
  assert.equal((await legacy.sourceEvidence(input)).caller_bound, false);
});
test('the saved dispatch cursor is repeated without blocking and done does not invent a fence', async () => {
  const f = fixture();
  assert.deepEqual(await createExecutionRuntime(f.bindings).completion(point), { state: 'completed', fence: 'unknown' });
  assert.deepEqual(f.reads, [{ session: A.session_id, options: { cursor: 42, timeout: 0 } }]);
});
test('native operation/turn mismatches do not close a saved execution', async () => {
  const f = fixture(), operation = `sha256:${'b'.repeat(64)}`;
  const p = { launch: A, boundary: { ...boundary, operation_id: operation, turn_id: 'native-turn' } };
  assert.deepEqual(await createExecutionRuntime(f.bindings).completion(p), unknown);
  f.done.operation_id = operation; f.done.turn_id = 'native-turn';
  assert.equal((await createExecutionRuntime(f.bindings).completion(p)).state, 'completed');
});
test('steer placement must be known and use the exact existing steer reference', async () => {
  const f = fixture(), p = { launch: A, boundary: { ...boundary, steer_id: 'c'.repeat(16) } };
  for (const steer of [undefined, { placement: 'unknown' }]) {
    f.done.steer = steer;
    assert.deepEqual(await createExecutionRuntime(f.bindings).completion(p), unknown);
  }
  f.done.steer = { placement: 'same_turn' };
  assert.equal((await createExecutionRuntime(f.bindings).completion(p)).state, 'completed');
  assert.equal(f.reads.at(-1).options.steer, p.boundary.steer_id);
});
test('RPC failure, generic tool error, timeout, limits and not-taken do not prove completion', async () => {
  const f = fixture();
  for (const outcome of ['running', 'timeout', 'rate_limited', 'not_taken']) {
    f.done.outcome = outcome;
    assert.deepEqual(await createExecutionRuntime(f.bindings).completion(point), unknown);
  }
  f.bindings.observeDone = async () => ({ isError: true, content: [] });
  assert.deepEqual(await createExecutionRuntime(f.bindings).completion(point), unknown);
  f.bindings.observeDone = async () => { throw new Error('RPC timeout'); };
  assert.deepEqual(await createExecutionRuntime(f.bindings).completion(point), unknown);
});
test('a native terminal error is distinct from an RPC error and still needs a fence proof', async () => {
  const f = fixture(); f.done.outcome = 'error';
  assert.deepEqual(await createExecutionRuntime(f.bindings).completion(point), { state: 'completed', fence: 'unknown' });
  f.bindings.invocationFence = async () => 'closed';
  assert.deepEqual(await createExecutionRuntime(f.bindings).completion(point), { state: 'completed', fence: 'closed' });
});
test('a generation change during the completion read cannot terminate the replacement', async () => {
  const f = fixture(); f.bindings.observeDone = async () => { f.observed.launch_id = 'd'.repeat(32); return f.done; };
  assert.deepEqual(await createExecutionRuntime(f.bindings).completion(point), unknown);
});
test('typed closed requires post-observation absence of the expected execution', async () => {
  const f = fixture(); f.done.outcome = 'closed';
  assert.deepEqual(await createExecutionRuntime(f.bindings).completion(point), unknown);
  f.bindings.observeDone = async () => { f.observed.exists = false; f.observed.launch_id = null; return f.done; };
  assert.deepEqual(await createExecutionRuntime(f.bindings).completion(point), { state: 'interrupted', fence: 'closed' });
});
test('unsupported guarded close and unknown coverage have no success fallback', async () => {
  const f = fixture(), runtime = createExecutionRuntime(f.bindings);
  await assert.rejects(runtime.close(A), error => error instanceof ExecutionError && error.code === 'EXECUTION_UNSUPPORTED');
  assert.equal(await runtime.coverage([A]), 'incomplete');
  f.bindings.guardedClose = async expected => { assert.deepEqual(expected, A); };
  await createExecutionRuntime(f.bindings).close(A);
});
