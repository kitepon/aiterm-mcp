import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {agentMetadataPath} from '../dist/agent-shared.js';
import {writeAgentResumeResolution,readAgentResumeResolution,writeAgentResumeAttempt,readAgentResumeAttempt} from '../dist/agent-lifecycle.js';
const meta={aiterm_session:'resolution',launch_id:'b'.repeat(32)};
const previous={...meta,launch_id:'a'.repeat(32)};
const value={schema:'aiterm.agent-resume-resolution.v1',launch_id:meta.launch_id,previous_launch_id:previous.launch_id,
 vendor_session_id:'11111111-2222-4333-8444-555555555555',attempt_digest:'1'.repeat(64),recipe_digest:'2'.repeat(64),
 resume_proof_digest:'3'.repeat(64),native_digest:'4'.repeat(64),at:'2026-11-02T14:30:00.000Z'};
test('completion persists separately and never rewrites a failed attempt',()=>{
 const attempt={schema:'aiterm.agent-resume-attempt.v1',launch_id:previous.launch_id,next_launch_id:meta.launch_id,state:'failed',recipe_digest:value.recipe_digest,at:value.at};
 writeAgentResumeAttempt(previous,attempt);writeAgentResumeResolution(meta,value);
 assert.deepEqual(readAgentResumeResolution(meta),value);assert.deepEqual(readAgentResumeAttempt(previous),attempt);
});
test('strict completion schema rejects extra values, swapped identities and malformed evidence',()=>{
 for(const patch of [{extra:'SECRET'},{launch_id:previous.launch_id},{previous_launch_id:meta.launch_id},{attempt_digest:'bad'},{at:'later'},{vendor_session_id:'not-uuid'}]){
  assert.throws(()=>writeAgentResumeResolution(meta,{...value,...patch}));
 }
 assert.deepEqual(readAgentResumeResolution(meta),value);
});
test('missing completion remains missing and malformed storage never becomes success',()=>{
 assert.equal(readAgentResumeResolution({...meta,launch_id:'c'.repeat(32)}),null);
 const file=agentMetadataPath(meta.aiterm_session,meta.launch_id).replace(/\.agent\.json$/,'.resume-resolution.json');
 fs.writeFileSync(file,JSON.stringify({...value,launch_id:previous.launch_id}));assert.throws(()=>readAgentResumeResolution(meta));
});
