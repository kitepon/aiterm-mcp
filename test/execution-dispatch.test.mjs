// Historical destructive close/admission fixtures use closeCascade explicitly.
// These are not acceptance evidence for the session-preserving stop control.
import './seat-env.mjs';
import test from 'node:test';
// These integration cases require the private POSIX file/directory checkpoint.
const posixCheckpoint = process.platform === 'win32' ? 'private native graph requires POSIX directory fsync' : false;
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionDispatcher } from '../dist/execution-dispatch.js';
import { currentExecutionRequest, currentExecutionIngress } from '../dist/execution-context.js';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
import { ExecutionService } from '../dist/execution-service.js';
import { FileExecutionStore } from '../dist/execution-store.js';
import { guardTmuxExecution, prepareExecutionCreation, captureExecutionCreatedNative, bindExecutionCreatedLaunch,
  captureExecutionSendBoundary, readExecutionSendBoundary, withExecutionPreparation } from '../dist/execution-effect.js';
import { EXECUTION_REQUEST_META_KEY as REQUEST, EXECUTION_SOURCE_META_KEY as SOURCE,
  EXECUTION_BINDING_META_KEY as BINDING, EXECUTION_ERROR_META_KEY as ERROR } from '../dist/execution-wire.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { AsyncResource } from 'node:async_hooks';

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
  const observe = session_id => { options.beforeObserve?.(session_id); const value = live.get(session_id); return {
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
test('a native handler error retains its original error response and uncertainty without admitting a replay', { skip: posixCheckpoint }, async () => {
  const f = fixture();
  const original = { isError: true, content: [{ type: 'text', text: 'aiterm: synthetic native input failed after paste; Enter was not sent' }],
    _meta: { synthetic: 'original handler evidence' } };
  const call = () => f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 801 }, async () => {
    f.effect(); return original;
  });
  const result = await call();
  assert.equal(result.isError, true); assert.deepEqual(result.content, original.content);
  assert.equal(result._meta.synthetic, original._meta.synthetic);
  assert.equal(result._meta[ERROR].code, 'EXECUTION_UNCONFIRMED'); assert.equal(result._meta[ERROR].effect, 'possible');
  assert.equal((await f.records())[0].operations.send, 'unknown');
  assert.equal((await call()).isError, true); assert.equal(f.effects(), 1);
});
test('direct stdio uses existing native process/request identity and binds the genuine dispatch receipt', { skip: posixCheckpoint }, async () => {
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
test('actual request-local before_send reference preserves a managed operation absent from the structured receipt', { skip: posixCheckpoint }, async () => {
  const f = fixture(), boundary = { launch: B, boundary: { event_cursor: 17, operation_id: 'sha256:' + '7'.repeat(64), turn_id: null, steer_id: null } };
  const result = await f.dispatcher.dispatch('claude_turn', { action: 'issue', session_id: B.session_id, operation_id: boundary.boundary.operation_id },
    { requestId: 401 }, async () => {
      captureExecutionSendBoundary(boundary); f.effect();
      return { content: [], structuredContent: { schema: 'aiterm.claude-operation-result.v1', action: 'issue', status: 'accepted',
        session_id: B.session_id, operation_id: boundary.boundary.operation_id, raw_output: null, reason: null, submit_residue: null } };
    });
  assert.equal(result.isError, undefined); assert.deepEqual(result._meta[BINDING].target, boundary); assert.equal(f.effects(), 1);
  assert.deepEqual((await f.records())[0].relation.target, boundary);
});
test('model args and a receipt operation field do not replace missing actual core before_send provenance', { skip: posixCheckpoint }, async () => {
  const f = fixture(), operation = 'sha256:' + '7'.repeat(64);
  const result = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id, operation_id: operation }, { requestId: 402 }, async () => {
    f.effect(); const result = accepted(); result.structuredContent.operation_id = operation; return result;
  });
  assert.equal(result.isError, undefined); assert.equal(result._meta[BINDING].target.boundary.operation_id, null);
});
test('before_send snapshots are detached and cannot be borrowed by a later request or another target', { skip: posixCheckpoint }, async () => {
  const f = fixture(), original = { launch: B, boundary: { event_cursor: 17, operation_id: null, turn_id: null, steer_id: null } };
  const value = structuredClone(original); let late;
  const first = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 403 }, async () => {
    captureExecutionSendBoundary(value); value.boundary.event_cursor = 999;
    const read = readExecutionSendBoundary(B.session_id); read.boundary.event_cursor = 888;
    assert.deepEqual(readExecutionSendBoundary(B.session_id), original);
    const inherited = new AsyncResource('synthetic-late-before-send');
    late = () => inherited.runInAsyncScope(() => captureExecutionSendBoundary(original)); f.effect(); return accepted();
  });
  assert.deepEqual(first._meta[BINDING].target, original);
  assert.throws(late, error => error.code === 'EXECUTION_CONFLICT');
  const second = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 404 }, async () => {
    assert.equal(readExecutionSendBoundary(B.session_id), null); f.effect(); return accepted(B, 18);
  });
  assert.equal(second._meta[BINDING].target.boundary.event_cursor, 18); assert.equal(f.effects(), 2);
});
test('conflicting before_send references poison a frame before native input and cannot silently select a latest boundary', { skip: posixCheckpoint }, async () => {
  for (const other of ['cursor', 'target']) {
    const f = fixture(), first = { launch: B, boundary: { event_cursor: 17, operation_id: null, turn_id: null, steer_id: null } };
    const second = structuredClone(first); if (other === 'cursor') second.boundary.event_cursor++; else second.launch = D;
    const result = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 405 }, async () => {
      captureExecutionSendBoundary(first); try { captureExecutionSendBoundary(second); } catch {}
      try { f.effect(); } catch {} return accepted();
    });
    assert.equal(result.isError, true); assert.equal(f.effects(), 0);
  }
});
test('contradictory receipt and captured boundary retain the genuine accepted result with unknown binding and never resend', { skip: posixCheckpoint }, async () => {
  for (const change of ['cursor', 'operation', 'launch']) {
    const f = fixture(), before = { launch: B, boundary: { event_cursor: 17, operation_id: 'sha256:' + '7'.repeat(64), turn_id: null, steer_id: null } };
    const action = () => f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 406 }, async () => {
      captureExecutionSendBoundary(before); f.effect(); const result = accepted();
      if (change === 'cursor') result.structuredContent.event_cursor++;
      if (change === 'operation') result.structuredContent.operation_id = 'sha256:' + '8'.repeat(64);
      if (change === 'launch') result.structuredContent.launch_id = D.launch_id;
      return result;
    });
    const result = await action(); assert.notEqual(result.isError, true); assert.equal(result.structuredContent.mode, 'agent_dispatch');
    assert.equal(result._meta[ERROR].effect, 'possible'); assert.equal(f.effects(), 1);
    assert.equal((await action()).isError, true); assert.equal(f.effects(), 1);
  }
});
test('reading a captured pre-send reference after the native action does not re-admit its ended source or discard the genuine receipt', { skip: posixCheckpoint }, async () => {
  const f = fixture(), target = { launch: B, boundary: { event_cursor: 17, operation_id: 'sha256:' + '7'.repeat(64), turn_id: null, steer_id: null } };
  const result = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 407 }, async () => {
    captureExecutionSendBoundary(target); f.effect();
    f.live.set(A.session_id, { ...A, launch_id: D.launch_id }); // original source replaced after its actual input
    return accepted();
  });
  assert.equal(result.isError, undefined); assert.equal(result.structuredContent.mode, 'agent_dispatch');
  assert.deepEqual(result._meta[BINDING].target, target); assert.equal(f.effects(), 1);
  assert.deepEqual((await f.records())[0].relation.source, { launch: A, boundary: null });
});
test('source environment, native identity and ingress arguments are detached before async lookup', { skip: posixCheckpoint }, async () => {
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
test('preparing work is canceled without idle wait and its delayed native effect is refused', { skip: posixCheckpoint }, async () => {
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
test('replacement between preflight and native effect is rejected before touching either target', { skip: posixCheckpoint }, async () => {
  const f = fixture();
  const result = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 2 }, async () => {
    f.live.set(B.session_id, { ...B, launch_id: 'e'.repeat(32) });
    f.effect(); return accepted();
  });
  assert.equal(errorCode(result), 'EXECUTION_STALE_GENERATION');
  assert.equal(f.effects(), 0);
});
test('Bridge refs require the same fixed host source and cannot borrow another source reservation', { skip: posixCheckpoint }, async () => {
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
test('valid receipt survives missing binding evidence, and the issued slot blocks subsequent sends', { skip: posixCheckpoint }, async () => {
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
test('tracked steer keeps its real native reference while untracked steer has no fabricated boundary', { skip: posixCheckpoint }, async () => {
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
test('direct empty launch observes the actual new generation without manufacturing a dispatch cursor', { skip: posixCheckpoint }, async () => {
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
test('configure is admitted without an invocation edge, while key and approval responses reach mixed targets', { skip: posixCheckpoint }, async () => {
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
test('only known read actions bypass mutation admission; session auth status is not a read', { skip: posixCheckpoint }, async () => {
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
test('unsupported auto-name, raw generation, remote, missing native source or forged ref never invoke handlers', { skip: posixCheckpoint }, async () => {
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
test('actual SDK requestId reaches the dispatcher and native admission without model-supplied identity', { skip: posixCheckpoint }, async t => {
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

test('native ingress capture is synchronous and an asynchronous callback cannot become a deferred source proof or native send', { skip: posixCheckpoint }, async () => {
  const f = fixture({ bindings: { captureNativeParent: () => Promise.resolve(null) } });
  const result = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 'async-native-source' }, async () => {
    f.effect(); return accepted();
  });
  assert.equal(errorCode(result), 'EXECUTION_UNSUPPORTED'); assert.equal(f.effects(), 0); assert.deepEqual(await f.records(), []);
});
test('native ingress null is fixed by the private host adapter rather than model arguments or SDK meta claiming a proof', { skip: posixCheckpoint }, async () => {
  let calls = 0;
  const f = fixture({ bindings: { captureNativeParent: () => { calls++; return null; } } });
  const result = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id, native_parent: { forged: true } },
    { requestId: 'native-source-null', _meta: { native_parent: { forged: true } } }, async () => {
      const context = currentExecutionIngress(); assert.equal(context.ingress.native_parent, null);
      f.effect(); return accepted();
    });
  assert.equal(result.isError, undefined); assert.equal(calls, 1); assert.equal(f.effects(), 1);
});


test('SDK signal already cancelled refuses mutation before registration, while model cancellation fields are inert', { skip: posixCheckpoint }, async () => {
  const f = fixture(), controller = new AbortController(); controller.abort('synthetic');
  const result = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id },
    { requestId: 'cancelled-at-entry', signal: controller.signal }, async () => { f.effect(); return accepted(); });
  assert.equal(errorCode(result), 'EXECUTION_STOPPING'); assert.equal(f.effects(), 0); assert.deepEqual(await f.records(), []);
  const next = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id, signal: { aborted: true } },
    { requestId: 'new-rpc', _meta: { signal: { aborted: true }, cancelled: true } }, async () => { f.effect(); return accepted(); });
  assert.equal(next.isError, undefined); assert.equal(f.effects(), 1);
});

test('cancel during initial target observation cannot register a delayed request or affect a new request on the same launch', { skip: posixCheckpoint }, async () => {
  const entered = pause(), resume = pause(), controller = new AbortController(); let gated = false;
  const f = fixture({ bindings: { async observeSessionGeneration(session_id) {
    if (!gated) { gated = true; entered.resolve(); await resume.promise; }
    return { schema: 'aiterm.pty-observe-result.v1', session_id, exists: true, launch_id: B.launch_id };
  } } });
  const pending = f.dispatcher.dispatch('pty_send', { session_id: B.session_id },
    { requestId: 'cancel-before-register', signal: controller.signal }, async () => { f.effect(); return accepted(); });
  await entered.promise; controller.abort(); resume.resolve(); const result = await pending;
  assert.equal(errorCode(result), 'EXECUTION_STOPPING'); assert.deepEqual(await f.records(), []); assert.equal(f.effects(), 0);
  const next = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 'same-launch-new-rpc' }, async () => {
    f.effect(); return accepted();
  });
  assert.equal(next.isError, undefined); assert.equal(f.effects(), 1);
});

test('preparing SDK cancellation immediately fences metadata and native input without waiting for the shared store lock', { skip: posixCheckpoint }, async () => {
  const f = fixture(), entered = pause(), resume = pause(), locked = pause(), unlock = pause(), controller = new AbortController();
  const pending = f.dispatcher.dispatch('pty_send', { session_id: B.session_id },
    { requestId: 'cancel-preparing', signal: controller.signal }, async () => {
      entered.resolve(); await resume.promise;
      assert.throws(() => withExecutionPreparation(B.session_id, () => assert.fail('cancelled metadata')), error => error.code === 'EXECUTION_STOPPING');
      f.effect(); return accepted();
    });
  await entered.promise;
  const held = f.store.transaction(async () => { locked.resolve(); await unlock.promise; }); await locked.promise;
  controller.abort(); resume.resolve();
  // Release the shared lock only after local synchronous checks ran. An async
  // cancellation writer cannot be the sole native gate here.
  await new Promise(resolve => setImmediate(resolve)); unlock.resolve(); await held;
  const result = await pending;
  assert.equal(result.isError, true); assert.equal(result._meta[ERROR].effect, 'not_started'); assert.equal(f.effects(), 0);
  const record = (await f.records())[0]; assert.equal(record.stopping, true); assert.equal(record.operations.send, 'not_sent');
  assert.equal(record.relation.completion, 'open'); assert.notEqual(record.relation.target_fence, 'closed');
  assert.deepEqual(await f.store.transaction(state => state.slots, { readOnly: true }), []);
});

test('issued cancellation keeps genuine delayed receipt, original Point and open fence without stopping another request', { skip: posixCheckpoint }, async () => {
  const f = fixture(), entered = pause(), resume = pause(), controller = new AbortController();
  const pending = f.dispatcher.dispatch('pty_send', { session_id: B.session_id },
    { requestId: 'cancel-issued-receipt', signal: controller.signal }, async () => {
      captureExecutionSendBoundary({ launch: B, boundary: { event_cursor: 17, operation_id: null, turn_id: null, steer_id: null } });
      f.effect(); entered.resolve(); await resume.promise; return accepted();
    });
  await entered.promise; controller.abort(); resume.resolve(); const result = await pending;
  assert.equal(result.isError, undefined); assert.equal(result._meta.preserved, 'original'); assert.equal(f.effects(), 1);
  const record = (await f.records())[0]; assert.equal(record.stopping, true); assert.equal(record.operations.send, 'accepted');
  assert.deepEqual(record.relation.target, result._meta[BINDING].target); assert.equal(record.relation.target.boundary.turn_id, null);
  assert.equal(record.relation.completion, 'open'); assert.equal(record.relation.target_fence, 'open');
  assert.deepEqual(await f.store.transaction(state => state.slots, { readOnly: true }), []);
  const next = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 'unrelated-rpc' }, async () => { f.effect(); return accepted(B, 18); });
  assert.equal(next.isError, undefined); assert.equal(f.effects(), 2); assert.equal((await f.records())[1].stopping, false);
});

test('cancel after native issuance rejects a later effect and preserves unknown operation/slot without replay', { skip: posixCheckpoint }, async () => {
  const f = fixture(), entered = pause(), resume = pause(), controller = new AbortController();
  const pending = f.dispatcher.dispatch('pty_send', { session_id: B.session_id },
    { requestId: 'cancel-issued-followup', signal: controller.signal }, async () => {
      f.effect(); entered.resolve(); await resume.promise; f.effect(); return accepted();
    });
  await entered.promise; controller.abort(); resume.resolve(); const result = await pending;
  assert.equal(errorCode(result), 'EXECUTION_UNCONFIRMED'); assert.equal(result._meta[ERROR].effect, 'possible'); assert.equal(f.effects(), 1);
  const record = (await f.records())[0]; assert.equal(record.stopping, true); assert.equal(record.operations.send, 'unknown');
  const slots = await f.store.transaction(state => state.slots, { readOnly: true }); assert.equal(slots.length, 1); assert.equal(slots[0].state, 'unknown');
  const retry = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id },
    { requestId: 'cancel-issued-followup' }, async () => { f.effect(); return accepted(); });
  assert.equal(retry.isError, true); assert.equal(f.effects(), 1);
});


test('cancellation persistence failure retains the genuine successful result with status-only uncertainty', { skip: posixCheckpoint }, async () => {
  const f = fixture(), controller = new AbortController();
  f.service.cancelRequestActions = async () => { throw new Error('synthetic unavailable metadata'); };
  const result = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id },
    { requestId: 'cancel-storage-uncertain', signal: controller.signal }, async () => { f.effect(); controller.abort(); return accepted(); });
  assert.equal(result.isError, undefined); assert.equal(result.structuredContent.mode, 'agent_dispatch');
  assert.equal(result._meta.preserved, 'original'); assert.equal(result._meta[ERROR].effect, 'possible');
  assert.equal(result._meta[ERROR].follow_up, 'status_only'); assert.equal(f.effects(), 1);
  assert.equal((await f.records())[0].operations.send, 'accepted');
});

test('read-only and registered controls do not create cancelled mutation records or normal native frames', { skip: posixCheckpoint }, async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  f.dispatcher.prepareControlRegistration(f.service).activate();
  for (const [name, args] of [['pty_observe', { session_id: B.session_id }], ['agent_stop', {}]]) {
    const result = await f.dispatcher.dispatch(name, args, { signal: controller.signal }, async () => ({ content: [] }));
    assert.equal(result.isError, undefined);
  }
  assert.deepEqual(await f.records(), []); assert.equal(f.effects(), 0);
});

for (const mode of ['notification', 'transport-close']) test('real SDK ' + mode + ' fences the exact original RPC and preserves its issued receipt', { skip: posixCheckpoint }, async t => {
  const f = fixture(), entered = pause(), resume = pause(), aborted = pause(), finished = pause();
  const server = new McpServer({ name: 'synthetic-aiterm', version: '0.0.0' });
  let originalRequest, serverResult;
  server.registerTool('pty_send', { inputSchema: { session_id: z.string(), text: z.string() } }, async (args, extra) => {
    extra.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    try {
      serverResult = await f.dispatcher.dispatch('pty_send', args, extra, async () => {
        originalRequest = currentExecutionRequest(); f.effect(); entered.resolve(); await resume.promise; return accepted();
      }); return serverResult;
    } finally { finished.resolve(); }
  });
  const client = new Client({ name: 'codex', version: '0.0.0' }), controller = new AbortController();
  const [left, right] = InMemoryTransport.createLinkedPair();
  t.after(async () => { resume.resolve(); await client.close(); await server.close(); });
  await server.connect(left); await client.connect(right);
  const pending = client.callTool({ name: 'pty_send', arguments: { session_id: B.session_id, text: 'synthetic' } }, undefined,
    { signal: controller.signal }).then(value => ({ value }), error => ({ error }));
  await entered.promise;
  if (mode === 'notification') {
    await client.notification({ method: 'notifications/cancelled', params: { requestId: originalRequest.request_id + 999, reason: 'unrelated RPC' } });
    assert.equal((await f.records())[0].stopping, false);
    controller.abort(new Error('synthetic client cancellation'));
  }
  else await client.close();
  await aborted.promise; resume.resolve(); await finished.promise; assert.ok((await pending).error);
  assert.equal(serverResult.isError, undefined); assert.equal(serverResult.structuredContent.mode, 'agent_dispatch');
  const record = (await f.records())[0]; assert.deepEqual(record.reservation.request, originalRequest);
  assert.equal(record.stopping, true); assert.equal(record.operations.send, 'accepted');
  assert.equal(record.relation.completion, 'open'); assert.equal(record.relation.target_fence, 'open');
  assert.equal(f.effects(), 1); assert.equal(record.relation.target.boundary.turn_id, null);
  assert.deepEqual(await f.store.transaction(state => ({ slots: state.slots, stopping: state.stopping, interruptions: state.interruptions }),
    { readOnly: true }), { slots: [], stopping: [], interruptions: [] });
});


test('host cancellation is applied only after the supplied ref target and fixed source are authorized', { skip: posixCheckpoint }, async () => {
  const f = fixture({ clientName: 'bellteam' }), request = { kind: 'delivery', delivery_id: 'cancel-host-existing', target_session_id: B.session_id };
  await f.service.execute({ action: 'register', source_session_id: A.session_id,
    reservation: { schema: 'aiterm.execution-reservation.v1', request, source: point(A),
      target: { session_id: B.session_id, expected_launch_id: B.launch_id } } }, { schema: 'aiterm.execution-source.v1', source: point(A) });
  const controller = new AbortController(); controller.abort();
  const ref = { schema: 'aiterm.execution-ref.v1', request };
  const refused = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id }, { requestId: 'wrong-host', signal: controller.signal,
    _meta: { [REQUEST]: ref, [SOURCE]: { schema: 'aiterm.execution-source.v1', source: point(D) } } }, async () => { f.effect(); return accepted(); });
  assert.equal(errorCode(refused), 'EXECUTION_STALE_GENERATION'); assert.equal((await f.records())[0].stopping, false);
  const cancelled = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id },
    { requestId: 'authorized-host', signal: controller.signal, _meta: { [REQUEST]: ref } }, async () => { f.effect(); return accepted(); });
  assert.equal(errorCode(cancelled), 'EXECUTION_STOPPING'); assert.equal((await f.records())[0].stopping, true); assert.equal(f.effects(), 0);
});


test('cancellation raised by a synchronous native observation is rechecked before the issuance checkpoint', { skip: posixCheckpoint }, async () => {
  const controller = new AbortController(); let armed = false;
  const f = fixture({ beforeObserve: () => { if (armed) { armed = false; controller.abort(); } } });
  const result = await f.dispatcher.dispatch('pty_send', { session_id: B.session_id },
    { requestId: 'cancel-inside-native-observe', signal: controller.signal }, async () => {
      armed = true; f.effect(); return accepted();
    });
  assert.equal(result.isError, true); assert.equal(result._meta[ERROR].effect, 'not_started'); assert.equal(f.effects(), 0);
  const record = (await f.records())[0]; assert.equal(record.stopping, true); assert.equal(record.operations.send, 'not_sent');
  assert.deepEqual(await f.store.transaction(state => state.slots, { readOnly: true }), []);
});
