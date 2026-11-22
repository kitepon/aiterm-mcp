import './seat-env.mjs';
// lifecycle-state-ownership.md "中断したresumingの放棄" (a527): a resuming attempt whose process died is abandoned, and only then.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createCodexAgentMetadata} from '../dist/harnesses/codex.js';
import {agentMetadataPath,ensureStateRoot} from '../dist/agent-shared.js';
import {readAgentResumeAttempt,writeAgentResumeAttempt,writeAgentLifecycle,writeAgentResumeNative} from '../dist/agent-lifecycle.js';
import {settleInterruptedResume} from '../dist/core.js';
import {processStartIdentity} from '../dist/runtime-error-os.js';
import {SOCK} from '../dist/tmux-runtime.js';

const lineage={agentRole:'subagent',parentSessionId:'test-parent',delegationDepth:1,lineage:'test-parent>codex:x',delegationAllowed:true};
let count=0;
/** A hibernated seat whose resume died: attempt `resuming` at `ageMs` ago, next launch pinned to `pane` (null = never created). */
function dead({ageMs=10*60*1000,state='hibernated',pane={pid:2147483000,identity:'linux:1'}}={}){
 ensureStateRoot();
 const meta=createCodexAgentMetadata(`resume_abandoned_${process.pid}_${count++}`,process.env.HOME,'none',{},undefined,lineage);
 const at=new Date(Date.now()-ageMs).toISOString();
 const next='e'.repeat(32);
 const attempt={schema:'aiterm.agent-resume-attempt.v1',launch_id:meta.launch_id,next_launch_id:next,state:'resuming',at,recipe_digest:'a'.repeat(64)};
 writeAgentResumeAttempt(meta,attempt);
 writeAgentLifecycle(meta,{schema:'aiterm.agent-lifecycle.v1',launch_id:meta.launch_id,state,socket:SOCK,at,anchor:at,native_id:'$1',recipe_digest:attempt.recipe_digest,
  pane:{pid:1,process_group_id:null,started_identity:'fixture-only',argv_digest:'b'.repeat(64)}});
 if(pane)writeAgentResumeNative({aiterm_session:meta.aiterm_session,launch_id:next},{schema:'aiterm.agent-resume-native.v1',launch_id:next,native_id:'$142',session_id:meta.aiterm_session,
  server_pid:pane.pid,server_started_identity:pane.identity,pane_id:'%142',pane_pid:pane.pid,pane_started_identity:pane.identity});
 return {meta,attempt,abandoned:agentMetadataPath(meta.aiterm_session,meta.launch_id).replace(/\.agent\.json$/,'.resume-abandoned.json')};
}

test('an old resuming attempt with no native and a dead pinned pane is abandoned with its evidence; the seat is then a plain hibernated seat',()=>{
 const {meta,attempt,abandoned}=dead();
 assert.equal(settleInterruptedResume(meta),true);
 assert.equal(readAgentResumeAttempt(meta),null);
 const record=JSON.parse(fs.readFileSync(abandoned,'utf8'));
 assert.equal(record.schema,'aiterm.agent-resume-abandoned.v1');
 assert.deepEqual(record.attempt,attempt);
 assert.equal(record.evidence.next_pane,'pid 2147483000 not running');
 assert.equal(settleInterruptedResume(meta),false,'nothing left to settle');
});

test('a resume that never created its native (no pin) is abandoned too',()=>{
 const {meta,abandoned}=dead({pane:null});
 assert.equal(settleInterruptedResume(meta),true);
 assert.equal(JSON.parse(fs.readFileSync(abandoned,'utf8')).evidence.next_pane,'never created');
});

test('nothing is changed while any proof is missing',()=>{
 const young=dead({ageMs:30*1000});
 assert.equal(settleInterruptedResume(young.meta),false,'a resume that may still be running');
 assert.ok(readAgentResumeAttempt(young.meta));
 const alive=dead({pane:{pid:process.pid,identity:processStartIdentity(process.pid,process.platform)}});
 assert.equal(settleInterruptedResume(alive.meta),false,'the pinned pane is still a running process');
 assert.ok(readAgentResumeAttempt(alive.meta));
 const stopping=dead({state:'stopping'});
 assert.equal(settleInterruptedResume(stopping.meta),false,'only a hibernated old launch');
 const published=dead();
 // the generation pointer already names another launch: the next one was published
 fs.writeFileSync(path.join(path.dirname(published.abandoned),`${published.meta.aiterm_session}.active-launch.json`),
  JSON.stringify({schema:'aiterm.agent-generation.v1',launch_id:'d'.repeat(32),previous_launch_id:published.meta.launch_id}),{mode:0o600});
 assert.equal(settleInterruptedResume(published.meta),false,'the next launch was published');
 assert.ok(readAgentResumeAttempt(published.meta));
 assert.equal(fs.existsSync(published.abandoned),false);
});

test('pty_close of such a hibernated seat no longer answers AGENT_RESUME_UNCONFIRMED',async()=>{
 const {meta}=dead();
 const client=new Client({name:'resume-abandoned',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/index.js')],env:{...process.env},stderr:'pipe'});
 try{
  await client.connect(transport);
  const result=await client.callTool({name:'pty_close',arguments:{session_id:meta.aiterm_session}});
  assert.equal(result.isError??false,false,JSON.stringify(result.content));
 }finally{await client.close();}
});
