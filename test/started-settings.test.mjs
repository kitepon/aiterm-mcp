// a442e: a seat launched with no model/effort records what it actually started with, so it can hibernate and resume.
import './seat-env.mjs'; // 最初のimportに置く（ADR 0121）
import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeBannerSettings } from '../dist/started-settings.js';
import { captureAgentResumeTemplate, readAgentResumeTemplate, writeAgentResumeTemplate, refreshAgentResumeRecipe } from '../dist/agent-lifecycle.js';

const SEAT = ' ▐▛███▛█   Claude Code v2.1.327\n▝▜██████▀  Opus 5.5 with high effort · API Usage Billing\n ▝▝   ▝▝   /tmp/x\n\n❯ Try "fix lint errors"\n';

test('the Claude start banner gives the model id and the effort', () => {
  assert.deepEqual(claudeBannerSettings(SEAT), { model: 'claude-opus-5-5', effort: 'high' });
  assert.deepEqual(claudeBannerSettings(SEAT.replace('Opus 5.5', 'Fable 5.2 (1M context)').replace('high', 'xhigh')), { model: 'claude-fable-5-2[1m]', effort: 'xhigh' });
  assert.deepEqual(claudeBannerSettings(SEAT.replace('Opus 5.5', 'Opus 5')), { model: 'claude-opus-5', effort: 'high' });
});

test('a banner without a model and effort (or one scrolled past the top) reads as null, never a guess', () => {
  assert.equal(claudeBannerSettings(SEAT.replace(' with high effort', '')), null);
  assert.equal(claudeBannerSettings('\n'.repeat(13) + SEAT), null);
  assert.equal(claudeBannerSettings('● Opus 5.5 with high effort is what I read'.padStart(60, '\n')), null);
});

test('a default launch gets a resume recipe once the started model and effort are recorded', () => {
  const meta = { aiterm_session: 'started-default', launch_id: 'b'.repeat(32), kind: 'codex', vendor_session_id: '11111111-2222-4333-8444-555555555555',
    model: null, fast: false, agent_executable: process.execPath, cwd: process.env.HOME };
  captureAgentResumeTemplate(meta, null, [], process.env.CODEX_HOME, {});
  assert.equal(refreshAgentResumeRecipe(meta), null, 'a launch that named nothing has no recipe');
  const template = readAgentResumeTemplate(meta);
  const started = { ...meta, model: 'gpt-6.2-sol' };
  writeAgentResumeTemplate(started, { ...template, model: 'gpt-6.2-sol', reasoning_effort: null, reasoning_effort_source: 'vendor_default', state: 'confirmed' });
  const recipe = refreshAgentResumeRecipe(started);
  assert.equal(recipe.model, 'gpt-6.2-sol');
  assert.equal(recipe.reasoning_effort, null);
  assert.equal(recipe.reasoning_effort_source, 'vendor_default');
});
