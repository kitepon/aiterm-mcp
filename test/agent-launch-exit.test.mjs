import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as core from '../dist/core.js';
import { agentMetadataPath, agentEventPath } from '../dist/agent-shared.js';
import { windowsAgentLaunchLine } from '../dist/agent-resolver.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(session) {
  const launch_id = randomBytes(16).toString('hex');
  const meta = { kind: 'codex', aiterm_session: session, launch_id, event_file: agentEventPath(session, launch_id),
    created_at: new Date().toISOString(), cwd: null, vendor_session_id: null, initial_prompt: 'none',
    hook_route: 'shared_codex_home', completion_route: 'codex_transcript', codex_home: process.env.CODEX_HOME,
    agent_role: 'subagent', parent_session_id: 'host-root', delegation_depth: 1,
    lineage: `host-root>codex:${session}`, delegation_allowed: true, node_platform: process.platform,
    windows_launch_exit_tracked: true };
  return { meta, file: agentMetadataPath(session, launch_id) + '.launch-exited' };
}

test('Windows native absence stays unknown until the same launcher returns', () => {
  const {meta, file} = fixture('launch_exit_proof');
  try {
    assert.equal(core.absentHarnessAlive(meta, 'win32'), null, 'launch input acknowledgement is not process exit');
    fs.writeFileSync(file, 'f'.repeat(32));
    assert.equal(core.absentHarnessAlive(meta, 'win32'), null, 'another launch cannot prove exit');
    fs.writeFileSync(file, meta.launch_id.slice(0, 12));
    assert.equal(core.absentHarnessAlive(meta, 'win32'), null, 'a partial write remains unknown');
    fs.writeFileSync(file, meta.launch_id);
    assert.equal(core.absentHarnessAlive(meta, 'win32'), false);
    assert.equal(core.absentHarnessAlive({...meta, windows_launch_exit_tracked: undefined}, 'win32'), false, 'legacy Claude/Codex behavior is preserved');
    assert.equal(core.absentHarnessAlive({...meta, kind: 'cursor', windows_launch_exit_tracked: undefined}, 'win32'), null);
    assert.equal(core.absentHarnessAlive(meta, 'linux'), false, 'POSIX liveness does not require a Windows witness');
  } finally { fs.rmSync(file, {force:true}); }
});

test('owned Windows launch distinguishes pre-spawn, live CLI, and returned CLI without resending', {skip:process.platform !== 'win32'}, async () => {
  const [session] = core.openSession('launch_exit_native', 'pwsh');
  const {meta,file} = fixture(session);
  const script = path.join(process.env.TMPDIR, "launch-exit-fixture.mjs");
  const ledger = path.join(process.env.TMPDIR, 'launch-exit-input');
  const release = path.join(process.env.TMPDIR, 'launch-exit-release');
  fs.writeFileSync(script, `import fs from 'node:fs';
process.stdout.write('OpenAI Codex\\n› Ask Codex to do anything\\n  mock-model high · /synthetic\\n');
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdin.on('data',b=>fs.appendFileSync(${JSON.stringify(ledger)},b));
setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))process.exit(0)},25);
`);
  meta.agent_executable = script;
  fs.writeFileSync(meta.event_file, '');
  fs.writeFileSync(agentMetadataPath(session,meta.launch_id),JSON.stringify(meta));
  let launching;
  try {
    assert.equal(core.observeSession(session).harness_alive, null);
    assert.equal(core.observeSession(session).reason, 'harness_start_unconfirmed');
    const pending = core.sendAgentMessage(session, 'START_BOUNDARY_BODY');
    const launch = new Promise((resolve,reject) => { launching = setImmediate(() => {
      try { resolve(core.send(session,
        windowsAgentLaunchLine(null, [], [process.execPath, script, meta.launch_id], {file,launch_id:meta.launch_id}),
        {raw:true,force:true,launchShell:'pwsh',preserveAgentOperation:true})); }
      catch(error) { reject(error); }
    }); });
    const [receipt] = await Promise.all([pending,launch]);
    assert.equal(receipt.schema,'aiterm.agent-dispatch.v1');
    assert.equal(core.observeSession(session).harness_alive,true);
    assert.equal(fs.existsSync(file),false,'launcher has not returned while the CLI is alive');
    for(const deadline=Date.now()+5000;(!fs.existsSync(ledger)||!fs.readFileSync(ledger,'utf8').includes('START_BOUNDARY_BODY'))&&Date.now()<deadline;)await delay(25);
    assert.equal(fs.readFileSync(ledger,'utf8').split('START_BOUNDARY_BODY').length-1,1);
    fs.writeFileSync(release,'exit');
    for(const deadline=Date.now()+5000;!fs.existsSync(file)&&Date.now()<deadline;)await delay(25);
    assert.equal(fs.readFileSync(file,'utf8'),meta.launch_id);
    const ended=core.observeSession(session);
    assert.equal(ended.harness_alive,false);assert.equal(ended.reason,'harness_exited');
    const before=fs.readFileSync(ledger);
    await assert.rejects(core.sendAgentMessage(session,'NO_REPLAY'),/harness_exited/);
    assert.deepEqual(fs.readFileSync(ledger),before);
  } finally {
    if(launching)clearImmediate(launching);
    core.closeSession(session);
    assert.equal(fs.existsSync(file),false,'close removes only its launch exit evidence');
  }
});
