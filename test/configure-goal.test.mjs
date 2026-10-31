import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {configureWithPausedGoal} from '../dist/configure-goal.js';
import {manageAgentGoal} from '../dist/agent-goal.js';

const target = {session_id:'configure-goal',launch_id:'a'.repeat(32),harness:'codex-cli',vendor_session_id:'thread',codex_home:'/artificial'};
const goal = status => ({threadId:'thread',objective:'Original',status,tokenBudget:100,tokensUsed:7,timeUsedSeconds:2,createdAt:1,updatedAt:2});
function fixture(initial = goal('active')) {
  const f = {stored:initial, effects:[], generation:target, beforeMutation:null};
  f.runtime = {
    goal: (action, expected) => manageAgentGoal({session_id:target.session_id,launch_id:target.launch_id, action, expected_thread_id:'thread'}, {
      resolve:()=>f.generation,
      beforeMutation:current=>!expected || JSON.stringify(current)===JSON.stringify(expected),
      connect:async (_target,run)=>run(async (method,params)=>{
        if (method==='thread/goal/get') return {goal:f.stored};
        assert.equal(method,'thread/goal/set');
        assert.equal(params.origin,'user');
        f.effects.push(params.status);
        f.stored = {...f.stored,status:params.status,updatedAt:f.stored.updatedAt+1};
        return {goal:f.stored};
      }),
    },'user'),
    waitForTurnEnd:async()=>{f.effects.push('turn-end');},
  };
  f.configure = async()=>{f.effects.push('configure');return {configured:true};};
  f.run = ()=>configureWithPausedGoal(f.runtime,f.configure);
  return f;
}

test('active goal pauses, waits for the current turn, applies once, then resumes',async()=>{
  const f=fixture(); let complete;
  const ended=new Promise(resolve=>{complete=resolve;});
  f.runtime.waitForTurnEnd=async()=>{f.effects.push('waiting');await ended;f.effects.push('turn-end');};
  const pending=f.run();
  while (!f.effects.includes('waiting')) await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.effects,['paused','waiting']);
  assert.equal(f.stored.status,'paused');
  complete();assert.deepEqual(await pending,{configured:true});
  assert.deepEqual(f.effects,['paused','waiting','turn-end','configure','active']);
  assert.deepEqual({...f.stored,status:'active',updatedAt:2},goal('active'));
});

test('absent, inactive and unavailable goals never change goal state',async()=>{
  for (const initial of [null,...['paused','complete','blocked','usageLimited','budgetLimited'].map(goal)]) {
    const f=fixture(initial);await f.run();assert.deepEqual(f.effects,['configure']);assert.deepEqual(f.stored,initial);
  }
  const f=fixture();f.runtime.goal=async()=>({availability:'unavailable',readback:'failed',reason:'offline'});
  await f.run();assert.deepEqual(f.effects,['configure']);
});

test('configuration and completion failures restore the owned pause and preserve the original error',async()=>{
  for (const stage of ['waitForTurnEnd','configure']) {
    const f=fixture();const error=new Error('original failure');
    if (stage==='configure') f.configure=async()=>{f.effects.push('configure');throw error;};
    else f.runtime.waitForTurnEnd=async()=>{throw error;};
    await assert.rejects(f.run(),e=>e===error && /goal=active/.test(e.message));
    assert.equal(f.stored.status,'active');assert.equal(f.effects.filter(x=>x==='active').length,1);
  }
});

test('unknown pause effects never issue configuration or a speculative resume',async()=>{
  const f=fixture(), original=f.runtime.goal;
  f.runtime.goal=async(action,expected)=>action==='pause'
    ? {schema:'aiterm.agent-goal-result.v1',availability:'available',readback:'failed',outcome:'outcome_unknown',reason:'lost acknowledgement'}
    : original(action,expected);
  await assert.rejects(f.run(),/PAUSE_UNCONFIRMED.*goal=unknown.*設定は変えていません/s);
  assert.deepEqual(f.effects,[]);
});

test('restoration failures report applied settings and goal state without replay',async()=>{
  const f=fixture(), original=f.runtime.goal;
  f.runtime.goal=async(action,expected)=>action==='resume'
    ? {...await original('inspect'),outcome:'outcome_unknown',readback:'failed',reason:'offline'}
    : original(action,expected);
  await assert.rejects(f.run(),/RESTORE_UNCONFIRMED.*設定変更は完了.*goal=unknown/s);
  assert.deepEqual(f.effects,['paused','turn-end','configure']);
});

test('replaced generation or changed native goal is never resumed',async()=>{
  for (const change of [f=>{f.generation={...target,launch_id:'b'.repeat(32)};},
    f=>{f.stored={...f.stored,objective:'Owner change'};},f=>{f.stored=null;},
    f=>{f.stored={...f.stored,status:'complete'};},f=>{f.stored={...f.stored,createdAt:99};}]) {
    const f=fixture();f.configure=async()=>{change(f);f.effects.push('configure');return {};};
    await assert.rejects(f.run(),/RESTORE_UNCONFIRMED/);
    assert.deepEqual(f.effects,['paused','turn-end','configure']);
  }
});

test('fresh native mutation guard rejects changes between inspection and mutation',async()=>{
  const f=fixture();const before=structuredClone(f.stored);
  f.stored={...f.stored,objective:'Concurrent change'};
  const r=await f.runtime.goal('pause',before);
  assert.equal(r.reason,'goal_changed_before_mutation');assert.equal(r.mutation,'not_issued');assert.deepEqual(f.effects,[]);
});

test('pause-unsupported v2 goals give the canonical stop/complete instructions',async()=>{
  const f=fixture();f.runtime.goal=async()=>({schema:'aiterm.agent-goal-result.v2',availability:'available',readback:'confirmed',goal:{kind:'claude-code'}});
  await assert.rejects(f.run(),/GOAL_CONFIGURE_UNSUPPORTED.*goalを停止または完了/);
  assert.deepEqual(f.effects,[]);
});
