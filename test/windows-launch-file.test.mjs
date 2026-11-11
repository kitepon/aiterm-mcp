import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../dist/core.js';
import { windowsAgentArgv, windowsAgentLaunchLine, windowsLaunchIndirection } from '../dist/agent-resolver.js';
import os from 'node:os';
import path from 'node:path';
import { agentMetadataPath } from '../dist/agent-shared.js';

test('Windows launch types one short reader line; the file holds the unchanged full command', () => {
  const session = 'launch_file_unit', launch_id = 'b'.repeat(32);
  const file = agentMetadataPath(session, launch_id) + '.launch.ps1';
  const full = windowsAgentLaunchLine('C:\\work dir', [['SECRET_ENV', "tok'en"], ['UNSET_ME', null]],
    ['claude.exe', '--append-system-prompt', "sub-agent\ninstruction 'quoted' " + 'x'.repeat(4000)],
    { file: agentMetadataPath(session, launch_id) + '.launch-exited', launch_id });
  assert.ok(full.length > 4000);
  try {
    const typed = core.windowsLaunchTyped(session, launch_id, full);
    assert.ok(typed.length < 400, `typed ${typed.length}`);
    assert.equal(typed, windowsLaunchIndirection(file));
    assert.ok(typed.includes(`[IO.File]::ReadAllText('${file}')`) && typed.includes(`Remove-Item -LiteralPath '${file}'`) && typed.endsWith('Invoke-Expression $aitermLaunch'));
    assert.ok(!typed.includes('SECRET_ENV') && !typed.includes('tok'), 'env values stay out of the typed line');
    assert.equal(fs.readFileSync(file, 'utf8'), full);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally { fs.rmSync(file, { force: true }); }
  assert.equal(windowsLaunchIndirection("C:\\a'b\\x.ps1"), "$aitermLaunch=[IO.File]::ReadAllText('C:\\a''b\\x.ps1'); Remove-Item -LiteralPath 'C:\\a''b\\x.ps1'; Invoke-Expression $aitermLaunch");
});

test('an npm .cmd shim runs its .exe directly, so cmd.exe cannot cut a multi-line argument', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-shim-'));
  try {
    const exe = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, '');
    const shim = path.join(dir, 'claude.cmd');
    fs.writeFileSync(shim, '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n');
    const argv = [shim, '--append-system-prompt', 'a\nb', '--model', 'opus'];
    assert.deepEqual(windowsAgentArgv(argv, () => 'bash'), [exe, ...argv.slice(1)]);
    fs.rmSync(exe);
    assert.deepEqual(windowsAgentArgv(argv, () => 'bash'), argv, 'missing target: the shim stays');
    const other = path.join(dir, 'cursor-agent.cmd');
    fs.writeFileSync(other, '@echo off\r\npowershell.exe -File "%SCRIPT_DIR%\\cursor-agent.ps1" %*\r\n');
    assert.deepEqual(windowsAgentArgv([other, 'x'], () => 'bash'), [other, 'x']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
