import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {agentMetadataPath} from '../dist/agent-shared.js';
import {agentResumeFailureSchema,recordAgentResumeFailure,safeResumeFailureCause,safeResumeReadiness} from '../dist/agent-resume-diagnostic.js';
import {AitermError} from '../dist/errors.js';
import {ProcessProbeError} from '../dist/process-runtime.js';
import {ExecutionError} from '../dist/execution-wire.js';
import {createCodexAgentMetadata} from '../dist/harnesses/codex.js';
import {writeAgentLifecycle,writeAgentResumeAttempt,readAgentResumeAttempt} from '../dist/agent-lifecycle.js';
import {dispatchAgentTurn} from '../dist/core.js';
import {SOCK} from '../dist/tmux-runtime.js';

const previous='a'.repeat(32),next='b'.repeat(32);
const input={session_id:'diagnostic',launch_id:next,previous_launch_id:previous,next_launch_id:next,phase:'readiness',
 readiness:{status:'blocked',reason:'startup_dialog'},attempt_record:'failed',attempted_at:'2026-11-02T13:00:00.000Z'};
const file=()=>agentMetadataPath(input.session_id,input.launch_id).replace(/\.agent\.json$/,'.resume-failure.json');

test('failure records retain only bounded typed evidence and preserve the first saved record',()=>{
 recordAgentResumeFailure(input,new AitermError('SECRET prompt/path',2));
 const first=fs.readFileSync(file(),'utf8'),record=agentResumeFailureSchema.parse(JSON.parse(first));
 assert.equal(first.includes('SECRET'),false);assert.equal(record.native_outcome,'unknown');assert.equal(record.body_input,'not_sent');
 assert.deepEqual(record.cause,{kind:'aiterm',code:2,exit_code:null,signal:null});
 recordAgentResumeFailure({...input,phase:'ready_save'},new Error('second'));
 assert.equal(fs.readFileSync(file(),'utf8'),first);
 fs.writeFileSync(file(),'broken');recordAgentResumeFailure(input,new Error('third'));
 assert.equal(fs.readFileSync(file(),'utf8'),'broken');fs.unlinkSync(file());
});

test('invalid record input and failed persistence cannot escape or change the original exception',t=>{
 recordAgentResumeFailure({...input,extra:'SECRET'},new Error('SECRET'));
 assert.equal(fs.existsSync(file()),false);
 const original=Object.assign(new Error('original'),{code:'EACCES'});
 const mock=t.mock.method(fs,'writeFileSync',()=>{throw new Error('store refused');});
 syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
 assert.doesNotThrow(()=>recordAgentResumeFailure(input,original));assert.equal(original.message,'original');assert.equal(fs.existsSync(file()),false);
});

test('safe causes distinguish OS status from Aiterm CLI code and never parse error text',()=>{
 const probe=new ProcessProbeError('SECRET',{code:'ETIMEDOUT',status:3,signal:'SIGTERM'});
 assert.deepEqual(safeResumeFailureCause(probe),{kind:'process_probe',code:'ETIMEDOUT',exit_code:3,signal:'SIGTERM'});
 assert.deepEqual(safeResumeFailureCause(new ExecutionError('EXECUTION_BUSY')),{kind:'execution',code:'EXECUTION_BUSY',exit_code:null,signal:null});
 assert.equal(safeResumeFailureCause(Object.assign(new Error('SECRET'),{code:'EACCES'})).code,'EACCES');
 assert.equal(safeResumeFailureCause(Object.assign(new Error('SECRET'),{code:'SECRET'})).code,'UNKNOWN');
 assert.equal(safeResumeFailureCause(new Error('{"code":"ETIMEDOUT"}')).kind,'unknown');
 assert.equal(safeResumeFailureCause({code:'EACCES',message:'SECRET'}).kind,'unknown');
 assert.deepEqual(safeResumeFailureCause(new ProcessProbeError('SECRET',{code:'SECRET',status:NaN,signal:'SECRET'})),
  {kind:'process_probe',code:null,exit_code:null,signal:null});
});

test('readiness allows only fixed reasons; unknown text and thrown-before-result stay absent',()=>{
 assert.equal(safeResumeReadiness(null),null);
 assert.deepEqual(safeResumeReadiness({status:'blocked',reason:'SECRET'}),{status:'blocked',reason:'unknown'});
 assert.deepEqual(safeResumeReadiness({status:'ready',reason:'composer_ready'}),{status:'ready',reason:'composer_ready'});
 assert.equal(safeResumeReadiness({status:'not_checked',reason:'SECRET'}),null);
});

test('schema rejects swapped targets, extra fields and success-like native outcomes',()=>{
 const record={...input,schema:'aiterm.agent-resume-failure.v1',cause:safeResumeFailureCause(null),body_input:'not_sent',
  native_outcome:'unknown',observed_at:'2026-11-02T13:00:01.000Z'};
 assert.equal(agentResumeFailureSchema.safeParse(record).success,true);
 for(const patch of [{launch_id:previous},{previous_launch_id:next},{native_outcome:'confirmed'},{message:'SECRET'},
  {readiness:{status:'blocked',reason:'SECRET'}},{cause:{kind:'system',code:'ENOENT',exit_code:2,signal:null}}])
  assert.equal(agentResumeFailureSchema.safeParse({...record,...patch}).success,false);
});

for(const storeRefused of [false,true])test(`core preflight keeps its original refusal with diagnostic storage refused=${storeRefused}`,async t=>{
 const name='diagnostic_preflight_'+storeRefused;
 const meta=createCodexAgentMetadata(name,process.env.HOME,'none',{},undefined,
  {agentRole:'subagent',parentSessionId:'test-parent',delegationDepth:1,lineage:'test-parent>codex:'+name,delegationAllowed:true});
 writeAgentLifecycle(meta,{schema:'aiterm.agent-lifecycle.v1',launch_id:meta.launch_id,state:'hibernated',socket:SOCK,
  at:new Date().toISOString(),anchor:new Date().toISOString(),native_id:'$1',recipe_digest:'a'.repeat(64),
  pane:{pid:1,process_group_id:null,started_identity:'fixture',argv_digest:'b'.repeat(64)}});
 const path=agentMetadataPath(name,meta.launch_id).replace(/\.agent\.json$/,'.resume-failure.json');
 const original=fs.renameSync;
 if(storeRefused){const mock=t.mock.method(fs,'renameSync',(from,to)=>{if(to===path)throw new Error('diagnostic refused');return original(from,to);});
  syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});}
 await assert.rejects(dispatchAgentTurn(name,'SECRET'),error=>{
  assert.equal(error.code,2);assert.match(error.message,/保存した休止会話の再開情報/);assert.equal(error.resumeFailure,undefined);return true;
 });
 assert.equal(fs.existsSync(path),!storeRefused);assert.equal(readAgentResumeAttempt(meta),null);
 if(!storeRefused){const record=JSON.parse(fs.readFileSync(path,'utf8'));
  assert.equal(record.phase,'recipe_validation');assert.equal(record.next_launch_id,null);assert.equal(record.attempted_at,null);
  assert.equal(record.attempt_record,'not_created');assert.equal(record.readiness,null);assert(!JSON.stringify(record).includes('SECRET'));
 }
});

test('an existing failed attempt is refused without creating or replacing failure history',async()=>{
 const name='diagnostic_existing';
 const meta=createCodexAgentMetadata(name,process.env.HOME,'none',{},undefined,
  {agentRole:'subagent',parentSessionId:'test-parent',delegationDepth:1,lineage:'test-parent>codex:'+name,delegationAllowed:true});
 const attempt={schema:'aiterm.agent-resume-attempt.v1',launch_id:meta.launch_id,next_launch_id:'c'.repeat(32),
  state:'failed',at:new Date().toISOString(),recipe_digest:'d'.repeat(64)};
 writeAgentResumeAttempt(meta,attempt);
 writeAgentLifecycle(meta,{schema:'aiterm.agent-lifecycle.v1',launch_id:meta.launch_id,state:'hibernated',socket:SOCK,
  at:attempt.at,anchor:attempt.at,native_id:'$1',recipe_digest:attempt.recipe_digest,
  pane:{pid:1,process_group_id:null,started_identity:'fixture',argv_digest:'b'.repeat(64)}});
 const path=agentMetadataPath(name,meta.launch_id).replace(/\.agent\.json$/,'.resume-failure.json');
 await assert.rejects(dispatchAgentTurn(name,'SECRET'),error=>error.resumeFailure?.input==='not_sent');
 assert.equal(fs.existsSync(path),false);assert.deepEqual(readAgentResumeAttempt(meta),attempt);
});
