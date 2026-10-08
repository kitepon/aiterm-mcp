import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('試験入口は席のstate・系譜・tmuxを外し、個別試験の保存場所を優先する', () => {
  const root = mkdtempSync(join(tmpdir(), 'seat-fixture-'));
  const inherited = join(root, 'owner-state');
  const individual = join(root, 'individual');
  mkdirSync(inherited);
  mkdirSync(individual);
  const registration = join(inherited, 'registration.json');
  writeFileSync(registration, 'keep owner registration\n');
  const stateModule = new URL('../dist/state-root.js', import.meta.url).href;
  try {
    const result = spawnSync(process.execPath, ['--import', new URL('./seat-env.mjs', import.meta.url).href,
      '--input-type=module', '-e', `
        import { existsSync } from 'node:fs';
        const { runtimeStateBase } = await import(${JSON.stringify(stateModule)});
        const initial = runtimeStateBase();
        const environment = Object.fromEntries(['AITERM_STATE_BASE', 'AITERM_AGENT_ROLE', 'AITERM_AGENT_SESSION_ID',
          'AITERM_AGENT_DEPTH', 'AITERM_AGENT_LINEAGE', 'AITERM_AGENT_DELEGATION_ALLOWED', 'AITERM_SESSION_ID',
          'TMUX', 'TMUX_PANE'].map(key => [key, process.env[key] ?? null]));
        const temporary = ['TEMP', 'TMP', 'XDG_RUNTIME_DIR'].map(key => process.env[key]);
        const socketTmpdir = process.env.TMPDIR ?? null;
        process.env.TMPDIR = process.env.INDIVIDUAL_TEST_STATE;
        process.env.XDG_RUNTIME_DIR = process.env.INDIVIDUAL_TEST_STATE;
        console.log(JSON.stringify({ initial, exists: existsSync(initial), environment, temporary, socketTmpdir,
          individual: runtimeStateBase() }));
      `], { encoding: 'utf8', timeout: 10000, env: {
      ...process.env, AITERM_STATE_BASE: inherited, AITERM_AGENT_ROLE: 'subagent',
      AITERM_AGENT_SESSION_ID: 'owner', AITERM_AGENT_DEPTH: '1', AITERM_AGENT_LINEAGE: 'host-root>claude:owner',
      AITERM_AGENT_DELEGATION_ALLOWED: 'true', AITERM_SESSION_ID: 'owner',
      TMUX: '/owner/socket,1,0', TMUX_PANE: '%0', INDIVIDUAL_TEST_STATE: individual,
    } });
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(data.exists, true);
    assert.equal(existsSync(data.initial), false, '前処理が作った置き場は、processの終わりに消える');
    assert.notEqual(data.initial, inherited);
    assert.deepEqual(Object.values(data.environment), Array(9).fill(null));
    assert.deepEqual(data.temporary, Array(3).fill(data.initial));
    assert.equal(data.socketTmpdir, process.platform === 'win32' ? null : data.initial);
    assert.equal(data.individual, individual);
    assert.equal(readFileSync(registration, 'utf8'), 'keep owner registration\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// 前処理つきのprocessが、自分の置き場にsocketを開くprocessを1つ起こす。
// leave='live'ならそのprocessを残して終わり、'dead'なら強制終了してsocketのfileだけを残して終わる。
function runWithSocket(leave) {
  const result = spawnSync(process.execPath, ['--import', new URL('./seat-env.mjs', import.meta.url).href,
    '--input-type=module', '-e', `
      import { spawn } from 'node:child_process';
      import { once } from 'node:events';
      import { join } from 'node:path';
      const file = join(process.env.TMPDIR, 'server', 'test.sock');
      const listener = spawn(process.execPath, ['-e', \`
        const fs = require('node:fs');
        fs.mkdirSync(require('node:path').dirname(process.argv[1]), { recursive: true });
        require('node:net').createServer().listen(process.argv[1], () => fs.writeSync(1, 'ready'));
      \`, file], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
      await once(listener.stdout, 'data');
      if (process.env.SEAT_ENV_LEAVE === 'dead') {
        listener.kill('SIGKILL');
        await once(listener, 'exit');
      } else {
        listener.stdout.destroy();
        listener.unref();
      }
      console.log(JSON.stringify({ root: process.env.TMPDIR, file, listener: listener.pid }));
    `], { encoding: 'utf8', timeout: 20000, env: { ...process.env, SEAT_ENV_LEAVE: leave } });
  assert.equal(result.status, 0, result.stderr);
  return { ...JSON.parse(result.stdout), stderr: result.stderr };
}

test('終わったserverのsocketだけが残った置き場は消す', { skip: process.platform === 'win32' }, () => {
  const data = runWithSocket('dead');
  assert.equal(existsSync(data.root), false);
  assert.equal(data.stderr, '');
});

test('生きたserverのsocketが残った置き場は消さず、場所を知らせる', { skip: process.platform === 'win32' }, () => {
  const data = runWithSocket('live');
  try {
    assert.equal(existsSync(data.file), true);
    assert.match(data.stderr, /試験の置き場を消しません/);
    assert.ok(data.stderr.includes(data.file), data.stderr);
  } finally {
    try { process.kill(data.listener, 'SIGKILL'); } catch { /* 既に終了 */ }
    rmSync(data.root, { recursive: true, force: true });
  }
});
