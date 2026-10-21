import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ParentDeliveryManager } from '../dist/parent-delivery.js';
import { withExecutionRequest, currentExecutionRequest } from '../dist/execution-context.js';
import { createParentManagerExecution } from '../dist/execution-parent-manager.js';

const parent = { thread_id: '00000000-0000-4000-8000-000000000001', codex_home: '/synthetic/parent-home' };
const boundary = session_id => ({ session_id, launch_id: 'b'.repeat(32), vendor: 'codex', harness: 'codex-cli', event_cursor: 17, operation_id: null });
const request = session => ({ kind: 'delivery', delivery_id: 'existing-' + session, target_session_id: session });
const until = async check => { const end = performance.now() + 1000; while (!check()) {
  assert.ok(performance.now() < end); await new Promise(resolve => setTimeout(resolve, 2));
} };
function fixture(t, failFirst = false) {
  const root = mkdtempSync(join(tmpdir(), 'execution-manager-')), binds = [], submits = [], completions = new Map();
  const execution = {
    async bind(id, request, child, endpoint) {
      if (failFirst) { failFirst = false; throw Object.assign(Error('synthetic binding unavailable'), { code: 'EXECUTION_UNCONFIRMED' }); }
      binds.push({ id, request, child, endpoint });
    },
    async submit(endpoint, id, text) { submits.push({ endpoint, id, text }); return { queued_submission_id: 'native-existing-queue-id' }; },
  };
  const manager = new ParentDeliveryManager({ root, execution, dependencies: {
    processes: () => [{ pid: process.pid, started_identity: 'synthetic-owner' }], exists: () => true,
    verify: async () => {}, answer: async () => ({ text: 'synthetic answer' }),
    observe: async (session, options) => new Promise((resolve, reject) => {
      completions.set(session, resolve); options.signal?.addEventListener('abort', () => reject(Error('synthetic abort')), { once: true });
    }),
    submit: async () => { assert.fail('execution mode must not use a legacy submit fallback'); },
  } });
  t.after(async () => { await manager.close(); rmSync(root, { recursive: true, force: true }); });
  return { manager, binds, submits, finish(session) {
    completions.get(session)({ schema: 'aiterm.agent-wait-result.v1', ...boundary(session), outcome: 'done', turn_id: 'native-turn' });
  } };
}
test('public old steer without native callbacks is refused before any manager execution can be mounted', () => {
  assert.throws(() => createParentManagerExecution({ profile: {}, parent: {}, native: {} }), error => error.code === 'EXECUTION_UNSUPPORTED');
});
test('real manager captures the existing request and parent before_send, then uses the guarded submit exactly once', async t => {
  const f = fixture(t), original = request('bot-b'), endpoint = { ...parent };
  const delivery = withExecutionRequest(original, () => f.manager.request(endpoint));
  original.delivery_id = 'mutated'; endpoint.thread_id = 'different-thread';
  await delivery.before_send(boundary('bot-b'));
  assert.deepEqual(f.binds[0].request, request('bot-b')); assert.deepEqual(f.binds[0].endpoint, parent);
  assert.equal(f.binds[0].id, delivery.result().delivery_id);
  f.finish('bot-b'); await until(() => f.manager.status('bot-b')[0]?.state === 'submitted');
  assert.equal(f.submits.length, 1); assert.equal(f.submits[0].id, f.binds[0].id);
  assert.match(f.submits[0].text, /synthetic answer$/); assert.deepEqual(f.submits[0].endpoint, parent);
  assert.equal(currentExecutionRequest(), null);
});
test('concurrent manager requests retain their own original refs and missing context or remote cannot fabricate one', async t => {
  const f = fixture(t);
  const one = withExecutionRequest(request('bot-b'), () => f.manager.request(parent));
  const two = withExecutionRequest(request('bot-c'), () => f.manager.request(parent));
  await Promise.all([one.before_send(boundary('bot-b')), two.before_send(boundary('bot-c'))]);
  assert.deepEqual(f.binds.map(value => value.request.delivery_id).sort(), ['existing-bot-b', 'existing-bot-c']);
  await assert.rejects(f.manager.request(parent).before_send(boundary('bot-d')), error => error.code === 'EXECUTION_UNSUPPORTED');
  const remote = withExecutionRequest(request('bot-d'), () => f.manager.request(parent));
  await assert.rejects(remote.before_send({ ...boundary('bot-d'), remote: {} }), error => error.code === 'EXECUTION_UNSUPPORTED');
  assert.equal(f.binds.length, 2); assert.equal(f.submits.length, 0);
});
test('failed generation binding releases the existing child claim rather than leaving an untracked delivery', async t => {
  const f = fixture(t, true);
  const failed = withExecutionRequest(request('bot-b'), () => f.manager.request(parent));
  await assert.rejects(failed.before_send(boundary('bot-b')), error => error.code === 'EXECUTION_UNCONFIRMED');
  assert.equal(failed.result(), null); assert.equal(f.manager.status('bot-b').length, 0);
  const next = withExecutionRequest(request('bot-b'), () => f.manager.request(parent));
  await next.before_send(boundary('bot-b')); assert.equal(next.result().state, 'waiting');
});
