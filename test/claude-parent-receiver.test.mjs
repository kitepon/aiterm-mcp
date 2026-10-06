import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
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

// 2026-10-06: 届いた後も依頼ごとの置き場が残り、届いた子1つにつき1つ増えていた（aiterm-steer-delivery 0.2.2で片付ける）。
test('届いた依頼の置き場は残さず、届かなかった依頼の置き場は残す', async t => {
  const { root, parent, input } = fixture(t);
  const deliveryId = '4187418f-833e-453f-9823-803c2c23df0e';
  bindClaudeParentDelivery(parent, deliveryId);
  const hook = runClaudeResultHook({ ...input, hook_event_name: 'PostToolUse' }, () => {}, root);
  await submitClaudeParentAnswer(parent, deliveryId, '届く回答');
  assert.equal(await hook, 2);
  assert.equal(existsSync(join(root, input.tool_use_id)), false);
  const next = { ...input, tool_use_id: 'toolu_test_2' };
  prepareClaudeHookRequest(next, root);
  const second = claudeParentFromRequest('claude-code', { 'claudecode/toolUseId': next.tool_use_id }, root);
  bindClaudeParentDelivery(second, deliveryId);
  closeClaudeParentSession({ session_id: input.session_id }, root);
  await assert.rejects(submitClaudeParentAnswer(second, deliveryId, '届かない回答'), /CLAUDE_PARENT_SESSION_CLOSED/);
  assert.equal(existsSync(join(root, next.tool_use_id, 'answer.json')), true);
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

// 2026-10-06: 誤りで返った呼び出しの置き場（request.jsonだけ）が、1日後の見回りまで残っていた。連携元の本番で、
// Claude Codeの親がclaude-code harnessへwrite_scopeを付けて呼び、引数の検査で断られた回の置き場を見た（0.55.2）。
// Claude Codeは誤りの返りでPostToolUseを走らせないので、hookの片付けが走らない（ADR 0096）。
test('誤りで返すMCPの呼び出しは、配送を結んでいない依頼の置き場を返す前に消す', async () => {
  const base = mkdtempSync(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'aiterm-claude-error-'));
  const env = { ...process.env, TMPDIR: base, XDG_RUNTIME_DIR: base, AITERM_STATE_BASE: base };
  const inServer = code => spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' });
  const moduleUrl = name => JSON.stringify(pathToFileURL(resolve('dist', name)).href);
  // hookの置き場は、MCPのprocessと同じ環境から決まる。
  const located = inServer(`const { ensureStateRoot } = await import(${moduleUrl('agent-shared.js')}); process.stdout.write(ensureStateRoot());`);
  assert.equal(located.status, 0, located.stderr);
  const root = join(located.stdout, 'claude-parent-hooks');
  const session = randomUUID();
  const client = new Client({ name: 'claude-code', version: '1' });
  /** Claude Codeと同じ順に、PreToolUseのhookの記録を置いてからtoolを呼ぶ。 */
  const call = (id, name, args, before = () => {}) => {
    prepareClaudeHookRequest({ session_id: session, tool_use_id: id, hook_event_name: 'PreToolUse' }, root);
    before(join(root, id));
    return client.callTool({ name, arguments: args, _meta: { 'claudecode/toolUseId': id } });
  };
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('dist/index.js')], env, stderr: 'pipe' }));

    // 連携元で見た形。toolが引数を断る。
    const rejected = await call('toolu_rejected', 'agent_launch', { harness: 'claude-code', write_scope: 'read-only' });
    assert.equal(rejected.isError, true);
    assert.match(rejected.content[0].text, /write_scopeに対応していません/);
    assert.equal(existsSync(join(root, 'toolu_rejected')), false);

    // agentの席でない宛先への送信。別のtoolが断る形。
    const missing = await call('toolu_missing_seat', 'pty_send', { session_id: 'claude_error_none', text: 'x', require_agent: true });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /AGENT_SESSION_REQUIRED/);
    assert.equal(existsSync(join(root, 'toolu_missing_seat')), false);

    // 入力の検査で断る。toolのhandlerは走らず、McpServerが誤りの返りを作る。
    const invalid = await call('toolu_invalid', 'agent_launch', { harness: 'no-such-harness' });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /Input validation error/);
    assert.equal(existsSync(join(root, 'toolu_invalid')), false);

    // 配送を結んだ依頼は、誤りで返しても残す（届かなかった時に原因を調べる材料）。
    const bound = await call('toolu_bound', 'agent_launch', { harness: 'claude-code', write_scope: 'read-only' },
      dir => writeFileSync(join(dir, 'delivery.json'), JSON.stringify({ delivery_id: randomUUID() })));
    assert.equal(bound.isError, true);
    assert.deepEqual(readdirSync(join(root, 'toolu_bound')).sort(), ['delivery.json', 'request.json']);

    // 誤りでない返りの置き場には触れない（PostToolUseのhookが片付ける）。
    const listed = await call('toolu_ok', 'pty_list', {});
    assert.equal(listed.isError, undefined);
    assert.deepEqual(readdirSync(join(root, 'toolu_ok')), ['request.json']);
    assert.deepEqual(readdirSync(root).sort(), ['toolu_bound', 'toolu_ok']);
  } finally {
    await client.close();
    const cleanup = inServer(`const { killAll } = await import(${moduleUrl('core.js')}); killAll();`);
    assert.equal(cleanup.status, 0, cleanup.stderr);
    rmSync(base, { recursive: true, force: true });
  }
});

test('Claude Codeでない親の誤りの返りでは、置き場に触れない', async () => {
  const base = mkdtempSync(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'aiterm-claude-error-'));
  const env = { ...process.env, TMPDIR: base, XDG_RUNTIME_DIR: base, AITERM_STATE_BASE: base };
  const inServer = code => spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' });
  const moduleUrl = name => JSON.stringify(pathToFileURL(resolve('dist', name)).href);
  const located = inServer(`const { ensureStateRoot } = await import(${moduleUrl('agent-shared.js')}); process.stdout.write(ensureStateRoot());`);
  assert.equal(located.status, 0, located.stderr);
  const root = join(located.stdout, 'claude-parent-hooks');
  const client = new Client({ name: 'other-client', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('dist/index.js')], env, stderr: 'pipe' }));
    prepareClaudeHookRequest({ session_id: randomUUID(), tool_use_id: 'toolu_other', hook_event_name: 'PreToolUse' }, root);
    const rejected = await client.callTool({ name: 'agent_launch', arguments: { harness: 'claude-code', write_scope: 'read-only' },
      _meta: { 'claudecode/toolUseId': 'toolu_other' } });
    assert.equal(rejected.isError, true);
    assert.deepEqual(readdirSync(join(root, 'toolu_other')), ['request.json']);
  } finally {
    await client.close();
    const cleanup = inServer(`const { killAll } = await import(${moduleUrl('core.js')}); killAll();`);
    assert.equal(cleanup.status, 0, cleanup.stderr);
    rmSync(base, { recursive: true, force: true });
  }
});
