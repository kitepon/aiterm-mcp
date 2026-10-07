import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { globalRegistration, nodeDefaultGlobalRoot, runParentHooksSetup, runSetup } from '../dist/setup.js';
import { SetupError } from '../dist/setup-platform.js';
import { deliveryProviderFile, writeDeliveryProvider } from '../dist/setup-integrations.js';

const registration = { command: 'node', args: ['index.js'] };
const steer = async () => ({ status: 'disabled' });
test('依存準備・実動作・登録の順で完了を判定する', async () => {
  const events = [];
  const result = await runSetup({ steer, provider: () => {}, registration: () => { assert.deepEqual(events, ['prepare']); return registration; }, prepare: () => events.push('prepare'), verify: async () => events.push('verify'), configure: () => { events.push('configure'); return { claude: { status: 'ready' }, codex: { status: 'not_detected' } }; }, progress: () => {} });
  assert.equal(result.status, 'ready');
  assert.equal(result.backend.status, 'ready');
  assert.deepEqual(events, ['prepare', 'verify', 'configure']);
});

test('端末実行が失敗したらAI設定を書き換えない', async () => {
  let configured = false;
  const result = await runSetup({ registration: () => registration, prepare: () => {}, verify: async () => { throw new SetupError('runtime_probe_failed', 'fixture'); }, configure: () => { configured = true; return {}; }, progress: () => {} });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason_code, 'runtime_probe_failed');
  assert.equal(configured, false);
});

test('部分失敗とclient未検出を成功扱いしない', async () => {
  const base = { steer, registration: () => registration, prepare: () => {}, verify: async () => {}, progress: () => {} };
  assert.equal((await runSetup({ ...base, configure: () => ({ claude: { status: 'failed' }, codex: { status: 'ready' } }) })).status, 'failed');
  assert.equal((await runSetup({ ...base, configure: () => ({ claude: { status: 'not_detected' } }) })).status, 'unsupported');
});

test('Steerの有効化は製品導入の後に行い、再起動待ちをreadyへ丸めない', async () => {
  const events = [];
  const result = await runSetup({ registration: () => registration, prepare: () => {}, verify: async () => {}, provider: () => {},
    configure: () => { events.push('configure'); return { codex: { status: 'ready' } }; }, codex_steer: 'enable',
    steer: async action => { events.push(action); return { status: 'restart_required', reason_code: 'codex_restart_required' }; }, progress: () => {} });
  assert.deepEqual(events, ['configure', 'enable']);
  assert.equal(result.status, 'restart_required');
  assert.equal(result.backend.status, 'ready');
});

test('導入が済んだら、配送を頼む入口の場所を残す。残せなければ成功にしない', async () => {
  const events = [];
  const base = { registration: () => registration, prepare: () => {}, verify: async () => {}, progress: () => {},
    configure: () => { events.push('configure'); return { codex: { status: 'ready' } }; }, steer: async () => { events.push('steer'); return { status: 'disabled' }; } };
  const seen = [];
  const result = await runSetup({ ...base, provider: (home, value) => { events.push('provider'); seen.push([home, value]); } });
  assert.equal(result.status, 'ready');
  assert.deepEqual(events, ['configure', 'provider', 'steer']);
  // WindowsにはHOMEが無い。setupが使うのと同じ決め方（HOME、無ければOSのhome）で比べる。
  assert.deepEqual(seen, [[process.env.HOME ?? homedir(), registration]]);
  // AIへの登録が1つも出来ていない時は残さない。
  let called = false;
  await runSetup({ ...base, configure: () => ({ claude: { status: 'not_detected' } }), provider: () => { called = true; } });
  assert.equal(called, false);
  const failed = await runSetup({ ...base, provider: () => { throw new Error('fixture'); } });
  assert.deepEqual([failed.status, failed.reason_code], ['failed', 'delivery_provider_failed']);
});

test('配送を頼む入口の記録は、登録と同じ導入のnodeと命令を指し、変わりが無ければ書かない', (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aiterm-provider-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dist = join(dir, 'lib', 'node_modules', 'aiterm-mcp', 'dist');
  mkdirSync(dist, { recursive: true });
  const home = join(dir, 'home');
  const node = join(dir, 'bin', 'node');
  const value = { command: node, args: [join(dist, 'index.js')] };
  // 命令が同じ導入の中に無い時は残さない。
  assert.throws(() => writeDeliveryProvider(home, value), /同じ導入の中にありません/);
  writeFileSync(join(dist, 'parent-delivery-cli.js'), '');
  assert.equal(writeDeliveryProvider(home, value), 'configured');
  const file = deliveryProviderFile(home);
  assert.equal(file, join(home, '.config', 'aiterm-mcp', 'delivery-provider.json'));
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { schema: 'aiterm.delivery-provider.v1', version, node, cli: join(dist, 'parent-delivery-cli.js') });
  const before = statSync(file);
  assert.equal(writeDeliveryProvider(home, value), 'unchanged');
  assert.deepEqual([statSync(file).mtimeMs, statSync(file).ino], [before.mtimeMs, before.ino], '同じ中身なら書き直さない');
  // nodeの場所が変わったら書き直す。
  assert.equal(writeDeliveryProvider(home, { ...value, command: join(dir, 'other', 'node') }), 'configured');
  for (const bad of [['relative/home', value], [home, { command: 'node', args: value.args }], [home, { command: node, args: ['index.js'] }]]) {
    assert.throws(() => writeDeliveryProvider(...bad), /絶対path/);
  }
});

test('global導入先はnpmの現在のrootと、実行中のNodeの既定のrootで判定する', (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aiterm-global-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const current = join(dir, 'prefix', 'lib', 'node_modules');
  const builtin = join(dir, 'node', 'lib', 'node_modules');
  const elsewhere = join(dir, 'checkout');
  for (const path of [join(current, 'aiterm-mcp'), join(builtin, 'aiterm-mcp'), elsewhere]) mkdirSync(path, { recursive: true });
  const empty = join(dir, 'bot', 'lib', 'node_modules');
  const run = root => () => `${root}\n`;
  // 従来どおり、npmの現在のglobal rootにある当packageを登録する。
  assert.deepEqual(globalRegistration(run(current), { packageRoot: join(current, 'aiterm-mcp'), defaultRoot: builtin }).args,
    [join(current, 'aiterm-mcp', 'dist', 'index.js')]);
  // npmのprefixを別の場所へ向けた環境では、実行中のNodeの既定のrootにある当packageを登録する。
  assert.deepEqual(globalRegistration(run(empty), { packageRoot: join(builtin, 'aiterm-mcp'), defaultRoot: builtin }).args,
    [join(builtin, 'aiterm-mcp', 'dist', 'index.js')]);
  // どちらにも属さないpackage（source checkoutや一時cache）は登録しない。失敗の形は従来のまま。
  assert.throws(() => globalRegistration(run(current), { packageRoot: elsewhere, defaultRoot: builtin }), { code: 'global_package_required' });
  assert.throws(() => globalRegistration(run(empty), { packageRoot: elsewhere, defaultRoot: builtin }), { code: 'ENOENT' });
  assert.equal(nodeDefaultGlobalRoot('/opt/node/bin/node', 'linux'), join('/opt/node', 'lib', 'node_modules'));
  assert.equal(nodeDefaultGlobalRoot(join('C:', 'node', 'node.exe'), 'win32'), join('C:', 'node', 'node_modules'));
});

test('hookだけの登録は依存準備・実動作確認・MCP登録を行わず、失敗と未検出を成功へ丸めない', () => {
  const base = { registration: () => registration, progress: () => {} };
  const seen = [];
  assert.deepEqual(runParentHooksSetup({ ...base, configure: (_home, value) => { seen.push(value); return { claude: { status: 'configured' }, cursor: { status: 'not_detected' } }; } }),
    { schema: 'aiterm.parent-hooks-result.v1', status: 'ready', hooks: { claude: { status: 'configured' }, cursor: { status: 'not_detected' } } });
  assert.deepEqual(seen, [registration]);
  assert.equal(runParentHooksSetup({ ...base, configure: () => ({ claude: { status: 'unchanged' }, cursor: { status: 'unchanged' } }) }).status, 'ready');
  const failed = runParentHooksSetup({ ...base, configure: () => ({ claude: { status: 'failed', reason_code: 'config_invalid' }, cursor: { status: 'configured' } }) });
  assert.deepEqual([failed.status, failed.reason_code], ['failed', 'hook_registration_failed']);
  const none = runParentHooksSetup({ ...base, configure: () => ({ claude: { status: 'not_detected' }, cursor: { status: 'not_detected' } }) });
  assert.deepEqual([none.status, none.reason_code], ['unsupported', 'clients_not_detected']);
  let configured = false;
  const notGlobal = runParentHooksSetup({ progress: () => {}, registration: () => { throw new SetupError('global_package_required', 'fixture'); }, configure: () => { configured = true; return {}; } });
  assert.deepEqual([notGlobal.status, notGlobal.reason_code, configured], ['failed', 'global_package_required', false]);
});

test('--hooks-onlyは他の引数と組み合わせない', () => {
  const cli = fileURLToPath(new URL('../dist/setup-cli.js', import.meta.url));
  for (const args of [['--hooks-only', '--codex-steer', 'enable'], ['--hooks-only', '--hooks-only']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /--hooks-only \[--json\]/);
  }
});

