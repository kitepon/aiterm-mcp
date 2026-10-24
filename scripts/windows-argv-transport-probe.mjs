// Two failing scenarios, bounded cold generations; no real CLI or effect replay.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
assert.equal(process.platform, 'win32');
const script = process.argv[1];
if (process.argv[2] === '--child') {
  const worker = path.join(process.env.TEMP, 'transport-worker.mjs');
  let source = fs.readFileSync(path.join(process.cwd(), 'dist/psmux-send-worker.js'), 'utf8');
  const final = 'await sendCommand(port, key, `display-message -p ${completionMarker}`, completionMarker);';
  assert.ok(source.includes(final));
  source = source.replace(final, "await sendCommand(port, key, `display-message -p '${completionMarker}|#{pid}|#{session_name}|#{pane_pid}|#{pane_dead}|#{pane_in_mode}|#{pane_current_command}'`, completionMarker);");
  const signature = 'socket.on("end", () => {';
  assert.ok(source.includes(signature));
  source = source.replace(signature, signature + `
      if (expectedResponse) {
        const identity = response.split(/\\r?\\n/).find(line => line.startsWith(expectedResponse + '|'))?.split('|');
        fs.appendFileSync(path.join(process.cwd(), 'transport-worker-' + process.pid + '.jsonl'), JSON.stringify({
          operation: 'endpoint-response', expectedMarker: response.includes(expectedResponse),
          serverPid: identity?.[1] ?? null, serverSession: identity?.[2] ?? null,
          panePid: identity?.[3] ?? null, paneDead: identity?.[4] ?? null,
          paneMode: identity?.[5] ?? null, paneCommand: identity?.[6] ?? null
        }) + '\\n');
      }
  `);
  const readPort = 'const portText = fs.readFileSync(path.join(dir, `${sessionBase}.port`), "utf8").trim();';
  assert.ok(source.includes(readPort));
  source = source.replace(readPort, readPort + `
    const anchor = fs.readFileSync(path.join(dir, sessionBase + '.pid'), 'utf8').trim();
    const match = /AITERM_AGENT_LAUNCH_ID=['"]?([0-9a-f]{32})/.exec(payload.toString('utf8'));
    fs.appendFileSync(path.join(process.cwd(), 'transport-worker-' + process.pid + '.jsonl'), JSON.stringify({
      operation: 'endpoint-registry', sessionBase, port: Number(portText), anchor,
      launchId: match?.[1] ?? null, inputBytes: payload.length
    }) + '\\n');
  `);
  fs.writeFileSync(worker, source);
  const actual = cp.spawnSync;
  cp.spawnSync = function(command, args, options) {
    if (args?.[0]?.endsWith('psmux-send-worker.js') && options?.input && Buffer.from(options.input).includes(Buffer.from('AITERM_AGENT_LAUNCH_ID=')))
      return actual.call(this, command, [worker, ...args.slice(1)], options);
    return actual.call(this, command, args, options);
  };
  syncBuiltinESMExports();
  const load = file => import(pathToFileURL(path.join(process.cwd(), file)));
  const { core, withFakeCodexHome, readArgvFixture, readAgentMeta } = await load('test/core-agent-support.mjs');
  const runtime = await load('dist/tmux-runtime.js');
  const registry = process.env.PSMUX_DATA_DIR || path.join(process.env.USERPROFILE || os.homedir(), '.psmux');
  const anchor = sid => { try { return fs.readFileSync(path.join(registry, runtime.WIN_NS + '__' + sid + '.pid'), 'utf8').trim(); } catch { return null; } };
  const cases = [];
  // Exercise later opens with the desktop-access observation already cached,
  // as in the failing whole-file cases. No input is sent to this own seed.
  core.openSession('transport_seed', 'bash');
  core.closeSession('transport_seed');
  try {
    for (let round = 0; round < 3; round++) {
      for (const scenario of ['model-effort', 'normal-home']) {
        const row = { scenario, round, openCalls: 0, inputRetries: 0, miss: null };
        await withFakeCodexHome(async home => {
          if (scenario === 'model-effort') fs.writeFileSync(path.join(home, 'config.toml'), 'model = "pinned"\nmodel_reasoning_effort = "ultra"\nkeep_me = true\n\n[mcp_servers.x]\ncommand = "y"\n');
          let sid, identity, launch;
          try {
            row.openCalls++;
            [sid] = core.openAgent('codex', { ...(scenario === 'model-effort' ? { model: 'gpt-5.6-terra' } : {}), reasoning_effort: 'high', agent_done: true });
            identity = anchor(sid); launch = readAgentMeta(sid).launch_id; row.launchId = launch;
            const out = await readArgvFixture(sid, { diagnostic: value => { row.miss = JSON.parse(value); } });
            assert.match(out, /<arg>model_reasoning_effort=high<\/arg>/);
            if (scenario === 'model-effort') assert.match(out, /<arg>gpt-5\.6-terra<\/arg>/);
            row.passed = true;
          } catch (error) { row.passed = false; row.error = error.code || error.name; }
          finally {
            if (sid && identity && anchor(sid) === identity && readAgentMeta(sid).launch_id === launch) core.closeSession(sid);
          }
        });
        cases.push(row);
        if (!row.passed) break;
      }
      if (cases.some(row => !row.passed)) break;
    }
  } finally { cp.spawnSync = actual; syncBuiltinESMExports(); core.killAll(); }
  console.log('ARGV_TRANSPORT_CHILD=' + JSON.stringify({ cohort: process.argv[3], cases }));
  if (cases.some(row => !row.passed)) process.exitCode = 1;
} else {
  const results = await Promise.all([0, 1].map(cohort => new Promise(resolve => {
    const child = cp.spawn(process.execPath, ['--import', './test/seat-env.mjs', script, '--child', String(cohort)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => resolve({ cohort, error: error.code }));
    child.on('close', code => {
      const line = stdout.split(/\r?\n/).find(line => line.startsWith('ARGV_TRANSPORT_CHILD='));
      resolve(line ? { ...JSON.parse(line.slice('ARGV_TRANSPORT_CHILD='.length)), exitCode: code } : { cohort, exitCode: code, fixtureError: true, stderr: stderr.slice(0, 800) });
    });
  })));
  const wire = fs.readdirSync(process.cwd()).filter(file => /^transport-worker-\d+\.jsonl$/.test(file)).flatMap(file => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
  console.log('ARGV_TRANSPORT_RESULT=' + JSON.stringify({ cohorts: results, wire }));
}
