import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { guardTmuxExecution, withExecutionEffectScope, beforeExecutionEffect,
  bindExecutionNativeTarget, requireExecutionEffectScope, withExecutionInterruptEffectScope } from '../dist/execution-effect.js';
import { tmuxCommand } from '../dist/tmux-runtime.js';

test('native input, create, close and respawn cross the same request-scoped gate', () => {
  for (const args of [['new-session', '-d', '-s', 'bot-a', 'bash'], ['send-keys', '-t', 'bot-a', 'C-c'],
    ['paste-buffer', '-d', '-t', 'bot-a'], ['kill-session', '-t', 'bot-a'], ['respawn-pane', '-k', '-t', 'bot-a', 'bash']]) {
    let issued = 0;
    const result = withExecutionEffectScope('bot-a', () => { issued++; }, () => guardTmuxExecution(args));
    assert.equal(issued, 1);
    if (args[0] !== 'new-session') assert.equal(result[result.indexOf('-t') + 1], '=bot-a:');
    assert.equal(args.includes('=bot-a:'), false, 'do not mutate the caller argv');
  }
});
test('a command queue validates every target before issuing any native effect', () => {
  let issued = 0;
  assert.throws(() => withExecutionEffectScope('bot-a', () => { issued++; }, () =>
    guardTmuxExecution(['send-keys', '-t', 'bot-a', 'C-c', ';', 'send-keys', '-t', 'bot-other', 'Enter'])), value => value.code === 'EXECUTION_CONFLICT');
  assert.equal(issued, 0);
  const result = withExecutionEffectScope('bot-a', () => { issued++; }, () => guardTmuxExecution([
    'set-option', '-g', 'update-environment', '*', ';', 'new-session', '-s', 'bot-a', 'bash', ';', 'set-option', '-gu', 'update-environment']));
  assert.equal(result.includes('new-session'), true);
  assert.equal(issued, 1);
});
test('exact target rewrite retains a selected window/pane and prevents prefix redirection', () => {
  const result = withExecutionEffectScope('bot-a', () => {}, () => guardTmuxExecution(['send-keys', '-t', 'bot-a:3.2', 'Enter']));
  assert.equal(result[2], '=bot-a:3.2');
});
test('buffer, pipe and environment mutation also require admission and validate their actual target', () => {
  let calls = 0;
  for (const args of [['load-buffer', '-b', 'owned-buffer', '-'], ['delete-buffer', '-b', 'owned-buffer'],
    ['set-environment', '-t', 'bot-a', 'NONSECRET_NAME', 'synthetic'], ['pipe-pane', '-t', 'bot-a', '-o', 'synthetic sink'],
    ['set-option', '-t', '=bot-a:', 'remain-on-exit', 'on']]) {
    withExecutionEffectScope('bot-a', () => { calls++; }, () => guardTmuxExecution(args));
  }
  assert.equal(calls, 5);
  assert.throws(() => withExecutionEffectScope('bot-a', () => { calls++; }, () =>
    guardTmuxExecution(['set-option', '-g', 'destroy-unattached', 'on'])), value => value.code === 'EXECUTION_UNSUPPORTED');
  assert.equal(calls, 5);
});
test('native close IDs require an explicit generation-checked binding', () => {
  let issued = 0;
  assert.throws(() => withExecutionEffectScope('bot-a', () => { issued++; }, () =>
    guardTmuxExecution(['kill-session', '-t', '$7'])), value => value.code === 'EXECUTION_CONFLICT');
  assert.throws(() => withExecutionEffectScope('bot-a', () => { issued++; }, () =>
    bindExecutionNativeTarget('bot-other', '$7')), value => value.code === 'EXECUTION_CONFLICT');
  withExecutionEffectScope('bot-a', () => { issued++; }, () => {
    bindExecutionNativeTarget('bot-a', '$7');
    assert.deepEqual(guardTmuxExecution(['kill-session', '-t', '$7']), ['kill-session', '-t', '$7']);
  });
  assert.equal(issued, 1);
});
test('required admission blocks unscoped input but permits observations; default legacy mode is unchanged', () => {
  const old = ['send-keys', '-t', 'bot-a', 'Enter'];
  assert.equal(guardTmuxExecution(old), old);
  requireExecutionEffectScope(true);
  try {
    assert.throws(() => guardTmuxExecution(old), value => value.code === 'EXECUTION_UNSUPPORTED');
    assert.deepEqual(guardTmuxExecution(['list-sessions', '-F', '#{session_name}']), ['list-sessions', '-F', '#{session_name}']);
    assert.throws(() => guardTmuxExecution(['kill-server']), value => value.code === 'EXECUTION_UNSUPPORTED');
    assert.throws(() => guardTmuxExecution(['unknown-native-command']), value => value.code === 'EXECUTION_UNSUPPORTED');
  } finally { requireExecutionEffectScope(false); }
});
test('actual tmux runtime rejects a mismatched or unscoped mutation before resolving or executing tmux', () => {
  assert.throws(() => withExecutionEffectScope('bot-a', () => { throw new Error('must not issue'); }, () =>
    tmuxCommand(true, 'send-keys', '-t', 'bot-other', 'C-c')), value => value.code === 'EXECUTION_CONFLICT');
  requireExecutionEffectScope(true);
  try {
    assert.throws(() => tmuxCommand(true, 'send-keys', '-t', 'bot-a', 'C-c'), value => value.code === 'EXECUTION_UNSUPPORTED');
  } finally { requireExecutionEffectScope(false); }
});
test('async effect scopes do not mix concurrent requests or direct payload admission', async () => {
  const issued = [];
  await Promise.all(['bot-a', 'bot-b'].map(session => withExecutionEffectScope(session, () => { issued.push(session); }, async () => {
    await Promise.resolve(); beforeExecutionEffect(session);
  })));
  assert.deepEqual(issued.sort(), ['bot-a', 'bot-b']);
});
test('a swallowed native refusal poisons its scope and cannot become a successful receipt or fallback', async () => {
  let issued = 0;
  await assert.rejects(withExecutionEffectScope('bot-a', () => { issued++; }, async () => {
    try { guardTmuxExecution(['send-keys', '-t', 'bot-other', 'C-c']); } catch { /* existing handler catches errors */ }
    assert.throws(() => beforeExecutionEffect('bot-a'), value => value.code === 'EXECUTION_CONFLICT');
    return { isError: false, text: 'fake success' };
  }), value => value.code === 'EXECUTION_CONFLICT' && value.effect === 'not_started');
  assert.equal(issued, 0);
});
test('a refusal after an earlier issued effect stays possible even if the handler catches it', async () => {
  let issued = 0;
  await assert.rejects(withExecutionEffectScope('bot-a', () => { issued++; }, async () => {
    beforeExecutionEffect('bot-a');
    try { beforeExecutionEffect('bot-other'); } catch { /* cannot hide earlier action */ }
    return 'fake success';
  }), value => value.code === 'EXECUTION_CONFLICT' && value.effect === 'possible');
  assert.equal(issued, 1);
});
test('stop-owned native frame allows observations and exactly one captured-native Esc without creating an invocation', () => {
  let admissions = 0;
  const result = withExecutionInterruptEffectScope('bot-a', '$9', () => { admissions++; }, () => {
    assert.deepEqual(guardTmuxExecution(['has-session', '-t', 'bot-a']), ['has-session', '-t', 'bot-a']);
    assert.equal(admissions, 0);
    bindExecutionNativeTarget('bot-a', '$9');
    beforeExecutionEffect('bot-a');
    return guardTmuxExecution(['send-keys', '-t', '$9', 'Escape']);
  });
  assert.equal(admissions, 2); assert.deepEqual(result, ['send-keys', '-t', '$9', 'Escape']);
});
test('stop frame refuses management, payloads, human-name targets, other keys and command queues before dispatch', () => {
  for (const args of [ ['kill-session', '-t', '$9'], ['respawn-pane', '-t', '$9'], ['new-session', '-s', 'bot-a'],
    ['paste-buffer', '-t', '$9'], ['send-keys', '-t', 'bot-a', 'Escape'], ['send-keys', '-t', '$10', 'Escape'],
    ['send-keys', '-t', '$9', 'C-c'], ['send-keys', '-t', '$9', 'hello'], ['send-keys', '-t', '$9', '-l', 'Escape'],
    ['send-keys', '-t', '$9', 'Escape', ';', 'kill-session', '-t', '$9'],
    ['has-session', '-t', 'bot-a', ';', 'send-keys', '-t', '$9', 'Escape'], ['load-buffer', '-'],
    ['set-option', '-g', 'update-environment', '*'] ]) {
    let admissions = 0;
    assert.throws(() => withExecutionInterruptEffectScope('bot-a', '$9', () => { admissions++; }, () => guardTmuxExecution(args)));
    assert.equal(admissions, 0);
  }
});
test('a second Esc and a caught forbidden fallback poison the stop frame after its single accepted command', () => {
  let admissions = 0;
  assert.throws(() => withExecutionInterruptEffectScope('bot-a', '$9', () => { admissions++; }, () => {
    guardTmuxExecution(['send-keys', '-t', '$9', 'Escape']);
    try { guardTmuxExecution(['send-keys', '-t', '$9', 'Escape']); } catch { /* cannot claim success */ }
    return 'false success';
  }), error => error.code === 'EXECUTION_CONFLICT' && error.effect === 'possible');
  assert.equal(admissions, 1);
});
test('stop frame cannot be widened by nested work frames or native target rebinding', () => {
  for (const nested of [() => withExecutionEffectScope('bot-a', () => {}, () => {}),
    () => withExecutionInterruptEffectScope('bot-a', '$9', () => {}, () => {}), () => bindExecutionNativeTarget('bot-a', '$10')]) {
    assert.throws(() => withExecutionInterruptEffectScope('bot-a', '$9', () => {}, nested));
  }
  assert.throws(() => withExecutionEffectScope('bot-a', () => {}, () =>
    withExecutionInterruptEffectScope('bot-a', '$9', () => {}, () => {})));
});
test('async stop admission/body and escaped late callbacks cannot authorize a native key', async () => {
  let late;
  withExecutionInterruptEffectScope('bot-a', '$9', () => {}, () => {
    late = new Promise(resolve => queueMicrotask(() => {
      assert.throws(() => guardTmuxExecution(['send-keys', '-t', '$9', 'Escape']), error => error.effect === 'not_started');
      resolve();
    }));
  });
  await late;
  assert.throws(() => withExecutionInterruptEffectScope('bot-a', '$9', async () => {}, () =>
    guardTmuxExecution(['send-keys', '-t', '$9', 'Escape'])), error => error.effect === 'not_started');
  assert.throws(() => withExecutionInterruptEffectScope('bot-a', '$9', () => {}, async () => {}), error => error.effect === 'not_started');
});
