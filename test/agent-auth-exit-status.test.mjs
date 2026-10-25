import './seat-env.mjs';
import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'auth-exit-'));
const state=path.join(root,'backend.json'),fake=path.join(root,'tmux'),cli=path.join(root,'official-status');
Object.assign(process.env,{HOME:root,TMPDIR:root,XDG_RUNTIME_DIR:root,AITERM_TMUX:fake});
fs.writeFileSync(fake,`#!${process.execPath}
const fs=require('node:fs');const file=${JSON.stringify(state)},s=JSON.parse(fs.readFileSync(file,'utf8')),args=process.argv.slice(2);
s.calls.push(args);fs.writeFileSync(file,JSON.stringify(s));
if(args.includes('-V')){console.log('tmux 3.6');process.exit(0);}
if(args.includes('list-sessions')){if(s.absentAfter===undefined||s.observations<s.absentAfter)console.log(s.session+'\\tbash\\t0\\t80\\t24');process.exit(0);}
if(args.includes('capture-pane'))process.exit(0);
if(args.includes('display-message')){
 if(args.at(-1).startsWith('#{pane_dead}')){
  const row=s.rows[Math.min(s.observations,s.rows.length-1)];s.observations++;
  if(s.replaceGenerationAt===s.observations){const m=JSON.parse(fs.readFileSync(s.metadata,'utf8'));m.launch_id='b'.repeat(32);fs.writeFileSync(s.metadata,JSON.stringify(m));}
  fs.writeFileSync(file,JSON.stringify(s));console.log(row);process.exit(0);
 }
 process.exit(0);
}
console.error('unexpected artificial command');process.exit(91);
`,{mode:0o755});
fs.writeFileSync(cli,`#!${process.execPath}
const fs=require('node:fs'),file=${JSON.stringify(state)},s=JSON.parse(fs.readFileSync(file,'utf8'));
s.officialStatusCalls++;fs.writeFileSync(file,JSON.stringify(s));
if(s.replaceDuringOfficial){const m=JSON.parse(fs.readFileSync(s.metadata,'utf8'));m.launch_id='b'.repeat(32);fs.writeFileSync(s.metadata,JSON.stringify(m));}
if(process.argv.slice(2).join(' ')==='status'){console.log('Logged in');process.exit(0);}process.exit(91);
`,{mode:0o755});
const {agentsDir}=await import('../dist/agent-shared.js');
const {authenticateAgent}=await import('../dist/core.js');
after(()=>fs.rmSync(root,{recursive:true,force:true}));
const posix={skip:process.platform==='win32'};
async function scenario(rows,options={}){
 const session='artificial-auth-exit',kind=options.kind??'codex',metadata=path.join(agentsDir(),session+'.auth.json');
 fs.mkdirSync(path.dirname(metadata),{recursive:true});
 fs.writeFileSync(metadata,JSON.stringify({kind,bin:cli,cwd:root,phase:'login',env_vars:[],launch_id:'a'.repeat(32)}));
 fs.writeFileSync(state,JSON.stringify({session,metadata,rows,observations:0,calls:[],officialStatusCalls:0,...options}));
 try{
  const result=await authenticateAgent(kind,{action:'status',session_id:session});
  const backend=JSON.parse(fs.readFileSync(state,'utf8'));
  assert.ok(backend.calls.every(args=>args.includes('-V')||args.includes('list-sessions')||args.includes('capture-pane')||args.includes('display-message')),'read-only backend calls');
  return {result,...backend};
 }finally{fs.rmSync(metadata,{force:true});assert.equal(fs.existsSync(metadata),false);}
}
test('pending EOF status settles to the same native exit7 instead of an early unknown',posix,async()=>{
 const x=await scenario(['1\t\t','1\t7\t']);assert.equal(x.result.status,'failed');assert.match(x.result.message,/exit=7/);assert.equal(x.observations,2);assert.equal(x.officialStatusCalls,0);
});
test('confirmed signal termination stays failed and never probes global authentication',posix,async()=>{
 const x=await scenario(['1\t\tTERM']);assert.equal(x.result.status,'failed');assert.match(x.result.message,/signal=TERM/);assert.equal(x.observations,1);assert.equal(x.officialStatusCalls,0);
});
test('ordinary nonzero exit is final without an extra observation',posix,async()=>{
 const x=await scenario(['1\t9\t']);assert.equal(x.result.status,'failed');assert.match(x.result.message,/exit=9/);assert.equal(x.observations,1);assert.equal(x.officialStatusCalls,0);
});
test('exit0 still requires official status confirmation',posix,async()=>{
 const x=await scenario(['1\t0\t'],{kind:'cursor'});assert.equal(x.result.status,'authenticated');assert.equal(x.observations,1);assert.equal(x.officialStatusCalls,1);
});
test('permanently empty exit status remains unknown at the bounded observation deadline',posix,async()=>{
 const x=await scenario(['1\t\t']);assert.equal(x.result.status,'failed');assert.match(x.result.message,/exit=unknown/);assert.ok(x.observations>1);assert.equal(x.officialStatusCalls,0);
});
test('disappearance while native exit status is pending stays lost',posix,async()=>{
 const x=await scenario(['1\t\t','1\t7\t'],{absentAfter:1});assert.equal(x.result.status,'failed');assert.equal(x.result.session_id,null);assert.match(x.result.message,/失われました/);assert.equal(x.observations,1);assert.equal(x.officialStatusCalls,0);
});
test('replacement while native exit status is pending never adopts the new generation',posix,async()=>{
 const x=await scenario(['1\t\t','1\t0\t'],{replaceGenerationAt:1});assert.equal(x.result.status,'failed');assert.equal(x.result.session_id,null);assert.match(x.result.message,/世代/);assert.equal(x.observations,1);assert.equal(x.officialStatusCalls,0);
});
test('replacement while terminal status is read never probes authentication on the new generation',posix,async()=>{
 const x=await scenario(['1\t\t','1\t0\t'],{kind:'cursor',replaceGenerationAt:2});assert.equal(x.result.status,'failed');assert.equal(x.result.session_id,null);assert.match(x.result.message,/世代/);assert.equal(x.observations,2);assert.equal(x.officialStatusCalls,0);
});
test('replacement during official confirmation after pending EOF stays unconfirmed',posix,async()=>{
 const x=await scenario(['1\t\t','1\t0\t'],{kind:'cursor',replaceDuringOfficial:true});assert.equal(x.result.status,'failed');assert.equal(x.result.session_id,null);assert.match(x.result.message,/世代/);assert.equal(x.observations,2);assert.equal(x.officialStatusCalls,1);
});
test('a live pane after pending EOF is not the original terminated authentication process',posix,async()=>{
 const x=await scenario(['1\t\t','0\t\t']);assert.equal(x.result.status,'failed');assert.equal(x.result.session_id,null);assert.match(x.result.message,/交代/);assert.equal(x.observations,2);assert.equal(x.officialStatusCalls,0);
});
