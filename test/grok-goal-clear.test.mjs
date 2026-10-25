import './seat-env.mjs';
import assert from 'node:assert/strict';import {test} from 'node:test';import fs from 'node:fs';
import {manageGrokAgentGoal} from '../dist/agent-goal-native-result.js';
import {AgentGoalNotIssuedError} from '../dist/agent-goal.js';
const session='439cd90a-b8a4-436d-b093-63f0d8ce5096';
const state=JSON.parse(fs.readFileSync(new URL('./fixtures/grok-goal-paused-snapshot.json',import.meta.url),'utf8'));
const goal={kind:'grok-cli',native:state,current_status:{source:'/goal status',status:'UserPaused',phase:'Idle',tokens_used:4906,elapsed_display:'14s'}};
const input={session_id:'grok',launch_id:'a'.repeat(32),expected_thread_id:session,action:'clear'};
function fixture({ready=true,failure=null,replace=false}={}){
 let reads=0,calls=0,current=goal;const target={...input,harness:'grok-cli',vendor_session_id:session};
 const runtime={resolve:()=>replace&&calls?null:target,read:async()=>{reads++;return {current};},canClear:()=>ready,clear:async()=>{calls++;if(failure)throw failure;current=null;}};
 return {runtime,reads:()=>reads,calls:()=>calls};
}
test('Grok user clear is issued once and acknowledged only after authoritative current null',async()=>{
 const f=fixture();const result=await manageGrokAgentGoal(input,f.runtime,'user');assert.equal(result.outcome,'applied');assert.equal(result.mutation,'acknowledged');assert.equal(result.readback,'confirmed');assert.equal(result.goal,null);assert.equal(f.calls(),1);assert.equal(f.reads(),2);
});
test('Grok automatic origin and unused mutation fields cannot start a clear',async()=>{
 const f=fixture();const automatic=await manageGrokAgentGoal(input,f.runtime);assert.equal(automatic.reason,'user_authorization_required');assert.equal(automatic.mutation,'not_issued');assert.equal(f.reads(),0);assert.equal(f.calls(),0);
 await assert.rejects(manageGrokAgentGoal({...input,objective:'ignored?'},f.runtime,'user'),/fields do not apply/);assert.equal(f.calls(),0);
});
test('Grok clear refuses foreign thread or occupied/busy native input without mutation',async()=>{
 const f=fixture({ready:false});const wrong=await manageGrokAgentGoal({...input,expected_thread_id:'other-thread'},f.runtime,'user');assert.equal(wrong.reason,'thread_binding_mismatch');assert.equal(f.reads(),0);
 const result=await manageGrokAgentGoal(input,f.runtime,'user');assert.equal(result.mutation,'not_issued');assert.equal(result.reason,'native_goal_clear_input_unconfirmed');assert.equal(result.capabilities.clear,false);assert.equal(f.calls(),0);
});
test('Grok clear does not retry, restore an old goal or expose a stale goal after uncertain effect',async()=>{
 const f=fixture({failure:new Error('input write uncertain')});const result=await manageGrokAgentGoal(input,f.runtime,'user');assert.equal(result.outcome,'outcome_unknown');assert.equal(result.mutation,'outcome_unknown');assert.ok(!('goal' in result));assert.equal(result.capabilities.clear,false);assert.equal(f.calls(),1);assert.equal(f.reads(),1);
 const replaced=fixture({replace:true});const changed=await manageGrokAgentGoal(input,replaced.runtime,'user');assert.equal(changed.mutation,'outcome_unknown');assert.ok(!('goal' in changed));assert.equal(replaced.calls(),1);
});
test('Grok proven pre-input refusal retains not_issued and only a fresh observation',async()=>{
 const f=fixture({failure:new AgentGoalNotIssuedError('native_goal_changed_before_clear')});const result=await manageGrokAgentGoal(input,f.runtime,'user');assert.equal(result.mutation,'not_issued');assert.equal(result.reason,'native_goal_changed_before_clear');assert.equal(result.goal.native.goal_id,state.goal_id);assert.equal(f.calls(),1);assert.equal(f.reads(),2);
});
test('Grok inspect advertises clear only for confirmed existing goal and current idle input',async()=>{
 const f=fixture();const result=await manageGrokAgentGoal({...input,action:'inspect'},f.runtime);assert.equal(result.capabilities.clear,true);for(const action of ['create','edit','pause','resume'])assert.equal(result.capabilities[action],false);
 const busy=fixture({ready:false});assert.equal((await manageGrokAgentGoal({...input,action:'inspect'},busy.runtime)).capabilities.clear,false);
});

const {clearGrokGoal,readFreshGrokGoal}=await import('../dist/harnesses/grok-goal.js');
const row=(kind,text)=>({method:'session/update',params:{sessionId:session,update:{sessionUpdate:kind,content:{type:'text',text},_meta:{hostTurn:true}}}});
function nativePort({draft='',reply='Goal cleared.',retain=false,replay=false,replace=false,shift=false}={}){
 let text=draft,clock=0,current=state,rows=[],enters=0,pastes=0;
 const ui={read:()=>`Grok Build v1.0.70\nminimal · /help\n❯ ${text}\n${text?`────────────────\n❯ ${text.endsWith('clear')?'clear Clear the goal':'status Show the goal'}\n ↑/↓ navigate · enter confirm · esc cancel`:'Grok 4.6 (high)'}`,
 paste:async value=>{pastes++;text=value;if(replace)current={...state,goal_id:'01a17417-49a3-7883-86d6-9036387b75a6'};},
 keys:async(keys,expected,confirm)=>{if(shift)text='owner draft';if(confirm&&!confirm(ui.read()))throw new AgentGoalNotIssuedError('native_goal_ui_changed');enters++;const command=text;text='';if(command==='/goal clear'&&!retain)current=null;if(!replay)rows.push(row('user_message_chunk',command),row('agent_message_chunk',command==='/goal status'?'No goal is currently set. Use /goal <objective> to start one.':reply));},
 pause:async ms=>{clock+=ms;},now:()=>clock};
 return {ui,rows:()=>[...rows],state:()=>current,enters:()=>enters,pastes:()=>pastes};
}
test('Grok native clear requires exact fresh durable reply and then a separate fresh no-goal observation',async()=>{
 const p=nativePort();await clearGrokGoal(session,goal,p);assert.equal(p.enters(),1);assert.equal(p.state(),null);assert.deepEqual(await readFreshGrokGoal(session,p),{current:null});assert.equal(p.enters(),2);
});
test('Grok native clear preserves occupied input and refuses a replaced goal or changed last viewport before Enter',async()=>{
 const occupied=nativePort({draft:'owner draft'});await assert.rejects(clearGrokGoal(session,goal,occupied),error=>error instanceof AgentGoalNotIssuedError);assert.equal(occupied.pastes(),0);assert.equal(occupied.enters(),0);
 for(const options of [{replace:true},{shift:true}]){const p=nativePort(options);await assert.rejects(clearGrokGoal(session,goal,p),error=>error instanceof AgentGoalNotIssuedError);assert.equal(p.enters(),0);}
});
test('Grok native clear never acknowledges a failure reply, retained goal, or missing fresh reply and never repeats Enter',async()=>{
 for(const options of [{reply:'Could not durably clear the goal.'},{retain:true},{replay:true}]){const p=nativePort(options);await assert.rejects(clearGrokGoal(session,goal,p),error=>!(error instanceof AgentGoalNotIssuedError));assert.equal(p.enters(),1);}
});
