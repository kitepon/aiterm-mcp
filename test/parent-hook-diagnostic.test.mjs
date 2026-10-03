import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { claudeParentHookDiagnostic, cursorParentHookDiagnostic, parentDeliveryDiagnostic } from '../dist/parent-hook-diagnostic.js';
import { mergeClaudeParentHooks, mergeCursorParentHooks } from '../dist/setup-integrations.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'aiterm-hook-diagnostic-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'dist'));
  for (const file of ['index.js', 'claude-parent-hook.js', 'cursor-parent-hook.js']) writeFileSync(join(dir, 'dist', file), '');
  return { dir, registration: { command: process.execPath, args: [join(dir, 'dist', 'index.js')] }, claude: join(dir, 'settings.json'), cursor: join(dir, 'hooks.json') };
}
const ready = { status: 'ready', reason_code: null };
const required = reason_code => ({ status: 'setup_required', reason_code });
const readSettings = file => readFileSync(file, 'utf8');

test('Claude Codeのhookは、setupが登録するeventがすべて揃い入口が実在する時だけreadyにする', (t) => {
  const { dir, registration, claude } = fixture(t);
  assert.deepEqual(claudeParentHookDiagnostic(claude), required('hooks_not_registered'));
  // 他製品のhookだけがある設定を、登録済みと数えない。
  const other = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }],
    SessionEnd: [{ hooks: [{ type: 'command', command: 'node', args: ['/opt/other/not-claude-parent-hook.js'] }] }] } };
  writeFileSync(claude, JSON.stringify(other));
  assert.deepEqual(claudeParentHookDiagnostic(claude), required('hooks_not_registered'));
  mergeClaudeParentHooks(claude, registration);
  assert.deepEqual(claudeParentHookDiagnostic(claude), ready);
  // eventが1つ欠けても配送は成立しない。
  const partial = JSON.parse(JSON.stringify(other));
  writeFileSync(claude, JSON.stringify(partial));
  mergeClaudeParentHooks(claude, registration);
  const settings = JSON.parse(readSettings(claude));
  delete settings.hooks.PostToolUse;
  writeFileSync(claude, JSON.stringify(settings));
  assert.deepEqual(claudeParentHookDiagnostic(claude), required('hooks_not_registered'));
  mergeClaudeParentHooks(claude, registration);
  writeFileSync(claude, JSON.stringify({ ...JSON.parse(readSettings(claude)), disableAllHooks: true }));
  assert.deepEqual(claudeParentHookDiagnostic(claude), required('hooks_disabled'));
  writeFileSync(claude, JSON.stringify({ ...JSON.parse(readSettings(claude)), disableAllHooks: false }));
  rmSync(join(dir, 'dist', 'claude-parent-hook.js'));
  assert.deepEqual(claudeParentHookDiagnostic(claude), required('hook_script_missing'));
  for (const broken of ['{', '[]', JSON.stringify({ hooks: [] }), JSON.stringify({ hooks: { PreToolUse: {} } })]) {
    writeFileSync(claude, broken);
    assert.deepEqual(claudeParentHookDiagnostic(claude), { status: 'unverified', reason_code: 'settings_unreadable' });
  }
});

test('Cursorのhookは配送と同じ判定で登録を確かめる', (t) => {
  const { registration, cursor } = fixture(t);
  assert.deepEqual(cursorParentHookDiagnostic(cursor), required('hooks_not_registered'));
  writeFileSync(cursor, JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: 'rtk hook cursor', matcher: 'Shell' }] } }));
  assert.deepEqual(cursorParentHookDiagnostic(cursor), required('hooks_not_registered'));
  mergeCursorParentHooks(cursor, registration);
  assert.deepEqual(cursorParentHookDiagnostic(cursor), ready);
  writeFileSync(cursor, '﻿' + JSON.stringify(JSON.parse(readSettings(cursor))));
  assert.deepEqual(cursorParentHookDiagnostic(cursor), ready);
  writeFileSync(cursor, '{');
  assert.deepEqual(cursorParentHookDiagnostic(cursor), { status: 'unverified', reason_code: 'settings_unreadable' });
});

test('呼出元の状態を返し、未検出のclientは対象外にする。設定の本文とpathは返さない', (t) => {
  const { dir, registration, claude, cursor } = fixture(t);
  const options = { home: dir, claudeSettings: claude, cursorHooks: cursor };
  const none = parentDeliveryDiagnostic(undefined, { ...options, detect: () => false });
  assert.deepEqual(none, {
    diagnostic_schema: 'aiterm-mcp.parent-delivery-diagnostics.v1', caller: 'other', caller_status: 'not_applicable', setup_command: 'aiterm-setup',
    hooks: { claude: { status: 'not_applicable', reason_code: null }, cursor: { status: 'not_applicable', reason_code: null } },
  });
  // 呼出元がClaude Codeなら、CLIを解決できなくても設定を読む。hookが無ければ送信は拒否される。
  const caller = parentDeliveryDiagnostic('claude', { ...options, detect: () => false });
  assert.deepEqual([caller.caller, caller.caller_status, caller.hooks.claude, caller.hooks.cursor.status],
    ['claude', 'setup_required', required('hooks_not_registered'), 'not_applicable']);
  mergeClaudeParentHooks(claude, registration);
  const after = parentDeliveryDiagnostic('claude', { ...options, detect: kind => kind === 'cursor' });
  assert.deepEqual([after.caller_status, after.hooks.claude, after.hooks.cursor], ['ready', ready, required('hooks_not_registered')]);
  mergeCursorParentHooks(cursor, registration);
  const cursorCaller = parentDeliveryDiagnostic('cursor', { ...options, detect: () => true });
  assert.deepEqual([cursorCaller.caller, cursorCaller.caller_status], ['cursor', 'ready']);
  assert.equal(JSON.stringify(cursorCaller).includes(dir), false);
});
