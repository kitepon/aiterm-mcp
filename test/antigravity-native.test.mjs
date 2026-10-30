import test from 'node:test';
import assert from 'node:assert/strict';
import { antigravityCatalog, antigravityTurnResult } from '../dist/harnesses/antigravity.js';

test('Antigravity catalog preserves real effort-specific IDs and selected model', () => {
  const catalog = antigravityCatalog('gemini-4-argon-medium\tGemini 4 Argon (Medium)\r\ngemini-4-argon-high\tGemini 4 Argon (High)\r\n', 'gemini-4-argon-medium\tGemini 4 Argon (Medium)\n');
  assert.equal(catalog.default_model, 'gemini-4-argon-medium');
  assert.deepEqual(catalog.models.map(m => [m.id, m.efforts, m.default_effort]), [
    ['gemini-4-argon-medium', ['medium'], 'medium'], ['gemini-4-argon-high', ['high'], 'high'],
  ]);
  assert.throws(() => antigravityCatalog('Please sign in', 'x\tX'), /MODEL_CATALOG_INVALID/);
  assert.throws(() => antigravityCatalog('x\tX\nx\tX', 'x\tX'), /重複/);
  assert.throws(() => antigravityCatalog('x\tX', 'y\tY'), /既定model/);
});

test('Antigravity result must match the expected conversation and turn', () => {
  const id = '7c4a3648-af73-438a-862a-d8a1ceb284e5';
  const result = { event: 'result', result: { conversation_id: id, num_turns: 2, status: 'SUCCESS', response: 'answer\n' } };
  assert.equal(antigravityTurnResult({ event: 'step_update' }, id, 2), null);
  assert.equal(antigravityTurnResult(result, id, 2).outcome, 'done');
  assert.throws(() => antigravityTurnResult(result, id, 3), /MISMATCH/);
  assert.throws(() => antigravityTurnResult(result, 'd0beb454-2e41-49e3-8d40-0db62866e0bb', 2), /MISMATCH/);
  assert.throws(() => antigravityTurnResult({ event: 'result', result: {} }, id, 2), /MISMATCH/);
  assert.throws(() => antigravityTurnResult({ event: 'result', result: { ...result.result, status: 'NEW_STATUS' } }, id, 2), /MISMATCH/);
  for (const status of ['WAITING', 'RUNNING']) assert.equal(antigravityTurnResult({ event: 'result', result: { ...result.result, status } }, id, 2), null);
  for (const status of ['ERROR', 'CANCELED', 'INTERRUPTED', 'INVALID']) assert.equal(antigravityTurnResult({ event: 'result', result: { ...result.result, status } }, id, 2).outcome, 'error');
});
