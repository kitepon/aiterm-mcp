import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureIntegrations, mergeJsonMcp, powershellInvocation } from '../dist/setup-integrations.js';

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
    if (args[1] === 'get') return JSON.stringify({ transport: { type: 'stdio', ...registration } });
    if (args[1] === 'list') return JSON.stringify([{ name: 'aiterm', ...registration }]);
    return '';
  };
  const result = configureIntegrations(dir, registration, run, client => client);
  assert.deepEqual(Object.values(result).map(item => item.status), ['ready', 'ready', 'ready', 'ready']);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.cursor', 'mcp.json'), 'utf8')).mcpServers.aiterm, registration);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.claude', '.claude.json'), 'utf8')).mcpServers.aiterm, { type: 'stdio', ...registration });
  assert.deepEqual(calls, [
    ['codex', ['mcp', 'list', '--json']],
    ['codex', ['mcp', 'add', 'aiterm', '--', registration.command, ...registration.args]],
    ['codex', ['mcp', 'get', 'aiterm', '--json']],
    ['grok', ['mcp', 'list', '--json']],
    ['grok', ['mcp', 'add', '--scope', 'user', 'aiterm', '--', registration.command, ...registration.args]],
    ['grok', ['mcp', 'list', '--json']],
  ]);
});
