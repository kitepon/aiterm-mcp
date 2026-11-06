import './seat-env.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {agentsDir, agentMetadataPath} from '../dist/agent-shared.js';

test('resume-only normal launch never falls through to fresh creation after a target is missing or invalid', async()=>{
  const client=new Client({name:'resume-only-contract',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/index.js')],env:{...process.env},stderr:'pipe'});
  const name='resume_only_missing';
  const directory=agentsDir();
  fs.mkdirSync(directory,{recursive:true});
  const stale=agentMetadataPath(name,'a'.repeat(32));
  try {
    await client.connect(transport);
    const tools=await client.listTools();
    assert.equal(tools.tools.find(x=>x.name==='agent_launch').inputSchema.properties.require_existing_resume.type,'boolean');
    // A previously retained path vanishes between a caller's selection and actual launch.
    fs.writeFileSync(stale,'{"historical":"reference"}');fs.unlinkSync(stale);
    for(const harness of ['claude-code','codex-cli','grok-cli','cursor-cli','antigravity-cli']){
      const result=await client.callTool({name:'agent_launch',arguments:{harness,session_name:name,require_existing_resume:true}});
      assert.equal(result.isError,true);
      assert.deepEqual(result._meta?.['aiterm/resume_unavailable'],{schema:'aiterm.agent-resume-unavailable.v1',code:'AGENT_RESUME_UNAVAILABLE',session_id:name,outcome:'unavailable',effect:'not_started',input:'not_sent'});
      assert.equal(fs.readdirSync(directory).some(x=>x.endsWith('.agent.json')||x.endsWith('.active-launch.json')),false);
    }
    const remote=await client.callTool({name:'agent_launch',arguments:{harness:'codex-cli',session_name:name,require_existing_resume:true,remote:{host:'must-not-connect.invalid'}}});
    assert.equal(remote._meta?.['aiterm/resume_unavailable']?.effect,'not_started');
    fs.writeFileSync(stale,'{invalid');
    const invalid=await client.callTool({name:'agent_launch',arguments:{harness:'codex-cli',session_name:name,require_existing_resume:true}});
    assert.equal(invalid._meta?.['aiterm/resume_unavailable']?.schema,'aiterm.agent-resume-unavailable.v1');
    assert.equal(fs.readFileSync(stale,'utf8'),'{invalid');
    fs.unlinkSync(stale);
    const withBody=await client.callTool({name:'agent_launch',arguments:{harness:'codex-cli',session_name:name,require_existing_resume:true,prompt:'MUST NOT SEND'}});
    assert.equal(withBody.isError,true);
    assert.equal(fs.readdirSync(directory).some(x=>x.endsWith('.agent.json')||x.endsWith('.active-launch.json')),false);
  } finally {await client.close();fs.rmSync(stale,{force:true});}
});
