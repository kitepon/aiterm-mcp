import './seat-env.mjs'; // 最初のimportに置く（ADR 0121）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hasTmux = spawnSync(process.platform === 'win32' ? 'psmux' : 'tmux', ['-V']).status === 0;

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

// 試験fileは、入口（--import）を通らずに流される事がある。引数が空の`node --test`は、その場所から下の試験fileを全部拾う（ADR 0087の追記）。
test('試験fileは、最初のimportで前処理を読む', () => {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const missing = readdirSync(directory).filter(name => name.endsWith('.test.mjs')).filter((name) => {
    const first = readFileSync(join(directory, name), 'utf8').split('\n').find(line => line.startsWith('import '));
    return !/^import ['"]\.\/seat-env\.mjs['"];/.test(first ?? '');
  });
  assert.deepEqual(missing, []);
});

test('入口を通らずに前処理を最初のimportで読んだprocessも、席のstateと系譜を引き継がない', () => {
  const root = mkdtempSync(join(tmpdir(), 'seat-direct-'));
  const inherited = join(root, 'owner-state');
  mkdirSync(inherited);
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import ${JSON.stringify(new URL('./seat-env.mjs', import.meta.url).href)};
        import { runtimeStateBase } from ${JSON.stringify(new URL('../dist/state-root.js', import.meta.url).href)};
        console.log(JSON.stringify({ base: runtimeStateBase(), temp: process.env.TEMP,
          environment: ['AITERM_STATE_BASE', 'AITERM_SESSION_ID', 'AITERM_AGENT_SESSION_ID', 'AITERM_AGENT_LINEAGE', 'TMUX']
            .map(key => process.env[key] ?? null) }));
      `], { encoding: 'utf8', timeout: 10000, env: {
      ...process.env, AITERM_STATE_BASE: inherited, AITERM_SESSION_ID: 'owner', AITERM_AGENT_SESSION_ID: 'owner',
      AITERM_AGENT_LINEAGE: 'host-root>claude:owner', TMUX: '/owner/socket,1,0',
    } });
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(data.base, data.temp);
    assert.notEqual(data.base, inherited);
    assert.deepEqual(data.environment, Array(5).fill(null));
    assert.deepEqual(readdirSync(inherited), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// 席の環境（置き場を指すAITERM_STATE_BASEと系譜）を継いだprocessが、入口を通らずに、席を登録して片付ける（2026-10-13にBellTeamの席で起きた形）。
// 親が指していた置き場の記録は、名前も中身も変わらない。置き場も席も偽物で、本物の席の記録は使わない。
test('席の置き場を指す環境から入口なしで席を登録して片付けても、その置き場の記録は変わらない', { skip: hasTmux ? false : 'tmux 未インストール' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'seat-owner-'));
  const state = join(root, 'state');
  const agents = join(state, `aiterm-mcp-${typeof process.getuid === 'function' ? process.getuid() : 0}`, 'agents');
  mkdirSync(agents, { recursive: true });
  // 親の席の記録に見立てた物と、試験の席と同じ名前の記録（名前で選ぶ片付けが届いても分かるように）。
  for (const [name, body] of [
    ['bot-owner.0123456789abcdef0123456789abcdef.agent.json', '{"kind":"claude","aiterm_session":"bot-owner"}\n'],
    ['bot-owner.0123456789abcdef0123456789abcdef.events.jsonl', '{"type":"agent_done"}\n'],
    ['bot-owner.0123456789abcdef0123456789abcdef.claude-settings.json', '{}\n'],
    ['bot-owner.0123456789abcdef0123456789abcdef.interim.json', '{}\n'],
    ['seat_guard.fedcba9876543210fedcba9876543210.agent.json', '{"kind":"claude","aiterm_session":"seat_guard"}\n'],
  ]) writeFileSync(join(agents, name), body);
  const snapshot = () => readdirSync(agents).sort().map(name => [name, readFileSync(join(agents, name), 'utf8'), statSync(join(agents, name)).mtimeMs]);
  const before = snapshot();
  const moduleUrl = file => JSON.stringify(new URL(file, import.meta.url).href);
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import ${moduleUrl('./seat-env.mjs')};
        import * as fs from 'node:fs';
        import * as path from 'node:path';
        import * as core from ${moduleUrl('../dist/core.js')};
        import { createClaudeAgentMetadata } from ${moduleUrl('../dist/harnesses/claude.js')};
        const meta = createClaudeAgentMetadata('seat_guard', null, 'none', null, null, { agentRole: 'subagent', parentSessionId: 'host-root',
          delegationDepth: 1, lineage: 'host-root>claude:seat_guard', delegationAllowed: true }, null, null);
        const own = path.dirname(meta.event_file);
        const registered = fs.readdirSync(own);
        core.closeSession('seat_guard');
        const closed = fs.readdirSync(own);
        core.killAll();
        console.log(JSON.stringify({ own, registered, closed }));
      `], { encoding: 'utf8', timeout: 30000, env: {
      ...process.env, AITERM_STATE_BASE: state, AITERM_SESSION_ID: 'bot-owner', AITERM_AGENT_SESSION_ID: 'bot-owner',
      AITERM_AGENT_ROLE: 'subagent', AITERM_AGENT_LINEAGE: 'host-root>claude:bot-owner', TMUX: '/owner/socket,1,0', TMUX_PANE: '%0',
    } });
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.ok(!data.own.startsWith(root), `試験の席の登録が、親の置き場へ書かれた: ${data.own}`);
    assert.ok(data.registered.some(name => /^seat_guard\.[0-9a-f]{32}\.agent\.json$/.test(name)), '試験の席は、自分の置き場に登録される');
    assert.deepEqual(data.closed.filter(name => name.startsWith('seat_guard.')), [], '片付けは、自分の置き場の登録を消す');
    assert.deepEqual(snapshot(), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('試験入口は、席が名指しするharnessと道具の置き場と、鍵を外す', () => {
  const named = ['CODEX_HOME', 'GROK_HOME', 'CLAUDE_CONFIG_DIR', 'CURSOR_HOME', 'GH_CONFIG_DIR', 'GIT_CONFIG_GLOBAL', 'BELLTEAM_ROOT',
    'BELLTEAM_BUGHUB_KEY', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'TYPESAFE_API_KEY', 'SEAT_FIXTURE_SECRET', 'SEAT_FIXTURE_PASSWORD'];
  const kept = ['AITERM_TEST_CODEX_BINARY', 'SEAT_FIXTURE_KEYBOARD'];
  const result = spawnSync(process.execPath, ['--import', new URL('./seat-env.mjs', import.meta.url).href,
    '--input-type=module', '-e', `
      console.log(JSON.stringify(Object.fromEntries(${JSON.stringify([...named, ...kept])}.map(key => [key, process.env[key] ?? null]))));
    `], { encoding: 'utf8', timeout: 10000, env: {
    ...process.env, ...Object.fromEntries([...named, ...kept].map(key => [key, `owner-${key}`])),
  } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ...Object.fromEntries(named.map(key => [key, null])), ...Object.fromEntries(kept.map(key => [key, `owner-${key}`])),
  });
});

// 引数が空の`node --test`は、file systemの根から試験fileを拾う。入口から起こした走者がよその試験fileを拾っても、動かさない。
test('走者の子は、この作業ツリーの外の試験fileを流さない', () => {
  const root = mkdtempSync(join(tmpdir(), 'seat-foreign-'));
  const mark = join(root, 'ran');
  const foreign = join(root, 'foreign.test.mjs');
  writeFileSync(foreign, `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.SEAT_FOREIGN_MARK, 'ran');\n`);
  // この試験も走者の子なので、走者の子の印を継いでいる。印を外して、新しい走者として起こす。
  const { NODE_TEST_CONTEXT: _context, ...environment } = process.env;
  const env = { ...environment, SEAT_FOREIGN_MARK: mark };
  try {
    // 前処理が無ければ、このfileは動く（下で「動かなかった」と言うための確かめ）。
    assert.equal(spawnSync(process.execPath, ['--test', foreign], { encoding: 'utf8', timeout: 30000, env }).status, 0);
    assert.equal(existsSync(mark), true);
    rmSync(mark);
    const result = spawnSync(process.execPath, ['--import', new URL('./seat-env.mjs', import.meta.url).href, '--test', foreign],
      { encoding: 'utf8', timeout: 30000, env });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(mark), false, 'よその試験fileが動いた');
    assert.match(result.stdout + result.stderr, /この作業ツリーの外の試験fileは流しません/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CIの入口は、空の名前や試験fileでない名前を、組む前に断る', () => {
  const tree = fileURLToPath(new URL('..', import.meta.url));
  for (const files of ['[""]', '["/"]', '["test"]', '["test/../../outside.test.mjs"]', '["test/no-such-file.test.mjs"]', '["test/seat-env.mjs"]', '[]']) {
    const result = spawnSync(process.execPath, ['scripts/run-product-ci-tests.mjs'], { cwd: tree, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, PRODUCT_CI_TEST_SCOPE: 'selected', PRODUCT_CI_TEST_FILES: files } });
    assert.equal(result.status, 1, `${files}: ${result.stdout}`);
    assert.match(result.stderr, /PRODUCT_CI_TEST_FILES が不正です/, files);
    assert.doesNotMatch(result.stdout, /tmux|psmux/, `${files}: 断る前に先へ進んだ`);
  }
});

// CIのrunnerの利用者が替わっても、homeに何が入っていても、同じ結果にする（ADR 0121）。
test('試験入口は、動かす利用者のhomeの代わりに、置き場の中の空のhomeを渡す', {
  skip: process.platform === 'win32' ? 'Windowsは利用者フォルダを差し替えない' : false,
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'seat-home-'));
  const owner = join(root, 'owner-home');
  mkdirSync(join(owner, '.config'), { recursive: true });
  try {
    const result = spawnSync(process.execPath, ['--import', new URL('./seat-env.mjs', import.meta.url).href,
      '--input-type=module', '-e', `
        import { readdirSync } from 'node:fs';
        import { homedir } from 'node:os';
        console.log(JSON.stringify({ home: process.env.HOME, os: homedir(), temp: process.env.TEMP,
          entries: readdirSync(process.env.HOME),
          xdg: ['XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME'].map(key => process.env[key] ?? null) }));
      `], { encoding: 'utf8', timeout: 10000, env: {
      ...process.env, HOME: owner, XDG_CONFIG_HOME: join(owner, '.config'), XDG_STATE_HOME: join(owner, 'state'),
      XDG_DATA_HOME: join(owner, 'data'), XDG_CACHE_HOME: join(owner, 'cache'),
    } });
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(data.home, join(data.temp, 'home'));
    assert.equal(data.os, data.home, 'OSのhomeの問い合わせも同じ場所を返す');
    assert.deepEqual(data.entries, []);
    assert.deepEqual(data.xdg, Array(4).fill(null));
    assert.equal(existsSync(data.home), false, '置き場ごと、processの終わりに消える');
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
