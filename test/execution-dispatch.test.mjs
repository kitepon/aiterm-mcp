// Historical destructive close/admission fixtures use closeCascade explicitly.
// These are not acceptance evidence for the session-preserving stop control.
import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionDispatcher } from '../dist/execution-dispatch.js';
import { currentExecutionRequest } from '../dist/execution-context.js';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
import { ExecutionService } from '../dist/execution-service.js';
import { FileExecutionStore } from '../dist/execution-store.js';
import { guardTmuxExecution, prepareExecutionCreation, captureExecutionCreatedNative, bindExecutionCreatedLaunch } from '../dist/execution-effect.js';
import { EXECUTION_REQUEST_META_KEY as REQUEST, EXECUTION_SOURCE_META_KEY as SOURCE,
  EXECUTION_BINDING_META_KEY as BINDING, EXECUTION_ERROR_META_KEY as ERROR } from '../dist/execution-wire.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';

const A = { session_id: 'bot-a', launch_id: 'a'.repeat(32) };
const B = { session_id: 'bot-b', launch_id: 'b'.repeat(32) };
const D = { session_id: 'bot-d', launch_id: 'd'.repeat(32) };
const point = launch => ({ launch, boundary: null });
const env = { AITERM_SESSION_ID: A.session_id, AITERM_AGENT_LAUNCH_ID: A.launch_id };
const accepted = (target = B, cursor = 17) => ({ content: [{ type: 'text', text: 'accepted' }],
  structuredContent: { schema: 'aiterm.pty-send-result.v1', mode: 'agent_dispatch',
    session_id: target.session_id, launch_id: target.launch_id, event_cursor: cursor },
  _meta: { preserved: 'original' } });
const errorCode = value => value._meta?.[ERROR]?.code;
const pause = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(options = {}) {
  const live = new Map([A, B, D].map(value => [value.session_id, value]));
  const store = new FileExecutionStore(mkdtempSync(join(tmpdir(), 'execution-dispatch-')));
  let effects = 0, clientName = options.clientName ?? 'codex';
  const observe = session_id => { const value = live.get(session_id); return {
    schema: 'aiterm.pty-observe-result.v1', session_id, exists: !!value, launch_id: value?.launch_id ?? null }; };
  const runtime = createExecutionRuntime({ sourceEnvironment: env,
    observeSession: observe, observeSessionSync: observe,
    ...(options.nativeCreation ? { observeNativeSessionsSync: () => ({ state: 'known',
      server: { pid: 4711, started_identity: 'synthetic-native-server' },
      sessions: [...live.values()].map(value => ({ session_id: value.session_id, native_id: value.session_id === B.session_id ? '$9' : '$10' })) }) } : {}),
    async observeDone() { throw new Error('no native done fixture'); },
    async guardedClose(launch) { assert.deepEqual(live.get(launch.session_id), launch); live.delete(launch.session_id); },
  });
  const service = new ExecutionService(store, runtime, 30);
  const bindings = { service, sourceEnvironment: options.environment ?? env,
    nativeIdentity: { pid: 12345, started_identity: 'synthetic-existing-native-start' },
    initializedClientName: () => clientName, observeSessionGeneration: observe, ...options.bindings };
  const dispatcher = createExecutionDispatcher(bindings);
  const effect = (session = B.session_id) => {
    assert.deepEqual(guardTmuxExecution(['send-keys', '-t', session, 'synthetic-payload']),
      ['send-keys', '-t', '=' + session + ':', 'synthetic-payload']);
    effects++;
  };
  return { live, store, service, dispatcher, bindings, effect, effects: () => effects,
    client: value => { clientName = value; },
    async records() { return store.transaction(state => structuredClone(state.records), { readOnly: true }); },
  };
}
test('direct stdio uses existing native process/request identity and binds the genuine dispatch receipt', async () => {
  const f = fixture(), input = { session_id: B.session_id, text: 'synthetic' };
  const result = await f.dispatcher.dispatch('pty_send', input, { requestId: 42 }, async (args, extra) => {
    assert.notEqual(args, input);
    assert.equal(extra._meta[REQUEST].request.request_id, 42);
    assert.deepEqual(currentExecutionRequest(), extra._meta[REQUEST].request);
    f.effect(args.session_id); return accepted();
  });
  assert.equal(result.isError, undefined);
  assert.equal(f.effects(), 1);
  assert.equal(currentExecutionRequest(), null);
  assert.equal(result._meta.preserved, 'original');
  const request = result._meta[BINDING].request;
  assert.equal(request.kind, 'mcp');
  assert.deepEqual([request.process_pid, request.process_started_identity, request.tool],
    [12345, 'synthetic-existing-native-start', 'pty_send']);
  assert.deepEqual(result._meta[BINDING].source.point, point(A));
  assert.equal(result._meta[BINDING].target.boundary.event_cursor, 17);
  const duplicate = await f.dispatcher.dispatch('pty_send', input, { requestId: 42 }, async () => {
    f.effect(); return accepted();
  });
  assert.equal(errorCode(duplicate), 'EXECUTION_CONFLICT');
  assert.equal(f.effects(), 1);
});
test('source environment, native identity and ingress arguments are detached before async lookup', async () => {
  const environment = { ...env }, nativeIdentity = { pid: 12345, started_identity: 'original-start' };
  const f = fixture({ environment, bindings: { nativeIdentity } });
  environment.AITERM_AGENT_LAUNCH_ID = D.launch_id;
  nativeIdentity.started_identity = 'changed-after-construction';
  const args = { session_id: B.session_id }, extra = { requestId: 7 };
  const promise = f.dispatcher.dispatch('pty_key', args, extra, async fixed => {
    assert.equal(fixed.session_id, B.session_id); f.effect(); return { content: [] };
  });
  args.session_id = D.session_id; extra.requestId = 9;
  const result = await promise, binding = result._meta[BINDING];
  assert.equal(binding.request.request_id, 7);
  assert.equal(binding.request.process_started_identity, 'original-start');
  assert.deepEqual(binding.source.point, point(A));
});
test('preparing work is canceled without idle wait and its delayed native effect is refused', async () => {
  const f = fixture(), entered = pause(), release = pause();
  const action = f.dispatcher.dispatch('agent_configure', { session_id: B.session_id }, { requestId: 3 }, async () => {
    entered.resolve(); await release.promise; f.effect(); return { content: [] };
  });
  await entered.promise;
  const stopped = await f.service.closeCascade({ schema: 'aiterm.cascade-stop-request.v1', roots: [A] });
  assert.equal(stopped.targets[0].outcome, 'closed');
  release.resolve();
  const result = await action;
  assert.equal(result.isError, true); assert.equal(result._meta[ERROR].effect, 'not_started');
  assert.equal(f.effects(), 0); assert.ok(f.live.has(B.session_id));
});
test('replacement between preflight and native effect is rejected before touching either target', async () => {
  const f = fixture();
  const result = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 2 }, async () => {
    f.live.set(B.session_id, { ...B, launch_id: 'e'.repeat(32) });
    f.effect(); return accepted();
  });
  assert.equal(errorCode(result), 'EXECUTION_STALE_GENERATION');
  assert.equal(f.effects(), 0);
});
test('Bridge refs require the same fixed host source and cannot borrow another source reservation', async () => {
  const f = fixture({ clientName: 'bellteam' });
  const request = { kind: 'delivery', delivery_id: 'existing-bridge-id', target_session_id: B.session_id };
  await f.service.execute({ action: 'register', source_session_id: A.session_id,
    reservation: { schema: 'aiterm.execution-reservation.v1', request,
      source: point(A), target: { session_id: B.session_id, expected_launch_id: B.launch_id } } },
  { schema: 'aiterm.execution-source.v1', source: point(A) });
  const meta = source => ({ [REQUEST]: { schema: 'aiterm.execution-ref.v1', request },
    [SOURCE]: { schema: 'aiterm.execution-source.v1', source } });
  for (const source of [point(D), null]) {
    const result = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 5, _meta: meta(source) }, async () => {
      f.effect(); return accepted();
    });
    assert.equal(errorCode(result), 'EXECUTION_STALE_GENERATION');
  }
  assert.equal(f.effects(), 0);
  // The established Bridge contract fixes context at register; its later send
  // carries the existing ref alone. This must not add a new host-meta demand.
  const result = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 6,
    _meta: { [REQUEST]: { schema: 'aiterm.execution-ref.v1', request } } }, async () => {
    f.effect(); return accepted();
  });
  assert.deepEqual(result._meta[BINDING].request, request);
  assert.equal(f.effects(), 1);
});
test('valid receipt survives missing binding evidence, and the issued slot blocks subsequent sends', async () => {
  const f = fixture(), receipt = accepted();
  receipt.structuredContent.session_id = 'different-receipt-target';
  const result = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 8 }, async () => {
    f.effect(); return receipt;
  });
  assert.deepEqual(result.structuredContent, receipt.structuredContent);
  assert.equal(result.isError, undefined);
  assert.equal(result._meta[ERROR].effect, 'possible');
  assert.equal(result._meta[ERROR].follow_up, 'status_only');
  const next = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 9 }, async () => {
    f.effect(); return accepted();
  });
  assert.equal(errorCode(next), 'EXECUTION_UNCONFIRMED'); assert.equal(f.effects(), 1);
});
test('tracked steer keeps its real native reference while untracked steer has no fabricated boundary', async () => {
  for (const tracked of [true, false]) {
    const f = fixture(), result = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 1 }, async () => {
      f.effect(); const receipt = accepted(); receipt.structuredContent.mode = 'agent_steer';
      if (tracked) receipt._meta['aiterm/steer'] = { schema: 'aiterm.steer-ref.v1', steer_id: '1'.repeat(16) };
      return receipt;
    });
    assert.equal(result.isError, undefined);
    assert.equal(result._meta[BINDING].target.boundary?.steer_id ?? null, tracked ? '1'.repeat(16) : null);
    if (!tracked) assert.equal(result._meta[BINDING].target.boundary, null);
  }
});
test('direct empty launch observes the actual new generation without manufacturing a dispatch cursor', async () => {
  const f = fixture({ nativeCreation: true }); f.live.delete(B.session_id); f.live.delete(D.session_id);
  const result = await f.dispatcher.dispatch('agent_launch', { session_name: B.session_id }, { requestId: 4 }, async () => {
    prepareExecutionCreation();
    guardTmuxExecution(['new-session', '-s', B.session_id]);
    f.live.set(B.session_id, B);
    captureExecutionCreatedNative('$9\t' + B.session_id + '\t4711\n'); bindExecutionCreatedLaunch(B);
    return { content: [], structuredContent: { schema: 'aiterm.agent-launch-result.v1', session_id: B.session_id, event_cursor: null } };
  });
  assert.deepEqual(result._meta[BINDING].target, point(B));
  assert.equal((await f.records())[0].operations.send, 'not_issued');
});
test('configure is admitted without an invocation edge, while key and approval responses reach mixed targets', async () => {
  for (const tool of ['agent_configure', 'pty_key', 'agent_approval', 'claude_approval']) {
    const f = fixture();
    const result = await f.dispatcher.dispatch(tool, { session_id: B.session_id, action: 'respond' }, { requestId: 1 }, async () => {
      f.effect(); return { content: [] };
    });
    assert.equal(result.isError, undefined);
    const stopped = await f.service.closeCascade({ schema: 'aiterm.cascade-stop-request.v1', roots: [A] });
    assert.deepEqual(stopped.targets.map(value => value.launch.session_id), tool === 'agent_configure' ? [A.session_id] : [A.session_id, B.session_id]);
  }
});
test('only known read actions bypass mutation admission; session auth status is not a read', async () => {
  const f = fixture();
  for (const [name, args] of [['agent_approval', { action: 'inspect' }], ['claude_turn', { action: 'recover' }],
    ['agent_auth', { action: 'status' }], ['pty_observe', { session_id: B.session_id }]]) {
    const result = await f.dispatcher.dispatch(name, args, {}, async () => ({ content: [] }));
    assert.equal(result.isError, undefined);
  }
  assert.equal((await f.records()).length, 0);
  const status = await f.dispatcher.dispatch('agent_auth', { action: 'status', session_id: B.session_id }, { requestId: 1 }, async () => {
    f.effect(); return { content: [] };
  });
  assert.equal(status.isError, undefined);
  assert.equal((await f.records())[0].reservation.request.tool, 'agent_auth.status');
});
test('unsupported auto-name, raw generation, remote, missing native source or forged ref never invoke handlers', async () => {
  const f = fixture(); f.live.set('ordinary-pty', { session_id: 'ordinary-pty', launch_id: null });
  let calls = 0;
  for (const [name, args, extra] of [['agent_launch', {}, { requestId: 1 }], ['pty_send', { session_id: 'ordinary-pty' }, { requestId: 2 }],
    ['pty_send', { session_id: B.session_id, remote: {} }, { requestId: 3 }],
    ['pty_send', { session_id: B.session_id }, {}], ['unknown-tool', {}, { requestId: 4 }]]) {
    const result = await f.dispatcher.dispatch(name, args, extra, async () => { calls++; return accepted(); });
    assert.equal(result.isError, true);
  }
  const missing = fixture({ environment: { AITERM_SESSION_ID: A.session_id } });
  assert.equal(errorCode(await missing.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 1 }, async () => {
    calls++; return accepted();
  })), 'EXECUTION_UNCONFIRMED');
  f.client('bellteam');
  assert.equal(errorCode(await f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 1 }, async () => {
    calls++; return accepted();
  })), 'EXECUTION_UNSUPPORTED');
  assert.equal(calls, 0);
});
test('actual SDK requestId reaches the dispatcher and native admission without model-supplied identity', async t => {
  const f = fixture(), server = new McpServer({ name: 'synthetic-aiterm', version: '0.0.0' });
  server.registerTool('pty_send', { inputSchema: { session_id: z.string(), text: z.string() } }, (args, extra) =>
    f.dispatcher.dispatch('pty_send', args, extra, async (fixed, fixedExtra) => {
      assert.equal(typeof fixedExtra.sendNotification, 'function');
      assert.equal(fixedExtra.signal, extra.signal);
      f.effect(fixed.session_id); return accepted();
    }));
  const client = new Client({ name: 'codex', version: '0.0.0' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(left); await client.connect(right);
  const result = await client.callTool({ name: 'pty_send', arguments: { session_id: B.session_id, text: 'synthetic' } });
  assert.equal(result.isError, undefined); assert.equal(f.effects(), 1);
  assert.equal(Number.isSafeInteger(result._meta[BINDING].request.request_id), true);
});
