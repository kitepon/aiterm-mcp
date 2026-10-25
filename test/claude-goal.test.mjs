import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {observeClaudeGoalStatus,readFreshClaudeGoal,observeClaudeGoalDialog,claudeGoalComposerEmpty} from '../dist/harnesses/claude-goal.js';
import {inspectClaudeAgentGoal,agentGoalWireResultSchema,agentGoalOutputSchema} from '../dist/agent-goal-native-result.js';
const session='official-native-session';
const native={type:'goal_status',condition:'Artificial condition',met:false,sentinel:true};
const attachment=payload=>({type:'attachment',uuid:'event-native',attachment:payload,sessionId:session,isSidechain:false,version:'2.1.310'});
const query=(content,rest={})=>({type:'system',subtype:'local_command',sessionId:session,isSidechain:false,uuid:'query-native',timestamp:'2026-10-25T10:00:00.000Z',version:'2.1.310',commandRun:{command:'goal',args:''},content:`<local-command-stdout>${content}</local-command-stdout>`,...rest});
const empty='Claude Code v2.1.310\n\n   Goal\n\n   No goal set\n   /goal <condition> to set one\n\n   Esc to dismiss\n\n';
const active='Claude Code v2.1.310\n\n   ◎ Goal active\n   running 1s · 0 tokens\n\n   Goal: Artificial condition\n\n   /goal clear to stop early · Esc to dismiss\n';
test('fresh stream status preserves native fields without invented Codex usage',()=>{
 const r=observeClaudeGoalStatus([attachment(native),query('Goal active: Artificial condition (2 turns)')],session,'query-native');
 assert.equal(r.current.native.condition,native.condition);assert.equal(r.current.reported_turns,2);assert.equal('tokensUsed' in r.current.native,false);assert.equal('tokens' in r.current.native,false);
});
test('clear sentinel is distinct from achievement and history alone cannot establish empty current',()=>{
 for(const [sentinel,terminal] of [[true,'cleared'],[undefined,'achieved']]){
  const row=attachment({...native,met:true,sentinel});
  assert.throws(()=>observeClaudeGoalStatus([row],session,'query-native'));
  const r=observeClaudeGoalStatus([row,query('No goal set')],session,'query-native');assert.equal(r.current,null);assert.equal(r.history.terminal,terminal);
 }
});
test('wrong session, duplicate native query, sidechain, future version and mismatched status are refused',()=>{
 for(const rows of [[attachment(native),query('Goal active: Artificial condition (2 turns)',{sessionId:'other'})],[query('No goal set'),query('No goal set')],[query('No goal set',{isSidechain:true})],[query('No goal set',{version:'9'})],[attachment(native),query('Goal active: other (2 turns)')]])assert.throws(()=>observeClaudeGoalStatus(rows,session,'query-native'));
});
test('fresh stream read sends one query; old evidence, transcript replacement and generation replacement cannot satisfy it',async()=>{
 for(const mode of ['stale','replace','generation']){
  let calls=0,ticks=0;const old=[attachment(native),query('No goal set')];
  await assert.rejects(readFreshClaudeGoal(session,{readRows:()=>calls&&mode==='replace'?[]:old,query:async()=>{calls++;},same:()=>!(calls&&mode==='generation'),pause:async()=>{ticks+=1000;},now:()=>ticks}));assert.equal(calls,1);
 }
});
test('native dialog requires exact current modal and matching root attachment; truncated conditions remain unavailable',()=>{
 assert.equal(observeClaudeGoalDialog(empty,[],session).current,null);
 assert.equal(observeClaudeGoalDialog(active,[attachment(native)],session).current.native.condition,native.condition);
 assert.equal(observeClaudeGoalDialog(active,[],session),null);
 assert.equal(observeClaudeGoalDialog(active.replace('Artificial condition','Artificial…'),[attachment(native)],session),null);
 assert.equal(observeClaudeGoalDialog(active+'❯ new draft',[attachment(native)],session),null);
 assert.throws(()=>observeClaudeGoalDialog(active,[{...attachment(native),sessionId:'other'}],session));
});
test('dialog input requires a strictly empty native composer, preserving drafts and selection menus',()=>{
 assert.equal(claudeGoalComposerEmpty('────────────\n❯\n────────────'),true);
 for(const screen of ['────────────\n❯ draft\n────────────','❯ No, disable external imports\nEnter to confirm','❯\n────────────'])assert.equal(claudeGoalComposerEmpty(screen),false);
});
test('Claude inspect uses native v2; unsupported mutation and mismatched binding never query the UI',async()=>{
 const target={session_id:'a',launch_id:'a'.repeat(32),harness:'claude-code',vendor_session_id:session};let reads=0;
 const runtime={resolve:()=>target,read:async()=>{reads++;return {current:null};}};
 const input={session_id:'a',launch_id:target.launch_id,action:'inspect'};
 const r=agentGoalWireResultSchema.parse(await inspectClaudeAgentGoal(input,runtime));assert.equal(r.schema,'aiterm.agent-goal-result.v2');assert.equal(r.goal,null);assert.equal(r.capabilities.inspect,true);assert.equal(r.capabilities.clear,false);assert.equal(reads,1);
 for(const other of [{action:'clear'},{expected_thread_id:'other'}]){const r=await inspectClaudeAgentGoal({...input,...other},runtime);assert.equal(r.mutation,other.action?'not_issued':'not_requested');assert.equal('goal' in r,false);}assert.equal(reads,1);
});
test('failed fresh read and changed native owner never fabricate current null',async()=>{
 const target={session_id:'a',launch_id:'a'.repeat(32),harness:'claude-code',vendor_session_id:session};
 for(const mode of ['failure','changed']){
  let after=false;const r=await inspectClaudeAgentGoal({session_id:'a',launch_id:target.launch_id,action:'inspect'},{resolve:()=>after?{...target,vendor_session_id:'changed'}:target,read:async()=>{if(mode==='failure')throw Error('no status');after=true;return {current:null};}});
  assert.equal(r.availability,'unavailable');assert.equal('goal' in r,false);
 }
});

test('MCP object output validates native tags and preserves the existing Codex v1 branch',()=>{
 const envelope={schema:'aiterm.agent-goal-result.v2',session_id:'a',launch_id:'a'.repeat(32),harness:'claude-code',binding:null,availability:'available',capabilities:{inspect:true,create:false,edit:false,pause:false,resume:false,clear:false},outcome:'observed',mutation:'not_requested',readback:'confirmed',goal:{kind:'claude-code',phase:'active',native},reason:'native_goal_observed',observed_at:new Date().toISOString()};
 assert.ok(agentGoalOutputSchema.safeParse(envelope).success);assert.equal(agentGoalOutputSchema.safeParse({...envelope,schema:'aiterm.agent-goal-result.v1'}).success,false);assert.equal(agentGoalOutputSchema.safeParse({...envelope,harness:'codex-cli'}).success,false);
});
