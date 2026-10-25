import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {withOrdinaryCodexGoal} from '../dist/harnesses/codex-goal.js';
import {manageAgentGoal,agentGoalResultSchema} from '../dist/agent-goal.js';
const thread='artificial-thread';
const target={session_id:'goal-fields',launch_id:'b'.repeat(32),harness:'codex-cli',vendor_session_id:thread,codex_home:'/artificial/home'};
const original={threadId:thread,objective:'Existing literal goal',status:'paused',tokenBudget:null,tokensUsed:7,timeUsedSeconds:2,createdAt:1,updatedAt:2};
// Public inputs contain only session/launch and operation fields.
function run(f,action,fields={},origin='user'){
 const runtime={resolve:()=>target,connect:(_target,callback)=>withOrdinaryCodexGoal(async(method,params)=>{
  f.calls.push({method,params});
  if(method==='thread/goal/get')return {goal:f.goal};
  assert.equal(method,'thread/goal/set');f.goal={...f.goal,tokenBudget:params.tokenBudget};
  if(f.fail)throw new Error('ack lost');
  return {goal:f.goal};
 },thread,callback,async command=>f.keys.push(command))};
 return manageAgentGoal({session_id:target.session_id,launch_id:target.launch_id,action,...fields},runtime,origin).then(value=>agentGoalResultSchema.parse(value));
}
function state(){return {calls:[],keys:[],goal:structuredClone(original),fail:false};}
test('ordinary inspection advertises edit fields without promising objective or create',async()=>{
 const f=state();const r=await run(f,'inspect');
 assert.equal(r.capabilities.edit,true);assert.equal(r.capabilities.create,false);
 assert.deepEqual(r.field_capabilities,{create:{objective:false,token_budget:false},edit:{objective:false,token_budget:true,combined:false}});
 assert.deepEqual(f.calls.map(c=>c.method),['thread/goal/get']);
});
test('budget-only edit uses official service once, preserves usage and reads back',async()=>{
 const f=state();const r=await run(f,'edit',{token_budget:100});
 assert.equal(r.outcome,'applied');assert.equal(r.readback,'confirmed');assert.equal(r.goal.tokenBudget,100);
 assert.equal(r.goal.tokensUsed,7);assert.equal(r.goal.status,'paused');assert.equal(r.goal.objective,original.objective);
 assert.deepEqual(f.calls.map(c=>c.method),['thread/goal/get','thread/goal/set','thread/goal/get']);
 assert.deepEqual(f.calls[1].params,{threadId:thread,origin:'user',tokenBudget:100});assert.deepEqual(f.keys,[]);
});
test('unsupported objective or mixed edit refuses all changes before issue',async()=>{
 for(const fields of [{objective:'Changed'},{objective:'Changed',token_budget:100}]){
  const f=state();const r=await run(f,'edit',fields);
  assert.equal(r.outcome,'unsupported');assert.equal(r.reason,'native_goal_field_unsupported');assert.equal(r.mutation,'not_issued');
  assert.deepEqual(r.goal,original);assert.equal(f.calls.length,1);assert.equal(f.keys.length,0);
 }
});
test('native budget failure is unknown with no second native or CLI attempt',async()=>{
 const f=state();f.fail=true;const r=await run(f,'edit',{token_budget:100});
 assert.equal(r.outcome,'outcome_unknown');assert.equal(r.mutation,'outcome_unknown');assert.equal('goal' in r,false);
 assert.equal(f.calls.filter(c=>c.method==='thread/goal/set').length,1);assert.equal(f.keys.length,0);
});
test('automatic provenance cannot update budget',async()=>{
 const f=state();const r=await run(f,'edit',{token_budget:100},'automatic');
 assert.equal(r.reason,'user_authorization_required');assert.equal(r.mutation,'not_issued');assert.equal(f.calls.length,1);
});
test('ordinary request adapter rejects cross-thread, automatic, and combined writes',async()=>{
 const calls=[];
 await withOrdinaryCodexGoal(async(method,params)=>{calls.push({method,params});return {};},thread,async request=>{
  for(const params of [{threadId:'other',origin:'user',tokenBudget:1},{threadId:thread,origin:'automatic',tokenBudget:1},{threadId:thread,origin:'user',tokenBudget:1,status:'paused'},{threadId:thread,origin:'user',tokenBudget:1,objective:'injected'}])
   await assert.rejects(request('thread/goal/set',params));
 });
 assert.equal(calls.length,0);
});
test('individually supported objective and budget fields do not imply a combined edit',async()=>{
 const calls=[];let editorCalls=0;
 const runtime={resolve:()=>target,connect:(_target,run)=>withOrdinaryCodexGoal(async(method,params)=>{
  calls.push({method,params});assert.equal(method,'thread/goal/get');return {goal:original};
 },thread,run,undefined,async()=>{editorCalls++;})};
 const r=await manageAgentGoal({session_id:target.session_id,launch_id:target.launch_id,action:'edit',objective:'Changed',token_budget:100},runtime,'user');
 assert.deepEqual(r.field_capabilities.edit,{objective:true,token_budget:true,combined:false});
 assert.equal(r.reason,'native_goal_field_unsupported');assert.equal(r.mutation,'not_issued');
 assert.equal(calls.length,1);assert.equal(editorCalls,0);
});
test('ordinary create uses the owning CLI and complete canonical readback; budget is not silently dropped',async()=>{
 let goal=null,creates=0;const calls=[];
 const runtime={resolve:()=>target,connect:(_target,run)=>withOrdinaryCodexGoal(async(method,params)=>{
  calls.push({method,params});assert.equal(method,'thread/goal/get');return {goal};
 },thread,run,undefined,undefined,async objective=>{creates++;goal={...original,objective,status:'active',tokensUsed:0};})};
 const input={session_id:target.session_id,launch_id:target.launch_id,action:'create',objective:'New original-worker objective'};
 const unsupported=await manageAgentGoal({...input,token_budget:10},runtime,'user');assert.equal(unsupported.mutation,'not_issued');assert.equal(creates,0);
 const created=await manageAgentGoal(input,runtime,'user');assert.equal(created.outcome,'applied');assert.equal(created.goal.objective,input.objective);assert.equal(creates,1);
 assert.deepEqual(created.field_capabilities.create,{objective:true,token_budget:false});
 const existing=await manageAgentGoal(input,runtime,'user');assert.equal(existing.reason,'goal_already_exists');assert.equal(creates,1);
});
