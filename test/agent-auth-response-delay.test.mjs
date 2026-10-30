import './seat-env.mjs';
import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'auth-delay-'));
Object.assign(process.env,{HOME:root,TMPDIR:root,XDG_RUNTIME_DIR:root});
const {agentsDir}=await import('../dist/agent-shared.js');
const native={skip:process.platform==='win32'||spawnSync('tmux',['-V']).status!==0};
after(()=>fs.rmSync(root,{recursive:true,force:true}));
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
async function scenario(transition,replace=false){
 const dir=fs.mkdtempSync(path.join(root,'cli-')),bin=path.join(dir,'claude');
 fs.writeFileSync(bin,`#!/bin/bash
if [ "$1" = auth ] && [ "$2" = status ]; then printf '{"loggedIn":false}\\n'; exit 1; fi
stty -echo
printf '\\nPaste code here if prompted >\\n'
IFS= read -r reply
printf x >> ${quote(path.join(dir,'count'))}
${transition?"sleep 0.8\nprintf '\\033[2J\\033[HWaiting for official response\\n'":""}
sleep 30
`,{mode:0o755});
 const client=new Client({name:'auth-delay-test',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/index.js')],env:{...process.env,CLAUDE_BIN:bin},stderr:'pipe'});
 let session,stderr='';transport.stderr?.on('data',v=>stderr+=v);
 const code='ARTIFICIAL_DELAY_ONLY_CODE';
 try{
  await client.connect(transport);
  const start=await client.callTool({name:'agent_auth',arguments:{harness:'claude-code',action:'start',cwd:dir,relogin:true}});
  assert.ok(!start.isError,JSON.stringify(start));const current=start.structuredContent;session=current.session_id;
  assert.equal(current.auth_ui.input,'authorization_code');
  const pending=client.callTool({name:'agent_auth',arguments:{harness:'claude-code',action:'respond',session_id:session,expected_binding:current.auth_ui.binding,expected_prompt_digest:current.auth_ui.prompt_digest,response:{kind:'authorization_code',value:code}}});
  if(replace){
   let settled=false;pending.then(()=>{settled=true},()=>{settled=true});
   const received=()=>{try{return fs.readFileSync(path.join(dir,'count'),'utf8')==='x'}catch{return false}};
   // Synchronize on the native submission, including MCP dispatch under full-suite load.
   for(const deadline=performance.now()+5000;!received()&&!settled&&performance.now()<deadline;)await new Promise(r=>setTimeout(r,10));
   assert.ok(received(),'native code submission must precede generation replacement');
   assert.equal(settled,false,'replacement must happen before the original response completes');
   const file=path.join(agentsDir(),`${session}.auth.json`),meta=JSON.parse(fs.readFileSync(file,'utf8'));
   meta.launch_id='0123456789abcdef0123456789abcdef';fs.writeFileSync(file,JSON.stringify(meta));
  }
  const response=await pending;
  assert.equal(fs.readFileSync(path.join(dir,'count'),'utf8'),'x','one native submission');
  assert.ok(!JSON.stringify(response).includes(code));assert.ok(!stderr.includes(code));
  const scan=directory=>{for(const item of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())scan(file);else if(item.isFile())assert.ok(!fs.readFileSync(file).includes(Buffer.from(code)),`input persisted in ${item.name}`);}};
  scan(root);
  if(transition&&!replace){assert.ok(!response.isError,JSON.stringify(response));assert.equal(response.structuredContent.status,'waiting');assert.equal(response.structuredContent.auth_ui.input,null);}
  else{assert.equal(response.isError,true);assert.equal(response.structuredContent.code,'AGENT_AUTH_RESPONSE_UNKNOWN');assert.equal(response.structuredContent.effect,'unknown');}
 }finally{
  if(session){const closed=await client.callTool({name:'pty_close',arguments:{session_id:session}});assert.ok(!closed.isError,JSON.stringify(closed));}
  await client.close();
 }
}
test('delayed native auth redraw is observed after a single code submission',native,()=>scenario(true));
test('unchanged auth input remains unknown at the observation deadline without resubmission',native,()=>scenario(false));
test('auth generation replacement during delayed readback stays unknown on the original submission',native,()=>scenario(true,true));
test('official onboarding transition keeps the same auth launch after metadata replacement',native,async()=>{
 const dir=fs.mkdtempSync(path.join(root,'onboard-')),bin=path.join(dir,'claude'),count=path.join(dir,'count');
 fs.writeFileSync(bin,`#!/bin/bash
if [ "$1" = auth ] && [ "$2" = status ]; then printf '{"loggedIn":true}\\n'; exit 0; fi
if [ "$#" = 0 ]; then printf 'Choose the text style that looks best with your terminal\\n❯ 1. Dark mode\\n'; sleep 30; exit 0; fi
stty -echo
printf '\\nPaste code here if prompted >\\n'
IFS= read -r reply
printf x >> ${quote(count)}
exit 0
`,{mode:0o755});
 const client=new Client({name:'auth-onboarding-test',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/index.js')],env:{...process.env,CLAUDE_BIN:bin},stderr:'pipe'});
 let session;
 try{
  await client.connect(transport);
  const start=await client.callTool({name:'agent_auth',arguments:{harness:'claude-code',action:'start',cwd:dir,relogin:true}});
  assert.ok(!start.isError,JSON.stringify(start));const current=start.structuredContent;session=current.session_id;
  const response=await client.callTool({name:'agent_auth',arguments:{harness:'claude-code',action:'respond',session_id:session,expected_binding:current.auth_ui.binding,expected_prompt_digest:current.auth_ui.prompt_digest,response:{kind:'authorization_code',value:'ARTIFICIAL_ONBOARDING_CODE'}}});
  assert.ok(!response.isError,JSON.stringify(response));assert.equal(response.structuredContent.status,'waiting');
  assert.equal(response.structuredContent.auth_ui.binding.launch_id,current.auth_ui.binding.launch_id);
  assert.equal(fs.readFileSync(count,'utf8'),'x');
 }finally{if(session)await client.callTool({name:'pty_close',arguments:{session_id:session}});await client.close();}
});
