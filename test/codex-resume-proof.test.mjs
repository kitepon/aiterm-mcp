import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {captureCodexResumeProof,readCodexResumeProof,codexResumeProofDigest} from '../dist/harnesses/codex.js';
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
