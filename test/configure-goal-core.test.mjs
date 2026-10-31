import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdirSync,writeFileSync,readFileSync,appendFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {WebSocketServer} from 'ws';
import * as core from '../dist/core.js';
import {agentMetadataPath,writeAgentMetadata} from '../dist/agent-shared.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('configureAgent pauses a live goal and waits for native completion even when the pane already looks idle',
  {skip:process.platform==='win32'?'POSIX native goal socket':false,timeout:20000},async t=>{
  const home=process.env.CODEX_HOME, bin=join(process.env.HOME,'codex-fixture.sh'), seat=join(process.env.HOME,'codex-seat.mjs');
  mkdirSync(home,{recursive:true,mode:0o700});
  writeFileSync(bin,`#!/bin/sh\n'${process.execPath.replaceAll("'","'\\''")}' '${seat}'\n`,{mode:0o700});
  writeFileSync(seat,`process.stdout.write('OpenAI Codex\\n› Ask Codex to do anything\\n  mock-model default · /tmp/proj\\n');
if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.resume();setInterval(()=>{},60000);`);
  process.env.CODEX_BIN=bin;core.__testSetAgentTuiReadyStableSamples(1);
  t.after(()=>{core.__testSetAgentTuiReadyStableSamples(null);core.killAll();});
  const [session]=core.openAgent('codex',{agent_done:true,cwd:process.env.HOME});
  let observed;
  for(const until=Date.now()+5000;Date.now()<until;await sleep(50)){
    observed=core.observeSession(session);if(observed.state==='idle'&&observed.harness_alive)break;
  }
  assert.equal(observed.state,'idle');assert.equal(observed.harness_alive,true);
  const launch=observed.launch_id;
  const meta=JSON.parse(readFileSync(agentMetadataPath(session,launch),'utf8'));
  meta.vendor_session_id='11111111-2222-4333-8444-555555555555';meta.fast=false;writeAgentMetadata(meta);
  const directory=join(home,'sessions');mkdirSync(directory,{recursive:true});
  const rollout=join(directory,`rollout-${meta.vendor_session_id}.jsonl`);
  const event=(type,extra={})=>JSON.stringify({type:'event_msg',payload:{type,turn_id:'current-turn',...extra}})+'\n';
  writeFileSync(rollout,[JSON.stringify({type:'session_meta',payload:{id:meta.vendor_session_id,originator:'codex-tui',source:'cli'}}),
    JSON.stringify({type:'response_item',payload:{type:'message',role:'developer',content:[{type:'input_text',text:`AITERM_AGENT_LAUNCH_ID=${launch}`}]}})].join('\n')+'\n'+event('task_started'));
  const control=join(home,'app-server-control');mkdirSync(control,{mode:0o700});
  const socket=join(control,'app-server-control.sock'),http=createServer(), ws=new WebSocketServer({server:http});
  const effects=[];
  let goal={threadId:meta.vendor_session_id,objective:'Original',status:'active',tokenBudget:null,tokensUsed:0,timeUsedSeconds:0,createdAt:1,updatedAt:1};
  ws.on('connection',client=>client.on('message',bytes=>{
    const {id,method,params}=JSON.parse(bytes.toString());if(id===undefined)return;
    let result;
    if(method==='initialize')result={userAgent:'fixture'};
    else if(method==='thread/loaded/list')result={data:[meta.vendor_session_id],nextCursor:null};
    else if(method==='thread/read')result={thread:{id:meta.vendor_session_id,source:'cli'}};
    else if(method==='thread/goal/get')result={goal};
    else if(method==='thread/goal/set'){
      assert.equal(params.threadId,meta.vendor_session_id);effects.push(params.status);
      goal={...goal,status:params.status,updatedAt:goal.updatedAt+1};result={goal};
    }else throw Error('Unexpected RPC '+method);
    client.send(JSON.stringify({id,result}));
  }));
  http.listen(socket);await once(http,'listening');chmodSync(socket,0o600);
  t.after(async()=>{for(const client of ws.clients)client.terminate();await new Promise(resolve=>ws.close(resolve));await new Promise(resolve=>http.close(resolve));});
  let finished=false;
  const pending=core.configureAgent(session,{fast:false}).then(value=>{finished=true;return value;});
  // Attach rejection handling before a failing assertion can tear down the fixture.
  pending.catch(()=>{});
  for(const until=Date.now()+5000;!effects.includes('paused')&&Date.now()<until;await sleep(40)){}
  assert.deepEqual(effects,['paused']);
  await sleep(600);assert.equal(finished,false,'an idle-looking screen cannot replace the native turn-end record');
  appendFileSync(rollout,event('task_complete',{last_agent_message:'Done'}));
  const result=await pending;
  assert.equal(result.fast,false);assert.deepEqual(effects,['paused','active']);
  assert.equal(core.observeSession(session).launch_id,launch);
});
