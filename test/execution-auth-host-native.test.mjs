import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as provider from 'aiterm-steer-delivery';
import * as core from '../dist/core.js';
import { agentsDir } from '../dist/agent-shared.js';
import { createNativeExecutionServer } from '../dist/execution-native-server.js';
import { localParentWorkerRuntime } from '../dist/execution-parent-worker.js';
const options={skip:process.platform==='win32'?'POSIX native participant':false,timeout:25000};
function cli(kind, harness='cursor') {
  const dir=mkdtempSync(join(process.env.HOME,'auth-'+kind+'-'));
  const state=join(dir,'authenticated'), bin=join(dir,'cli');
  writeFileSync(bin,`#!/bin/sh
state='${state}'
kind='${harness}'
if [ "$kind" = codex ] && [ "$1" = app-server ]; then
 while IFS= read -r line;do
  id=$(printf '%s' "$line" | sed -n 's/^{"id":\\([0-9]*\\).*/\\1/p')
  [ -z "$id" ] && continue
  case "$line" in *'"method":"initialize"'*) printf '{"id":%s,"result":{}}\\n' "$id";; *) printf '{"id":%s,"error":{"code":-32601,"message":"Method not found"}}\\n' "$id";; esac
 done
 exit 0
fi
if [ "$kind" = grok ] && [ "$1" = models ];then
 [ -f "$state" ] || printf 'You are not authenticated.\\n\\n'
 printf 'Default model: fixture\\n\\nAvailable models:\\n  * fixture (default)\\n';exit 0
fi
if [ "$1" = status ] || [ "$2" = status ]; then
 if [ -f "$state" ]; then printf 'Logged in\\n'; exit 0; else printf 'Not logged in\\n'; exit 1; fi
fi
case \"$kind\" in codex) printf 'Open https://auth.openai.com/device\\nEnter this code: ABCD-EFGH\\n';; grok) printf 'To sign in, open this URL in your browser:\\nhttps://auth.x.ai/device?user_code=ABCD-EFGH\\n';; *) printf 'Open https://cursor.com/device\\n';; esac
IFS= read -r reply
[ "$reply" = fixture-ok ] && touch "$state"
exit 0
`,{mode:0o700});
  process.env[{cursor:'CURSOR_AGENT_BIN',codex:'CODEX_BIN',grok:'GROK_BIN'}[harness]]=bin;return{dir,state};
}
async function server(t){
 const scope=localParentWorkerRuntime.scope();mkdirSync(dirname(scope.multiplexer.key),{recursive:true});
 t.after(()=>{try{execFileSync('tmux',['-S',scope.multiplexer.key,'kill-server'],{stdio:'ignore'});}catch{}});
 const p=createNativeExecutionServer({interruptCurrentRun:true,expectedScope:scope,provider});t.after(()=>p.server.close());
 const client=new Client({name:'bellteam',version:'fixture'}),[a,b]=InMemoryTransport.createLinkedPair();
 await p.server.connect(b);await client.connect(a);t.after(()=>client.close());return{p,client};
}
test('BellTeam auth start with no session allocates one stamped native generation, accepts auth-only input, checks status and cancels it',options,async t=>{
 const f=cli('cursor'),{p,client}=await server(t);
 const call=(name,args)=>client.callTool({name,arguments:args});
 const start=await call('agent_auth',{harness:'cursor-cli',action:'start',cwd:f.dir});
 assert.equal(start.isError,undefined,JSON.stringify(start));assert.equal(start.structuredContent.status,'waiting');
 const session=start.structuredContent.session_id;assert.ok(session);assert.equal(start.structuredContent.schema,'aiterm.agent-auth-result.v1');
 const generation=core.observeExecutionSessionGeneration(session);assert.ok(generation.launch_id);
 const metadata=JSON.parse(readFileSync(join(agentsDir(),session+'.auth.json'),'utf8'));
 assert.equal(metadata.launch_id,generation.launch_id);assert.match(metadata.execution_native.native_id,/^\$\d+$/);
 assert.equal(start._meta['aiterm/execution_binding'].request.tool,'agent_auth.start');assert.deepEqual(p.store.snapshot().slots,[]);
 const sent=await call('pty_send',{session_id:session,text:'fixture-ok',raw:true,force:true});
 assert.equal(sent.isError,undefined,JSON.stringify(sent));
 let done;for(let i=0;i<20;i++){done=await call('agent_auth',{harness:'cursor-cli',action:'status',session_id:session,cwd:f.dir});if(done.structuredContent?.status==='authenticated')break;await new Promise(r=>setTimeout(r,50));}
 assert.equal(done.isError,undefined,JSON.stringify(done));assert.equal(done.structuredContent.status,'authenticated');
 assert.ok(existsSync(f.state));assert.deepEqual(core.observeExecutionSessionGeneration(session),generation);
 const noOp=await call('agent_auth',{harness:'cursor-cli',action:'start',cwd:f.dir});
 assert.equal(noOp.isError,undefined,JSON.stringify(noOp));assert.equal(noOp.structuredContent.status,'authenticated');assert.equal(noOp.structuredContent.session_id,null);
 const cancel=await call('agent_auth',{harness:'cursor-cli',action:'cancel',session_id:session});
 assert.equal(cancel.isError,undefined,JSON.stringify(cancel));assert.equal(cancel.structuredContent.status,'blocked');
 assert.equal(core.observeExecutionSessionGeneration(session).exists,false);assert.deepEqual(p.store.snapshot().slots,[]);
 for(const action of ['status','cancel']){
  const absent=await call('agent_auth',{harness:'cursor-cli',action,session_id:session});
  assert.equal(absent.isError,undefined,JSON.stringify(absent));assert.equal(absent.structuredContent.status,action==='status'?'failed':'blocked');
 }
});

test('already-authenticated cold host start returns the public no-session receipt without creating a native server',options,async t=>{
 const f=cli('cold'),{p,client}=await server(t);writeFileSync(f.state,'fixture');
 const before=core.observeExecutionNativeCreationScope();assert.deepEqual(before,{state:'known',sessions:[],server:null});
 const result=await client.callTool({name:'agent_auth',arguments:{harness:'cursor-cli',action:'start',cwd:f.dir}});
 assert.equal(result.isError,undefined,JSON.stringify(result));assert.equal(result.structuredContent.status,'authenticated');assert.equal(result.structuredContent.session_id,null);
 assert.deepEqual(core.observeExecutionNativeCreationScope(),before);assert.deepEqual(p.store.snapshot().slots,[]);
});

test('host keys only reach a proven auth PTY; missing creator stamps refuse input without enrolling the existing native seat',options,async t=>{
 const f=cli('stamp'),{p,client}=await server(t);
 const start=await client.callTool({name:'agent_auth',arguments:{harness:'cursor-cli',action:'start',session_id:'fixture-auth-explicit',cwd:f.dir}});
 assert.equal(start.isError,undefined,JSON.stringify(start));const session=start.structuredContent.session_id;
 const file=join(agentsDir(),session+'.auth.json'), text=readFileSync(file,'utf8'), meta=JSON.parse(text);
 delete meta.execution_native;writeFileSync(file,JSON.stringify(meta));
 const before=p.store.snapshot();
 for(const [name,args] of [['pty_send',{session_id:session,text:'fixture-ok',raw:true}],['pty_key',{session_id:session,key:'Enter'}],['agent_auth',{harness:'cursor-cli',action:'cancel',session_id:session}]]){
  const denied=await client.callTool({name,arguments:args});assert.equal(denied.isError,true);assert.equal(denied._meta['aiterm/execution_error'].effect,'not_started');
  assert.deepEqual(p.store.snapshot(),before);
 }
 assert.equal(existsSync(f.state),false);writeFileSync(file,text);
 const key=await client.callTool({name:'pty_key',arguments:{session_id:session,key:'Enter'}});assert.equal(key.isError,undefined,JSON.stringify(key));
 const cancel=await client.callTool({name:'agent_auth',arguments:{harness:'cursor-cli',action:'cancel',session_id:session}});assert.equal(cancel.isError,undefined,JSON.stringify(cancel));
});

test('named Claude auth status keeps one generation while transitioning the existing login PTY into onboarding',options,async t=>{
 const dir=mkdtempSync(join(process.env.HOME,'auth-claude-')),bin=join(dir,'cli'),state=join(dir,'authenticated');
 writeFileSync(bin,`#!/bin/sh
state='${state}'
if [ "$1" = auth ] && [ "$2" = status ]; then
 if [ -f "$state" ]; then printf '{"loggedIn":true}\\n';exit 0;else printf '{"loggedIn":false}\\n';exit 1;fi
fi
if [ "$#" = 0 ];then
 printf 'Claude Code\\nSelect login method:\\n❯ 1. Claude account with subscription\\n'
 while IFS= read -r reply;do printf '\\033[2J\\033[HClaude Code\\n❯\\n';done
else printf 'Open https://claude.ai/device\\n';IFS= read -r reply;touch "$state";fi
`,{mode:0o700});process.env.CLAUDE_BIN=bin;
 const {p,client}=await server(t),call=(name,args)=>client.callTool({name,arguments:args});
 const start=await call('agent_auth',{harness:'claude-code',action:'start',cwd:dir});assert.equal(start.isError,undefined,JSON.stringify(start));
 const session=start.structuredContent.session_id,generation=core.observeExecutionSessionGeneration(session);
 assert.equal((await call('pty_key',{session_id:session,key:'Enter'})).isError,undefined);
 let onboarding;for(let i=0;i<20;i++){onboarding=await call('agent_auth',{harness:'claude-code',action:'status',session_id:session});if(onboarding.structuredContent?.status==='waiting')break;await new Promise(r=>setTimeout(r,50));}
 assert.equal(onboarding.isError,undefined,JSON.stringify(onboarding));assert.equal(onboarding.structuredContent.status,'waiting');
 assert.equal(JSON.parse(readFileSync(join(agentsDir(),session+'.auth.json'),'utf8')).phase,'onboarding');
 assert.deepEqual(core.observeExecutionSessionGeneration(session),generation);
 assert.equal((await call('pty_key',{session_id:session,key:'Enter'})).isError,undefined);
 let done;for(let i=0;i<20;i++){done=await call('agent_auth',{harness:'claude-code',action:'status',session_id:session});if(done.structuredContent?.status==='authenticated')break;await new Promise(r=>setTimeout(r,50));}
 assert.equal(done.isError,undefined,JSON.stringify(done));assert.equal(done.structuredContent.status,'authenticated');
 assert.deepEqual(core.observeExecutionSessionGeneration(session),generation);assert.deepEqual(p.store.snapshot().slots,[]);
});

for(const kind of ['codex','grok']) test(`native ${kind} auth returns v1 through start, synthetic input, status and cancel`,options,async t=>{
 const f=cli('native-'+kind,kind),{p,client}=await server(t),harness=kind+'-cli';
 const call=(name,args)=>client.callTool({name,arguments:args});
 const start=await call('agent_auth',{harness,action:'start',cwd:f.dir});
 assert.equal(start.isError,undefined,JSON.stringify(start));assert.equal(start.structuredContent.status,'waiting');assert.equal(start.structuredContent.user_code,'ABCD-EFGH');
 const session=start.structuredContent.session_id,generation=core.observeExecutionSessionGeneration(session);
 assert.equal((await call('pty_send',{session_id:session,text:'fixture-ok',raw:true,force:true})).isError,undefined);
 let done;for(let i=0;i<20;i++){done=await call('agent_auth',{harness,action:'status',session_id:session});if(done.structuredContent?.status==='authenticated')break;await new Promise(r=>setTimeout(r,50));}
 assert.equal(done.isError,undefined,JSON.stringify(done));assert.equal(done.structuredContent.status,'authenticated');assert.deepEqual(core.observeExecutionSessionGeneration(session),generation);
 assert.equal((await call('agent_auth',{harness,action:'cancel',session_id:session})).isError,undefined);assert.deepEqual(p.store.snapshot().slots,[]);
});
