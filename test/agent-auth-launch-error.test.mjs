import './seat-env.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

// No Claude pre-check (ADR 0020, 2026-11-11): `auth status` read this computer's login, not the seat's private-env credential.
test('a Claude launch runs no auth status pre-check: a logged-out status does not refuse it', {skip:process.platform==='win32'}, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auth-launch-none-'));
  const started=path.join(dir,'harness-started');
  const asked=path.join(dir,'auth-status-asked');
  const bin=path.join(dir,'claude');
  fs.writeFileSync(bin,`#!${process.execPath}\nconst fs=require('node:fs');if(process.argv.slice(2).join(' ')==='auth status --json'){fs.writeFileSync(${JSON.stringify(asked)},'');process.stdout.write('{"loggedIn":false}');process.exit(1);}else{fs.writeFileSync(${JSON.stringify(started)},'');process.exit(99);}\n`,{mode:0o755});
  const client=new Client({name:'auth-launch-none',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/index.js')],env:{...process.env,CLAUDE_BIN:bin},stderr:'pipe'});
  try {
    await client.connect(transport);
    const result=await client.callTool({name:'agent_launch',arguments:{harness:'claude-code',session_name:'auth_none',cwd:dir}},undefined,{timeout:120_000});
    assert.equal(result.structuredContent?.schema,'aiterm.agent-launch-result.v1',JSON.stringify(result));
    for(let i=0;i<100&&!fs.existsSync(started);i++) await new Promise(r=>setTimeout(r,100));
    assert.ok(fs.existsSync(started),'the harness itself is started');
    assert.ok(!fs.existsSync(asked),'the launch never asks auth status');
  } finally {
    await client.callTool({name:'pty_close',arguments:{session_id:'auth_none'}}).catch(()=>{});
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

// Centi 2026-11-12 (0.70.33 lab): a first Claude seat sat on Security notes while agent_launch said ready.
test('a launch stopped on a first-run screen closes its seat and refuses as AGENT_STARTUP_BLOCKED, never ready', {skip:process.platform==='win32'}, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'startup-blocked-'));
  const bin=path.join(dir,'claude');
  fs.writeFileSync(bin,`#!/bin/sh\nprintf '%s\\n' 'Claude Code v2.1.322' '' ' Security notes:' '' ' 1. Claude can make mistakes' '' ' Press Enter to continue…'\nexec sleep 600\n`,{mode:0o755});
  const client=new Client({name:'startup-blocked',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/index.js')],env:{...process.env,CLAUDE_BIN:bin},stderr:'pipe'});
  try {
    await client.connect(transport);
    const result=await client.callTool({name:'agent_launch',arguments:{harness:'claude-code',session_name:'startup_blocked',cwd:dir,trust_project:true}},undefined,{timeout:120_000});
    assert.equal(result.isError,true,JSON.stringify(result));
    assert.match(result.content[0].text,/^aiterm: AGENT_STARTUP_BLOCKED: .*reason=vendor_onboarding_required/u);
    const meta=result._meta['aiterm/launch_error'];
    assert.deepEqual({...meta,action:typeof meta.action},{schema:'aiterm.agent-launch-error.v1',harness:'claude-code',code:'AGENT_STARTUP_BLOCKED',phase:'input',effect:'not_started',session_created:false,action:'string'});
    assert.match(meta.action,/初回案内/u);
    assert.ok(!(await client.callTool({name:'pty_list',arguments:{}})).structuredContent.sessions.some(row=>row.session_id==='startup_blocked'));
  } finally {
    await client.callTool({name:'pty_close',arguments:{session_id:'startup_blocked'}}).catch(()=>{});
    await client.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
