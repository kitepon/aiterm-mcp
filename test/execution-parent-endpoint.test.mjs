import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createParentSourceEvidence } from '../dist/execution-parent-source.js';
import { createNativeParentEndpointEvidence } from '../dist/execution-parent-endpoint.js';
import { withExecutionRequest } from '../dist/execution-context.js';

const A = { session_id: 'bot-a', launch_id: 'a'.repeat(32) };
const B = { session_id: 'bot-b', launch_id: 'b'.repeat(32) };
const point = launch => ({ launch: { ...launch }, boundary: null });
const harness = { pid: 20, started_identity: '2026-10-21T07:00:00Z' };
const mcp = { pid: 22, started_identity: '2026-10-21T07:00:02Z' };
const hook = { pid: 24, started_identity: '2026-10-21T07:00:03Z' };
const uuid = '00000000-0000-4000-8000-000000000001';
const id = '00000000-0000-4000-8000-000000000002';
const request = { kind: 'mcp', process_pid: mcp.pid, process_started_identity: mcp.started_identity,
  request_id: 41, tool: 'pty_send', target_session_id: B.session_id };
const write = (file, value) => writeFileSync(file, JSON.stringify(value));
function fixture(t, vendor) {
  const root = mkdtempSync(join(tmpdir(), 'native-endpoint-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const endpoint = vendor === 'codex' ? { thread_id: uuid, codex_home: root }
    : vendor === 'claude' ? { kind: 'claude', session_id: uuid, request_id: 'existing-tool-use', hook_root: root }
    : { kind: 'cursor', hook_root: root };
  const context = vendor === 'codex' ? { session_id: uuid, turn_id: 'existing-native-turn' }
    : vendor === 'claude' ? { session_id: uuid, tool_use_id: 'existing-tool-use' }
    : { conversation_id: 'native-conversation:one', hook_event_name: 'postToolUse' };
  const snapshot = { schema: 'aiterm.execution-parent-process.v1', source: point(A),
    harness: { codex: 'codex-cli', claude: 'claude-code', cursor: 'cursor-cli' }[vendor], harness_process: { ...harness },
    processes: [{ ...harness, parent_pid: 19 }, { ...mcp, parent_pid: 20 }, { ...hook, parent_pid: 20 }] };
  const sourceEvidence = createParentSourceEvidence({
    // Native decoder-only input is synthetic here; actual Codex decoder is
    // separately exercised in execution-parent-source. No claim echo as runtime proof.
    decode: () => structuredClone(endpoint), observeParentProcess: () => structuredClone(snapshot) });
  const source = withExecutionRequest(request, () => sourceEvidence.capture(endpoint), {
    source: point(A), client_name: 'synthetic-native-client', native_identity: mcp, metadata: null });
  const binding = { delivery_id: id, request: structuredClone(request), parent: point(A), child: point(B),
    endpoint_digest: '1'.repeat(64), source_evidence: source };
  let directory = root;
  if (vendor === 'claude') {
    directory = join(root, endpoint.request_id); mkdirSync(directory);
    write(join(directory, 'request.json'), { request_id: endpoint.request_id, session_id: uuid,
      agent_id: null, parent_pid: harness.pid, parent_started_identity: harness.started_identity });
    write(join(directory, 'delivery.json'), { delivery_id: id });
  }
  if (vendor === 'cursor') {
    directory = join(root, 'deliveries', id); mkdirSync(directory, { recursive: true });
    write(join(directory, 'bind.json'), { conversation_id: context.conversation_id, created_at: 'native-fixture-record' });
  }
  const options = { actor: { ...hook }, sourceEvidence, codexHome: root, claudeHookRoot: root, cursorHookRoot: root };
  const verify = createNativeParentEndpointEvidence(options);
  return { root, directory, endpoint, context, snapshot, binding, options, verify,
    check: (native = context, record = binding) => verify(point(A), endpoint, native, record) };
}
test('Codex hook proof matches native thread and process lineage, without making turn_id a dispatch alias', t => {
  const f = fixture(t, 'codex'); assert.equal(f.check(), true);
  assert.equal(f.check({ ...f.context, session_id: '00000000-0000-4000-8000-000000000099' }), false);
  assert.deepEqual(f.binding.parent, point(A)); assert.equal(f.binding.source_evidence.source.boundary, null);
  assert.throws(() => f.check({ session_id: uuid }), error => error.code === 'EXECUTION_UNCONFIRMED');
});
test('Claude hook uses the actual request, owner identity and exact existing delivery binding', t => {
  const f = fixture(t, 'claude'); assert.equal(f.check(), true);
  assert.equal(f.check({ ...f.context, tool_use_id: 'other-native-tool-use' }), false);
  write(join(f.directory, 'delivery.json'), { delivery_id: '00000000-0000-4000-8000-000000000099' });
  assert.equal(f.check(), false);
  write(join(f.directory, 'delivery.json'), { delivery_id: id });
  write(join(f.directory, 'request.json'), { request_id: 'existing-tool-use', session_id: uuid,
    agent_id: null, parent_pid: harness.pid, parent_started_identity: 'reused-parent' });
  assert.throws(() => f.check(), error => error.code === 'EXECUTION_UNCONFIRMED');
});
test('Claude closed requests and native subagents are not redirected to a current parent', t => {
  const f = fixture(t, 'claude');
  write(join(f.directory, 'closed.json'), {}); assert.equal(f.check(), false); rmSync(join(f.directory, 'closed.json'));
  write(join(f.directory, 'request.json'), { request_id: 'existing-tool-use', session_id: uuid,
    agent_id: 'native-subagent', parent_pid: harness.pid, parent_started_identity: harness.started_identity });
  assert.equal(f.check(), false);
});
test('Cursor root-only ingress is completed only by that delivery native conversation binding', t => {
  const f = fixture(t, 'cursor'); assert.equal(f.check(), true);
  assert.equal(f.check({ ...f.context, conversation_id: 'another-native-conversation' }), false);
  rmSync(join(f.directory, 'bind.json'));
  assert.throws(() => f.check(), error => error.code === 'EXECUTION_UNCONFIRMED');
});
test('each worker has its own actor and configured scope; metadata alone does not grant another process or root', t => {
  for (const vendor of ['codex', 'claude', 'cursor']) {
    const f = fixture(t, vendor), key = { codex: 'codexHome', claude: 'claudeHookRoot', cursor: 'cursorHookRoot' }[vendor];
    const wrongScope = createNativeParentEndpointEvidence({ ...f.options, [key]: join(f.root, 'other') });
    assert.equal(wrongScope(point(A), f.endpoint, f.context, f.binding), false);
    const unknownScope = createNativeParentEndpointEvidence({ ...f.options, [key]: null });
    assert.throws(() => unknownScope(point(A), f.endpoint, f.context, f.binding), error => error.code === 'EXECUTION_UNSUPPORTED');
    f.snapshot.processes.at(-1).parent_pid = 900;
    assert.throws(() => f.check(), error => error.code === 'EXECUTION_UNCONFIRMED');
  }
});
test('missing proof, native event, actor or replaced generation never opens an effect gate', t => {
  const f = fixture(t, 'codex');
  const missing = createNativeParentEndpointEvidence({ ...f.options, actor: null });
  assert.throws(() => missing(point(A), f.endpoint, f.context, f.binding), error => error.code === 'EXECUTION_UNSUPPORTED');
  assert.throws(() => f.verify(point(A), f.endpoint, undefined, f.binding), error => error.code === 'EXECUTION_UNSUPPORTED');
  assert.throws(() => f.check(f.context, { ...f.binding, source_evidence: undefined }), error => error.code === 'EXECUTION_UNSUPPORTED');
  f.snapshot.source.launch.launch_id = 'e'.repeat(32);
  assert.throws(() => f.check(), error => error.code === 'EXECUTION_STALE_GENERATION');
});
test('roots, process identity and native input are not overwritten by later changes to factory arguments', t => {
  const f = fixture(t, 'codex'); f.options.actor.pid = 999; f.options.codexHome = 'relative';
  assert.equal(f.check(), true);
  assert.throws(() => createNativeParentEndpointEvidence({ ...f.options }), error => error.code === 'EXECUTION_INVALID');
});

test('Claude hook owner cannot be replaced by a live MCP or hook descendant from the same harness lineage', t => {
  const f = fixture(t, 'claude'); assert.equal(f.check(), true);
  for (const actor of [mcp, hook]) {
    write(join(f.directory, 'request.json'), { request_id: 'existing-tool-use', session_id: uuid, agent_id: null,
      parent_pid: actor.pid, parent_started_identity: actor.started_identity });
    assert.equal(f.check(), false, 'an observed descendant is not the fixed native CLI owner');
  }
});
