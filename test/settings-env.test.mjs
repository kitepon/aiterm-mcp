// a442f: a launch caller's environment values reach the Claude seat through the per-launch settings `env` block, and survive resume.
import './seat-env.mjs'; // 最初のimportに置く（ADR 0121）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkSettingsEnv } from '../dist/settings-env.js';
import { createClaudeCorrelationSettings } from '../dist/harnesses/claude.js';
import { captureAgentResumeTemplate, readAgentResumeTemplate, refreshAgentResumeRecipe } from '../dist/agent-lifecycle.js';
import { openAgentWithInitialPrompt } from '../dist/core.js';

test('checkSettingsEnv takes plain names and values, nothing for empty, and refuses secrets and Aiterm-owned names', () => {
  assert.deepEqual(checkSettingsEnv({ CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: '1' }), { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: '1' });
  assert.equal(checkSettingsEnv(undefined), null);
  assert.equal(checkSettingsEnv({}), null);
  for (const bad of [{ 'A-B': '1' }, { MY_TOKEN: 'x' }, { API_KEY: 'x' }, { AITERM_X: '1' }, { CLAUDE_CONFIG_DIR: '/x' }, { A: 1 }, { A: 'a\0b' }, { A: 'x'.repeat(4097) }, ['A'], 'A=1'])
    assert.throws(() => checkSettingsEnv(bad), /settings_env/, JSON.stringify(bad));
  assert.throws(() => checkSettingsEnv(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`N${i}`, '1']))), /at most 32/);
});

test('the per-launch settings carry the env block only when the caller passed values', () => {
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const withEnv = read(createClaudeCorrelationSettings('settingsenv', 'c'.repeat(32), 'sonnet', 'high', { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: '1' }));
  assert.deepEqual(withEnv.env, { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: '1' });
  assert.equal(withEnv.model, 'sonnet');
  assert.ok(withEnv.hooks.Stop, 'the correlation hooks stay');
  for (const none of [undefined, null, {}]) assert.equal('env' in read(createClaudeCorrelationSettings('settingsenv', 'd'.repeat(32), 'sonnet', 'high', none)), false);
});

test('settings_env is kept in the resume template and recipe, so a resume writes the same block', () => {
  const meta = { aiterm_session: 'settingsenv-resume', launch_id: 'e'.repeat(32), kind: 'claude', vendor_session_id: '11111111-2222-4333-8444-555555555555',
    model: 'claude-opus-5-5', fast: false, agent_executable: process.execPath, cwd: process.env.HOME };
  captureAgentResumeTemplate(meta, 'high', [], process.env.HOME, {}, { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: '1' });
  assert.deepEqual(readAgentResumeTemplate(meta).settings_env, { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: '1' });
  assert.deepEqual(refreshAgentResumeRecipe(meta).settings_env, { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: '1' });
  const plain = { ...meta, aiterm_session: 'settingsenv-plain', launch_id: 'f'.repeat(32) };
  captureAgentResumeTemplate(plain, 'high', [], process.env.HOME, {});
  assert.equal('settings_env' in readAgentResumeTemplate(plain), false);
  assert.equal('settings_env' in refreshAgentResumeRecipe(plain), false);
});

test('a harness other than claude-code refuses settings_env before any session exists', async () => {
  await assert.rejects(openAgentWithInitialPrompt('codex', { session_name: 'settingsenv-codex', settings_env: { A: '1' } }), /settings_env/);
  await assert.rejects(openAgentWithInitialPrompt('claude', { session_name: 'settingsenv-secret', settings_env: { MY_TOKEN: 'x' } }), /settings_env/);
});
