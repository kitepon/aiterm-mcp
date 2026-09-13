import assert from 'node:assert/strict';
import test from 'node:test';
import { runSetup } from '../dist/setup.js';
import { SetupError } from '../dist/setup-platform.js';

const registration = { command: 'node', args: ['index.js'] };
const steer = async () => ({ status: 'disabled' });
test('依存準備・実動作・登録の順で完了を判定する', async () => {
  const events = [];
  const result = await runSetup({ steer, registration: () => { assert.deepEqual(events, ['prepare']); return registration; }, prepare: () => events.push('prepare'), verify: async () => events.push('verify'), configure: () => { events.push('configure'); return { claude: { status: 'ready' }, codex: { status: 'not_detected' } }; }, progress: () => {} });
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
  const result = await runSetup({ registration: () => registration, prepare: () => {}, verify: async () => {},
    configure: () => { events.push('configure'); return { codex: { status: 'ready' } }; }, codex_steer: 'enable',
    steer: async action => { events.push(action); return { status: 'restart_required', reason_code: 'codex_restart_required' }; }, progress: () => {} });
  assert.deepEqual(events, ['configure', 'enable']);
  assert.equal(result.status, 'restart_required');
  assert.equal(result.backend.status, 'ready');
});
