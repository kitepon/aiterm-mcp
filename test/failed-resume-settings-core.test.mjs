// Finite copy of the existing idle-core fake Codex fixture; no vendor credentials or live seats.
import {createOfflineResumeCheckpoint,restoreOfflineResumeCheckpoint} from '../dist/resume-checkpoint-files.js';
import {resumeCheckpointDigest} from '../dist/resume-checkpoint.js';
import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {AsyncResource} from 'node:async_hooks';
import * as core from '../dist/core.js';
import {agentMetadataPath,agentEventPath,writeAgentMetadata,ensureStateRoot,publishAgentGeneration} from '../dist/agent-shared.js';
import {readAgentLifecycle,writeAgentLifecycle,writeAgentResumeAttempt,writeAgentResumeRecipe,readAgentIdleClock,writeAgentIdleClock,retireAgentIdleClock} from '../dist/agent-lifecycle.js';
import {requireExecutionEffectScope,withExecutionEffectScope} from '../dist/execution-effect.js';
import {readProcessIdentities} from '../dist/process-runtime.js';
import {readAgentActivity} from '../dist/agent-activity.js';
import {deliveryOwnerPrefix} from '../dist/parent-delivery-owners.js';
import {SOCK,resolveTmux,paneCommandArgs} from '../dist/tmux-runtime.js';

const skip=process.platform==='win32'?'POSIX tmux fixture':false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let serial=0;
async function fixture(t,{recipe=true,resumeEnv=false,resumeBlocked=false,resumeLater=false,resumeBusy=false,seatName,nativeSettings,resumeSettings,resumeThread}={}){
 const tag='idle-core-'+ ++serial,bin=join(process.env.HOME,tag+'-codex.sh'),driver=join(process.env.HOME,tag+'-driver.mjs');
 const keys=join(process.env.HOME,tag+'-input'),spawnFlag=join(process.env.HOME,tag+'-spawn'),spawned=join(process.env.HOME,tag+'-spawned');
 fs.mkdirSync(process.env.CODEX_HOME,{recursive:true});
 fs.writeFileSync(bin,`#!/bin/sh\n'${process.execPath.replaceAll("'","'\\''")}' '${driver}' "$@"\n`,{mode:0o700});
 fs.writeFileSync(driver,`import fs from 'node:fs';import {spawn} from 'node:child_process';
let line='',added=false,menu=false,query='',modelMenu=0,notice='';
let selected;const reset=()=>selected={'model-with-reasoning':true,'current-dir':true,'thread-name':true,'fast-mode':false,...(${JSON.stringify(resumeLater)}?{'thread-id':false}:{})};reset();
const settings=${JSON.stringify(nativeSettings??{model:'fixture-model',effort:'high',fast:false})};
if(process.argv.includes('app-server'))process.exit(1);
const modelIndex=process.argv.indexOf('-m');if(modelIndex>=0)settings.model=process.argv[modelIndex+1];
const effortArg=process.argv.find(x=>x.startsWith('model_reasoning_effort='));if(effortArg)settings.effort=effortArg.split('=')[1].replaceAll('\"','');
if(process.argv.includes('resume')&&fs.readFileSync(${JSON.stringify(keys+'-launches')},'utf8').trim().split('\\n').length===1)Object.assign(settings,${JSON.stringify(resumeSettings??{})});
fs.appendFileSync(${JSON.stringify(keys+'-launches')},JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),room:process.env.PEERTABLE_ROOM??null,member:process.env.PEERTABLE_MEMBER??null,unset:process.env.AITERM_TEST_UNSET??null})+'\\n');
${resumeBlocked?'if(process.argv.includes("resume"))process.exit(0);':''}
let delayed=process.argv.includes('resume')&&${JSON.stringify(resumeLater)};
const resumedBusy=process.argv.includes('resume')?${JSON.stringify(resumeBusy)}:false;
if(resumedBusy==='bound'){
 const directory=process.env.CODEX_HOME+'/sessions';
 const session=process.argv[process.argv.indexOf('resume')+1];
 const file=fs.readdirSync(directory).find(name=>name.endsWith('-'+session+'.jsonl'));
 fs.appendFileSync(directory+'/'+file,JSON.stringify({timestamp:new Date().toISOString(),type:'event_msg',payload:{type:'task_started',turn_id:'native-queued-turn'}})+'\\n');
}
const draw=()=>{
 if(menu)fs.writeFileSync(${JSON.stringify(keys+'-menu-open')},'1');else fs.rmSync(${JSON.stringify(keys+'-menu-open')},{force:true});
 const model=settings.model+' '+settings.effort+(settings.fast?' Fast':'');
 const footer=[selected['model-with-reasoning']?model:null,selected['current-dir']?process.cwd():null,selected['thread-name']?'thread name':null,selected['fast-mode']?(settings.fast?'Fast':'Standard'):null,selected['thread-id']?(${JSON.stringify(resumeThread??null)}??process.argv[process.argv.indexOf('resume')+1]):null].filter(Boolean).join(' · ');
 const rows=Object.entries(selected).filter(([id])=>!query||id.includes(query));
 const screen=modelMenu===1?'Select Model and Effort\\n› 1. fixture-model\\n  2. other-model\\nenter select · esc back':modelMenu===2?'Select Reasoning Level\\n  1. Low  Fast\\n  2. Medium  Balanced\\n  3. High  Deeper\\nenter select · esc back':menu?'Configure Status Line\\nSelect which items to display in the status line.\\n\\n'+(query||'Type to search')+'\\n\\n'+rows.map(([id,on],i)=>(i===0?'› ':'  ')+'['+(on?'x':' ')+'] '+id+'  Current setting').join('\\n')+'\\n\\n'+footer+'\\nspace toggle · ←/→ reorder · enter save · esc cancel'
 : notice+'OpenAI Codex\\n'+(resumedBusy?'◦ Working (1s • esc to interrupt)\\n':'')+'› '+line+'\\x1b[K\\n  '+model+' · /tmp/proj\\x1b[K\\n\\x1b[J';
 process.stdout.write('\\x1b[H\\x1b[2J'+(delayed?'unknown delayed view':(${resumeBlocked?'process.argv.includes("resume") ? "unknown blocked view" : ':''}screen)));
};
process.stdin.setRawMode(true);process.stdin.resume();draw();
if(resumedBusy)fs.writeFileSync(${JSON.stringify(keys+'-resume-drawn')},'1');
process.stdin.on('data',bytes=>{for(const ch of bytes.toString().replace(/\\x1b\\[20[01]~/g,'')){
 if(ch==='\\x1b'){menu=false;query='';modelMenu=0;}
 else if(modelMenu){
  if(modelMenu===1&&['1','2'].includes(ch)){settings.model=ch==='1'?'fixture-model':'other-model';modelMenu=2;}
  else if(modelMenu===2&&['1','2','3'].includes(ch)){settings.effort={'1':'low','2':'medium','3':'high'}[ch];modelMenu=0;notice='• Model changed to '+settings.model+' '+settings.effort+' standard for this session only\\n';
   fs.writeFileSync(process.env.CODEX_HOME+'/config.toml','model = "'+settings.model+'"\\nmodel_reasoning_effort = "'+settings.effort+'"\\n');}
 }
 else if(menu){
  if(ch==='\\x7f'||ch==='\\b')query=query.slice(0,-1);
  else if(ch===' '&&query in selected)selected[query]=!selected[query];
  else if(ch==='\\r')throw new Error('fixture refuses saving preview');
  else if(ch>=' ')query+=ch;
 }else if(ch==='\\r'){
  if(line==='/model'){fs.appendFileSync(${JSON.stringify(keys+'-model-commands')},'model');modelMenu=1;}else if(line==='/statusline'){menu=true;query='';reset();}else fs.appendFileSync(${JSON.stringify(keys)},line+'\\n');line='';
 }else if(ch>=' '){line+=ch;}}
 fs.writeFileSync(${JSON.stringify(keys+'-draft')},line);draw();});
setInterval(()=>{if(delayed&&fs.existsSync(${JSON.stringify(keys+'-allow-ready')})){delayed=false;draw();}if(!added&&fs.existsSync(${JSON.stringify(spawnFlag)})){
 added=true;const child=spawn(process.execPath,['-e','setInterval(()=>{},60000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(spawned)},String(child.pid));
}},10);`);
 process.env.CODEX_BIN=bin;core.__testSetAgentTuiReadyStableSamples(1);
 t.after(()=>{core.__testSetAgentTuiReadyStableSamples(null);core.killAll();});
 if(resumeEnv){process.env.PEERTABLE_ROOM="saved room ' $() ; #{pane_id} \\ literal";process.env.PEERTABLE_MEMBER=';';delete process.env.AITERM_TEST_UNSET;}
 const [name]=core.openAgent('codex',{session_name:seatName??tag,agent_done:true,cwd:process.env.HOME,
  ...(resumeEnv?{env_vars:['PEERTABLE_ROOM','PEERTABLE_MEMBER','AITERM_TEST_UNSET']} : {}),...(recipe?{model:'fixture-model',reasoning_effort:'high'}:{})});
 // Exercise service accounts with a noninteractive login shell, independently of the test runner's account.
 assert.equal(spawnSync(resolveTmux(),['-S',SOCK,'set-option','-g','default-shell','/usr/bin/false'],{encoding:'utf8'}).status,0);
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
  {type:'turn_context',payload:{model:meta.model,effort:'high'}},event('task_started'),
  {type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',internal_chat_message_metadata_passthrough:{turn_id:tag},content:[{type:'output_text',text:'Done'}]}},
  event('task_complete',{last_agent_message:'Done'})].map(JSON.stringify).join('\n')+'\n');
 if(recipe)writeAgentResumeRecipe(meta,{schema:'aiterm.agent-resume.v1',launch_id:meta.launch_id,kind:'codex',
  vendor_session_id:meta.vendor_session_id,executable:bin,cwd:process.env.HOME,configuration_root:process.env.CODEX_HOME,model:meta.model,reasoning_effort:'high',
  fast:meta.fast,environment:{PEERTABLE_ROOM:'artificial',PEERTABLE_MEMBER:'fixture'}});
 const expected={session_id:name,launch_id:meta.launch_id};
 return {name,meta,expected,keys,spawnFlag,spawned,rollout,bin,
  lifecycle:agentMetadataPath(name,meta.launch_id).replace(/\.agent\.json$/,'.lifecycle.json')};
}


async function failedReady(t,settings,extra={}){
 const f=await fixture(t,{resumeLater:true,resumeSettings:settings,...extra});assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 await assert.rejects(core.dispatchAgentTurn(f.name,'OLD_REJECTED',{raw:true,ready_timeout:250}),e=>e.resumeFailure?.input==='not_sent');
 const attemptFile=agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume-attempt.json');
 const failed=fs.readFileSync(attemptFile,'utf8'),attempt=JSON.parse(failed);
 fs.writeFileSync(f.keys+'-allow-ready','1');
 for(const end=Date.now()+4000;Date.now()<end;await sleep(40)){const screen=spawnSync(resolveTmux(),['-S',SOCK,'capture-pane','-p','-t',f.name],{encoding:'utf8'}).stdout;if(screen.includes('OpenAI Codex')&&!screen.includes('unknown delayed view'))return {...f,attemptFile,failed,attempt};}
 throw Error('fixture delayed composer not ready');
}
test('same-native recovery restores model and effort while preserving user defaults',{skip,timeout:20000},async t=>{
 const f=await failedReady(t,{model:'other-model',effort:'low'});
 const config=join(process.env.CODEX_HOME,'config.toml'),before='model = "user-default"\nmodel_reasoning_effort = "medium"\n';fs.writeFileSync(config,before);
 const result=await core.dispatchAgentTurn(f.name,'RESTORED_BODY',{raw:true,ready_timeout:2000});
 assert.equal(result.launch_id,f.attempt.next_launch_id);assert.equal(fs.readFileSync(f.attemptFile,'utf8'),f.failed);
 assert.equal(fs.readFileSync(config,'utf8'),before);
 assert.deepEqual(fs.readFileSync(f.keys,'utf8').trim().split('\n'),['RESTORED_BODY']);
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,2);
});

test('same-name launch repairs failed history before a later configure and send',{skip,timeout:25000},async t=>{
 const f=await failedReady(t,{});
 const result=await core.openAgentWithInitialPrompt('codex',{session_name:f.name,ready_timeout:2000});
 assert.equal(result[5].status,'ready');assert.equal(result[4].status,'not_requested');
 assert.equal(fs.existsSync(f.keys),false);assert.equal(fs.readFileSync(f.attemptFile,'utf8'),f.failed);
 const configured=await core.configureAgent(f.name,{model:'other-model',reasoning_effort:'low'});
 assert.equal(configured.model,'other-model');
 const receipt=await core.dispatchAgentTurn(f.name,'AFTER_CONFIGURE',{raw:true,ready_timeout:2000});
 assert.equal(receipt.launch_id,f.attempt.next_launch_id);assert.equal(fs.readFileSync(f.attemptFile,'utf8'),f.failed);
 assert.deepEqual(fs.readFileSync(f.keys,'utf8').trim().split('\n'),['AFTER_CONFIGURE']);
 const idle=await core.checkAgentIdle({session_id:f.name,launch_id:receipt.launch_id});
 assert.equal(idle.reason,'background_work_or_unknown');
 const saved=JSON.parse(fs.readFileSync(agentMetadataPath(f.name,receipt.launch_id),'utf8'));assert.equal(saved.startup_processes,undefined);
});

async function failedAfterReady(t){
 const f=await fixture(t,{resumeLater:true});assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 fs.writeFileSync(f.keys+'-allow-ready','1');
 const attemptFile=agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume-attempt.json');
 const original=fs.renameSync;let rejected=false;
 const rename=t.mock.method(fs,'renameSync',function(from,to){if(to===attemptFile&&JSON.parse(fs.readFileSync(from,'utf8')).state==='ready'&&!rejected){rejected=true;throw Object.assign(Error('fixture ready save failed'),{code:'EACCES'});}return original(from,to);});
 syncBuiltinESMExports();
 try{await assert.rejects(core.dispatchAgentTurn(f.name,'OLD_REJECTED',{raw:true,ready_timeout:2000}),e=>e.resumeFailure?.input==='not_sent');}
 finally{rename.mock.restore();syncBuiltinESMExports();}
 assert.equal(rejected,true);const failed=fs.readFileSync(attemptFile,'utf8'),attempt=JSON.parse(failed);
 assert.ok(JSON.parse(fs.readFileSync(agentMetadataPath(f.name,attempt.next_launch_id),'utf8')).startup_processes);
 return {...f,attemptFile,failed,attempt};
}
test('failed ready-save with original startup baseline supports configure and next ordinary hibernation',{skip,timeout:25000},async t=>{
 const f=await failedAfterReady(t);
 const launch=await core.openAgentWithInitialPrompt('codex',{session_name:f.name,ready_timeout:2000});assert.equal(launch[5].status,'ready');
 await core.configureAgent(f.name,{model:'other-model',reasoning_effort:'low'});
 const receipt=await core.dispatchAgentTurn(f.name,'AFTER_CONFIGURE',{raw:true,ready_timeout:2000});
 const prior=process.env.AITERM_IDLE_MINUTES;process.env.AITERM_IDLE_MINUTES='0.0001';t.after(()=>{if(prior===undefined)delete process.env.AITERM_IDLE_MINUTES;else process.env.AITERM_IDLE_MINUTES=prior;});
 const at=new Date().toISOString(),turn='after-configure';
 fs.appendFileSync(f.rollout,[{timestamp:at,type:'turn_context',payload:{model:'other-model',effort:'low'}},
 {timestamp:at,type:'event_msg',payload:{type:'task_started',turn_id:turn}},
 {timestamp:at,type:'event_msg',payload:{type:'task_complete',turn_id:turn,last_agent_message:'Done'}}].map(JSON.stringify).join('\n')+'\n');
 await sleep(30);
 const idle=await core.checkAgentIdle({session_id:f.name,launch_id:receipt.launch_id});assert.equal(idle.outcome,'hibernated',JSON.stringify(idle));
 const next=await core.dispatchAgentTurn(f.name,'AFTER_SECOND_HIBERNATION',{raw:true,ready_timeout:2000});
 assert.notEqual(next.launch_id,receipt.launch_id);assert.equal(fs.readFileSync(f.attemptFile,'utf8'),f.failed);
 assert.deepEqual(fs.readFileSync(f.keys,'utf8').trim().split('\n'),['AFTER_CONFIGURE','AFTER_SECOND_HIBERNATION']);
});

for(const mismatch of ['thread','fast'])test('recovery refuses '+mismatch+' mismatch before changing model',{skip,timeout:20000},async t=>{
 const f=await failedReady(t,{model:'other-model',effort:'low',fast:mismatch==='fast'},mismatch==='thread'?{resumeThread:'22222222-2222-4333-8444-555555555555'}:{});
 await assert.rejects(core.dispatchAgentTurn(f.name,'UNSENT',{raw:true,ready_timeout:2000}),e=>e.resumeFailure?.input==='not_sent');
 assert.equal(fs.existsSync(f.keys+'-model-commands'),false);assert.equal(fs.existsSync(f.keys),false);assert.equal(fs.readFileSync(f.attemptFile,'utf8'),f.failed);
});

for(const ending of ['complete','unfinished','pause-rejected'])test('failed settings recovery protects the active goal: '+ending,{skip,timeout:25000},async t=>{
 const f=await failedReady(t,{model:'other-model',effort:'low'});
 const {createServer}=await import('node:http'),{once}=await import('node:events'),{WebSocketServer}=await import('ws');
 const control=join(process.env.CODEX_HOME,'app-server-control');fs.mkdirSync(control,{recursive:true,mode:0o700});
 const socket=join(control,'app-server-control.sock'),http=createServer(),ws=new WebSocketServer({server:http});
 const effects=[],turn='goal-recovery',stamp=new Date().toISOString();
 const event=type=>JSON.stringify({timestamp:stamp,type:'event_msg',payload:{type,turn_id:turn,last_agent_message:'Done'}})+'\n';
 fs.appendFileSync(f.rollout,event('task_started'));
 let goal={threadId:f.meta.vendor_session_id,objective:'Original',status:'active',tokenBudget:null,tokensUsed:0,timeUsedSeconds:0,createdAt:1,updatedAt:1};
 ws.on('connection',client=>client.on('message',bytes=>{
  const {id,method,params}=JSON.parse(bytes.toString());if(id===undefined)return;let result;
  if(method==='initialize')result={userAgent:'fixture'};
  else if(method==='thread/loaded/list')result={data:[f.meta.vendor_session_id],nextCursor:null};
  else if(method==='thread/read')result={thread:{id:f.meta.vendor_session_id,source:'cli'}};
  else if(method==='thread/goal/get')result={goal};
  else if(method==='thread/goal/set'){
   assert.equal(params.threadId,f.meta.vendor_session_id);effects.push(params.status);
   if(ending!=='pause-rejected')goal={...goal,status:params.status,updatedAt:goal.updatedAt+1};
   if(params.status==='paused'&&ending==='complete')fs.appendFileSync(f.rollout,event('task_complete'));
   result={goal};
  }else throw Error('Unexpected RPC '+method);
  client.send(JSON.stringify({id,result}));
 }));
 http.listen(socket);await once(http,'listening');fs.chmodSync(socket,0o600);
 t.after(async()=>{for(const c of ws.clients)c.terminate();await new Promise(r=>ws.close(r));await new Promise(r=>http.close(r));});
 if(ending==='complete'){
  const receipt=await core.dispatchAgentTurn(f.name,'GOAL_PROTECTED_BODY',{raw:true,ready_timeout:2000});
  assert.equal(receipt.launch_id,f.attempt.next_launch_id);
  assert.deepEqual(fs.readFileSync(f.keys,'utf8').trim().split('\n'),['GOAL_PROTECTED_BODY']);
  assert.deepEqual(effects,['paused','active']);
 }else{
  await assert.rejects(core.dispatchAgentTurn(f.name,'UNSENT',{raw:true,ready_timeout:2000}),e=>e.resumeFailure?.input==='not_sent');
  assert.equal(fs.existsSync(f.keys+'-model-commands'),false);assert.equal(fs.existsSync(f.keys),false);
  assert.deepEqual(effects,ending==='unfinished'?['paused','active']:['paused']);
 }
 assert.equal(goal.status,'active');assert.equal(fs.readFileSync(f.attemptFile,'utf8'),f.failed);
});
