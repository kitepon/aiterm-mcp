import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parentHookReference } from '../dist/execution-parent-alias.js';

const launch = { session_id: 'bot-a', launch_id: 'a'.repeat(32) };
const point = { launch, boundary: null };
const request = { kind: 'mcp', process_pid: 22, process_started_identity: '2026-10-21T07:00:01Z',
  request_id: 41, tool: 'pty_send', target_session_id: 'bot-b' };
const session = '00000000-0000-4000-8000-000000000001';
const proof = endpoint => ({ schema: 'aiterm.parent-source.v1', request, source: point, client_name: 'synthetic',
  mcp_process: { pid: 22, started_identity: request.process_started_identity },
  harness_process: { pid: 20, started_identity: '2026-10-21T07:00:00Z' }, endpoint });
const binding = endpoint => ({ delivery_id: '00000000-0000-4000-8000-000000000002', request, parent: point,
  child: { launch: { session_id: 'bot-b', launch_id: 'b'.repeat(32) }, boundary: null },
  endpoint_digest: '1'.repeat(64), source_evidence: proof(endpoint) });
test('Claude and Cursor preserve actual partial native refs without inventing a turn or completion cursor', () => {
  const claude = parentHookReference(binding({ vendor: 'claude', session_id: session, request_id: 'toolu_actual' }), null,
    { session_id: session, tool_use_id: 'toolu_actual', unwanted: 'not retained' });
  const cursor = parentHookReference(binding({ vendor: 'cursor' }), null,
    { conversation_id: 'native-conversation', hook_event_name: 'postToolUse' });
  assert.deepEqual(claude.native, { vendor: 'claude', session_id: session, tool_use_id: 'toolu_actual' });
  assert.deepEqual(cursor.native, { vendor: 'cursor', conversation_id: 'native-conversation', hook_event_name: 'postToolUse' });
  assert.deepEqual(claude.target, launch); assert.equal('event_cursor' in claude, false);
  assert.equal('turn_id' in claude.native, false); assert.equal('turn_id' in cursor.native, false);
});
test('wrong session/tool refs, missing native context or source proof cannot be normalized into an alias', () => {
  const b = binding({ vendor: 'claude', session_id: session, request_id: 'toolu_actual' });
  assert.throws(() => parentHookReference(b, null, { session_id: session, tool_use_id: 'other' }), error => error.code === 'EXECUTION_CONFLICT');
  assert.throws(() => parentHookReference(b, null, undefined), error => error.code === 'EXECUTION_UNCONFIRMED');
  assert.throws(() => parentHookReference({ ...b, source_evidence: undefined }, null, { session_id: session, tool_use_id: 'toolu_actual' }), error => error.code === 'EXECUTION_UNSUPPORTED');
});
test('Codex Stop is recorded as hook context, never assumed to be completion of the emitted input', () => {
  const b = binding({ vendor: 'codex', thread_id: session });
  for (const hook_event_name of ['Stop', 'PostToolUse', null]) {
    const reference = parentHookReference(b, null, { session_id: session, turn_id: 'native-hook-turn', hook_event_name });
    assert.deepEqual(reference.native, { vendor: 'codex', session_id: session, turn_id: 'native-hook-turn', hook_event_name });
    assert.equal('completion' in reference, false); assert.equal('event_cursor' in reference, false);
  }
  assert.throws(() => parentHookReference(b, null, { session_id: session, turn_id: 'native-hook-turn', hook_event_name: 'unknown-event' }),
    error => error.code === 'EXECUTION_UNCONFIRMED');
});
