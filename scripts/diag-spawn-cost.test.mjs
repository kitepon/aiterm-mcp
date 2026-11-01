import '../test/seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { category, targetTest } from './diag-spawn-cost.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const preload = new URL('./diag-spawn-cost.mjs', import.meta.url).href;
const encoded = text => ['-EncodedCommand', Buffer.from(text, 'utf16le').toString('base64')];

test('only an existing test in this repository is eligible, including an inherited child context', () => {
  assert.equal(targetTest('child-v8', import.meta.filename, root), true);
  assert.equal(targetTest('', import.meta.filename, root), false);
  assert.equal(targetTest('child-v8', fileURLToPath(new URL('./run-seat-tests.mjs', import.meta.url)), root), false);
  assert.equal(targetTest('child-v8', path.join(root, 'test/missing.test.mjs'), root), false);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-outside-'));
  try {
    const file = path.join(outside, 'outside.test.mjs'); fs.writeFileSync(file, '');
    assert.equal(targetTest('child-v8', file, root), false);
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
});

test('classification emits fixed operation names rather than command or payload text', () => {
  assert.equal(category('C:\\Program Files\\PowerShell\\7\\pwsh.exe', encoded('@(Get-CimInstance Win32_Process)')), 'native_process_table');
  assert.equal(category('pwsh', encoded('[Diagnostics.Process]::GetProcessById(42); Get-CimInstance Win32_Process')), 'process_identity');
  assert.equal(category('pwsh', ['-Command', 'PRIVATE_ARG']), 'powershell_other');
  assert.equal(category('psmux.exe', ['-L', 'PRIVATE_NAMESPACE', 'capture-pane']), 'terminal_capture-pane');
  assert.equal(category('node', ['C:\\private\\psmux-send-worker.js']), 'payload_worker');
  assert.equal(category('PRIVATE_PROGRAM', { env: 'PRIVATE_ENV' }), 'other');
});

test('an inherited ordinary Node child retains its environment and writes no profile', () => {
  const result = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify({pid:process.pid,home:process.env.HOME,state:process.env.XDG_RUNTIME_DIR,sentinel:process.env.AITERM_TEST_PROFILE_SENTINEL}))'], {
    encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: `--import=${preload}`, NODE_TEST_CONTEXT: 'child-v8', AITERM_TEST_PROFILE_SENTINEL: 'SENTINEL' },
  });
  assert.equal(result.status, 0, result.stderr);
  const child = JSON.parse(result.stdout);
  assert.equal(child.home, process.env.HOME); assert.equal(child.state, process.env.XDG_RUNTIME_DIR); assert.equal(child.sentinel, 'SENTINEL');
  assert.equal(fs.existsSync(path.join(root, 'test-failure-snapshots', `spawn-cost-${child.pid}.json`)), false);
});

test('a real test entry records scalar costs while preserving child output and exit status', () => {
  const probe = path.join(root, 'test', `profile-probe-${process.pid}.test.mjs`);
  let report, canary;
  try {
    fs.writeFileSync(probe, `import './seat-env.mjs';\nimport fs from 'node:fs';\nimport {spawnSync} from 'node:child_process';\nfs.mkdirSync(${JSON.stringify(path.join(root, 'test-failure-snapshots'))},{recursive:true});\nfs.writeFileSync(${JSON.stringify(path.join(root, 'test-failure-snapshots'))}+'/spawn-cost-'+process.pid+'.json','PRIOR_GENERATION');\nconst result=spawnSync(process.execPath,['-e','process.stdout.write("PRIVATE_PAYLOAD");process.exit(7)'],{encoding:'utf8'});\nconsole.log(JSON.stringify({pid:process.pid,status:result.status,output:result.stdout}));\n`);
    const result = spawnSync(process.execPath, ['--import', preload, probe], { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8' } });
    assert.equal(result.status, 0, result.stderr);
    const child = JSON.parse(result.stdout); assert.equal(child.status, 7); assert.equal(child.output, 'PRIVATE_PAYLOAD');
    canary = path.join(root, 'test-failure-snapshots', `spawn-cost-${child.pid}.json`);
    assert.equal(fs.readFileSync(canary, 'utf8'), 'PRIOR_GENERATION', 'PID reuse never overwrites prior process evidence');
    const names = fs.readdirSync(path.dirname(canary)).filter(name => name.startsWith(`spawn-cost-${child.pid}-`) && name.endsWith('.json'));
    assert.equal(names.length, 1);
    report = path.join(path.dirname(canary), names[0]);
    const raw = fs.readFileSync(report, 'utf8'), data = JSON.parse(raw);
    assert.equal(data.schema, 'aiterm.diagnostic-spawn-cost.v1');
    assert.ok(data.operations.other.count >= 1); assert.ok(data.operations.other.max_ms > 0);
    assert.doesNotMatch(raw, /PRIVATE_PAYLOAD|PRIVATE_ENV|SENTINEL/);
  } finally { fs.rmSync(probe, { force: true }); if (report) fs.rmSync(report, { force: true }); if (canary) fs.rmSync(canary, { force: true }); }
});
