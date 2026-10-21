import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createExecutionDispatcher } from '../dist/execution-dispatch.js';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
import { ExecutionService } from '../dist/execution-service.js';
import { FileExecutionStore } from '../dist/execution-store.js';
import { currentExecutionIngress } from '../dist/execution-context.js';
import { ExecutionError, EXECUTION_ERROR_META_KEY as ERROR, EXECUTION_BINDING_META_KEY as BINDING } from '../dist/execution-wire.js';

// Import and constructor are not an executable MCP/stdio entry. Every native
// call in acceptance is intercepted; no fallback can reach a host binary.
const originals = { spawnSync: childProcess.spawnSync, spawn: childProcess.spawn };
let runner;
childProcess.spawnSync = (...args) => { assert.ok(runner, 'no native calls during module import or metadata-only acceptance'); return runner(...args); };
childProcess.spawn = () => assert.fail('no native async process permitted');
syncBuiltinESMExports();
const { createAitermServer } = await import('../dist/index.js');
test.after(() => { Object.assign(childProcess, originals); syncBuiltinESMExports(); });
test.afterEach(() => { runner = null; });
const A = { session_id: 'bot-server-source', launch_id: 'a'.repeat(32) }, B = { session_id: 'bot-server-target', launch_id: 'b'.repeat(32) };
const TOOL_NAMES = ['diagnostics', 'pty_open', 'pty_send', 'pty_read', 'pty_key', 'pty_list', 'pty_observe', 'pty_close',
  'agent_launch', 'claude_agent', 'codex_agent', 'grok_agent', 'agent_models', 'agent_configure', 'agent_auth',
  'agent_approval', 'claude_approval', 'claude_turn'].sort();
const pause = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const native = { pid: 12345, started_identity: 'synthetic-server-native-process' };
const posix = { skip: process.platform === 'win32' ? 'POSIX tmux command fixture' : false };
const parent = { captureEndpointEvidence() { assert.fail('no native parent endpoint supplied'); },
  async bind() { assert.fail('no parent bind fixture'); }, async submit() { assert.fail('no parent submit fixture'); } };
async function connect(t, server, name = 'synthetic-fixed-client') {
  const client = new Client({ name, version: 'synthetic' }), [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide); await client.connect(clientSide);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}
async function fixture(t, environment = { AITERM_SESSION_ID: A.session_id, AITERM_AGENT_LAUNCH_ID: A.launch_id }, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'execution-server-'));
  const store = new FileExecutionStore(directory), live = new Map([A, B].map(launch => [launch.session_id, launch]));
  const effects = []; let hold = null, parentProbes = 0;
  const snapshot = session_id => ({ schema: 'aiterm.pty-observe-result.v1', session_id,
    exists: live.has(session_id), launch_id: live.get(session_id)?.launch_id ?? null });
  const observe = async session => {
    if (session === B.session_id && hold) {
      const pending = hold; hold = null; pending.entered.resolve(); await pending.release.promise;
    }
    return snapshot(session);
  };
  const runtime = createExecutionRuntime({ sourceEnvironment: environment, observeSession: observe, observeSessionSync: snapshot,
    async observeDone() { assert.fail('no native done fixture'); },
    async guardedClose(expected) { assert.deepEqual(live.get(expected.session_id), expected); live.delete(expected.session_id); } });
  const service = new ExecutionService(store, runtime, 5);
  const server = createAitermServer({ execution: server => ({ parentExecution: options.parentExecution ?? parent,
    parentRoot: join(directory, 'parent'), parentDependencies: {
      processes: pids => { parentProbes++; return pids.map(pid => ({ pid, started_identity: 'synthetic-parent-owner' })); },
      exists: () => true, async verify() {}, async observe() { assert.fail('no parent waiter fixture'); },
      async answer() { assert.fail('no parent answer fixture'); },
    },
    dispatcher: createExecutionDispatcher({ service, sourceEnvironment: environment, nativeIdentity: native,
      initializedClientName: () => server.server.getClientVersion()?.name, observeSessionGeneration: observe }) }) });
  const ok = stdout => ({ status: 0, stdout: stdout ?? '', stderr: '' });
  runner = (bin, args) => {
    assert.equal(bin, 'tmux');
    if (args.length === 1 && args[0] === '-V') return ok('tmux synthetic');
    assert.equal(args[0], '-S'); args = args.slice(2);
    const target = args.includes('-t') ? args[args.indexOf('-t') + 1] : null;
    if (args[0] === 'has-session') return { ...ok(''), status: live.has(target?.replace(/^=/, '').replace(/:.*$/, '')) ? 0 : 1 };
    if (args[0] === 'list-sessions') return ok([...live.values()].map(value => value.session_id + '\tbash\t0\t80\t24').join('\n'));
    if (['send-keys', 'kill-session'].includes(args[0])) {
      assert.equal(target, '=' + B.session_id + ':'); effects.push(args[0]);
      if (args[0] === 'kill-session') live.delete(B.session_id);
      return ok('');
    }
    assert.fail('unexpected synthetic process command: ' + args[0]);
  };
  const client = await connect(t, server, options.clientName ?? 'synthetic-fixed-client');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { client, server, service, store, live, effects, parentProbes: () => parentProbes,
    holdTarget() { hold = { entered: pause(), release: pause() }; return hold; } };
}
test('default and injected constructors expose the same 18 real tools without registering cascade controls or starting stdio', async t => {
  const client = await connect(t, createAitermServer());
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), TOOL_NAMES);
  const f = await fixture(t);
  assert.deepEqual((await f.client.listTools()).tools.map(tool => tool.name).sort(), TOOL_NAMES);
  assert.deepEqual(f.effects, []);
});
test('an incomplete private execution factory cannot fall back to a legacy parent manager', () => {
  for (const value of [undefined, {}, { dispatcher: { dispatch() {} } }, { dispatcher: { dispatch() {} }, parentExecution: {} }])
    assert.throws(() => createAitermServer({ execution: () => value }), error => error.code === 'EXECUTION_UNSUPPORTED');
});
test('real in-memory SDK handler sends one actual core key through the durable request frame and preserves its binding', posix, async t => {
  const f = await fixture(t), result = await f.client.callTool({ name: 'pty_key', arguments: { session_id: B.session_id, key: 'C-c' } });
  assert.equal(result.isError, undefined); assert.deepEqual(f.effects, ['send-keys']);
  assert.deepEqual(result._meta[BINDING].source.point.launch, A); assert.deepEqual(result._meta[BINDING].target.launch, B);
  assert.equal(result._meta[BINDING].request.process_pid, native.pid);
  const state = await f.store.transaction(state => structuredClone(state), { readOnly: true });
  assert.equal(state.records[0].operations.send, 'accepted'); assert.deepEqual(state.slots, []);
});
test('all mutating handler families reject a stopped source before core, vendor auth, remote or automatic naming effects', posix, async t => {
  const f = await fixture(t); await f.service.stop({ schema: 'aiterm.cascade-stop-request.v1', roots: [A] });
  for (const [name, args] of [
    ['pty_open', { name: 'bot-new' }], ['pty_send', { session_id: B.session_id, text: 'synthetic' }],
    ['pty_key', { session_id: B.session_id, key: 'C-c' }], ['pty_close', { session_id: B.session_id }],
    ['agent_launch', { harness: 'codex-cli', session_name: B.session_id }],
    ...['claude_agent', 'codex_agent', 'grok_agent'].map(name => [name, { session_name: B.session_id }]),
    ['agent_configure', { session_id: B.session_id, fast: false }],
    ['agent_auth', { action: 'status', session_id: B.session_id }],
    ['agent_approval', { action: 'respond', session_id: B.session_id }],
    ['claude_approval', { action: 'respond', session_id: B.session_id }],
    ['claude_turn', { action: 'issue', session_id: B.session_id }],
    ['agent_launch', {}], ['agent_auth', { action: 'start' }],
    ['pty_key', { session_id: B.session_id, key: 'C-c', remote: { host: 'synthetic.invalid' } }],
  ]) {
    const result = await f.client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, name); assert.equal(result._meta[ERROR].effect, 'not_started', name);
  }
  assert.deepEqual(f.effects, []); assert.ok(f.live.has(B.session_id));
  const observed = await f.client.callTool({ name: 'pty_list', arguments: {} });
  assert.equal(observed.isError, undefined); assert.equal(observed.structuredContent.sessions.length, 1);
});
test('the SDK request keeps its original source through an asynchronous preflight and stops without waiting for that preparation', async t => {
  const f = await fixture(t), held = f.holdTarget();
  const call = f.client.callTool({ name: 'pty_key', arguments: { session_id: B.session_id, key: 'C-c' } });
  await held.entered.promise;
  const stopped = await f.service.stop({ schema: 'aiterm.cascade-stop-request.v1', roots: [A] });
  assert.equal(stopped.targets[0].outcome, 'closed'); held.release.resolve();
  const result = await call;
  assert.equal(result.isError, true); assert.equal(result._meta[ERROR].effect, 'not_started');
  assert.deepEqual(f.effects, []); assert.ok(f.live.has(B.session_id));
});
test('the actual close handler shares admission and binds only the confirmed closed generation', posix, async t => {
  const f = await fixture(t), result = await f.client.callTool({ name: 'pty_close', arguments: { session_id: B.session_id } });
  assert.equal(result.isError, undefined); assert.deepEqual(f.effects, ['kill-session']);
  assert.deepEqual(result._meta[BINDING].target.launch, B); assert.equal(f.live.has(B.session_id), false);
  const state = await f.store.transaction(state => structuredClone(state), { readOnly: true });
  assert.equal(state.records[0].relation.completion, 'interrupted'); assert.equal(state.records[0].relation.target_fence, 'closed');
});
test('the initialized native parent uses the injected real manager and receives the frozen request source without legacy verification', async t => {
  const captures = [], thread = '00000000-0000-4000-8000-000000000001';
  const f = await fixture(t, undefined, { clientName: 'codex-mcp-client', parentExecution: {
    ...parent, captureEndpointEvidence(endpoint) {
      captures.push({ endpoint: structuredClone(endpoint), context: currentExecutionIngress() });
      throw new ExecutionError('EXECUTION_UNSUPPORTED'); // no native alias/finish proof is invented
    },
  } });
  assert.equal(f.parentProbes(), 1, 'one guarded local manager, no legacy remote manager');
  const result = await f.client.callTool({ name: 'agent_launch', arguments: {
    harness: 'codex-cli', session_name: B.session_id, prompt: 'synthetic', threadId: 'model-cannot-select-native-source',
  }, _meta: { threadId: thread } });
  assert.equal(result.isError, true); assert.equal(result._meta[ERROR].effect, 'not_started');
  assert.equal(captures.length, 1); assert.equal(captures[0].endpoint.thread_id, thread);
  assert.equal(captures[0].context.request.kind, 'mcp'); assert.equal(captures[0].context.request.tool, 'agent_launch');
  assert.deepEqual(captures[0].context.ingress.source.launch, A);
  assert.equal(captures[0].context.ingress.metadata.threadId, thread);
  assert.deepEqual(f.effects, []);
});
