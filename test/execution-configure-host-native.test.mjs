import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as provider from 'aiterm-steer-delivery';
import * as core from '../dist/core.js';
import { agentMetadataPath } from '../dist/agent-shared.js';
import { createNativeExecutionServer } from '../dist/execution-native-server.js';
import { localParentWorkerRuntime } from '../dist/execution-parent-worker.js';
test('BellTeam native SDK fast change reaches the CLI, preserves the seat generation and restores user defaults',
  { skip: process.platform === 'win32' ? 'POSIX native participant' : false, timeout: 20000 }, async t => {
  const scope = localParentWorkerRuntime.scope(), socket = scope.multiplexer.key;
  mkdirSync(dirname(socket), { recursive: true });
  t.after(() => { try { execFileSync('tmux',['-S',socket,'kill-server'],{stdio:'ignore'}); } catch {} });
  const dir = join(process.env.HOME, 'bin'); mkdirSync(dir);
  const driver = join(dir, 'claude'), bin = join(dir, 'claude.sh'), input = join(dir, 'input.jsonl');
  const settings = join(process.env.CLAUDE_CONFIG_DIR, 'settings.json'); mkdirSync(dirname(settings),{recursive:true});
  const original = '{"theme":"dark"}\n'; writeFileSync(settings,original);
  writeFileSync(bin, `#!/bin/sh\nexec '${process.execPath.replaceAll("'","'\\''")}' '${driver}' "$@"\n`, {mode:0o700});
  writeFileSync(driver, `const fs = require('node:fs');
const args = process.argv.slice(2), settings = ${JSON.stringify(settings)}, input = ${JSON.stringify(input)};
if(args[0] === 'auth') { console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty'})); process.exit(0); }
if(args.includes('-p')) { let data=''; process.stdin.on('data', c => {data+=c; if(!data.includes('\\n'))return; const r=JSON.parse(data.split('\\n')[0]);
console.log(JSON.stringify({type:'control_response',response:{request_id:r.request_id,subtype:'success',response:{models:[{value:'opus',resolvedModel:'claude-opus-5-5',displayName:'Opus',supportsFastMode:true}],fast_mode_state:'off'}}})); process.exit(0); }); return; }
let line='', fast=false, log=[]; const rule='─'.repeat(60);
const draw=()=>process.stdout.write('\\x1b[H'+['Claude Code v2.1.296',...log.slice(-8),rule,'❯ '+line,rule,'  ⏵⏵ bypass permissions on (shift+tab to cycle)'+(fast?' ⇯':'')].map(l=>l+'\\x1b[K').join('\\n')+'\\n\\x1b[J');
process.stdout.write('\\x1b[?1049h'); process.stdin.setRawMode(true); process.stdin.resume(); draw();
process.stdin.on('data',c=>{for(const ch of c.toString('utf8').replace(/\\x1b\\[20[01]~/g,'')){if(ch!=='\\r'){if(ch>=' ')line+=ch;continue;} const text=line; line=''; fs.appendFileSync(input,JSON.stringify(text)+'\\n');
if(text==='/fast on'){fast=true; const value=JSON.parse(fs.readFileSync(settings,'utf8'));value.fastMode=true;fs.writeFileSync(settings,JSON.stringify(value));log.push('  ⎿  ⇯ Fast mode ON · $8/$40 per Mtok');}
else if(text==='/fast off'){fast=false;const value=JSON.parse(fs.readFileSync(settings,'utf8'));delete value.fastMode;fs.writeFileSync(settings,JSON.stringify(value));log.push('  ⎿  Fast mode OFF');}}
draw();});`);
  process.env.CLAUDE_BIN=bin; core.__testSetAgentTuiReadyStableSamples(1);
  t.after(()=>core.__testSetAgentTuiReadyStableSamples(null));
  const p=createNativeExecutionServer({interruptCurrentRun:true,expectedScope:scope,provider}); t.after(()=>p.server.close());
  const client=new Client({name:'bellteam',version:'fixture'}),[a,b]=InMemoryTransport.createLinkedPair();
  await p.server.connect(b);await client.connect(a);t.after(()=>client.close());
  const session='fixture-configure-fast';
  const opened=await client.callTool({name:'agent_launch',arguments:{harness:'claude-code',session_name:session,cwd:process.env.HOME,model:'opus',trust_project:true}});
  assert.equal(opened.isError,undefined,JSON.stringify(opened));
  const generation=core.observeExecutionSessionGeneration(session);
  for(const fast of [true,false]){
    const result=await client.callTool({name:'agent_configure',arguments:{session_id:session,fast}});
    assert.equal(result.isError,undefined,JSON.stringify(result));assert.equal(result.structuredContent.fast,fast);
    assert.equal(result._meta['aiterm/execution_binding'].request.tool,'agent_configure');
    assert.deepEqual(core.observeExecutionSessionGeneration(session),generation);
    assert.equal(JSON.parse(readFileSync(agentMetadataPath(session,generation.launch_id),'utf8')).fast,fast);
    assert.equal(readFileSync(settings,'utf8'),original);assert.deepEqual(p.store.snapshot().slots,[]);
  }
  assert.deepEqual(readFileSync(input,'utf8').trim().split('\n').map(JSON.parse),['/fast on','/fast off']);
});
