import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeExpectedExecution, parseExecutionNativeSessions } from '../dist/execution-close.js';
import { ExecutionError } from '../dist/execution-wire.js';
const A = { session_id: 'bot-a', launch_id: 'a'.repeat(32) };
const replacement = { ...A, launch_id: 'b'.repeat(32) };
const known = sessions => ({ state: 'known', sessions });
const native = (native_id = '$7') => ({ session_id: A.session_id, native_id });
const error = (code, effect) => value => value instanceof ExecutionError && value.code === code && value.effect === effect;
function fixture() {
  let live = [native()];
  const effects = [];
  const bindings = { sessions: () => known(live), launch: () => A,
    kill: id => { effects.push(id); live = live.filter(value => value.native_id !== id); return { code: 0 }; } };
  return { bindings, effects, replace: () => { live = [native('$8')]; } };
}
test('native identity parser rejects missing, malformed and duplicate identities without a name fallback', () => {
  assert.deepEqual(parseExecutionNativeSessions('$7\tbot-a\n'), known([native()]));
  for (const text of ['bot-a', '7\tbot-a', '$7\tbot-a\textra', '$7\tbot-a\n$8\tbot-a', '$7\tbot-a\n$7\tbot-b'])
    assert.deepEqual(parseExecutionNativeSessions(text), { state: 'unknown' });
});
test('expected close addresses the captured native session exactly once', () => {
  const f = fixture();
  assert.equal(closeExpectedExecution(A, f.bindings), 'closed');
  assert.deepEqual(f.effects, ['$7']);
});
test('unknown runtime or missing metadata rejects before the effect', () => {
  for (const overrides of [{ sessions: () => ({ state: 'unknown' }) }, { launch: () => null }]) {
    const f = fixture();
    assert.throws(() => closeExpectedExecution(A, { ...f.bindings, ...overrides }), error('EXECUTION_UNCONFIRMED', 'not_started'));
    assert.deepEqual(f.effects, []);
  }
});
test('a replacement launch is refused before kill even if the session name is unchanged', () => {
  const f = fixture();
  assert.throws(() => closeExpectedExecution(A, { ...f.bindings, launch: () => replacement }), error('EXECUTION_STALE_GENERATION', 'not_started'));
  assert.deepEqual(f.effects, []);
});
test('native identity replacement while collecting generation never kills the replacement', () => {
  const f = fixture(); let reads = 0;
  assert.throws(() => closeExpectedExecution(A, { ...f.bindings, sessions: () => known([native(++reads === 1 ? '$7' : '$8')]) }),
    error('EXECUTION_STALE_GENERATION', 'not_started'));
  assert.deepEqual(f.effects, []);
});
test('a late same-name replacement does not redirect the native kill or cause cleanup by name', () => {
  const f = fixture(); const kill = f.bindings.kill;
  assert.equal(closeExpectedExecution(A, { ...f.bindings, kill: id => { f.replace(); return kill(id); } }), 'closed');
  assert.deepEqual(f.effects, ['$7']);
  assert.deepEqual(f.bindings.sessions().sessions, [native('$8')]);
});
test('kill rejection/nonzero or missing post-evidence remains possible and is never retried', () => {
  for (const kill of [() => ({ code: 1 }), () => { throw new Error('lost response'); }, () => ({ code: 0 })]) {
    const f = fixture(); let calls = 0;
    assert.throws(() => closeExpectedExecution(A, { ...f.bindings, kill: () => { calls++; return kill(); } }), error('EXECUTION_UNCONFIRMED', 'possible'));
    assert.equal(calls, 1);
  }
});
test('confirmed absence is already closed and has no native effect', () => {
  const f = fixture();
  assert.equal(closeExpectedExecution(A, { ...f.bindings, sessions: () => known([]) }), 'already_closed');
  assert.deepEqual(f.effects, []);
});
