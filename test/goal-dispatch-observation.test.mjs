import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('goal resolve rejects stale metadata before sampling and still rejects a missing native seat', {skip:process.platform==='win32'}, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'goal-dispatch-'));
  const bin=path.join(root,'tmux'),calls=path.join(root,'calls');
  fs.writeFileSync(bin,`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
if(args.includes('-V'))console.log('tmux 3.6');
if(args.includes('display-message')&&fs.existsSync(${JSON.stringify(path.join(root,'live'))}))console.log([${process.pid},'0'].join(String.fromCharCode(9)));
if(args.includes('display-message')&&fs.existsSync(${JSON.stringify(path.join(root,'replace'))})){const file=fs.readFileSync(${JSON.stringify(path.join(root,'replace'))},'utf8');const meta=JSON.parse(fs.readFileSync(file,'utf8'));meta.launch_id='b'.repeat(32);fs.writeFileSync(file,JSON.stringify(meta));}
`,{mode:0o755});
  Object.assign(process.env,{HOME:root,TMPDIR:root,XDG_RUNTIME_DIR:root,AITERM_TMUX:bin});
  const {agentGoal}=await import('../dist/core.js');
  try {
    const r=await agentGoal({session_id:'missing-goal-fixture',launch_id:'a'.repeat(32),action:'inspect'});
    assert.equal(r.availability,'unavailable');
    assert.equal(r.mutation,'not_requested');
    assert.equal(r.reason,'binding_unavailable');
    assert.equal(fs.existsSync(calls),false);
    const {createCodexAgentMetadata}=await import('../dist/harnesses/codex.js');
    const meta=createCodexAgentMetadata('missing-goal-fixture',root,'none',{},undefined,{agentRole:'subagent',parentSessionId:'host-root',delegationDepth:1,lineage:'host-root>codex:fixture',delegationAllowed:true});
    const stale=await agentGoal({session_id:meta.aiterm_session,launch_id:'b'.repeat(32),action:'inspect'});
    assert.equal(stale.availability,'unavailable');
    assert.equal(fs.existsSync(calls),false);
    const absent=await agentGoal({session_id:meta.aiterm_session,launch_id:meta.launch_id,action:'inspect'});
    assert.equal(absent.availability,'unavailable');
    assert.equal(absent.mutation,'not_requested');
    const rows=fs.readFileSync(calls,'utf8').trim().split('\n').map(x=>JSON.parse(x));
    assert.equal(rows.filter(row=>row.includes('display-message')).length,2);
    assert.ok(rows.every(row=>row.includes('-V')||row.includes('display-message')));
    const {writeAgentMetadata}=await import('../dist/agent-shared.js');
    const {readRuntimeProcesses}=await import('../dist/process-runtime.js');
    const self=readRuntimeProcesses().find(row=>row.pid===process.pid);
    meta.agent_executable=self.command.split(/\s+/).find(token=>token.includes('goal-dispatch-observation.test.mjs'));
    assert.ok(meta.agent_executable);writeAgentMetadata(meta);
    fs.writeFileSync(path.join(root,'live'),'');fs.writeFileSync(calls,'');
    const live=await agentGoal({session_id:meta.aiterm_session,launch_id:meta.launch_id,action:'inspect'});
    assert.equal(live.reason,'thread_binding_unavailable');
    assert.equal(live.mutation,'not_requested');
    const native=fs.readFileSync(calls,'utf8').trim().split('\n').map(x=>JSON.parse(x));
    assert.equal(native.filter(row=>row.includes('display-message')).length,2);
    assert.ok(native.every(row=>row.includes('display-message')));
    assert.ok(native.every(row=>row.includes('='+meta.aiterm_session+':')));
    const {agentMetadataPath}=await import('../dist/agent-shared.js');
    fs.writeFileSync(path.join(root,'replace'),agentMetadataPath(meta.aiterm_session,meta.launch_id));
    const replaced=await agentGoal({session_id:meta.aiterm_session,launch_id:meta.launch_id,action:'inspect'});
    assert.equal(replaced.availability,'unavailable');
    assert.equal(replaced.reason,'binding_unavailable');
    assert.equal(replaced.mutation,'not_requested');

  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
