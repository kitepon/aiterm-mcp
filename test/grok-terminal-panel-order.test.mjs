import './seat-env.mjs';
import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'grok-order-'));
Object.assign(process.env,{HOME:root,TMPDIR:root,XDG_RUNTIME_DIR:root});
const grok=await import('../dist/harnesses/grok.js');
const shared=await import('../dist/agent-shared.js');
after(()=>fs.rmSync(root,{recursive:true,force:true}));
const message='You hit your weekly limit.';
async function fixture(run){
 const dir=fs.mkdtempSync(path.join(root,'case-'));
 const meta={kind:'grok',aiterm_session:'pure-order',launch_id:'a'.repeat(32),grok_home:dir,cwd:dir,vendor_session_id:'synthetic'};
 const metadata=shared.agentMetadataPath(meta.aiterm_session,meta.launch_id),transcript=grok.grokEventsTranscript(meta);
 fs.mkdirSync(path.dirname(metadata),{recursive:true});fs.writeFileSync(metadata,'{}');
 fs.mkdirSync(path.dirname(transcript),{recursive:true});
 fs.writeFileSync(transcript,JSON.stringify({type:'turn_ended',outcome:'error',ts:'current-turn'})+'\n');
 try{await run({meta,metadata,transcript});}
 finally{fs.rmSync(metadata,{force:true});fs.rmSync(dir,{recursive:true,force:true});assert.equal(fs.existsSync(metadata),false);assert.equal(fs.existsSync(dir),false);}
}
test('completion error waits for one fresh panel read when the panel follows its event',()=>fixture(async({meta})=>{
 let reads=0,visible=false;const order=['error event'];
 const result=await grok.observeGrokDone(meta,1,0,()=>{
  reads++;order.push(visible?'current panel':'panel not rendered');
  if(reads===1)queueMicrotask(()=>{visible=true;order.push('panel rendered');});
  return visible?message:null;
 });
 assert.equal(result.outcome,'rate_limited');assert.equal(result.turn_id,'current-turn');assert.equal(result.rate_limit,message);assert.equal(reads,2);
 assert.deepEqual(order,['error event','panel not rendered','panel rendered','current panel']);
}));
test('a completed ordinary error stays an error after the bounded panel read',()=>fixture(async({meta})=>{
 let reads=0;const result=await grok.observeGrokDone(meta,1,0,()=>{reads++;return null;});
 assert.equal(result.outcome,'error');assert.equal(result.turn_id,'current-turn');assert.equal(result.rate_limit,null);assert.equal(reads,2);
}));
test('one-shot error observation does not wait for a later panel',()=>fixture(async({meta})=>{
 let reads=0;const result=await grok.observeGrokDone(meta,0,0,()=>{reads++;return null;});
 assert.equal(result.outcome,'error');assert.equal(reads,1);
}));
test('a new turn during panel settlement is not the previous terminal error',()=>fixture(async({meta,transcript})=>{
 let reads=0;const result=await grok.observeGrokDone(meta,0.15,0,()=>{
  if(++reads===1)queueMicrotask(()=>fs.appendFileSync(transcript,'{"type":"turn_started","turn_number":2}\n'));
  return null;
 });
 assert.equal(result.outcome,'timeout');assert.equal(result.turn_id,null);assert.equal(result.error,null);
}));
test('removing the original launch during panel settlement returns closed',()=>fixture(async({meta,metadata})=>{
 let reads=0;const result=await grok.observeGrokDone(meta,1,0,()=>{if(++reads===1)queueMicrotask(()=>fs.rmSync(metadata));return null;});
 assert.equal(result.outcome,'closed');assert.equal(reads,1);
}));
