import './seat-env.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'centi-auth-generation-'));
Object.assign(process.env,{HOME:root,TMPDIR:root,XDG_RUNTIME_DIR:root});
const {agentsDir}=await import('../dist/agent-shared.js');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
test('replacement during official status readback keeps the original response unknown',{skip:process.platform==='win32'||spawnSync('tmux',['-V']).status!==0},async()=>{
 const bin=path.join(root,'claude'),count=path.join(root,'count'),marker=path.join(root,'status-start');
 fs.writeFileSync(bin,`#!/bin/bash
if [ "$1" = auth ] && [ "$2" = status ]; then
 printf x > ${quote(marker)}
 sleep 0.8
 printf '{"loggedIn":false}\\n'
 exit 1
fi
stty -echo
printf 'Paste code here if prompted >\\n'
IFS= read -r reply
printf x >> ${quote(count)}
exit 0
`,{mode:0o755});
 const client=new Client({name:'centi-private-auth',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/index.js')],env:{...process.env,CLAUDE_BIN:bin},stderr:'pipe'});
 let session;
 try{
  await client.connect(transport);
  const start=await client.callTool({name:'agent_auth',arguments:{harness:'claude-code',action:'start',cwd:root,relogin:true}});
  assert.ok(!start.isError,JSON.stringify(start));const current=start.structuredContent;session=current.session_id;
  const pending=client.callTool({name:'agent_auth',arguments:{harness:'claude-code',action:'respond',session_id:session,expected_binding:current.auth_ui.binding,expected_prompt_digest:current.auth_ui.prompt_digest,response:{kind:'authorization_code',value:'SYNTHETIC_GENERATION_CODE'}}});
  for(let i=0;i<200&&!fs.existsSync(marker);i++)await new Promise(r=>setTimeout(r,10));
  assert.ok(fs.existsSync(marker),'official status readback is in flight');
  const file=path.join(agentsDir(),`${session}.auth.json`),meta=JSON.parse(fs.readFileSync(file,'utf8'));
  meta.launch_id='fedcba9876543210fedcba9876543210';fs.writeFileSync(file,JSON.stringify(meta));
  const result=await pending;
  assert.equal(fs.readFileSync(count,'utf8'),'x');
  console.log(JSON.stringify({replacedDuringStatus:true,nativeInputs:1,actual:result.structuredContent,isError:result.isError??false}));
  assert.equal(result.isError,true,'generation change during readback must not be accepted');
  assert.equal(result.structuredContent.code,'AGENT_AUTH_RESPONSE_UNKNOWN');
 }finally{
  if(session)await client.callTool({name:'pty_close',arguments:{session_id:session}});
  await client.close();fs.rmSync(root,{recursive:true,force:true});
 }
});
