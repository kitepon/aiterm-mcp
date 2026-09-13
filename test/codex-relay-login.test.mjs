import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installRelayLogin, removeRelayLogin, relayLoginPlist } from '../dist/codex-relay-login.js';

test('ログイン時に同じ起動設定を適用するLaunchAgentを保存し、再実行と解除を行う', t => {
  const directory = mkdtempSync(join(tmpdir(), 'aiterm-login-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const commands = []; let loaded = false;
  const options = { directory, uid: 501, run: args => { commands.push(args); if (args[0] === 'print') return loaded ? 0 : 1; loaded = args[0] === 'bootstrap'; return 0; } };
  const launcher = '/日本語 & <設定>/codex';
  installRelayLogin(launcher, options);
  assert.equal(commands.filter(args => args[0] === 'bootstrap').length, 1);
  const file = join(directory, readdirSync(directory)[0]);
  const text = readFileSync(file, 'utf8');
  assert.equal(text, relayLoginPlist(launcher));
  assert.match(text, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(text, /<string>setenv<\/string><string>CODEX_CLI_PATH<\/string>/);
  assert.match(text, /&amp; &lt;設定&gt;/);
  installRelayLogin(launcher, options);
  assert.equal(commands.filter(args => args[0] === 'bootstrap').length, 1);
  removeRelayLogin(launcher, options);
  assert(commands.some(args => args[0] === 'bootout'));
  assert.deepEqual(readdirSync(directory), []);
});

test('同名の所有外LaunchAgentを置換・削除しない', t => {
  const directory = mkdtempSync(join(tmpdir(), 'aiterm-login-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const options = { directory, uid: 501, run: () => 0 };
  installRelayLogin('/launcher', options);
  const file = join(directory, readdirSync(directory)[0]);
  writeFileSync(file, '他からの変更');
  assert.throws(() => installRelayLogin('/launcher', options), error => error.code === 'codex_steer_login_conflict');
  assert.throws(() => removeRelayLogin('/launcher', options), error => error.code === 'codex_steer_login_conflict');
  assert.equal(readFileSync(file, 'utf8'), '他からの変更');
});
