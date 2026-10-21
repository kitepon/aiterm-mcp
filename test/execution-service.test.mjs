import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExecutionService } from '../dist/execution-service.js';
import { FileExecutionStore } from '../dist/execution-store.js';
import { planCascadeStop } from '../dist/execution-contract.js';
import { ExecutionError, executionErrorResult, executionRefFromMeta,
  EXECUTION_REQUEST_META_KEY, EXECUTION_ERROR_META_KEY, EXECUTION_BINDING_META_KEY } from '../dist/execution-wire.js';
import { runBoundExecution, runDeferredBoundExecution, registerExecutionTools } from '../dist/execution-tools.js';
import { beforeExecutionEffect, guardTmuxExecution, bindExecutionNativeTarget } from '../dist/execution-effect.js';
import { closeExpectedExecution } from '../dist/execution-close.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const launch = (name, generation = name) => ({ session_id: `bot-${name}`, launch_id: generation.repeat(32) });
const A = launch('a'), B = launch('b'), C = launch('c'), D = launch('d');
const point = (launch, cursor = 1) => ({ launch, boundary: cursor === null ? null
  : { event_cursor: cursor, operation_id: null, turn_id: null, steer_id: null } });
const request = (id, target = B) => ({ kind: 'delivery', delivery_id: id, target_session_id: target.session_id });
const ref = request => ({ schema: 'aiterm.execution-ref.v1', request });
const stop = roots => ({ schema: 'aiterm.cascade-stop-request.v1', roots });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve }; };
const code = expected => error => error instanceof ExecutionError && error.code === expected;
const until = async check => {
  const deadline = performance.now() + 1000;
  while (!await check()) {
    assert.ok(performance.now() < deadline, 'fixture condition timed out');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
};

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'execution-fixture-'));
  const store = new FileExecutionStore(directory);
  const live = new Map([A, B, C, D].map(value => [value.session_id, value]));
  const closes = [];
  const runtime = {
    async sourceEvidence(input) {
      const claim = input.reservation.source;
      return { runtime_launch: claim.launch ? live.get(claim.launch.session_id) ?? null : null,
        caller_bound: true, invocation_boundary: null };
    },
    async observe(session) { return live.has(session) ? { state: 'present', launch: live.get(session) } : { state: 'absent' }; },
    async completion() { return { state: 'completed', fence: 'closed' }; },
    async close(expected) {
      assert.deepEqual(live.get(expected.session_id), expected);
      closes.push(expected);
      live.delete(expected.session_id);
    },
    async coverage() { return 'complete'; },
  };
  runtime.observeSync = session => live.has(session) ? { state: 'present', launch: live.get(session) } : { state: 'absent' };
  const service = new ExecutionService(store, runtime, 500);
  const registration = (id, source = A, target = B, expected = target.launch_id) => ({ action: 'register',
    source_session_id: source.session_id,
    reservation: { schema: 'aiterm.execution-reservation.v1', request: request(id, target),
      source: { launch: source, boundary: null }, target: { session_id: target.session_id, expected_launch_id: expected } } });
  const register = async (...args) => service.execute(registration(...args));
  const status = request => service.execute({ action: 'status', request });
  const send = async (record, target = B) => service.invoke(ref(record.reservation.request), 'send',
    async () => ({ value: 'accepted', target: point(target) }));
  const finish = record => service.execute({ action: 'finish', request: record.reservation.request,
    evidence: { kind: 'completion', target: point(record.relation.target.launch) } });
  return { directory, store, live, closes, runtime, service, registration, register, status, send, finish };
}

test('register is idempotent and changed content conflicts without issuing anything', async () => {
  const f = fixture(), input = f.registration('ab');
  assert.deepEqual(await f.service.execute(input), await f.service.execute(input));
  await assert.rejects(f.service.execute({ ...input, source_session_id: C.session_id,
    reservation: { ...input.reservation, source: { launch: C, boundary: null } } }), code('EXECUTION_CONFLICT'));
  assert.equal(f.closes.length, 0);
});
test('source boundary null adopts a generation edge and each reference sends only once', async () => {
  const f = fixture(), record = await f.register('ab');
  assert.equal(record.source.status, 'verified');
  assert.equal(record.source.boundary_status, 'missing');
  await f.send(record);
  let replayed = false;
  await assert.rejects(f.service.invoke(ref(record.reservation.request), 'send', async () => {
    replayed = true; return { value: null, target: point(B) };
  }), code('EXECUTION_CONFLICT'));
  assert.equal(replayed, false);
});
test('deferred preflight is cancelled without waiting for idle or issuing an effect', async () => {
  const f = fixture(), record = await f.register('deferred'), entered = deferred(), ready = deferred();
  let effects = 0;
  const running = f.service.invokeDeferred(ref(record.reservation.request), 'send', async issue => {
    entered.resolve(); await ready.promise; issue(); effects++;
    return { value: 'receipt', target: point(B) };
  }, B.session_id);
  await entered.promise;
  assert.equal((await f.status(record.reservation.request)).operations.send, 'preparing');
  assert.equal((await f.store.transaction(state => state.slots, { readOnly: true })).length, 0);
  assert.equal((await f.service.stop(stop([A]))).status, 'stopped');
  assert.deepEqual(f.closes, [A]);
  ready.resolve();
  await assert.rejects(running, error => error.effect === 'not_started');
  assert.equal(effects, 0);
});
test('a duplicate deferred invocation cannot cancel the first preparing owner', async () => {
  const f = fixture(), record = await f.register('preparing-owner'), entered = deferred(), ready = deferred();
  const original = f.service.invokeDeferred(ref(record.reservation.request), 'send', async issue => {
    entered.resolve(); await ready.promise; issue(); return { value: 'first', target: point(B) };
  }, B.session_id);
  await entered.promise;
  let duplicates = 0;
  await assert.rejects(f.service.invokeDeferred(ref(record.reservation.request), 'send', async () => {
    duplicates++; return { value: 'bad', target: null };
  }, B.session_id), code('EXECUTION_CONFLICT'));
  assert.equal((await f.status(record.reservation.request)).operations.send, 'preparing');
  ready.resolve(); assert.equal((await original).value, 'first');
  assert.equal(duplicates, 0);
});
test('the first deferred native effect persists issuance and stop drains only the issued work', async () => {
  const f = fixture(), record = await f.register('first-effect'), entered = deferred(), reply = deferred();
  const running = f.service.invokeDeferred(ref(record.reservation.request), 'send', async issue => {
    issue(); issue(); // multiple primitive commands remain one issued operation
    const state = f.store.transactionSync(state => state, { readOnly: true });
    assert.equal(state.records[0].operations.send, 'issued');
    assert.equal(state.slots.length, 1);
    entered.resolve(); await reply.promise;
    return { value: 'accepted', target: point(B) };
  }, B.session_id);
  await entered.promise;
  const stopping = f.service.stop(stop([A]));
  await until(async () => (await f.status(record.reservation.request)).stopping);
  assert.equal(f.closes.length, 0);
  reply.resolve(); assert.equal((await running).value, 'accepted');
  assert.equal((await stopping).status, 'stopped');
  assert.deepEqual(f.closes, [A, B]);
});
test('a target replaced during deferred preflight is rejected before its first native effect', async () => {
  const f = fixture(), record = await f.register('deferred-replaced'); let effects = 0;
  await assert.rejects(f.service.invokeDeferred(ref(record.reservation.request), 'send', async issue => {
    f.live.set(B.session_id, launch('b', 'e')); issue(); effects++;
    return { value: 'bad', target: point(B) };
  }, B.session_id), code('EXECUTION_STALE_GENERATION'));
  assert.equal(effects, 0);
  assert.equal((await f.status(record.reservation.request)).operations.send, 'not_sent');
});
test('synchronous effect admission refuses an async lock owner without blocking its event loop', async () => {
  const f = fixture(), record = await f.register('sync-busy'), tried = deferred();
  const beforeIssue = deferred(), proceed = deferred();
  const running = f.service.invokeDeferred(ref(record.reservation.request), 'send', async issue => {
    beforeIssue.resolve(); await proceed.promise;
    try { issue(); } finally { tried.resolve(); }
    return { value: 'bad', target: point(B) };
  }, B.session_id);
  await beforeIssue.promise;
  const held = deferred(), unlock = deferred();
  const holding = f.store.transaction(async () => { held.resolve(); await unlock.promise; });
  await held.promise; proceed.resolve();
  await tried.promise; // resolves while the async owner still holds its lock
  unlock.resolve(); await holding;
  await assert.rejects(running, code('EXECUTION_BUSY'));
  assert.equal((await f.status(record.reservation.request)).operations.send, 'not_sent');
});
test('once the native gate was crossed even a later typed refusal remains possible and is not replayed', async () => {
  const f = fixture(), record = await f.register('deferred-failure');
  await assert.rejects(f.service.invokeDeferred(ref(record.reservation.request), 'send', async issue => {
    issue(); f.live.delete(B.session_id); throw new ExecutionError('EXECUTION_STALE_GENERATION', 'not_started');
  }, B.session_id), code('EXECUTION_UNCONFIRMED'));
  assert.equal((await f.status(record.reservation.request)).operations.send, 'unknown');
  assert.equal((await f.store.transaction(state => state.slots)).length, 1);
});
test('unissued noop and escaped old callbacks never gain permission to act later', async () => {
  const f = fixture(), record = await f.register('noop'); let escaped;
  const result = await f.service.invokeDeferred(ref(record.reservation.request), 'send', async issue => {
    escaped = issue; return { value: 'already configured', target: null };
  }, B.session_id);
  assert.equal(result.value, 'already configured');
  assert.equal(result.record.relation.phase, 'unsent');
  assert.throws(() => escaped(), code('EXECUTION_CONFLICT'));
  assert.equal((await f.store.transaction(state => state.slots)).length, 0);
});
test('missing synchronous observation refuses deferred execution rather than falling back to issued-before-idle', async () => {
  const f = fixture(), record = await f.register('no-sync'); delete f.runtime.observeSync;
  let calls = 0;
  await assert.rejects(f.service.invokeDeferred(ref(record.reservation.request), 'send', async () => {
    calls++; return { value: 'bad', target: null };
  }, B.session_id), code('EXECUTION_UNSUPPORTED'));
  assert.equal(calls, 0);
  assert.equal((await f.status(record.reservation.request)).operations.send, 'not_issued');
});
test('the deferred MCP wrapper scopes native admission and retains its successful receipt after binding failure', async () => {
  const f = fixture(), record = await f.register('deferred-wrapper');
  const receipt = { content: [{ type: 'text', text: 'accepted once' }], structuredContent: { event_cursor: 5 } };
  const result = await runDeferredBoundExecution(f.service, { [EXECUTION_REQUEST_META_KEY]: ref(record.reservation.request) }, 'send', B.session_id,
    async () => {
      beforeExecutionEffect(B.session_id);
      f.live.set(B.session_id, launch('b', 'e'));
      return { result: receipt, target: point(B) };
    });
  assert.deepEqual(result.structuredContent, receipt.structuredContent);
  assert.equal(result.isError, undefined);
  assert.equal(result._meta[EXECUTION_ERROR_META_KEY].effect, 'possible');
  assert.equal((await f.status(record.reservation.request)).operations.send, 'unknown');
});
test('a swallowed native gate refusal cannot fabricate an accepted MCP receipt', async () => {
  const f = fixture(), record = await f.register('swallowed-refusal');
  const result = await runDeferredBoundExecution(f.service, { [EXECUTION_REQUEST_META_KEY]: ref(record.reservation.request) }, 'send', B.session_id,
    async () => {
      try { beforeExecutionEffect(C.session_id); } catch { /* legacy handler catches a native error */ }
      return { result: { content: [], structuredContent: { status: 'fake accepted' } }, target: point(B) };
    });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  assert.equal(result._meta[EXECUTION_ERROR_META_KEY].effect, 'not_started');
  assert.equal((await f.status(record.reservation.request)).operations.send, 'not_sent');
});
test('expected-close native admission requires the persisted stop slot and permits one captured native target', async () => {
  const f = fixture(); let nativeEffects = 0;
  const primitive = expected => f.service.withExpectedCloseEffect(expected, () => closeExpectedExecution(expected, {
    sessions: () => ({ state: 'known', sessions: f.live.has(expected.session_id) ? [{ session_id: expected.session_id, native_id: '$7' }] : [] }),
    launch: name => f.live.get(name) ?? null,
    kill: nativeId => {
      bindExecutionNativeTarget(expected.session_id, nativeId);
      assert.deepEqual(guardTmuxExecution(['kill-session', '-t', nativeId]), ['kill-session', '-t', '$7']);
      nativeEffects++; f.live.delete(expected.session_id); return { code: 0 };
    },
  }));
  assert.throws(() => primitive(A), code('EXECUTION_UNCONFIRMED'));
  assert.equal(nativeEffects, 0);
  f.runtime.close = async expected => { primitive(expected); };
  assert.equal((await f.service.stop(stop([A]))).status, 'stopped');
  assert.equal(nativeEffects, 1);
});
test('an existing native MCP request reference covers an empty launch without inventing a turn cursor', async () => {
  const f = fixture(); f.live.delete(B.session_id);
  const args = f.registration('ignored', A, B, null);
  args.reservation.request = { kind: 'mcp', process_pid: 123, process_started_identity: 'synthetic-native-start',
    request_id: 41, tool: 'agent_launch', target_session_id: B.session_id };
  const record = await f.service.execute(args);
  const result = await f.service.invokeDeferred(ref(record.reservation.request), 'launch', async issue => {
    issue(); f.live.set(B.session_id, B); return { value: 'launched empty', target: point(B, null) };
  }, B.session_id);
  assert.equal(result.record.relation.target.boundary, null);
  assert.equal((await f.service.stop(stop([A]))).status, 'stopped');
  assert.deepEqual(f.closes, [A, B]);
});
test('deferred normal close binds only confirmed absence and interrupts the same-generation incoming edge', async () => {
  const f = fixture(); await f.send(await f.register('original-ab'));
  const args = f.registration('ignored');
  args.reservation.request = { kind: 'mcp', process_pid: 123, process_started_identity: 'synthetic-native-start', request_id: 42,
    tool: 'pty_close', target_session_id: B.session_id };
  const record = await f.service.execute(args);
  const closed = await f.service.invokeDeferred(ref(record.reservation.request), 'send', async issue => {
    issue(); f.live.delete(B.session_id); return { value: 'closed', target: point(B, null) };
  }, B.session_id);
  assert.equal(closed.record.relation.completion, 'interrupted');
  assert.equal((await f.status(request('original-ab'))).relation.completion, 'interrupted');
  assert.equal((await f.store.transaction(state => state.slots)).length, 0);
});
test('target generation replacement after reservation rejects before body invocation', async () => {
  const f = fixture(), record = await f.register('ab');
  f.live.set(B.session_id, launch('b', 'e'));
  await assert.rejects(f.send(record), code('EXECUTION_STALE_GENERATION'));
  assert.equal((await f.status(record.reservation.request)).operations.send, 'not_issued');
});
test('the concrete launch/send argument is checked before any effect or issued slot', async () => {
  for (const stage of ['launch', 'send']) {
    const f = fixture(), record = await f.register(`wrong-${stage}`);
    let effects = 0;
    const result = await runBoundExecution(f.service, { [EXECUTION_REQUEST_META_KEY]: ref(record.reservation.request) }, stage,
      async () => { effects++; return { result: { content: [] }, target: point(B) }; }, C.session_id);
    assert.equal(effects, 0);
    assert.equal(result._meta[EXECUTION_ERROR_META_KEY].code, 'EXECUTION_CONFLICT');
    assert.equal(result._meta[EXECUTION_ERROR_META_KEY].effect, 'not_started');
    assert.equal((await f.status(record.reservation.request)).operations[stage], 'not_issued');
    assert.equal((await f.store.transaction(state => state.slots, { readOnly: true })).length, 0);
  }
});
test('an explicit source generation that is gone cannot start new work as an unknown source', async () => {
  const f = fixture(); f.live.delete(A.session_id);
  await assert.rejects(f.register('old-source-ab'), code('EXECUTION_STALE_GENERATION'));
  f.live.set(A.session_id, A);
  f.runtime.sourceEvidence = async () => ({ runtime_launch: A, caller_bound: false, invocation_boundary: null });
  const record = await f.register('unbound-generation-ab');
  await assert.rejects(f.send(record), code('EXECUTION_UNCONFIRMED'));
  assert.equal((await f.status(record.reservation.request)).operations.send, 'not_issued');
});
test('launch-only effect remains a relation when its subsequent prompt is confirmed unsent', async () => {
  const f = fixture();
  f.live.delete(B.session_id);
  const record = await f.register('launch-b', A, B, null);
  await f.service.invoke(ref(record.reservation.request), 'launch', async () => {
    f.live.set(B.session_id, B); return { value: 'launched', target: point(B, null) };
  });
  const finished = await f.service.execute({ action: 'finish', request: record.reservation.request, evidence: { kind: 'not_sent' } });
  assert.equal(finished.relation.phase, 'invoked');
  assert.equal(finished.relation.lifecycle, 'tracking');
});
test('completion is reobserved, and local done cannot retire an unknown invocation fence', async () => {
  const f = fixture();
  const accepted = (await f.send(await f.register('ab'))).record;
  f.runtime.completion = async () => ({ state: 'unknown', fence: 'unknown' });
  await assert.rejects(f.finish(accepted), code('EXECUTION_UNCONFIRMED'));
  assert.equal((await f.status(accepted.reservation.request)).relation.completion, 'open');
  f.runtime.completion = async () => ({ state: 'completed', fence: 'unknown' });
  const pending = await f.finish(accepted);
  assert.equal(pending.relation.lifecycle, 'tracking');
  assert.equal(planCascadeStop([A], [pending.relation]).targets.length, 2);
  f.runtime.completion = async () => ({ state: 'completed', fence: 'closed' });
  assert.equal((await f.finish(accepted)).relation.lifecycle, 'retired');
});
test('a completed parent is retained until its actual descendant also finishes', async () => {
  const f = fixture();
  const ab = (await f.send(await f.register('ab'))).record;
  const bc = (await f.send(await f.register('bc', B, C), C)).record;
  assert.equal((await f.finish(ab)).relation.lifecycle, 'tracking');
  await f.finish(bc);
  assert.equal((await f.status(ab.reservation.request)).relation.lifecycle, 'retired');
});
test('stop fences first, drains a delayed accepted send, and includes its target', async () => {
  const f = fixture(), record = await f.register('ab');
  const started = deferred(), release = deferred();
  const sending = f.service.invoke(ref(record.reservation.request), 'send', async () => {
    started.resolve(); await release.promise; return { value: 'late-receipt', target: point(B) };
  });
  await started.promise;
  const otherProcess = new ExecutionService(new FileExecutionStore(f.directory), f.runtime, 500);
  const stopping = otherProcess.stop(stop([A]));
  await until(async () => (await f.status(record.reservation.request)).stopping);
  await assert.rejects(f.register('ac', A, C), code('EXECUTION_STOPPING'));
  assert.equal(f.closes.length, 0);
  release.resolve();
  assert.equal((await sending).value, 'late-receipt');
  const result = await stopping;
  assert.equal(result.status, 'stopped');
  assert.deepEqual(f.closes, [A, B]);
});
test('an in-flight launch gaining its target generation after the fence is included', async () => {
  const f = fixture(); f.live.delete(C.session_id);
  const record = await f.register('ac', A, C, null);
  const started = deferred(), release = deferred();
  const launching = f.service.invoke(ref(record.reservation.request), 'launch', async () => {
    started.resolve(); await release.promise; f.live.set(C.session_id, C); return { value: null, target: point(C, null) };
  });
  await started.promise;
  const stopping = f.service.stop(stop([A]));
  await until(async () => (await f.status(record.reservation.request)).stopping);
  release.resolve(); await launching;
  const result = await stopping;
  assert.equal(result.status, 'stopped');
  assert.deepEqual(f.closes, [A, C]);
});
test('unissued reservations are cancelled and cannot send after root closure', async () => {
  const f = fixture(), record = await f.register('ab');
  const result = await f.service.stop(stop([A]));
  assert.equal(result.status, 'stopped');
  assert.deepEqual(f.closes, [A]);
  assert.equal((await f.status(record.reservation.request)).relation.phase, 'unsent');
  await assert.rejects(f.send(record), code('EXECUTION_CONFLICT'));
});
test('a launch that included the prompt cannot send the same request a second time', async () => {
  const f = fixture(); f.live.delete(B.session_id);
  const record = await f.register('launch-prompt', A, B, null);
  await f.service.invoke(ref(record.reservation.request), 'launch', async () => {
    f.live.set(B.session_id, B); return { value: null, target: point(B) };
  });
  await assert.rejects(f.send(record), code('EXECUTION_CONFLICT'));
});
test('a response that cannot be bound leaves a persistent unknown slot rather than replay permission', async () => {
  const f = fixture(), record = await f.register('ab');
  await assert.rejects(f.service.invoke(ref(record.reservation.request), 'send', async () => {
    f.live.set(B.session_id, launch('b', 'e'));
    return { value: null, target: point(B) };
  }), code('EXECUTION_UNCONFIRMED'));
  assert.equal((await f.status(record.reservation.request)).operations.send, 'unknown');
  await assert.rejects(f.register('new-b', C, launch('b', 'e')), code('EXECUTION_UNCONFIRMED'));
});
test('after bounded drain reports partial, a late target is still fenced at binding time', async () => {
  const f = fixture(); f.live.delete(C.session_id);
  const shortStop = new ExecutionService(new FileExecutionStore(f.directory), f.runtime, 1);
  const record = await f.register('ac', A, C, null), started = deferred(), release = deferred();
  const launching = f.service.invoke(ref(record.reservation.request), 'launch', async () => {
    started.resolve(); await release.promise; f.live.set(C.session_id, C); return { value: null, target: point(C, null) };
  });
  await started.promise;
  const result = await shortStop.stop(stop([A]));
  assert.notEqual(result.status, 'stopped');
  assert.ok(result.unresolved.some(value => value.reason === 'issued_operation_unconfirmed'));
  release.resolve(); await launching;
  await assert.rejects(f.register('cd-after-stop', C, D), code('EXECUTION_STOPPING'));
});
test('close effect followed by reject remains unknown, blocks replacement and is never retried', async () => {
  const f = fixture();
  f.runtime.close = async expected => { f.closes.push(expected); f.live.delete(expected.session_id); throw new Error('lost-response'); };
  const result = await f.service.stop(stop([B]));
  assert.equal(result.status, 'unconfirmed');
  const restarted = new ExecutionService(new FileExecutionStore(f.directory), f.runtime, 10);
  const roots = await restarted.roots({ session_id: B.session_id });
  assert.deepEqual(roots.roots, [B]);
  assert.equal(roots.relation_coverage, 'incomplete');
  assert.equal((await restarted.stop(stop([B]))).status, 'unconfirmed');
  await assert.rejects(restarted.execute(f.registration('new-b', A, B, null)), code('EXECUTION_UNCONFIRMED'));
  assert.equal(f.closes.length, 1);
});
test('an unsupported close adapter reports unsupported without fabricating a successful close', async () => {
  const f = fixture(); f.runtime.close = async () => { throw new ExecutionError('EXECUTION_UNSUPPORTED', 'not_started'); };
  const result = await f.service.stop(stop([B]));
  assert.equal(result.status, 'unconfirmed');
  assert.equal(result.targets[0].outcome, 'unsupported');
  assert.equal(f.closes.length, 0);
});
test('a reached old launch does not close its same-name replacement, but retains known descendants', async () => {
  const f = fixture();
  await f.send(await f.register('ab'));
  await f.send(await f.register('bc', B, C), C);
  const replacement = launch('b', 'e'); f.live.set(B.session_id, replacement);
  const result = await f.service.stop(stop([A]));
  assert.equal(result.status, 'partial');
  assert.deepEqual(f.closes, [A, C]);
  assert.deepEqual(f.live.get(B.session_id), replacement);
  assert.equal(result.targets.find(value => value.launch.session_id === B.session_id).outcome, 'replaced');
});
test('an unbound source generation stays unresolved and is not guessed from a Bot name', async () => {
  const f = fixture(), input = f.registration('ab'); input.reservation.source.launch = null;
  const record = await f.service.execute(input);
  await f.send(record);
  const result = await f.service.stop(stop([A]));
  assert.equal(result.status, 'partial');
  assert.deepEqual(f.closes, [A]);
  assert.ok(result.unresolved.some(value => value.reason === 'source_generation_missing'));
  const later = f.registration('ac', A, C); later.reservation.source.launch = null;
  await assert.rejects(f.service.execute(later), code('EXECUTION_UNCONFIRMED'));
});
test('untracked coverage can never be reported as complete stopping', async () => {
  const f = fixture(); f.runtime.coverage = async () => 'incomplete';
  const result = await f.service.stop(stop([A]));
  assert.equal(result.status, 'partial');
  assert.ok(result.unresolved.some(value => value.reason === 'relation_coverage_incomplete'));
});
test('a rejected ordinary session change stays unknown after disappearance and blocks new launch', async () => {
  for (const stage of ['close', 'configure']) {
    const f = fixture();
    await assert.rejects(f.service.changeSession(B, stage, async () => {
      f.live.delete(B.session_id); throw new Error('response rejected after effect');
    }), code('EXECUTION_UNCONFIRMED'));
    assert.equal((await f.service.stop(stop([B]))).status, 'unconfirmed');
    await assert.rejects(f.register(`new-${stage}`, A, B, null), code('EXECUTION_UNCONFIRMED'));
    assert.equal(f.closes.length, 0);
  }
});
test('an explicit pre-effect refusal of a session change releases only that issued slot', async () => {
  const f = fixture();
  await assert.rejects(f.service.changeSession(B, 'configure', async () => {
    throw new ExecutionError('EXECUTION_CONFLICT', 'not_started');
  }), code('EXECUTION_CONFLICT'));
  assert.equal((await f.service.stop(stop([B]))).status, 'stopped');
  assert.deepEqual(f.closes, [B]);
});
test('new outgoing calls cannot cross an already-issued source close/configure', async () => {
  const f = fixture(), started = deferred(), release = deferred();
  const changing = f.service.changeSession(B, 'configure', async () => { started.resolve(); await release.promise; });
  await started.promise;
  await assert.rejects(f.register('bc-during-change', B, C), code('EXECUTION_UNCONFIRMED'));
  release.resolve(); await changing;
  assert.equal((await f.register('bc-after-change', B, C)).relation.phase, 'reserved');
});
test('source-aware configuration drains before stopping its caller without inventing an invocation edge', async () => {
  const f = fixture(), entered = deferred(), released = deferred();
  const changing = f.service.changeSession(B, 'configure', async () => { entered.resolve(); await released.promise; }, A);
  await entered.promise;
  assert.deepEqual((await f.service.roots({ session_id: A.session_id })).roots, [A]);
  const stopping = f.service.stop(stop([A]));
  await until(async () => (await f.store.transaction(state => state.stopping)).some(value => value.session_id === A.session_id));
  await assert.rejects(f.service.changeSession(C, 'configure', async () => {}, A), code('EXECUTION_STOPPING'));
  assert.equal(f.closes.length, 0);
  released.resolve(); await changing;
  assert.equal((await stopping).status, 'stopped');
  assert.deepEqual(f.closes, [A]);
  assert.equal(f.live.has(B.session_id), true);
});
test('a lost source-aware change remains attributable after the caller is absent and service reconstructed', async () => {
  const f = fixture();
  await assert.rejects(f.service.changeSession(B, 'configure', async () => { throw new Error('lost response'); }, A), code('EXECUTION_UNCONFIRMED'));
  f.live.delete(A.session_id);
  const restored = new ExecutionService(new FileExecutionStore(f.directory), f.runtime);
  const roots = await restored.roots({ session_id: A.session_id });
  assert.deepEqual(roots.roots, [A]);
  assert.ok(roots.unresolved.some(value => value.reason === 'issued_operation_unconfirmed'));
  const result = await restored.stop(stop([A]));
  assert.equal(result.status, 'partial');
  assert.ok(result.unresolved.some(value => value.reason === 'issued_operation_unconfirmed'));
  await assert.rejects(restored.changeSession(B, 'configure', async () => {}), code('EXECUTION_UNCONFIRMED'));
});
test('MCP wrapper preserves a successful send receipt if post-effect binding is uncertain', async () => {
  const f = fixture(), record = await f.register('ab');
  const receipt = { content: [{ type: 'text', text: 'accepted' }],
    structuredContent: { mode: 'agent_dispatch', session_id: B.session_id, launch_id: B.launch_id, event_cursor: 1 },
    _meta: { existing: 'preserved' } };
  const result = await runBoundExecution(f.service, { [EXECUTION_REQUEST_META_KEY]: ref(record.reservation.request) }, 'send', async () => {
    f.live.set(B.session_id, launch('b', 'e'));
    return { result: receipt, target: point(B) };
  });
  assert.deepEqual(result.structuredContent, receipt.structuredContent);
  assert.equal(result.isError, undefined);
  assert.equal(result._meta.existing, 'preserved');
  assert.equal(result._meta[EXECUTION_ERROR_META_KEY].effect, 'possible');
  assert.equal((await f.status(record.reservation.request)).operations.send, 'unknown');
});
test('MCP wrapper adds binding metadata without replacing steer or other existing metadata', async () => {
  const f = fixture(), record = await f.register('ab');
  const result = await runBoundExecution(f.service, { [EXECUTION_REQUEST_META_KEY]: ref(record.reservation.request) }, 'send', async () => ({
    result: { content: [{ type: 'text', text: 'accepted' }], _meta: { 'aiterm/steer': { steer_id: 'existing-steer' } } }, target: point(B),
  }));
  assert.equal(result._meta['aiterm/steer'].steer_id, 'existing-steer');
  assert.deepEqual(result._meta[EXECUTION_BINDING_META_KEY].request, record.reservation.request);
});
test('fake in-memory MCP publishes and validates register/status/finish and agent_stop wire', async () => {
  const f = fixture(), server = new McpServer({ name: 'execution-fixture', version: '0.0.0' });
  registerExecutionTools(server, f.service);
  const client = new Client({ name: 'bridge-fixture', version: '0.0.0' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    assert.deepEqual((await client.listTools()).tools.map(value => value.name), ['agent_execution', 'agent_stop', 'agent_execution_roots']);
    const registered = await client.callTool({ name: 'agent_execution', arguments: f.registration('ab') });
    const record = registered.structuredContent;
    assert.equal(record.schema, 'aiterm.execution-record.v1');
    assert.deepEqual(registered._meta[EXECUTION_BINDING_META_KEY].request, record.reservation.request);
    const roots = await client.callTool({ name: 'agent_execution_roots', arguments: { session_id: A.session_id } });
    assert.equal(roots.structuredContent.schema, 'aiterm.execution-roots.v1');
    assert.deepEqual(roots.structuredContent.current, A);
    await f.send(record);
    const status = await client.callTool({ name: 'agent_execution', arguments: { action: 'status', request: record.reservation.request } });
    assert.equal(status.structuredContent.operations.send, 'accepted');
    const finished = await client.callTool({ name: 'agent_execution', arguments: { action: 'finish', request: record.reservation.request,
      evidence: { kind: 'completion', target: point(B) } } });
    assert.equal(finished.structuredContent.relation.completion, 'completed');
    const missing = await client.callTool({ name: 'agent_execution', arguments: { action: 'status', request: request('missing') } });
    assert.equal(missing.isError, true);
    assert.equal(missing._meta[EXECUTION_ERROR_META_KEY].code, 'EXECUTION_NOT_FOUND');
    const remote = await client.callTool({ name: 'agent_stop', arguments: { ...stop([A]), remote: { host: 'foreign-scope' } } });
    assert.equal(remote.isError, true);
    assert.equal(f.closes.length, 0);
    const result = await client.callTool({ name: 'agent_stop', arguments: stop([A]) });
    assert.equal(result.structuredContent.status, 'stopped');
    assert.deepEqual(f.closes, [A]);
  } finally { await client.close(); await server.close(); }
});
test('file corruption and an abandoned transaction lock do not become an empty successful graph', async () => {
  const f = fixture();
  writeFileSync(join(f.directory, 'relations.json'), '{');
  await assert.rejects(f.service.stop(stop([A])), code('EXECUTION_STATE_UNAVAILABLE'));
  await assert.rejects(f.service.roots({ session_id: A.session_id }), code('EXECUTION_STATE_UNAVAILABLE'));
  assert.equal(f.closes.length, 0);
  const other = fixture(); mkdirSync(join(other.directory, 'transaction.lock'));
  const locked = new ExecutionService(new FileExecutionStore(other.directory, 1), other.runtime);
  await assert.rejects(locked.stop(stop([A])), code('EXECUTION_BUSY'));
  assert.equal(other.closes.length, 0);
});
test('root lookup recovers an absent source generation with unfinished descendants after service reconstruction', async () => {
  const f = fixture(); await f.send(await f.register('ab')); f.live.delete(A.session_id);
  const reconstructed = new ExecutionService(new FileExecutionStore(f.directory), f.runtime);
  const result = await reconstructed.roots({ session_id: A.session_id });
  assert.equal(result.observation, 'absent');
  assert.equal(result.current, null);
  assert.deepEqual(result.roots, [A]);
  const stopped = await reconstructed.stop(stop(result.roots));
  assert.equal(stopped.status, 'stopped');
  assert.deepEqual(f.closes, [B]);
});
test('root lookup retains locally completed connectors but excludes completed history and unrelated seats', async () => {
  const f = fixture();
  const ab = (await f.send(await f.register('ab'))).record;
  const bc = (await f.send(await f.register('bc', B, C), C)).record;
  await f.send(await f.register('db-independent', D, B));
  await f.finish(ab); f.live.delete(A.session_id);
  assert.deepEqual((await f.service.roots({ session_id: A.session_id })).roots, [A]);
  await f.finish(bc);
  assert.deepEqual((await f.service.roots({ session_id: A.session_id })).roots, []);
});
test('current replacement and a genuinely unfinished old generation are both explicit roots', async () => {
  const f = fixture(); await f.send(await f.register('ab'));
  const replacement = launch('a', 'e'); f.live.set(A.session_id, replacement);
  const result = await f.service.roots({ session_id: A.session_id });
  assert.deepEqual(result.current, replacement);
  assert.deepEqual(result.roots, [A, replacement]);
});
test('a persisted incoming target receipt also proves the absent seat generation', async () => {
  const f = fixture(); await f.send(await f.register('da', D, A), A); f.live.delete(A.session_id);
  assert.deepEqual((await f.service.roots({ session_id: A.session_id })).roots, [A]);
});
test('generation-missing source hints never fabricate an old root', async () => {
  const f = fixture(), input = f.registration('ab'); input.reservation.source.launch = null;
  await f.send(await f.service.execute(input)); f.live.delete(A.session_id);
  const result = await f.service.roots({ session_id: A.session_id });
  assert.deepEqual(result.roots, []);
  assert.equal(result.relation_coverage, 'incomplete');
  assert.ok(result.unresolved.some(value => value.reason === 'source_generation_missing'));
});
test('absent and empty is not complete when record coverage is missing', async () => {
  const f = fixture(); f.live.delete(A.session_id); f.runtime.coverage = async () => 'incomplete';
  const result = await f.service.roots({ session_id: A.session_id });
  assert.deepEqual(result.roots, []);
  assert.equal(result.relation_coverage, 'incomplete');
});
test('lookup of old-generation records is read-only and does not register, stop or rewrite metadata', async () => {
  const f = fixture(); await f.send(await f.register('ab')); f.live.delete(A.session_id);
  const statePath = join(f.directory, 'relations.json'), before = readFileSync(statePath, 'utf8');
  const beforeStat = statSync(statePath, { bigint: true });
  await f.service.roots({ session_id: A.session_id });
  assert.equal(readFileSync(statePath, 'utf8'), before);
  assert.equal(statSync(statePath, { bigint: true }).mtimeNs, beforeStat.mtimeNs);
  assert.equal(f.closes.length, 0);
});
test('typed errors redact arbitrary exceptions; request metadata is strict and contains only an existing reference', () => {
  assert.deepEqual(executionRefFromMeta({ [EXECUTION_REQUEST_META_KEY]: ref(request('ab')) }), ref(request('ab')));
  assert.equal(executionRefFromMeta({}), null);
  assert.throws(() => executionRefFromMeta({ [EXECUTION_REQUEST_META_KEY]: { ...ref(request('ab')), prompt: 'not-persisted' } }));
  const result = executionErrorResult(new Error('/secret/path raw failure'));
  assert.equal(JSON.stringify(result).includes('/secret/path'), false);
  assert.equal(result._meta[EXECUTION_ERROR_META_KEY].code, 'EXECUTION_STATE_UNAVAILABLE');
  assert.equal(result._meta[EXECUTION_ERROR_META_KEY].follow_up, 'status_only');
});
