// One owned canary, one execution of the existing all-skipped POSIX fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
assert.equal(process.platform, 'win32');
const core = await import(pathToFileURL(path.join(process.cwd(), 'dist/core.js')));
const runtime = await import(pathToFileURL(path.join(process.cwd(), 'dist/tmux-runtime.js')));
const directory = process.env.PSMUX_DATA_DIR || path.join(process.env.USERPROFILE || os.homedir(), '.psmux');
const name = 'skipped_cleanup_canary', base = runtime.WIN_NS + '__' + name;
const row = { schema: 'aiterm.windows-skipped-cleanup-probe.v1', canaryNamespace: runtime.WIN_NS };
let identity = null;
function frame() {
  let anchor = null;
  try { anchor = fs.readFileSync(path.join(directory, base + '.pid'), 'utf8').trim(); } catch {}
  const pid = Number(identity?.split(':')[0]);
  let originalPidExists = null;
  if (Number.isSafeInteger(pid) && pid > 0) {
    try { process.kill(pid, 0); originalPidExists = true; } catch (error) { if (error.code === 'ESRCH') originalPidExists = false; }
  }
  return { anchor, originalPidExists, port: fs.existsSync(path.join(directory, base + '.port')) };
}
try {
  core.openSession(name, 'bash');
  identity = frame().anchor;
  assert.ok(identity);
  core.send(name, "printf '%s%s\\n' CANARY_ READY", { raw: true, force: true });
  row.ready = (await core.readOutput(name, { wait: true, timeout: 5, raw: true, until: 'CANARY_READY' })).includes('CANARY_READY');
  assert.equal(row.ready, true);
  row.before = frame();
  const child = spawnSync(process.execPath, ['--import', './test/seat-env.mjs', '--import', './diagnostic-harness/scripts/windows-cleanup-alias-trace.mjs', '--test', 'test/execution-launch-create-contention.test.mjs'], { encoding: 'utf8', timeout: 60000 });
  row.childCode = child.status;
  row.childErrorCode = child.error?.code ?? null;
  row.childSummary = child.stdout.split(/\r?\n/).filter(line => /^# (tests|pass|fail|skipped) /.test(line));
  row.cleanupCalls = child.stdout.split(/\r?\n/).filter(line => line.includes('CLEANUP_ALIAS_CALL=')).map(line => JSON.parse(line.split('CLEANUP_ALIAS_CALL=')[1]));
  row.after = frame();
} finally {
  // Do not repeat the foreign cleanup or touch a replacement generation.
  if (identity && frame().anchor === identity && frame().originalPidExists === true) {
    try { core.closeSession(name); row.scopedClose = true; } catch { row.cleanupUnknown = true; }
  }
  // Any remaining warm process belongs solely to this ephemeral CI job.
  console.log('SKIPPED_CLEANUP_PROBE_RESULT=' + JSON.stringify(row));
}
