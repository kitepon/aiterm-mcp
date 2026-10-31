import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {agentMetadataPath,writeAgentMetadata,publishAgentGeneration,readAgentGeneration,selectAgentMetadataFile,agentsDir} from '../dist/agent-shared.js';
const meta={aiterm_session:'generation-fixture',kind:'codex',launch_id:'a'.repeat(32),vendor_session_id:'11111111-2222-4333-8444-555555555555',
 parent_session_id:'parent',delegation_depth:2,lineage:'host-root>codex:parent>codex:generation-fixture'};
const files=()=>fs.readdirSync(agentsDir()).filter(file=>file.startsWith(meta.aiterm_session+'.')&&file.endsWith('.agent.json'));
const selected=()=>JSON.parse(fs.readFileSync(path.join(agentsDir(),selectAgentMetadataFile(meta.aiterm_session,files())),'utf8'));

test('staging and publication preserve registration and old records without allowing stale writeback to win',()=>{
 writeAgentMetadata(meta);publishAgentGeneration(meta);assert.equal(selected().launch_id,meta.launch_id);
 const next={...meta,launch_id:'b'.repeat(32),resumed_from:meta.launch_id};writeAgentMetadata(next);
 assert.equal(files().length,2);assert.equal(selected().launch_id,meta.launch_id,'staged metadata does not replace the current generation');
 publishAgentGeneration(meta,next);assert.equal(selected().launch_id,next.launch_id);
 assert.equal(readAgentGeneration(meta.aiterm_session).previous_launch_id,meta.launch_id);
 writeAgentMetadata({...meta,model:'stale-write'});assert.equal(selected().launch_id,next.launch_id);
 assert.equal(fs.existsSync(agentMetadataPath(meta.aiterm_session,meta.launch_id)),true,'old hook/waiter readers retain their own record');
 assert.throws(()=>publishAgentGeneration(meta,next),/AGENT_RESUME_UNCONFIRMED/);
 for(const change of [{vendor_session_id:'other'},{kind:'claude'},{resumed_from:'c'.repeat(32)},{delegation_depth:3},{lineage:'new-child'}]){
  const bad={...next,...change,launch_id:'c'.repeat(32),resumed_from:next.launch_id,...change};writeAgentMetadata(bad);
  assert.throws(()=>publishAgentGeneration(next,bad),/AGENT_RESUME_UNCONFIRMED/);
  assert.equal(selected().launch_id,next.launch_id);
 }
 fs.unlinkSync(agentMetadataPath(meta.aiterm_session,next.launch_id));
 assert.throws(()=>selected(),/AGENT_RESUME_UNCONFIRMED/,'a missing current generation never falls back to an old launch');
});
