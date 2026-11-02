import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {recordSchema,readRecord,answerMessage} from '../dist/parent-delivery-record.js';

const id='00000000-0000-4000-8000-000000000001';
const base={schema:'aiterm.parent-delivery.v1',delivery_id:id,created_at:'created',updated_at:'updated',
  parent:{thread_id:id,codex_home:process.env.HOME},
  boundary:{session_id:'child',launch_id:'a'.repeat(32),vendor:'codex',harness:'codex-cli',event_cursor:0,operation_id:null},
  state:'ready',text:'saved answer',child_outcome:'done',child_turn_id:null,error:null,queued_submission_id:null};
test('record read preserves legacy shape and exact answer framing; malformed and missing files remain distinct',()=>{
  const file=path.join(process.env.HOME,id+'.json');fs.writeFileSync(file,JSON.stringify(base));
  assert.deepEqual(readRecord(file),base);assert.equal('execution' in readRecord(file),false);
  assert.equal(answerMessage(base),'Aitermの子エージェントからの実行結果です。子の回答として扱ってください。\n'+
    'delivery_id='+id+'\nsession=child\nharness=codex-cli\nlaunch_id='+'a'.repeat(32)+'\nturn_id=unknown\noutcome=done\n\nsaved answer');
  const wrong=path.join(process.env.HOME,'wrong.json');fs.writeFileSync(wrong,JSON.stringify(base));
  const invalid=e=>e.code===2&&e.message==='PARENT_DELIVERY_STATE_INVALID: 配送記録を読めません';
  assert.throws(()=>readRecord(wrong),invalid);
  for(const raw of ['{','null',JSON.stringify({...base,unexpected:true})]) {
    fs.writeFileSync(file,raw);assert.throws(()=>readRecord(file),invalid);
  }
  fs.unlinkSync(file);assert.throws(()=>readRecord(file),e=>e.code==='ENOENT');
});
test('private source and origin owner must match the original request; no private fields are inferred',()=>{
  const actor={pid:22,started_identity:'2026-10-21T07:00:02Z'};
  const request={kind:'mcp',process_pid:22,process_started_identity:actor.started_identity,
    request_id:41,tool:'pty_send',target_session_id:'child'};
  const source={schema:'aiterm.parent-source.v1',request,
    source:{launch:{session_id:'parent',launch_id:'b'.repeat(32)},boundary:null},client_name:'fixture',
    mcp_process:actor,harness_process:{pid:20,started_identity:'2026-10-21T07:00:00Z'},endpoint:{vendor:'codex',thread_id:id}};
  const execution={request,source_evidence:source,origin_owner:actor};
  assert.deepEqual(recordSchema.parse({...base,execution}).execution,execution);
  for(const changed of [
    {...execution,request:{...request,request_id:42}},
    {...execution,origin_owner:{...actor,pid:23}},
    {request,origin_owner:actor},
    {...execution,source_evidence:{...source,mcp_process:{...actor,pid:23}}},
  ]) assert.equal(recordSchema.safeParse({...base,execution:changed}).success,false);
});
