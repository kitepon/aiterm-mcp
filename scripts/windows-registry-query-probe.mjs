// Synthetic registry only: no pane/server is created and no real state is read.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
assert.equal(process.platform, 'win32');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psmux-registry-probe-'));
const temporaryListener = net.createServer();
await new Promise(resolve => temporaryListener.listen(0, '127.0.0.1', resolve));
const unusedPort = temporaryListener.address().port;
await new Promise(resolve => temporaryListener.close(resolve));
const result = { schema: 'aiterm.windows-registry-query-probe.v1', cases: [] };
try {
  for (const command of ['has-session', 'display-message']) {
    const base = 'registry-query-fixture';
    fs.writeFileSync(path.join(dir, base + '.port'), String(unusedPort));
    fs.writeFileSync(path.join(dir, base + '.pid'), String(process.pid));
    fs.writeFileSync(path.join(dir, base + '.key'), '0000000000000000');
    const before = fs.readdirSync(dir).sort();
    const started = performance.now();
    const args = command === 'has-session' ? [command, '-t', base] : [command, '-p', '-t', base, '#{session_name}'];
    const response = spawnSync('psmux', args, { encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PSMUX_DATA_DIR: dir, PSMUX_SESSION: '', PSMUX_SESSION_NAME: '', TMUX: '', TMUX_PANE: '' } });
    result.cases.push({ command, code: response.status, errorCode: response.error?.code ?? null,
      elapsedMs: Math.round(performance.now() - started), before, after: fs.readdirSync(dir).sort(),
      livePidAnchor: true, stdoutEmpty: response.stdout.trim() === '', noServerMessage: /no server/i.test(response.stderr) });
  }
  console.log('REGISTRY_QUERY_PROBE_RESULT=' + JSON.stringify(result));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
