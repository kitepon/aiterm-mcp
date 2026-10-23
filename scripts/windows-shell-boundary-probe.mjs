// A bounded 2x2x2 synthetic fixture, no real agent CLI and no payload replay.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
assert.equal(process.platform, 'win32');
const script = process.argv[1];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
if (process.argv[2] === '--child') {
  const [registry, temperature, readiness] = process.argv.slice(3);
  if (registry === 'isolated') {
    process.env.PSMUX_DATA_DIR = path.join(process.env.TEMP, 'psmux-registry');
    fs.mkdirSync(process.env.PSMUX_DATA_DIR, { recursive: true });
  }
  const load = file => import(pathToFileURL(path.join(process.cwd(), 'dist', file)));
  const core = await load('core.js'), runtime = await load('tmux-runtime.js');
  const directory = process.env.PSMUX_DATA_DIR || path.join(process.env.USERPROFILE || os.homedir(), '.psmux');
  const name = 'shell_boundary', base = runtime.WIN_NS + '__' + name;
  const started = performance.now();
  const row = { registry, temperature, readiness, sends: 0, observations: [] };
  let opened = false, identity = null, unsafeCleanup = false;
  function anchor(target = base) {
    try { return fs.readFileSync(path.join(directory, target + '.pid'), 'utf8').trim(); } catch { return null; }
  }
  function frame(phase) {
    const current = anchor(), pid = Number(current?.split(':')[0]);
    let alive = null;
    if (Number.isSafeInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); alive = true; } catch (error) { if (error.code === 'ESRCH') alive = false; }
    }
    const state = { phase, ms: Math.round(performance.now() - started), anchor: current, alive,
      port: fs.existsSync(path.join(directory, base + '.port')), key: fs.existsSync(path.join(directory, base + '.key')) };
    row.observations.push(state);
    return state;
  }
  function warmCount() {
    try { return fs.readdirSync(directory).filter(file => file.startsWith(runtime.WIN_NS + '__') && file.includes('__warm__') && file.endsWith('.port')).length; }
    catch { return 0; }
  }
  const stripped = text => text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  try {
    if (temperature === 'warm') {
      core.openSession('boundary_seed', 'bash');
      core.closeSession('boundary_seed');
      const deadline = performance.now() + 5000;
      while (warmCount() === 0 && performance.now() < deadline) await pause(50);
    }
    row.warmBeforeOpen = warmCount();
    core.openSession(name, 'bash'); opened = true;
    identity = frame('open_returned').anchor;
    if (!identity) throw Error('native_identity_unconfirmed_before_input');
    const log = path.join(runtime.SOCKDIR, name + '.log');
    let initial = '';
    try { initial = fs.readFileSync(log, 'utf8'); } catch {}
    row.initialLogHasPrompt = /\$\s*$/.test(stripped(initial));
    if (readiness === 'wait') {
      const deadline = performance.now() + 5000;
      for (;;) {
        const pane = runtime.tmuxCommand(false, 'capture-pane', '-p', '-t', name);
        if (pane.code === 0 && /\$\s*$/.test(stripped(pane.stdout))) { row.promptObserved = true; break; }
        if (performance.now() >= deadline) throw Error('fixture_prompt_unconfirmed');
        await pause(50);
      }
    }
    if (frame('before_input').anchor !== identity) throw Error('native_identity_changed_before_input');
    const marker = path.join(process.env.TEMP, 'shell-executed.txt').replaceAll('\\', '/').replaceAll("'", "'\\''");
    const command = `printf executed > '${marker}'; printf '%s%s\\n' SHELL_BOUNDARY_ EXECUTED`;
    row.sends++;
    core.send(name, command, { raw: true, force: true });
    frame('send_returned');
    const out = await core.readOutput(name, { wait: true, timeout: 5, raw: true, until: 'SHELL_BOUNDARY_EXECUTED' });
    row.outputMarker = out.includes('SHELL_BOUNDARY_EXECUTED');
    row.fileMarker = fs.existsSync(marker);
    frame('read_returned');
  } catch (error) {
    row.error = /ECONNREFUSED|ETIMEDOUT|no server running|native_identity_\w+|fixture_prompt_unconfirmed/.exec(error.message)?.[0] || error.name;
    frame('error');
  } finally {
    if (opened && identity && anchor() === identity) {
      try { core.closeSession(name); row.closed = true; } catch { row.cleanupUnknown = true; unsafeCleanup = true; }
    } else if (opened) { row.cleanupUnknown = true; unsafeCleanup = true; }
    if (!unsafeCleanup) { try { core.killAll(); } catch { row.cleanupUnknown = true; } }
  }
  console.log('SHELL_BOUNDARY_CASE=' + JSON.stringify(row));
} else {
  const rows = [];
  for (const registry of ['shared', 'isolated']) {
    const cases = [];
    for (const temperature of ['cold', 'warm']) for (const readiness of ['immediate', 'wait']) {
      cases.push(new Promise(resolve => {
        const child = spawn(process.execPath, ['--import', './test/seat-env.mjs', script, '--child', registry, temperature, readiness], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        child.stdout.on('data', bytes => { stdout += bytes; });
        child.stderr.on('data', bytes => { stderr += bytes; });
        child.on('error', error => resolve({ registry, temperature, readiness, fixtureError: error.code }));
        child.on('close', code => {
          const line = stdout.split(/\r?\n/).find(text => text.startsWith('SHELL_BOUNDARY_CASE='));
          resolve(line ? { ...JSON.parse(line.slice('SHELL_BOUNDARY_CASE='.length)), exitCode: code }
            : { registry, temperature, readiness, exitCode: code, fixtureError: 'missing_case_record', stderrPresent: !!stderr });
        });
      }));
    }
    rows.push(...await Promise.all(cases));
  }
  console.log('SHELL_BOUNDARY_RESULT=' + JSON.stringify({ schema: 'aiterm.windows-shell-boundary-probe.v1', cases: rows }));
}
