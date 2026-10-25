import './seat-env.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {grokCurrentSessionOwner,readFreshGrokGoal} from '../dist/harnesses/grok-goal.js';
import {manageGrokAgentGoal,agentGoalWireResultSchema} from '../dist/agent-goal-native-result.js';
const session='439cd90a-b8a4-436d-b093-63f0d8ce5096';
const other='01a17417-49a3-7883-86d6-9036387b75a6';
const expected={pid:123,procStart:'456',sessionId:session,cwd:'/private/project'};
const registration={session_id:session,pid:123,pid_start:456,cwd:'/private/project'};
test('Grok current-session registry binds PID birth and cwd and rejects a manual same-PID switch',()=>{
  assert.equal(grokCurrentSessionOwner([registration],expected),'match');
  assert.equal(grokCurrentSessionOwner([{...registration,session_id:other}],expected),'mismatch');
  for(const value of [[{...registration,pid_start:455}],[registration,registration],[{...registration,cwd:'/other'}],[]])assert.equal(grokCurrentSessionOwner(value,expected),'unavailable');
});
const row=(kind,text)=>({method:'session/update',params:{sessionId:session,update:{sessionUpdate:kind,content:{type:'text',text},_meta:{hostTurn:true}}}});
const empty='No goal is currently set. Use /goal <objective> to start one.';
function port({draft='',append=true,state=null,old=[],menu=''}={}){
  let text=draft,clock=0,rows=[...old];const keys=[];
  const ui={read:()=>`Grok Build v1.0.70\nminimal · /help\n❯ ${text}\n${text&&menu?menu:'Grok 4.6 (high)'}`,paste:async value=>{text+=value;},keys:async values=>{keys.push(...values);text='';if(append)rows.push(row('user_message_chunk','/goal status'),row('agent_message_chunk',empty));},pause:async ms=>{clock+=ms;},now:()=>clock};
  return {ui,rows:()=>[...rows],state:()=>state,keys,text:()=>text};
}
test('Grok fresh bound local status alone proves current null; a missing file or old response does not',async()=>{
  const p=port();assert.deepEqual(await readFreshGrokGoal(session,p),{current:null});assert.deepEqual(p.keys,['Enter']);
  const replay=port({append:false,old:[row('user_message_chunk','/goal status'),row('agent_message_chunk',empty)]});
  await assert.rejects(readFreshGrokGoal(session,replay),/fresh_status_unavailable/);
  await assert.rejects(readFreshGrokGoal(session,port({state:{status:'active'}})),/status_mismatch/);
});
test('Grok inspect preserves an occupied composer before paste or Enter',async()=>{
  const p=port({draft:'owner draft'});
  await assert.rejects(readFreshGrokGoal(session,p),error=>error.reason==='native_goal_status_input_unconfirmed');
  assert.equal(p.text(),'owner draft');assert.deepEqual(p.keys,[]);
});
test('Grok completion cursor is distinct from its composer and unknown menu is not submitted',async()=>{
  const good=port({menu:'────────────────\n❯ status Show the goal\n ↑/↓ navigate · enter confirm · esc cancel'});
  assert.deepEqual(await readFreshGrokGoal(session,good),{current:null});assert.deepEqual(good.keys,['Enter']);
  const unknown=port({menu:'────────────────\n❯ clear Clear the goal\n ↑/↓ navigate · enter confirm · esc cancel'});
  await assert.rejects(readFreshGrokGoal(session,unknown),error=>error.reason==='native_goal_status_input_unconfirmed');assert.deepEqual(unknown.keys,[]);
});
test('Grok v2 keeps unsupported mutation capabilities false and rejects foreign thread before querying',async()=>{
  const input={session_id:'grok',launch_id:'a'.repeat(32),action:'inspect'};
  const target={...input,harness:'grok-cli',vendor_session_id:session};let reads=0;
  const runtime={resolve:()=>target,read:async()=>{reads++;return {current:null};}};
  const observed=await manageGrokAgentGoal(input,runtime);agentGoalWireResultSchema.parse(observed);
  assert.equal(observed.goal,null);assert.equal(observed.capabilities.inspect,true);assert.equal(observed.capabilities.pause,false);
  const foreign=await manageGrokAgentGoal({...input,expected_thread_id:other},runtime);assert.equal(foreign.reason,'thread_binding_mismatch');assert.ok(!('goal' in foreign));
  const create=await manageGrokAgentGoal({...input,action:'create',objective:'not sent'},runtime);assert.equal(create.mutation,'not_issued');assert.equal(create.outcome,'unsupported');assert.equal(reads,1);
});
