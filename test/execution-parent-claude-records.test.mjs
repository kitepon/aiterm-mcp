import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createClaudeParentRecordDiagnosis } from '../dist/execution-parent-claude-records.js';
const A = { session_id: 'bot-a', launch_id: 'a'.repeat(32) }, B = { session_id: 'bot-b', launch_id: 'b'.repeat(32) };
const parentConversation = '00000000-0000-4000-8000-000000000001', childConversation = '00000000-0000-4000-8000-000000000002';
const id = '00000000-0000-4000-8000-000000000003', operation = 'sha256:' + '1'.repeat(64);
const harness = { pid: 201, started_identity: '2026-10-21T20:00:00Z' }, actor = { pid: 202, started_identity: '2026-10-21T20:00:01Z' };
function fixture(t, { anonymous = false } = {}) {
  const root = fs.mkdtempSync(join(tmpdir(), 'claude-records-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hooks = join(root, 'claude-parent-hooks'), directory = join(hooks, 'toolu_original'); fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(join(root, 'agents'));
  const stem = join(root, 'agents', B.session_id + '.' + B.launch_id), prefix = JSON.stringify({ type: 'synthetic_before_dispatch' }) + '\n';
  const files = { invocation: join(directory, 'request.json'), delivery: join(directory, 'delivery.json'), meta: stem + '.agent.json',
    result: stem + '.claude-result.json', events: stem + '.events.jsonl' };
  const endpoint = { kind: 'claude', session_id: parentConversation, request_id: 'toolu_original', hook_root: hooks };
  const request = { kind: 'mcp', process_pid: actor.pid, process_started_identity: actor.started_identity,
    request_id: 94, tool: 'pty_send', target_session_id: B.session_id };
  const parent = { launch: A, boundary: null }, child = { launch: B, boundary: { event_cursor: Buffer.byteLength(prefix),
    operation_id: anonymous ? null : operation, turn_id: null, steer_id: null } };
  const proof = { schema: 'aiterm.parent-source.v1', request, source: parent, client_name: 'claude-code', mcp_process: actor,
    harness_process: harness, endpoint: { vendor: 'claude', session_id: parentConversation, request_id: endpoint.request_id } };
  const binding = { delivery_id: id, request, parent, child, source_evidence: proof };
  const text = 'synthetic result, never returned by diagnosis';
  const result = { schema: 'aiterm.claude-turn-result.v2', operation_id: anonymous ? null : operation,
    vendor_session_id: childConversation, result_digest: createHash('sha256').update(text).digest('hex'), result_bytes: Buffer.byteLength(text), text };
  const event = { type: 'agent_done', vendor: 'claude', aiterm_session: B.session_id, launch_id: B.launch_id,
    vendor_session_id: childConversation, turn_id: null, operation_id: result.operation_id, reason: 'Stop', done_status: 'turn_done',
    stop_hook_active: false, result_digest: result.result_digest, result_bytes: result.result_bytes, at: '2026-10-21T20:00:03Z' };
  const write = (key, value) => fs.writeFileSync(files[key], JSON.stringify(value), { mode: 0o600 });
  write('invocation', { request_id: endpoint.request_id, session_id: parentConversation, agent_id: null,
    parent_pid: harness.pid, parent_started_identity: harness.started_identity });
  write('delivery', { delivery_id: id });
  write('meta', { kind: 'claude', aiterm_session: B.session_id, launch_id: B.launch_id,
    vendor_session_id: childConversation, event_file: files.events, result_file: files.result });
  write('result', result); fs.writeFileSync(files.events, prefix + JSON.stringify(event) + '\n', { mode: 0o600 });
  let scoped = true, checks = 0;
  const diagnose = createClaudeParentRecordDiagnosis({ stateRoot: root, assertScope() { checks++; if (!scoped) throw Error('synthetic scope lost'); } });
  const snapshot = () => Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')]));
  return { root, endpoint, binding, proof, files, event, result, prefix, write, snapshot, checks: () => checks,
    unScope: () => { scoped = false; }, diagnose: () => diagnose(binding, endpoint) };
}
const unknown = value => { assert.equal(value.child_stop, 'unconfirmed'); assert.equal(value.native_input, 'unconfirmed');
  assert.equal(value.interruption, 'unconfirmed'); assert.equal(value.session_preserved, 'unconfirmed');
  assert.equal(value.native_fence, 'unknown'); assert.equal(value.clearance, 'retained'); assert.equal(value.retry, 'none'); };

test('named child Stop/result joins original parent invocation and delivery without exporting text, changing Point or certifying native completion', t => {
  const f = fixture(t), before = f.snapshot(), original = structuredClone(f.binding);
  const result = f.diagnose(); assert.equal(result.parent_invocation, 'matched'); assert.equal(result.delivery_binding, 'matched');
  assert.equal(result.child_stop, 'recorded'); assert.deepEqual(result.missing, []); assert.equal(result.native_fence, 'unknown');
  assert.equal(result.native_input, 'unconfirmed'); assert.equal(result.interruption, 'unconfirmed'); assert.equal(result.session_preserved, 'unconfirmed');
  assert.equal(result.clearance, 'retained'); assert.equal(result.retry, 'none');
  assert.equal(JSON.stringify(result).includes(f.result.text), false); assert.equal(Object.hasOwn(result, 'turn_id'), false);
  assert.deepEqual(f.snapshot(), before); assert.deepEqual(f.binding, original); assert.equal(f.checks(), 2);
});

test('anonymous operation stays unconfirmed and never borrows latest result or the dispatch cursor as native alias', t => {
  const f = fixture(t, { anonymous: true }); fs.unlinkSync(f.files.result); fs.unlinkSync(f.files.meta); fs.unlinkSync(f.files.events);
  const value = f.diagnose(); unknown(value); assert.equal(value.parent_invocation, 'matched'); assert.equal(value.delivery_binding, 'matched');
  assert.deepEqual(value.missing, ['child_operation_reference_missing']); assert.equal(f.binding.child.boundary.turn_id, null);
});

test('original parent/request/proof/invocation mismatch never selects another current parent', t => {
  for (const mutate of [f => { f.binding.request.request_id++; f.binding.source_evidence = structuredClone(f.proof); f.binding.source_evidence.request.request_id--; },
    f => { f.endpoint.session_id = childConversation; }, f => { f.endpoint.request_id = 'toolu_other'; },
    f => { const row = JSON.parse(fs.readFileSync(f.files.invocation)); row.parent_started_identity = '2026-10-21T20:09:00Z'; f.write('invocation', row); },
    f => { const row = JSON.parse(fs.readFileSync(f.files.invocation)); row.agent_id = 'independent-agent'; f.write('invocation', row); }]) {
    const f = fixture(t); mutate(f); unknown(f.diagnose());
  }
});

test('conflicting or missing delivery reference cannot be replaced from an answer, local done or current job', t => {
  for (const change of ['mismatch', 'missing']) {
    const f = fixture(t); if (change === 'missing') fs.unlinkSync(f.files.delivery); else f.write('delivery', { delivery_id: parentConversation });
    const before = fs.readFileSync(f.files.result, 'utf8'); unknown(f.diagnose()); assert.equal(fs.readFileSync(f.files.result, 'utf8'), before);
  }
});

test('child generation, conversation and fixed-scope paths are required even when operation and result digest match', t => {
  for (const mutate of [row => { row.launch_id = 'c'.repeat(32); }, row => { row.kind = 'codex'; },
    row => { row.vendor_session_id = parentConversation; }, row => { row.event_file += '.other'; }, row => { row.result_file += '.other'; }]) {
    const f = fixture(t), meta = JSON.parse(fs.readFileSync(f.files.meta)); mutate(meta); f.write('meta', meta); unknown(f.diagnose());
  }
  const f = fixture(t); f.endpoint.hook_root = join(f.root, 'other-hooks'); unknown(f.diagnose());
});

test('result operation, integrity and event correspondence failures remain unconfirmed', t => {
  for (const mutate of [row => { row.operation_id = 'sha256:' + '2'.repeat(64); }, row => { row.text += 'changed'; },
    row => { row.result_bytes++; }, row => { row.result_digest = 'f'.repeat(64); }, row => { row.vendor_session_id = parentConversation; },
    row => { row.schema = 'aiterm.claude-turn-result.v1'; }]) {
    const f = fixture(t), value = structuredClone(f.result); mutate(value); f.write('result', value); unknown(f.diagnose());
  }
});

test('Stop reason or turn absence does not become interruption proof and conflicting event fields remain unconfirmed', t => {
  for (const mutate of [row => { delete row.reason; }, row => { row.reason = 'interrupted'; }, row => { row.turn_id = 'unproven-native-turn'; },
    row => { row.operation_id = 'sha256:' + '3'.repeat(64); }, row => { row.launch_id = 'd'.repeat(32); },
    row => { row.result_digest = '0'.repeat(64); }, row => { row.vendor_session_id = parentConversation; }]) {
    const f = fixture(t), event = structuredClone(f.event); mutate(event);
    fs.writeFileSync(f.files.events, f.prefix + JSON.stringify(event) + '\n'); unknown(f.diagnose());
  }
});

test('historical Stop before saved cursor, duplicate candidates, malformed and partial events do not use latest-event inference', t => {
  for (const mode of ['before', 'duplicate', 'malformed', 'partial', 'interior']) {
    const f = fixture(t), line = JSON.stringify(f.event) + '\n';
    if (mode === 'before') f.binding.child.boundary.event_cursor = fs.statSync(f.files.events).size;
    if (mode === 'duplicate') fs.appendFileSync(f.files.events, line);
    if (mode === 'malformed') fs.appendFileSync(f.files.events, '{bad json}\n');
    if (mode === 'partial') fs.writeFileSync(f.files.events, f.prefix + line.trimEnd());
    if (mode === 'interior') f.binding.child.boundary.event_cursor++;
    unknown(f.diagnose());
  }
});

test('unsafe symlink/hardlink or oversized file is not followed or rewritten by the read-only adapter', t => {
  for (const mode of ['symlink', 'hardlink', 'oversize']) {
    const f = fixture(t), copy = f.files.result + '.copy'; fs.renameSync(f.files.result, copy);
    if (mode === 'symlink') fs.symlinkSync(copy, f.files.result);
    if (mode === 'hardlink') fs.linkSync(copy, f.files.result);
    if (mode === 'oversize') fs.writeFileSync(f.files.result, 'x'.repeat(4 * 1024 * 1024 + 4097));
    unknown(f.diagnose()); assert.equal(fs.existsSync(copy), true);
  }
});

test('scope loss before or after a file snapshot cannot yield a recorded correlation or write native state', t => {
  const f = fixture(t), before = f.snapshot(); f.unScope(); unknown(f.diagnose()); assert.deepEqual(f.snapshot(), before);
  const g = fixture(t); let calls = 0;
  const adapter = createClaudeParentRecordDiagnosis({ stateRoot: g.root, assertScope() { if (++calls === 2) throw Error('synthetic scope changed'); } });
  unknown(adapter(g.binding, g.endpoint)); assert.equal(calls, 2);
});


test('file replacement during the final scope check invalidates an otherwise matching historical correlation', t => {
  const f = fixture(t); let calls = 0;
  const adapter = createClaudeParentRecordDiagnosis({ stateRoot: f.root, assertScope() {
    if (++calls === 2) { const value = { ...f.result, text: 'synthetic changed during snapshot' }; f.write('result', value); }
  } });
  unknown(adapter(f.binding, f.endpoint)); assert.equal(calls, 2);
  assert.equal(JSON.parse(fs.readFileSync(f.files.result)).text, 'synthetic changed during snapshot', 'diagnosis never repairs or restores the record');
});
