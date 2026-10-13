import './seat-env.mjs'; // 最初のimportに置く（ADR 0121）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
        process.env.TMPDIR = process.env.AITERM_TEST_INDIVIDUAL_STATE;
        process.env.XDG_RUNTIME_DIR = process.env.AITERM_TEST_INDIVIDUAL_STATE;
        console.log(JSON.stringify({ initial, exists: existsSync(initial), environment, temporary, socketTmpdir,
          individual: runtimeStateBase() }));
      `], { encoding: 'utf8', timeout: 10000, env: {
      ...process.env, AITERM_STATE_BASE: inherited, AITERM_AGENT_ROLE: 'subagent',
      AITERM_AGENT_SESSION_ID: 'owner', AITERM_AGENT_DEPTH: '1', AITERM_AGENT_LINEAGE: 'host-root>claude:owner',
      AITERM_AGENT_DELEGATION_ALLOWED: 'true', AITERM_SESSION_ID: 'owner',
      TMUX: '/owner/socket,1,0', TMUX_PANE: '%0', AITERM_TEST_INDIVIDUAL_STATE: individual,
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

// BellTeamのSEC-012の受け入れの確かめ。親が、本番に見立てた偽の置き場（ログイン・設定・席の記録を置いた物）を、homeと名指しの変数の両方で指し、
// 形の違う名前の鍵を持っている。前処理を通ったprocessでは、(1) 親の値が1つも残らない、(2) 製品が決めるharnessと状態の置き場が全部、試験の置き場の中、
// (3) gitが親の設定と認証の補助を見ない、(4) 親の置き場の中身が変わらない。本物のログインや席の記録は使わない。
// USERPROFILEだけは残る（Windowsの利用者フォルダは差し替えない）。残っても、製品が決める置き場はそこへ行かない事を見る。
for (const [label, preload] of [['入口（--import）', true], ['最初のimportだけ', false]]) {
  test(`親の本番相当の置き場と鍵を、試験のprocessへ渡さない: ${label}`, () => {
    const mark = 'owner-production';
    const root = mkdtempSync(join(tmpdir(), 'seat-prod-'));
    const owner = join(root, mark);
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const files = {
      '.codex/auth.json': '{"tokens":"owner"}\n',
      '.codex/config.toml': 'model = "owner"\n',
      '.grok/auth.json': '{"key":"owner"}\n',
      '.claude/.credentials.json': '{"claudeAiOauth":"owner"}\n',
      '.claude/settings.json': '{"hooks":{}}\n',
      '.cursor/cli-config.json': '{"auth":"owner"}\n',
      '.config/gh/hosts.yml': 'github.com:\n  oauth_token: owner\n',
      '.config/aiterm-mcp/runtime-error-reporting.json': '{"enabled":true}\n',
      '.gitconfig': '[credential]\n\thelper = owner-helper\n[user]\n\tname = owner-name\n',
      '.npmrc': '//registry.npmjs.org/:_authToken=owner\n',
      [`state/aiterm-mcp-${uid}/agents/bot-owner.0123456789abcdef0123456789abcdef.agent.json`]: '{"kind":"claude"}\n',
    };
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(dirname(join(owner, name)), { recursive: true });
      writeFileSync(join(owner, name), body);
    }
    const listed = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
      ? listed(join(directory, entry.name)) : [join(directory, entry.name)]);
    const snapshot = () => listed(owner).sort().map(file => [file, readFileSync(file, 'utf8'), statSync(file).mtimeMs]);
    const before = snapshot();
    const inherited = {
      // 置き場
      HOME: owner, USERPROFILE: owner, CODEX_HOME: join(owner, '.codex'), GROK_HOME: join(owner, '.grok'), GROK_AUTH_PATH: join(owner, '.grok', 'auth.json'),
      CLAUDE_CONFIG_DIR: join(owner, '.claude'), CURSOR_HOME: join(owner, '.cursor'), GH_CONFIG_DIR: join(owner, '.config', 'gh'),
      GIT_CONFIG_GLOBAL: join(owner, '.gitconfig'), XDG_CONFIG_HOME: join(owner, '.config'), XDG_STATE_HOME: join(owner, '.local', 'state'),
      XDG_DATA_HOME: join(owner, '.local', 'share'), XDG_CACHE_HOME: join(owner, '.cache'), npm_config_userconfig: join(owner, '.npmrc'),
      npm_config_cache: join(owner, '.npm'), AITERM_STATE_BASE: join(owner, 'state'), TMUX_TMPDIR: owner, THROUGHLINE_BIN: join(owner, 'throughline'),
      DOCKER_CONFIG: join(owner, '.docker'), KUBECONFIG: join(owner, '.kube', 'config'), GOOGLE_APPLICATION_CREDENTIALS: join(owner, 'gcp.json'),
      SSH_AUTH_SOCK: join(owner, 'agent.sock'),
      // 席と系譜
      AITERM_SESSION_ID: mark, AITERM_AGENT_SESSION_ID: mark, AITERM_AGENT_ROLE: mark, AITERM_AGENT_LINEAGE: `host-root>claude:${mark}`,
      AITERM_AGENT_LAUNCH_ID: mark, TMUX: `/${mark}/socket,1,0`, TMUX_PANE: mark, BELLTEAM_ROOT: owner, BELLTEAM_HOME: owner,
      CLAUDE_CODE_MESSAGING_SOCKET: join(owner, 'cc.sock'), CLAUDE_CODE_SESSION_ID: mark,
      // 鍵（形の違う名前を混ぜる。残す接頭辞の付いた名前も入れる）
      ...Object.fromEntries(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'CODEX_API_KEY', 'TYPESAFE_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN',
        'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AZURE_CLIENT_SECRET', 'OP_SESSION_owner',
        'OP_SERVICE_ACCOUNT_TOKEN', 'CLOUDFLARE_API_TOKEN', 'DATABASE_URL', 'PGPASSWORD', 'BELLTEAM_BUGHUB_KEY', 'CLAUDE_CODE_MESSAGING_TOKEN',
        'CLAUDE_CODE_OAUTH_TOKEN', 'SEAT_FIXTURE_CREDENTIALS', 'SEAT_FIXTURE_CREDENTIAL', 'SEAT_FIXTURE_AUTH', 'GITHUB_APP_PRIVATE_KEY',
        'RUNNER_REGISTRATION_TOKEN', 'AITERM_TEST_OWNER_SECRET', 'NODE_FIXTURE_PASSWD'].map(key => [key, `${mark}-${key}`])),
    };
    const moduleUrl = file => JSON.stringify(new URL(file, import.meta.url).href);
    const report = `
      const os = await import('node:os');
      const { spawnSync } = await import('node:child_process');
      const { realCodexHome } = await import(${moduleUrl('../dist/harnesses/codex.js')});
      const { realGrokHome } = await import(${moduleUrl('../dist/harnesses/grok.js')});
      const { claudeConfigDir } = await import(${moduleUrl('../dist/harnesses/claude.js')});
      const { runtimeStateBase } = await import(${moduleUrl('../dist/state-root.js')});
      const git = (...args) => { const result = spawnSync('git', args, { encoding: 'utf8' }); return result.error ? null : result.stdout; };
      console.log(JSON.stringify({
        leaked: Object.entries(process.env).filter(([, value]) => value.includes(${JSON.stringify(mark)})).map(([key]) => key).sort(),
        kept: process.env.AITERM_TEST_CODEX_BINARY ?? null,
        temp: process.env.TEMP, home: process.env.HOME, osHome: os.homedir(),
        places: { codex: realCodexHome(), grok: realGrokHome(), claude: claudeConfigDir(), state: runtimeStateBase(), xdg: process.env.XDG_CONFIG_HOME,
          gh: process.env.GH_CONFIG_DIR, npmrc: process.env.npm_config_userconfig, npmCache: process.env.npm_config_cache },
        git: { version: git('--version'), global: git('config', '--global', '--list'), helper: git('config', '--get-all', 'credential.helper'),
          name: git('config', '--get', 'user.name') },
      }));
    `;
    try {
      const result = spawnSync(process.execPath, preload
        ? ['--import', new URL('./seat-env.mjs', import.meta.url).href, '--input-type=module', '-e', report]
        : ['--input-type=module', '-e', `import ${moduleUrl('./seat-env.mjs')};\n${report}`],
      { encoding: 'utf8', timeout: 30000, env: { ...process.env, ...inherited, AITERM_TEST_CODEX_BINARY: 'kept-for-real-harness-tests' } });
      assert.equal(result.status, 0, result.stderr);
      const data = JSON.parse(result.stdout);
      assert.deepEqual(data.leaked, ['USERPROFILE']);
      assert.equal(data.kept, 'kept-for-real-harness-tests', '利用者が意図して渡す実物の試験の口（AITERM_TEST_）は残る');
      assert.equal(data.home, join(data.temp, 'home'));
      if (process.platform !== 'win32') assert.equal(data.osHome, data.home);
      for (const [name, place] of Object.entries(data.places)) {
        assert.ok(place.startsWith(data.temp), `${name} が試験の置き場の外: ${place}`);
        assert.ok(!place.includes(mark), `${name} が親の置き場: ${place}`);
      }
      if (data.git.version !== null) {
        assert.equal(data.git.global, '', '利用者のgitの設定を読まない');
        assert.equal(data.git.name, '');
        assert.equal(data.git.helper.split(/\r?\n/).slice(0, -1).at(-1), '', '認証の補助は、最後に空で上書きされている');
        assert.ok(!data.git.helper.includes('owner-helper'));
      }
      assert.deepEqual(snapshot(), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// 一般の試験は、端末に入っている本物のharnessを起こさない。親は、harnessが入っている端末に見立てた偽物を、製品が探す3つの場所
// （名指しの変数・homeの決まった場所・PATH）の全部に持っている。偽物は、起きると目印のfileへ1行書く。
// 前処理を通ったprocessでは、(1) 製品の探し方が4つとも試験の置き場の中の「断る偽物」を返す、(2) 名指しの変数を外して探しても同じ、
// (3) 返った物を起こしても、親の偽物は1つも起きない、(4) 起こした事が、processの終わりに失敗として出る。
for (const [label, preload] of [['入口（--import）', true], ['最初のimportだけ', false]]) {
  test(`端末に入っているharnessを、試験のprocessは起こさない: ${label}`, () => {
    const windows = process.platform === 'win32';
    const root = mkdtempSync(join(tmpdir(), 'seat-harness-'));
    const owner = join(root, 'owner-production');
    const ran = join(root, 'ran');
    const installed = (file) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, file.endsWith('.cmd') ? `@echo off\r\n>>"${ran}" echo ran\r\n` : `#!/bin/sh\necho ran >> '${ran.replace(/\\/g, '/')}'\n`, { mode: 0o755 });
      return file;
    };
    const names = ['claude', 'codex', 'grok', 'cursor-agent'];
    for (const name of names) installed(join(owner, 'bin', windows ? `${name}.cmd` : name));
    for (const place of [['.local', 'bin', 'claude'], ['.local', 'bin', 'codex'], ['.local', 'bin', 'cursor-agent'], ['.grok', 'bin', 'grok']]) installed(join(owner, ...place));
    const variables = ['CLAUDE_BIN', 'CODEX_BIN', 'GROK_BIN', 'CURSOR_AGENT_BIN'];
    const inherited = {
      HOME: owner, USERPROFILE: owner, PATH: [join(owner, 'bin'), process.env.PATH].join(windows ? ';' : ':'),
      ...Object.fromEntries(variables.map((variable, index) => [variable, installed(join(owner, 'named', names[index]))])),
    };
    const moduleUrl = file => JSON.stringify(new URL(file, import.meta.url).href);
    // 返った実行ファイルが、子の置き場の中の「断る偽物」かは、子の中で確かめる（置き場は子の終わりに消える。Windowsのpathは書き方が1つでない）。
    const report = `
      const { spawnSync } = await import('node:child_process');
      const { realpathSync } = await import('node:fs');
      const { basename, dirname, join } = await import('node:path');
      const { resolveAgentBin, resolveWinPaneShell } = await import(${moduleUrl('../dist/agent-resolver.js')});
      const kinds = ['claude', 'codex', 'grok', 'cursor'];
      const real = (file) => { try { return realpathSync.native(file); } catch { return null; } };
      const refusers = real(join(process.env.TEMP, 'no-harness'));
      const resolve = (kind) => { try { return resolveAgentBin(kind); } catch (error) { return 'error: ' + error.message; } };
      const place = (file) => file === null || file.startsWith('error: ') ? file
        : (refusers !== null && real(dirname(file)) === refusers ? 'refuser:' : 'outside:' + dirname(file) + ':') + basename(file);
      const named = kinds.map(resolve);
      // 拡張子の無いscriptは、Windowsでは席のshell（Git Bash）が動かす。
      const started = process.env.AITERM_TEST_START_HARNESS !== '1' ? [] : named.map(bin => (process.platform === 'win32'
        ? spawnSync(resolveWinPaneShell('bash'), [bin, '--version'], { encoding: 'utf8', timeout: 20000 })
        : spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 20000 })).status);
      for (const variable of ${JSON.stringify(variables)}) delete process.env[variable];
      console.log(JSON.stringify({ named: named.map(place), started, searched: kinds.map(resolve).map(place) }));
    `;
    const run = start => spawnSync(process.execPath, preload
      ? ['--import', new URL('./seat-env.mjs', import.meta.url).href, '--input-type=module', '-e', report]
      : ['--input-type=module', '-e', `import ${moduleUrl('./seat-env.mjs')};\n${report}`],
    { encoding: 'utf8', timeout: 60000, env: { ...process.env, ...inherited, AITERM_TEST_START_HARNESS: start ? '1' : '0' } });
    try {
      const resolved = run(false);
      assert.equal(resolved.status, 0, resolved.stderr);
      assert.doesNotMatch(resolved.stderr, /偽物を立てずに/, '探しただけでは、失敗にならない');
      const data = JSON.parse(resolved.stdout);
      assert.deepEqual(data.named, names.map(name => `refuser:${name}`));
      // Windowsで変数を外すと、Codexは.cmdから本体を探して断り（起きない）、Cursorは利用者フォルダ（LOCALAPPDATA。差し替えない）の決まった場所を先に見る。
      // Cursorのこの道は、前処理では塞げない。変数を外す試験が、LOCALAPPDATAを自分で立てる。
      if (windows) {
        assert.equal(data.searched[0], 'refuser:claude.cmd');
        assert.match(data.searched[1], /^error: .*codex\.exeを解決できません/);
        assert.equal(data.searched[2], 'refuser:grok.cmd');
      } else {
        assert.deepEqual(data.searched, data.named);
      }

      const started = run(true);
      assert.equal(started.status, 1, '断った事が、processの失敗として出る');
      assert.deepEqual(JSON.parse(started.stdout).started, [97, 97, 97, 97]);
      assert.match(started.stderr, /偽物を立てずにharnessを起こそうとしました/);
      for (const name of names) assert.match(started.stderr, new RegExp(`^  ${name} --version$`, 'm'));
      assert.equal(existsSync(ran), false, `親の偽物が起きた: ${existsSync(ran) ? readFileSync(ran, 'utf8') : ''}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// 引数が空の`node --test`は、file systemの根から試験fileを拾う。入口から起こした走者がよその試験fileを拾っても、動かさない。
test('走者の子は、この作業ツリーの外の試験fileを流さない', () => {
  const root = mkdtempSync(join(tmpdir(), 'seat-foreign-'));
  const mark = join(root, 'ran');
  const foreign = join(root, 'foreign.test.mjs');
  writeFileSync(foreign, `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.AITERM_TEST_FOREIGN_MARK, 'ran');\n`);
  // この試験も走者の子なので、走者の子の印を継いでいる。印を外して、新しい走者として起こす。
  const { NODE_TEST_CONTEXT: _context, ...environment } = process.env;
  const env = { ...environment, AITERM_TEST_FOREIGN_MARK: mark };
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
    assert.deepEqual(data.xdg, [join(data.home, '.config'), join(data.home, '.local', 'state'), join(data.home, '.local', 'share'), join(data.home, '.cache')]);
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
      if (process.env.AITERM_TEST_SEAT_LEAVE === 'dead') {
        listener.kill('SIGKILL');
        await once(listener, 'exit');
      } else {
        listener.stdout.destroy();
        listener.unref();
      }
      console.log(JSON.stringify({ root: process.env.TMPDIR, file, listener: listener.pid }));
    `], { encoding: 'utf8', timeout: 20000, env: { ...process.env, AITERM_TEST_SEAT_LEAVE: leave } });
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
