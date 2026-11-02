import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadAgentMetadata,tryLoadAgentMetadata} from '../dist/agent-metadata-reader.js';
import {agentMetadataPath,agentEventPath,writeAgentMetadata,publishAgentGeneration} from '../dist/agent-shared.js';
import {agentManagedClaudeSettingsPath,agentClaudeResultPath} from '../dist/harnesses/claude.js';

// seat-env owns and removes every file; these fixtures never create a terminal or invoke a vendor.
const id='a'.repeat(32), uuid='11111111-2222-4333-8444-555555555555';
function fixture(kind,name=kind) {
  const home=path.join(process.env.HOME,kind);
  const common={kind,aiterm_session:name,launch_id:id,event_file:agentEventPath(name,id),
    agent_role:'subagent',parent_session_id:'parent',delegation_depth:1,
    lineage:'host-root>codex:'+name,delegation_allowed:true,initial_prompt:true,node_platform:'legacy'};
  if(kind==='claude') return {...common,hook_route:'shared_claude_settings',vendor_session_id:uuid,
    claude_settings:agentManagedClaudeSettingsPath(name,id),result_file:agentClaudeResultPath(name,id)};
  if(kind==='grok') {fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(home,'auth.json'),'{}');}
  return {...common,hook_route:'shared_'+kind+'_home',[kind+'_home']:home,
    ...(kind==='antigravity'?{}:{completion_route:kind+'_transcript'}),
    ...(kind==='grok'?{vendor_session_id:uuid,grok_auth_path:path.join(home,'auth.json')}:{})};
}
for(const kind of ['claude','codex','grok','cursor','antigravity']) {
  test(kind+': legacy defaults, projection and optional fields survive the reader boundary',()=>{
    const m=fixture(kind);writeAgentMetadata(m);
    const out=loadAgentMetadata(kind);
    assert.equal(out.kind,kind);assert.equal(out.initial_prompt,'pending');
    assert.equal(out.created_at,'');assert.equal(out.cwd,null);assert.equal(out.node_platform,process.platform);
    assert.equal(out.vendor_session_id,m.vendor_session_id??null);
    assert.equal(out.lineage,m.lineage);assert.equal('fast' in out,false);
    writeAgentMetadata({...m,initial_prompt:false,fast:false,model:null,write_scope:'project',
      initial_prompt_delivery:{status:'not_sent',reason:'fixture',turn_started:false},initial_prompt_cursor:0});
    const enriched=loadAgentMetadata(kind);
    assert.equal(enriched.initial_prompt,'none');assert.equal(enriched.fast,false);assert.equal(enriched.model,null);
    assert.equal(enriched.write_scope,'project');assert.deepEqual(enriched.initial_prompt_delivery,
      {status:'not_sent',reason:'fixture',turn_started:false});assert.equal(enriched.initial_prompt_cursor,0);
    for(const [change,message] of [
      [{event_file:'/wrong'},/secure state root/],
      [{lineage:'bad lineage'},/lineage/],
      [{delegation_allowed:false},/lineage/],
      [{initial_prompt_delivery:{status:'invalid'}},/初手delivery/],
      [{execution_native:{}},/native binding/],
      [{windows_launch_exit_tracked:false},/Windows launch exit/],
      [{hook_route:'invalid'},/metadata/],
    ]) {
      writeAgentMetadata({...m,...change});
      assert.throws(()=>loadAgentMetadata(kind),e=>e.code===2&&message.test(e.message));
      assert.equal(tryLoadAgentMetadata(kind),null);
    }
    fs.writeFileSync(agentMetadataPath(kind,id),'{');assert.throws(()=>loadAgentMetadata(kind),/読めません/);
    fs.writeFileSync(agentMetadataPath(kind,id),'null');assert.equal(tryLoadAgentMetadata(kind),null);
  });
}
test('generation selection, absent records and invalid names preserve rejection and null boundaries',()=>{
  assert.throws(()=>loadAgentMetadata('../invalid'),/session 名/);
  assert.equal(tryLoadAgentMetadata('../invalid'),null);
  assert.throws(()=>loadAgentMetadata('absent'),/管理セッションではありません/);
  const old=fixture('codex','resumed');writeAgentMetadata(old);publishAgentGeneration(old);
  const next={...old,launch_id:'b'.repeat(32),resumed_from:id,event_file:agentEventPath('resumed','b'.repeat(32))};
  writeAgentMetadata(next);assert.equal(loadAgentMetadata('resumed').launch_id,id);
  publishAgentGeneration(old,next);assert.equal(loadAgentMetadata('resumed').resumed_from,id);
  fs.unlinkSync(agentMetadataPath('resumed',next.launch_id));
  assert.throws(()=>loadAgentMetadata('resumed'),/AGENT_RESUME_UNCONFIRMED/);
  fs.unlinkSync(agentMetadataPath('resumed',id));
  assert.throws(()=>loadAgentMetadata('resumed'),/現在の起動記録がありません/);
});
