import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../dist/core.js';
import { windowsAgentLaunchLine, windowsLaunchIndirection } from '../dist/agent-resolver.js';
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
