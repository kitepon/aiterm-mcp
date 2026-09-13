import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureCodexSteer } from '../dist/setup-codex-relay.js';
import { readRelayConfig } from '../dist/codex-relay-config.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'aiterm setup relay '));
  chmodSync(root, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const values = new Map([['CODEX_CLI_PATH', '/previous codex']]);
  const events = [];
  const runtime = { platform: 'darwin', directory: root, socket_root: '/tmp/unused', node: process.execPath,
    relay: '/package/dist/codex-stdio-relay.js', findBinary: () => '/Applications/Codex.app/Contents/Resources/codex',
    getGui: key => values.get(key) ?? null,
    setGui: (key, value) => { events.push('set'); values.set(key, value); },
    persist: () => { events.push('persist'); }, unpersist: () => { events.push('unpersist'); },
    verify: async candidate => { events.push('verify'); assert.match(readFileSync(candidate, 'utf8'), /exec "\$binary"/); },
    live: async () => false };
  return { root, runtime, values, events };
}

test('明示enableだけが設定し、実効接続がなければ再起動待ちを返す', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  assert.deepEqual(await configureCodexSteer('status', f.runtime), { status: 'disabled' });
  assert.deepEqual(f.events, []);
  assert.equal((await configureCodexSteer('enable', f.runtime)).status, 'restart_required');
  assert.deepEqual(f.events, ['verify', 'persist', 'set']);
  assert.equal(readRelayConfig(f.root).previous_cli_path, '/previous codex');
  assert.equal((await configureCodexSteer('enable', f.runtime)).status, 'restart_required');
  assert.equal(readRelayConfig(f.root).previous_cli_path, '/previous codex');
  assert.equal((await configureCodexSteer('status', { ...f.runtime, live: async () => true })).status, 'ready');
  assert.equal((await configureCodexSteer('disable', f.runtime)).status, 'restart_required');
  assert.equal(f.values.get('CODEX_CLI_PATH'), '/previous codex');
  assert.equal((await configureCodexSteer('status', f.runtime)).status, 'disabled');
});

test('他から変更された起動設定は上書きせず、解除も拒否する', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  await configureCodexSteer('enable', f.runtime);
  f.values.set('CODEX_CLI_PATH', '/foreign');
  assert.equal((await configureCodexSteer('status', f.runtime)).status, 'failed');
  for (const action of ['enable', 'disable']) await assert.rejects(configureCodexSteer(action, f.runtime), error => error.code === 'codex_steer_configuration_changed');
  assert.equal(f.values.get('CODEX_CLI_PATH'), '/foreign');
});

test('隔離起動が失敗したらGUIと設定を変更しない', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  await assert.rejects(configureCodexSteer('enable', { ...f.runtime, verify: async () => { throw new Error('起動失敗'); } }), /起動失敗/);
  assert.equal(readRelayConfig(f.root), null);
  assert.equal(f.values.get('CODEX_CLI_PATH'), '/previous codex');
});

test('GUI適用失敗は記録を残し、同じenableで元の復元値を維持して完了できる', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  await assert.rejects(configureCodexSteer('enable', { ...f.runtime, setGui: () => { throw new Error('適用失敗'); } }), /適用失敗/);
  assert.equal(readRelayConfig(f.root).previous_cli_path, '/previous codex');
  await configureCodexSteer('enable', f.runtime);
  assert.equal(readRelayConfig(f.root).previous_cli_path, '/previous codex');
});

test('未対応OSと既存共有接続は、変更前に理由を返す', async t => {
  const f = fixture(t);
  for (const platform of ['win32', 'linux']) {
    assert.deepEqual(await configureCodexSteer('enable', { ...f.runtime, platform }), { status: 'unsupported', reason_code: 'codex_steer_platform_unsupported' });
  }
  f.values.set('CODEX_APP_SERVER_WS_URL', '既存値');
  await assert.rejects(configureCodexSteer('enable', f.runtime), error => error.code === 'codex_steer_configuration_conflict');
  assert.deepEqual(f.events, []);
});
