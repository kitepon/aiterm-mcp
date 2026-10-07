// aiterm-setupを通らない導入（コンテナの起動時）のための、Codexの親配送hookの登録の入口（ADR 0098）。
// 公式Codexの実行ファイルを一時HOMEで起こし、登録・承認・読戻しを確かめる。実credentialや利用中の設定は使わない。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureCodexParentSteer } from '../dist/setup-integrations.js';
const binary = process.env.AITERM_TEST_CODEX_BINARY;

test('homeが絶対pathでない時は、書かずに失敗で返す', async () => {
  assert.deepEqual(await ensureCodexParentSteer('relative/home'), { status: 'failed', reason_code: 'codex_steer_home_invalid', changed: false });
});

test('登録し、2回目は何も書かず、外された登録は入れ直す', { skip: !binary, timeout: 60_000 }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'aiterm ensure steer '));
  t.after(() => rm(home, { recursive: true, force: true }));
  const codexHome = join(home, '.codex');
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await writeFile(join(codexHome, 'config.toml'), 'model = "mock-model"\ncli_auth_credentials_store = "file"\nmcp_oauth_credentials_store = "file"\n', { mode: 0o600 });
  // ほかの製品のhookが先に入っている（コンテナの並びと同じ形）。
  const foreign = (name) => ({ hooks: [{ type: 'command', command: `/usr/bin/true ${name}` }] });
  const before = { hooks: { PostToolUse: [foreign('first'), foreign('second')], Stop: [foreign('first'), foreign('second')], PreToolUse: [foreign('pre')] } };
  const hooksFile = join(codexHome, 'hooks.json');
  await writeFile(hooksFile, JSON.stringify(before));
  const env = { HOME: process.env.HOME, CODEX_HOME: process.env.CODEX_HOME };
  // Codexの実行ファイルが読むHOMEも試験の物にする（承認は試験のCODEX_HOMEへ書く）。
  process.env.HOME = home; delete process.env.CODEX_HOME;
  t.after(() => { process.env.HOME = env.HOME; if (env.CODEX_HOME === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = env.CODEX_HOME; });

  // 試験の端末で動いている本物のCodexを、「登録より前から動いている」と数えない（macOSとWindowsは、別のCODEX_HOMEのCodexを見分けられない）。
  const quiet = { binary, runtime: { processes: () => [] } };
  let started = Date.now();
  const first = await ensureCodexParentSteer(home, quiet);
  const enableMs = Date.now() - started;
  assert.deepEqual(first, { status: 'ready', changed: true });
  const registered = JSON.parse(await readFile(hooksFile, 'utf8'));
  const config = JSON.parse(await readFile(join(home, '.config', 'aiterm-mcp', 'codex-parent-hooks', 'config.json'), 'utf8'));
  // 自分のhookは、保存した命令の文字列との一致で見分ける（製品と同じ見分け方。Windowsの命令は中身を符号化して書くので、ファイル名では探せない）。
  const own = (document, event) => document.hooks[event].flatMap(group => group.hooks).filter(hook => hook.command === config.command);
  assert.equal(own(registered, 'PostToolUse').length, 1);
  assert.equal(own(registered, 'Stop').length, 1);
  assert.deepEqual(registered.hooks.PostToolUse.slice(0, 2), before.hooks.PostToolUse, 'ほかの製品のhookは位置も中身もそのまま');
  assert.deepEqual(registered.hooks.Stop.slice(0, 2), before.hooks.Stop);
  assert.deepEqual(registered.hooks.PreToolUse, before.hooks.PreToolUse);
  assert.equal(config.enabled, true);
  assert.equal(config.codex_home, codexHome);
  assert.deepEqual(config.stale_processes, [], '動いているCodexが無ければ、起き直しの待ちは無い');

  const files = [hooksFile, join(codexHome, 'config.toml'), join(home, '.config', 'aiterm-mcp', 'codex-parent-hooks', 'config.json')];
  const stamps = async () => Promise.all(files.map(async file => { const info = await stat(file); return `${info.mtimeMs}:${info.size}:${info.ino}`; }));
  const beforeSecond = await stamps();
  started = Date.now();
  const second = await ensureCodexParentSteer(home, quiet);
  const unchangedMs = Date.now() - started;
  assert.deepEqual(second, { status: 'ready', changed: false });
  assert.deepEqual(await stamps(), beforeSecond, '登録済みなら、hooks.json・config.toml・設定のどれも書かない');

  // ほかの導入がhooks.jsonを書き直して、Aitermの登録が外れた。
  await writeFile(hooksFile, JSON.stringify(before));
  const third = await ensureCodexParentSteer(home, quiet);
  assert.deepEqual(third, { status: 'ready', changed: true });
  const repaired = JSON.parse(await readFile(hooksFile, 'utf8'));
  assert.equal(own(repaired, 'PostToolUse').length, 1);
  assert.equal(own(repaired, 'Stop').length, 1);
  // 登録より前から動いているCodexがある時は、起き直しが要ると返す（readyへ丸めない）。
  await writeFile(hooksFile, JSON.stringify(before));
  const running = { pid: 4242, parent_pid: 1, started_identity: 'fixture', command: `${binary} app-server`, executable: binary };
  const fourth = await ensureCodexParentSteer(home, { binary, runtime: { processes: () => [running], codexHomeOf: () => null } });
  assert.deepEqual(fourth, { status: 'restart_required', reason_code: 'codex_restart_required', changed: true });
  t.diagnostic(JSON.stringify({ enable_ms: enableMs, unchanged_ms: unchangedMs }));
});
