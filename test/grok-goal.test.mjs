import './seat-env.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {grokCurrentSessionOwner,readFreshGrokGoal,grokGoalFromDetail} from '../dist/harnesses/grok-goal.js';
import {nativeGoalClickBytes} from '../dist/agent-goal-ui.js';
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
function port({draft='',append=true,state=null,old=[],menu='',reply=empty}={}){
  let text=draft,clock=0,rows=[...old];const keys=[];
  const ui={read:()=>`Grok Build v1.0.70\nminimal · /help\n❯ ${text}\n${text&&menu?menu:'Grok 4.6 (high)'}`,paste:async value=>{text+=value;},keys:async values=>{keys.push(...values);text='';if(append)rows.push(row('user_message_chunk','/goal status'),row('agent_message_chunk',reply));},pause:async ms=>{clock+=ms;},now:()=>clock};
  return {ui,rows:()=>[...rows],state:()=>state,keys,text:()=>text};
}
test('Grok fresh bound local status alone proves current null; a missing file or old response does not',async()=>{
  const p=port();assert.deepEqual(await readFreshGrokGoal(session,p),{current:null});assert.deepEqual(p.keys,['Enter']);
  const replay=port({append:false,old:[row('user_message_chunk','/goal status'),row('agent_message_chunk',empty)]});
  await assert.rejects(readFreshGrokGoal(session,replay),/fresh_status_unavailable/);
  await assert.rejects(readFreshGrokGoal(session,port({state:{status:'active'}})),/status_mismatch/);
});
test('Grok fresh current status remains distinct from a persisted phase and native token snapshot',async()=>{
  const state=JSON.parse(fs.readFileSync(new URL('./fixtures/grok-goal-paused-snapshot.json',import.meta.url),'utf8'));
  state.phase='Executing';
  const reply=`Goal: ${state.objective}\nStatus: UserPaused | Phase: Idle\nGoal tokens used: 4906\nElapsed: 14s`;
  const result=await readFreshGrokGoal(session,port({state,reply}));
  assert.equal(result.current.native.phase,'Executing');
  assert.deepEqual(result.current.current_status,{source:'/goal status',status:'UserPaused',phase:'Idle',tokens_used:4906,elapsed_display:'14s'});
  await assert.rejects(readFreshGrokGoal(session,port({state,append:false,old:[row('user_message_chunk','/goal status'),row('agent_message_chunk',reply)]})),/fresh_status_unavailable/);
  await assert.rejects(readFreshGrokGoal(session,port({state,reply:reply.replace(state.objective,'another goal')})),/status_mismatch/);
  await assert.rejects(readFreshGrokGoal(session,port({state,reply:reply.replace('UserPaused','MysteryPaused')})),/active_status_unverified/);
  await assert.rejects(readFreshGrokGoal(session,port({state,reply:reply.replace('4906','9007199254740992')})));
});
test('Grok current status refuses a goal replacement during the fresh query',async()=>{
  const state=JSON.parse(fs.readFileSync(new URL('./fixtures/grok-goal-paused-snapshot.json',import.meta.url),'utf8'));
  const reply=`Goal: ${state.objective}\nStatus: UserPaused | Phase: Idle\nGoal tokens used: 4906\nElapsed: 14s`;
  const p=port({state,reply});let reads=0;
  p.state=()=>reads++===0?state:{...state,goal_id:other};
  await assert.rejects(readFreshGrokGoal(session,p),/identity_changed/);
});
test('Grok executing worker does not enqueue a status command or adopt its active snapshot',async()=>{
  const p=port();
  p.ui.read=()=> '❯ /goal resume\n◆ Subagent running: “goal plan writer” · Waiting for response… (grok-4.6)\n⠴ Waiting for subagent… 0.5s\n❯\nGrok 4.6 (high) · 1.3K / 500K (0%) · ctrl+o transcript\n';
  await assert.rejects(readFreshGrokGoal(session,p),error=>error.reason==='native_goal_status_input_unconfirmed');
  assert.equal(p.text(),'');assert.deepEqual(p.keys,[]);
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

const full=JSON.parse(fs.readFileSync(new URL('./fixtures/grok-full-goal-screens.json',import.meta.url),'utf8'));
function fullPort({root=full.activeRoot,detail=full.activeDetail,closed=full.activeClosed,replacement=false,move=false,closeFails=false}={}){
  let screen=root,clock=0,reads=0;const events=[];
  const ui={read:()=>screen,paste:async()=>{throw Error('Must not enqueue a slash command');},
    click:async(column,row,confirm)=>{
      if(!confirm(move?screen.replace('Goal:','moved Goal:'):screen))throw Error('native_goal_ui_changed');
      events.push({click:[column,row]});screen=detail;
    },
    keys:async(keys,expected)=>{assert.deepEqual(keys,['g']);assert.equal(screen.split('\n')[expected.row-1],expected.text);events.push({keys});if(!closeFails)screen=closed;},
    pause:async ms=>{clock+=ms;},now:()=>clock};
  return {ui,rows:()=>[],state:()=>replacement&&reads++>0?{...full.state,goal_id:other}:full.state,events};
}
test('Grok current full-screen Goal detail preserves rounded displays and unknown native phase',async()=>{
  const p=fullPort(),result=await readFreshGrokGoal(session,p);
  assert.equal(result.current.current_status.source,'goal detail');
  assert.equal(result.current.current_status.status,'Active');
  assert.equal(result.current.current_status.phase,null);
  assert.equal(result.current.current_status.tokens_used,null);
  assert.equal(result.current.current_status.phase_display,'Planning');
  assert.match(result.current.current_status.budget_display,/4\.9k \/ 1 tokens/);
  assert.equal(result.current.native.phase,full.state.phase);
  assert.equal(p.events.length,2);assert.deepEqual(p.events[1],{keys:['g']});
  const wide=fullPort({root:full.activeRoot.replace('ma…','開発🧪')});
  await readFreshGrokGoal(session,wide);assert.equal(wide.events[0].click[0],p.events[0].click[0]+3);
});
test('Grok Goal detail rejects occupied, replaced, truncated, unknown or moved views without typing',async()=>{
  for(const root of [full.activeRoot.replace('│ ❯ ', '│ ❯ owner draft'),full.activeRoot+'\n ┌─ Permission ─┐']){
    const p=fullPort({root});await assert.rejects(readFreshGrokGoal(session,p));assert.deepEqual(p.events,[]);
  }
  const moved=fullPort({move:true});await assert.rejects(readFreshGrokGoal(session,moved));assert.deepEqual(moved.events,[]);
  await assert.rejects(readFreshGrokGoal(session,fullPort({replacement:true})),/identity_changed/);
  await assert.rejects(readFreshGrokGoal(session,fullPort({detail:full.activeDetail.replace(full.state.objective,'Artificial…'.padEnd(full.state.objective.length))})),/detail_mismatch/);
  await assert.rejects(readFreshGrokGoal(session,fullPort({detail:full.activeDetail.replace('Status: Active','Status: Bogus!')})),/detail_unverified/);
  await assert.rejects(readFreshGrokGoal(session,fullPort({closeFails:true})),/close_unconfirmed/);
});
test('Native Goal pointer encodes one bounded press/release and refuses invalid pane coordinates',()=>{
  assert.equal(nativeGoalClickBytes(19,2,80,24),'\x1b[<0;19;2M\x1b[<0;19;2m');
  for(const args of [[0,2,80,24],[-1,2,80,24],[81,2,80,24],[19,25,80,24],[19,2,0,24],[1.5,2,80,24],[Infinity,2,80,24],[19,2,10001,24]])assert.throws(()=>nativeGoalClickBytes(...args));
});
