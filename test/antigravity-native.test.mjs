import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { authenticateAgent } from '../dist/core.js';
import { antigravityCatalog, antigravityAuthPane, antigravityAuthChoiceKey, antigravityStartupAction, antigravityPaneObservation, mergeAntigravityHooks, createAntigravityAgentMetadata, antigravityTranscriptText } from '../dist/harnesses/antigravity.js';

test('Antigravity trusts only the exact displayed workspace across native separators and wrapping', () => {
  const screen = 'C:\\Users\\kite\\long-\nfolder\\fixture\n\nDo you trust the contents of this project?\n> Yes, I trust this folder\n  No, exit';
  assert.equal(antigravityStartupAction(screen, true, 'C:/Users/kite/long-folder/fixture')?.kind, 'antigravity_trust');
  assert.equal(antigravityStartupAction(screen, true, 'C:/Users/kite/long-folder'), null);
  assert.equal(antigravityStartupAction(screen, false, 'C:/Users/kite/long-folder/fixture'), null);
});

test('Antigravity distinguishes native generation, tool work, idle and blocked input', () => {
  assert.equal(antigravityPaneObservation('⣯ Working...\n>\nesc to cancel').state, 'busy');
  assert.equal(antigravityPaneObservation('⣯ Generating...\n>\nesc to cancel').state, 'busy');
  assert.equal(antigravityPaneObservation('>\n? for shortcuts').state, 'idle');
  assert.equal(antigravityPaneObservation('Do you trust the contents of this project?').state, 'blocked');
});

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

test('Antigravity authentication has explicit menus, wrapped OAuth URL and code input', () => {
  const login = antigravityAuthPane('Select login method:\n > 1. Google OAuth\n   2. Use a Google Cloud project');
  assert.equal(login.ui.input, 'choice');
  assert.equal(login.native_input.selected_id, 'option-1');
  const paste = antigravityAuthPane('https://accounts.google.com/o/oauth2/auth?client_id=example&\n code_challenge=challenge&state=state\n──────────\nAfter authenticating, copy the code displayed in the browser and paste it below:\n authorization code...');
  assert.equal(paste.ui.stage, 'paste_code');
  assert.equal(paste.native_input.empty, true);
  assert.equal(new URL(paste.url).searchParams.get('state'), 'state');
  assert.equal(antigravityAuthPane('authorization code: ALREADY_TYPED').ui, undefined);
  const terms = 'Terms of Service & Data Use\n    [ ] Yes, I agree to help improve\n > Previous   [Done]';
  assert.equal(antigravityAuthChoiceKey(terms, 'option-3'), 'Right');
  assert.equal(antigravityAuthPane('Do you trust the contents of this project?').onboarding_complete, true);
});

test('Antigravity OAuth URL ends at the native blank line before the pager footer', () => {
  const screen = [
    ' Your browser should open automatically. If not:', '',
    ' https://accounts.google.com/o/oauth2/auth?client_id=fixture&state=fixture-',
    ' QA', '', '  (1–20 of 24 lines)', '', '  shift+up/down Navigate',
  ].join('\n');
  assert.equal(antigravityAuthPane(screen).url,
    'https://accounts.google.com/o/oauth2/auth?client_id=fixture&state=fixture-QA');
});

test('Antigravity reports invalid_grant without exposing the native rejection text', () => {
  const pane = antigravityAuthPane('OAuth error: invalid_grant\nARTIFICIAL_PRIVATE_DETAIL');
  assert.equal(pane.failed, true);
  assert.equal(pane.input_required, false);
  assert.equal(pane.ui, undefined);
  assert.equal(pane.url, null);
  assert.match(pane.message, /invalid_grant/);
  assert.ok(!JSON.stringify(pane).includes('ARTIFICIAL_PRIVATE_DETAIL'));
  assert.equal(antigravityAuthPane('Signing in...').failed, undefined);
  assert.equal(antigravityAuthPane('invalid_grant_suffix').failed, undefined);
});

test('Antigravity hook registration preserves other hooks and is idempotent', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-hooks-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'hooks.json');
  fs.writeFileSync(file, JSON.stringify({ 'other-product': { Stop: [{ command: 'other' }] } }));
  assert.equal(mergeAntigravityHooks(file, '/node', '/hook.js'), 'configured');
  const body = fs.readFileSync(file, 'utf8');
  assert.deepEqual(JSON.parse(body)['other-product'], { Stop: [{ command: 'other' }] });
  assert.equal(mergeAntigravityHooks(file, '/node', '/hook.js'), 'unchanged');
  assert.equal(fs.readFileSync(file, 'utf8'), body);
  const disabled = JSON.stringify({ 'aiterm-native': { enabled: false } });
  fs.writeFileSync(file, disabled);
  assert.throws(() => mergeAntigravityHooks(file, '/node', '/hook.js'), /ANTIGRAVITY_HOOK_DISABLED/);
  assert.equal(fs.readFileSync(file, 'utf8'), disabled);
});

test('Antigravity forced relogin refuses before creating a session or clearing shared authentication', async t => {
  const before = process.env.ANTIGRAVITY_BIN;
  process.env.ANTIGRAVITY_BIN = process.execPath;
  t.after(() => { if (before === undefined) delete process.env.ANTIGRAVITY_BIN; else process.env.ANTIGRAVITY_BIN = before; });
  const result = await authenticateAgent('antigravity', { action: 'start', cwd: process.cwd(), relogin: true });
  assert.equal(result.status, 'failed');
  assert.equal(result.session_id, null);
  assert.match(result.message, /^AGENT_AUTH_RELOGIN_UNSUPPORTED/);
});

test('Antigravity hooks bind one conversation and publish only a fully idle final response', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-hook-turn-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const meta = createAntigravityAgentMetadata('agy-hook-fixture', cwd, 'none', undefined, {
    agentRole: 'subagent', parentSessionId: 'host-root', delegationDepth: 1, lineage: 'host-root>antigravity:agy-hook-fixture', delegationAllowed: true,
  });
  const id = 'b8ffcfbd-0a02-490b-b3f6-15b37817ef52';
  const transcript = path.join(meta.antigravity_home, 'brain', id, '.system_generated', 'logs', 'transcript_full.jsonl');
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  const user = { step_index: 0, type: 'USER_INPUT', content: 'question' };
  const answer = { step_index: 2, type: 'PLANNER_RESPONSE', status: 'DONE', content: 'final answer' };
  fs.writeFileSync(transcript, [user, answer].map(JSON.stringify).join('\n') + '\n');
  const payload = { conversationId: id, workspacePaths: [cwd], transcriptPath: transcript };
  const hook = (event, input) => {
    const result = spawnSync(process.execPath, ['dist/antigravity-hook.js', event], {
      env: { ...process.env, AITERM_AGENT_KIND: 'antigravity', AITERM_SESSION_ID: meta.aiterm_session, AITERM_AGENT_LAUNCH_ID: meta.launch_id },
      input: JSON.stringify(input), encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.ok(hook('SessionStart', payload).injectSteps[0].systemMessage.systemMessage.includes(meta.launch_id));
  const stop = { ...payload, executionNum: 0, fullyIdle: false, terminationReason: 'NO_TOOL_CALL', error: '' };
  hook('Stop', stop);
  assert.equal(fs.readFileSync(meta.event_file, 'utf8'), '');
  hook('Stop', { ...stop, fullyIdle: true, conversationId: 'd0beb454-2e41-49e3-8d40-0db62866e0bb' });
  assert.equal(fs.readFileSync(meta.event_file, 'utf8'), '');
  hook('Stop', { ...stop, fullyIdle: true });
  hook('Stop', { ...stop, fullyIdle: true });
  const events = fs.readFileSync(meta.event_file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.length, 1);
  assert.equal(events[0].done_status, 'turn_done');
  assert.equal(antigravityTranscriptText(meta, events[0]), 'final answer');
  fs.appendFileSync(transcript, JSON.stringify({ ...user, step_index: 3 }) + '\n');
  hook('Stop', { ...stop, fullyIdle: true });
  assert.equal(fs.readFileSync(meta.event_file, 'utf8').trim().split('\n').length, 1, 'A previous turn answer cannot satisfy the next turn');
  fs.appendFileSync(transcript, JSON.stringify({ ...answer, step_index: 4, content: 'second answer' }) + '\n');
  hook('Stop', { ...stop, fullyIdle: true });
  const second = fs.readFileSync(meta.event_file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(second.length, 2, 'executionNum zero is a new execution after a new native user step');
  assert.equal(second[1].turn_id, '3-0');
  assert.equal(antigravityTranscriptText(meta, second[1]), 'second answer');
});
