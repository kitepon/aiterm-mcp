import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {readRuntimeProcesses,processIdentity} from '../dist/process-runtime.js';
import {stopProcessTree} from '../dist/process-tree-stop.js';

const row=(pid,parent_pid,group=pid,session='one')=>({pid,parent_pid,process_group_id:group,session_identity:session,
 started_identity:'2026-10-31T00:00:00Z',argv_digest:'command-'+pid,command:'process-'+pid,cpu_seconds:0,stopped:false});
function fixture(stubborn=false){
 const f={rows:[row(10,9),row(11,10,11),row(12,11,11),row(20,1,20,'foreign')],effects:[],at:0};
 f.runtime={now:()=>f.at,read:()=>structuredClone(f.rows),pause:async ms=>{f.at+=ms;},
  signal:(target,signal,group)=>{
   const ids=f.rows.filter(r=>group?r.process_group_id===target.process_group_id:r.pid===target.pid).map(r=>r.pid);
   f.effects.push({ids,signal,at:f.at,group});
   if(!stubborn||signal==='SIGKILL')f.rows=f.rows.filter(r=>!ids.includes(r.pid));
  }};
 f.run=(verify=()=>{})=>stopProcessTree(processIdentity(row(10,9)),verify,f.runtime);return f;
}
test('TERM closes the owned pane groups, children first, preserving unrelated processes',async()=>{
 const f=fixture();assert.equal(await f.run(),true);
 assert.deepEqual(f.effects.map(x=>x.ids),[[11,12],[10]]);
 assert.ok(f.effects.every(x=>x.signal==='SIGTERM'));assert.deepEqual(f.rows.map(x=>x.pid),[20]);
});
test('process-table ordering does not change the child-before-parent order',async()=>{
 const f=fixture();f.rows.reverse();assert.equal(await f.run(),true);
 assert.deepEqual(f.effects.map(x=>x.ids.sort((a,b)=>a-b)),[[11,12],[10]]);
});
test('uncooperative processes get the full five-second grace before KILL',async()=>{
 const f=fixture(true),read=f.runtime.read;f.runtime.read=()=>{f.at+=250;return read();};
 f.rows.find(row=>row.pid===12).process_group_id=12;
 assert.equal(await f.run(),true);
 assert.ok(f.effects.some(x=>x.signal==='SIGTERM'));assert.ok(f.effects.some(x=>x.signal==='SIGKILL'));
 assert.ok(f.effects.filter(x=>x.signal==='SIGKILL').every(x=>x.at>=5000));assert.deepEqual(f.rows.map(x=>x.pid),[20]);
 const lastTerm=Math.max(...f.effects.filter(x=>x.signal==='SIGTERM').map(x=>x.at));
 assert.ok(f.effects.filter(x=>x.signal==='SIGKILL').every(x=>x.at-lastTerm>=5000),'process observation cost must not shorten the grace interval');
});
test('a child created during graceful shutdown is collected before success',async()=>{
 const f=fixture(true),pause=f.runtime.pause;let added=false;
 f.runtime.pause=async ms=>{if(!added){added=true;f.rows.push(row(13,11,11));}await pause(ms);};
 assert.equal(await f.run(),true);assert.ok(f.effects.some(x=>x.ids.includes(13)));assert.deepEqual(f.rows.map(x=>x.pid),[20]);
});
test('a detached POSIX session is outside the owned tree even before reparenting',async()=>{
 const f=fixture();f.rows.push(row(30,10,30,'detached'),row(31,30,30,'detached'));
 assert.equal(await f.run(),true);assert.deepEqual(f.rows.map(x=>x.pid),[20,30,31]);
});
test('a shared process group never permits signalling an unrelated member',async()=>{
 const f=fixture();f.rows.push(row(99,1,10));
 assert.equal(await f.run(),true);assert.ok(f.rows.some(x=>x.pid===99));
 assert.ok(f.effects.filter(x=>x.ids.includes(10)).every(x=>x.group===false));
});
test('PID replacement before a signal never targets the replacement',async()=>{
 const f=fixture();f.rows=[row(10,9)];const read=f.runtime.read;let reads=0;
 f.runtime.read=()=>{if(++reads===3)f.rows[0].started_identity='2026-10-31T01:00:00Z';return read();};
 assert.equal(await f.run(),true);assert.deepEqual(f.effects,[]);assert.equal(f.rows.length,1);
});
test('root mismatch, the checker inside the tree and an invalid root refuse before effects',async()=>{
 for(const change of [f=>{f.rows[0].argv_digest='changed';},f=>{f.rows.push(row(process.pid,10,10));}]){
  const f=fixture();change(f);await assert.rejects(f.run());assert.deepEqual(f.effects,[]);
 }
 const f=fixture();await assert.rejects(stopProcessTree({...row(10,9),pid:1},()=>{},f.runtime));assert.deepEqual(f.effects,[]);
});
test('changed seat admission and process-table failure cannot be reported as a stopped tree',async()=>{
 const f=fixture();await assert.rejects(f.run(()=>{throw Error('generation replaced');}));assert.deepEqual(f.effects,[]);
 const unknown=fixture();unknown.runtime.read=()=>{throw Error('OS observation unavailable');};
 await assert.rejects(unknown.run());assert.deepEqual(unknown.effects,[]);
 const stuck=fixture(true);stuck.runtime.signal=(target,signal)=>{stuck.effects.push({target,signal});};
 assert.equal(await stuck.run(),false);
});
test('session-aware POSIX observations provide a separate session identity and zombie flag',
 {skip:process.platform==='win32'},()=>{
 const own=readRuntimeProcesses(true).find(r=>r.pid===process.pid);
 assert.ok(own);assert.equal(typeof own.session_identity,'string');assert.equal(own.zombie,false);
});

test('real POSIX descendants exit while a child in a separate session survives',
 {skip:process.platform==='win32'?'POSIX session contract':false,timeout:15000},async t=>{
 const script=join(process.env.HOME,'idle-tree-fixture.mjs');
 writeFileSync(script,`import {spawn} from 'node:child_process';
const mode=process.argv[2];
if(mode==='root'){
 const child=spawn(process.execPath,[import.meta.filename??new URL(import.meta.url).pathname,'child'],{stdio:['ignore','pipe','inherit']});
 const detached=spawn(process.execPath,[import.meta.filename??new URL(import.meta.url).pathname,'detached'],{detached:true,stdio:'ignore'});detached.unref();
 child.stdout.once('data',data=>console.log(JSON.stringify({child:child.pid,grand:Number(data.toString().trim()),detached:detached.pid})));
}else if(mode==='child'){
 const grand=spawn(process.execPath,[import.meta.filename??new URL(import.meta.url).pathname,'grand'],{stdio:'ignore'});console.log(grand.pid);
}
setInterval(()=>{},60000);`);
 const root=spawn(process.execPath,[script,'root'],{stdio:['ignore','pipe','inherit']});
 t.after(()=>{
  for(const row of readRuntimeProcesses(true))if(row.command.includes(script)){
   try{process.kill(row.pid,'SIGKILL');}catch{}
  }
 });
 const data=await once(root.stdout,'data'),pids=JSON.parse(data[0].toString());
 const before=readRuntimeProcesses(true),owned=before.find(r=>r.pid===root.pid);
 assert.ok(owned);
 assert.equal(await stopProcessTree(processIdentity(owned),()=>{}),true);
 const after=readRuntimeProcesses(true);
 for(const pid of [root.pid,pids.child,pids.grand])assert.ok(!after.some(r=>r.pid===pid&&!r.zombie),'no live owned process '+pid);
 assert.ok(after.some(r=>r.pid===pids.detached&&!r.zombie),'detached session remains alive');
});
test('a real isolated POSIX process ignoring TERM is killed after five seconds',
 {skip:process.platform==='win32'?'POSIX signals':false,timeout:15000},async t=>{
 const script=join(process.env.HOME,'idle-stubborn-fixture.mjs');
 writeFileSync(script,"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},60000);");
 const child=spawn(process.execPath,[script],{detached:true,stdio:['ignore','pipe','inherit']});
 t.after(()=>{
  const own=readRuntimeProcesses(true).find(row=>row.pid===child.pid&&row.command.includes(script));
  if(own){try{process.kill(own.pid,'SIGKILL');}catch{}}
 });
 await once(child.stdout,'data');
 const own=readRuntimeProcesses(true).find(row=>row.pid===child.pid);assert.ok(own);
 const start=performance.now();assert.equal(await stopProcessTree(processIdentity(own),()=>{}),true);
 assert.ok(performance.now()-start>=5000);
 assert.ok(!readRuntimeProcesses(true).some(row=>row.pid===child.pid&&!row.zombie));
});
