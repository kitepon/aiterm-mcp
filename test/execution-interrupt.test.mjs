import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionService } from '../dist/execution-service.js';
import { FileExecutionStore } from '../dist/execution-store.js';
import { createExecutionRuntime } from '../dist/execution-runtime.js';
import { cascadeInterruptResultSchema } from '../dist/execution-contract.js';
const saved = { spawnSync: childProcess.spawnSync, spawn: childProcess.spawn }; let runner;
childProcess.spawnSync = (...args) => { assert.ok(runner, 'no native OS fallback'); return runner(...args); };
childProcess.spawn = () => assert.fail('no native child'); syncBuiltinESMExports();
const core = await import('../dist/core.js');
test.after(() => { Object.assign(childProcess, saved); syncBuiltinESMExports(); });
test.afterEach(() => { runner = null; });
const A = { session_id: 'interrupt-a', launch_id: 'a'.repeat(32) }, B = { session_id: 'interrupt-b', launch_id: 'b'.repeat(32) };
const point = launch => ({ launch, boundary: null });
const stop = roots => ({ schema: 'aiterm.cascade-stop-request.v2', mode: 'interrupt', roots });
test('session-preserving stop never invokes an injected former close adapter, changes state, or turns missing interruption proof into success', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'interrupt-')); t.after(() => rmSync(dir, { force: true, recursive: true }));
  let closes = 0, done = 0;
  const store = new FileExecutionStore(dir), runtime = createExecutionRuntime({ sourceEnvironment: {
    AITERM_SESSION_ID: A.session_id, AITERM_AGENT_LAUNCH_ID: A.launch_id },
    observeSession: session_id => ({ schema: 'aiterm.pty-observe-result.v1', session_id, exists: true,
      launch_id: session_id === A.session_id ? A.launch_id : B.launch_id }),
    async observeDone() { done++; throw Error('not an interruption proof'); }, async guardedClose() { closes++; assert.fail('stop must not close'); } });
  const service = new ExecutionService(store, runtime), request = { kind: 'delivery', delivery_id: 'existing-call', target_session_id: B.session_id };
  await service.execute({ action: 'register', source_session_id: A.session_id, reservation: {
    schema: 'aiterm.execution-reservation.v1', request, source: point(A), target: { session_id: B.session_id, expected_launch_id: B.launch_id } } });
  await service.invoke({ schema: 'aiterm.execution-ref.v1', request }, 'send', async () => ({ value: null, target: point(B) }));
  const before = readFileSync(join(dir, 'relations.json'), 'utf8'), result = await service.stop(stop([A]));
  assert.equal(result.status, 'unconfirmed'); assert.deepEqual(result.targets.map(target => target.launch), [A, B]);
  assert.ok(result.targets.every(target => target.key_receipt === 'not_sent' && target.interruption === 'unsupported' && target.session_preserved === 'unconfirmed'));
  assert.equal(result.relation_coverage, 'incomplete'); assert.equal(closes, 0); assert.equal(done, 0);
  assert.equal(readFileSync(join(dir, 'relations.json'), 'utf8'), before);
  await assert.rejects(service.stop({ schema: 'aiterm.cascade-stop-request.v1', roots: [A] })); assert.equal(closes, 0);
});
test('accepted key, idle-looking screen, absent session and legacy closed receipts cannot validate confirmed interruption', () => {
  const base = { schema: 'aiterm.cascade-stop-result.v2', mode: 'interrupt', roots: [A], status: 'unconfirmed',
    relation_coverage: 'incomplete', unresolved: [], targets: [{ launch: A, run: null, key: 'Escape', key_receipt: 'accepted',
      interruption: 'unconfirmed', session_preserved: 'unconfirmed', reason: 'key_not_turn_ack' }] };
  assert.equal(cascadeInterruptResultSchema.safeParse(base).success, true);
  for (const mutation of [value => { value.status = 'confirmed'; }, value => { value.targets[0].interruption = 'closed'; },
    value => { value.targets[0].interruption = 'already_closed'; }, value => { value.targets[0].interruption = 'interrupted'; value.targets[0].session_preserved = 'confirmed'; },
    value => { value.status = 'confirmed'; value.targets = []; value.relation_coverage = 'complete'; }]) {
    const value = structuredClone(base); mutation(value); assert.equal(cascadeInterruptResultSchema.safeParse(value).success, false);
  }
});
test('existing key aliases deliver a single synthetic key and return only transport text, not an interruption or session proof', { skip: process.platform === 'win32' }, () => {
  const keys = []; runner = (bin, args) => {
    assert.equal(bin, 'tmux');
    if (args.length === 1 && args[0] === '-V') return { status: 0, stdout: 'tmux synthetic', stderr: '' };
    const command = args.slice(2);
    if (command[0] === 'has-session') return { status: 0, stdout: '', stderr: '' };
    assert.equal(command[0], 'send-keys'); keys.push(command.at(-1)); return { status: 0, stdout: '', stderr: '' };
  };
  assert.equal(core.sendKey('synthetic-key', 'esc'), 'sent key Escape to synthetic-key');
  assert.equal(core.sendKey('synthetic-key', 'ctrl-c'), 'sent key C-c to synthetic-key'); assert.deepEqual(keys, ['Escape', 'C-c']);
});
test('a failed native key command is not reported sent and never escalates to retry/close/kill', { skip: process.platform === 'win32' }, () => {
  const commands = []; runner = (bin, args) => {
    assert.equal(bin, 'tmux'); if (args.length === 1 && args[0] === '-V') return { status: 0, stdout: 'tmux synthetic', stderr: '' };
    const command = args.slice(2); commands.push(command[0]);
    if (command[0] === 'has-session') return { status: 0, stdout: '', stderr: '' };
    assert.equal(command[0], 'send-keys'); return { status: 1, stdout: '', stderr: 'synthetic failure' };
  };
  assert.throws(() => core.sendKey('synthetic-key', 'Escape'), /制御キー送信を確認できません/);
  assert.equal(commands.filter(name => name === 'send-keys').length, 1); assert.equal(commands.some(name => /kill|close/.test(name)), false);
});
