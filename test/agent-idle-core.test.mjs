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
import {loadAgentMetadata} from '../dist/agent-metadata-reader.js';
import {readAgentLifecycle,writeAgentLifecycle,writeAgentResumeAttempt,writeAgentResumeRecipe,readAgentIdleClock,writeAgentIdleClock,retireAgentIdleClock} from '../dist/agent-lifecycle.js';
import {requireExecutionEffectScope,withExecutionEffectScope} from '../dist/execution-effect.js';
import {readProcessIdentities} from '../dist/process-runtime.js';
import {readAgentActivity} from '../dist/agent-activity.js';
import {deliveryOwnerPrefix} from '../dist/parent-delivery-owners.js';
import {SOCK,resolveTmux,paneCommandArgs} from '../dist/tmux-runtime.js';

const skip=process.platform==='win32'?'POSIX tmux fixture':false;
// core.failedCodexResumeRecipe recovers failed Codex resumes on Linux only (lifecycle-state-ownership.md); elsewhere the call stays unconfirmed.
const linuxOnlyFailedRecovery=process.platform==='linux'?false:'failed Codex recovery is Linux-only';
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

// Two sequential hibernate+resume fixtures: 27s on a passing macOS runner, so 30s left no margin and a cancelled
// subtest's cleanup then killed the next test's seat. The budget is for both subtests, not a product deadline.
test('Codex resume gives a late idle draw 50 seconds by default and honors an explicit 30-second limit',{skip,timeout:60000},async t=>{
 for(const explicit of [false,true])await t.test(explicit?'explicit deadline':'default resume budget',async t=>{
  const f=await fixture(t);assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
  const original=childProcess.spawnSync,descriptor=Object.getOwnPropertyDescriptor(globalThis,'performance');
  let elapsed=0,advanced=false;
  Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>elapsed}});
  t.mock.method(childProcess,'spawnSync',function(binary,args,options){
   const result=original(binary,args,options);
   if(!advanced&&args.includes('capture-pane')&&args.includes('-45')&&String(result.stdout).includes('OpenAI Codex')){
    advanced=true;elapsed+=40000;
   }
   return result;
  });
  syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();Object.defineProperty(globalThis,'performance',descriptor);});
  const request=core.openAgentWithInitialPrompt('codex',{session_name:f.name,require_existing_resume:true,
   ...(explicit?{ready_timeout:30000}:{})});
  if(explicit)await assert.rejects(request,error=>error.resumeFailure?.input==='not_sent');
  else assert.equal((await request)[5].status,'ready');
  assert.equal(advanced,true,'the real resume sampled the delayed native composer');
  assert.equal(fs.existsSync(f.keys),false,'promptless resume never sends a caller body');
 });
});

for(const phase of ['created','metadata'])test(`a fresh launch never types into or cleans up a same-name replacement at ${phase}`,{skip,timeout:15000},async t=>{
 const f=await fixture(t);core.openSession('fresh-guard-bridge');core.closeSession(f.name);
 const original=childProcess.spawnSync,rename=fs.renameSync,bin=resolveTmux(),prefix=['-S',SOCK];let replaced=false;
 const replace=()=>{
  replaced=true;assert.equal(original(bin,[...prefix,'kill-session','-t',f.name],{encoding:'utf8'}).status,0);
  assert.equal(original(bin,[...prefix,'new-session','-d','-s',f.name,...paneCommandArgs('bash')],{encoding:'utf8'}).status,0);
 };
 if(phase==='created')t.mock.method(childProcess,'spawnSync',function(binary,args,options){
  const result=original(binary,args,options);
  if(!replaced&&binary===bin&&args.includes('new-session')&&args.includes(f.name)&&result.status===0)replace();
  return result;
 });
 else t.mock.method(fs,'renameSync',function(from,to){
  const result=rename(from,to);
  if(!replaced&&to.includes('/'+f.name+'.')&&to.endsWith('.agent.json'))replace();
  return result;
 });
 syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 assert.throws(()=>core.openAgent('codex',{session_name:f.name,agent_done:true,model:'fixture-model',reasoning_effort:'high',cwd:process.env.HOME}),/AGENT_RESUME_UNCONFIRMED/);
 assert.equal(replaced,true);assert.equal(original(bin,[...prefix,'has-session','-t',f.name]).status,0);
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,1);
});

test('created-native read failures are distinct from known replacements and clear on the next readable operation',{skip,timeout:15000},async t=>{
 const f=await fixture(t),file=agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume-native.json');
 const saved=fs.readFileSync(file,'utf8'),native=JSON.parse(saved);
 const read=fs.readFileSync,spawn=childProcess.spawnSync;let unreadable=null;
 t.mock.method(fs,'readFileSync',function(file,...args){
  if(unreadable!==null&&String(file)===`/proc/${unreadable}/stat`)throw Object.assign(new Error('fixture identity read failed'),{code:'EACCES'});
  return read(file,...args);
 });
 t.mock.method(childProcess,'spawnSync',function(binary,args,options){
  if(unreadable!==null&&binary==='ps'&&args.join(' ')===`-o lstart= -p ${unreadable}`)return {status:1,stdout:'',stderr:''};
  return spawn(binary,args,options);
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 for(const part of ['server','pane']){
  unreadable=native[part+'_pid'];
  assert.throws(()=>core.sendKeyResult(f.name,'Enter'),/AGENT_RESUME_UNCONFIRMED: 作成したnative本人性を取得できません/);
  unreadable=null;
  fs.writeFileSync(file,JSON.stringify({...native,[part+'_started_identity']:'known-other-birth'}));
  assert.throws(()=>core.sendKeyResult(f.name,'Enter'),/作成したnative端末が置き換わっています/);
  fs.writeFileSync(file,saved);
 }
 assert.equal(fs.existsSync(f.keys),false,'unproven targets receive no input');
 assert.equal(readAgentLifecycle(f.meta),null,'read failure leaves no persistent blocked state');
 assert.doesNotThrow(()=>core.sendKeyResult(f.name,'Enter'));
});

test('a missing initial creation receipt cannot be reconstructed during idle checking',{skip,timeout:15000},async t=>{
 const f=await fixture(t);
 fs.rmSync(agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume-native.json'),{force:true});
 assert.equal((await core.checkAgentIdle(f.expected)).outcome,'skipped');
 assert.equal(core.observeSession(f.name).harness_alive,true);assert.equal(readAgentLifecycle(f.meta),null);
});

test('the first idle check never terminates a same-name successor even after a stale startup writer',{skip,timeout:15000},async t=>{
 const f=await fixture(t);core.openSession('fresh-check-guard');
 const native=(...args)=>spawnSync(resolveTmux(),['-S',SOCK,...args],{encoding:'utf8'});
 assert.equal(native('kill-session','-t',f.name).status,0);
 assert.equal(native('new-session','-d','-s',f.name,...paneCommandArgs(f.bin)).status,0);
 let seen;
 for(const until=Date.now()+4000;Date.now()<until;await sleep(40)){
  seen=core.observeSession(f.name);if(seen.state==='idle'&&seen.harness_alive===true)break;
 }
 assert.equal(seen.state,'idle');
 writeAgentMetadata({...f.meta,startup_processes:Object.keys(JSON.parse(Buffer.from(seen.activity.cursor,'base64url').toString()).processes)});
 assert.equal(core.observeSession(f.name).activity.post_startup_process_count,0);
 assert.notEqual((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 assert.equal(native('has-session','-t',f.name).status,0);assert.equal(readAgentLifecycle(f.meta),null);
});

test('automatic session names preserve a hibernated logical name',{skip,timeout:15000},async t=>{
 const f=await fixture(t,{seatName:'t1'});assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 const [name]=core.openSession();assert.notEqual(name,'t1');
 assert.equal(readAgentLifecycle(f.meta).state,'hibernated');assert.equal(core.observeSession(f.name).state,'hibernated');
});

test('an automatically named fresh launch retries a real name collision without using the occupied terminal',{skip,timeout:15000},async t=>{
 const f=await fixture(t);core.openSession('initial-collision-guard');core.closeSession(f.name);
 const original=childProcess.spawnSync,bin=resolveTmux(),prefix=['-S',SOCK];let collided=false;
 t.mock.method(childProcess,'spawnSync',function(binary,args,options){
  if(!collided&&binary===bin&&args.includes('new-session')){
   collided=true;const at=args.indexOf('-s');assert.equal(args[at+1],'t1');
   assert.equal(original(bin,[...prefix,'new-session','-d','-s','t1',...paneCommandArgs('bash')],{encoding:'utf8'}).status,0);
  }
  return original(binary,args,options);
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const result=core.openAgent('codex',{agent_done:true,model:'fixture-model',reasoning_effort:'high',cwd:process.env.HOME});
 assert.equal(result.length,2);assert.equal(collided,true);assert.notEqual(result[0],'t1');
 assert.equal(original(bin,[...prefix,'has-session','-t','t1']).status,0);
 for(const until=Date.now()+2000;Date.now()<until;await sleep(30))if(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length===2)break;
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,2);
 assert.equal(original(bin,[...prefix,'capture-pane','-p','-t','t1'],{encoding:'utf8'}).stdout.includes(f.bin),false);
});

test('failure to save an initial receipt refuses CLI input and cleans only its actual empty terminal',{skip,timeout:15000},async t=>{
 const f=await fixture(t);core.openSession('initial-storage-guard');core.closeSession(f.name);const rename=fs.renameSync;
 t.mock.method(fs,'renameSync',function(from,to){if(to.endsWith('.resume-native.json'))throw Object.assign(new Error('fixture ENOSPC'),{code:'ENOSPC'});return rename(from,to);});
 syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 assert.throws(()=>core.openAgent('codex',{session_name:f.name,agent_done:true,model:'fixture-model',reasoning_effort:'high',cwd:process.env.HOME}),/ENOSPC/);
 assert.equal(spawnSync(resolveTmux(),['-S',SOCK,'has-session','-t',f.name]).status,1);
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,1);
});

test('a missing actual create receipt never adopts the current same-name native terminal',{skip,timeout:15000},async t=>{
 const f=await fixture(t);core.openSession('initial-receipt-guard');core.closeSession(f.name);const original=childProcess.spawnSync,bin=resolveTmux();
 t.mock.method(childProcess,'spawnSync',function(binary,args,options){const result=original(binary,args,options);
  return binary===bin&&args.includes('new-session')&&args.includes(f.name)&&result.status===0?{...result,stdout:''}:result;
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 assert.throws(()=>core.openAgent('codex',{session_name:f.name,agent_done:true,model:'fixture-model',reasoning_effort:'high',cwd:process.env.HOME}),/AGENT_RESUME_UNCONFIRMED/);
 assert.equal(original(bin,['-S',SOCK,'has-session','-t',f.name]).status,0);
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,1);
});

// 0.63.12からfresh launchは別processのagent-send lockを見ない（native-runtime.md）。同じprocessは同期の作成に割り込めないので、残る競合は休止の記録だけ。
test('initial creation preserves old state when lifecycle changes after native creation',{skip,timeout:15000},async t=>{
 const f=await fixture(t);core.openSession('initial-admission-guard');
 assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 const saved=fs.readFileSync(f.lifecycle,'utf8'),savedMeta=fs.readFileSync(agentMetadataPath(f.name,f.meta.launch_id),'utf8');fs.rmSync(f.lifecycle);
 const original=childProcess.spawnSync,bin=resolveTmux();let injected=false;
 t.mock.method(childProcess,'spawnSync',function(binary,args,options){const result=original(binary,args,options);
  if(!injected&&binary===bin&&args.includes('new-session')&&args.includes(f.name)&&result.status===0){
   injected=true;fs.writeFileSync(f.lifecycle,saved);
  }
  return result;
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 assert.throws(()=>core.openAgent('codex',{session_name:f.name,agent_done:true,model:'fixture-model',reasoning_effort:'high',cwd:process.env.HOME}),/AGENT_RESUME_REQUIRED/);
 assert.equal(injected,true);assert.equal(fs.readFileSync(agentMetadataPath(f.name,f.meta.launch_id),'utf8'),savedMeta);
 assert.equal(fs.readFileSync(f.lifecycle,'utf8'),saved);
 assert.equal(original(bin,['-S',SOCK,'has-session','-t',f.name]).status,1);
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,1);
});

test('a corrupted initial launch record with native proof remains a managed failure',{skip,timeout:15000},async t=>{
 const f=await fixture(t);fs.writeFileSync(agentMetadataPath(f.name,f.meta.launch_id),'broken metadata');
 assert.throws(()=>core.isAgentSession(f.name),/AGENT_RESUME_UNCONFIRMED/);
});

test('closing an initial launch can remove its original exited pane without resuming it',{skip,timeout:15000},async t=>{
 const f=await fixture(t);core.openSession('initial-exited-guard');
 const proof=JSON.parse(fs.readFileSync(agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume-native.json'),'utf8'));
 assert.equal(spawnSync(resolveTmux(),['-S',SOCK,'set-option','-t',f.name,'remain-on-exit','on']).status,0);
 process.kill(proof.pane_pid,'SIGKILL');
 for(const until=Date.now()+3000;Date.now()<until;await sleep(30)){
  if(spawnSync(resolveTmux(),['-S',SOCK,'display-message','-p','-t',proof.pane_id,'#{pane_dead}'],{encoding:'utf8'}).stdout.trim()==='1')break;
 }
 assert.equal(core.closeSessionResult(f.name).outcome,'closed');
 assert.equal(spawnSync(resolveTmux(),['-S',SOCK,'has-session','-t',f.name]).status,1);
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,1);
});

test('closing a vanished initial native terminal cleans only the unchanged registration',{skip,timeout:15000},async t=>{
 const f=await fixture(t);core.openSession('initial-vanished-guard');
 assert.equal(spawnSync(resolveTmux(),['-S',SOCK,'kill-session','-t',f.name]).status,0);
 assert.equal(core.closeSessionResult(f.name).outcome,'already_closed');
 assert.equal(fs.existsSync(agentMetadataPath(f.name,f.meta.launch_id)),false);
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,1);
});

for(const settings of [
 {model:'different-model',effort:'high',fast:false},
 {model:'fixture-model',effort:'low',fast:false},
 {model:'fixture-model',effort:'high',fast:true},
])test(`idle does not use an old turn context after native settings change to ${JSON.stringify(settings)}`,{skip,timeout:15000},async t=>{
 const f=await fixture(t,{nativeSettings:settings});
 assert.equal((await core.checkAgentIdle(f.expected)).outcome,'skipped');
 assert.equal(core.observeSession(f.name).harness_alive,true);assert.equal(readAgentLifecycle(f.meta),null);
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,1);
});

for(const change of ['screen','attachment'])test(`a native ${change} change after settings inspection prevents the first stop signal`,{skip,timeout:15000},async t=>{
 const f=await fixture(t),original=childProcess.spawnSync,rename=fs.renameSync,bin=resolveTmux();let prepared=false;
 t.mock.method(fs,'renameSync',function(from,to){const r=rename(from,to);if(to===f.lifecycle)prepared=true;return r;});
 t.mock.method(childProcess,'spawnSync',function(binary,args,options){const r=original(binary,args,options);
  if(prepared&&binary===bin&&r.status===0){
   if(change==='screen'&&args.includes('capture-pane'))return {...r,stdout:r.stdout+'\nNative settings changed\n'};
   if(change==='attachment'&&args.includes('display-message')&&args.some(x=>x.includes('session_last_attached'))){
    const parts=r.stdout.trim().split('\t');parts[3]=String(Math.floor(Date.now()/1000)+1);return {...r,stdout:parts.join('\t')+'\n'};
   }
  }
  return r;
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 assert.equal((await core.checkAgentIdle(f.expected)).outcome,'skipped');assert.equal(prepared,true);
 assert.equal(core.observeSession(f.name).harness_alive,true);assert.equal(readAgentLifecycle(f.meta),null);
});

for(const operation of ['force','key'])test(`another same-process ${operation} operation cannot join the idle inspector's admission`,{skip,timeout:15000},async t=>{
 const f=await fixture(t),foreign=new AsyncResource('separate-input-request'),original=childProcess.spawnSync,bin=resolveTmux();let checked=false,failure;
 t.mock.method(childProcess,'spawnSync',function(binary,args,options){const result=original(binary,args,options);
  if(!checked&&binary===bin&&args.includes('capture-pane')&&result.stdout?.includes('Configure Status Line')){
   checked=true;foreign.runInAsyncScope(()=>{try{
    if(operation==='force')core.send(f.name,'FOREIGN_INPUT',{force:true,enter:false,raw:true});else core.sendKey(f.name,'X');
   }catch(error){failure=error;}});
  }
  return result;
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();foreign.emitDestroy();});
 const result=await core.checkAgentIdle(f.expected);
 assert.equal(checked,true);assert.match(failure?.message??'',/AGENT_RESUME_UNCONFIRMED/);
 assert.equal(result.outcome,'hibernated');
});

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
 assert.equal((await core.readAgentTranscriptResult(f.name,{raw:true})).text,'Done');
 assert.equal(core.observeSession(bridge).exists,true);
 assert.equal((await core.checkAgentIdle(f.expected)).outcome,'skipped');
 assert.equal(readAgentLifecycle(f.meta).state,'hibernated');
 assert.deepEqual(core.interruptSessionNow(f.name,f.meta.launch_id),{session_id:f.name,outcome:'idle'});
 assert.throws(()=>core.interruptSessionNow(f.name,'f'.repeat(32)),error=>error.code==='EXECUTION_STALE_GENERATION');
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
  const raw=spawnSync(resolveTmux(),['-S',SOCK,'new-session','-d','-s',f.name,...paneCommandArgs('bash')],{encoding:'utf8'});assert.equal(raw.status,0);
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

for(const state of ['hibernated','stopping','resuming','failed'])test(`dormant ${state} refuses keys, native reads, interruption and approval on a same-name replacement`,{skip,timeout:15000},async t=>{
 const f=await fixture(t);assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 const saved=readAgentLifecycle(f.meta);
 if(state==='stopping')writeAgentLifecycle(f.meta,{...saved,state});
 if(state==='resuming'||state==='failed')writeAgentResumeAttempt(f.meta,{schema:'aiterm.agent-resume-attempt.v1',launch_id:f.meta.launch_id,
  next_launch_id:'e'.repeat(32),recipe_digest:saved.recipe_digest,state,at:new Date().toISOString()});
 const native=(...args)=>spawnSync(resolveTmux(),['-S',SOCK,...args],{encoding:'utf8'});
 assert.equal(native('new-session','-d','-s',f.name,...paneCommandArgs('bash')).status,0);
 const marker=f.keys+'-unrelated-enter';native('send-keys','-t',f.name,'-l','--',`touch '${marker}'`);
 assert.throws(()=>core.sendKeyResult(f.name,'Enter'),/AGENT_RESUME_UNCONFIRMED/);
 await assert.rejects(core.readOutput(f.name,{screen:true,raw:true}),/AGENT_RESUME_UNCONFIRMED/);
 assert.throws(()=>core.interruptSessionNow(f.name),/AGENT_RESUME_UNCONFIRMED/);
 for(const action of ['inspect','respond']){
  const request={action,session_id:f.name,...(action==='respond'?{approval_choice:'approve_once',observed_prompt_digest:'sha256:'+ 'a'.repeat(64)}:{})};
  assert.throws(()=>core.runAgentApproval(request),/AGENT_RESUME_UNCONFIRMED/);
  assert.throws(()=>core.runClaudeApproval(request),/AGENT_RESUME_UNCONFIRMED/);
 }
 assert.equal(fs.existsSync(marker),false);assert.equal(native('has-session','-t',f.name).status,0);
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,1);
});

test('a damaged dormant record cannot become an ordinary PTY or a missing seat',{skip,timeout:15000},async t=>{
 const f=await fixture(t);assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 fs.writeFileSync(agentMetadataPath(f.name,f.meta.launch_id),'{invalid');
 assert.throws(()=>core.isAgentSession(f.name),/AGENT_RESUME_UNCONFIRMED/);
 assert.throws(()=>core.observeSession(f.name),/AGENT_RESUME_UNCONFIRMED/);
 assert.throws(()=>core.sendKeyResult(f.name,'Enter'),/AGENT_RESUME_UNCONFIRMED/);
 await assert.rejects(core.readOutput(f.name,{screen:true}),/AGENT_RESUME_UNCONFIRMED/);
 assert.equal(readAgentLifecycle(f.meta).state,'hibernated');
});

// 別processからの入力の排他は0.63.12から呼び手の受け持ち（native-runtime.md「Managed-agent first-input ownership」）。

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
 assert.equal(attempt.state,'failed');
 const diagnosticFile=agentMetadataPath(f.name,attempt.next_launch_id).replace(/\.agent\.json$/,'.resume-failure.json');
 const diagnostic=JSON.parse(fs.readFileSync(diagnosticFile,'utf8'));
 assert.equal(diagnostic.phase,'readiness');assert.equal(diagnostic.readiness.status,'blocked');
 assert.equal(diagnostic.native_outcome,'unknown');assert.equal(diagnostic.attempt_record,'failed');
 assert.equal(diagnostic.previous_launch_id,f.meta.launch_id);assert.equal(diagnostic.launch_id,attempt.next_launch_id);
 assert(!JSON.stringify(diagnostic).includes('never-first'));core.closeSession(f.name);
 assert.equal(fs.existsSync(diagnosticFile),false);
 assert.equal(fs.existsSync(agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume-attempt.json')),false);
});

test('send resumes the same conversation once, preserves old records and restores explicit environment', {skip,timeout:30000},async t=>{
 const f=await fixture(t,{resumeEnv:true});assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 process.env.PEERTABLE_ROOM='caller room';process.env.PEERTABLE_MEMBER='caller member';process.env.AITERM_TEST_UNSET='caller value';
 const receipts=await Promise.all(['first-body','second-body'].map(text=>core.sendAgentMessage(f.name,text,{raw:true})));
 assert.equal(receipts[0].launch_id,receipts[1].launch_id);assert.notEqual(receipts[0].launch_id,f.meta.launch_id);
 const current=JSON.parse(fs.readFileSync(agentMetadataPath(f.name,receipts[0].launch_id),'utf8'));
 assert.equal(fs.existsSync(agentMetadataPath(f.name,current.launch_id).replace(/\.agent\.json$/,'.resume-failure.json')),false);
 assert.equal(current.vendor_session_id,f.meta.vendor_session_id);assert.equal(current.resumed_from,f.meta.launch_id);
 assert.equal(current.lineage,f.meta.lineage);assert.equal(current.delegation_depth,f.meta.delegation_depth);
 assert.equal(fs.existsSync(agentMetadataPath(f.name,f.meta.launch_id)),true);
 const launches=fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').map(JSON.parse);assert.equal(launches.length,2);
 assert.ok(launches[1].argv.includes('resume'));assert.ok(launches[1].argv.includes(f.meta.vendor_session_id));
 assert.equal(launches[1].room,"saved room ' $() ; #{pane_id} \\ literal");assert.equal(launches[1].member,';');assert.equal(launches[1].unset,null);
 assert.equal(fs.realpathSync(launches[1].cwd),fs.realpathSync(f.meta.cwd));
 const listed=core.listSessionsResult(['PEERTABLE_ROOM','PEERTABLE_MEMBER','AITERM_TEST_UNSET']).sessions.find(row=>row.session_id===f.name);
 assert.deepEqual(listed.environment,{PEERTABLE_ROOM:"saved room ' $() ; #{pane_id} \\ literal",PEERTABLE_MEMBER:';',AITERM_TEST_UNSET:null});
 const accepted=fs.readFileSync(f.keys,'utf8').trim().split('\n');assert.deepEqual(accepted,['first-body','second-body']);
});

for(const proof of ['bound','unbound'])test(`resume verifies a native queued turn before accepting a busy Codex (${proof})`,{skip,timeout:15000},async t=>{
 const f=await fixture(t,{resumeBusy:proof});
 assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 const rename=fs.renameSync;
 t.mock.method(fs,'renameSync',function(from,to){
  const result=rename(from,to);
  if(to.endsWith('/'+f.name+'.active-launch.json')&&JSON.parse(fs.readFileSync(to)).launch_id!==f.meta.launch_id){
   const code=`import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const deadline=Date.now()+5000;
while(Date.now()<deadline){
 if(fs.existsSync(${JSON.stringify(f.keys+'-resume-drawn')})){
  const s=spawnSync(${JSON.stringify(resolveTmux())},['-S',${JSON.stringify(SOCK)},'capture-pane','-p','-t',${JSON.stringify(f.name)}],{encoding:'utf8'});
  if(s.status===0&&s.stdout.includes('Working (1s • esc to interrupt)'))process.exit(0);
 }
 Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
}process.exit(1);`;
   assert.equal(spawnSync(process.execPath,['--input-type=module','-e',code]).status,0,'native queued frame is drawn before readiness is sampled');
  }
  return result;
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const request=core.openAgentWithInitialPrompt('codex',{session_name:f.name,prompt:null,ready_timeout:0});
 if(proof==='unbound'){
  await assert.rejects(request,error=>{
   assert.match(error.message,/AGENT_RESUME_FAILED/);
   assert.deepEqual(error.resumeFailure,{schema:'aiterm.agent-resume-error.v1',code:'AGENT_RESUME_FAILED',
    session_id:f.name,launch_id:core.observeSessionGeneration(f.name).launch_id,input:'not_sent',recovery:'inspect_session'});
   return true;
  });
 }else{
  const result=await request;
  assert.equal(result[5].status,'ready');
  assert.equal(result[4].status,'not_requested');
  const seen=core.observeSession(f.name);
  assert.equal(seen.state,'busy');assert.equal(seen.harness_alive,true);
  assert.equal(seen.activity.post_startup_process_count,null,'queued work cannot be saved as startup scaffolding');
  assert.notEqual(seen.launch_id,f.meta.launch_id);
  const attempt=JSON.parse(fs.readFileSync(agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume-attempt.json')));
  assert.equal(attempt.state,'ready');assert.equal(attempt.next_launch_id,seen.launch_id);
 }
 assert.equal(fs.existsSync(f.keys),false,'readiness never submits or replays a body');
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,2);
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
 const diagnostic=JSON.parse(fs.readFileSync(agentMetadataPath(f.name,attempt.next_launch_id).replace(/\.agent\.json$/,'.resume-failure.json'),'utf8'));
 assert.equal(diagnostic.phase,'native_identity');assert.equal(diagnostic.readiness,null);
 assert.equal(diagnostic.native_outcome,'unknown');assert.equal(diagnostic.attempt_record,'failed');
 assert.equal(diagnostic.cause.kind,'system');assert.equal(diagnostic.cause.code,'UNKNOWN');
});

for(const failure of ['ready_save','failed_save','diagnostic_save'])test(`resume diagnostics preserve primary failure when ${failure} fails`,{skip,timeout:20000},async t=>{
 const f=await fixture(t,{resumeBlocked:failure==='diagnostic_save'});
 assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 const original=fs.renameSync;let refused=0;
 t.mock.method(fs,'renameSync',function(from,to){
  if(to.endsWith('.resume-attempt.json')){
   const state=JSON.parse(fs.readFileSync(from,'utf8')).state;
   if(state==='ready'||(failure==='failed_save'&&state==='failed')){refused++;throw Object.assign(new Error('SECRET save refused'),{code:'EACCES'});}
  }
  if(failure==='diagnostic_save'&&to.endsWith('.resume-failure.json')){refused++;throw new Error('SECRET diagnostic refused');}
  return original(from,to);
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 // The save fault needs a real ready frame; macOS resume redraw takes seconds, so 500ms only ever reached readiness failure there.
 await assert.rejects(core.dispatchAgentTurn(f.name,'NEVER_BODY',{raw:true,ready_timeout:5000}),error=>{
  assert.equal(error.resumeFailure?.code,'AGENT_RESUME_FAILED');assert(!error.message.includes('SECRET'));return true;
 });
 assert.ok(refused>0);assert.equal(fs.existsSync(f.keys),false);
 const attempt=JSON.parse(fs.readFileSync(agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume-attempt.json'),'utf8'));
 assert.equal(attempt.state,failure==='failed_save'?'resuming':'failed');
 const diagnosticFile=agentMetadataPath(f.name,attempt.next_launch_id).replace(/\.agent\.json$/,'.resume-failure.json');
 if(failure==='diagnostic_save')assert.equal(fs.existsSync(diagnosticFile),false);
 else{
  const diagnostic=JSON.parse(fs.readFileSync(diagnosticFile,'utf8'));
  assert.equal(diagnostic.phase,'ready_save');assert.equal(diagnostic.readiness.status,'ready');
  assert.equal(diagnostic.attempt_record,failure==='failed_save'?'unknown':'failed');
  assert.equal(diagnostic.cause.code,'EACCES');assert.equal(diagnostic.native_outcome,'unknown');
 }
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
   for(const name of ['replacement-zero','replacement-one'])assert.equal(original(bin,[...prefix,'new-session','-d','-s',name,...paneCommandArgs('bash')],{encoding:'utf8'}).status,0);
  }else assert.equal(original(bin,[...prefix,'kill-session','-t',f.name],{encoding:'utf8'}).status,0);
  assert.equal(original(bin,[...prefix,'new-session','-d','-s',f.name,...paneCommandArgs('bash')],{encoding:'utf8'}).status,0);
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
  await core.sendAgentMessage(f.name,'accepted-on-original',{raw:true});
  core.sendKeyResult(f.name,'Escape');assert.match(await core.readOutput(f.name,{screen:true,raw:true}),/OpenAI Codex/);
  replace();
  assert.throws(()=>core.sendKeyResult(f.name,'Enter'),/AGENT_RESUME_UNCONFIRMED/);
  await assert.rejects(core.readOutput(f.name,{screen:true,raw:true}),/AGENT_RESUME_UNCONFIRMED/);
  assert.throws(()=>core.runAgentApproval({action:'inspect',session_id:f.name}),/AGENT_RESUME_UNCONFIRMED/);
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
 const f=await fixture(t);let replaced=false;const original=childProcess.spawnSync,bin=resolveTmux();
 t.mock.method(childProcess,'spawnSync',function(binary,args,options){
  const result=original(binary,args,options);
  if(!replaced&&binary===bin&&args.some(value=>['list-sessions','has-session'].includes(value))
   &&readAgentLifecycle(f.meta)?.state==='stopping'
   &&original(bin,['-S',SOCK,'has-session','-t',f.name]).status!==0){
   replaced=true;writeAgentMetadata({...f.meta,launch_id:'b'.repeat(32)});
   fs.unlinkSync(agentMetadataPath(f.name,f.meta.launch_id));
  }
  return result;
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const result=await core.checkAgentIdle(f.expected);
 assert.equal(replaced,true,JSON.stringify(result));assert.equal(result.outcome,'unconfirmed');
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


test('failed published resume recovers after its same native becomes ready without replaying the rejected body',{skip:linuxOnlyFailedRecovery,timeout:20000},async t=>{
 const f=await fixture(t,{resumeLater:true});assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 await assert.rejects(core.dispatchAgentTurn(f.name,'REJECTED_OLD_BODY',{raw:true,ready_timeout:250}),e=>e.resumeFailure?.input==='not_sent');
 const attemptPath=agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume-attempt.json');
 const failure=fs.readFileSync(attemptPath,'utf8'),attempt=JSON.parse(failure);assert.equal(attempt.state,'failed');
 fs.writeFileSync(f.keys+'-allow-ready','1');
 let screen='';for(const until=Date.now()+4000;Date.now()<until;await sleep(40)){
  screen=spawnSync(resolveTmux(),['-S',SOCK,'capture-pane','-p','-t',f.name],{encoding:'utf8'}).stdout;
  if(screen.includes('OpenAI Codex')&&screen.includes('fixture-model'))break;
 }
 assert(screen.includes('OpenAI Codex'),'same native reached a normal composer after the failed call');
 const receipt=await core.dispatchAgentTurn(f.name,'CURRENT_BODY',{raw:true,ready_timeout:1000});
 assert.equal(receipt.launch_id,attempt.next_launch_id);assert.equal(fs.readFileSync(attemptPath,'utf8'),failure,'old failed history is immutable');
 assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,2,'no third CLI');
 assert.deepEqual(fs.readFileSync(f.keys,'utf8').trim().split('\n'),['CURRENT_BODY']);
});

test('failed published Codex resumes the same vendor in a new native after the old native is gone',{skip:linuxOnlyFailedRecovery,timeout:20000},async t=>{
 const f=await fixture(t,{resumeLater:true});core.openSession('cold-server-guard');
 assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 await assert.rejects(core.dispatchAgentTurn(f.name,'OLD_REJECTED',{raw:true,ready_timeout:250}),e=>e.resumeFailure?.input==='not_sent');
 const attemptFile=agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume-attempt.json');
 const failedBytes=fs.readFileSync(attemptFile,'utf8'),attempt=JSON.parse(failedBytes);
 const before=JSON.parse(fs.readFileSync(agentMetadataPath(f.name,attempt.next_launch_id).replace(/\.agent\.json$/,'.resume-native.json'),'utf8'));
 assert.equal(spawnSync(resolveTmux(),['-S',SOCK,'kill-session','-t',f.name]).status,0);
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
});

for(const obstruction of ['orphan','unknown-list','root-replaced','vendor-mismatch'])test('cold failed recovery refuses '+obstruction+' without creating or sending',{skip,timeout:20000},async t=>{
 const f=await fixture(t,{resumeLater:true});core.openSession('cold-negative-guard');
 assert.equal((await core.checkAgentIdle(f.expected)).outcome,'hibernated');
 await assert.rejects(core.dispatchAgentTurn(f.name,'OLD',{raw:true,ready_timeout:250}),e=>e.resumeFailure?.input==='not_sent');
 assert.equal(spawnSync(resolveTmux(),['-S',SOCK,'kill-session','-t',f.name]).status,0);
 fs.writeFileSync(f.keys+'-allow-ready','1');
 if(obstruction==='orphan'){
  const child=childProcess.spawn(process.execPath,['-e','setInterval(()=>{},1000)',f.meta.vendor_session_id],{stdio:'ignore'});
  t.after(()=>child.kill());await new Promise(resolve=>child.once('spawn',resolve));
 }
 if(obstruction==='unknown-list'){
  const original=childProcess.spawnSync;t.mock.method(childProcess,'spawnSync',function(bin,args,options){
   if(bin===resolveTmux()&&args.includes('list-sessions'))return {status:2,stdout:'',stderr:'fixture list unavailable'};
   return original(bin,args,options);
  });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 }
 if(obstruction==='vendor-mismatch'){
  const attempt=JSON.parse(fs.readFileSync(agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume-attempt.json'),'utf8'));
  const changed=JSON.parse(fs.readFileSync(agentMetadataPath(f.name,attempt.next_launch_id),'utf8'));
  writeAgentMetadata({...changed,vendor_session_id:'11111111-2222-4333-8444-999999999999'});
 }
 if(obstruction==='root-replaced'){const body=fs.readFileSync(f.rollout);fs.renameSync(f.rollout,f.rollout+'.original');fs.writeFileSync(f.rollout,body);}
 try {
  await assert.rejects(core.dispatchAgentTurn(f.name,'MUST_NOT_SEND',{raw:true,ready_timeout:500}),e=>e.resumeFailure?.input==='not_sent');
  assert.equal(fs.readFileSync(f.keys+'-launches','utf8').trim().split('\n').length,2);
  assert.equal(fs.existsSync(f.keys),false);
 } finally { if(obstruction==='unknown-list'){t.mock.restoreAll();syncBuiltinESMExports();} }
});

test('restart-only resumes a killed working conversation without an idle recipe and preserves idle resume', {skip,timeout:30000},async t=>{
 const f=await fixture(t);core.openSession('restart-working-bridge');
 const recipeFile=agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume.json');
 fs.rmSync(recipeFile);
 assert.equal(readAgentLifecycle(f.meta),null);
 const unavailable=error=>error.resumeUnavailable?.code==='AGENT_RESUME_UNAVAILABLE';
 // A still-live native session is never adopted as a restart target.
 await assert.rejects(core.openAgentWithInitialPrompt('codex',{session_name:f.name,require_existing_resume:true}),unavailable);
 assert.equal(fs.existsSync(recipeFile),false);
 fs.appendFileSync(f.rollout,JSON.stringify({timestamp:new Date().toISOString(),type:'event_msg',payload:{type:'task_started',turn_id:'working-at-restart'}})+'\n');
 assert.equal(spawnSync(resolveTmux(),['-S',SOCK,'kill-session','-t',f.name]).status,0);
 writeAgentMetadata({...f.meta,vendor_session_id:null});
 fs.renameSync(f.rollout,f.rollout+'.hidden');
 await assert.rejects(core.openAgentWithInitialPrompt('codex',{session_name:f.name,require_existing_resume:true}),unavailable);
 fs.renameSync(f.rollout+'.hidden',f.rollout);
 assert.equal(readAgentLifecycle(f.meta),null);assert.equal(fs.existsSync(recipeFile),false);
 writeAgentMetadata(f.meta);
 await assert.rejects(core.openAgentWithInitialPrompt('codex',{session_name:f.name,require_existing_resume:true,model:'different-model'}),unavailable);
 assert.equal(readAgentLifecycle(f.meta),null);
 const result=await core.openAgentWithInitialPrompt('codex',{session_name:f.name,require_existing_resume:true,ready_timeout:3000});
 assert.equal(result[0],f.name);assert.equal(result[4].status,'not_requested');assert.equal(result[5].status,'ready');
 const next=loadAgentMetadata(f.name);
 assert.equal(next.vendor_session_id,f.meta.vendor_session_id);assert.equal(next.resumed_from,f.meta.launch_id);
 const oldLifecycle=readAgentLifecycle(f.meta);assert.equal(oldLifecycle.state,'hibernated');assert.equal(oldLifecycle.origin,'restart');
 assert.equal('pane' in oldLifecycle,false);assert.equal('native_id' in oldLifecycle,false);
 assert.equal(readAgentLifecycle(next),null);
 assert.equal(fs.existsSync(f.keys),false,'no old business input was replayed');
 const unpinned=await fixture(t,{recipe:false});
 const records=fs.readFileSync(unpinned.rollout,'utf8').trim().split('\n').map(JSON.parse);
 records[0].payload.cwd=unpinned.meta.cwd;
 records[2].payload={turn_id:'default-working',cwd:unpinned.meta.cwd,model:'fixture-model',
  collaboration_mode:{settings:{model:'fixture-model',reasoning_effort:null}}};
 records.splice(3,records.length-3,{type:'event_msg',payload:{type:'task_started',turn_id:'default-working'}});
 const retained=records.map(JSON.stringify).join('\n')+'\n';
 fs.writeFileSync(unpinned.rollout,retained);
 writeAgentMetadata({...unpinned.meta,vendor_session_id:null,model:null});
 assert.equal(spawnSync(resolveTmux(),['-S',SOCK,'kill-session','-t',unpinned.name]).status,0);
 const other=unpinned.rollout.replace('.jsonl','-mixed.jsonl');fs.writeFileSync(other,retained);
 await assert.rejects(core.openAgentWithInitialPrompt('codex',{session_name:unpinned.name,require_existing_resume:true}),unavailable);
 fs.rmSync(other);
 records[0].payload.forked_from_id=unpinned.meta.vendor_session_id;
 fs.writeFileSync(unpinned.rollout,records.map(JSON.stringify).join('\n')+'\n');
 await assert.rejects(core.openAgentWithInitialPrompt('codex',{session_name:unpinned.name,require_existing_resume:true}),unavailable);
 delete records[0].payload.forked_from_id;
 fs.writeFileSync(unpinned.rollout,retained.slice(0,-1));
 await assert.rejects(core.openAgentWithInitialPrompt('codex',{session_name:unpinned.name,require_existing_resume:true}),unavailable);
 fs.writeFileSync(unpinned.rollout,retained);
 const defaultResult=await core.openAgentWithInitialPrompt('codex',{session_name:unpinned.name,require_existing_resume:true,ready_timeout:3000});
 assert.equal(defaultResult[5].status,'ready');assert.equal(defaultResult[4].status,'not_requested');
 const defaultNext=loadAgentMetadata(unpinned.name);
 assert.equal(defaultNext.vendor_session_id,unpinned.meta.vendor_session_id);assert.equal(defaultNext.model,'fixture-model');
 const saved=JSON.parse(fs.readFileSync(agentMetadataPath(defaultNext.aiterm_session,defaultNext.launch_id).replace(/\.agent\.json$/,'.resume.json'),'utf8'));
 assert.equal(saved.reasoning_effort,null);assert.equal(saved.reasoning_effort_source,'vendor_default');
 const launch=fs.readFileSync(unpinned.keys+'-launches','utf8').trim().split('\n').map(JSON.parse).findLast(item=>item.argv[0]==='resume');
 assert.ok(launch.argv.includes(unpinned.meta.vendor_session_id));assert.ok(launch.argv.includes('fixture-model'));
 assert.equal(launch.argv.some(arg=>arg.startsWith('model_reasoning_effort=')),false);
 assert.equal(fs.existsSync(unpinned.keys),false);
 const idle=await fixture(t);assert.equal((await core.checkAgentIdle(idle.expected)).outcome,'hibernated');
 assert.equal(readAgentLifecycle(idle.meta).origin,undefined);
 const idleResult=await core.openAgentWithInitialPrompt('codex',{session_name:idle.name,require_existing_resume:true,ready_timeout:3000});
 assert.equal(idleResult[5].status,'ready');assert.equal(idleResult[4].status,'not_requested');
});
