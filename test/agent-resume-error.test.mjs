import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createCodexAgentMetadata} from '../dist/harnesses/codex.js';
import {ensureStateRoot} from '../dist/agent-shared.js';
import {readAgentResumeAttempt,writeAgentResumeAttempt,writeAgentLifecycle} from '../dist/agent-lifecycle.js';
import {SOCK} from '../dist/tmux-runtime.js';

test('MCP exposes a typed unsent resume refusal without retrying the native launch',async()=>{
 ensureStateRoot();
 const meta=createCodexAgentMetadata('resume_error_contract',process.env.HOME,'none',{},undefined,
  {agentRole:'subagent',parentSessionId:'test-parent',delegationDepth:1,lineage:'test-parent>codex:resume_error_contract',delegationAllowed:true});
 const attempt={schema:'aiterm.agent-resume-attempt.v1',launch_id:meta.launch_id,next_launch_id:'f'.repeat(32),
  state:'failed',at:new Date().toISOString(),recipe_digest:'a'.repeat(64)};
 writeAgentResumeAttempt(meta,attempt);
 writeAgentLifecycle(meta,{schema:'aiterm.agent-lifecycle.v1',launch_id:meta.launch_id,state:'hibernated',socket:SOCK,
  at:attempt.at,anchor:attempt.at,native_id:'$1',recipe_digest:attempt.recipe_digest,
  pane:{pid:1,process_group_id:null,started_identity:'fixture-only',argv_digest:'b'.repeat(64)}});
 const client=new Client({name:'resume-error-contract',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/index.js')],env:{...process.env},stderr:'pipe'});
 try{
  await client.connect(transport);
  await client.listTools(); // validators on, as BellTeam's shared client had (production 2026-11-13)
  const result=await client.callTool({name:'pty_send',arguments:{session_id:meta.aiterm_session,text:'MUST_NOT_SEND',require_agent:true}});
  assert.equal(result.isError,true);
  assert.equal(result.structuredContent,undefined,'outside pty_send outputSchema: a validating client would turn it into -32602');
  assert.equal(result._meta['aiterm/error_code'].code,'AGENT_RESUME_UNCONFIRMED');
  assert.deepEqual(result._meta['aiterm/resume_error'],{schema:'aiterm.agent-resume-error.v1',code:'AGENT_RESUME_UNCONFIRMED',
   session_id:meta.aiterm_session,launch_id:meta.launch_id,input:'not_sent',recovery:'inspect_session'});
  assert.match(result.content[0].text,/AGENT_RESUME_UNCONFIRMED/);
  assert.ok(!JSON.stringify(result).includes('MUST_NOT_SEND'));
  assert.deepEqual(readAgentResumeAttempt(meta),attempt);
 }finally{await client.close();}
});
