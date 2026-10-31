import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {agentMetadataPath} from '../dist/agent-shared.js';
import {writeAgentResumeRecipe,readAgentResumeRecipe,agentResumeRecipeDigest,writeAgentLifecycle,readAgentLifecycle,cancelAgentStopping} from '../dist/agent-lifecycle.js';
const meta={aiterm_session:'lifecycle-fixture',launch_id:'a'.repeat(32),kind:'codex',vendor_session_id:'11111111-2222-4333-8444-555555555555'};
const recipe={schema:'aiterm.agent-resume.v1',launch_id:meta.launch_id,kind:'codex',vendor_session_id:'11111111-2222-4333-8444-555555555555',
 executable:process.execPath,cwd:process.env.HOME,configuration_root:process.env.CODEX_HOME,model:'fixture-model',reasoning_effort:'high',fast:false,environment:{PEERTABLE_ROOM:'artificial'}};
const file=suffix=>agentMetadataPath(meta.aiterm_session,meta.launch_id).replace(/\.agent\.json$/,suffix);
test('private resume recipes preserve only their matching launch and reject malformed state',()=>{
 assert.equal(readAgentResumeRecipe(meta),null);writeAgentResumeRecipe(meta,recipe);
 assert.deepEqual(readAgentResumeRecipe(meta),recipe);
 if(process.platform!=='win32')assert.equal(fs.statSync(file('.resume.json')).mode&0o777,0o600);
 assert.throws(()=>writeAgentResumeRecipe(meta,{...recipe,vendor_session_id:'session-title'}));
 assert.throws(()=>writeAgentResumeRecipe(meta,{...recipe,executable:'relative'}));
 fs.writeFileSync(file('.resume.json'),'{partial');assert.throws(()=>readAgentResumeRecipe(meta),/UNCONFIRMED/);
 writeAgentResumeRecipe(meta,recipe);
});
test('stopping can be cancelled; a committed hibernation cannot be cancelled accidentally',()=>{
 const state={schema:'aiterm.agent-lifecycle.v1',launch_id:meta.launch_id,state:'stopping',at:new Date().toISOString(),
  anchor:'anchor',native_id:'$10',pane:{pid:123,process_group_id:123,started_identity:'identity',argv_digest:'b'.repeat(64)},
  recipe_digest:agentResumeRecipeDigest(recipe)};
 writeAgentLifecycle(meta,state);assert.equal(readAgentLifecycle(meta).state,'stopping');
 assert.throws(()=>cancelAgentStopping(meta,'different'));cancelAgentStopping(meta,'anchor');assert.equal(readAgentLifecycle(meta),null);
 writeAgentLifecycle(meta,{...state,state:'hibernated'});assert.throws(()=>cancelAgentStopping(meta,'anchor'));
 assert.throws(()=>writeAgentLifecycle(meta,{...state,launch_id:'c'.repeat(32)}));
 assert.equal(readAgentLifecycle(meta).state,'hibernated');
});
