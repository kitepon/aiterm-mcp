import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { guardTmuxExecution, withExecutionEffectScope, beforeExecutionEffect,
  bindExecutionNativeTarget, requireExecutionEffectScope } from '../dist/execution-effect.js';
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
