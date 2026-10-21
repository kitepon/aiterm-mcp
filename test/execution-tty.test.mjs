// Historical destructive close/admission fixtures use closeCascade explicitly.
// These are not acceptance evidence for the session-preserving stop control.
import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionDispatcher } from '../dist/execution-dispatch.js';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
import { ExecutionService } from '../dist/execution-service.js';
import { FileExecutionStore } from '../dist/execution-store.js';
import { withExecutionEffectScope, requireExecutionEffectScope } from '../dist/execution-effect.js';
import { ExecutionError, EXECUTION_ERROR_META_KEY as ERROR } from '../dist/execution-wire.js';

// Intercept every child process before importing actual core. An unexpected
// command is an assertion, never a fallback to a host binary, PTY or harness.
const original = childProcess.spawnSync;
let current;
childProcess.spawnSync = (...args) => {
  assert.ok(current, 'all process calls must belong to a synthetic fixture');
  return current(...args);
};
syncBuiltinESMExports();
const core = await import('../dist/core.js');
test.after(() => { childProcess.spawnSync = original; syncBuiltinESMExports(); });
test.afterEach(() => { current = null; requireExecutionEffectScope(false); });
function fixture({ switched = false, foregroundTool = false } = {}) {
  let reads = 0, writes = 0;
  const ok = stdout => ({ status: 0, stdout, stderr: '' });
  current = (bin, args) => {
    if (bin === 'tmux' && args.length === 1 && args[0] === '-V') return ok('tmux synthetic');
    if (bin === 'tmux' && args.includes('display-message') && args.at(-1) === '#{pane_tty}') {
      assert.equal(args[args.indexOf('-t') + 1], '=bot-a:', 'device lookup must not prefix-match a different seat');
      reads++; return ok(switched && reads > 1 ? '/dev/synthetic-replacement\n' : '/dev/synthetic-original\n');
    }
    if (bin === '/bin/ps') return ok(foregroundTool ? 'S+ bash -lc synthetic-task\nS codex\n' : 'S+ codex\n');
    if (bin === '/bin/stty' && args.at(-1) === '-a') return ok('icanon echo');
    if (bin === '/bin/stty' && args.at(-1) === '-echo' && args.at(-2) === 'raw') {
      writes++; return ok('');
    }
    assert.fail('unexpected synthetic process command');
  };
  return { reads: () => reads, writes: () => writes };
}
const posix = { skip: process.platform === 'win32' ? 'POSIX tty recovery only' : false };
test('actual core cannot change termios outside the required execution admission', posix, async () => {
  const f = fixture(); requireExecutionEffectScope(true);
  await assert.rejects(core.ensureAgentOwnsPaneInput('bot-a', 'codex'), error => error.code === 'EXECUTION_UNSUPPORTED');
  assert.equal(f.writes(), 0);
});
test('actual termios recovery crosses admission after read-only checks and before the only raw write', posix, async () => {
  const f = fixture(); let issued = 0;
  assert.deepEqual(await withExecutionEffectScope('bot-a', () => {
    assert.equal(f.writes(), 0); issued++;
  }, () => core.ensureAgentOwnsPaneInput('bot-a', 'codex')), ['stty_raw']);
  assert.equal(issued, 1); assert.equal(f.writes(), 1);
});
test('a stop or launch replacement observed by the shared issue callback prevents termios mutation', posix, async () => {
  for (const code of ['EXECUTION_STOPPING', 'EXECUTION_STALE_GENERATION']) {
    const f = fixture();
    await assert.rejects(withExecutionEffectScope('bot-a', () => { throw new ExecutionError(code); },
      () => core.ensureAgentOwnsPaneInput('bot-a', 'codex')), error => error.code === code && error.effect === 'not_started');
    assert.equal(f.writes(), 0);
  }
});
test('a changed pane tty cannot redirect the captured raw-mode operation to an old device', posix, async () => {
  const f = fixture({ switched: true }); let issued = 0;
  await assert.rejects(withExecutionEffectScope('bot-a', () => { issued++; },
    () => core.ensureAgentOwnsPaneInput('bot-a', 'codex')), error => error.code === 'EXECUTION_STALE_GENERATION');
  assert.equal(issued, 0); assert.equal(f.writes(), 0);
});
test('read-only foreground-tool detection performs no termios change or issue', posix, async () => {
  const f = fixture({ foregroundTool: true }); let issued = 0;
  assert.deepEqual(await withExecutionEffectScope('bot-a', () => { issued++; },
    () => core.ensureAgentOwnsPaneInput('bot-a', 'codex')), []);
  assert.equal(issued, 0); assert.equal(f.writes(), 0);
});
test('a different request target cannot borrow tty recovery, and unmounted legacy recovery remains available', posix, async () => {
  let f = fixture();
  await assert.rejects(withExecutionEffectScope('bot-other', () => assert.fail('must not issue'),
    () => core.ensureAgentOwnsPaneInput('bot-a', 'codex')), error => error.code === 'EXECUTION_CONFLICT');
  assert.equal(f.writes(), 0);
  f = fixture();
  assert.deepEqual(await core.ensureAgentOwnsPaneInput('bot-a', 'codex'), ['stty_raw']);
  assert.equal(f.writes(), 1);
});
test('actual dispatcher, service and core share the durable tty admission and cancel preparing recovery without touching the target', posix, async t => {
  for (const scenario of ['accepted', 'stop', 'replacement']) {
    const f = fixture(), source = { session_id: 'bot-source', launch_id: 'b'.repeat(32) },
      target = { session_id: 'bot-a', launch_id: 'a'.repeat(32) };
    const live = new Map([source, target].map(launch => [launch.session_id, launch]));
    const directory = mkdtempSync(join(tmpdir(), 'tty-admission-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const store = new FileExecutionStore(directory);
    const observe = session_id => ({ schema: 'aiterm.pty-observe-result.v1', session_id,
      exists: live.has(session_id), launch_id: live.get(session_id)?.launch_id ?? null });
    const env = { AITERM_SESSION_ID: source.session_id, AITERM_AGENT_LAUNCH_ID: source.launch_id };
    const runtime = createExecutionRuntime({ sourceEnvironment: env, observeSession: observe, observeSessionSync: observe,
      async observeDone() { assert.fail('tty recovery has no synthetic done evidence'); },
      async guardedClose(expected) { assert.deepEqual(live.get(expected.session_id), expected); live.delete(expected.session_id); } });
    const service = new ExecutionService(store, runtime, 5);
    const dispatcher = createExecutionDispatcher({ service, sourceEnvironment: env,
      nativeIdentity: { pid: 12345, started_identity: 'synthetic-native-process' }, initializedClientName: () => 'codex',
      observeSessionGeneration: observe });
    const result = await dispatcher.dispatch('pty_send', { session_id: target.session_id }, { requestId: 1 }, async () => {
      if (scenario === 'stop') await service.closeCascade({ schema: 'aiterm.cascade-stop-request.v1', roots: [source] });
      if (scenario === 'replacement') live.set(target.session_id, { ...target, launch_id: 'c'.repeat(32) });
      await core.ensureAgentOwnsPaneInput(target.session_id, 'codex');
      return { content: [], structuredContent: { schema: 'aiterm.pty-send-result.v1', mode: 'agent_dispatch',
        session_id: target.session_id, launch_id: target.launch_id, event_cursor: 17 } };
    });
    assert.equal(f.writes(), scenario === 'accepted' ? 1 : 0);
    const state = await store.transaction(state => structuredClone(state), { readOnly: true });
    if (scenario === 'accepted') {
      assert.equal(result.isError, undefined); assert.equal(state.records[0].operations.send, 'accepted');
    } else {
      assert.equal(result.isError, true); assert.equal(result._meta[ERROR].effect, 'not_started');
      assert.equal(state.records[0].operations.send, 'not_sent');
      assert.ok(live.has(target.session_id), 'unissued recovery does not close its independent target');
    }
    assert.deepEqual(state.slots, []);
  }
});
