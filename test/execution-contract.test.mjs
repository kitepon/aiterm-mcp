// Pure fixtures only: no core import, CLI launch, PTY observation or process kill.
import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessExecutionSource, executionSourceClaimSchema, executionRequestSchema,
  executionReservationSchema, cascadeStopResultSchema } from '../dist/execution-contract.js';

const launch = { session_id: 'bot-a', launch_id: 'a'.repeat(32) };
const request = { kind: 'delivery', delivery_id: 'existing-delivery', target_session_id: 'bot-a' };
const boundary = { event_cursor: 42, operation_id: null, turn_id: 'native-turn', steer_id: null };
const claim = { launch, request, boundary };
const evidence = () => ({ live_launch: launch, caller_bound: true, invocation_bound: true,
  input_coverage: 'complete', active_inputs: [request], request, boundary });

test('a live launch and an exact invocation binding identify one admitted request', () => {
  const result = assessExecutionSource(claim, evidence());
  assert.equal(result.status, 'verified');
  assert.deepEqual(result.request, request);
});
test('seat ID alone and an unbound launch header do not prove the caller', () => {
  assert.equal(assessExecutionSource({ launch: null, request: null, boundary: null }, evidence()).status, 'unknown');
  assert.equal(assessExecutionSource(claim, { ...evidence(), caller_bound: false }).reason, 'caller_unbound');
});
test('same session name with a new launch never binds an old caller', () => {
  const result = assessExecutionSource(claim, { ...evidence(), live_launch: { ...launch, launch_id: 'b'.repeat(32) } });
  assert.equal(result.status, 'stale');
  assert.equal(result.request, null);
});
test('a singleton active job does not replace invocation evidence', () => {
  assert.equal(assessExecutionSource(claim, { ...evidence(), invocation_bound: false }).reason, 'invocation_unbound');
  assert.equal(assessExecutionSource(claim, { ...evidence(), input_coverage: 'incomplete' }).reason, 'input_coverage_incomplete');
});
test('two independent inputs in one turn stay mixed even when a caller claims one', () => {
  const result = assessExecutionSource(claim, { ...evidence(), active_inputs: [request, { ...request, delivery_id: 'independent' }] });
  assert.equal(result.status, 'mixed');
  assert.equal(result.request, null);
  assert.equal(result.candidates.length, 2);
});
test('a cursor, steer or request mismatch cannot become a verified cause', () => {
  for (const modified of [ { ...boundary, event_cursor: 43 }, { ...boundary, steer_id: 'c'.repeat(16) } ])
    assert.equal(assessExecutionSource({ ...claim, boundary: modified }, evidence()).reason, 'boundary_mismatch');
  assert.equal(assessExecutionSource({ ...claim, request: { ...request, delivery_id: 'unrelated' } }, evidence()).reason, 'boundary_mismatch');
});
test('room references include actual target; call references include event sequence', () => {
  assert.equal(executionRequestSchema.safeParse({ kind: 'room', message_id: 'room-message' }).success, false);
  assert.equal(executionRequestSchema.safeParse({ kind: 'call', call_session_id: 'call', event: 'session.reply', target_session_id: 'bot-a' }).success, false);
  assert.equal(executionRequestSchema.safeParse({ kind: 'room', message_id: 'room-message', target_session_id: 'bot-a' }).success, true);
});
test('wire claims cannot provide trusted verification flags or arbitrary payload', () => {
  for (const addition of [{ caller_bound: true }, { verified: true }, { prompt: 'never-store-me' }])
    assert.equal(executionSourceClaimSchema.safeParse({ ...claim, ...addition }).success, false);
});
test('reservation reuses an existing reference and permits a not-yet-launched target', () => {
  const outgoing = { ...request, target_session_id: 'bot-b' };
  const value = executionReservationSchema.parse({ schema: 'aiterm.execution-reservation.v1', request: outgoing,
    source: claim, target: { session_id: 'bot-b', expected_launch_id: null } });
  assert.equal(value.request.delivery_id, 'existing-delivery');
  assert.equal(executionReservationSchema.safeParse({ ...value, target: { session_id: 'bot-c', expected_launch_id: null } }).success, false);
});
test('root absence, incomplete relations and shared/unknown targets cannot yield stopped', () => {
  const base = { schema: 'aiterm.cascade-stop-result.v1', roots: [launch], status: 'stopped', relation_coverage: 'complete',
    targets: [{ launch, outcome: 'closed', reason: 'confirmed_missing' }] };
  assert.equal(cascadeStopResultSchema.safeParse(base).success, true);
  for (const changed of [{ ...base, targets: [] }, { ...base, relation_coverage: 'incomplete' },
    ...['shared_busy', 'unknown', 'unsupported', 'replaced'].map(outcome => ({ ...base, targets: [{ launch, outcome, reason: 'not_confirmed' }] }))])
    assert.equal(cascadeStopResultSchema.safeParse(changed).success, false);
  assert.equal(cascadeStopResultSchema.safeParse({ ...base, status: 'partial', relation_coverage: 'incomplete' }).success, true);
});
