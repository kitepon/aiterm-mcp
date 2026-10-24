import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileExecutionStore } from '../dist/execution-store.js';
import { ExecutionService } from '../dist/execution-service.js';
const skip = process.platform === 'win32' ? 'POSIX durable execution store' : false;
const B={session_id:'synthetic-b',launch_id:'b'.repeat(32)}, C={session_id:'synthetic-c',launch_id:'c'.repeat(32)};
const point={launch:B,boundary:{event_cursor:1,operation_id:null,turn_id:null,steer_id:null}};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
async function fixture(t){
 const path=mkdtempSync(join(tmpdir(),'completion-admission-'));t.after(()=>rmSync(path,{recursive:true,force:true}));
 const store=new FileExecutionStore(path,50),otherStore=new FileExecutionStore(path,50),entered=deferred(),release=deferred();
 const runtime={sourceEvidence:async()=>({runtime_launch:null,caller_bound:false,invocation_boundary:null}),observe:async session=>({state:'present',launch:session===B.session_id?B:C}),
  async completion(target){assert.deepEqual(target,point);entered.resolve();await release.promise;return{state:'completed',fence:'closed'}}};
 const service=new ExecutionService(store,runtime),other=new ExecutionService(otherStore,runtime);
 const registration=(id,target=B)=>({action:'register',source_session_id:null,reservation:{schema:'aiterm.execution-reservation.v1',request:{kind:'delivery',delivery_id:id,target_session_id:target.session_id},source:{launch:null,boundary:null},target:{session_id:target.session_id,expected_launch_id:target.launch_id}}});
 const input=registration('synthetic-old');await service.execute(input);const request=input.reservation.request;
 await service.invoke({schema:'aiterm.execution-ref.v1',request},'send',async()=>({value:'synthetic-accepted',target:point}));
 const finish=()=>service.execute({action:'finish',request,evidence:{kind:'completion',target:point}});
 return {store,otherStore,runtime,service,other,registration,request,finish,entered,release};
}
test('slow completion observation does not own the metadata mutex or block another target registration',{skip},async t=>{
 const f=await fixture(t), pending=f.finish();await f.entered.promise;
 try{const next=await f.other.execute(f.registration('synthetic-new',C));assert.equal(next.relation.phase,'reserved');}
 finally{f.release.resolve();await pending;}
});
test('late completion refuses a concurrently uncertain original record and preserves its slot',{skip},async t=>{
 const f=await fixture(t),pending=f.finish();await f.entered.promise;let mutationSucceeded=false;
 try{await f.otherStore.transaction(state=>{const r=state.records[0];r.operations.send='unknown';r.relation.phase='submitted_unknown';r.relation.completion='unknown';state.slots.push({session_id:B.session_id,expected_launch_id:B.launch_id,stage:'send',state:'unknown',request:f.request});});mutationSucceeded=true;}
 finally{f.release.resolve();if(!mutationSucceeded)await pending;}
 await assert.rejects(pending,e=>e.code==='EXECUTION_UNCONFIRMED');const state=f.otherStore.snapshot();assert.equal(state.records[0].operations.send,'unknown');assert.equal(state.slots[0].state,'unknown');
});
test('late completion cannot overwrite a record changed by another metadata owner',{skip},async t=>{
 const f=await fixture(t),pending=f.finish();await f.entered.promise;let mutationSucceeded=false;
 try{await f.otherStore.transaction(state=>{state.records[0].stopping=true;});mutationSucceeded=true;}
 finally{f.release.resolve();if(!mutationSucceeded)await pending;}
 await assert.rejects(pending,e=>e.code==='EXECUTION_UNCONFIRMED');const record=f.otherStore.snapshot().records[0];assert.equal(record.stopping,true);assert.equal(record.relation.completion,'open');
});
test('unknown completion remains uncommitted and does not manufacture successful closure',{skip},async t=>{
 const f=await fixture(t);f.runtime.completion=async()=>({state:'unknown',fence:'unknown'});const before=f.store.snapshot();await assert.rejects(f.finish(),e=>e.code==='EXECUTION_UNCONFIRMED');assert.deepEqual(f.store.snapshot(),before);
});
test('a new pending parent return is rechecked before sealing the completed request',{skip},async t=>{
 const f=await fixture(t),pending=f.finish();await f.entered.promise;
 await f.otherStore.transaction(state=>state.parent_deliveries.push({delivery_id:'00000000-0000-4000-8000-000000000001',request:f.request,
  parent:{launch:C,boundary:null},child:point,endpoint_digest:'d'.repeat(64)}));
 f.release.resolve();const completed=await pending;assert.equal(completed.relation.completion,'completed');assert.equal(completed.relation.target_fence,'unknown');assert.equal(completed.relation.lifecycle,'tracking');
});
test('a concurrent change to the original target cannot receive stale completion evidence',{skip},async t=>{
 const f=await fixture(t),pending=f.finish();await f.entered.promise;
 await f.otherStore.transaction(state=>{state.records[0].relation.target={launch:B,boundary:{...point.boundary,event_cursor:2}};});f.release.resolve();
 await assert.rejects(pending,e=>e.code==='EXECUTION_CONFLICT');assert.equal(f.otherStore.snapshot().records[0].relation.completion,'open');
});
