import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {captureCodexRecoveryProof,captureCodexResumeProof,readCodexResumeProof,codexResumeProofDigest,codexRootTranscript,codexBoundTranscript,
 latestCodexCompletion,codexCompletedTurnId,codexRunningTurn,codexInterruptionRecord,observeCodexDone,bindCodexTranscriptSession,
 codexTranscriptText} from '../dist/harnesses/codex.js';
import {writeAgentMetadata,agentMetadataPath} from '../dist/agent-shared.js';
import {writeAgentResumeRecipe,agentResumeRecipeDigest,writeAgentLifecycle,writeAgentResumeAttempt,writeAgentResumeNative,writeAgentResumeRecoveryOrigin,agentResumeRecordDigest} from '../dist/agent-lifecycle.js';
import {observeSteerDone} from '../dist/steer-follow.js';
import {readInterimWords} from '../dist/interim-words.js';
let serial=0;
function fixture(){
 const number=++serial,home=path.join(process.env.HOME,'proof-'+number),dir=path.join(home,'sessions');fs.mkdirSync(dir,{recursive:true});
 const session='11111111-2222-4333-8444-'+String(number).padStart(12,'0');
 const meta={kind:'codex',aiterm_session:'proof-'+number,launch_id:'a'.repeat(32),vendor_session_id:session,hook_route:'shared_codex_home',
  created_at:new Date(Date.now()-60000).toISOString(),codex_home:home};
 const file=path.join(dir,'rollout-'+session+'.jsonl');
 const event=(type,id='original')=>({type:'event_msg',payload:{type,turn_id:id}});
 const lines=[{type:'session_meta',payload:{id:session,originator:'codex-tui',source:'cli'}},
  {type:'response_item',payload:{type:'message',role:'developer',content:[{type:'input_text',text:'AITERM_AGENT_LAUNCH_ID='+meta.launch_id}]}},
  {type:'turn_context',payload:{}},event('task_started'),event('task_complete')];
 const write=(records=lines)=>fs.writeFileSync(file,records.map(JSON.stringify).join('\n')+'\n');write();
 return {meta,file,dir,lines,event,write};
}
test('a unique completed native root pins original file identity, prefix and the last old turn',()=>{
 const f=fixture(),proof=captureCodexResumeProof(f.meta);
 assert.deepEqual(readCodexResumeProof(f.meta),proof);assert.equal(proof.last_turn_id,'original');assert.equal(proof.session_id,f.meta.vendor_session_id);
 assert.equal(proof.cursor,fs.statSync(f.file).size);assert.match(codexResumeProofDigest(proof),/^[a-f0-9]{64}$/);
 fs.appendFileSync(f.file,[f.event('task_started','next'),f.event('task_complete','next')].map(JSON.stringify).join('\n')+'\n');
 assert.deepEqual(readCodexResumeProof(f.meta),proof,'append-only history preserves the prior prefix');
 const next=captureCodexResumeProof(f.meta);assert.equal(next.last_turn_id,'next');assert.ok(next.cursor>proof.cursor);
});

function resumed(){
 const f=fixture(),proof=captureCodexResumeProof(f.meta);
 const recipe={schema:'aiterm.agent-resume.v1',launch_id:f.meta.launch_id,kind:'codex',vendor_session_id:f.meta.vendor_session_id,
  executable:process.execPath,cwd:process.env.HOME,configuration_root:f.meta.codex_home,model:'fixture',reasoning_effort:'high',fast:false,environment:{}};
 writeAgentMetadata(f.meta);writeAgentResumeRecipe(f.meta,recipe);
 const life={schema:'aiterm.agent-lifecycle.v1',launch_id:f.meta.launch_id,state:'hibernated',at:new Date().toISOString(),anchor:'finished',native_id:'$1',
  pane:{pid:123,process_group_id:123,started_identity:'fixture',argv_digest:'0'.repeat(64)},recipe_digest:agentResumeRecipeDigest(recipe),resume_proof_digest:codexResumeProofDigest(proof)};
 writeAgentLifecycle(f.meta,life);
 const next={...f.meta,launch_id:'b'.repeat(32),resumed_from:f.meta.launch_id,created_at:new Date().toISOString()};writeAgentMetadata(next);
 return {...f,proof,life,recipe,next,append:records=>fs.appendFileSync(f.file,records.map(JSON.stringify).join('\n')+'\n')};
}
const lines=file=>fs.readFileSync(file,'utf8').trim().split('\n');
test('resumed readers exclude historical completions and a delayed old turn, then accept only a new native turn',async()=>{
 const f=resumed();assert.equal(codexRootTranscript(f.next),f.file);assert.equal(codexBoundTranscript(f.next),f.file);
 assert.equal(latestCodexCompletion(f.next,lines),null);assert.equal(codexCompletedTurnId(f.next),null);
 assert.equal(codexInterruptionRecord(f.next),null);
 assert.throws(()=>codexTranscriptText(f.next,'original',lines,()=>{throw new Error('unavailable');},true),/unavailable/);
 f.append([f.event('task_complete','original')]);
 assert.equal(latestCodexCompletion(f.next,lines),null);assert.equal(codexCompletedTurnId(f.next),null);
 assert.equal((await observeCodexDone(f.next,0,0)).outcome,'running','a stale cursor cannot borrow the old turn');
 f.append([f.event('task_started','resumed')]);assert.equal(codexRunningTurn(f.next),'resumed');
 f.append([f.event('task_complete','resumed')]);
 assert.equal(codexCompletedTurnId(f.next),'resumed');assert.equal(latestCodexCompletion(f.next,lines).turn_id,'resumed');
 assert.equal(codexInterruptionRecord(f.next).boundary.turn_id,'resumed');
 assert.equal((await observeCodexDone(f.next,0,0)).turn_id,'resumed');
 const proof=captureCodexResumeProof(f.next);assert.equal(proof.launch_id,f.next.launch_id);assert.equal(proof.last_turn_id,'resumed');
});
test('a second resume carries the immediate predecessor proof without treating the original marker as its own',()=>{
 const f=resumed();f.append([f.event('task_started','second'),f.event('task_complete','second')]);
 const proof=captureCodexResumeProof(f.next),recipe={...f.recipe,launch_id:f.next.launch_id};
 writeAgentResumeRecipe(f.next,recipe);writeAgentLifecycle(f.next,{...f.life,launch_id:f.next.launch_id,
  recipe_digest:agentResumeRecipeDigest(recipe),resume_proof_digest:codexResumeProofDigest(proof)});
 const last={...f.next,launch_id:'c'.repeat(32),resumed_from:f.next.launch_id};
 assert.equal(codexRootTranscript(last),f.file);assert.equal(latestCodexCompletion(last,lines),null);
 f.append([f.event('task_started','third'),f.event('task_complete','third')]);
 assert.equal(codexInterruptionRecord(last).boundary.turn_id,'third');
});
test('a resumed launch follows /new only with the new marker, and rejects forked or foreign roots',()=>{
 const f=resumed(),ms=Date.now(),stamp=ms.toString(16).padStart(12,'0'),session=`${stamp.slice(0,8)}-${stamp.slice(8)}-7000-8000-111111111111`;
 const file=path.join(f.dir,'rollout-'+session+'.jsonl');
 const header={type:'session_meta',payload:{id:session,originator:'codex-tui',source:'cli'}};
 const marker={type:'response_item',payload:{type:'message',role:'developer',content:[{type:'input_text',text:'AITERM_AGENT_LAUNCH_ID='+f.next.launch_id}]}};
 const write=()=>{fs.writeFileSync(file,[header,marker,{type:'turn_context',payload:{}},f.event('task_complete','new-root')].map(JSON.stringify).join('\n')+'\n');
  fs.utimesSync(file,new Date(ms+2000),new Date(ms+2000));};
 header.payload.forked_from_id=f.meta.vendor_session_id;write();assert.equal(codexRootTranscript(f.next),f.file);
 delete header.payload.forked_from_id;fs.unlinkSync(file);
 // Use another path so a previously excluded immutable fork is not reclassified.
 const validFile=path.join(f.dir,'rollout-new-'+session+'.jsonl');write();fs.renameSync(file,validFile);
 assert.equal(bindCodexTranscriptSession(f.next),validFile);assert.equal(f.next.vendor_session_id,session);
 assert.equal(latestCodexCompletion(f.next,lines).turn_id,'new-root');
 assert.equal(codexInterruptionRecord(f.next).boundary.turn_id,'new-root');
 marker.payload.content[0].text='AITERM_AGENT_LAUNCH_ID='+'f'.repeat(32);
 fs.writeFileSync(validFile,[header,marker,{type:'turn_context',payload:{}}].map(JSON.stringify).join('\n')+'\n');
 assert.throws(()=>codexBoundTranscript(f.next),/AGENT_RESUME_UNCONFIRMED/);
});
test('steer and interim readers apply the same resume floor to stale cursors',async()=>{
 const f=resumed(),text='only this newly submitted request';
 f.append([{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}],internal_chat_message_metadata_passthrough:{turn_id:'original'}}},f.event('task_complete','original')]);
 const entry={schema:'aiterm.steer-entry.v1',steer_id:'a'.repeat(16),at:new Date().toISOString(),event_cursor:0,interim_from:'',needle:text.replace(/\s/g,'')};
 const pending=await observeSteerDone(f.next,entry,0,{plain:()=>{throw new Error('unexpected fallback');}});
 assert.equal(pending.outcome,'running');assert.equal(pending.turn_id,null);
 f.append([f.event('task_started','new-steer'),{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}],internal_chat_message_metadata_passthrough:{turn_id:'new-steer'}}},f.event('task_complete','new-steer')]);
 assert.equal((await observeSteerDone(f.next,entry,0,{plain:()=>{throw new Error('unexpected fallback');}})).turn_id,'new-steer');
 const commentary=(turn_id,text)=>({type:'response_item',payload:{type:'message',role:'assistant',phase:'commentary',content:[{type:'output_text',text}],internal_chat_message_metadata_passthrough:{turn_id}}});
 f.append([commentary('original','stale words'),commentary('new-steer','new words')]);
 const interim=readInterimWords(f.next,0,{event_cursor:0,unit:'byte',boundary:0});
 assert.deepEqual(interim.words.map(word=>word.text),['new words']);
});
test('resumed binding rejects missing or inconsistent provenance and replacement history',()=>{
 for(const change of [f=>fs.unlinkSync(agentMetadataPath(f.meta.aiterm_session,f.meta.launch_id)),
  f=>writeAgentLifecycle(f.meta,{...f.life,state:'stopping'}),
  f=>writeAgentLifecycle(f.meta,{...f.life,resume_proof_digest:'f'.repeat(64)}),
  f=>writeAgentResumeRecipe(f.meta,{...f.recipe,model:'changed'}),
  f=>{f.next.parent_session_id='foreign';},
  f=>{const replacement=f.file+'.new';fs.copyFileSync(f.file,replacement);fs.renameSync(replacement,f.file);}]){
  const f=resumed();change(f);assert.throws(()=>codexRootTranscript(f.next),/AGENT_RESUME_UNCONFIRMED/);
  assert.throws(()=>codexBoundTranscript(f.next),/AGENT_RESUME_UNCONFIRMED/);
  assert.throws(()=>bindCodexTranscriptSession(f.next),/AGENT_RESUME_UNCONFIRMED/);
 }
});
test('replacement, truncation, prefix edits and foreign session IDs cannot reuse the old proof',()=>{
 for(const change of [f=>{const replacement=f.file+'.replacement';fs.copyFileSync(f.file,replacement);fs.renameSync(replacement,f.file);},
  f=>fs.truncateSync(f.file,10),f=>{const body=fs.readFileSync(f.file,'utf8').replace('codex-tui','codex-bad');fs.writeFileSync(f.file,body);},
  f=>{f.meta.vendor_session_id='other';}]){
  const f=fixture();captureCodexResumeProof(f.meta);change(f);assert.throws(()=>readCodexResumeProof(f.meta),/AGENT_RESUME_UNCONFIRMED/);
 }
});
test('an unfinished, forked, unmarked or ambiguous native root is not a resumable stopping precondition',()=>{
 for(const change of [f=>f.write(f.lines.slice(0,-1)),f=>{f.lines[0].payload.forked_from_id='foreign';f.write();},
  f=>{f.lines[1].payload.content[0].text='other launch';f.write();},
  f=>{fs.writeFileSync(path.join(f.dir,'rollout-unfinished.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'other',originator:'codex-tui',source:'cli'}})+'\n');}]){
  const f=fixture();change(f);assert.throws(()=>captureCodexResumeProof(f.meta),/AGENT_RESUME_UNCONFIRMED/);
 }
});

test('cold proof accepts an inherited root before a new task and never claims completion for an unfinished turn',()=>{
 const f=resumed();assert.equal(codexInterruptionRecord(f.next),null);
 const first=captureCodexRecoveryProof(f.next);assert.equal(first.cursor,fs.statSync(f.file).size);assert.equal(first.last_turn_id,'original');
 f.append([f.event('task_started','unfinished')]);
 const proof=captureCodexRecoveryProof(f.next);assert.equal(proof.last_turn_id,'unfinished');assert.ok(proof.cursor>first.cursor);
 assert.throws(()=>captureCodexResumeProof(f.next),/AGENT_RESUME_UNCONFIRMED/);
});
test('cold source retains failed history and excludes every pre-create completion for its new generation',()=>{
 const f=resumed();f.append([f.event('task_started','prior'),f.event('task_complete','prior')]);
 const proof=captureCodexRecoveryProof(f.next),recipe={...f.recipe,launch_id:f.next.launch_id};writeAgentResumeRecipe(f.next,recipe);
 const attempt={schema:'aiterm.agent-resume-attempt.v1',launch_id:f.meta.launch_id,next_launch_id:f.next.launch_id,state:'failed',at:new Date().toISOString(),recipe_digest:agentResumeRecipeDigest(f.recipe)};
 writeAgentResumeAttempt(f.meta,attempt);
 const native={schema:'aiterm.agent-resume-native.v1',launch_id:f.next.launch_id,native_id:'$2',session_id:f.next.aiterm_session,server_pid:12,server_started_identity:'server-old',pane_id:'%2',pane_pid:13,pane_started_identity:'pane-old'};writeAgentResumeNative(f.next,native);
 writeAgentResumeRecoveryOrigin(f.next,{schema:'aiterm.agent-resume-recovery-origin.v1',launch_id:f.next.launch_id,previous_launch_id:f.meta.launch_id,socket:'fixture-socket',at:new Date().toISOString(),
 failed_attempt_digest:agentResumeRecordDigest(attempt),recipe_digest:agentResumeRecipeDigest(recipe),resume_proof_digest:codexResumeProofDigest(proof),previous_native_digest:agentResumeRecordDigest(native)});
 const current={...f.next,launch_id:'d'.repeat(32),resumed_from:f.next.launch_id};
 assert.equal(codexRootTranscript(current),f.file);assert.equal(latestCodexCompletion(current,lines),null);
 f.append([f.event('task_complete','prior')]);assert.equal(latestCodexCompletion(current,lines),null);
 f.append([f.event('task_started','new'),f.event('task_complete','new')]);assert.equal(codexCompletedTurnId(current),'new');
});
test('partial and replaced inherited histories cannot be checkpointed as cold proof',()=>{
 const f=resumed();fs.appendFileSync(f.file,'{"type":');assert.throws(()=>captureCodexRecoveryProof(f.next),/AGENT_RESUME_UNCONFIRMED/);
});
