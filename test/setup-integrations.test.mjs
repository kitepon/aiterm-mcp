import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureIntegrations, mergeJsonMcp, mergeClaudeParentHooks, removeClaudeParentHooks, powershellInvocation } from '../dist/setup-integrations.js';

const registration = { command: '/usr/local/bin/node', args: ['/opt/aiterm/dist/index.js'] };
test('初回登録と再実行で自エントリ以外を保持する', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aiterm-setup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'mcp.json');
  const original = { preferences: { theme: 'dark' }, mcpServers: { other: { command: 'other' }, aiterm: { command: 'old-aiterm', env: { AITERM_FIXTURE: 'preserve' } } } };
  writeFileSync(file, JSON.stringify(original));
  assert.equal(mergeJsonMcp(file, registration), 'configured');
  const expected = { ...original, mcpServers: { ...original.mcpServers, aiterm: { ...original.mcpServers.aiterm, ...registration } } };
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), expected);
  const before = statSync(file).mtimeMs;
  assert.equal(mergeJsonMcp(file, registration), 'unchanged');
  assert.equal(statSync(file).mtimeMs, before);
  assert.deepEqual(JSON.parse(readFileSync(`${file}.aiterm-backup`, 'utf8')), original);
  assert.equal(removeClaudeParentHooks(file), 'unchanged');
});

test('設定未作成なら初期登録し、不正な設定は上書きしない', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aiterm-setup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'nested', 'mcp.json');
  mergeJsonMcp(file, registration);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { mcpServers: { aiterm: registration } });
  for (const invalid of ['{invalid', '[]', '{"mcpServers":[]}']) {
    writeFileSync(file, invalid);
    assert.throws(() => mergeJsonMcp(file, registration), /設定|JSON/);
    assert.equal(readFileSync(file, 'utf8'), invalid);
  }
});

test('WindowsのCLI引数はPowerShellのliteralとして渡す', () => {
  const argv = powershellInvocation("C:\\Users\\O'Neil & Team\\grok.cmd", ['mcp', 'add', 'aiterm', '--', 'C:\\Program Files\\nodejs\\node.exe', "C:\\O'Neil\\index.js"]);
  assert.deepEqual(argv.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
  const script = Buffer.from(argv[4], 'base64').toString('utf16le');
  assert.ok(script.startsWith("& 'C:\\Users\\O''Neil & Team\\grok.cmd' 'mcp' 'add' 'aiterm' '--'"));
  assert.ok(script.includes("'C:\\O''Neil\\index.js'"));
  assert.ok(script.includes('exit $LASTEXITCODE'));
});

test('4 clientの登録と公開CLIの読戻しを同じ意図で実行する', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aiterm-clients-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const prior = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = join(dir, '.claude');
  t.after(() => { if (prior === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prior; });
  const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    if (args[0] === '--version') return '2.1.259 (Claude Code)';
    if (args[0] === 'queue') return '--thread <ID> --message <TEXT>';
    if (args[1] === 'get') return JSON.stringify({ transport: { type: 'stdio', ...registration } });
    if (args[1] === 'list') return JSON.stringify([{ name: 'aiterm', ...registration }]);
    return '';
  };
  const result = configureIntegrations(dir, registration, run, client => client);
  assert.deepEqual(Object.values(result).map(item => item.status), ['ready', 'ready', 'ready', 'ready']);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.cursor', 'mcp.json'), 'utf8')).mcpServers.aiterm, registration);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.claude', '.claude.json'), 'utf8')).mcpServers.aiterm, { type: 'stdio', ...registration });
  assert.deepEqual(calls, [
    ['claude', ['--version']],
    ['codex', ['queue', '--help']],
    ['codex', ['mcp', 'list', '--json']],
    ['codex', ['mcp', 'add', 'aiterm', '--', registration.command, ...registration.args]],
    ['codex', ['mcp', 'get', 'aiterm', '--json']],
    ['grok', ['mcp', 'list', '--json']],
    ['grok', ['mcp', 'add', '--scope', 'user', 'aiterm', '--', registration.command, ...registration.args]],
    ['grok', ['mcp', 'list', '--json']],
  ]);
});

test('Claudeの親配送hookは他のhookと設定を保持し、再実行で増殖しない', t => {
  const dir = mkdtempSync(join(tmpdir(), 'aiterm-hooks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'settings.json');
  const other = { matcher: 'Bash', hooks: [{ type: 'command', command: 'other-hook' }] };
  const original = { theme: 'dark', hooks: { PreToolUse: [other], Stop: [other] } };
  writeFileSync(file, JSON.stringify(original));
  assert.equal(mergeClaudeParentHooks(file, registration), 'configured');
  const value = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(value.theme, 'dark');
  assert.deepEqual(value.hooks.Stop, [other]);
  assert.deepEqual(value.hooks.PreToolUse[0], other);
  assert.equal(value.hooks.PostToolUse[0].hooks[0].asyncRewake, true);
  assert.deepEqual(value.hooks.PostToolUse[0].hooks[0].args, [join('/opt/aiterm/dist', 'claude-parent-hook.js')]);
  const before = statSync(file).mtimeMs;
  assert.equal(mergeClaudeParentHooks(file, registration), 'unchanged');
  assert.equal(statSync(file).mtimeMs, before);
  assert.deepEqual(JSON.parse(readFileSync(`${file}.aiterm-backup`, 'utf8')), original);
  assert.equal(removeClaudeParentHooks(file), 'removed');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).hooks.PreToolUse, [other]);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).hooks.Stop, [other]);
  assert.equal(removeClaudeParentHooks(file), 'unchanged');
});

test('無効なhook設定や明示無効化をsetupで勝手に修復しない', t => {
  const dir = mkdtempSync(join(tmpdir(), 'aiterm-hooks-invalid-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'settings.json');
  for (const value of ['{broken', '[]', '{"hooks":[]}', '{"hooks":{"PreToolUse":{}}}', '{"disableAllHooks":true}']) {
    writeFileSync(file, value);
    assert.throws(() => mergeClaudeParentHooks(file, registration), /hook|hooks/);
    assert.equal(readFileSync(file, 'utf8'), value);
  }
});

test('Codexの受信キューがない場合は登録前に更新が必要と返す', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aiterm-old-codex-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const response of [() => '', () => { throw new Error('unknown command'); }]) {
    const calls = [];
    const result = configureIntegrations(dir, registration, (_command, args) => {
      calls.push(args);
      return response();
    }, client => client === 'codex' ? 'codex' : null);
    assert.deepEqual(result.codex, { status: 'failed', reason_code: 'codex_parent_delivery_unavailable' });
    assert.deepEqual(calls, [['queue', '--help']]);
  }
});
