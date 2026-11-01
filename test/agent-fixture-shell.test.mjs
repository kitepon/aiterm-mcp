import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFixtureShellReady, waitAgentFixtureShell } from './agent-fixture-shell.mjs';
const marker='<<<AITERM_FAKE_ARGV_DONE>>>';

test('fixture input waits for the argv printer and its child shell prompt', () => {
  assert.equal(agentFixtureShellReady(`PS C:\\repo> encoded-launch-command`,marker),false);
  assert.equal(agentFixtureShellReady(`${marker}\nstarting child shell`,marker),false);
  assert.equal(agentFixtureShellReady('PS C:\\repo> ',marker),false);
  assert.equal(agentFixtureShellReady(`${marker}\r\nPS C:\\repo> `,marker),true);
});

test('fixture readiness rejects a marker echoed inside a shell command', () => {
  assert.equal(agentFixtureShellReady(`echo '${marker}'\nPS C:\\repo> `,marker),false);
});


test('renderer ownership consumes the original read budget before control input',async()=>{
  const screens=['PS C:\\repo> encoded-launch',marker+'\nstarting renderer',marker+'\nPS C:\\repo> '];
  let reads=0;
  const result=await waitAgentFixtureShell(async()=>screens[reads++],marker);
  assert.equal(reads,3);assert.equal(result.ready,true);
  assert(result.timeout>0&&result.timeout<5,'ownership waits are deducted from the existing five seconds');
});

test('a ready screen returned after the original budget cannot admit control input',async()=>{
  const result=await waitAgentFixtureShell(async()=>{
    await new Promise(resolve=>setTimeout(resolve,5050));
    return marker+'\nPS C:\\repo> ';
  },marker);
  assert.deepEqual(result,{ready:false,timeout:0});
});
