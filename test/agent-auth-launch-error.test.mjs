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
        // Not logged in (and only that) is also AGENT_AUTH_REQUIRED for the caller (0.70.9); an unreadable status is not.
        assert.deepEqual(result._meta?.['aiterm/launch_error']?.code,code==='CLAUDE_AUTH_NOT_AUTHENTICATED'?'AGENT_AUTH_REQUIRED':undefined);
        if(code==='CLAUDE_AUTH_NOT_AUTHENTICATED') assert.deepEqual({...result._meta['aiterm/launch_error'],action:typeof result._meta['aiterm/launch_error'].action},
          {schema:'aiterm.agent-launch-error.v1',harness:'claude-code',code:'AGENT_AUTH_REQUIRED',phase:'input',effect:'not_started',session_created:false,action:'string'});
        assert.ok(!JSON.stringify(result).includes('DO_NOT_FORWARD_AUTH_STATUS'));
        assert.ok(!stderr.includes('UNEXPECTED_HARNESS_LAUNCH'));
        const after=await client.callTool({name:'pty_list',arguments:{}});
        assert.deepEqual(after.structuredContent.sessions,before.structuredContent.sessions);
        assert.equal(after.structuredContent.sessions.length,0);
      } finally {await client.close();}
    });
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('a Claude auth status that only runs past 5 seconds does not refuse the launch', {skip:process.platform==='win32'}, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auth-launch-slow-'));
  const started=path.join(dir,'harness-started');
  const bin=path.join(dir,'claude');
  fs.writeFileSync(bin,`#!${process.execPath}\nconst fs=require('node:fs');if(process.argv.slice(2).join(' ')==='auth status --json'){setTimeout(()=>{process.stdout.write('{"loggedIn":true}');process.exit(0);},6000);}else{fs.writeFileSync(${JSON.stringify(started)},'');process.exit(99);}\n`,{mode:0o755});
  const client=new Client({name:'auth-preflight-slow',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/index.js')],env:{...process.env,CLAUDE_BIN:bin},stderr:'pipe'});
  try {
    await client.connect(transport);
    const result=await client.callTool({name:'agent_launch',arguments:{harness:'claude-code',session_name:'auth_slow',cwd:dir}},undefined,{timeout:120_000});
    assert.equal(result.structuredContent?.schema,'aiterm.agent-launch-result.v1',JSON.stringify(result));
    assert.equal(result.structuredContent.session_id,'auth_slow');
    for(let i=0;i<100&&!fs.existsSync(started);i++) await new Promise(r=>setTimeout(r,100));
    assert.ok(fs.existsSync(started),'the harness itself is started after the slow status check');
  } finally {
    await client.callTool({name:'pty_close',arguments:{session_id:'auth_slow'}}).catch(()=>{});
    await client.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('Cursor and Antigravity that are not logged in refuse the launch as AGENT_AUTH_REQUIRED', {skip:process.platform==='win32'}, async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auth-required-'));
  try {
    for(const [harness,envVar,script] of [
      ['cursor-cli','CURSOR_AGENT_BIN','if(process.argv[2]==="status"){process.stdout.write("Not logged in");process.exit(1);}'],
      ['antigravity-cli','ANTIGRAVITY_BIN','if(process.argv[2]==="models"){process.stderr.write("Please sign in to view available models");process.exit(1);}'],
    ]) await t.test(harness,async()=>{
      const bin=path.join(dir,harness);
      fs.writeFileSync(bin,`#!${process.execPath}\n${script}process.stderr.write('UNEXPECTED_HARNESS_LAUNCH');process.exit(99);\n`,{mode:0o755});
      const client=new Client({name:'auth-required',version:'1'});
      const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/index.js')],env:{...process.env,[envVar]:bin},stderr:'pipe'});
      try {
        await client.connect(transport);
        const result=await client.callTool({name:'agent_launch',arguments:{harness,session_name:'auth_required',cwd:dir}});
        assert.equal(result.isError,true);
        assert.match(result.content[0].text,/^aiterm: AGENT_LAUNCH_NOT_STARTED: AGENT_AUTH_REQUIRED: /u);
        const meta=result._meta['aiterm/launch_error'];
        assert.deepEqual({...meta,action:typeof meta.action},{schema:'aiterm.agent-launch-error.v1',harness,code:'AGENT_AUTH_REQUIRED',phase:'input',effect:'not_started',session_created:false,action:'string'});
        assert.equal((await client.callTool({name:'pty_list',arguments:{}})).structuredContent.sessions.length,0);
      } finally {await client.close();}
    });
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
