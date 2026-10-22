import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileExecutionStore } from '../dist/execution-store.js';
import { ExecutionService } from '../dist/execution-service.js';
import { runDeferredBoundExecution } from '../dist/execution-tools.js';
import { guardTmuxExecution, withExecutionNativeAdmission } from '../dist/execution-effect.js';
const skip = process.platform === 'win32' ? 'POSIX metadata checkpoint' : false;
const pause = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const A = { session_id: 'admission-source', launch_id: 'a'.repeat(32) };
const B = { session_id: 'admission-target', launch_id: 'b'.repeat(32) };

async function fixture() {
  const store = new FileExecutionStore(mkdtempSync(join(tmpdir(), 'admission-'))), live = new Map([A, B].map(v => [v.session_id, v]));
  const observe = session => live.has(session) ? { state: 'present', launch: live.get(session) } : { state: 'absent' };
  const service = new ExecutionService(store, { observe: async session => observe(session), observeSync: observe,
    sourceEvidence: async input => ({ runtime_launch: input.reservation.source.launch
      ? live.get(input.reservation.source.launch.session_id) ?? null : null, caller_bound: true, invocation_boundary: null }),
    completion: async () => ({ state: 'unknown', fence: 'unknown' }), close: async () => assert.fail('no close'), coverage: async () => 'incomplete' });
  const request = { kind: 'delivery', delivery_id: 'admission-fixture', target_session_id: B.session_id };
  await service.execute({ action: 'register', source_session_id: A.session_id, reservation: {
    schema: 'aiterm.execution-reservation.v1', request, source: { launch: A, boundary: null },
    target: { session_id: B.session_id, expected_launch_id: B.launch_id } } });
  let effects = 0;
  const effect = () => { guardTmuxExecution(['send-keys', '-t', B.session_id, 'synthetic']); effects++; };
  const run = body => runDeferredBoundExecution(service, { 'aiterm/execution': { schema: 'aiterm.execution-ref.v1', request } },
    'send', B.session_id, async () => { await body(); return { result: { content: [] }, target: { launch: B, boundary: null } }; });
  return { store, live, service, request, effect, effects: () => effects, run };
}

test('native admission shares only its physical mutex, commits each gate before input and excludes another store', { skip }, async () => {
  const f = await fixture(), other = new FileExecutionStore(f.store.directory);
  const result = await f.run(async () => withExecutionNativeAdmission(B.session_id, () => {
    assert.throws(() => other.transactionSync(() => {}), error => error.code === 'EXECUTION_BUSY');
    f.effect();
    assert.equal(other.snapshot().slots[0].state, 'issued', 'issuance is durable before the next native effect');
    f.effect();
  }));
  assert.equal(result.isError, undefined); assert.equal(f.effects(), 2);
  assert.equal(existsSync(join(f.store.directory, 'transaction.lock')), false);
});

test('a native continuation waits for another writer without holding the event loop, then runs exactly once', { skip }, async () => {
  const f = await fixture(), entered = pause(), release = pause(); let writer;
  const result = await f.run(async () => {
    f.effect();
    writer = f.store.transaction(async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    const pending = withExecutionNativeAdmission(B.session_id, () => f.effect());
    assert.equal(f.effects(), 1); release.resolve(); await writer; await pending;
  });
  assert.equal(result.isError, undefined); assert.equal(f.effects(), 2); assert.deepEqual(f.store.snapshot().slots, []);
});

test('stop, generation change and uncertain slots while waiting still fence input, retain unknown and never replay', { skip }, async () => {
  for (const change of ['stop-source', 'stop-target', 'replace-source', 'replace-target', 'unknown-slot']) {
    const f = await fixture(), entered = pause(), release = pause();
    const result = await f.run(async () => {
      f.effect();
      const writer = f.store.transaction(async state => {
        if (change === 'stop-source') state.stopping.push(A);
        if (change === 'stop-target') state.stopping.push(B);
        if (change === 'replace-source') f.live.set(A.session_id, { ...A, launch_id: 'c'.repeat(32) });
        if (change === 'replace-target') f.live.set(B.session_id, { ...B, launch_id: 'c'.repeat(32) });
        if (change === 'unknown-slot') state.slots[0].state = 'unknown';
        entered.resolve(); await release.promise;
      });
      await entered.promise;
      const pending = withExecutionNativeAdmission(B.session_id, () => f.effect());
      release.resolve(); await writer; await pending;
    });
    assert.equal(result.isError, true, change); assert.equal(f.effects(), 1, change);
    const state = f.store.snapshot(); assert.equal(state.records[0].operations.send, 'unknown');
    assert.equal(state.slots[0].state, 'unknown');
    const replay = await f.run(() => f.effect()); assert.equal(replay.isError, true); assert.equal(f.effects(), 1);
  }
});

test('native admission never carries its mutex over a Promise and a swallowed refusal cannot fabricate acceptance', { skip }, async () => {
  const f = await fixture();
  const result = await f.run(async () => {
    f.effect();
    try { await withExecutionNativeAdmission(B.session_id, () => Promise.resolve('invalid async native body')); } catch {}
  });
  assert.equal(result.isError, true); assert.equal(f.effects(), 1);
  assert.equal(f.store.snapshot().slots[0].state, 'unknown');
  assert.equal(existsSync(join(f.store.directory, 'transaction.lock')), false);
});

test('native admission times out without stealing an existing writer mutex or running its body', { skip }, async () => {
  const f = await fixture(), store = new FileExecutionStore(f.store.directory, 1), entered = pause(), release = pause();
  const writer = f.store.transaction(async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  await assert.rejects(store.admitNative(() => assert.fail('no native body under timeout')), error => error.code === 'EXECUTION_BUSY');
  assert.equal(existsSync(join(f.store.directory, 'transaction.lock')), true);
  release.resolve(); await writer;
  assert.equal(f.effects(), 0); assert.deepEqual(f.store.snapshot().slots, []);
});

test('a verified caller can continue during ordinary incoming input, but unknown input remains blocked and unchanged', { skip }, async () => {
  for (const outcome of ['accepted', 'unknown']) {
    const f = await fixture(), entered = pause(), release = pause();
    const incoming = { kind: 'delivery', delivery_id: 'source-incoming', target_session_id: A.session_id };
    await f.service.execute({ action: 'register', source_session_id: null, reservation: {
      schema: 'aiterm.execution-reservation.v1', request: incoming, source: { launch: null, boundary: null },
      target: { session_id: A.session_id, expected_launch_id: A.launch_id } } });
    let incomingResult;
    const result = await f.run(async () => {
      f.effect();
      const sending = runDeferredBoundExecution(f.service, { 'aiterm/execution': { schema: 'aiterm.execution-ref.v1', request: incoming } },
        'send', A.session_id, async () => {
          guardTmuxExecution(['send-keys', '-t', A.session_id, 'synthetic incoming']);
          entered.resolve(); await release.promise;
          if (outcome === 'unknown') throw Error('synthetic incoming native failure');
          return { result: { content: [] }, target: { launch: A, boundary: null } };
        });
      await entered.promise;
      if (outcome === 'unknown') {
        release.resolve(); incomingResult = await sending;
        await withExecutionNativeAdmission(B.session_id, () => f.effect());
      } else {
        await withExecutionNativeAdmission(B.session_id, () => f.effect());
        const snapshot = await f.service.execute({ action: 'status', request: incoming });
        assert.equal(snapshot.operations.send, 'issued', 'outgoing input does not wait for incoming input');
        release.resolve(); incomingResult = await sending;
      }
    });
    assert.equal(f.effects(), outcome === 'accepted' ? 2 : 1);
    assert.equal(result.isError, outcome === 'accepted' ? undefined : true);
    const record = await f.service.execute({ action: 'status', request: incoming });
    assert.equal(record.operations.send, outcome);
    if (outcome === 'unknown') {
      assert.equal(incomingResult.isError, true);
      assert.equal(f.store.snapshot().slots.filter(s => s.state === 'unknown').length, 2);
    }
  }
});

test('reciprocal admitted sends do not wait for each other or discard either issued slot', { skip }, async () => {
  const f = await fixture(), both = pause(); let entered = 0, inputs = 0;
  const request = { kind: 'delivery', delivery_id: 'reciprocal', target_session_id: A.session_id };
  await f.service.execute({ action: 'register', source_session_id: B.session_id, reservation: {
    schema: 'aiterm.execution-reservation.v1', request, source: { launch: B, boundary: null },
    target: { session_id: A.session_id, expected_launch_id: A.launch_id } } });
  const run = (ref, target) => runDeferredBoundExecution(f.service, { 'aiterm/execution': { schema: 'aiterm.execution-ref.v1', request: ref } },
    'send', target.session_id, async () => {
      await withExecutionNativeAdmission(target.session_id, () => { guardTmuxExecution(['send-keys', '-t', target.session_id, 'paste']); inputs++; });
      if (++entered === 2) both.resolve(); await both.promise;
      await withExecutionNativeAdmission(target.session_id, () => { guardTmuxExecution(['send-keys', '-t', target.session_id, 'Enter']); inputs++; });
      return { result: { content: [] }, target: { launch: target, boundary: null } };
    });
  const results = await Promise.all([run(f.request, B), run(request, A)]);
  assert.ok(results.every(r => !r.isError), JSON.stringify(results)); assert.equal(inputs, 4);
  assert.deepEqual(f.store.snapshot().slots, []);
});

test('source management, wrong-generation and orphan slots are never treated as a transient incoming send', { skip }, async () => {
  for (const change of ['management', 'wrong-generation', 'orphan']) {
    const f = await fixture();
    const result = await f.run(async () => {
      f.effect();
      await f.store.transaction(state => {
        state.slots.push({ session_id: A.session_id, expected_launch_id: change === 'wrong-generation' ? 'c'.repeat(32) : A.launch_id,
          stage: 'send', state: 'issued', request: change === 'management'
            ? { kind: 'mcp', process_pid: 12345, process_started_identity: 'fixture', request_id: 99, tool: 'pty_close', target_session_id: A.session_id }
            : { kind: 'delivery', delivery_id: 'orphan-source-slot', target_session_id: A.session_id } });
      });
      await withExecutionNativeAdmission(B.session_id, () => f.effect());
    });
    assert.equal(result.isError, true); assert.equal(f.effects(), 1);
    assert.equal(f.store.snapshot().slots.find(s => s.session_id === A.session_id).state, 'issued');
  }
});
