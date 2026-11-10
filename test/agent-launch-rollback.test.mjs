import './seat-env.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {core,skip} from './core-agent-support.mjs';
import {SOCKDIR, SOCK, WIN_NS, resolveTmux, paneCommandArgs} from '../dist/tmux-runtime.js';

const win=process.platform==='win32';
// The conditional wrapper quotes its inner command with ' on POSIX and " on psmux.
const inner=(args,command)=>args.some(arg=>new RegExp(`^['"]${command}['"]`).test(String(arg)));

// psmux takes the environment on new-session itself; the registered-keys option is written on POSIX only.
for(const fault of ['identity','server_identity','log','offset',...(win?[]:['environment']),'marker','marker_ack','rename','pipe'])test(`failed native setup rolls back ${fault} and permits the same name`,{skip},t=>{
  const name=`rollback_${fault}`,spawn=childProcess.spawnSync,write=fs.writeFileSync,read=fs.readFileSync;
  let pane=null,injected=false;
  t.mock.method(fs,'writeFileSync',function(file,...args){
    if((fault==='log'||fault==='offset')&&String(file)===path.join(SOCKDIR,`${name}.${fault}`)){
      injected=true;throw Object.assign(new Error(`fixture ${fault} write failed`),{code:'EACCES'});
    }
    return write(file,...args);
  });
  t.mock.method(fs,'readFileSync',function(file,...args){
    if(['identity','server_identity'].includes(fault)&&pane!==null&&String(file)===`/proc/${pane}/stat`){
      injected=true;throw Object.assign(new Error('fixture birth read failed'),{code:'EACCES'});
    }
    return read(file,...args);
  });
  t.mock.method(childProcess,'spawnSync',function(binary,args,options){
    if(['identity','server_identity'].includes(fault)&&pane!==null&&((binary==='ps'&&args.join(' ')===`-o lstart= -p ${pane}`)
      ||options?.env?.AITERMMCP_PROCESS_IDS?.split(',').includes(String(pane)))){
      injected=true;return {status:1,stdout:'',stderr:'fixture birth read failed'};
    }
    if((fault==='environment'&&args.some(arg=>String(arg).includes('@aiterm_env_keys')))
      ||(fault==='marker'&&args.some(arg=>String(arg).includes('@aiterm_create_token')))
      ||(fault==='rename'&&inner(args,'set-window-option'))
      ||(fault==='pipe'&&inner(args,'pipe-pane'))){
      // Do not intercept the rollback condition, which also mentions the marker.
      if(fault!=='marker'||inner(args,'set-option')){
        injected=true;return {status:1,stdout:'',stderr:`fixture ${fault} registration failed`};
      }
    }
    const result=spawn(binary,args,options);
    if(args.includes('new-session')&&args.includes(name)&&result.status===0)
      pane=Number(result.stdout.trim().split(/\s+/)[fault==='server_identity'?2:4]);
    if(fault==='marker_ack'&&inner(args,'set-option')&&args.some(arg=>String(arg).includes('@aiterm_create_token'))){
      injected=true;return {...result,status:1,stderr:'fixture marker acknowledgement failed'};
    }
    return result;
  });
  syncBuiltinESMExports();
  let failure;
  try{core.openAgent('claude',{session_name:name,agent_done:true,cwd:process.env.HOME});}
  catch(error){failure=error;}
  finally{t.mock.restoreAll();syncBuiltinESMExports();}
  assert.ok(failure,'setup failure must be returned');
  assert.equal(injected,true,'the requested fault was exercised');
  assert.equal(core.listSessionsResult().sessions.some(row=>row.session_id===name),false,'no named native remnant');
  assert.equal(core.openAgent('claude',{session_name:name,agent_done:true,cwd:process.env.HOME})[0],name);
  core.closeSession(name);
});

for(const state of ['absent','present'])test(`a failed close ${state==='present'?'is unconfirmed while the created native remains':'is finished when the created native is already gone'}`,{skip},t=>{
  const name=`rollback_close_${state}`,spawn=childProcess.spawnSync,write=fs.writeFileSync;
  const native=resolveTmux(),prefix=win?['-L',WIN_NS]:['-S',SOCK];
  core.openSession(`rollback_close_anchor_${state}`);
  t.mock.method(fs,'writeFileSync',function(file,...args){
    if(String(file)===path.join(SOCKDIR,`${name}.log`))throw new Error('fixture setup failed');
    return write(file,...args);
  });
  t.mock.method(childProcess,'spawnSync',function(binary,args,options){
    if(args.includes('if-shell')&&inner(args,'kill-session')){
      if(state==='absent')assert.equal(spawn(native,[...prefix,'kill-session','-t',name],{encoding:'utf8'}).status,0);
      else return {status:1,stdout:'',stderr:'fixture close failed'};
    }
    return spawn(binary,args,options);
  });
  syncBuiltinESMExports();
  let failure;
  try{core.openAgent('claude',{session_name:name,agent_done:true,cwd:process.env.HOME});}
  catch(error){failure=error;}
  finally{t.mock.restoreAll();syncBuiltinESMExports();}
  assert.match(failure.message,/fixture setup failed/);
  assert.equal(/creation_rollback_unconfirmed/.test(failure.message),state==='present');
  assert.equal(spawn(native,[...prefix,'has-session','-t',name],{encoding:'utf8'}).status,state==='present'?0:1);
  if(state==='present')core.closeSession(name);
  core.closeSession(`rollback_close_anchor_${state}`);
});

for(const when of ['created','rollback'])test(`a same-name replacement survives at ${when}`,{skip},t=>{
  const name=`rollback_replaced_${when}`,spawn=childProcess.spawnSync,write=fs.writeFileSync;
  const native=resolveTmux(),prefix=win?['-L',WIN_NS]:['-S',SOCK];
  let replaced=false;
  // Keep the server alive so POSIX native IDs remain distinct across the replacement.
  core.openSession(`rollback_anchor_${when}`);
  const replace=()=>{
    replaced=true;
    assert.equal(spawn(native,[...prefix,'kill-session','-t',name],{encoding:'utf8'}).status,0);
    assert.equal(spawn(native,[...prefix,'new-session','-d','-s',name,...paneCommandArgs(win?'pwsh':'bash')],{encoding:'utf8'}).status,0);
    write(path.join(SOCKDIR,`${name}.log`),'replacement-owned-log');
  };
  t.mock.method(fs,'writeFileSync',function(file,...args){
    if(when==='rollback'&&String(file)===path.join(SOCKDIR,`${name}.log`))throw new Error('fixture setup failed');
    return write(file,...args);
  });
  t.mock.method(childProcess,'spawnSync',function(binary,args,options){
    if(when==='rollback'&&!replaced&&args.includes('if-shell')&&inner(args,'kill-session'))replace();
    const result=spawn(binary,args,options);
    if(when==='created'&&!replaced&&args.includes('new-session')&&args.includes(name)&&result.status===0)replace();
    return result;
  });
  syncBuiltinESMExports();
  try{assert.throws(()=>core.openAgent('claude',{session_name:name,agent_done:true,cwd:process.env.HOME}));}
  finally{t.mock.restoreAll();syncBuiltinESMExports();}
  assert.equal(replaced,true);
  assert.equal(spawn(native,[...prefix,'has-session','-t',name],{encoding:'utf8'}).status,0,'replacement is not closed');
  assert.equal(fs.readFileSync(path.join(SOCKDIR,`${name}.log`),'utf8'),'replacement-owned-log');
  core.closeSession(name);core.closeSession(`rollback_anchor_${when}`);
});
