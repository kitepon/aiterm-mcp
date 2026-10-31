import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFileSync,readFileSync,statSync} from 'node:fs';
import {agentMetadataPath} from '../dist/agent-shared.js';
import {initializeAgentActivity,recordAgentInput,recordAgentTurnEnd,readAgentActivity} from '../dist/agent-activity.js';

let serial=0;
const time=n=>new Date(Date.UTC(2026,9,31,0,n)).toISOString();
const launch=()=>({aiterm_session:'activity-'+ ++serial,launch_id:'a'.repeat(32),created_at:time(0)});
const done=(turn_id,at)=>({vendor:'codex',vendor_session_id:'thread',turn_id,operation_id:null,at});
const file=meta=>agentMetadataPath(meta.aiterm_session,meta.launch_id).replace(/\.agent\.json$/,'.activity.jsonl');

test('records creation, actual input and authoritative completion separately',()=>{
 const meta=launch();initializeAgentActivity(meta);
 assert.deepEqual(readAgentActivity(meta),{tracked:true,last_input_at:null,last_turn_end_at:null});
 recordAgentInput(meta,time(1));
 assert.equal(readAgentActivity(meta).last_input_at,time(1));assert.equal(readAgentActivity(meta).last_turn_end_at,null);
 recordAgentTurnEnd(meta,done('one',time(2)));
 assert.equal(readAgentActivity(meta).last_turn_end_at,time(2));
 recordAgentInput(meta,time(3));
 assert.deepEqual(readAgentActivity(meta),{tracked:true,last_input_at:time(3),last_turn_end_at:time(2)});
 if(process.platform!=='win32')assert.equal(statSync(file(meta)).mode&0o777,0o600);
});

test('repeated completion observations and older events cannot restart the idle clock',()=>{
 const meta=launch();initializeAgentActivity(meta);
 recordAgentTurnEnd(meta,done('one',time(2)));
 const bytes=statSync(file(meta)).size;
 recordAgentTurnEnd(meta,done('one',time(20)));
 assert.equal(statSync(file(meta)).size,bytes);
 recordAgentTurnEnd(meta,done('two',time(4)));
 recordAgentTurnEnd(meta,done('older',time(1)));
 assert.equal(readAgentActivity(meta).last_turn_end_at,time(4));
 // Concurrent observers can both append after a stale read; the first record for a turn wins.
 const last=readFileSync(file(meta),'utf8').trim().split('\n').map(JSON.parse).find(x=>x.kind==='turn_end');
 appendFileSync(file(meta),JSON.stringify({...last,at:time(40)})+'\n');
 assert.equal(readAgentActivity(meta).last_turn_end_at,time(4));
});

test('launch generation isolates clocks, and malformed or partial records stay unconfirmed',()=>{
 const meta=launch();assert.equal(readAgentActivity(meta).tracked,false);
 initializeAgentActivity(meta);recordAgentInput(meta,time(5));
 assert.deepEqual(readAgentActivity({...meta,launch_id:'b'.repeat(32)}),{tracked:false,last_input_at:null,last_turn_end_at:null});
 appendFileSync(file(meta),'{"kind":"turn_end"');
 assert.throws(()=>readAgentActivity(meta),/AGENT_ACTIVITY_UNCONFIRMED/);
 assert.throws(()=>recordAgentInput(launch(),'invalid'),/AGENT_ACTIVITY_UNCONFIRMED/);
 assert.throws(()=>recordAgentTurnEnd(launch(),done('bad',null)),/AGENT_ACTIVITY_UNCONFIRMED/);
});
