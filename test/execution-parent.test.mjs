// Historical destructive close/admission fixtures use closeCascade explicitly.
// These are not acceptance evidence for the session-preserving stop control.
import './seat-env.mjs';
import test from 'node:test';
// These integration cases require the private POSIX file/directory checkpoint.
const posixCheckpoint = process.platform === 'win32' ? 'private native graph requires POSIX directory fsync' : false;
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionParentAdapter } from '../dist/execution-parent.js';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
import { ExecutionService } from '../dist/execution-service.js';
import { FileExecutionStore } from '../dist/execution-store.js';
import { EXECUTION_BINDING_META_KEY as BINDING, EXECUTION_ERROR_META_KEY as ERROR } from '../dist/execution-wire.js';

const A = { session_id: 'bot-a', launch_id: 'a'.repeat(32) };
const B = { session_id: 'bot-b', launch_id: 'b'.repeat(32) };
const point = (launch, cursor = null) => ({ launch, boundary: cursor === null ? null
  : { event_cursor: cursor, operation_id: null, turn_id: null, steer_id: null } });
const originalRequest = { kind: 'delivery', delivery_id: 'original-existing-dispatch', target_session_id: B.session_id };
const id = '00000000-0000-4000-8000-000000000001';
const endpoint = { kind: 'codex', thread_id: '00000000-0000-4000-8000-000000000002', codex_home: '/synthetic/native-parent-home' };
const pause = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const code = expected => error => error.code === expected;
const ref = { schema: 'aiterm.execution-ref.v1', request: originalRequest };
const stop = roots => ({ schema: 'aiterm.cascade-stop-request.v1', roots });
async function fixture(accepted = true, nativeDone = false) {
  const directory = mkdtempSync(join(tmpdir(), 'execution-parent-')), store = new FileExecutionStore(directory);
  const live = new Map([A, B].map(value => [value.session_id, value]));
  let endpointMatches = true;
  const observe = session_id => ({ schema: 'aiterm.pty-observe-result.v1', session_id,
    exists: live.has(session_id), launch_id: live.get(session_id)?.launch_id ?? null });
  const runtime = createExecutionRuntime({ sourceEnvironment: { AITERM_SESSION_ID: A.session_id, AITERM_AGENT_LAUNCH_ID: A.launch_id },
    observeSession: observe, observeSessionSync: observe, async observeDone(session_id) {
      if (!nativeDone) throw Error('unused synthetic wait');
      return { schema: 'aiterm.agent-wait-result.v1', session_id, launch_id: B.launch_id,
        outcome: 'done', operation_id: null, turn_id: 'synthetic-native-turn' };
    }, invocationFence: async () => 'closed',
    async guardedClose(expected) { assert.deepEqual(live.get(expected.session_id), expected); live.delete(expected.session_id); } });
  const service = new ExecutionService(store, runtime, 500);
  const bindings = { store, service, observeSessionGeneration: observe,
    verifyParentEndpoint(parent, actual) { return endpointMatches && JSON.stringify(parent.launch) === JSON.stringify(A)
      && actual.thread_id === endpoint.thread_id && actual.codex_home === endpoint.codex_home; } };
  const adapter = createExecutionParentAdapter(bindings);
  await service.execute({ action: 'register', source_session_id: A.session_id,
    reservation: { schema: 'aiterm.execution-reservation.v1', request: originalRequest,
      source: point(A), target: { session_id: B.session_id, expected_launch_id: B.launch_id } } });
  const accept = () => service.invoke(ref, 'send', async () => ({ value: null, target: point(B, 17) }));
  if (accepted) await accept();
  return { directory, store, service, bindings, adapter, live, accept, setEndpointMatches(value) { endpointMatches = value; } };
}
test('existing delivery binds the original verified parent generation and canonical before_send child reference without payload', { skip: posixCheckpoint }, async () => {
  const f = await fixture(), binding = await f.adapter.bind(id, originalRequest, point(B, 17), endpoint);
  assert.deepEqual(binding.parent, point(A)); assert.deepEqual(binding.child, point(B, 17));
  const reconstructed = createExecutionParentAdapter(f.bindings);
  assert.deepEqual(await reconstructed.lookup(id), binding);
  const saved = readFileSync(join(f.directory, 'relations.json'), 'utf8');
  assert.equal(saved.includes(endpoint.codex_home), false);
  assert.equal(saved.includes('answer text'), false);
  assert.match(binding.endpoint_digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(await f.adapter.bind(id, originalRequest, point(B, 17), endpoint), binding);
  await assert.rejects(f.adapter.bind(id, originalRequest, point(B, 18), endpoint), code('EXECUTION_CONFLICT'));
});
test('an accepted official submit uses the same existing delivery ID, records a mechanical return edge and never marks execution complete', { skip: posixCheckpoint }, async () => {
  const f = await fixture(); await f.adapter.bind(id, originalRequest, point(B, 17), endpoint);
  let effects = 0;
  const result = await f.adapter.submit(id, endpoint, async (binding, fixedEndpoint, issue) => {
    assert.deepEqual(binding.parent, point(A)); assert.deepEqual(fixedEndpoint, endpoint);
    issue(); effects++; return { queued_submission_id: 'existing-official-queue-receipt' };
  });
  assert.equal(result.isError, undefined); assert.equal(effects, 1);
  const binding = result._meta[BINDING];
  assert.deepEqual(binding.request, { kind: 'delivery', delivery_id: id, target_session_id: A.session_id });
  assert.deepEqual(binding.source.point, point(B, 17));
  assert.deepEqual(binding.target, point(A));
  const record = await f.service.execute({ action: 'status', request: binding.request });
  assert.equal(record.relation.completion, 'open');
  assert.equal(record.relation.target_fence, 'open');
  const duplicate = await f.adapter.submit(id, endpoint, async (_, __, issue) => { issue(); effects++; return { queued_submission_id: 'duplicate' }; });
  assert.equal(duplicate.isError, true); assert.equal(effects, 1);
});
test('parent vendor endpoint needs its own runtime alias proof; missing resolver and other native endpoint are refused', { skip: posixCheckpoint }, async () => {
  const f = await fixture();
  const { verifyParentEndpoint, ...withoutResolver } = f.bindings;
  await assert.rejects(createExecutionParentAdapter(withoutResolver).bind(id, originalRequest, point(B, 17), endpoint), code('EXECUTION_UNSUPPORTED'));
  await assert.rejects(f.adapter.bind(id, originalRequest, point(B, 17), { ...endpoint, thread_id: 'different-native-thread' }), code('EXECUTION_STALE_GENERATION'));
  await assert.rejects(f.adapter.lookup(id), code('EXECUTION_NOT_FOUND'));
});
test('before_send may bind while preparing but cannot emit before the original successful dispatch binding', { skip: posixCheckpoint }, async () => {
  const f = await fixture(false); await f.adapter.bind(id, originalRequest, point(B, 17), endpoint);
  let effects = 0;
  const submit = () => f.adapter.submit(id, endpoint, async (_, __, issue) => { issue(); effects++; return { queued_submission_id: null }; });
  await assert.rejects(submit(), code('EXECUTION_UNCONFIRMED')); assert.equal(effects, 0);
  await f.accept(); assert.equal((await submit()).isError, undefined); assert.equal(effects, 1);
});
test('parent replacement, child absence and missing companion cannot select the current same-name seat', { skip: posixCheckpoint }, async () => {
  for (const change of ['parent', 'child', 'missing']) {
    const f = await fixture(); await f.adapter.bind(id, originalRequest, point(B, 17), endpoint);
    if (change === 'parent') f.live.set(A.session_id, { ...A, launch_id: 'e'.repeat(32) });
    if (change === 'child') f.live.delete(B.session_id);
    let effects = 0;
    await assert.rejects(f.adapter.submit(change === 'missing' ? '00000000-0000-4000-8000-000000000099' : id,
      endpoint, async (_, __, issue) => { issue(); effects++; return { queued_submission_id: null }; }));
    assert.equal(effects, 0);
  }
});
test('a stopped child cancels deferred parent resumption and an old inherited request frame is not reused', { skip: posixCheckpoint }, async () => {
  const f = await fixture(); await f.adapter.bind(id, originalRequest, point(B, 17), endpoint);
  const entered = pause(), release = pause(); let effects = 0;
  const pending = f.adapter.submit(id, endpoint, async (_, __, issue) => {
    entered.resolve(); await release.promise; issue(); effects++; return { queued_submission_id: null };
  });
  await entered.promise;
  await f.service.closeCascade(stop([B]));
  release.resolve(); const result = await pending;
  assert.equal(result.isError, true); assert.equal(result._meta[ERROR].effect, 'not_started');
  assert.equal(effects, 0); assert.ok(f.live.has(A.session_id));
});
test('stop drains an actually issued parent return and reaches the same parent launch even when shared', { skip: posixCheckpoint }, async () => {
  const f = await fixture(); await f.adapter.bind(id, originalRequest, point(B, 17), endpoint);
  const entered = pause(), release = pause(); let effects = 0;
  const pending = f.adapter.submit(id, endpoint, async (_, __, issue) => {
    issue(); effects++; entered.resolve(); await release.promise; return { queued_submission_id: null };
  });
  await entered.promise;
  const stopping = f.service.closeCascade(stop([B]));
  await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(f.live.size, 2); release.resolve();
  assert.equal((await pending).isError, undefined);
  const result = await stopping;
  assert.deepEqual(result.targets.map(value => value.launch.session_id), [B.session_id, A.session_id]);
  assert.equal(effects, 1);
});
test('endpoint alias failure poisons the independent frame even if a vendor wrapper catches it', { skip: posixCheckpoint }, async () => {
  const f = await fixture(); await f.adapter.bind(id, originalRequest, point(B, 17), endpoint);
  let effects = 0;
  const result = await f.adapter.submit(id, endpoint, async (_, __, issue) => {
    f.setEndpointMatches(false);
    try { issue(); effects++; } catch { /* vendor catch cannot fabricate success */ }
    return { queued_submission_id: 'not-really-accepted' };
  });
  assert.equal(result.isError, true); assert.equal(result.structuredContent, undefined);
  assert.equal(effects, 0);
});
test('stronger before_send operation evidence keeps the immutable receipt boundary as the return source', { skip: posixCheckpoint }, async () => {
  const f = await fixture(), child = point(B, 17);
  child.boundary.operation_id = 'sha256:' + '1'.repeat(64);
  await f.adapter.bind(id, originalRequest, child, endpoint);
  const result = await f.adapter.submit(id, endpoint, async (_, __, issue) => { issue(); return { queued_submission_id: null }; });
  assert.deepEqual(result._meta[BINDING].source.point, point(B, 17));
  assert.equal((await f.adapter.lookup(id)).child.boundary.operation_id, child.boundary.operation_id);
});
test('an escaped official callback remains bound to its finished admission frame and cannot emit later', { skip: posixCheckpoint }, async () => {
  const f = await fixture(); await f.adapter.bind(id, originalRequest, point(B, 17), endpoint);
  let escaped, effects = 0;
  const result = await f.adapter.submit(id, endpoint, async (_, __, issue) => {
    escaped = issue; return { queued_submission_id: 'not-actually-issued' };
  });
  assert.equal(result.isError, true);
  assert.throws(() => { escaped(); effects++; });
  assert.equal(effects, 0);
});
test('an asynchronous endpoint proof is not a synchronous true even when it resolves successfully or rejects', { skip: posixCheckpoint }, async () => {
  const f = await fixture();
  for (const verifyParentEndpoint of [async () => true, async () => { throw Error('missing native proof'); }]) {
    await assert.rejects(createExecutionParentAdapter({ ...f.bindings, verifyParentEndpoint })
      .bind(id, originalRequest, point(B, 17), endpoint), code('EXECUTION_UNSUPPORTED'));
  }
  await assert.rejects(f.adapter.lookup(id), code('EXECUTION_NOT_FOUND'));
});
test('a child done cannot retire the original branch while its already bound parent return is still unissued', { skip: posixCheckpoint }, async () => {
  const f = await fixture(true, true); await f.adapter.bind(id, originalRequest, point(B, 17), endpoint);
  const finished = await f.service.execute({ action: 'finish', request: originalRequest,
    evidence: { kind: 'completion', target: point(B, 17) } });
  assert.equal(finished.relation.completion, 'completed');
  assert.equal(finished.relation.target_fence, 'unknown');
  assert.equal(finished.relation.lifecycle, 'tracking');
  let effects = 0;
  const queued = await f.adapter.submit(id, endpoint, async (_, __, issue) => { issue(); effects++; return { queued_submission_id: null }; });
  assert.equal(queued.isError, undefined); assert.equal(effects, 1);
});
test('parent queue acceptance is not a completion fence, but confirmed unissued cancellation can settle the companion', { skip: posixCheckpoint }, async () => {
  for (const accepted of [true, false]) {
    const f = await fixture(true, true); await f.adapter.bind(id, originalRequest, point(B, 17), endpoint);
    const finish = () => f.service.execute({ action: 'finish', request: originalRequest,
      evidence: { kind: 'completion', target: point(B, 17) } });
    assert.equal((await finish()).relation.target_fence, 'unknown');
    const queued = await f.adapter.submit(id, endpoint, async (_, __, issue) => {
      if (accepted) issue(); return { queued_submission_id: null };
    });
    assert.equal(!!queued.isError, !accepted);
    const after = await finish();
    assert.equal(after.relation.target_fence, accepted ? 'unknown' : 'closed');
    assert.equal(after.relation.lifecycle, accepted ? 'tracking' : 'retired');
  }
});
test('stop after local child done still reaches that child and cancels an unissued bound parent return', { skip: posixCheckpoint }, async () => {
  const f = await fixture(true, true); await f.adapter.bind(id, originalRequest, point(B, 17), endpoint);
  await f.service.execute({ action: 'finish', request: originalRequest, evidence: { kind: 'completion', target: point(B, 17) } });
  const result = await f.service.closeCascade(stop([A]));
  assert.deepEqual(new Set(result.targets.map(value => value.launch.session_id)), new Set([A.session_id, B.session_id]));
  let effects = 0;
  await assert.rejects(f.adapter.submit(id, endpoint, async (_, __, issue) => { issue(); effects++; return { queued_submission_id: null }; }));
  assert.equal(effects, 0);
});
test('the manager completion callback reobserves the canonical receipt and cannot substitute captured answer success for native done', { skip: posixCheckpoint }, async () => {
  for (const nativeDone of [true, false]) {
    const f = await fixture(true, nativeDone), beforeSend = point(B, 17);
    beforeSend.boundary.operation_id = 'sha256:' + '1'.repeat(64);
    await f.adapter.bind(id, originalRequest, beforeSend, endpoint);
    if (nativeDone) {
      const completed = await f.adapter.recordChildCompletion(id);
      assert.deepEqual(completed.relation.target, point(B, 17));
      assert.equal(completed.relation.completion, 'completed');
      assert.equal(completed.relation.target_fence, 'unknown');
    } else {
      await assert.rejects(f.adapter.recordChildCompletion(id), code('EXECUTION_UNCONFIRMED'));
      assert.equal((await f.service.execute({ action: 'status', request: originalRequest })).relation.completion, 'open');
    }
  }
});
test('parent return preflight waits only for the original dispatch receipt and never resends child or queue', { skip: posixCheckpoint }, async () => {
  const f = await fixture(false); await f.adapter.bind(id, originalRequest, point(B, 17), endpoint);
  const entered = pause(), release = pause(); let childEffects = 0, queueEffects = 0;
  const dispatch = f.service.invokeDeferred(ref, 'send', async issue => {
    entered.resolve(); await release.promise; issue(); childEffects++;
    return { value: null, target: point(B, 17) };
  });
  await entered.promise;
  const queue = f.adapter.submit(id, endpoint, async (_, __, issue) => { issue(); queueEffects++; return { queued_submission_id: null }; });
  await new Promise(resolve => setTimeout(resolve, 2)); assert.equal(queueEffects, 0);
  release.resolve(); await dispatch; assert.equal((await queue).isError, undefined);
  assert.equal(childEffects, 1); assert.equal(queueEffects, 1);
});
test('source stop cancels original-receipt preflight before any parent queue native slot is taken', { skip: posixCheckpoint }, async () => {
  const f = await fixture(false); await f.adapter.bind(id, originalRequest, point(B, 17), endpoint);
  const entered = pause(), release = pause(); let queueEffects = 0;
  const dispatch = f.service.invokeDeferred(ref, 'send', async issue => {
    entered.resolve(); await release.promise; issue(); return { value: null, target: point(B, 17) };
  }).catch(error => error);
  await entered.promise;
  const queue = f.adapter.submit(id, endpoint, async (_, __, issue) => { issue(); queueEffects++; return { queued_submission_id: null }; }).catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 2)); await f.service.closeCascade(stop([B]));
  assert.equal((await queue).code, 'EXECUTION_STOPPING'); assert.equal(queueEffects, 0);
  release.resolve(); assert.equal((await dispatch).effect, 'not_started'); assert.ok(f.live.has(A.session_id));
});
