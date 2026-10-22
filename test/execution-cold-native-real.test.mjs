import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as core from '../dist/core.js';
import { withExecutionEffectScope, executionCreatedNativeBinding } from '../dist/execution-effect.js';

const skip = process.platform === 'win32' ? 'POSIX native serverの試験' :
  spawnSync('tmux', ['-V']).status !== 0 ? 'tmux 未インストール' : false;

test('実tmuxの初回native作成は補助sessionなしで実receiptからserverを証明する', { skip }, () => {
  const name = `cold_native_${process.pid}`;
  const empty = { state: 'known', sessions: [], server: null };
  assert.deepEqual(core.observeExecutionNativeCreationScope(), empty);
  let opened = false, issued = 0, binding;
  try {
    withExecutionEffectScope(name, () => { issued++; }, () => {
      const [session] = core.openSession(name, 'bash');
      assert.equal(session, name);
      opened = true;
      binding = executionCreatedNativeBinding(name);
    }, {
      prepare() { assert.deepEqual(core.observeExecutionNativeCreationScope(), empty); return null; },
      verifyServer() { assert.deepEqual(core.observeExecutionNativeCreationScope(), empty); },
      native(session, nativeId, pid) {
        const state = core.observeExecutionNativeCreationScope();
        assert.equal(state.state, 'known');
        assert.deepEqual(state.sessions, [{ session_id: session, native_id: nativeId }]);
        assert.equal(state.server.pid, pid);
        return state.server;
      },
      launch() {},
    });
    assert.ok(issued >= 1);
    assert.equal(binding.schema, 'aiterm.execution-native.v1');
    assert.equal(binding.server.pid > 0, true);
  } finally {
    if (opened) core.closeSession(name);
  }
  assert.deepEqual(core.observeExecutionNativeCreationScope(), empty);
});
