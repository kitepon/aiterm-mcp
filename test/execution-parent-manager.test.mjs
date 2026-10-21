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
function fixture(t, failFirst = false, capture, tracking) {
  const root = mkdtempSync(join(tmpdir(), 'execution-manager-')), binds = [], submits = [], completions = new Map();
  const execution = {
    ...(capture ? { captureEndpointEvidence: capture } : {}),
    ...(tracking ? { recordChildCompletion: tracking } : {}),
    async bind(id, request, child, endpoint, evidence) {
      if (failFirst) { failFirst = false; throw Object.assign(Error('synthetic binding unavailable'), { code: 'EXECUTION_UNCONFIRMED' }); }
      binds.push({ id, request, child, endpoint, ...(evidence === undefined ? {} : { evidence }) });
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
test('manager captures and detaches native evidence at request time rather than a later registration continuation', async t => {
  const original = { native_tool_id: 'existing-native-tool', request: request('bot-b') };
  const f = fixture(t, false, () => original);
  const delivery = withExecutionRequest(request('bot-b'), () => f.manager.request(parent));
  original.native_tool_id = 'late-tool'; original.request.delivery_id = 'late-ref';
  await delivery.before_send(boundary('bot-b'));
  assert.deepEqual(f.binds[0].evidence, { native_tool_id: 'existing-native-tool', request: request('bot-b') });
});
test('execution uses the actual provider error class to distinguish a refusal from missing RPC outcome', () => {
  class ProviderError extends Error { constructor(outcome_unknown) { super('synthetic vendor error'); this.outcome_unknown = outcome_unknown; } }
  const execution = createParentManagerExecution({ parent: {}, native: {}, profile: {}, provider: {
    withDeliveryEffect() {}, SteerDeliveryError: ProviderError,
    DELIVERY_ADMISSION_CONTRACT: { schema: 'steer.delivery-admission.v1', native_context: true,
      cursor_profile_parameter: true, multi_delivery_emit: true, serialized_required: true },
    submitCodexParentAnswer() {}, submitClaudeParentAnswer() {}, submitCursorParentAnswer() {},
  } });
  assert.equal(execution.outcomeUnknown(new ProviderError(false)), false);
  assert.equal(execution.outcomeUnknown(new ProviderError(true)), true);
  assert.equal(execution.outcomeUnknown(Object.assign(Error('RPC reject'), { outcome_unknown: false })), null);
});
test('missing execution completion proof preserves the real saved answer and keeps normal delivery', async t => {
  let observed = 0;
  const f = fixture(t, false, undefined, async () => { observed++; throw Error('synthetic native done proof unavailable'); });
  const delivery = withExecutionRequest(request('bot-b'), () => f.manager.request(parent));
  await delivery.before_send(boundary('bot-b')); f.finish('bot-b');
  await until(() => f.manager.status('bot-b')[0]?.state === 'submitted');
  assert.equal(observed, 1); assert.equal(f.submits.length, 1); assert.match(f.submits[0].text, /synthetic answer/);
});
test('durable answer releases its old child claim while execution metadata waits for the original receipt', async t => {
  const entered = { done: false }; let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture(t, false, undefined, async () => { entered.done = true; await pending; });
  const one = withExecutionRequest(request('bot-b'), () => f.manager.request(parent));
  await one.before_send(boundary('bot-b')); f.finish('bot-b'); await until(() => entered.done);
  const two = withExecutionRequest({ ...request('bot-b'), delivery_id: 'new-existing-request' }, () => f.manager.request(parent));
  try { await two.before_send(boundary('bot-b')); }
  finally { release(); }
  assert.notEqual(two.result().delivery_id, one.result().delivery_id);
});
