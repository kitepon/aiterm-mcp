import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {observeClaudeGoalStatus,readFreshClaudeGoal,observeClaudeGoalDialog,claudeGoalComposerEmpty} from '../dist/harnesses/claude-goal.js';
import {manageClaudeAgentGoal,agentGoalWireResultSchema,agentGoalOutputSchema} from '../dist/agent-goal-native-result.js';
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
 const r=agentGoalWireResultSchema.parse(await manageClaudeAgentGoal(input,runtime));assert.equal(r.schema,'aiterm.agent-goal-result.v2');assert.equal(r.goal,null);assert.equal(r.capabilities.inspect,true);assert.equal(r.capabilities.clear,false);assert.equal(reads,1);
 for(const other of [{action:'clear'},{expected_thread_id:'other'}]){const r=await manageClaudeAgentGoal({...input,...other},runtime);assert.equal(r.mutation,other.action?'not_issued':'not_requested');assert.equal('goal' in r,false);}assert.equal(reads,1);
});
test('failed fresh read and changed native owner never fabricate current null',async()=>{
 const target={session_id:'a',launch_id:'a'.repeat(32),harness:'claude-code',vendor_session_id:session};
 for(const mode of ['failure','changed']){
  let after=false;const r=await manageClaudeAgentGoal({session_id:'a',launch_id:target.launch_id,action:'inspect'},{resolve:()=>after?{...target,vendor_session_id:'changed'}:target,read:async()=>{if(mode==='failure')throw Error('no status');after=true;return {current:null};}});
  assert.equal(r.availability,'unavailable');assert.equal('goal' in r,false);
 }
});

test('MCP object output validates native tags and preserves the existing Codex v1 branch',()=>{
 const envelope={schema:'aiterm.agent-goal-result.v2',session_id:'a',launch_id:'a'.repeat(32),harness:'claude-code',binding:null,availability:'available',capabilities:{inspect:true,create:false,edit:false,pause:false,resume:false,clear:false},outcome:'observed',mutation:'not_requested',readback:'confirmed',goal:{kind:'claude-code',phase:'active',native},reason:'native_goal_observed',observed_at:new Date().toISOString()};
 assert.ok(agentGoalOutputSchema.safeParse(envelope).success);assert.equal(agentGoalOutputSchema.safeParse({...envelope,schema:'aiterm.agent-goal-result.v1'}).success,false);assert.equal(agentGoalOutputSchema.safeParse({...envelope,harness:'codex-cli'}).success,false);
});

function clearRuntime(options={}) {
 const target={session_id:'a',launch_id:'a'.repeat(32),harness:'claude-code',vendor_session_id:session};let currentTarget=target,reads=0,clears=0;
 const before={current:{kind:'claude-code',phase:'active',native}};
 const after={current:null,history:{kind:'claude-code',terminal:'cleared',native:{...native,met:true,sentinel:true}}};
 const runtime={resolve:()=>currentTarget,read:async()=>{reads++;if(reads===1)return before;if(options.readFails)throw Error('read disconnected');return options.after??after;},clear:async()=>{clears++;if(options.clearFails)throw Error('write disconnected');if(options.changed)currentTarget={...target,vendor_session_id:'other'};}};
 return {input:{session_id:'a',launch_id:target.launch_id,action:'clear'},runtime,counts:()=>({reads,clears})};
}
test('Owner clear requires the same live native binding and fresh empty plus matching cleared history',async()=>{
 const f=clearRuntime();const r=await manageClaudeAgentGoal(f.input,f.runtime,'user');assert.equal(r.outcome,'applied');assert.equal(r.mutation,'acknowledged');assert.equal(r.goal,null);assert.equal(r.native_history.terminal,'cleared');assert.deepEqual(f.counts(),{reads:2,clears:1});
});
test('model metadata cannot clear a Claude goal or issue native UI input',async()=>{
 const f=clearRuntime();const r=await manageClaudeAgentGoal(f.input,f.runtime,'automatic');assert.equal(r.reason,'user_authorization_required');assert.equal(r.mutation,'not_issued');assert.deepEqual(f.counts(),{reads:0,clears:0});
});
test('uncertain Claude clear is never retried or restored from a prior goal',async()=>{
 for(const option of [{clearFails:true},{readFails:true},{changed:true}]){const f=clearRuntime(option);const r=await manageClaudeAgentGoal(f.input,f.runtime,'user');assert.equal(r.outcome,'outcome_unknown');assert.equal(r.mutation,'outcome_unknown');assert.equal('goal'in r,false);assert.equal(f.counts().clears,1);}
});
test('empty after achievement or another condition is not proof of the requested clear',async()=>{
 for(const history of [{kind:'claude-code',terminal:'achieved',native:{...native,met:true,sentinel:undefined}},{kind:'claude-code',terminal:'cleared',native:{...native,met:true,condition:'Other goal'}}]){const f=clearRuntime({after:{current:null,history}});const r=await manageClaudeAgentGoal(f.input,f.runtime,'user');assert.equal(r.outcome,'outcome_unknown');assert.equal(r.readback,'mismatch');assert.equal(r.goal,null);assert.equal(f.counts().clears,1);}
});
test('a proven refusal at the clear input owner refreshes status and never replays clear',async()=>{
 const {AgentGoalNotIssuedError}=await import('../dist/agent-goal.js');const f=clearRuntime();let calls=0;f.runtime.clear=async()=>{calls++;throw new AgentGoalNotIssuedError('goal_input_owner_unavailable');};
 const r=await manageClaudeAgentGoal(f.input,f.runtime,'user');assert.equal(r.outcome,'rejected');assert.equal(r.mutation,'not_issued');assert.equal(r.readback,'confirmed');assert.equal(r.goal,null);assert.equal(calls,1);assert.equal(f.counts().reads,2);
});

test('native dim queued placeholder is empty while the same literal draft remains protected',async()=>{
 const {claudeGoalComposer}=await import('../dist/harnesses/claude-goal.js');
 const border='─'.repeat(80),text='Press up to edit queued messages';
 const native=`${border}\n❯\u00a0\x1b[7mP\x1b[0;2m${text.slice(1)}\x1b[0m\n${border}`;
 const draft=`${border}\n❯\u00a0\x1b[7mP\x1b[0m${text.slice(1)}\n${border}`;
 assert.equal(claudeGoalComposerEmpty(native),true);assert.equal(claudeGoalComposerEmpty(draft),false);assert.equal(claudeGoalComposer(draft).text,text);
});
test('native dim prompt suggestion of any text is empty; the pasted command replaces it',async()=>{
 const {claudeGoalComposer}=await import('../dist/harnesses/claude-goal.js');
 // Measured on Claude Code 2.1.322 after a second turn (capture-pane -e -J).
 const border='\x1b[38;5;244m'+'─'.repeat(80)+'\x1b[39m';
 const suggestion=`${border}\n\x1b[39m❯\u00a0\x1b[2mrun the doctests\x1b[0m\n${border}`;
 const pasted=`${border}\n\x1b[39m❯\u00a0\x1b[38;5;153m/goal\x1b[39m\n${border}`;
 const typed=`${border}\n\x1b[39m❯\u00a0run the doctests\n${border}`;
 assert.equal(claudeGoalComposerEmpty(suggestion),true);assert.equal(claudeGoalComposerEmpty(`${border}\n❯\u00a0\x1b[2mCIの結果を見ておいて\x1b[0m\n${border}`),true);
 assert.equal(claudeGoalComposer(pasted).text,'/goal');assert.equal(claudeGoalComposerEmpty(typed),false);
});
test('multiline native composer and goal dialog preserve exact newlines',async()=>{
 const {claudeGoalComposer}=await import('../dist/harnesses/claude-goal.js');
 const border='─'.repeat(80),condition='日本語🧪\n二行目';
 assert.equal(claudeGoalComposer(`${border}\n❯\u00a0/goal 日本語🧪\n  二行目\n${border}`).text,'/goal '+condition);
 const dialog=active.replace('Goal: Artificial condition','Goal: 日本語🧪\n         二行目');
 const r=observeClaudeGoalDialog(dialog,[attachment({...native,condition})],session);assert.equal(r.current.native.condition,condition);
 assert.equal(observeClaudeGoalDialog(dialog.replace('         二行目','         異なる行'),[attachment({...native,condition})],session),null);
});
test('unsupported native objective forms are refused before any paste',async()=>{
 const {validateClaudeGoalObjective}=await import('../dist/harnesses/claude-goal.js');
 const screen='\n'.repeat(15)+'─'.repeat(80)+'\n❯\n'+'─'.repeat(80);
 for(const objective of ['clear','CLEAR','a'.repeat(200),'a\n\nb','a\n  indented','a\u001bb','a\u0085b'])assert.throws(()=>validateClaudeGoalObjective(objective,screen));
 for(const objective of ['pause','resume','status','日本語🧪\n二行目','Literal --budget 1'])assert.doesNotThrow(()=>validateClaudeGoalObjective(objective,screen));
});
function objectiveRuntime(initial){
 const target={session_id:'a',launch_id:'a'.repeat(32),harness:'claude-code',vendor_session_id:session};let current=initial,calls=0;
 return {input:{session_id:'a',launch_id:target.launch_id},runtime:{resolve:()=>target,read:async()=>({current}),setObjective:async(_target,objective)=>{calls++;current={kind:'claude-code',phase:'active',native:{type:'goal_status',condition:objective,met:false,sentinel:true}};}},calls:()=>calls};
}
test('create and objective edit share the native setter but enforce existence and per-field capability',async()=>{
 const f=objectiveRuntime(null);let r=await manageClaudeAgentGoal({...f.input,action:'edit',objective:'missing'},f.runtime,'user');assert.equal(r.reason,'goal_missing');assert.equal(f.calls(),0);
 r=await manageClaudeAgentGoal({...f.input,action:'create',objective:'最初\n二行目'},f.runtime,'user');assert.equal(r.outcome,'applied');assert.equal(r.goal.native.condition,'最初\n二行目');assert.equal(r.field_capabilities.create.objective,true);assert.equal(r.field_capabilities.create.token_budget,false);assert.equal(r.field_capabilities.edit.combined,false);assert.equal(f.calls(),1);
 r=await manageClaudeAgentGoal({...f.input,action:'create',objective:'replace'},f.runtime,'user');assert.equal(r.reason,'goal_already_exists');assert.equal(f.calls(),1);
 for(const fields of [{token_budget:1},{objective:'must not split',token_budget:1}]){r=await manageClaudeAgentGoal({...f.input,action:'edit',...fields},f.runtime,'user');assert.equal(r.mutation,'not_issued');assert.equal(r.reason,'native_goal_field_unsupported');assert.equal(r.goal.native.condition,'最初\n二行目');}assert.equal(f.calls(),1);
 r=await manageClaudeAgentGoal({...f.input,action:'edit',objective:'pause'},f.runtime,'user');assert.equal(r.outcome,'applied');assert.equal(r.goal.native.condition,'pause');assert.equal(r.goal.phase,'active');assert.equal(f.calls(),2);
});
test('new objective requires complete canonical active readback; native whitespace changes are not normalized',async()=>{
 const f=objectiveRuntime(null);let reads=0;f.runtime.read=async()=>++reads===1?{current:null}:{current:{kind:'claude-code',phase:'active',native:{...native,condition:'alpha beta'}}};
 const r=await manageClaudeAgentGoal({...f.input,action:'create',objective:'alpha\nbeta'},f.runtime,'user');assert.equal(r.outcome,'outcome_unknown');assert.equal(r.readback,'mismatch');assert.equal(r.goal.native.condition,'alpha beta');assert.equal(f.calls(),1);
});

test('official current-session registry binds the native PID birth and namespace, not just the same TTY process',async()=>{
 const {claudeCurrentSessionOwner}=await import('../dist/harnesses/claude-goal.js');
 const expected={pid:123,sessionId:'01234567-1234-4567-8123-0123456789ab',procStart:'456',pidDomain:'linux::pid:[99]'};
 const row={...expected,sessionId:expected.sessionId,version:'2.1.310',kind:'interactive'};
 assert.equal(claudeCurrentSessionOwner(row,expected),'match');
 assert.equal(claudeCurrentSessionOwner({...row,sessionId:'fedcba98-1234-4567-8123-0123456789ab'},expected),'mismatch');
 for(const fields of [{pid:124},{procStart:'457'},{pidDomain:'linux::pid:[100]'},{kind:'print'}])assert.equal(claudeCurrentSessionOwner({...row,...fields},expected),'unavailable');
 assert.equal(claudeCurrentSessionOwner({...row,version:'2.1.322'},expected),'match');
 for(const version of ['2.2.0','2.1.309','future'])assert.deepEqual(claudeCurrentSessionOwner({...row,version},expected),{unsupported:version});
 assert.equal(claudeCurrentSessionOwner({...row,version:'2.2.0',pid:124},expected),'unavailable');
 assert.equal(claudeCurrentSessionOwner(null,expected),'unavailable');
});
test('shared OS birth identity keeps the runtime-store API and gives the same live Linux registration ticks',async t=>{
 const {processStartIdentity}=await import('../dist/process-start.js');
 const {processStartIdentity:compat}=await import('../dist/runtime-error-os.js');
 assert.equal(compat,processStartIdentity);
 const {readLinuxProcessRegistrationIdentity}=await import('../dist/process-runtime.js');
 if(process.platform!=='linux'){assert.equal(readLinuxProcessRegistrationIdentity(process.pid),null);return;}
 const value=readLinuxProcessRegistrationIdentity(process.pid);assert.equal('linux:'+value.procStart,processStartIdentity(process.pid,'linux'));assert.match(value.pidDomain,/^linux::pid:\[\d+\]$/);assert.equal(readLinuxProcessRegistrationIdentity(-1),null);
});

test('measured Claude 2.1.322 goal dialog and attachments are read like 2.1.310',async()=>{
 const fs=await import('node:fs');const dir=new URL('./fixtures/claude-goal-2.1.322/',import.meta.url);
 const screen=name=>fs.readFileSync(new URL(name+'.screen',dir),'utf8');
 const rows=fs.readFileSync(new URL('attachments.jsonl',dir),'utf8').trim().split('\n').map(line=>JSON.parse(line));
 const id=rows[0].sessionId;
 assert.deepEqual(observeClaudeGoalDialog(screen('active'),rows.slice(0,1),id).current,{kind:'claude-code',phase:'active',native:{type:'goal_status',met:false,sentinel:true,condition:'Artificial condition'}});
 const cleared=observeClaudeGoalDialog(screen('cleared'),rows,id);assert.equal(cleared.current,null);assert.equal(cleared.history.terminal,'cleared');
 assert.equal(observeClaudeGoalDialog(screen('active'),rows.slice(0,1).map(row=>({...row,version:'2.2.0'})),id),null);
});
test('an unverified Claude version is unsupported with the version in the reason, not a read failure',async()=>{
 const {AgentGoalNotIssuedError}=await import('../dist/agent-goal.js');
 const target={session_id:'a',launch_id:'a'.repeat(32),harness:'claude-code',vendor_session_id:session};
 const r=agentGoalWireResultSchema.parse(await manageClaudeAgentGoal({session_id:'a',launch_id:target.launch_id,action:'inspect'},{resolve:()=>target,read:async()=>{throw new AgentGoalNotIssuedError('claude_code_version_unverified:2.2.0','unsupported');}}));
 assert.equal(r.availability,'unsupported');assert.equal(r.outcome,'unsupported');assert.equal(r.reason,'claude_code_version_unverified:2.2.0');assert.equal(r.readback,'not_attempted');assert.equal('goal' in r,false);
});
// Records measured on Claude Code 2.1.322 (Mac seat 34667, fox seat 47076, 2026-11-12).
const registration=(over)=>({pid:1,sessionId:'586615a2-c656-43c6-a41c-c9436e331122',version:'2.1.322',kind:'interactive',...over});
test('darwin registration identity is UTC ps lstart with domain darwin',async()=>{
 const {claudeRegistrationIdentity}=await import('../dist/process-runtime.js');const {claudeCurrentSessionOwner}=await import('../dist/harnesses/claude-goal.js');
 const id=claudeRegistrationIdentity('darwin','Thu Nov 12 00:38:39 2026','mac');
 assert.deepEqual(id,{procStart:'Thu Nov 12 00:38:39 2026',pidDomain:'darwin'});
 const record=registration({pid:34667,procStart:'Thu Nov 12 00:38:39 2026',pidDomain:'darwin'});
 assert.equal(claudeCurrentSessionOwner(record,{pid:34667,sessionId:record.sessionId,...id}),'match');
 assert.equal(claudeCurrentSessionOwner(record,{pid:34667,sessionId:record.sessionId,...claudeRegistrationIdentity('darwin','Thu Nov 12 00:38:40 2026','mac')}),'unavailable');
 assert.equal(claudeRegistrationIdentity('darwin',null,'mac'),null);
});
test('win32 registration identity is the creation FILETIME with domain win32:<hostname>',async()=>{
 const {claudeRegistrationIdentity}=await import('../dist/process-runtime.js');const {claudeCurrentSessionOwner}=await import('../dist/harnesses/claude-goal.js');
 const id=claudeRegistrationIdentity('win32','win32:639300494488810150','FOX');
 assert.deepEqual(id,{procStart:'134389262488810150',pidDomain:'win32:fox'});
 const record=registration({pid:47076,sessionId:'a0f33796-df3c-4b9e-8774-11611ecd55fc',procStart:'134389262488810150',pidDomain:'win32:fox'});
 assert.equal(claudeCurrentSessionOwner(record,{pid:47076,sessionId:record.sessionId,...id}),'match');
 for(const start of [null,'linux:12','win32:1'])assert.equal(claudeRegistrationIdentity('win32',start,'fox'),null);
});
