import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as steer from 'aiterm-steer-delivery';
import { nativeExecutionHarnessEntries } from '../dist/execution-native-setup.js';
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'native-setup-')); t.after(() => rmSync(home, { recursive: true, force: true }));
  const root = join(home, 'state', 'aiterm-mcp-' + (process.getuid?.() ?? 0)), socket = join(home, 'tmp', 'claude-tmux-sockets', 'claude.sock');
  const providerFile = join(home, 'candidate provider.js'), script = join(home, 'dist with spaces', 'execution-native-server.js');
  const scope = { state_root: root, multiplexer: { kind: 'socket', key: socket } };
  const registration = { command: process.execPath, args: [script, '--execution-interrupt', '--state-root', root, '--socket', socket, '--steer-provider', providerFile] };
  const codexCalls = [];
  const provider = { ...steer, async configureCodexSteer(profile, action, runtime) {
    codexCalls.push({ action, command: steer.codexHookCommand(runtime.node,runtime.hook,runtime.directory), root: profile.state_root(), runtime });
    return { status: 'ready' };
  } };
  return { home, root, socket, scope, providerFile, script, registration, provider, codexCalls,
    options: { registration, expectedScope: scope, providerFile, provider, codexBinary: join(home, 'fake codex') } };
}
// bd14 (setup-update.md "CLIのhookの項目を返す"): the printed entries are what Steer's writers put into an empty file, and printing writes no CLI file.
test('harness-entries prints the Steer writers\' hooks, and writes only its own codex config', { skip: process.platform === 'win32' ? 'POSIX native hook entry' : false }, async t => {
  const f = fixture(t), dist = new URL('../dist/', import.meta.url).pathname;
  const entries = await nativeExecutionHarnessEntries(f.home, { stateRoot: f.root, socket: f.socket, providerFile: f.providerFile,
    provider: f.provider, codexBinary: f.options.codexBinary });
  for (const dir of ['.claude', '.cursor', '.codex']) assert.equal(existsSync(join(f.home, dir)), false, `${dir} untouched`);
  const config = steer.codexHookConfigSchema({ codex_hook_schema: 'aiterm.codex-parent-hooks.v1' })
    .parse(JSON.parse(readFileSync(join(f.home, '.config', 'aiterm-mcp', 'codex-parent-hooks', 'config.json'), 'utf8')));
  assert.equal(config.enabled, true); assert.equal(config.binary, f.options.codexBinary); assert.deepEqual(config.stale_processes, []);
  assert.deepEqual([entries.schema, entries.product, entries.mcpServers, entries.settings], ['bellteam.harness-entries.v1', 'aiterm', {}, {}]);
  assert.deepEqual(entries.owns.commandIncludes, ['claude-parent-hook.js', 'cursor-parent-hook.js', 'codex-parent-hook.js', 'execution-native-server.js']);
  const scratch = mkdtempSync(join(tmpdir(), 'harness-plan-')); t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const node = config.node, { AITERM_PROFILE } = await import('../dist/steer-profile.js');
  const profile = { ...AITERM_PROFILE, state_root: () => f.root, config_root: () => join(f.home, '.config', 'aiterm-mcp') };
  steer.mergeClaudeParentHooks(profile, join(scratch, 'settings.json'), { command: node, script: join(dist, profile.hooks.claude) });
  steer.mergeCursorParentHooks(profile, join(scratch, 'cursor.json'), { command: node, script: join(dist, profile.hooks.cursor) });
  assert.deepEqual(entries.hooks.claude, JSON.parse(readFileSync(join(scratch, 'settings.json'), 'utf8')).hooks);
  assert.deepEqual(entries.hooks.cursor, JSON.parse(readFileSync(join(scratch, 'cursor.json'), 'utf8')).hooks);
  assert.equal(config.command, steer.codexHookCommand(node, join(dist, 'codex-parent-hook.js'), join(f.home, '.config', 'aiterm-mcp', 'codex-parent-hooks')));
  assert.deepEqual(entries.hooks.codex, steer.planCodexParentHooks(join(scratch, 'hooks.json'), config.command).next.hooks);
  for (const owned of Object.values(entries.hooks).flatMap(events => Object.values(events)).flat())
    assert.ok(JSON.stringify(owned).match(/(claude|cursor|codex)-parent-hook\.js/), JSON.stringify(owned));
});

test('harness-entries refuses a missing codex binary or an unknown client, writing nothing', { skip: process.platform === 'win32' ? 'POSIX native hook entry' : false }, async t => {
  const f = fixture(t);
  await assert.rejects(nativeExecutionHarnessEntries(f.home, { stateRoot: f.root, socket: f.socket, providerFile: f.providerFile, provider: f.provider }), /EXECUTION_INVALID/);
  await assert.rejects(nativeExecutionHarnessEntries(f.home, { stateRoot: f.root, socket: f.socket, providerFile: f.providerFile, provider: f.provider, clients: ['grok'] }), /EXECUTION_INVALID/);
  assert.equal(existsSync(join(f.home, '.config')), false);
});
