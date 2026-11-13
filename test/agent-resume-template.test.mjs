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

test('missing defaults cannot produce a resumable snapshot',()=>{
 for(const [index,effort,model] of [[1,null,'fixture-model'],[3,'high',null]]){
  const m={...meta,aiterm_session:'template-missing-'+index,model};
  captureAgentResumeTemplate(m,effort,[],process.env.CODEX_HOME,{});
  assert.equal(refreshAgentResumeRecipe(m),null);
 }
});

test('E8: secret-named env is kept by name only; an old recipe holding a value is rewritten without it',()=>{
 const m={...meta,aiterm_session:'template-secret',vendor_session_id:'11111111-2222-4333-8444-555555555555'};
 captureAgentResumeTemplate(m,'high',['OPENAI_API_KEY','AITERM_MCP_HEADER_0','PEERTABLE_ROOM'],process.env.CODEX_HOME,
  {OPENAI_API_KEY:'artificial-do-not-persist',AITERM_MCP_HEADER_0:'header-do-not-persist',PEERTABLE_ROOM:'room'});
 const recipe=refreshAgentResumeRecipe(m);
 assert.deepEqual(recipe.environment,{PEERTABLE_ROOM:'room'});
 assert.deepEqual(recipe.secret_environment,['AITERM_MCP_HEADER_0','OPENAI_API_KEY']);
 const file=agentMetadataPath(m.aiterm_session,m.launch_id).replace(/\.agent\.json$/,'.resume.json');
 assert.ok(!/do-not-persist/.test(fs.readFileSync(file,'utf8')));
 // 0.70.23-0.70.40: the Claude login value in a recipe without a template.
 const c={...m,aiterm_session:'template-old-login',kind:'claude'};
 const oldFile=agentMetadataPath(c.aiterm_session,c.launch_id).replace(/\.agent\.json$/,'.resume.json');
 fs.writeFileSync(oldFile,JSON.stringify({...recipe,secret_environment:undefined,kind:'claude',environment:{CLAUDE_CONFIG_DIR:null,CLAUDE_CODE_OAUTH_TOKEN:'old-login-do-not-keep'}}),{mode:0o600});
 const cleaned=refreshAgentResumeRecipe(c);
 assert.deepEqual(cleaned.environment,{CLAUDE_CONFIG_DIR:null});assert.deepEqual(cleaned.secret_environment,['CLAUDE_CODE_OAUTH_TOKEN']);
 assert.ok(!/do-not-keep/.test(fs.readFileSync(oldFile,'utf8')));
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
