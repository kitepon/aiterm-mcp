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
if (process.argv[2] === '--sampler') {
  const [pidFile, previousPid, destination] = process.argv.slice(3);
  let previous = '';
  function sample() {
    let anchor = null, pidExists = null;
    try { anchor = fs.readFileSync(pidFile, 'utf8').trim(); } catch {}
    try { process.kill(Number(previousPid), 0); pidExists = true; } catch (error) { if (error.code === 'ESRCH') pidExists = false; }
    const point = { anchor, previousPidExists: pidExists, port: fs.existsSync(pidFile.slice(0, -4) + '.port') };
    const signature = JSON.stringify(point);
    if (signature !== previous) {
      previous = signature;
      fs.appendFileSync(destination, JSON.stringify({ at: Date.now(), ...point }) + '\n');
    }
  }
  sample();
  const timer = setInterval(sample, 10);
  process.on('message', message => {
    if (message === 'stop') { sample(); clearInterval(timer); process.disconnect(); }
  });
  process.send('ready');
} else if (process.argv[2] === '--child') {
  const [registry, temperature, readiness] = process.argv.slice(3);
  if (registry === 'isolated') {
    process.env.PSMUX_DATA_DIR = path.join(process.env.TEMP, 'psmux-registry');
    fs.mkdirSync(process.env.PSMUX_DATA_DIR, { recursive: true });
  }
  const load = file => import(pathToFileURL(path.join(process.cwd(), 'dist', file)));
  const core = await load('core.js'), runtime = await load('tmux-runtime.js');
  const resolver = await load('agent-resolver.js');
  const directory = process.env.PSMUX_DATA_DIR || path.join(process.env.USERPROFILE || os.homedir(), '.psmux');
  const name = 'shell_boundary', base = runtime.WIN_NS + '__' + name;
  const started = performance.now();
  const row = { registry, temperature, readiness, sends: 0, startTimestamp: Date.now(), observations: [] };
  let opened = false, identity = null, unsafeCleanup = false;
  let sampler = null;
  let profileGate = null;
  const samples = path.join(process.env.TEMP, 'reuse-observations.jsonl');
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
  async function waitPrompt() {
    const deadline = performance.now() + 5000;
    for (;;) {
      const pane = runtime.tmuxCommand(false, 'capture-pane', '-p', '-t', name);
      if (pane.code === 0 && /\$\s*$/.test(stripped(pane.stdout))) return;
      if (performance.now() >= deadline) throw Error('fixture_prompt_unconfirmed');
      await pause(50);
    }
  }
  try {
    let shell = 'bash';
    if (temperature.startsWith('profile-') || temperature === 'pre-bash') {
      const rc = path.join(process.env.TEMP, 'fixture.bashrc');
      const began = path.join(process.env.TEMP, 'profile-began');
      profileGate = path.join(process.env.TEMP, 'profile-release');
      const quote = value => "'" + value.replaceAll('\\', '/').replaceAll("'", "'\\''") + "'";
      fs.writeFileSync(rc, `printf started > ${quote(began)}\nwhile [ ! -e ${quote(profileGate)} ]; do sleep 0.02; done\nPS1='PROFILE_READY$ '\n`);
      const bash = resolver.resolveWinPaneShell('bash');
      shell = `"${bash}" --noprofile --rcfile "${rc.replaceAll('\\', '/')}" -i`;
      if (temperature === 'pre-bash') {
        fs.appendFileSync(rc, `exec ${quote(bash)} --noprofile --norc -i\n`);
        shell = `"${bash}" --noprofile --norc "${rc.replaceAll('\\', '/')}"`;
      }
      row.fixtureProfile = true;
      row.profileStartedFile = began;
    }
    if (temperature.startsWith('reuse-')) {
      core.openSession(name, 'bash');
      await waitPrompt();
      row.previousAnchor = anchor();
      if (!row.previousAnchor) throw Error('native_identity_unconfirmed_before_close');
      const oldPid = Number(row.previousAnchor.split(':')[0]);
      sampler = spawn(process.execPath, [script, '--sampler', path.join(directory, base + '.pid'), String(oldPid), samples], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      await new Promise((resolve, reject) => { sampler.once('message', resolve); sampler.once('error', reject); });
      try { core.closeSession(name); row.previousCloseReturned = true; } catch (error) { unsafeCleanup = true; throw error; }
      const pidExists = () => { try { process.kill(oldPid, 0); return true; } catch (error) { return error.code === 'ESRCH' ? false : null; } };
      row.previousPidExistsAfterClose = pidExists();
      if (temperature === 'reuse-exited') {
        const deadline = performance.now() + 5000;
        while (pidExists() !== false && performance.now() < deadline) await pause(10);
        if (pidExists() !== false) { unsafeCleanup = true; throw Error('previous_pid_exit_unconfirmed'); }
      }
      row.previousPidExistsBeforeReopen = pidExists();
    }
    if (temperature === 'warm') {
      core.openSession('boundary_seed', 'bash');
      core.closeSession('boundary_seed');
      const deadline = performance.now() + 5000;
      while (warmCount() === 0 && performance.now() < deadline) await pause(50);
    }
    row.warmBeforeOpen = warmCount();
    core.openSession(name, shell); opened = true;
    identity = frame('open_returned').anchor;
    if (!identity) throw Error('native_identity_unconfirmed_before_input');
    const log = path.join(runtime.SOCKDIR, name + '.log');
    let initial = '';
    try { initial = fs.readFileSync(log, 'utf8'); } catch {}
    row.initialLogHasPrompt = /\$\s*$/.test(stripped(initial));
    if (profileGate) {
      const deadline = performance.now() + 5000;
      while (!fs.existsSync(row.profileStartedFile) && performance.now() < deadline) await pause(20);
      row.profileStarted = fs.existsSync(row.profileStartedFile);
      delete row.profileStartedFile;
      if (!row.profileStarted) throw Error('fixture_profile_not_started');
      if (readiness === 'wait') fs.writeFileSync(profileGate, 'release');
    }
    if (readiness === 'wait') {
      await waitPrompt(); row.promptObserved = true;
    }
    if (frame('before_input').anchor !== identity) throw Error('native_identity_changed_before_input');
    const marker = path.join(process.env.TEMP, 'shell-executed.txt').replaceAll('\\', '/').replaceAll("'", "'\\''");
    const padding = temperature.startsWith('reuse-') ? `; : '${'A'.repeat(3072)}'` : '';
    const expected = profileGate ? `日本語の入力\n引用"two"と'$変数\nend${temperature === "pre-bash" ? "あ".repeat(300) : ""}` : 'executed';
    const quotedPayload = "'" + expected.replaceAll("'", "'\\''") + "'";
    let command = `printf '%s' ${quotedPayload} > '${marker}'; printf '%s%s\\n' SHELL_BOUNDARY_ EXECUTED${padding}`;
    if (temperature === 'profile-atomic') command = runtime.atomicShellMultiline(command, 'bash');
    row.inputBytes = Buffer.byteLength(command);
    row.sends++;
    core.send(name, command, { raw: true, force: true });
    frame('send_returned');
    if (profileGate) fs.writeFileSync(profileGate, 'release');
    const out = await core.readOutput(name, { wait: true, timeout: 5, raw: true, until: 'SHELL_BOUNDARY_EXECUTED' });
    row.outputMarker = out.includes('SHELL_BOUNDARY_EXECUTED');
    row.fileMarker = fs.existsSync(marker);
    if (row.fileMarker) row.fileBytesMatch = fs.readFileSync(marker).equals(Buffer.from(expected));
    frame('read_returned');
  } catch (error) {
    row.error = /ECONNREFUSED|ETIMEDOUT|no server running|native_identity_\w+|fixture_prompt_unconfirmed|fixture_profile_not_started|previous_pid_exit_unconfirmed/.exec(error.message)?.[0] || error.name;
    frame('error');
  } finally {
    if (profileGate) fs.writeFileSync(profileGate, 'release');
    if (opened && identity && anchor() === identity) {
      try { core.closeSession(name); row.closed = true; } catch { row.cleanupUnknown = true; unsafeCleanup = true; }
    } else if (opened) { row.cleanupUnknown = true; unsafeCleanup = true; }
    if (!unsafeCleanup) { try { core.killAll(); } catch { row.cleanupUnknown = true; } }
    if (sampler?.connected) {
      const closed = new Promise(resolve => sampler.once('close', resolve));
      sampler.send('stop'); await closed;
    }
    if (fs.existsSync(samples)) row.samples = fs.readFileSync(samples, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
  console.log('SHELL_BOUNDARY_CASE=' + JSON.stringify(row));
} else {
  const rows = [];
  const preBash = process.argv.includes('--pre-bash-only');
  const profile = process.argv.includes('--profile-only') || preBash;
  for (const registry of (profile ? ['isolated'] : ['shared', 'isolated'])) {
    const cases = [];
    const reuse = process.argv.includes('--reuse-only');
    for (const temperature of (preBash ? ['pre-bash'] : profile ? ['profile-raw', 'profile-atomic'] : reuse ? ['reuse-immediate', 'reuse-exited'] : ['cold', 'warm'])) for (const readiness of (reuse ? ['immediate'] : ['immediate', 'wait'])) {
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
