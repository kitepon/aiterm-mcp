import './seat-env.mjs';
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'auth-ui-'));
process.env.HOME=root; process.env.TMPDIR=root; process.env.XDG_RUNTIME_DIR=root;
const core=await import('../dist/core.js');
const {agentsDir}=await import('../dist/agent-shared.js');
const {tmuxCommand}=await import('../dist/tmux-runtime.js');
const {claudeAuthPane}=await import('../dist/harnesses/claude.js');
const {authUi}=await import('../dist/agent-auth-ui.js');
const sessions=[];
after(()=>{for(const session of sessions)core.closeSession(session);fs.rmSync(root,{recursive:true,force:true});});
const native={skip:process.platform==='win32'||spawnSync('tmux',['-V']).status!==0};
function fixture(){
 const dir=fs.mkdtempSync(path.join(root,'cli-')); const bin=path.join(dir,'claude');
 // macOS has no stock GNU sha256sum. A failing sentinel makes accidental reuse visible.
 fs.writeFileSync(path.join(dir,'sha256sum'),'#!/bin/sh\nexit 99\n',{mode:0o755});
 process.env.PATH=dir+path.delimiter+process.env.PATH;
 const node="'"+process.execPath.replaceAll("'","'\\''")+"'";
 fs.writeFileSync(bin,`#!/bin/bash
if [ "$1" = auth ] && [ "$2" = status ]; then printf '{"loggedIn":false}\\n'; exit 1; fi
printf 'Paste code here if prompted >\\n'
IFS= read -r reply
printf 'CLI echo: %s\\n' "$reply"
printf '%s' "$reply" | ${node} -e 'let value="";process.stdin.on("data",chunk=>value+=chunk);process.stdin.on("end",()=>console.log(require("node:crypto").createHash("sha256").update(value).digest("hex")+"  -"))' > '${dir}/digest'
printf '\\033[2J\\033[HWaiting for official response\\n'
sleep 30
`,{mode:0o755}); process.env.CLAUDE_BIN=bin; return dir;
}
async function start(){const dir=fixture();const r=await core.authenticateAgent('claude',{action:'start',cwd:dir,relogin:true}); sessions.push(r.session_id);return {dir,r};}
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):e.isFile()?[path.join(dir,e.name)]:[]);}
test('auth UI distinguishes empty code, explicit choices and unsupported input without guessing',()=>{
 assert.equal(claudeAuthPane('Paste code here if prompted >').ui.input,'authorization_code');
 assert.equal(claudeAuthPane('Paste code here if prompted > existing-draft').ui,undefined);
 assert.equal(claudeAuthPane('Press Enter to continue').ui,undefined);
 const select=claudeAuthPane('Choose the text style that looks best with your terminal\n❯ 1. Dark mode\n 2. Light mode');
 assert.deepEqual(select.ui.choices,[{id:'option-1',label:'Dark mode'},{id:'option-2',label:'Light mode'}]);
 const base={status:'blocked',url:null,user_code:null,input_required:true,message:null};
 assert.equal(authUi(base,claudeAuthPane('Press Enter'),null).stage,'unavailable');
 for(const code of [null,'ABCD-EFGH']){
  const binding={session_id:'t1'};
  assert.equal(authUi({...base,url:'https://auth.x.ai/device',user_code:code},undefined,binding).stage,code?'device_code':'open_url');
 }
});
test('dedicated code input bypasses lastcmd/log/turn and binds the existing legacy generation',native,async()=>{
 const {dir,r}=await start(); assert.equal(r.auth_ui.stage,'paste_code'); assert.ok(r.auth_ui.binding.launch_id);
 const metaPath=path.join(agentsDir(),`${r.session_id}.auth.json`);
 const meta=JSON.parse(fs.readFileSync(metaPath,'utf8')); delete meta.launch_id; fs.writeFileSync(metaPath,JSON.stringify(meta));
 const observed=await core.authenticateAgent('claude',{action:'status',session_id:r.session_id});
 assert.equal(observed.auth_ui.binding.launch_id,null);
 // Simulate an old auth pane's active logger. respond must disconnect it before fake CLI echo.
 const log=path.join(dir,'legacy-pane.log');
 assert.equal(tmuxCommand(true,'pipe-pane','-t',r.session_id,`cat >> '${log}'`).code,0);
 const code='ARTIFICIAL_ONLY_CODE_7N4q_92';
 const receipt=await core.authenticateAgent('claude',{action:'respond',session_id:r.session_id,expected_binding:observed.auth_ui.binding,expected_prompt_digest:observed.auth_ui.prompt_digest,response:{kind:'authorization_code',value:code}});
 for(let i=0;i<50&&!fs.existsSync(path.join(dir,'digest'));i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(fs.readFileSync(path.join(dir,'digest'),'utf8').split(' ')[0],createHash('sha256').update(code).digest('hex'));
 assert.ok(!JSON.stringify(receipt).includes(code));
 await new Promise(r=>setTimeout(r,150));
 for(const file of files(root))assert.ok(!fs.readFileSync(file).includes(Buffer.from(code)),`code persisted in ${path.basename(file)}`);
 assert.equal(tmuxCommand(true,'show-buffer').code,1,'no native paste buffer retained');
});
test('stale generation and wrong phase refuse before input, preserving an existing draft',native,async()=>{
 const {dir,r}=await start();
 const stale={...r.auth_ui.binding,metadata_identity:'different-generation'};
 await assert.rejects(core.authenticateAgent('claude',{action:'respond',session_id:r.session_id,expected_binding:stale,expected_prompt_digest:r.auth_ui.prompt_digest,response:{kind:'authorization_code',value:'FAKE'}}),/STALE_BINDING/);
 assert.equal(fs.existsSync(path.join(dir,'digest')),false);
 tmuxCommand(true,'send-keys','-t',r.session_id,'-l','existing-draft');
 await new Promise(r=>setTimeout(r,80));
 await assert.rejects(core.authenticateAgent('claude',{action:'respond',session_id:r.session_id,expected_binding:r.auth_ui.binding,expected_prompt_digest:r.auth_ui.prompt_digest,response:{kind:'authorization_code',value:'FAKE'}}),/STAGE_MISMATCH/);
 assert.equal(fs.existsSync(path.join(dir,'digest')),false);
});
test('normal MCP publishes the typed stages and sends only to the bound auth flow without persisting a code',native,async()=>{
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
 const {StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js');
 const dir=fixture(); const client=new Client({name:'auth-ui-proof',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/index.js')],env:{...process.env},stderr:'pipe'});
 let stderr=''; transport.stderr?.on('data',chunk=>stderr+=chunk);
 try {
  await client.connect(transport);
  const call=async arguments_=>{const result=await client.callTool({name:'agent_auth',arguments:arguments_});assert.equal(result.isError,undefined,JSON.stringify(result));return result.structuredContent;};
  const started=await call({harness:'claude-code',action:'start',cwd:dir,relogin:true});sessions.push(started.session_id);
  assert.equal(started.auth_ui.stage,'paste_code');
  const refused=await client.callTool({name:'agent_auth',arguments:{harness:'claude-code',action:'respond',session_id:started.session_id,expected_binding:{...started.auth_ui.binding,metadata_identity:'old'},expected_prompt_digest:started.auth_ui.prompt_digest,response:{kind:'authorization_code',value:'FAKE_NOT_ISSUED'}}});
  assert.equal(refused.isError,true);
  assert.equal(refused.structuredContent.schema,'aiterm.auth-response-error.v1');
  assert.equal(refused.structuredContent.effect,'not_issued');
  const code='FAKE_MCP_INPUT_q29X8_z';
  const receipt=await call({harness:'claude-code',action:'respond',session_id:started.session_id,expected_binding:started.auth_ui.binding,expected_prompt_digest:started.auth_ui.prompt_digest,response:{kind:'authorization_code',value:code}});
  assert.ok(!JSON.stringify(receipt).includes(code));
  assert.equal(fs.readFileSync(path.join(dir,'digest'),'utf8').split(' ')[0],createHash('sha256').update(code).digest('hex'));
  for(const file of files(root))assert.ok(!fs.readFileSync(file).includes(Buffer.from(code)),`code persisted in ${path.basename(file)}`);
  assert.ok(!stderr.includes(code));
 } finally {await client.close();}
});
test('native choice uses observed labels and cursor, never host-provided terminal keys',native,async()=>{
 const dir=fixture(); const bin=path.join(dir,'claude');
 fs.writeFileSync(bin,`#!/bin/bash
if [ "$1" = auth ] && [ "$2" = status ]; then printf '{"loggedIn":false}\\n'; exit 1; fi
stty -echo -icanon
at=1
paint() {
 printf '\\033[2J\\033[HChoose the text style that looks best with your terminal\\n'
 if [ "$at" = 1 ]; then printf '❯ 1. Dark mode\\n  2. Light mode\\n'; else printf '  1. Dark mode\\n❯ 2. Light mode\\n'; fi
}
paint
while IFS= read -rsn1 key; do
 if [ "$key" = $'\\e' ]; then IFS= read -rsn2 rest; if [ "$at" = 1 ]; then at=2; else at=1; fi; paint
 elif [ -z "$key" ]; then printf '%s' "$at" > '${dir}/choice'; printf '\\033[2J\\033[HWaiting for official response\\n'; sleep 30; break
 fi
done
`,{mode:0o755});
 const started=await core.authenticateAgent('claude',{action:'start',cwd:dir,relogin:true});sessions.push(started.session_id);
 assert.equal(started.auth_ui.stage,'select');
 await core.authenticateAgent('claude',{action:'respond',session_id:started.session_id,expected_binding:started.auth_ui.binding,expected_prompt_digest:started.auth_ui.prompt_digest,response:{kind:'choice',id:'option-2'}});
 assert.equal(fs.readFileSync(path.join(dir,'choice'),'utf8'),'2');
});
