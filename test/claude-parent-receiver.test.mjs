import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  prepareClaudeHookRequest, claudeParentFromRequest, bindClaudeParentDelivery,
  runClaudeResultHook, closeClaudeParentSession, submitClaudeParentAnswer,
} from '../dist/claude-parent-receiver.js';

function fixture(t, id = 'toolu_test_1', session = '311557e0-a9bb-4ef0-abef-6f2c82a36ae0') {
  const root = mkdtempSync(join(tmpdir(), 'aiterm-claude-parent-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = { session_id: session, tool_use_id: id, hook_event_name: 'PreToolUse' };
  prepareClaudeHookRequest(input, root);
  const parent = claudeParentFromRequest('claude-code', { 'claudecode/toolUseId': id }, root);
  return { root, input, parent };
}

test('ClaudeのMCP metadataと実行済みhookを相関し、引数や起動時envから親を推測しない', t => {
  const { root, parent } = fixture(t);
  assert.equal(parent.session_id, '311557e0-a9bb-4ef0-abef-6f2c82a36ae0');
  assert.equal(claudeParentFromRequest('other-client', {}, root), null);
  assert.throws(() => claudeParentFromRequest('claude-code', {}, root), /CLAUDE_PARENT_ID_UNAVAILABLE/);
  assert.throws(() => claudeParentFromRequest('claude-code', { 'claudecode/toolUseId': 'unknown' }, root), /CLAUDE_PARENT_HOOK_UNAVAILABLE/);
  assert.throws(() => claudeParentFromRequest('claude-code', { 'claudecode/toolUseId': '../escape' }, root), /CLAUDE_PARENT_ID_UNAVAILABLE/);
});

test('登録した子の結果だけをhookへ渡し、長い日本語・改行・引用符を欠けずに届ける', async t => {
  const { root, parent, input } = fixture(t);
  const deliveryId = '4187418f-833e-453f-9823-803c2c23df0e';
  bindClaudeParentDelivery(parent, deliveryId);
  let output;
  const hook = runClaudeResultHook({ ...input, hook_event_name: 'PostToolUse' }, text => { output = text; }, root);
  const text = '先頭\n' + '日本語「引用」\\\n'.repeat(8000) + '\n末尾';
  const result = await submitClaudeParentAnswer(parent, deliveryId, text);
  assert.equal(await hook, 2);
  assert.equal(output, text);
  assert.deepEqual(result, { queued_submission_id: null });
});

test('通常PTYなど配送を登録しないtoolのhookは即終了する', async t => {
  const { root, input } = fixture(t);
  assert.equal(await runClaudeResultHook({ ...input, hook_event_name: 'PostToolUse' }, () => assert.fail('不要な受信'), root), 0);
});

test('会話終了後の回答は別会話へ出さず、結果本文を保存する', async t => {
  const { root, parent, input } = fixture(t);
  const id = '4187418f-833e-453f-9823-803c2c23df0e';
  bindClaudeParentDelivery(parent, id);
  const hook = runClaudeResultHook({ ...input, hook_event_name: 'PostToolUse' }, () => assert.fail('終了した会話への出力'), root);
  closeClaudeParentSession({ session_id: input.session_id }, root);
  assert.equal(await hook, 0);
  await assert.rejects(submitClaudeParentAnswer(parent, id, '保存する本文'), /CLAUDE_PARENT_SESSION_CLOSED/);
  assert.equal(JSON.parse(readFileSync(join(root, input.tool_use_id, 'answer.json'), 'utf8')).text, '保存する本文');
});

test('別sessionのhookは同じrequestの回答を受け取れない', async t => {
  const { root, parent, input } = fixture(t);
  bindClaudeParentDelivery(parent, '4187418f-833e-453f-9823-803c2c23df0e');
  await assert.rejects(runClaudeResultHook({ ...input, session_id: '8f5bc4f6-3053-43c9-9514-5696dc3c8e08', hook_event_name: 'PostToolUse' }, () => {}, root), /CLAUDE_PARENT_SESSION_MISMATCH/);
});

test('同じ会話を再開した新しい依頼と、別の会話を終了する操作を混同しない', async t => {
  const { root, input } = fixture(t);
  closeClaudeParentSession({ session_id: input.session_id }, root);
  const next = { ...input, tool_use_id: 'toolu_test_2' };
  prepareClaudeHookRequest(next, root);
  const parent = claudeParentFromRequest('claude-code', { 'claudecode/toolUseId': next.tool_use_id }, root);
  const id = '4187418f-833e-453f-9823-803c2c23df0e';
  bindClaudeParentDelivery(parent, id);
  closeClaudeParentSession({ session_id: '8f5bc4f6-3053-43c9-9514-5696dc3c8e08' }, root);
  let output;
  const hook = runClaudeResultHook({ ...next, hook_event_name: 'PostToolUse' }, text => { output = text; }, root);
  await submitClaudeParentAnswer(parent, id, '新しい依頼の回答');
  assert.equal(await hook, 2);
  assert.equal(output, '新しい依頼の回答');
});

test('Claude native subagentを親の会話へ誤配送しない', t => {
  const { root, input } = fixture(t);
  prepareClaudeHookRequest({ ...input, tool_use_id: 'toolu_subagent', agent_id: 'agent-123' }, root);
  assert.throws(() => claudeParentFromRequest('claude-code', { 'claudecode/toolUseId': 'toolu_subagent' }, root), /CLAUDE_PARENT_SUBAGENT_UNSUPPORTED/);
});

test('hookの出力失敗は結果不明として返し、成功扱いや再送をしない', async t => {
  const { root, parent, input } = fixture(t);
  const id = '4187418f-833e-453f-9823-803c2c23df0e';
  bindClaudeParentDelivery(parent, id);
  const hook = assert.rejects(runClaudeResultHook(input, () => { throw new Error('出力先が切断された'); }, root), /出力先が切断/);
  await assert.rejects(submitClaudeParentAnswer(parent, id, '保持する回答'), error => error.delivery_code === 'CLAUDE_PARENT_HOOK_FAILED' && error.outcome_unknown);
  await hook;
  assert.equal(JSON.parse(readFileSync(join(root, input.tool_use_id, 'answer.json'), 'utf8')).text, '保持する回答');
});

test('受信hookの終了を検出し、出力前の終了と出力中断を区別する', async t => {
  const { root, parent, input } = fixture(t);
  const id = '4187418f-833e-453f-9823-803c2c23df0e';
  bindClaudeParentDelivery(parent, id);
  const dir = join(root, input.tool_use_id);
  writeFileSync(join(dir, 'hook.json'), JSON.stringify({ pid: process.pid, started_identity: '既に終了したprocessの開始識別子' }));
  await assert.rejects(submitClaudeParentAnswer(parent, id, '回答'), error => error.delivery_code === 'CLAUDE_PARENT_HOOK_CLOSED' && !error.outcome_unknown);
  writeFileSync(join(dir, 'sending.json'), JSON.stringify({ delivery_id: id }));
  await assert.rejects(submitClaudeParentAnswer(parent, id, '回答'), error => error.delivery_code === 'CLAUDE_PARENT_HOOK_CLOSED' && error.outcome_unknown);
});
