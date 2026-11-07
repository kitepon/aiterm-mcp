import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {waitAgentTuiReadyImpl} from '../dist/agent-screen-observation.js';

const rule='────────────────';
const screens={
 codex:'OpenAI Codex\n› ',
 claude:['Claude Code',rule,'❯ ',rule,'bypass permissions'].join('\n'),
};
async function observe(kind,costs,frames,options={}){
 let clock=0,calls=0;
 const result=await waitAgentTuiReadyImpl(kind,()=>{
  clock+=costs[Math.min(calls,costs.length-1)];
  return frames[Math.min(calls++,frames.length-1)];
 },async ms=>{clock+=ms;},{now:()=>clock,...options});
 return {...result,calls,elapsed:clock};
}

test('fast readiness retains eleven observations over five seconds',async()=>{
 for(const [kind,idle] of Object.entries(screens)){
  const r=await observe(kind,[0],[idle]);
  assert.equal(r.ready,true,kind);assert.equal(r.calls,11,kind);assert.equal(r.elapsed,5000,kind);
 }
});
test('slow native reads establish the same window with consecutive positive frames',async()=>{
 for(const [kind,idle] of Object.entries(screens))for(const [cost,count] of [[3000,3],[9000,2]]){
  const r=await observe(kind,[cost],[idle]);
  assert.equal(r.ready,true,`${kind} ${cost}`);assert.equal(r.calls,count,kind);
 }
});
test('the first slow read itself never counts as a stable interval',async()=>{
 for(const [kind,idle] of Object.entries(screens)){
  const r=await observe(kind,[9000,0],[idle]);
  assert.equal(r.ready,true,kind);assert.equal(r.calls,11,kind);assert.equal(r.elapsed,14000,kind);
 }
});
test('an intervening unknown frame resets the stabilization origin',async()=>{
 for(const [kind,idle] of Object.entries(screens)){
  const r=await observe(kind,[3000],[idle,'unrecognized startup frame',idle]);
  assert.equal(r.ready,true,kind);assert.equal(r.calls,5,kind);
 }
});
test('losing settled-turn evidence restarts the full positive window',async()=>{
 let checked=0;
 const r=await observe('codex',[9000],[screens.codex],{turnSettled:()=>++checked===1});
 assert.equal(r.ready,true);assert.equal(r.calls,3);
});
test('a slow final frame cannot authorize input after the existing deadline',async()=>{
 for(const [kind,idle] of Object.entries(screens)){
  const r=await observe(kind,[1000,30000],[idle]);
  assert.equal(r.ready,false,kind);assert.equal(r.calls,2,kind);
 }
});
test('a current modal stops a positive window immediately',async()=>{
 const modal='OpenAI Codex\nWould you like to run the following command?\n› 1. Yes\nenter select · esc cancel';
 const r=await observe('codex',[3000],[screens.codex,modal]);
 assert.equal(r.ready,false);assert.equal(r.calls,2);
});
test('zero-timeout and single-sample test observations retain their existing semantics',async()=>{
 const once=await observe('codex',[9000],[screens.codex],{timeoutMs:0});
 assert.equal(once.ready,false);assert.equal(once.calls,1);
 const override=await observe('codex',[9000],[screens.codex],{timeoutMs:0,stableSamples:1});
 assert.equal(override.ready,true);assert.equal(override.calls,1);
 const expired=await observe('codex',[9000],[screens.codex],{timeoutMs:8000});
 assert.equal(expired.ready,false);assert.equal(expired.calls,1);
});
