import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { psmuxBin } from '../dist/tmux-runtime.js';

const windows = process.platform === 'win32';
const hasBackend = windows && spawnSync(psmuxBin(), ['-V']).status === 0;

test('Windows: POSIX試験の全件除外後も別namespaceのnative sessionを止めない', {
  skip: hasBackend ? false : 'Windows native psmux専用',
}, async () => {
  const core = await import('../dist/core.js');
  const runtime = await import('../dist/tmux-runtime.js');
  const alias = fs.mkdtempSync(path.join(os.tmpdir(), 'psmux-cleanup-alias-'));
  const binary = psmuxBin();
  const executable = path.isAbsolute(binary) ? binary : spawnSync('where.exe', [binary], { encoding: 'utf8' }).stdout?.trim().split(/\r?\n/)[0];
  assert.ok(executable && fs.existsSync(executable), 'fixture用psmux実体を特定できる');
  // Ensure the old unguarded cleanup would reach the native alias even if the
  // installed package did not put tmux.exe on PATH.
  fs.copyFileSync(executable, path.join(alias, 'tmux.exe'));
  const env = { ...process.env };
  // A new runner must not inherit the enclosing file worker's internal mode:
  // Node otherwise skips --test and exits successfully without a report.
  delete env.NODE_TEST_CONTEXT;
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = alias + path.delimiter + process.env.PATH;
  const name = 'cleanup_scope_canary';
  let pid = null;
  const identity = () => runtime.tmuxCommand(false, 'display-message', '-p', '-t', name, '#{pid}');
  try {
    core.openSession(name, 'bash');
    const before = identity();
    assert.equal(before.code, 0, before.stderr);
    assert.match(before.stdout.trim(), /^[1-9]\d*$/);
    pid = before.stdout.trim();
    const child = spawnSync(process.execPath, [
      '--import', './test/seat-env.mjs', '--test', '--test-reporter=tap',
      'test/execution-launch-create-contention.test.mjs',
    ], { cwd: fileURLToPath(new URL('..', import.meta.url)), env, encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.match(child.stdout, /# skipped [1-9]\d*/);
    const after = identity();
    assert.equal(after.code, 0, '全件除外の後片付けが別namespaceを停止しない: ' + after.stderr);
    assert.equal(after.stdout.trim(), pid, '元のnative serverを保持する');
  } finally {
    const current = pid ? identity() : null;
    if (current?.code === 0 && current.stdout.trim() === pid) core.closeSession(name);
    core.killAll(); // This fixture's namespace only; never the unscoped alias.
    fs.rmSync(alias, { recursive: true, force: true });
  }
});
