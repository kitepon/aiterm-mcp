import './seat-env.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('ordinary MCP preserves Claude authentication preflight reasons without creating a session', {skip:process.platform==='win32'}, async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auth-launch-reason-'));
  try {
    for(const [label,stdout,exit,delay,code] of [
      ['not authenticated','{"loggedIn":false,"fixtureSecret":"DO_NOT_FORWARD_AUTH_STATUS"}',1,0,'CLAUDE_AUTH_NOT_AUTHENTICATED'],
      ['malformed','DO_NOT_FORWARD_AUTH_STATUS',0,0,'CLAUDE_AUTH_STATUS_UNCONFIRMED'],
      ['failed exit','{"loggedIn":true}',1,0,'CLAUDE_AUTH_STATUS_UNCONFIRMED'],
      ['timeout','',0,6000,'CLAUDE_AUTH_STATUS_TIMEOUT'],
    ]) await t.test(label,async()=>{
      const bin=path.join(dir,'claude');
      fs.writeFileSync(bin,`#!${process.execPath}\nif(process.argv.slice(2).join(' ')==='auth status --json'){setTimeout(()=>{process.stdout.write(${JSON.stringify(stdout)});process.exit(${exit});},${delay});}else{process.stderr.write('UNEXPECTED_HARNESS_LAUNCH');process.exit(99);}\n`,{mode:0o755});
      const client=new Client({name:'auth-preflight-regression',version:'1'});
      const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/index.js')],env:{...process.env,CLAUDE_BIN:bin},stderr:'pipe'});
      let stderr='';transport.stderr.on('data',x=>stderr+=x);
      try {
        await client.connect(transport);
        const before=await client.callTool({name:'pty_list',arguments:{}});
        const tool=label==='failed exit'?'claude_agent':'agent_launch';
        const result=await client.callTool({name:tool,arguments:{...(tool==='agent_launch'?{harness:'claude-code'}:{}),session_name:'auth_rejected',cwd:dir}});
        assert.equal(result.isError,true);
        assert.deepEqual(result.structuredContent,{
          schema:'aiterm.agent-launch-error.v1',harness:'claude-code',code,
          phase:'authentication_preflight',effect:'not_issued',session_created:false,
          message:result.content[0].text.replace(/^aiterm: /u,''),
        });
        assert.match(result.content[0].text,/sessionは作成していません/u);
        assert.ok(!JSON.stringify(result).includes('DO_NOT_FORWARD_AUTH_STATUS'));
        assert.ok(!stderr.includes('UNEXPECTED_HARNESS_LAUNCH'));
        const after=await client.callTool({name:'pty_list',arguments:{}});
        assert.deepEqual(after.structuredContent.sessions,before.structuredContent.sessions);
        assert.equal(after.structuredContent.sessions.length,0);
      } finally {await client.close();}
    });
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
