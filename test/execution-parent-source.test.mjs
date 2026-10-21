import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createParentSourceEvidence } from '../dist/execution-parent-source.js';
import { withExecutionRequest, currentExecutionIngress } from '../dist/execution-context.js';
import { codexParentFromRequest } from '../dist/codex-parent-receiver.js';
import { createExecutionDispatcher } from '../dist/execution-dispatch.js';
import { createExecutionParentAdapter } from '../dist/execution-parent.js';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
import { ExecutionService } from '../dist/execution-service.js';
import { FileExecutionStore } from '../dist/execution-store.js';
import { guardTmuxExecution } from '../dist/execution-effect.js';
import { EXECUTION_ERROR_META_KEY as ERROR } from '../dist/execution-wire.js';

const A = { session_id: 'bot-a', launch_id: 'a'.repeat(32) };
const B = { session_id: 'bot-b', launch_id: 'b'.repeat(32) };
const point = (launch, cursor = null) => ({ launch: { ...launch }, boundary: cursor === null ? null
  : { event_cursor: cursor, operation_id: null, turn_id: null, steer_id: null } });
const harness = { pid: 20, started_identity: '2026-10-21T07:00:00Z' };
const actor = { pid: 22, started_identity: '2026-10-21T07:00:02Z' };
const request = { kind: 'mcp', process_pid: actor.pid, process_started_identity: actor.started_identity,
  request_id: 41, tool: 'pty_send', target_session_id: B.session_id };
const thread = '00000000-0000-4000-8000-000000000001';
const id = '00000000-0000-4000-8000-000000000002';
const env = { AITERM_SESSION_ID: A.session_id, AITERM_AGENT_LAUNCH_ID: A.launch_id };
const pause = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const code = expected => error => error.code === expected;
function fixture() {
  const snapshot = { schema: 'aiterm.execution-parent-process.v1', source: point(A), harness: 'codex-cli', harness_process: { ...harness },
    processes: [{ ...harness, parent_pid: 19 }, { pid: 21, parent_pid: 20, started_identity: '2026-10-21T07:00:01Z' },
      { ...actor, parent_pid: 21 }] };
  const metadata = { threadId: thread, unrelated: 'not persisted' };
  const endpoint = codexParentFromRequest('codex-mcp-client', metadata);
  const ingress = { source: point(A), client_name: 'codex-mcp-client', native_identity: { ...actor }, metadata };
  const bindings = { decode: codexParentFromRequest, observeParentProcess: () => structuredClone(snapshot) };
  const evidence = createParentSourceEvidence(bindings);
  const capture = () => withExecutionRequest(request, () => evidence.capture(endpoint), ingress);
  return { snapshot, metadata, endpoint, ingress, bindings, evidence, capture };
}
test('actual native decoder and native process lineage bind the same verified generation without inventing a turn', () => {
  const f = fixture(), proof = f.capture();
  assert.deepEqual(proof.request, request); assert.deepEqual(proof.source, point(A));
  assert.deepEqual(proof.harness_process, harness); assert.deepEqual(proof.mcp_process, actor);
  assert.deepEqual(proof.endpoint, { vendor: 'codex', thread_id: thread });
  assert.equal(JSON.stringify(proof).includes('not persisted'), false);
  assert.equal(JSON.stringify(proof).includes(f.endpoint.codex_home), false);
  f.evidence.verify(point(A), f.endpoint, proof, true);
  assert.equal(currentExecutionIngress(), null);
});
test('native metadata and environment source are detached before an asynchronous body can be steered', async () => {
  const f = fixture(), entered = pause(), release = pause();
  const pending = withExecutionRequest(request, async () => {
    entered.resolve(); await release.promise; return f.evidence.capture(f.endpoint);
  }, f.ingress);
  await entered.promise;
  f.metadata.threadId = '00000000-0000-4000-8000-000000000099';
  f.ingress.source.launch.launch_id = 'e'.repeat(32); f.ingress.native_identity.started_identity = 'mutated';
  release.resolve(); const proof = await pending;
  assert.deepEqual(proof.source, point(A)); assert.equal(proof.endpoint.thread_id, thread);
});
test('a model endpoint cannot replace the native decoded endpoint even for another real thread', () => {
  const f = fixture();
  assert.throws(() => withExecutionRequest(request, () => f.evidence.capture({ ...f.endpoint,
    thread_id: '00000000-0000-4000-8000-000000000099' }), f.ingress), code('EXECUTION_CONFLICT'));
});
test('missing ingress, unverified source, host refs and an unrecognized native client are not filled from current seats', () => {
  for (const change of ['none', 'source', 'host', 'client', 'actor']) {
    const f = fixture(); let ref = request;
    if (change === 'source') f.ingress.source = null;
    if (change === 'host') ref = { kind: 'delivery', delivery_id: 'existing-host', target_session_id: B.session_id };
    if (change === 'client') f.ingress.client_name = 'bellteam';
    if (change === 'actor') f.ingress.native_identity = null;
    assert.throws(() => withExecutionRequest(ref, () => f.evidence.capture(f.endpoint), change === 'none' ? undefined : f.ingress));
  }
});
test('PID reuse, disconnected ancestry, cycles, duplicate rows and unparseable native starts refuse capture', () => {
  for (const change of ['reused', 'disconnected', 'cycle', 'duplicate', 'unknown-time', 'newer-parent']) {
    const f = fixture(), row = f.snapshot.processes.at(-1);
    if (change === 'reused') row.started_identity = '2026-10-21T07:01:00Z';
    if (change === 'disconnected') row.parent_pid = 123;
    if (change === 'cycle') f.snapshot.processes[1].parent_pid = actor.pid;
    if (change === 'duplicate') f.snapshot.processes.push({ ...row });
    if (change === 'unknown-time') row.started_identity = f.ingress.native_identity.started_identity = 'missing-start';
    if (change === 'newer-parent') f.snapshot.processes[1].started_identity = '2026-10-21T07:01:00Z';
    assert.throws(f.capture, code('EXECUTION_UNCONFIRMED'), change);
  }
});
test('same-name new generation, changed unique harness and wrong vendor never adopt cached endpoint provenance', () => {
  for (const change of ['generation', 'harness', 'vendor', 'missing']) {
    const f = fixture(), proof = f.capture();
    if (change === 'generation') f.snapshot.source.launch.launch_id = 'e'.repeat(32);
    if (change === 'harness') f.snapshot.harness_process.started_identity = f.snapshot.processes[0].started_identity = '2026-10-21T07:01:00Z';
    if (change === 'vendor') f.snapshot.harness = 'claude-code';
    if (change === 'missing') f.bindings.observeParentProcess = () => null;
    assert.throws(() => f.evidence.verify(point(A), f.endpoint, proof));
  }
});
test('a continuation retains original provenance after serving MCP exit but never rebinds another actor at initial send', () => {
  const f = fixture(), proof = f.capture(); f.snapshot.processes.pop();
  f.evidence.verify(point(A), f.endpoint, proof);
  assert.throws(() => f.evidence.verify(point(A), f.endpoint, proof, true), code('EXECUTION_UNCONFIRMED'));
  assert.throws(() => f.evidence.verify(point(A), f.endpoint, null), code('EXECUTION_UNSUPPORTED'));
});
test('concurrent native requests retain separate request-local source and metadata snapshots', async () => {
  const f = fixture(), release = pause();
  const one = withExecutionRequest(request, async () => { await release.promise; return f.evidence.capture(f.endpoint); }, f.ingress);
  const two = withExecutionRequest({ ...request, request_id: 42 }, async () => {
    await release.promise; return f.evidence.capture(f.endpoint);
  }, f.ingress);
  release.resolve(); assert.deepEqual((await Promise.all([one, two])).map(proof => proof.request.request_id), [41, 42]);
});
test('actual dispatcher and store bind native source evidence before send, preserve it on recovery, and require independent endpoint proof', async t => {
  const f = fixture(), directory = mkdtempSync(join(tmpdir(), 'parent-source-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new FileExecutionStore(directory);
  const observe = session_id => ({ schema: 'aiterm.pty-observe-result.v1', session_id, exists: true,
    launch_id: session_id === A.session_id ? A.launch_id : B.launch_id });
  const runtime = createExecutionRuntime({ sourceEnvironment: env, observeSession: observe,
    observeSessionSync: observe, async observeDone() { throw Error('no synthetic done'); } });
  const service = new ExecutionService(store, runtime);
  const bindings = { store, service, observeSessionGeneration: observe, sourceEvidence: f.evidence,
    verifyParentEndpoint: () => true }; // independent synthetic endpoint proof, never capture alone
  const parent = createExecutionParentAdapter(bindings);
  const dispatcher = createExecutionDispatcher({ service, nativeIdentity: actor, sourceEnvironment: env,
    initializedClientName: () => 'codex-mcp-client', observeSessionGeneration: observe });
  let effects = 0, proof, ref;
  const result = await dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 41, _meta: f.metadata }, async () => {
    const context = currentExecutionIngress(); ref = context.request;
    assert.deepEqual(context.ingress.source, point(A));
    proof = parent.captureEndpointEvidence(f.endpoint);
    await parent.bind(id, ref, point(B, 17), f.endpoint, proof);
    guardTmuxExecution(['send-keys', '-t', B.session_id, 'synthetic']); effects++;
    return { content: [], structuredContent: { mode: 'agent_dispatch', session_id: B.session_id, launch_id: B.launch_id, event_cursor: 17 } };
  });
  assert.equal(result.isError, undefined); assert.equal(effects, 1);
  const recovered = createExecutionParentAdapter({ ...bindings, store: new FileExecutionStore(directory) });
  assert.deepEqual((await recovered.lookup(id)).source_evidence, proof);
  const saved = readFileSync(join(directory, 'relations.json'), 'utf8');
  assert.equal(saved.includes(f.endpoint.codex_home), false); assert.equal(saved.includes('not persisted'), false);
  await assert.rejects(parent.bind('00000000-0000-4000-8000-000000000003', { ...ref, request_id: 99 }, point(B, 17), f.endpoint, proof), code('EXECUTION_CONFLICT'));
  const { verifyParentEndpoint, ...missingEndpointProof } = bindings;
  await assert.rejects(createExecutionParentAdapter(missingEndpointProof).submit(id, f.endpoint, async () => {
    assert.fail('source provenance must never replace an independent endpoint proof');
  }), code('EXECUTION_UNSUPPORTED'));
  f.snapshot.harness_process.started_identity = f.snapshot.processes[0].started_identity = '2026-10-21T07:01:00Z';
  await assert.rejects(recovered.submit(id, f.endpoint, async () => { effects++; }), code('EXECUTION_STALE_GENERATION'));
  assert.equal(effects, 1);
});
