import './seat-env.mjs';
import test from 'node:test';
// These integration cases require the private POSIX file/directory checkpoint.
const posixCheckpoint = process.platform === 'win32' ? 'private native graph requires POSIX directory fsync' : false;
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { interruptKnownSessions, interruptKnownSessionsAndGoals, immediateStopInputSchema } from '../dist/execution-immediate-stop.js';
import { FileExecutionStore } from '../dist/execution-store.js';
const launches = Object.fromEntries(['a','b','c','d'].map(x => [x, {session_id:x,launch_id:x.repeat(32)}]));
const point = x => ({launch:launches[x],boundary:{event_cursor:0,turn_id:null,operation_id:null,steer_id:null}});
const edge = (a,b) => ({request:{kind:'delivery',delivery_id:a+b,target_session_id:b},source_session_id:a,
 source:point(a),target:point(b),phase:'invoked',completion:'open',target_fence:'unknown',lifecycle:'tracking'});
const receipt = session_id => ({session_id,outcome:'accepted'});
function stop(input, relations, sendKey = receipt) {
 const calls=[]; const result=interruptKnownSessions(input,{relations:()=>relations,currentLaunchId:name=>launches[name].launch_id,
  sendKey:(...args)=>{calls.push(args);return sendKey(...args);}}); return {result,calls};
}
test('known descendants stop leaf first despite mixed inbound work, multi roots deduplicate cycles and aliases',()=>{
 const {result,calls}=stop({session_ids:['a','d','a']},[edge('a','b'),edge('b','c'),edge('d','b'),edge('c','a')]);
 assert.equal(result.status,'sent');assert.deepEqual(calls.map(x=>x[0]),['c','b','a','d']);
 assert.equal(new Set(calls.map(x=>x[0])).size,calls.length);
});
test('completed retired contacts are excluded, completed connector retains unfinished downstream',()=>{
 const old={...edge('a','d'),completion:'interrupted',target_fence:'closed',lifecycle:'retired'};
 const connector={...edge('a','b'),completion:'interrupted',target_fence:'closed'};
 assert.deepEqual(stop({session_id:'a'},[old,connector,edge('b','c')]).calls.map(x=>x[0]),['c','b','a']);
});
test('failed child send does not suppress parent or independent root and never retries',()=>{
 const {result,calls}=stop({session_ids:['a','d']},[edge('a','b')],name=>{if(name==='b') throw new Error('secret path');return receipt(name);});
 assert.equal(result.status,'partial'); assert.deepEqual(calls.map(x=>x[0]),['b','a','d']);
 assert.equal(result.targets[0].error,'KEY_SEND_FAILED'); assert.ok(!JSON.stringify(result).includes('secret path'));
});
test('unknown graph never prevents explicit root key, reports partial instead of pretending propagation',()=>{
 let keys=0;const result=interruptKnownSessions({session_id:'a'},{relations(){throw new Error('graph missing');},currentLaunchId:()=>null,
 sendKey:name=>{keys++;return receipt(name);}});
 assert.equal(keys,1);assert.equal(result.status,'partial');assert.equal(result.targets[0].status,'sent');assert.equal(result.targets[0].error,'RELATION_GRAPH_UNAVAILABLE');
});
test('only normal transport receipt counts as sent; idle is distinct and no native completion asserted',()=>{
 assert.equal(stop({session_id:'a'},[],name=>({session_id:name,outcome:'idle'})).result.status,'idle');
 for(const fake of [undefined,{outcome:'accepted',session_id:'other'},{status:'confirmed'}])
  assert.equal(stop({session_id:'a'},[],()=>fake).result.status,'failed');
 const result=stop({session_id:'a'},[]).result;assert.deepEqual(Object.keys(result),['session_id','status','targets']);
});
test('snapshot reads do not wait for held writer lock or change graph bytes',{ skip: posixCheckpoint }, t=>{
 const root=mkdtempSync(join(tmpdir(),'immediate-snapshot-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const store=new FileExecutionStore(root);store.transactionSync(state=>{});
 const path=join(root,'relations.json'),before=readFileSync(path);mkdirSync(join(root,'transaction.lock'));
 assert.deepEqual(store.snapshot().records,[]);assert.deepEqual(readFileSync(path),before);
});
test('session request is strict: no legacy proof or mixed forms accepted',()=>{
 for(const args of [{},{session_ids:[]},{session_id:'a',session_ids:['b']},{session_id:'a',roots:[]},{schema:'aiterm.cascade-stop-request.v2',mode:'interrupt',roots:[launches.a]}])
  assert.throws(()=>immediateStopInputSchema.parse(args));
});
test('explicit whole-app stop pauses native goals before one leaf-first key',async()=>{
 const events=[];const result=await interruptKnownSessionsAndGoals({session_id:'a',pause_goals:true},{
  children:()=>[{parent:'a',child:'b'}],currentLaunchId:name=>launches[name].launch_id,
  pauseGoal:async target=>{events.push('pause:'+target.session_id);return {status:'paused'};},
  sendKey:name=>{events.push('key:'+name);return receipt(name);},
 },'user');
 assert.deepEqual(events,['pause:b','key:b','pause:a','key:a']);assert.equal(result.status,'sent');
 assert.ok(result.targets.every(x=>x.goal_pause==='paused'));
});
test('whole-app goal pause cannot be selected by model arguments alone',async()=>{
 let effects=0;await assert.rejects(interruptKnownSessionsAndGoals({session_id:'a',pause_goals:true},{
  currentLaunchId:()=>launches.a.launch_id,pauseGoal:async()=>{effects++;return {status:'paused'};},sendKey:()=>{effects++;return receipt('a');},
 },'automatic'),/GOAL_OWNER_ACTION_REQUIRED/);assert.equal(effects,0);
 assert.throws(()=>interruptKnownSessions({session_id:'a',pause_goals:true},{currentLaunchId:()=>null,sendKey:()=>{effects++;}}),/TRUSTED_ASYNC/);
});
test('unconfirmed goal pause preserves the emergency key and whole-app partial result without retry',async()=>{
 for(const status of ['unsupported','unavailable','outcome_unknown']){
  const events=[];const result=await interruptKnownSessionsAndGoals({session_id:'a',pause_goals:true},{currentLaunchId:()=>launches.a.launch_id,
   pauseGoal:async()=>{events.push('pause');return {status,reason:'native-unconfirmed'};},sendKey:name=>{events.push('key');return receipt(name);}},'user');
  assert.deepEqual(events,['pause','key']);assert.equal(result.status,'partial');assert.equal(result.targets[0].status,'sent');assert.equal(result.targets[0].goal_pause,status);
 }
});
test('goal transport failure never retries and does not suppress other targets',async()=>{
 const events=[];const result=await interruptKnownSessionsAndGoals({session_ids:['a','d'],pause_goals:true},{currentLaunchId:name=>launches[name].launch_id,
  pauseGoal:async target=>{events.push('pause:'+target.session_id);if(target.session_id==='a')throw new Error('lost reply');return {status:'no_goal'};},
  sendKey:name=>{events.push('key:'+name);return receipt(name);}},'user');
 assert.equal(events.length,4);assert.ok(events.indexOf('pause:a')<events.indexOf('key:a'));
 assert.ok(events.indexOf('pause:d')<events.indexOf('key:d'));assert.equal(result.status,'partial');assert.equal(result.targets[0].goal_pause,'outcome_unknown');
});
test('independent root key is not blocked by another root goal timeout',async()=>{
 let releaseA, keyB;const waiting=new Promise(resolve=>releaseA=resolve), arrived=new Promise(resolve=>keyB=resolve), events=[];
 const pending=interruptKnownSessionsAndGoals({session_ids:['a','d'],pause_goals:true},{
  currentLaunchId:name=>launches[name].launch_id,
  pauseGoal:async target=>{events.push('pause:'+target.session_id);return target.session_id==='a'?waiting:{status:'paused'};},
  sendKey:name=>{events.push('key:'+name);if(name==='d')keyB();return receipt(name);},
 },'user');
 let timer;try{await Promise.race([arrived,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('independent root key waited for unrelated goal')),2000);})]);}
 finally{clearTimeout(timer);releaseA({status:'outcome_unknown'});await pending;}
 const result=await pending;assert.equal(result.status,'partial');assert.ok(events.indexOf('key:d')<events.indexOf('key:a'));
});
test('parallel roots retain shared descendant order and issue each pause/key once',async()=>{
 const events=[];const result=await interruptKnownSessionsAndGoals({session_ids:['a','d'],pause_goals:true},{
  children:()=>[{parent:'a',child:'b'},{parent:'d',child:'b'},{parent:'b',child:'c'}],
  currentLaunchId:name=>launches[name].launch_id,
  pauseGoal:async target=>{events.push('pause:'+target.session_id);return {status:'paused'};},
  sendKey:name=>{events.push('key:'+name);return receipt(name);},
 },'user');
 assert.equal(result.status,'sent');assert.equal(events.length,8);
 for(const name of ['a','b','c','d']){assert.equal(events.filter(x=>x==='pause:'+name).length,1);assert.equal(events.filter(x=>x==='key:'+name).length,1);}
 assert.ok(events.indexOf('key:c')<events.indexOf('pause:b'));
 assert.ok(events.indexOf('key:b')<events.indexOf('pause:a'));assert.ok(events.indexOf('key:b')<events.indexOf('pause:d'));
});
