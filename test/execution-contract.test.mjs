// Pure fixtures: no core import, CLI launch, PTY observation or process kill.
import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessExecutionSource, executionSourceClaimSchema, executionRequestSchema,
  executionReservationSchema, executionRelationSchema, planCascadeStop,
  cascadeStopResultSchema } from '../dist/execution-contract.js';

const launch = (name, generation = name) => ({ session_id: `bot-${name}`, launch_id: generation.repeat(32) });
const A = launch('a'), B = launch('b'), C = launch('c'), D = launch('d');
const boundary = cursor => ({ event_cursor: cursor, operation_id: null, turn_id: null, steer_id: null });
const point = (launch, cursor = 1) => ({ launch, boundary: cursor === null ? null : boundary(cursor) });
const request = (id, target = B) => ({ kind: 'delivery', delivery_id: id, target_session_id: target.session_id });
const edge = (id, source, target, options = {}) => ({ request: request(id, target),
  source_session_id: source.session_id, source: point(source), target: point(target),
  phase: 'invoked', completion: 'open', target_fence: 'closed', lifecycle: 'tracking', ...options });
const targets = plan => plan.targets.map(value => value.session_id);
const evidence = () => ({ runtime_launch: A, caller_bound: true, invocation_boundary: boundary(1) });

test('generation binding adopts calls without semantic input ownership or complete input sets', () => {
  const value = assessExecutionSource({ launch: A, boundary: null }, { ...evidence(), invocation_boundary: null });
  assert.equal(value.status, 'verified');
  assert.equal(value.boundary_status, 'missing');
  assert.deepEqual(value.point.launch, A);
  for (const extra of [{ verified: true }, { input_coverage: 'complete' }, { request: request('semantic-parent', A) }])
    assert.equal(executionSourceClaimSchema.safeParse({ launch: A, boundary: null, ...extra }).success, false);
});
test('seat-only, unbound caller and old generation are never promoted to verified', () => {
  assert.equal(assessExecutionSource({ launch: null, boundary: null }, evidence()).reason, 'launch_unavailable');
  assert.equal(assessExecutionSource({ launch: A, boundary: null }, { ...evidence(), caller_bound: false }).reason, 'caller_unbound');
  const result = assessExecutionSource({ launch: A, boundary: null }, { ...evidence(), runtime_launch: launch('a', 'e') });
  assert.equal(result.status, 'stale');
  assert.equal(result.point, null);
});
test('a run mismatch loses lifetime precision but preserves a verified generation edge', () => {
  const result = assessExecutionSource({ launch: A, boundary: boundary(2) }, evidence());
  assert.equal(result.status, 'verified');
  assert.equal(result.boundary_status, 'mismatch');
  assert.equal(result.point.boundary, null);
});
test('a shared target and its unfinished calls are reached despite unrelated inputs', () => {
  const result = planCascadeStop([A], [edge('ab', A, B), edge('db-independent', D, B), edge('bc', B, C)]);
  assert.deepEqual(targets(result), ['bot-a', 'bot-b', 'bot-c']);
  assert.equal(result.gaps.length, 0);
});
test('active cycles and repeated roots include each expected launch only once', () => {
  assert.deepEqual(targets(planCascadeStop([A, A], [edge('ab', A, B), edge('ba', B, A)])), ['bot-a', 'bot-b']);
});
test('MCP mutation admission does not invent an AI invocation edge for configuration or approval', () => {
  const native = tool => ({ kind: 'mcp', process_pid: 123, process_started_identity: 'native-start', request_id: 7, tool,
    target_session_id: B.session_id });
  for (const tool of ['agent_configure', 'agent_auth.status', 'agent_approval.respond', 'pty_key', 'pty_close']) {
    const relation = { ...edge('ab', A, B), request: native(tool) };
    assert.deepEqual(targets(planCascadeStop([A], [relation])), ['bot-a']);
  }
  assert.deepEqual(targets(planCascadeStop([A], [{ ...edge('ab', A, B), request: native('pty_send') }])), ['bot-a', 'bot-b']);
  assert.equal(executionRequestSchema.safeParse(native('unknown-tool')).success, false);
});
test('old completed contact does not pull a later independent execution into the stop', () => {
  const result = planCascadeStop([A], [edge('old-ab', A, B, { completion: 'completed' }),
    edge('later-bc', B, C, { source: point(B, 2) })]);
  assert.deepEqual(targets(result), ['bot-a']);
});
test('a locally completed middle call remains a connector to unfinished downstream work', () => {
  const result = planCascadeStop([A], [edge('ab', A, B, { completion: 'completed' }), edge('bc', B, C)]);
  assert.deepEqual(targets(result), ['bot-a', 'bot-b', 'bot-c']);
  assert.deepEqual(result.retained.map(value => value.delivery_id), ['ab', 'bc']);
});
test('the connector expires when its whole descendant branch is terminal', () => {
  const relations = [edge('ab', A, B, { completion: 'completed' }), edge('bc', B, C, { completion: 'interrupted' })];
  assert.deepEqual(targets(planCascadeStop([A], relations)), ['bot-a']);
});
test('a sealed retired edge cannot be revived by later work with an unknown boundary', () => {
  const relations = [edge('old-ab', A, B, { completion: 'completed', lifecycle: 'retired' }),
    edge('later-bc', B, C, { source: point(B, null) })];
  assert.deepEqual(targets(planCascadeStop([A], relations)), ['bot-a']);
  assert.equal(executionRelationSchema.safeParse(edge('pending-ab', A, B, { lifecycle: 'retired' })).success, false);
});
test('a child finishing before its parent does not expire the running parent', () => {
  const relations = [edge('ab', A, B), edge('bc', B, C, { completion: 'completed' })];
  assert.deepEqual(targets(planCascadeStop([A], relations)), ['bot-a', 'bot-b']);
});
test('all-terminal cycles do not keep one another alive', () => {
  const relations = [edge('ab', A, B, { completion: 'completed' }), edge('ba', B, A, { completion: 'completed' })];
  assert.deepEqual(targets(planCascadeStop([A], relations)), ['bot-a']);
});
test('local done cannot expire a branch until its issued invocation fence is confirmed', () => {
  const relation = edge('ab', A, B, { completion: 'completed', target_fence: 'unknown' });
  const result = planCascadeStop([A], [relation]);
  assert.deepEqual(targets(result), ['bot-a', 'bot-b']);
  assert.equal(result.gaps[0].reason, 'invocation_fence_unconfirmed');
  assert.equal(executionRelationSchema.safeParse({ ...relation, lifecycle: 'retired' }).success, false);
});
test('pending reservation retains its connector but is cancelled before target invocation', () => {
  const pending = edge('bc', B, C, { phase: 'reserved', target: null });
  const result = planCascadeStop([A], [edge('ab', A, B, { completion: 'completed' }), pending]);
  assert.deepEqual(targets(result), ['bot-a', 'bot-b']);
  assert.deepEqual(result.cancel_reservations, [pending.request]);
});
test('confirmed unsent reservations cannot become historical call edges', () => {
  const result = planCascadeStop([A], [edge('ab', A, B, { phase: 'unsent' })]);
  assert.deepEqual(targets(result), ['bot-a']);
  assert.deepEqual(result.retained, []);
});
test('RPC outcome or completion missing retains the bound target and explicit gaps', () => {
  const result = planCascadeStop([A], [edge('ab', A, B, { phase: 'submitted_unknown', completion: 'unknown' })]);
  assert.deepEqual(targets(result), ['bot-a', 'bot-b']);
  assert.deepEqual(result.gaps.map(gap => gap.reason).sort(), ['completion_missing', 'invocation_outcome_unknown']);
});
test('missing target generation is reported without fabricating a launch', () => {
  const result = planCascadeStop([A], [edge('ab', A, B, { target: null })]);
  assert.deepEqual(targets(result), ['bot-a']);
  assert.equal(result.gaps[0].reason, 'target_generation_missing');
});
test('source generation missing is unresolved; an old source never binds a new root', () => {
  const result = planCascadeStop([A], [edge('unbound-ab', A, B, { source: null })]);
  assert.deepEqual(targets(result), ['bot-a']);
  assert.equal(result.gaps[0].reason, 'source_generation_missing');
  assert.deepEqual(targets(planCascadeStop([launch('a', 'e')], [edge('old-ab', A, B)])), ['bot-a']);
});
test('a missing downstream boundary retains the known generation connector with a gap', () => {
  const result = planCascadeStop([A], [edge('ab', A, B, { completion: 'completed' }),
    edge('bc', B, C, { source: point(B, null) })]);
  assert.deepEqual(targets(result), ['bot-a', 'bot-b', 'bot-c']);
  assert.ok(result.gaps.some(gap => gap.reason === 'descendant_binding_missing'));
});
test('an unbound child candidate prevents silent ancestor expiry but never fabricates its target edge', () => {
  const result = planCascadeStop([A], [edge('ab', A, B, { completion: 'completed' }),
    edge('unknown-bc', B, C, { source: null })]);
  assert.deepEqual(targets(result), ['bot-a', 'bot-b']);
  assert.ok(result.gaps.some(gap => gap.reason === 'source_generation_missing'));
  assert.ok(result.gaps.some(gap => gap.reason === 'descendant_binding_missing'));
});
test('confirmed interruption of an entire generation can terminate a call without a run boundary', () => {
  const result = planCascadeStop([A], [edge('ab', A, B, { target: point(B, null), completion: 'interrupted' })]);
  assert.deepEqual(targets(result), ['bot-a']);
});
test('queue status and generic completion cannot prove termination of an unbound run', () => {
  assert.equal(executionRelationSchema.safeParse(edge('ab', A, B, { phase: 'reserved', completion: 'completed' })).success, false);
  assert.equal(executionRelationSchema.safeParse(edge('ab', A, B, { target: point(B, null), completion: 'completed' })).success, false);
});
test('room fan-out retains real recipients and call events require event sequence', () => {
  const relations = [B, C].map(target => ({ ...edge('unused', A, target),
    request: { kind: 'room', message_id: 'existing-message', target_session_id: target.session_id } }));
  assert.deepEqual(targets(planCascadeStop([A], relations)), ['bot-a', 'bot-b', 'bot-c']);
  assert.equal(executionRequestSchema.safeParse({ kind: 'room', message_id: 'room-message' }).success, false);
  assert.equal(executionRequestSchema.safeParse({ kind: 'call', call_session_id: 'call', event: 'session.reply', target_session_id: 'bot-b' }).success, false);
});
test('reservation reuses an existing outgoing reference and requires its actual target', () => {
  const value = executionReservationSchema.parse({ schema: 'aiterm.execution-reservation.v1', request: request('ab'),
    source: { launch: A, boundary: null }, target: { session_id: B.session_id, expected_launch_id: null } });
  assert.equal(executionReservationSchema.safeParse({ ...value, target: { session_id: C.session_id, expected_launch_id: null } }).success, false);
});
test('shared_busy is removed; missing relations, unresolved work and unclosed roots cannot yield stopped', () => {
  const base = { schema: 'aiterm.cascade-stop-result.v1', roots: [A], status: 'stopped', relation_coverage: 'complete', unresolved: [],
    targets: [{ launch: A, outcome: 'closed', reason: 'confirmed_missing' }] };
  assert.equal(cascadeStopResultSchema.safeParse(base).success, true);
  for (const changed of [{ ...base, targets: [] }, { ...base, relation_coverage: 'incomplete' },
    { ...base, unresolved: [{ request: request('ab'), reason: 'completion_missing' }] },
    ...['shared_busy', 'unknown', 'unsupported', 'replaced'].map(outcome => ({ ...base, targets: [{ launch: A, outcome, reason: 'not_confirmed' }] }))])
    assert.equal(cascadeStopResultSchema.safeParse(changed).success, false);
  assert.equal(cascadeStopResultSchema.safeParse({ ...base, status: 'partial', relation_coverage: 'incomplete' }).success, true);
});
