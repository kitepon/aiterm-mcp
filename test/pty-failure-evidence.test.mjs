import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { capturePtyFailure } from './pty-failure-evidence.mjs';
import { SOCKDIR } from '../dist/tmux-runtime.js';

test('failure evidence preserves the original log without advancing its cursor', async () => {
  const session = 'failure_evidence_fixture';
  fs.mkdirSync(SOCKDIR, { recursive: true });
  const log = path.join(SOCKDIR, session + '.log');
  const offset = path.join(SOCKDIR, session + '.offset');
  fs.writeFileSync(log, 'original raw output\r\n'); fs.writeFileSync(offset, '7');
  const generation = { exists: true, launch_id: null };
  const result = await capturePtyFailure({ observeSessionGeneration: () => generation,
    observeSession: () => ({ pane_process: null }), readOutput: async (_, options) => {
      assert.deepEqual(options, { screen: true, raw: true }); return 'screen';
    } }, session);
  try {
    assert.equal(result.capture_error, null);
    assert.equal(result.same_generation, null, 'ordinary PTY without a launch ID remains unproven');
    assert.equal(fs.readFileSync(path.join(result.directory, 'pane.log'), 'utf8'), 'original raw output\r\n');
    assert.equal(fs.readFileSync(offset, 'utf8'), '7');
    assert.equal(fs.readFileSync(path.join(result.directory, 'screen.txt'), 'utf8'), 'screen');
  } finally { fs.rmSync(result.directory, { recursive: true, force: true }); fs.rmSync(log); fs.rmSync(offset); }
});

test('failure evidence marks a replaced launch as inconsistent', async () => {
  let calls = 0;
  const result = await capturePtyFailure({ observeSessionGeneration: () => ({ exists: true, launch_id: (++calls === 1 ? 'a' : 'b').repeat(32) }),
    observeSession: () => ({ pane_process: null }), readOutput: async () => 'screen' }, 'failure_evidence_replaced');
  try { assert.equal(result.same_generation, false); }
  finally { fs.rmSync(result.directory, { recursive: true, force: true }); }
});

test('failure evidence cannot replace a fixture failure with a diagnostic exception', async () => {
  const result = await capturePtyFailure({ observeSessionGeneration() { throw 'unavailable observation'; } }, 'failure_evidence_missing');
  try { assert.equal(result.capture_error, 'unavailable observation'); }
  finally { fs.rmSync(result.directory, { recursive: true, force: true }); }
});
