import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import * as core from '../dist/core.js';
import {agentMetadataPath,agentEventPath,writeAgentMetadata,ensureStateRoot,publishAgentGeneration} from '../dist/agent-shared.js';
import {readAgentLifecycle,writeAgentLifecycle,writeAgentResumeAttempt,writeAgentResumeRecipe,readAgentIdleClock,writeAgentIdleClock,retireAgentIdleClock} from '../dist/agent-lifecycle.js';
import {requireExecutionEffectScope,withExecutionEffectScope} from '../dist/execution-effect.js';
import {readProcessIdentities} from '../dist/process-runtime.js';
import {readAgentActivity} from '../dist/agent-activity.js';
import {deliveryOwnerPrefix} from '../dist/parent-delivery-owners.js';
import {SOCK,resolveTmux} from '../dist/tmux-runtime.js';

const skip=process.platform==='win32'?'POSIX tmux fixture':false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let serial=0;
async function fixture(t,{recipe=true,resumeEnv=false,resumeBlocked=false}={}){
 const tag='idle-core-'+ ++serial,bin=join(process.env.HOME,tag+'-codex.sh'),driver=join(process.env.HOME,tag+'-driver.mjs');
 const keys=join(process.env.HOME,tag+'-input'),spawnFlag=join(process.env.HOME,tag+'-spawn'),spawned=join(process.env.HOME,tag+'-spawned');
 fs.mkdirSync(process.env.CODEX_HOME,{recursive:true});
 fs.writeFileSync(bin,`#!/bin/sh\n'${process.execPath.replaceAll("'","'\\''")}' '${driver}' "$@"\n`,{mode:0o700});
 fs.writeFileSync(driver,`import fs from 'node:fs';import {spawn} from 'node:child_process';
let line='',added=false;
fs.appendFileSync(${JSON.stringify(keys+'-launches')},JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),room:process.env.PEERTABLE_ROOM??null,member:process.env.PEERTABLE_MEMBER??null,unset:process.env.AITERM_TEST_UNSET??null})+'\\n');
${resumeBlocked?'if(process.argv.includes("resume"))process.exit(0);':''}
const draw=()=>process.stdout.write(${resumeBlocked?'process.argv.includes("resume") ? "\\x1b[H\\x1b[2Junknown blocked view" : ':''}'\\x1b[H\\x1b[2JOpenAI Codex\\n› '+line+'\\x1b[K\\n  mock-model default · /tmp/proj\\x1b[K\\n\\x1b[J');
process.stdin.setRawMode(true);process.stdin.resume();draw();
process.stdin.on('data',bytes=>{for(const ch of bytes.toString().replace(/\\x1b\\[20[01]~/g,'')){
 if(ch==='\\r'){fs.appendFileSync(${JSON.stringify(keys)},line+'\\n');line='';}else if(ch>=' '){line+=ch;}}
 fs.writeFileSync(${JSON.stringify(keys+'-draft')},line);draw();});
setInterval(()=>{if(!added&&fs.existsSync(${JSON.stringify(spawnFlag)})){
 added=true;const child=spawn(process.execPath,['-e','setInterval(()=>{},60000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(spawned)},String(child.pid));
}},10);`);
 process.env.CODEX_BIN=bin;core.__testSetAgentTuiReadyStableSamples(1);
 t.after(()=>{core.__testSetAgentTuiReadyStableSamples(null);core.killAll();});
 if(resumeEnv){process.env.PEERTABLE_ROOM="saved room ' $() ; #{pane_id} \\ literal";process.env.PEERTABLE_MEMBER=';';delete process.env.AITERM_TEST_UNSET;}
 const [name]=core.openAgent('codex',{session_name:tag,agent_done:true,cwd:process.env.HOME,
  ...(resumeEnv?{env_vars:['PEERTABLE_ROOM','PEERTABLE_MEMBER','AITERM_TEST_UNSET']} : {}),...(recipe?{model:'fixture-model',reasoning_effort:'high'}:{})});
 let live;
 for(const until=Date.now()+5000;Date.now()<until;await sleep(40)){
  live=core.observeSession(name);if(live.state==='idle'&&live.harness_alive===true)break;
 }
 assert.equal(live.state,'idle',JSON.stringify(live));assert.equal(live.harness_alive,true);
 const meta=JSON.parse(fs.readFileSync(agentMetadataPath(name,live.launch_id),'utf8'));
 const ended=new Date(Date.now()-3600000).toISOString();
 meta.created_at=ended;meta.vendor_session_id='11111111-2222-4333-8444-'+String(serial).padStart(12,'0');
 meta.startup_processes=Object.keys(JSON.parse(Buffer.from(live.activity.cursor,'base64url').toString()).processes);
 writeAgentMetadata(meta);
 const directory=join(process.env.CODEX_HOME,'sessions');fs.mkdirSync(directory,{recursive:true});
 const rollout=join(directory,`rollout-${meta.vendor_session_id}.jsonl`);
 const event=(type,extra={})=>({timestamp:ended,type:'event_msg',payload:{type,turn_id:tag,...extra}});
 fs.writeFileSync(rollout,[{type:'session_meta',payload:{id:meta.vendor_session_id,originator:'codex-tui',source:'cli'}},
  {type:'response_item',payload:{type:'message',role:'developer',content:[{type:'input_text',text:`AITERM_AGENT_LAUNCH_ID=${meta.launch_id}`}]}},
  {type:'turn_context',payload:{model:meta.model,effort:'high'}},event('task_started'),event('task_complete',{last_agent_message:'Done'})].map(JSON.stringify).join('\n')+'\n');
 if(recipe)writeAgentResumeRecipe(meta,{schema:'aiterm.agent-resume.v1',launch_id:meta.launch_id,kind:'codex',
  vendor_session_id:meta.vendor_session_id,executable:bin,cwd:process.env.HOME,configuration_root:process.env.CODEX_HOME,model:meta.model,reasoning_effort:'high',
  fast:meta.fast,environment:{PEERTABLE_ROOM:'artificial',PEERTABLE_MEMBER:'fixture'}});
 const expected={session_id:name,launch_id:meta.launch_id};
 return {name,meta,expected,keys,spawnFlag,spawned,rollout,
  lifecycle:agentMetadataPath(name,meta.launch_id).replace(/\.agent\.json$/,'.lifecycle.json')};
}

test('ordinary core hibernates only the expected idle pane, retaining its resume data', {skip,timeout:30000},async t=>{
 const f=await fixture(t,{resumeEnv:true});const [bridge]=core.openSession('ordinary-bridge');
 assert.equal(core.observeSession(f.name).activity.post_startup_process_count,0);
 const result=await core.checkAgentIdle(f.expected);
 assert.equal(result.outcome,'hibernated',JSON.stringify(result));
 const lifecycle=readAgentLifecycle(f.meta);assert.equal(lifecycle.state,'hibernated');
 assert.equal(lifecycle.launch_id,f.meta.launch_id);assert.match(lifecycle.native_id,/^\$\d+$/);
 assert.equal(fs.existsSync(agentMetadataPath(f.name,f.meta.launch_id)),true);
 const observed=core.observeSession(f.name,Buffer.from(JSON.stringify({session_id:f.name,pane_identity:'old-pane',screen_digest:'old',processes:{},background_processes:{}})).toString('base64url'));
 assert.equal(observed.exists,true);assert.equal(observed.state,'hibernated');assert.equal(observed.reason,'idle_timeout');
 assert.equal(observed.launch_id,f.meta.launch_id);assert.equal(observed.harness,'codex-cli');
 assert.equal(observed.pane_alive,false);assert.equal(observed.harness_alive,false);
 for(const key of ['pane_process','harness_process','process_identity','token_hint'])assert.equal(observed[key],null);
 assert.equal(observed.pending_child_deliveries,0);assert.equal(observed.activity.post_startup_process_count,0);
 assert.equal(observed.activity.cpu_seconds,0);assert.equal(observed.activity.background_cpu_seconds,0);
 for(const key of ['cursor','output_changed','cpu_delta_seconds','cpu_delta_complete','background_cpu_delta_seconds','background_cpu_delta_complete'])assert.equal(observed.activity[key],null);
 const listed=core.listSessionsResult(['PEERTABLE_ROOM','PEERTABLE_MEMBER','UNREGISTERED_NAME']).sessions.find(row=>row.session_id===f.name);
 assert.equal(listed.harness,'codex-cli');assert.equal(listed.vendor_session_id,f.meta.vendor_session_id);
 assert.deepEqual(listed.environment,{PEERTABLE_ROOM:"saved room ' $() ; #{pane_id} \\ literal",PEERTABLE_MEMBER:';',UNREGISTERED_NAME:null});
 assert.deepEqual(core.readSeatTurns([f.name]).seats[0].turn,{state:'idle'});
 assert.equal(core.observeSessionGeneration(f.name).exists,true);
 assert.equal(core.observeSession(bridge).exists,true);
 assert.equal((await core.checkAgentIdle(f.expected)).outcome,'skipped');
 assert.equal(readAgentLifecycle(f.meta).state,'hibernated');
 core.closeSession(f.name);assert.equal(readAgentLifecycle(f.meta),null);
 assert.equal(fs.existsSync(agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume.json')),false);
});

for(const state of ['stopping','resuming','failed','recipe-changed','native-replaced'])test(`public dormant state does not claim confirmed hibernation for ${state}`,{skip,timeout:15000},async t=>{
 const f=await fixture(t);assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 const saved=readAgentLifecycle(f.meta);
 if(state==='stopping')writeAgentLifecycle(f.meta,{...saved,state:'stopping'});
 if(state==='resuming'||state==='failed')writeAgentResumeAttempt(f.meta,{schema:'aiterm.agent-resume-attempt.v1',launch_id:f.meta.launch_id,
  next_launch_id:'e'.repeat(32),recipe_digest:saved.recipe_digest,state,at:new Date().toISOString()});
 if(state==='recipe-changed')writeAgentMetadata({...f.meta,model:'later-model'});
 if(state==='native-replaced'){
  const raw=spawnSync(resolveTmux(),['-S',SOCK,'new-session','-d','-s',f.name,'bash'],{encoding:'utf8'});assert.equal(raw.status,0);
 }
 const seen=core.observeSession(f.name);assert.equal(seen.exists,true);assert.equal(seen.state,'unknown');
 assert.equal(seen.launch_id,f.meta.launch_id);assert.equal(seen.activity.post_startup_process_count,null);
 assert.ok(core.listSessionsResult().sessions.some(row=>row.session_id===f.name));
 assert.equal(core.readSeatTurns([f.name]).seats[0].turn,null);
 if(state==='native-replaced'){
  assert.throws(()=>core.closeSessionResult(f.name),/AGENT_RESUME_UNCONFIRMED/);
  assert.equal(spawnSync(resolveTmux(),['-S',SOCK,'has-session','-t',f.name]).status,0);
 }
});

test('logical listings do not enroll a hibernation record belonging to another socket',{skip,timeout:15000},async t=>{
 const f=await fixture(t);assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 writeAgentLifecycle(f.meta,{...readAgentLifecycle(f.meta),socket:SOCK+'-other'});
 assert.equal(core.listSessionsResult().sessions.some(row=>row.session_id===f.name),false);
 assert.equal(core.observeSession(f.name).exists,false);
 await assert.rejects(core.sendAgentMessage(f.name,'never-body',{raw:true}),/AGENT_RESUME_UNCONFIRMED/);
 assert.throws(()=>core.closeSessionResult(f.name),/AGENT_RESUME_UNCONFIRMED/);
 assert.equal(fs.existsSync(agentMetadataPath(f.name,f.meta.launch_id)),true);
});

test('closing a hibernated logical seat returns closed without restarting a CLI',{skip,timeout:15000},async t=>{
 const f=await fixture(t);assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 assert.equal(core.closeSessionResult(f.name).outcome,'closed');assert.equal(core.observeSession(f.name).exists,false);
 assert.equal(core.closeSessionResult(f.name).outcome,'already_closed');
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,1);
});

test('a failed physical resume cannot start another CLI or accept either queued body', {skip,timeout:15000},async t=>{
 const f=await fixture(t,{resumeBlocked:true});assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 const results=await Promise.allSettled([core.dispatchAgentTurn(f.name,'never-first',{raw:true,ready_timeout:200}),core.sendAgentMessage(f.name,'never-second',{raw:true})]);
 assert.ok(results.every(result=>result.status==='rejected'&&/AGENT_RESUME_(?:FAILED|UNCONFIRMED)/.test(result.reason.message)));
 const launches=fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').map(JSON.parse);assert.equal(launches.length,2);
 assert.equal(fs.existsSync(f.keys),false);
 const attempt=JSON.parse(fs.readFileSync(agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume-attempt.json'),'utf8'));
 assert.equal(attempt.state,'failed');core.closeSession(f.name);
 assert.equal(fs.existsSync(agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume-attempt.json')),false);
});

test('send resumes the same conversation once, preserves old records and restores explicit environment', {skip,timeout:30000},async t=>{
 const f=await fixture(t,{resumeEnv:true});assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 process.env.PEERTABLE_ROOM='caller room';process.env.PEERTABLE_MEMBER='caller member';process.env.AITERM_TEST_UNSET='caller value';
 const receipts=await Promise.all(['first-body','second-body'].map(text=>core.sendAgentMessage(f.name,text,{raw:true})));
 assert.equal(receipts[0].launch_id,receipts[1].launch_id);assert.notEqual(receipts[0].launch_id,f.meta.launch_id);
 const current=JSON.parse(fs.readFileSync(agentMetadataPath(f.name,receipts[0].launch_id),'utf8'));
 assert.equal(current.vendor_session_id,f.meta.vendor_session_id);assert.equal(current.resumed_from,f.meta.launch_id);
 assert.equal(current.lineage,f.meta.lineage);assert.equal(current.delegation_depth,f.meta.delegation_depth);
 assert.equal(fs.existsSync(agentMetadataPath(f.name,f.meta.launch_id)),true);
 const launches=fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').map(JSON.parse);assert.equal(launches.length,2);
 assert.ok(launches[1].argv.includes('resume'));assert.ok(launches[1].argv.includes(f.meta.vendor_session_id));
 assert.equal(launches[1].room,"saved room ' $() ; #{pane_id} \\ literal");assert.equal(launches[1].member,';');assert.equal(launches[1].unset,null);
 assert.equal(launches[1].cwd,f.meta.cwd);
 const listed=core.listSessionsResult(['PEERTABLE_ROOM','PEERTABLE_MEMBER','AITERM_TEST_UNSET']).sessions.find(row=>row.session_id===f.name);
 assert.deepEqual(listed.environment,{PEERTABLE_ROOM:"saved room ' $() ; #{pane_id} \\ literal",PEERTABLE_MEMBER:';',AITERM_TEST_UNSET:null});
 const accepted=fs.readFileSync(f.keys,'utf8').trim().split('\n');assert.deepEqual(accepted,['first-body','second-body']);
});

test('an external observer retains membership while the published resume is not ready',{skip,timeout:20000},async t=>{
 const f=await fixture(t,{resumeEnv:true});assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 const rename=fs.renameSync;let during;
 t.mock.method(fs,'renameSync',function(from,to){
  const result=rename(from,to);
  if(!during&&to.endsWith('.active-launch.json')&&JSON.parse(fs.readFileSync(to,'utf8')).launch_id!==f.meta.launch_id){
   const code=`import * as core from ${JSON.stringify(new URL('../dist/core.js',import.meta.url).href)};
const observed=core.observeSession(${JSON.stringify(f.name)});
console.log(JSON.stringify({observed,listed:core.listSessionsResult(['PEERTABLE_ROOM','PEERTABLE_MEMBER']).sessions.find(row=>row.session_id===${JSON.stringify(f.name)}),turn:core.readSeatTurns([${JSON.stringify(f.name)}]).seats[0].turn}));`;
   const read=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});
   assert.equal(read.status,0,read.stderr);during=JSON.parse(read.stdout);
  }
  return result;
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 await core.sendAgentMessage(f.name,'accepted-after-ready',{raw:true});
 assert.equal(during.observed.state,'unknown');assert.equal(during.observed.reason,'agent_resuming');
 assert.equal(during.observed.activity.post_startup_process_count,null);assert.equal(during.turn,null);
 assert.deepEqual(during.listed.environment,{PEERTABLE_ROOM:"saved room ' $() ; #{pane_id} \\ literal",PEERTABLE_MEMBER:';'});
 assert.equal(core.observeSession(f.name).state,'idle');
});

for(const prompt of [null,'launch-first-body'])test(`same-name agent_launch resumes with its existing result tuple and prompt=${prompt!==null}`,{skip,timeout:20000},async t=>{
 const f=await fixture(t,{resumeEnv:true});assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 const result=await core.openAgentWithInitialPrompt('codex',{session_name:f.name,prompt,ready_timeout:1000});
 assert.equal(result.length,7);assert.equal(result[0],f.name);assert.equal(result[5].status,'ready');assert.equal(result[6].fast,false);
 assert.equal(result[4].status,prompt===null?'not_requested':'submitted_unconfirmed');
 const seen=core.observeSession(f.name);assert.notEqual(seen.launch_id,f.meta.launch_id);assert.equal(seen.harness_alive,true);
 const current=JSON.parse(fs.readFileSync(agentMetadataPath(f.name,seen.launch_id),'utf8'));
 assert.equal(current.vendor_session_id,f.meta.vendor_session_id);assert.equal(current.resumed_from,f.meta.launch_id);
 assert.equal(current.lineage,f.meta.lineage);assert.equal(fs.existsSync(agentMetadataPath(f.name,f.meta.launch_id)),true);
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,2);
 assert.deepEqual(fs.existsSync(f.keys)?fs.readFileSync(f.keys,'utf8').trim().split('\n'):[],prompt===null?[]:[prompt]);
});

test('a conflicting same-name launch cannot replace the saved conversation or its environment',{skip,timeout:15000},async t=>{
 const f=await fixture(t);assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 assert.throws(()=>core.openSession(f.name),/AGENT_RESUME_REQUIRED/);
 assert.throws(()=>core.openAgent('codex',{session_name:f.name,agent_done:true}),/AGENT_RESUME_REQUIRED/);
 await assert.rejects(core.configureAgent(f.name,{model:'other-model'}),error=>{
  assert.match(error.message,/AGENT_RESUME_REQUIRED/);assert.equal(error.configurationFailure.outcome,'not_applied');
  assert.equal(error.configurationFailure.effect,'not_started');return true;
 });
 for(const change of [{model:'other-model'},{reasoning_effort:'low'},{fast:true},{cwd:process.env.CODEX_HOME},
  {env_vars:['DIFFERENT_MEMBER']},{write_scope:'read-only'}]){
  await assert.rejects(core.openAgentWithInitialPrompt('codex',{session_name:f.name,prompt:'never-body',...change}),/AGENT_RESUME_CONFLICT/);
 }
 await assert.rejects(core.openAgentWithInitialPrompt('claude',{session_name:f.name,prompt:'never-body'}),/AGENT_RESUME_CONFLICT/);
 assert.equal(readAgentLifecycle(f.meta).state,'hibernated');assert.equal(core.observeSession(f.name).launch_id,f.meta.launch_id);
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,1);assert.equal(fs.existsSync(f.keys),false);
});

test('a mounted execution graph refuses resume before metadata creation or native issuance',{skip,timeout:15000},async t=>{
 const f=await fixture(t);assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');let issued=0;
 await assert.rejects(withExecutionEffectScope(f.name,()=>{issued++;},()=>core.sendAgentMessage(f.name,'never-body',{raw:true})),/EXECUTION_UNSUPPORTED/);
 assert.equal(issued,0);assert.equal(readAgentLifecycle(f.meta).state,'hibernated');
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,1);
 assert.equal(fs.existsSync(f.keys),false);
});

test('failure to persist the actual native receipt leaves a blocked attempt and starts no CLI',{skip,timeout:15000},async t=>{
 const f=await fixture(t);assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 const original=fs.renameSync;t.mock.method(fs,'renameSync',function(from,to){
  if(to.endsWith('.resume-native.json'))throw Object.assign(new Error('fixture storage full'),{code:'ENOSPC'});
  return original(from,to);
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 await assert.rejects(core.sendAgentMessage(f.name,'never-first',{raw:true}),/AGENT_RESUME_FAILED/);
 await assert.rejects(core.sendAgentMessage(f.name,'never-second',{raw:true}),/AGENT_RESUME_UNCONFIRMED/);
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,1);assert.equal(fs.existsSync(f.keys),false);
 const attempt=JSON.parse(fs.readFileSync(agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume-attempt.json'),'utf8'));
 assert.equal(attempt.state,'failed');
});

test('a generation change during resume publication prevents the old request from submitting',{skip,timeout:15000},async t=>{
 const f=await fixture(t);assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 const original=fs.renameSync;let changed=false;
 t.mock.method(fs,'renameSync',function(from,to){
  const result=original(from,to);
  if(!changed&&to.endsWith('.active-launch.json')){
   const pointer=JSON.parse(fs.readFileSync(to,'utf8'));
   if(pointer.launch_id!==f.meta.launch_id){
    changed=true;const next=JSON.parse(fs.readFileSync(agentMetadataPath(f.name,pointer.launch_id),'utf8'));
    const other={...next,launch_id:'f'.repeat(32),event_file:agentEventPath(f.name,'f'.repeat(32)),resumed_from:next.launch_id};
    fs.writeFileSync(other.event_file,'');writeAgentMetadata(other);publishAgentGeneration(next,other);
   }
  }
  return result;
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 await assert.rejects(core.sendAgentMessage(f.name,'never-body',{raw:true}),/AGENT_RESUME_FAILED/);
 assert.equal(changed,true);assert.equal(fs.existsSync(f.keys),false);
});

test('a changed native proof after readiness cannot authorize the pending body',{skip,timeout:15000},async t=>{
 const f=await fixture(t);assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 await assert.rejects(core.sendAgentMessage(f.name,'never-body',{raw:true,before_send:async boundary=>{
  const file=agentMetadataPath(f.name,boundary.launch_id).replace(/\.agent\.json$/,'.resume-native.json');
  const native=JSON.parse(fs.readFileSync(file,'utf8'));native.pane_id='%999999';fs.writeFileSync(file,JSON.stringify(native));
 }}),/AGENT_RESUME_UNCONFIRMED/);
 assert.equal(fs.existsSync(f.keys),false);
});

test('a same-launch metadata change after hibernation cannot reuse a stale resume recipe',{skip,timeout:15000},async t=>{
 const f=await fixture(t);assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 writeAgentMetadata({...f.meta,model:'later-model'});
 await assert.rejects(core.sendAgentMessage(f.name,'never-body',{raw:true}),/AGENT_RESUME_UNCONFIRMED/);
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,1);
 assert.equal(fs.existsSync(f.keys),false);
});

for(const phase of ['created','before-body','native-paste','server-restart','later-send'])test(`resume refuses a same-name native replacement at ${phase}`,
 {skip,timeout:20000},async t=>{
 const f=await fixture(t);core.openSession('replacement-guard-bridge');
 assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 const original=childProcess.spawnSync,bin=resolveTmux(),prefix=['-S',SOCK],wrongEnter=f.keys+'-wrong-enter';let replaced=false,armed=false;
 const replace=()=>{
  replaced=true;
  if(phase==='server-restart'){
   assert.equal(original(bin,[...prefix,'kill-server'],{encoding:'utf8'}).status,0);
   for(const name of ['replacement-zero','replacement-one'])assert.equal(original(bin,[...prefix,'new-session','-d','-s',name,'bash'],{encoding:'utf8'}).status,0);
  }else assert.equal(original(bin,[...prefix,'kill-session','-t',f.name],{encoding:'utf8'}).status,0);
  assert.equal(original(bin,[...prefix,'new-session','-d','-s',f.name,'bash'],{encoding:'utf8'}).status,0);
  if(phase==='server-restart')assert.equal(original(bin,[...prefix,'send-keys','-t',f.name,'-l','--',`touch '${wrongEnter.replaceAll("'","'\\''")}'`],{encoding:'utf8'}).status,0);
 };
 if(phase==='created'||phase==='native-paste'||phase==='server-restart'){
  t.mock.method(childProcess,'spawnSync',function(binary,args,options){
   if(phase==='native-paste'&&armed&&!replaced&&binary===bin&&args.some(arg=>arg.includes('paste-buffer'))) replace();
   if(phase==='server-restart'&&armed&&!replaced&&binary===bin&&args.some(arg=>arg.includes('send-keys'))&&args.some(arg=>arg.includes('Enter')))replace();
   const result=original(binary,args,options);
   if(phase==='created'&&!replaced&&binary===bin&&args.includes('new-session')&&args.includes(f.name)&&result.status===0)replace();
   return result;
  });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 }
 if(phase==='later-send'){
  await core.sendAgentMessage(f.name,'accepted-on-original',{raw:true});replace();
  await assert.rejects(core.sendAgentMessage(f.name,'never-on-replacement',{raw:true}),/AGENT_RESUME_|世代|native/);
 }else await assert.rejects(core.sendAgentMessage(f.name,'never-on-replacement',{raw:true,before_send:async()=>{
  if(phase==='before-body')replace();else armed=true;
 }}),/AGENT_RESUME_|世代|native|入力/);
 assert.equal(replaced,true);
 assert.equal(original(bin,[...prefix,'has-session','-t',f.name],{encoding:'utf8'}).status,0,'replacement is never cleaned up as our failed resume');
 const screen=original(bin,[...prefix,'capture-pane','-p','-t',f.name],{encoding:'utf8'}).stdout;
 assert.equal(screen.includes('never-on-replacement'),false,'even a partial paste cannot reach the replacement pane');
 assert.equal(fs.existsSync(wrongEnter),false,'Enter cannot execute the replacement pane draft after server ID reuse');
 const launches=fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n');assert.equal(launches.length,phase==='created'?1:2);
 const accepted=fs.existsSync(f.keys)?fs.readFileSync(f.keys,'utf8').trim().split('\n'):[];
 assert.deepEqual(accepted,phase==='later-send'?['accepted-on-original']:[]);
});

test('recipe absence and an outdated launch never terminate an idle seat',{skip,timeout:15000},async t=>{
 const f=await fixture(t,{recipe:false});
 assert.equal((await core.checkAgentIdle(f.expected)).reason,'resume_unavailable');
 assert.equal((await core.checkAgentIdle({...f.expected,launch_id:'b'.repeat(32)})).outcome,'skipped');
 assert.equal(core.observeSession(f.name).harness_alive,true);assert.equal(readAgentLifecycle(f.meta),null);
});

for(const kind of ['background','delivery','proof'])test(`a ${kind} added after preparation cancels before the first signal`,
 {skip,timeout:20000},async t=>{
 const f=await fixture(t),original=fs.renameSync;let added=false;
 const rename=t.mock.method(fs,'renameSync',function(from,to){
  const value=original(from,to);
  if(to===f.lifecycle&&!added){
   added=true;
   if(kind==='background'){
    fs.writeFileSync(f.spawnFlag,'spawn');
    const wait=spawnSync(process.execPath,['-e',
     `const fs=require('node:fs');const until=Date.now()+4000;const timer=setInterval(()=>{if(fs.existsSync(process.argv[1])){clearInterval(timer);process.exit(0);}if(Date.now()>until)process.exit(1);},10);`,f.spawned],{timeout:5000});
    assert.equal(wait.status,0);
   }else if(kind==='proof'){
    const file=agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.codex-resume.json');
    const proof=JSON.parse(fs.readFileSync(file,'utf8'));proof.last_turn_id='changed-proof';fs.writeFileSync(file,JSON.stringify(proof));
   }else{
    const owner=core.observeSession(f.name).harness_process;
    const directory=join(ensureStateRoot(),'parent-deliveries','active',deliveryOwnerPrefix(owner)+'fixture');
    fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(join(directory,'held.json'),'{}');
   }
  }
  return value;
 });
 syncBuiltinESMExports();
 t.after(()=>{rename.mock.restore();syncBuiltinESMExports();});
 const result=await core.checkAgentIdle(f.expected);
 rename.mock.restore();syncBuiltinESMExports();
 assert.equal(added,true);assert.equal(result.outcome,'skipped',JSON.stringify(result));
 assert.equal(readAgentLifecycle(f.meta),null,'a pre-signal rejection removes its own preparation');
 assert.equal(core.observeSession(f.name).harness_alive,true);
});

test('an input holding the real send admission completes before an idle check can decide',
 {skip,timeout:15000},async t=>{
 const f=await fixture(t);let finished=false;
 const sending=core.sendAgentMessage(f.name,'NEW_INPUT');
 for(const until=Date.now()+5000;Date.now()<until;await sleep(10)){
  if(fs.existsSync(f.keys+'-draft')&&fs.readFileSync(f.keys+'-draft','utf8').includes('NEW_INPUT'))break;
 }
 const checking=core.checkAgentIdle(f.expected).then(result=>{finished=true;return result;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);
 await sending;const result=await checking;
 assert.equal(result.outcome,'skipped');assert.equal(result.reason,'input_without_turn_end');
 assert.equal(fs.readFileSync(f.keys,'utf8').trim(),'NEW_INPUT');assert.equal(core.observeSession(f.name).harness_alive,true);
});

test('a later aborted native turn cannot reuse the previous reply clock',{skip,timeout:15000},async t=>{
 const f=await fixture(t);
 fs.appendFileSync(f.rollout,[{type:'event_msg',payload:{type:'task_started',turn_id:'interrupted'}},
  {type:'event_msg',payload:{type:'turn_aborted',turn_id:'interrupted',reason:'interrupted'}}].map(JSON.stringify).join('\n')+'\n');
 const result=await core.checkAgentIdle(f.expected);
 assert.equal(result.outcome,'skipped');assert.equal(result.reason,'turn_end_unconfirmed');
 assert.equal(core.observeSession(f.name).harness_alive,true);assert.equal(readAgentLifecycle(f.meta),null);
});

test('a replacement after native exit retains uncertain stopping instead of completing the old launch',
 {skip,timeout:20000},async t=>{
 const f=await fixture(t);let replaced=false;
 const timer=setInterval(()=>{
  if(!replaced&&spawnSync(resolveTmux(),['-S',SOCK,'has-session','-t',f.name]).status!==0){
   replaced=true;writeAgentMetadata({...f.meta,launch_id:'b'.repeat(32)});
   fs.unlinkSync(agentMetadataPath(f.name,f.meta.launch_id));
  }
 },5);
 t.after(()=>clearInterval(timer));
 const result=await core.checkAgentIdle(f.expected);clearInterval(timer);
 assert.equal(replaced,true);assert.equal(result.outcome,'unconfirmed');
 assert.equal(readAgentLifecycle(f.meta).state,'stopping');
 assert.equal(fs.existsSync(agentMetadataPath(f.name,'b'.repeat(32))),true);
});


test('the idle adapter cannot create or replace a required native effect scope',{skip,timeout:15000},async t=>{
 const f=await fixture(t);let issued=0;
 requireExecutionEffectScope(true);
 try{
  await assert.rejects(core.checkAgentIdle(f.expected),error=>error.code==='EXECUTION_UNSUPPORTED');
  await assert.rejects(withExecutionEffectScope('different-seat',()=>issued++,()=>core.checkAgentIdle(f.expected)),
   error=>error.code==='EXECUTION_CONFLICT');
 }finally{requireExecutionEffectScope(false);}
 assert.equal(issued,0);assert.equal(core.observeSession(f.name).harness_alive,true);
 assert.equal(readAgentLifecycle(f.meta),null);
});


test('failure to persist the latest native completion refuses stopping before preparation',
 {skip,timeout:15000},async t=>{
 const f=await fixture(t),original=fs.appendFileSync;let refused=false;
 const activity=agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.activity.jsonl');
 const append=t.mock.method(fs,'appendFileSync',function(file,...args){
  if(file===activity){refused=true;throw Object.assign(new Error('fixture full'),{code:'ENOSPC'});}
  return original(file,...args);
 });
 try{
  const result=await core.checkAgentIdle(f.expected);
  assert.equal(refused,true);assert.equal(result.outcome,'skipped');
  assert.equal(core.observeSession(f.name).harness_alive,true);assert.equal(readAgentLifecycle(f.meta),null);
 }finally{append.mock.restore();}
});


test('a clock tick discovers autonomous native completion without a parent waiter',{skip,timeout:15000},async t=>{
 const f=await fixture(t);const owner=readProcessIdentities([process.pid])[0];
 const old={schema:'aiterm.agent-idle-clock.v1',launch_id:f.meta.launch_id,token:'c'.repeat(32),owner,
  anchor:f.meta.created_at,wake_at:new Date().toISOString()};
 writeAgentIdleClock(f.meta,old);
 let spawned;
 t.after(()=>{
  if(spawned&&readProcessIdentities([spawned.owner.pid]).some(row=>row.started_identity===spawned.owner.started_identity)){
   try{process.kill(-spawned.owner.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
  }
  retireAgentIdleClock(f.meta);
 });
 const native=(type)=>JSON.stringify({timestamp:new Date().toISOString(),type:'event_msg',payload:{type,turn_id:'autonomous',last_agent_message:'Done'}})+'\n';
 fs.appendFileSync(f.rollout,native('task_started'));
 const [busy]=await Promise.all([core.serviceAgentIdleClock(f.expected,old.token),core.serviceAgentIdleClock(f.expected)]);
 spawned=readAgentIdleClock(f.meta);
 assert.equal(busy.reason,'turn_end_unconfirmed');assert.equal(core.observeSession(f.name).harness_alive,true);
 assert.notEqual(spawned.token,old.token);
 assert.ok(Date.parse(spawned.wake_at)-Date.now()>50000,'a busy turn has a successor tick');
 fs.appendFileSync(f.rollout,native('task_complete'));
 const done=await core.serviceAgentIdleClock(f.expected);
 assert.equal(done.outcome,'not_due');assert.ok(Date.parse(readAgentActivity(f.meta).last_turn_end_at)>Date.now()-10000);
 assert.equal(readAgentIdleClock(f.meta).token,spawned.token,'an earlier pending tick is reused');
 assert.equal((await core.serviceAgentIdleClock(f.expected,old.token)).reason,'superseded_timer');
 assert.equal((await core.serviceAgentIdleClock(f.expected,spawned.token)).reason,'superseded_timer','a different process cannot impersonate the sleeper');
});


test('public registration follows the published launch while old and staged metadata coexist',
 {skip,timeout:15000},async t=>{
 const f=await fixture(t);publishAgentGeneration(f.meta);
 const next={...f.meta,launch_id:'b'.repeat(32),resumed_from:f.meta.launch_id,event_file:agentEventPath(f.name,'b'.repeat(32))};
 fs.writeFileSync(next.event_file,'');writeAgentMetadata(next);
 assert.equal(core.isAgentSession(f.name),true);
 assert.equal(core.observeSessionGeneration(f.name).launch_id,f.meta.launch_id);
 publishAgentGeneration(f.meta,next);
 assert.equal(core.observeSessionGeneration(f.name).launch_id,next.launch_id);
 writeAgentMetadata({...f.meta,model:'stale'});
 assert.equal(core.observeSessionGeneration(f.name).launch_id,next.launch_id);
 fs.unlinkSync(agentMetadataPath(f.name,next.launch_id));
 assert.throws(()=>core.isAgentSession(f.name),/AGENT_RESUME_UNCONFIRMED/,'cannot request a replacement seat via AGENT_SESSION_REQUIRED');
 fs.unlinkSync(agentMetadataPath(f.name,f.meta.launch_id));
 assert.throws(()=>core.isAgentSession(f.name),/AGENT_RESUME_UNCONFIRMED/);
});
