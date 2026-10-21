import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionParentProducer } from '../dist/execution-parent-producer.js';
import { withExecutionRequest } from '../dist/execution-context.js';
import { EXECUTION_ERROR_META_KEY as ERROR } from '../dist/execution-wire.js';

const A = { session_id: 'bot-a', launch_id: 'a'.repeat(32) }, B = { session_id: 'bot-b', launch_id: 'b'.repeat(32) };
const point = (launch, cursor = null) => ({ launch: { ...launch }, boundary: cursor === null ? null
  : { event_cursor: cursor, operation_id: null, turn_id: null, steer_id: null } });
const harness = { pid: 20, started_identity: '2026-10-21T07:00:00Z' }, mcp = { pid: 22, started_identity: '2026-10-21T07:00:01Z' };
const session = '00000000-0000-4000-8000-000000000001', id = '00000000-0000-4000-8000-000000000002';
const request = { kind: 'mcp', process_pid: mcp.pid, process_started_identity: mcp.started_identity,
  request_id: 41, tool: 'pty_send', target_session_id: B.session_id };
const code = expected => error => error.code === expected;
const write = (file, value) => writeFileSync(file, JSON.stringify(value));
const pause = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(t, vendor = 'claude') {
  const root = mkdtempSync(join(tmpdir(), 'parent-producer-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const actualScope = { state_root: root, multiplexer: { kind: 'socket', key: join(root, 'synthetic.sock') } };
  const endpoint = vendor === 'claude' ? { kind: 'claude', session_id: session, request_id: 'existing-tool-use', hook_root: join(root, 'claude-parent-hooks') }
    : vendor === 'codex' ? { thread_id: session, codex_home: root } : { kind: 'cursor', hook_root: join(root, 'cursor-parent-hooks') };
  const snapshot = { schema: 'aiterm.execution-parent-process.v1', source: point(A),
    harness: { claude: 'claude-code', codex: 'codex-cli', cursor: 'cursor-cli' }[vendor], harness_process: { ...harness },
    processes: [{ ...harness, parent_pid: 19 }, { ...mcp, parent_pid: 20 }] };
  const invocation = { request_id: 'existing-tool-use', session_id: session, agent_id: null,
    parent_pid: harness.pid, parent_started_identity: harness.started_identity };
  const directory = join(root, 'claude-parent-hooks', invocation.request_id); mkdirSync(directory, { recursive: true });
  write(join(directory, 'request.json'), invocation);
  const profile = { id: 'synthetic', state_root: () => root };
  const provider = { withDeliveryEffect() {}, DELIVERY_ADMISSION_CONTRACT: { schema: 'steer.delivery-admission.v1', native_context: true,
    cursor_profile_parameter: true, serialized_required: true, multi_delivery_emit: true },
    async submitClaudeParentAnswer(profile, parent, delivery_id, text) {
      await profile.delivery_admission.run({ vendor: 'claude', stage: 'queue', endpoint: parent, delivery_ids: [delivery_id] },
        async () => { write(join(directory, 'answer.json'), { delivery_id, text }); });
      return { queued_submission_id: null };
    }, submitCodexParentAnswer() { assert.fail('unsupported native endpoint must not reach a vendor submit'); },
    submitCursorParentAnswer() { assert.fail('unsupported native endpoint must not reach a vendor submit'); },
  };
  const runtime = { scope: () => structuredClone(actualScope), actor: () => ({ ...mcp }),
    observeParentProcess: () => structuredClone(snapshot),
    observeSessionGeneration: session_id => ({ schema: 'aiterm.pty-observe-result.v1', session_id, exists: true,
      launch_id: session_id === A.session_id ? A.launch_id : B.launch_id }),
    sourceEnvironment: () => ({ AITERM_SESSION_ID: A.session_id, AITERM_AGENT_LAUNCH_ID: A.launch_id }),
    // Fake native decoder; native generation/lineage and files are independent.
    decodeParent: (_, meta) => meta?.tool === 'existing-tool-use' ? structuredClone(endpoint) : null,
    async observeDone() { throw Error('no synthetic completion evidence'); },
  };
  const options = { profile, provider, runtime, expectedScope: structuredClone(actualScope) };
  const producer = createExecutionParentProducer(options);
  const initialize = async () => {
    await producer.service.execute({ action: 'register', source_session_id: A.session_id,
      reservation: { schema: 'aiterm.execution-reservation.v1', request, source: point(A),
        target: { session_id: B.session_id, expected_launch_id: B.launch_id } } });
  };
  const bind = async () => {
    const ingress = { source: point(A), client_name: 'synthetic-native-client', native_identity: mcp, metadata: { tool: 'existing-tool-use' } };
    const native_parent = withExecutionRequest(request, producer.startup.captureNativeParent, ingress);
    const proof = withExecutionRequest(request, () => producer.execution.captureEndpointEvidence(endpoint), { ...ingress, native_parent });
    await producer.execution.bind(id, request, point(B, 17), endpoint, proof);
    return proof;
  };
  const accept = async () => producer.service.invoke({ schema: 'aiterm.execution-ref.v1', request }, 'send',
    async () => ({ value: null, target: point(B, 17) }));
  return { root, directory, endpoint, snapshot, invocation, options, producer, actualScope, initialize, bind, accept };
}
test('same-scope producer binds real existing Claude records then accepts the original queue exactly once', async t => {
  const f = fixture(t); await f.initialize(); const proof = await f.bind();
  assert.equal(existsSync(join(f.directory, 'delivery.json')), false, 'Aiterm companion precedes the native manager binding');
  write(join(f.directory, 'delivery.json'), { delivery_id: id }); await f.accept();
  assert.deepEqual(await f.producer.execution.submit(f.endpoint, id, 'synthetic answer'), { queued_submission_id: null });
  assert.deepEqual(JSON.parse(readFileSync(join(f.directory, 'answer.json'))), { delivery_id: id, text: 'synthetic answer' });
  assert.deepEqual((await f.producer.parent.lookup(id)).source_evidence, proof);
  await assert.rejects(f.producer.execution.submit(f.endpoint, id, 'duplicate answer'));
  assert.equal(f.producer.relation_coverage, 'incomplete'); assert.equal(f.options.profile.delivery_admission, undefined);
});
test('current Claude owner, tool/session and closed record are independently required even when source generation matches', async t => {
  for (const change of ['owner', 'session', 'tool', 'subagent', 'closed', 'scope']) {
    const f = fixture(t); await f.initialize();
    if (change === 'owner') f.invocation.parent_started_identity = 'reused-owner';
    if (change === 'session') f.invocation.session_id = '00000000-0000-4000-8000-000000000099';
    if (change === 'tool') f.invocation.request_id = 'other-tool';
    if (change === 'subagent') f.invocation.agent_id = 'native-subagent';
    if (change === 'closed') write(join(f.directory, 'closed.json'), {});
    if (change === 'scope') f.actualScope.multiplexer.key = join(f.root, 'other.sock');
    write(join(f.directory, 'request.json'), f.invocation);
    await assert.rejects(f.bind()); assert.equal(existsSync(join(f.directory, 'answer.json')), false);
  }
});
test('delivery binding is mandatory for queue and a conflicting previous binding cannot be overwritten at before_send', async t => {
  const f = fixture(t); await f.initialize(); await f.bind(); await f.accept();
  await assert.rejects(f.producer.execution.submit(f.endpoint, id, 'missing-native-binding'), code('EXECUTION_UNCONFIRMED'));
  write(join(f.directory, 'delivery.json'), { delivery_id: '00000000-0000-4000-8000-000000000099' });
  await assert.rejects(f.producer.execution.submit(f.endpoint, id, 'other-binding'), code('EXECUTION_STALE_GENERATION'));
  await assert.rejects(f.bind(), code('EXECUTION_STALE_GENERATION'));
  assert.equal(existsSync(join(f.directory, 'answer.json')), false);
});
test('queue preparing cannot act after its actual native request/owner changes', async t => {
  const f = fixture(t); await f.initialize(); await f.bind(); await f.accept();
  write(join(f.directory, 'delivery.json'), { delivery_id: id });
  const entered = pause(), release = pause(); let effects = 0;
  const pending = f.producer.parent.submit(id, f.endpoint, async (_, __, issue) => {
    entered.resolve(); await release.promise; issue(); effects++; return { queued_submission_id: null };
  });
  await entered.promise; write(join(f.directory, 'closed.json'), {}); release.resolve();
  const result = await pending;
  assert.equal(result._meta[ERROR].effect, 'not_started'); assert.equal(effects, 0);
});
test('Codex/Cursor lack a current producer endpoint proof and never fall back to same-name or old submit', async t => {
  for (const vendor of ['codex', 'cursor']) {
    const f = fixture(t, vendor); await f.initialize();
    await assert.rejects(f.bind(), code('EXECUTION_UNSUPPORTED'));
    assert.equal(existsSync(join(f.directory, 'answer.json')), false);
  }
});
test('old provider and partial runtime refuse without live observation fallback', t => {
  const f = fixture(t);
  assert.throws(() => createExecutionParentProducer({ ...f.options, provider: undefined }), code('EXECUTION_UNSUPPORTED'));
  assert.throws(() => createExecutionParentProducer({ ...f.options, runtime: { scope() { assert.fail('partial runtime must not be probed'); } } }), code('EXECUTION_UNSUPPORTED'));
});
test('a different serving process cannot inherit the original native request provenance for queue publication', async t => {
  const f = fixture(t); await f.initialize(); const proof = await f.bind();
  const other = createExecutionParentProducer({ ...f.options, runtime: { ...f.options.runtime,
    actor: () => ({ pid: 99, started_identity: '2026-10-21T07:00:04Z' }) } });
  await assert.rejects(other.execution.bind(id, request, point(B, 17), f.endpoint, proof), code('EXECUTION_CONFLICT'));
  assert.equal(existsSync(join(f.directory, 'answer.json')), false);
});

test('serving producer cannot decode a fresh parent later when its original ingress snapshot is missing', t => {
  const f = fixture(t);
  assert.throws(() => withExecutionRequest(request, () => f.producer.execution.captureEndpointEvidence(f.endpoint), {
    source: point(A), client_name: 'synthetic-native-client', native_identity: mcp, metadata: { tool: 'existing-tool-use' },
  }), code('EXECUTION_UNSUPPORTED'));
});


test('post-bind companion revalidates the original frozen source/owner and uses only the selected provider', async t => {
  const f = fixture(t); let writes = 0;
  // This fixture tests provenance revalidation; the provider's synchronous
  // metadata writer is synthetic, not native input/alias/finish evidence.
  f.options.provider.bindClaudeParentDelivery = () => { writes++; };
  const producer = createExecutionParentProducer(f.options);
  await producer.service.execute({ action: 'register', source_session_id: A.session_id,
    reservation: { schema: 'aiterm.execution-reservation.v1', request, source: point(A),
      target: { session_id: B.session_id, expected_launch_id: B.launch_id } } });
  const ingress = { source: point(A), client_name: 'synthetic-native-client', native_identity: mcp, metadata: { tool: 'existing-tool-use' } };
  const native_parent = withExecutionRequest(request, producer.startup.captureNativeParent, ingress);
  await withExecutionRequest(request, async () => {
    const proof = producer.execution.captureEndpointEvidence(f.endpoint);
    await producer.execution.bind(id, request, point(B, 17), f.endpoint, proof);
    f.invocation.parent_pid = mcp.pid; f.invocation.parent_started_identity = mcp.started_identity;
    write(join(f.directory, 'request.json'), f.invocation);
    assert.throws(() => producer.execution.prepareCompanion(id, f.endpoint, proof), code('EXECUTION_STALE_GENERATION'));
    assert.equal(writes, 0); assert.equal(existsSync(join(f.directory, 'delivery.json')), false);
    f.invocation.parent_pid = harness.pid; f.invocation.parent_started_identity = harness.started_identity;
    write(join(f.directory, 'request.json'), f.invocation);
    const other = { delivery_id: '00000000-0000-4000-8000-000000000099' };
    write(join(f.directory, 'delivery.json'), other);
    assert.throws(() => producer.execution.prepareCompanion(id, f.endpoint, proof), code('EXECUTION_CONFLICT'));
    assert.equal(writes, 0); assert.deepEqual(JSON.parse(readFileSync(join(f.directory, 'delivery.json'))), other);
  }, { ...ingress, native_parent });
});


test('private original-owner observer captures the injected callback and rejects a replaced scope before native diagnosis', t => {
  const f = fixture(t); const pids = [];
  f.options.runtime.observeOriginOwner = pid => { pids.push(pid); return { state: 'absent', pid }; };
  const producer = createExecutionParentProducer(f.options);
  f.options.runtime.observeOriginOwner = () => assert.fail('later runtime replacement must not alter the captured original-owner observer');
  assert.deepEqual(producer.execution.observeOriginOwner(417), { state: 'absent', pid: 417 });
  assert.deepEqual(pids, [417]);
  f.actualScope.multiplexer.key += '-replaced';
  assert.throws(() => producer.execution.observeOriginOwner(417), code('EXECUTION_UNSUPPORTED'));
  assert.deepEqual(pids, [417], 'no native read after scope loss');
});

test('injected producer with no native origin observer stays unsupported instead of calling the default process observer', t => {
  const f = fixture(t); assert.equal(f.producer.execution.observeOriginOwner, undefined);
  f.options.runtime.observeOriginOwner = 'not a callback';
  assert.throws(() => createExecutionParentProducer(f.options), code('EXECUTION_UNSUPPORTED'));
});
