import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import * as core from '../dist/core.js';
import {agentMetadataPath,writeAgentMetadata,ensureStateRoot} from '../dist/agent-shared.js';
import {readAgentLifecycle,writeAgentResumeRecipe} from '../dist/agent-lifecycle.js';
import {requireExecutionEffectScope,withExecutionEffectScope} from '../dist/execution-effect.js';
import {deliveryOwnerPrefix} from '../dist/parent-delivery-owners.js';

const skip=process.platform==='win32'?'POSIX tmux fixture':false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let serial=0;
async function fixture(t,{recipe=true}={}){
 const tag='idle-core-'+ ++serial,bin=join(process.env.HOME,tag+'-codex.sh'),driver=join(process.env.HOME,tag+'-driver.mjs');
 const keys=join(process.env.HOME,tag+'-input'),spawnFlag=join(process.env.HOME,tag+'-spawn'),spawned=join(process.env.HOME,tag+'-spawned');
 fs.mkdirSync(process.env.CODEX_HOME,{recursive:true});
 fs.writeFileSync(bin,`#!/bin/sh\n'${process.execPath.replaceAll("'","'\\''")}' '${driver}'\n`,{mode:0o700});
 fs.writeFileSync(driver,`import fs from 'node:fs';import {spawn} from 'node:child_process';
let line='',added=false;
const draw=()=>process.stdout.write('\\x1b[H\\x1b[2JOpenAI Codex\\n› '+line+'\\x1b[K\\n  mock-model default · /tmp/proj\\x1b[K\\n\\x1b[J');
process.stdin.setRawMode(true);process.stdin.resume();draw();
process.stdin.on('data',bytes=>{for(const ch of bytes.toString().replace(/\\x1b\\[20[01]~/g,'')){
 if(ch==='\\r'){fs.appendFileSync(${JSON.stringify(keys)},line+'\\n');line='';}else if(ch>=' '){line+=ch;}}
 fs.writeFileSync(${JSON.stringify(keys+'-draft')},line);draw();});
setInterval(()=>{if(!added&&fs.existsSync(${JSON.stringify(spawnFlag)})){
 added=true;const child=spawn(process.execPath,['-e','setInterval(()=>{},60000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(spawned)},String(child.pid));
}},10);`);
 process.env.CODEX_BIN=bin;core.__testSetAgentTuiReadyStableSamples(1);
 t.after(()=>{core.__testSetAgentTuiReadyStableSamples(null);core.killAll();});
 const [name]=core.openAgent('codex',{session_name:tag,agent_done:true,cwd:process.env.HOME});
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
  event('task_started'),event('task_complete',{last_agent_message:'Done'})].map(JSON.stringify).join('\n')+'\n');
 if(recipe)writeAgentResumeRecipe(meta,{schema:'aiterm.agent-resume.v1',launch_id:meta.launch_id,kind:'codex',
  vendor_session_id:meta.vendor_session_id,executable:bin,cwd:process.env.HOME,model:meta.model,reasoning_effort:null,
  fast:meta.fast,environment:{PEERTABLE_ROOM:'artificial',PEERTABLE_MEMBER:'fixture'}});
 const expected={session_id:name,launch_id:meta.launch_id};
 return {name,meta,expected,keys,spawnFlag,spawned,rollout,
  lifecycle:agentMetadataPath(name,meta.launch_id).replace(/\.agent\.json$/,'.lifecycle.json')};
}

test('ordinary core hibernates only the expected idle pane, retaining its resume data', {skip,timeout:30000},async t=>{
 const f=await fixture(t);const [bridge]=core.openSession('ordinary-bridge');
 assert.equal(core.observeSession(f.name).activity.post_startup_process_count,0);
 const result=await core.checkAgentIdle(f.expected);
 assert.equal(result.outcome,'hibernated',JSON.stringify(result));
 const lifecycle=readAgentLifecycle(f.meta);assert.equal(lifecycle.state,'hibernated');
 assert.equal(lifecycle.launch_id,f.meta.launch_id);assert.match(lifecycle.native_id,/^\$\d+$/);
 assert.equal(fs.existsSync(agentMetadataPath(f.name,f.meta.launch_id)),true);
 assert.equal(core.observeSession(f.name).exists,false,'logical public listing is a later integration');
 assert.equal(core.observeSession(bridge).exists,true);
 assert.equal((await core.checkAgentIdle(f.expected)).outcome,'skipped');
 assert.equal(readAgentLifecycle(f.meta).state,'hibernated');
 core.closeSession(f.name);assert.equal(readAgentLifecycle(f.meta),null);
 assert.equal(fs.existsSync(agentMetadataPath(f.name,f.meta.launch_id).replace(/\.agent\.json$/,'.resume.json')),false);
});

test('recipe absence and an outdated launch never terminate an idle seat',{skip,timeout:15000},async t=>{
 const f=await fixture(t,{recipe:false});
 assert.equal((await core.checkAgentIdle(f.expected)).reason,'resume_unavailable');
 assert.equal((await core.checkAgentIdle({...f.expected,launch_id:'b'.repeat(32)})).outcome,'skipped');
 assert.equal(core.observeSession(f.name).harness_alive,true);assert.equal(readAgentLifecycle(f.meta),null);
});

for(const kind of ['background','delivery'])test(`a ${kind} added after preparation cancels before the first signal`,
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
  if(!replaced&&core.observeSession(f.name).exists===false){
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
