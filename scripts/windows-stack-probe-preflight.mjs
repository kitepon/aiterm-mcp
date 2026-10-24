// Validate the actual observer on one owned, input-free fixture before paying
// for the full reproducing context. This is instrumentation preflight only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const core = await import(pathToFileURL(path.join(process.cwd(), 'dist/core.js')));
const runtime = await import(pathToFileURL(path.join(process.cwd(), 'dist/tmux-runtime.js')));
const [sid] = core.openSession('stack_probe_preflight', 'bash');
try {
  const pane = runtime.tmuxCommand(false, 'display-message', '-p', '-t', sid, '#{pane_pid}');
  assert.equal(pane.code, 0);
  const registry = process.env.PSMUX_DATA_DIR || path.join(process.env.USERPROFILE || os.homedir(), '.psmux');
  const [server, creation] = fs.readFileSync(path.join(registry, runtime.WIN_NS + '__' + sid + '.pid'), 'utf8').trim().split(':');
  const result = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
    path.join(process.cwd(), 'diagnostic-harness/scripts/windows-console-input-observe.ps1'),
    '-PaneProcessId', pane.stdout.trim(), '-ServerProcessId', server, '-ServerCreation', creation],
    { encoding: 'utf8', timeout: 20000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const observed = JSON.parse(result.stdout.trim());
  console.log('STACK_PROBE_PREFLIGHT=' + JSON.stringify(observed));
  assert.equal(observed.error_type, undefined);
  assert.equal(observed.identity_matches, true);
  assert.equal(observed.target_creation_unchanged, true);
  assert.equal(observed.server_creation_unchanged, true);
  assert.equal(observed.debugger_available, true);
  const shells = observed.processes.filter(row => row.name === 'bash');
  assert.ok(shells.length > 0);
  for (const shell of shells) {
    assert.equal(shell.debugger_error, undefined);
    assert.equal(shell.debugger_timeout, undefined);
    assert.equal(shell.debugger_exit, 0);
    assert.match(shell.stack, /ntdll|KERNELBASE/i);
  }
} finally {
  core.closeSession(sid);
}
