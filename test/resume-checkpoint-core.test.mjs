import './seat-env.mjs';
// Finite copy of the existing idle-core fake Codex fixture; no vendor credentials or live seats.
import {createOfflineResumeCheckpoint,restoreOfflineResumeCheckpoint} from '../dist/resume-checkpoint-files.js';
import {resumeCheckpointDigest} from '../dist/resume-checkpoint.js';
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
async function fixture(t,{recipe=true,resumeEnv=false,resumeBlocked=false,resumeLater=false,resumeBusy=false,seatName,nativeSettings}={}){
 const tag='idle-core-'+ ++serial,bin=join(process.env.HOME,tag+'-codex.sh'),driver=join(process.env.HOME,tag+'-driver.mjs');
 const keys=join(process.env.HOME,tag+'-input'),spawnFlag=join(process.env.HOME,tag+'-spawn'),spawned=join(process.env.HOME,tag+'-spawned');
 fs.mkdirSync(process.env.CODEX_HOME,{recursive:true});
 fs.writeFileSync(bin,`#!/bin/sh\n'${process.execPath.replaceAll("'","'\\''")}' '${driver}' "$@"\n`,{mode:0o700});
 fs.writeFileSync(driver,`import fs from 'node:fs';import {spawn} from 'node:child_process';
let line='',added=false,menu=false,query='';
let selected;const reset=()=>selected={'model-with-reasoning':true,'current-dir':true,'thread-name':true,'fast-mode':false,...(${JSON.stringify(resumeLater)}?{'thread-id':false}:{})};reset();
const settings=${JSON.stringify(nativeSettings??{model:'fixture-model',effort:'high',fast:false})};
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
 const footer=[selected['model-with-reasoning']?model:null,selected['current-dir']?process.cwd():null,selected['thread-name']?'thread name':null,selected['fast-mode']?(settings.fast?'Fast':'Standard'):null,selected['thread-id']?process.argv[process.argv.indexOf('resume')+1]:null].filter(Boolean).join(' · ');
 const rows=Object.entries(selected).filter(([id])=>!query||id.includes(query));
 const screen=menu?'Configure Status Line\\nSelect which items to display in the status line.\\n\\n'+(query||'Type to search')+'\\n\\n'+rows.map(([id,on],i)=>(i===0?'› ':'  ')+'['+(on?'x':' ')+'] '+id+'  Current setting').join('\\n')+'\\n\\n'+footer+'\\nspace toggle · ←/→ reorder · enter save · esc cancel'
 : 'OpenAI Codex\\n'+(resumedBusy?'◦ Working (1s • esc to interrupt)\\n':'')+'› '+line+'\\x1b[K\\n  '+model+' · /tmp/proj\\x1b[K\\n\\x1b[J';
 process.stdout.write('\\x1b[H\\x1b[2J'+(delayed?'unknown delayed view':(${resumeBlocked?'process.argv.includes("resume") ? "unknown blocked view" : ':''}screen)));
};
process.stdin.setRawMode(true);process.stdin.resume();draw();
if(resumedBusy)fs.writeFileSync(${JSON.stringify(keys+'-resume-drawn')},'1');
process.stdin.on('data',bytes=>{for(const ch of bytes.toString().replace(/\\x1b\\[20[01]~/g,'')){
 if(ch==='\\x1b'){menu=false;query='';}
 else if(menu){
  if(ch==='\\x7f'||ch==='\\b')query=query.slice(0,-1);
  else if(ch===' '&&query in selected)selected[query]=!selected[query];
  else if(ch==='\\r')throw new Error('fixture refuses saving preview');
  else if(ch>=' ')query+=ch;
 }else if(ch==='\\r'){
  if(line==='/statusline'){menu=true;query='';reset();}else fs.appendFileSync(${JSON.stringify(keys)},line+'\\n');line='';
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

test('offline checkpoint survives state loss and resumes only this request in the same vendor',{skip,timeout:20000},async t=>{
 process.env.AITERM_STATE_BASE=process.env.XDG_RUNTIME_DIR;
 const f=await fixture(t,{resumeLater:true});core.openSession('cold-server-guard');
 assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 await assert.rejects(core.dispatchAgentTurn(f.name,'OLD_REJECTED',{raw:true,ready_timeout:250}),e=>e.resumeFailure?.input==='not_sent');
 const attemptFile=agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume-attempt.json');
 const failedBytes=fs.readFileSync(attemptFile,'utf8'),attempt=JSON.parse(failedBytes);
 const before=JSON.parse(fs.readFileSync(agentMetadataPath(f.name,attempt.next_launch_id).replace(/\.agent\.json$/,'.resume-native.json'),'utf8'));
 assert.equal(spawnSync(resolveTmux(),['-S',SOCK,'kill-session','-t',f.name]).status,0);
 const selected=attempt.next_launch_id;
 const bundle=createOfflineResumeCheckpoint(f.name,selected),hash=resumeCheckpointDigest(bundle);
 const directory=join(ensureStateRoot(),'agents');
 for(const entry of fs.readdirSync(directory).filter(n=>n.startsWith(f.name+'.')))fs.rmSync(join(directory,entry),{recursive:true,force:true});
 assert.equal(restoreOfflineResumeCheckpoint(bundle,{session_id:f.name,launch_id:selected,sha256:hash},core.observeExecutionNativeSessions),'restored');
 assert.equal(fs.readFileSync(attemptFile,'utf8'),failedBytes);
 fs.writeFileSync(f.keys+'-allow-ready','1');
 const receipt=await core.dispatchAgentTurn(f.name,'CURRENT_COLD_BODY',{raw:true,ready_timeout:2000});
 assert.notEqual(receipt.launch_id,attempt.next_launch_id);
 const current=JSON.parse(fs.readFileSync(agentMetadataPath(f.name,receipt.launch_id),'utf8'));
 const native=JSON.parse(fs.readFileSync(agentMetadataPath(f.name,receipt.launch_id).replace(/\.agent\.json$/,'.resume-native.json'),'utf8'));
 assert.equal(current.vendor_session_id,f.meta.vendor_session_id);assert.equal(current.resumed_from,attempt.next_launch_id);
 assert.notEqual(native.pane_started_identity+':'+native.pane_pid,before.pane_started_identity+':'+before.pane_pid);
 assert.equal(fs.readFileSync(attemptFile,'utf8'),failedBytes);
 assert.deepEqual(fs.readFileSync(f.keys,'utf8').trim().split('\n'),['CURRENT_COLD_BODY']);
 const launches=fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').map(JSON.parse);assert.equal(launches.length,3);
 assert(launches[2].argv.includes('resume'));assert(launches[2].argv.includes(f.meta.vendor_session_id));
 assert.equal(fs.existsSync(agentMetadataPath(f.name,attempt.next_launch_id).replace(/\.agent\.json$/,'.lifecycle.json')),false);
 core.closeSession(f.name);
 assert.equal(fs.existsSync(join(directory,f.name+'.resume-restore.json')),false);
 assert.equal(fs.existsSync(join(directory,f.name+'.resume-restore.d')),false);
});

