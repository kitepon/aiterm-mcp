import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {manageAgentGoal,agentGoalInputSchema,agentGoalResultSchema,goalOriginFromHost} from '../dist/agent-goal.js';
const launch='1'.repeat(32);
const thread='22222222-2222-4222-8222-222222222222';
const target={session_id:'test-goal',launch_id:launch,harness:'codex-cli',vendor_session_id:thread,codex_home:'/artificial/home'};
const goal=(status='paused')=>({threadId:thread,objective:'Original',status,tokenBudget:null,tokensUsed:7,timeUsedSeconds:2,createdAt:1,updatedAt:2});
const input=(action,rest={})=>({session_id:target.session_id,launch_id:launch,action,...rest});
function fixture(initial=goal()){
 let current=structuredClone(target);let stored=initial;const calls=[];
 const runtime={resolve:()=>current,connect:async(_target,run)=>run(async(method,params)=>{
  calls.push({method,params});
  assert.equal(params.threadId,thread);
  if(method==='thread/goal/get')return {goal:stored};
  if(method==='thread/goal/clear'){stored=null;return {cleared:true};}
  if(method==='thread/goal/set'){
   assert.equal(params.origin,'user');stored={...(stored??goal('active')),...params};delete stored.origin;
   return {goal:stored};
  }
  throw new Error('Unexpected native method');
 })};
 return {runtime,calls,setTarget(value){current=value;},run:async(action,rest={},origin='user')=>agentGoalResultSchema.parse(await manageAgentGoal(input(action,rest),runtime,origin))};
}
test('schema rejects caller-selected thread, origin and irrelevant fields',()=>{
 for(const rest of [{threadId:thread},{origin:'user'},{objective:'override'}])assert.equal(agentGoalInputSchema.safeParse(input('inspect',rest)).success,false);
 assert.equal(agentGoalInputSchema.safeParse(input('create')).success,false);
 assert.equal(agentGoalInputSchema.safeParse(input('edit')).success,false);
});
test('user provenance requires the existing host channel and exact metadata',()=>{
 const meta={'aiterm/goal':{origin:'user'}};
 for(const name of [undefined,'codex-mcp-client','claude-code','cursor'])assert.equal(goalOriginFromHost(name,meta),'automatic');
 for(const value of [undefined,{}, {'aiterm/goal':{origin:'user',forged:true}}, {'aiterm/goal':{origin:'automatic'}}])assert.equal(goalOriginFromHost('bellteam',value),'automatic');
 assert.equal(goalOriginFromHost('bellteam',meta),'user');
});
test('native empty goal differs from connection failure',async()=>{
 const f=fixture(null);const empty=await f.run('inspect');assert.equal(empty.outcome,'observed');assert.equal(empty.goal,null);
 f.runtime.connect=async()=>{throw new Error('offline');};const failed=await f.run('inspect');assert.equal(failed.availability,'unavailable');assert.equal('goal' in failed,false);
});
test('unreadable session binding is typed unavailable',async()=>{
 const f=fixture();f.runtime.resolve=()=>{throw new Error('native listing unavailable');};
 const result=await f.run('inspect');assert.equal(result.availability,'unavailable');assert.equal('goal' in result,false);assert.equal(f.calls.length,0);
});
test('non-Codex adapters are explicitly unsupported and never connect',async()=>{
 for(const harness of ['claude-code','grok-cli','cursor-cli']){
  const f=fixture();f.setTarget({...target,harness});f.runtime.connect=()=>{throw new Error('must not connect');};
  const result=await f.run('inspect');assert.equal(result.availability,'unsupported');assert.ok(Object.values(result.capabilities).every(x=>!x));
 }
});
test('model provenance cannot mutate as user',async()=>{
 const f=fixture();const result=await f.run('clear',{},'automatic');assert.equal(result.outcome,'rejected');assert.equal(result.reason,'user_authorization_required');assert.equal(result.mutation,'not_issued');assert.deepEqual(f.calls.map(x=>x.method),['thread/goal/get']);
});
test('create refuses an existing goal',async()=>{
 const f=fixture();const result=await f.run('create',{objective:'Replacement'});assert.equal(result.reason,'goal_already_exists');assert.equal(f.calls.length,1);
});
test('create confirms requested active status and preserves a changed native readback',async()=>{
 for(const status of ['active','paused','blocked','usageLimited','budgetLimited','complete']){
  const f=fixture(null);let reads=0;let mutations=0;
  f.runtime.connect=async(_target,run)=>run(async(method,params)=>{
   if(method==='thread/goal/get')return {goal:++reads===1?null:{...goal(status),objective:'New objective'}};
   mutations++;assert.equal(params.status,'active');return {goal:{...goal('active'),objective:'New objective'}};
  });
  const result=await f.run('create',{objective:'New objective'});
  assert.equal(result.outcome,status==='active'?'applied':'outcome_unknown');
  assert.equal(result.readback,status==='active'?'confirmed':'mismatch');
  assert.equal(result.mutation,'acknowledged');assert.equal(result.goal.status,status);
  assert.equal(mutations,1);assert.equal(reads,2);
 }
});
test('resume accepts paused only, retaining limits and native counters',async()=>{
 for(const status of ['active','blocked','usageLimited','budgetLimited','complete']){
  const f=fixture(goal(status));const result=await f.run('resume');assert.equal(result.reason,'resume_requires_paused_goal');assert.equal(f.calls.length,1);
 }
 const f=fixture();const result=await f.run('resume');assert.equal(result.outcome,'applied');assert.equal(result.goal.tokensUsed,7);assert.deepEqual(f.calls[1].params,{threadId:thread,origin:'user',status:'active'});
});
test('clear removes goal without any turn or process operation',async()=>{
 const f=fixture();const result=await f.run('clear');assert.equal(result.outcome,'applied');assert.equal(result.goal,null);assert.deepEqual(f.calls.map(x=>x.method),['thread/goal/get','thread/goal/clear','thread/goal/get']);
 const resumed=await f.run('resume');assert.equal(resumed.reason,'goal_missing');
});
test('edit passes only explicit fields and reads the native result',async()=>{
 const f=fixture();const result=await f.run('edit',{objective:'Changed'});assert.equal(result.outcome,'applied');assert.deepEqual(f.calls[1].params,{threadId:thread,origin:'user',objective:'Changed'});
});
test('generation replacement before mutation issues no mutation',async()=>{
 const f=fixture();f.runtime.connect=async(_target,run)=>{f.setTarget({...target,launch_id:'33333333-3333-4333-8333-333333333333'});return run(()=>{throw new Error('must not request');});};
 const result=await f.run('clear');assert.equal(result.reason,'generation_replaced');assert.equal(result.mutation,'not_issued');
});
test('expected thread is a comparison and cannot select a different target',async()=>{
 const f=fixture();const result=await f.run('clear',{expected_thread_id:'other'});
 assert.equal(result.reason,'thread_binding_mismatch');assert.equal(result.mutation,'not_issued');assert.equal(f.calls.length,0);
});
test('unacknowledged native mutation is unknown and is never retried',async()=>{
 const f=fixture();let mutations=0;f.runtime.connect=async(_target,run)=>run(async method=>{
  if(method==='thread/goal/get')return {goal:goal()};mutations++;throw new Error('disconnected after write');
 });const result=await f.run('clear');assert.equal(result.outcome,'outcome_unknown');assert.equal(result.mutation,'outcome_unknown');assert.equal(mutations,1);assert.equal('goal' in result,false);
});
test('acknowledged mutation with failed readback stays unconfirmed',async()=>{
 const f=fixture();let reads=0;f.runtime.connect=async(_target,run)=>run(async method=>{
  if(method==='thread/goal/get'){if(++reads===1)return {goal:goal()};throw new Error('readback unavailable');}return {cleared:true};
 });const result=await f.run('clear');assert.equal(result.outcome,'outcome_unknown');assert.equal(result.mutation,'acknowledged');assert.equal(result.readback,'failed');assert.equal('goal' in result,false);
});
test('cross-thread and malformed native replies never enable mutation',async()=>{
 for(const value of [{goal:{...goal(),threadId:'other'}},{goal:{...goal(),status:'imaginary'}}]){
  const f=fixture();f.runtime.connect=async(_target,run)=>run(async method=>{assert.equal(method,'thread/goal/get');return value;});
  const result=await f.run('clear');assert.equal(result.outcome,'unavailable');assert.equal(result.mutation,'not_issued');
 }
});
