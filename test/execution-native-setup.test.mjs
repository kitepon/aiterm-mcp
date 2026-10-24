import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as steer from 'aiterm-steer-delivery';
import { configureNativeExecutionHooks } from '../dist/execution-native-setup.js';
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
test('native hook migration preserves other hooks and returns standard parent hooks and MCP registration', { skip: process.platform === 'win32' ? 'POSIX native hook entry' : false }, async t => {
  const f = fixture(t); mkdirSync(join(f.home,'.claude')); mkdirSync(join(f.home,'.cursor'));
  const foreign = { matcher: 'independent', hooks: [{ type: 'command', command: 'other-owner-command' }] };
  writeFileSync(join(f.home,'.claude','settings.json'), JSON.stringify({ hooks: { PreToolUse: [foreign] }, unrelated: true }));
  writeFileSync(join(f.home,'.cursor','hooks.json'), JSON.stringify({ hooks: { afterMCPExecution: [{ command: 'other-cursor-command' }] }, version: 1 }));
  const before = structuredClone(f.registration), result = await configureNativeExecutionHooks(f.home,f.options);
  const claude = JSON.parse(readFileSync(join(f.home,'.claude','settings.json'))), cursor = JSON.parse(readFileSync(join(f.home,'.cursor','hooks.json')));
  assert.deepEqual(claude.hooks.PreToolUse[0], foreign); assert.equal(claude.unrelated,true);
  assert.equal(cursor.hooks.afterMCPExecution[0].command,'other-cursor-command');
  for (const client of ['claude','cursor','codex']) {
    assert.ok(result.commands[client].includes(client+'-parent-hook.js'));
    assert.ok(!result.commands[client].includes('--execution-interrupt'));
    assert.ok(!result.commands[client].includes('--steer-provider'));
  }
  assert.ok(claude.hooks.PreToolUse[1].hooks[0].command.includes('claude-parent-hook.js'));
  assert.ok(cursor.hooks.afterMCPExecution[1].command.includes('cursor-parent-hook.js'));
  assert.equal(f.codexCalls.length,1); assert.equal(f.codexCalls[0].command,result.commands.codex);
  assert.deepEqual(f.registration,before); assert.deepEqual(result.registration,{command:before.command,args:[join(f.home,'dist with spaces','index.js')]});
  assert.equal(result.relation_scope,'untracked');
});
test('native setup is idempotent and replaces owned legacy hook entries without duplicating or deleting foreign entries', { skip: process.platform === 'win32' ? 'POSIX native hook entry' : false }, async t => {
  const f=fixture(t); f.options.clients=['claude','cursor'];
  await configureNativeExecutionHooks(f.home,f.options);
  const paths=[join(f.home,'.claude','settings.json'),join(f.home,'.cursor','hooks.json')], before=paths.map(file=>readFileSync(file,'utf8'));
  const again=await configureNativeExecutionHooks(f.home,f.options);
  assert.equal(again.results.claude,'unchanged'); assert.equal(again.results.cursor,'unchanged'); assert.deepEqual(paths.map(file=>readFileSync(file,'utf8')),before);
});
test('malformed legacy registration refuses before any home config changes', async t => {
  for (const mode of ['scope','provider','entry','lazy']) {
    const f=fixture(t);
    if(mode==='scope')f.options.expectedScope.state_root += '-different';
    if(mode==='provider')f.options.providerFile += '-different';
    if(mode==='entry')f.options.registration.args[0]=join(f.home,'dist','index.js');
    if(mode==='lazy')f.options.registration.args.unshift('mcp-lazy.js');
    await assert.rejects(configureNativeExecutionHooks(f.home,f.options)); assert.equal(existsSync(join(f.home,'.claude')),false); assert.equal(f.codexCalls.length,0);
  }
});

test('standard hook migration does not require the retired native admission capability', { skip: process.platform === 'win32' }, async t => {
  const f=fixture(t); f.options.clients=['claude','cursor'];
  f.options.provider={...f.provider,DELIVERY_ADMISSION_CONTRACT:{}};
  const result=await configureNativeExecutionHooks(f.home,f.options);
  assert.equal(result.relation_scope,'untracked');
});

test('Windows native hook registration refuses without creating home configuration', { skip: process.platform !== 'win32' }, async t => {
  const f=fixture(t);
  await assert.rejects(configureNativeExecutionHooks(f.home,f.options), error => error.code === 'EXECUTION_INVALID');
  assert.equal(existsSync(join(f.home,'.claude')),false);assert.equal(existsSync(join(f.home,'.cursor')),false);
  assert.equal(f.codexCalls.length,0);
});
