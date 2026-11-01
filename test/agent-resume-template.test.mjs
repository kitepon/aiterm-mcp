import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {agentMetadataPath} from '../dist/agent-shared.js';
import {captureAgentResumeTemplate,readAgentResumeTemplate,writeAgentResumeTemplate,refreshAgentResumeRecipe,finishAgentResumeConfiguration} from '../dist/agent-lifecycle.js';
const meta={aiterm_session:'template',launch_id:'a'.repeat(32),kind:'codex',vendor_session_id:null,model:'fixture-model',fast:false,
 agent_executable:process.execPath,cwd:process.env.HOME};

test('launch captures only requested non-secret environment and config paths; vendor binding completes the recipe',()=>{
 captureAgentResumeTemplate(meta,'high',['PEERTABLE_ROOM','NOT_SET'],process.env.CODEX_HOME,{PEERTABLE_ROOM:'room',UNREQUESTED:'not-saved'});
 const template=readAgentResumeTemplate(meta);assert.equal(template.state,'confirmed');
 assert.deepEqual(template.environment,{PEERTABLE_ROOM:'room',NOT_SET:null});
 assert.equal(template.configuration_root,process.env.CODEX_HOME);assert.equal(refreshAgentResumeRecipe(meta),null);
 const bound={...meta,vendor_session_id:'11111111-2222-4333-8444-555555555555'};
 const recipe=refreshAgentResumeRecipe(bound);assert.equal(recipe.vendor_session_id,bound.vendor_session_id);
 assert.equal(recipe.model,'fixture-model');assert.equal(recipe.reasoning_effort,'high');
 assert.deepEqual(recipe.environment,template.environment);
 assert.equal(refreshAgentResumeRecipe({...bound,model:'different'}),null);
 if(process.platform!=='win32')assert.equal(fs.statSync(agentMetadataPath(meta.aiterm_session,meta.launch_id).replace(/\.agent\.json$/,'.resume.json')).mode&0o077,0);
});

test('a partially applied configuration cannot revive an old recipe; effort-only success is retained',()=>{
 const m={...meta,vendor_session_id:'11111111-2222-4333-8444-555555555555'},before=readAgentResumeTemplate(m);
 writeAgentResumeTemplate(m,{...before,state:'unconfirmed'});assert.equal(refreshAgentResumeRecipe(m),null);
 finishAgentResumeConfiguration(m,before,null,'xhigh');assert.equal(refreshAgentResumeRecipe(m).reasoning_effort,'xhigh');
 const current=readAgentResumeTemplate(m);
 finishAgentResumeConfiguration({...m,model:'new'},current,'new',null);
 assert.equal(refreshAgentResumeRecipe({...m,model:'new'}),null,'a model switch without confirmed effort remains unknown');
 finishAgentResumeConfiguration({...m,model:'new'},readAgentResumeTemplate(m),'new','high');
 assert.equal(refreshAgentResumeRecipe({...m,model:'new',fast:true}).fast,true);
});

test('missing defaults and explicitly requested credentials cannot produce a resumable snapshot',()=>{
 for(const [index,effort,names,model] of [[1,null,[],'fixture-model'],[2,'high',['OPENAI_API_KEY'],'fixture-model'],[3,'high',[],null]]){
  const m={...meta,aiterm_session:'template-missing-'+index,model};
  captureAgentResumeTemplate(m,effort,names,process.env.CODEX_HOME,{OPENAI_API_KEY:'artificial-do-not-persist'});
  assert.equal(refreshAgentResumeRecipe(m),null);
  if(names.length)assert.equal(readAgentResumeTemplate(m),null);
 }
});

test('Claude resume preserves an unset config selector separately from its resolved directory',()=>{
 const m={...meta,aiterm_session:'claude-config-selector',kind:'claude',vendor_session_id:'11111111-2222-4333-8444-555555555555'};
 for(const selector of [null,'relative-config',process.env.CLAUDE_CONFIG_DIR]){
  const env=selector===null?{}:{CLAUDE_CONFIG_DIR:selector};
  captureAgentResumeTemplate(m,'high',[],process.env.CLAUDE_CONFIG_DIR,env);
  const template=readAgentResumeTemplate(m);
  assert.deepEqual(template.environment,{CLAUDE_CONFIG_DIR:selector});
  assert.equal(refreshAgentResumeRecipe(m).environment.CLAUDE_CONFIG_DIR,selector);
 }
 const before=readAgentResumeTemplate(m);
 writeAgentResumeTemplate(m,{...before,environment:{}});
 assert.equal(refreshAgentResumeRecipe(m),null,'a missing selector cannot be inferred from the resolved path');
});
