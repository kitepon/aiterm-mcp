import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {decideIdleSeat,idleMinutes,checkIdleSeat} from '../dist/agent-idle.js';

const ended='2026-10-31T00:00:00.000Z', now=Date.parse(ended)+30*60000;
const seat=()=>({launch_id:'a'.repeat(32),created_at:ended,vendor_session_id:'thread',resume_ready:true,native_configuration_confirmed:true,
 activity:{tracked:true,last_input_at:'2026-10-30T23:59:00.000Z',last_turn_end_at:ended},
 state:'idle',reason:'composer_ready',attached:false,turn_settled:true,pending_child_deliveries:0,
 post_startup_process_count:0,window_activity_at:Date.parse(ended)});

test('idle threshold is based on native completion, including exact cutoff and legacy migration',()=>{
 assert.equal(decideIdleSeat(seat(),now-1).outcome,'not_due');
 assert.equal(decideIdleSeat(seat(),now).outcome,'ready');
 assert.equal(decideIdleSeat(seat(),now+1).anchor,ended);
 const legacy=seat();legacy.activity={tracked:false,last_input_at:null,last_turn_end_at:null};
 assert.equal(decideIdleSeat(legacy,now).outcome,'ready');
 legacy.activity.tracked=true;assert.equal(decideIdleSeat(legacy,now).reason,'turn_end_time_unavailable');
});
test('all protected states, unknown observations, inputs without completion and unsupported resume stay alive',()=>{
 const cases=[
  ...['busy','blocked','dead','missing','unknown'].map(state=>({state})),{reason:'draft_present'},
  {attached:true},{attached:null},{pending_child_deliveries:1},{pending_child_deliveries:null},
  {post_startup_process_count:1},{post_startup_process_count:null},{vendor_session_id:null},
  {resume_ready:false},{native_configuration_confirmed:false},{turn_settled:false},{turn_settled:null},
  {activity:{tracked:true,last_input_at:'2026-10-31T00:01:00Z',last_turn_end_at:ended}},
  {activity:{tracked:true,last_input_at:'invalid',last_turn_end_at:ended}},
  {activity:{tracked:true,last_input_at:null,last_turn_end_at:'invalid'}},
 ];
 for(const change of cases)assert.equal(decideIdleSeat({...seat(),...change},now).outcome,'skipped',JSON.stringify(change));
 assert.equal(decideIdleSeat(seat(),now,30,'old timer').reason,'superseded_timer');
 for(const invalid of [NaN,Infinity])assert.equal(decideIdleSeat(seat(),invalid).outcome,'skipped');
});
test('spinner activity cannot move the idle origin; stalled busy is report-only',()=>{
 const busy={...seat(),state:'busy',window_activity_at:now-3600000};
 const result=decideIdleSeat(busy,now);assert.equal(result.stalled,true);assert.equal(result.outcome,'skipped');
 busy.window_activity_at=now;assert.equal(decideIdleSeat(busy,now).stalled,false);
 const idle=seat();idle.window_activity_at=now;assert.equal(decideIdleSeat(idle,now).anchor,ended);
});
test('idle duration rejects disabled/invalid or unbounded configuration',()=>{
 assert.equal(idleMinutes(),30);assert.equal(idleMinutes('0.1'),0.1);
 assert.equal(idleMinutes('1441'),1441);
 for(const invalid of ['', ' ', '0', '-1','NaN','Infinity','1e308'])assert.throws(()=>idleMinutes(invalid));
});

function fixture(){
 const f={current:seat(),effects:[],locked:false};
 f.runtime={now:()=>now,snapshot:()=>structuredClone(f.current),
  exclusive:async body=>{assert.equal(f.locked,false);f.locked=true;try{return await body();}finally{f.locked=false;}},
  begin:()=>{assert.equal(f.locked,true);f.effects.push('begin');},
  stop:async (verify,didIssue)=>{verify();didIssue();f.effects.push('stop');f.current.state='dead';verify();return true;},
  cancel:()=>{assert.equal(f.locked,true);f.effects.push('cancel');},
  finish:()=>{assert.equal(f.locked,true);f.effects.push('finish');},record:r=>f.effects.push(r.outcome)};
 f.run=()=>checkIdleSeat(f.runtime,'a'.repeat(32));return f;
}
test('admission covers eligibility, stop and durable completion, including death after the first effect',async()=>{
 const f=fixture();assert.equal((await f.run()).outcome,'hibernated');
 assert.deepEqual(f.effects,['begin','stop','finish','hibernated']);assert.equal(f.locked,false);
});
test('an outdated generation and conditions changed while queued issue no stop',async()=>{
 for(const change of [f=>{f.current.launch_id='b'.repeat(32);},f=>{f.current.state='busy';},
  f=>{f.current.activity.last_input_at='2026-10-31T00:30:00Z';}]){
  const f=fixture(), lock=f.runtime.exclusive;
  f.runtime.exclusive=body=>lock(async()=>{change(f);return body();});
  const result=await f.run();assert.equal(result.outcome,'skipped');assert.deepEqual(f.effects,['skipped']);
 }
});
test('the final precondition read rejects a new input, attachment or new native turn before begin',async()=>{
 for(const change of [f=>{f.current.activity.last_input_at='2026-10-31T00:30:00Z';},
  f=>{f.current.attached=true;},f=>{f.current.turn_settled=false;}]){
  const f=fixture(), snapshot=f.runtime.snapshot;let reads=0;
  f.runtime.snapshot=()=>{if(++reads===2)change(f);return snapshot();};
  assert.equal((await f.run()).outcome,'skipped');assert.deepEqual(f.effects,['skipped']);
 }
});
test('generation/input/busy changes during stop retain uncertainty and cannot mark the seat hibernated',async()=>{
 for(const change of [f=>{f.current.launch_id='b'.repeat(32);},
  f=>{f.current.activity.last_input_at='2026-10-31T00:30:00Z';},f=>{f.current.state='busy';}]){
  const f=fixture();f.runtime.stop=async (verify,didIssue)=>{verify();didIssue();change(f);verify();return true;};
  assert.equal((await f.run()).outcome,'unconfirmed');assert.deepEqual(f.effects,['begin','unconfirmed']);
 }
});
test('exit and persistence failures are never successful hibernation',async()=>{
 for(const fail of ['stop','finish','snapshot']){
  const f=fixture();f.runtime[fail]=(_verify,didIssue)=>{if(fail==='stop')didIssue();throw Error('unavailable');};
  const r=await f.run();assert.equal(r.outcome,fail==='snapshot'?'skipped':'unconfirmed');assert.ok(!f.effects.includes('hibernated'));
 }
 const f=fixture();f.runtime.stop=async(_verify,didIssue)=>{didIssue();return false;};assert.equal((await f.run()).outcome,'unconfirmed');
});
test('a replacement after tree exit cannot receive the old hibernation record',async()=>{
 const f=fixture();f.runtime.stop=async (verify,didIssue)=>{verify();didIssue();f.effects.push('stop');f.current.launch_id='b'.repeat(32);return true;};
 assert.equal((await f.run()).outcome,'unconfirmed');assert.deepEqual(f.effects,['begin','stop','unconfirmed']);
});
test('background work or a child delivery added after begin refuses the first signal and cancels only the preparation',async()=>{
 for(const field of ['post_startup_process_count','pending_child_deliveries','native_configuration_confirmed']){
  const f=fixture();f.runtime.stop=async(verify,didIssue)=>{f.current[field]=field==='native_configuration_confirmed'?false:1;verify();didIssue();return true;};
  assert.equal((await f.run()).outcome,'skipped');assert.deepEqual(f.effects,['begin','cancel','skipped']);
 }
});
test('a failed cancellation keeps the stopping outcome uncertain',async()=>{
 const f=fixture();f.runtime.stop=async()=>{throw Error('before signal');};f.runtime.cancel=()=>{throw Error('not persisted');};
 assert.equal((await f.run()).outcome,'unconfirmed');assert.deepEqual(f.effects,['begin','unconfirmed']);
});
test('an explicit hibernate skips only the deadline and attachment; a rate-limited Claude turn counts as ended at its error',()=>{
 const early=Date.parse(ended)+1;
 assert.equal(decideIdleSeat(seat(),early).outcome,'not_due');
 assert.equal(decideIdleSeat(seat(),early,30,undefined,true).outcome,'ready');
 assert.equal(decideIdleSeat({...seat(),attached:true},early,30,undefined,true).outcome,'ready');
 // Work that a stop would lose still refuses an explicit hibernate.
 for(const change of [{state:'busy',reason:'turn_running'},{pending_child_deliveries:1},{post_startup_process_count:1},{turn_settled:false},{resume_ready:false},{native_configuration_confirmed:false}])
  assert.equal(decideIdleSeat({...seat(),...change},early,30,undefined,true).outcome,'skipped',JSON.stringify(change));
 // Limit footer/menu: no Stop event, no composer; the transcript's rate_limited error after the last input ends the turn.
 const limitedAt='2026-10-31T00:00:05.000Z';
 const limited={...seat(),state:'unknown',reason:'unrecognized_screen',turn_settled:false,native_configuration_confirmed:false,rate_limited_at:limitedAt,
  activity:{tracked:true,last_input_at:'2026-10-31T00:00:01.000Z',last_turn_end_at:ended}};
 assert.deepEqual([decideIdleSeat(limited,early+10000,30,undefined,true).outcome,decideIdleSeat(limited,early+10000,30,undefined,true).anchor],['ready',limitedAt]);
 assert.equal(decideIdleSeat(limited,early+10000).outcome,'skipped','the idle clock ignores the rate-limit reading');
 assert.equal(decideIdleSeat({...limited,post_startup_process_count:1},early+10000,30,undefined,true).outcome,'skipped');
 // stop_background: background work (or an unknown count) no longer refuses an explicit hibernate; a running turn and child deliveries still do.
 for(const count of [1,null]){
  assert.equal(decideIdleSeat({...limited,post_startup_process_count:count},early+10000,30,undefined,true,true).outcome,'ready');
  assert.equal(decideIdleSeat({...seat(),post_startup_process_count:count},early,30,undefined,true,true).outcome,'ready');
  assert.equal(decideIdleSeat({...seat(),post_startup_process_count:count},now,30,undefined,false,true).reason,'background_work_or_unknown','the idle clock never stops background work');
 }
 for(const change of [{state:'busy',reason:'turn_running'},{pending_child_deliveries:1},{turn_settled:false}])
  assert.equal(decideIdleSeat({...seat(),...change,post_startup_process_count:1},early,30,undefined,true,true).outcome,'skipped',JSON.stringify(change));
});
