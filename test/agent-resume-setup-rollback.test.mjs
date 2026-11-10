import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {core,readAgentMeta,writeAgentMeta,skip} from './core-agent-support.mjs';
import {agentMetadataPath} from '../dist/agent-shared.js';
import {readAgentLifecycle,readAgentResumeAttempt} from '../dist/agent-lifecycle.js';
import {SOCK,SOCKDIR,resolveTmux} from '../dist/tmux-runtime.js';

test('managed resume removes a native whose synchronous log setup fails while retaining the old conversation',
 {skip,timeout:15000},async t=>{
  const name='resume_setup_rollback';
  core.openSession('resume_setup_anchor');
  core.openAgent('claude',{session_name:name,agent_done:true,cwd:process.env.HOME,
    model:'claude-sonnet-4-5',reasoning_effort:'high'});
  t.after(()=>core.closeSession('resume_setup_anchor'));
  const previous=readAgentMeta(name);
  previous.vendor_session_id='11111111-2222-4333-8444-555555555555';
  writeAgentMeta(name,previous);
  const oldFile=agentMetadataPath(name,previous.launch_id);
  const oldBody=fs.readFileSync(oldFile,'utf8');
  assert.equal(spawnSync(resolveTmux(),['-S',SOCK,'kill-session','-t',name],{encoding:'utf8'}).status,0);

  const write=fs.writeFileSync,log=path.join(SOCKDIR,`${name}.log`);
  let injected=false;
  t.mock.method(fs,'writeFileSync',function(file,...args){
    if(String(file)===log){injected=true;throw Object.assign(new Error('fixture resumed log write denied'),{code:'EACCES'});}
    return write(file,...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(core.openAgentWithInitialPrompt('claude',
      {session_name:name,require_existing_resume:true}),/AGENT_RESUME_FAILED/);
  }finally{t.mock.restoreAll();syncBuiltinESMExports();}
  assert.equal(injected,true,'the resumed native reached its log setup');
  assert.equal(spawnSync(resolveTmux(),['-S',SOCK,'has-session','-t',name],{encoding:'utf8'}).status,1);
  assert.equal(fs.readFileSync(oldFile,'utf8'),oldBody);
  assert.equal(JSON.parse(fs.readFileSync(oldFile,'utf8')).vendor_session_id,previous.vendor_session_id);
  assert.equal(readAgentLifecycle(previous).state,'hibernated');
  const attempt=readAgentResumeAttempt(previous);
  assert.equal(attempt.state,'failed');
  const failure=JSON.parse(fs.readFileSync(agentMetadataPath(name,attempt.next_launch_id)
    .replace(/\.agent\.json$/,'.resume-failure.json'),'utf8'));
  assert.equal(failure.phase,'native_identity');
  assert.equal(failure.attempt_record,'failed');
});
