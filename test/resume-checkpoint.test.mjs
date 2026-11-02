import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeResumeCheckpoint, decodeResumeCheckpoint} from '../dist/resume-checkpoint.js';
test('checkpoint rejects an empty record chain',()=>{
 assert.throws(()=>encodeResumeCheckpoint({schema:'aiterm.resume-checkpoint.v1',scope:{},records:[]}));
});
import {resumeCheckpointRecord,resumeCheckpointDigest,validateResumeCheckpoint} from '../dist/resume-checkpoint.js';
const id='a'.repeat(32),vendor='11111111-2222-4333-8444-555555555555';
function fixture(){
 const scope={session_id:'offline',launch_id:id,uid:1000,node_platform:'linux',state_base:'/state',socket:'/tmp/claude-tmux-sockets/claude.sock',configuration_root:'/codex',vendor_session_id:vendor};
 const recipe={schema:'aiterm.agent-resume.v1',launch_id:id,kind:'codex',vendor_session_id:vendor,executable:'/bin/codex',cwd:'/work',configuration_root:'/codex',model:'sol',reasoning_effort:'high',fast:false,environment:{}};
 const proof={schema:'aiterm.codex-resume-proof.v1',launch_id:id,session_id:vendor,file:'/codex/sessions/root.jsonl',device:'1',inode:'2',cursor:100,prefix_bytes:10,prefix_sha256:'1'.repeat(64),last_turn_id:'turn'};
 const meta={kind:'codex',aiterm_session:'offline',launch_id:id,event_file:'/state/aiterm-mcp-1000/agents/offline.'+id+'.events.jsonl',created_at:'2026-11-02T15:00:00.000Z',cwd:'/work',vendor_session_id:vendor,initial_prompt:'none',agent_executable:'/bin/codex',hook_route:'shared_codex_home',node_platform:'linux',codex_home:'/codex',fast:false,model:'sol'};
 const hash=v=>resumeCheckpointDigest(Buffer.from(JSON.stringify(v)));
 const life={schema:'aiterm.agent-lifecycle.v1',launch_id:id,state:'hibernated',socket:scope.socket,at:meta.created_at,anchor:'turn',native_id:'$1',pane:{pid:10,process_group_id:10,started_identity:'linux:1',argv_digest:'2'.repeat(64)},recipe_digest:hash(recipe),resume_proof_digest:hash(proof)};
 const records=Object.entries({generation:{schema:'aiterm.agent-generation.v1',launch_id:id,previous_launch_id:null},metadata:meta,recipe,proof,lifecycle:life}).map(([kind,value])=>resumeCheckpointRecord(id,kind,Buffer.from(JSON.stringify(value,null,2)+'\n')));
 return {schema:'aiterm.resume-checkpoint.v1',scope,records};
}
function change(b,kind,fn){const r=b.records.find(r=>r.kind===kind);const v=JSON.parse(Buffer.from(r.bytes_base64,'base64'));fn(v);Object.assign(r,resumeCheckpointRecord(r.launch_id,kind,Buffer.from(JSON.stringify(v)+'\n')));}
test('round trip keeps original record bytes and exact bundle digest',()=>{
 const f=fixture(),b=encodeResumeCheckpoint(f);assert.deepEqual(decodeResumeCheckpoint(b),f);assert.equal(validateResumeCheckpoint(f).records[1].bytes_base64,f.records[1].bytes_base64);
 assert.equal(resumeCheckpointDigest(b),resumeCheckpointDigest(encodeResumeCheckpoint(f)));
});
test('unknown fields, duplicate records, altered bytes and noncanonical stream fail closed',()=>{
 const f=fixture();assert.throws(()=>encodeResumeCheckpoint({...f,extra:true}));
 assert.throws(()=>encodeResumeCheckpoint({...f,records:[...f.records,f.records[0]]}));
 const t=fixture();t.records[0].sha256='0'.repeat(64);assert.throws(()=>encodeResumeCheckpoint(t));
 const b=encodeResumeCheckpoint(f);assert.throws(()=>decodeResumeCheckpoint(b.subarray(0,b.length-1)));
 assert.throws(()=>decodeResumeCheckpoint(Buffer.concat([b,Buffer.from('\n')])));
 assert.throws(()=>decodeResumeCheckpoint(Buffer.alloc(16*1024*1024+1)));
});
test('metadata paths, unsupported provenance and secret recipes are rejected rather than stripped',()=>{
 for(const patch of [m=>m.event_file='/etc/passwd',m=>m.codex_home='/other',m=>m.execution_native={},m=>m.initial_prompt='pending',m=>m.unrecognized='secret']){
  const f=fixture();change(f,'metadata',patch);assert.throws(()=>encodeResumeCheckpoint(f));
 }
 const f=fixture();change(f,'recipe',r=>r.environment.API_KEY='not-saved');assert.throws(()=>encodeResumeCheckpoint(f));
});
test('mismatched vendor, pointer, lifecycle proof and external root are rejected',()=>{
 for(const [kind,patch] of [['proof',p=>p.file='/etc/shadow'],['proof',p=>p.session_id='22222222-2222-4333-8444-555555555555'],['generation',p=>p.previous_launch_id='b'.repeat(32)],['lifecycle',p=>p.resume_proof_digest='0'.repeat(64)],['lifecycle',p=>p.state='stopping']]){
  const f=fixture();change(f,kind,patch);assert.throws(()=>encodeResumeCheckpoint(f));
 }
});
test('missing records and unrelated generations do not become a partial success',()=>{
 const f=fixture();f.records=f.records.filter(r=>r.kind!=='proof');assert.throws(()=>encodeResumeCheckpoint(f));
 const g=fixture();g.records.push(resumeCheckpointRecord('b'.repeat(32),'metadata',Buffer.from('{}')));assert.throws(()=>encodeResumeCheckpoint(g));
});
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createOfflineResumeCheckpoint} from '../dist/resume-checkpoint-files.js';
import {resumeCheckpointRecordPath} from '../dist/resume-checkpoint.js';
function onDisk(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'checkpoint-unit-'));fs.chmodSync(dir,0o700);
 const base=path.join(dir,'state'),home=path.join(dir,'codex');fs.mkdirSync(base,{mode:0o700});fs.mkdirSync(path.join(home,'sessions'),{recursive:true});
 const root=path.join(home,'sessions','root.jsonl');fs.writeFileSync(root,'retained native root\n',{mode:0o600});const st=fs.statSync(root);
 const f=fixture();Object.assign(f.scope,{state_base:base,uid:process.getuid(),configuration_root:home,socket:path.join(process.env.TMPDIR??'/tmp','claude-tmux-sockets','claude.sock')});
 change(f,'metadata',m=>{m.codex_home=home;m.event_file=path.join(base,`aiterm-mcp-${process.getuid()}`,'agents',`offline.${id}.events.jsonl`);});
 change(f,'recipe',r=>r.configuration_root=home);
 change(f,'proof',p=>Object.assign(p,{file:root,device:String(st.dev),inode:String(st.ino),cursor:st.size,prefix_bytes:st.size,prefix_sha256:resumeCheckpointDigest(fs.readFileSync(root))}));
 const recipe=JSON.parse(Buffer.from(f.records.find(r=>r.kind==='recipe').bytes_base64,'base64'));
 const proof=JSON.parse(Buffer.from(f.records.find(r=>r.kind==='proof').bytes_base64,'base64'));
 change(f,'lifecycle',l=>{l.socket=f.scope.socket;l.recipe_digest=resumeCheckpointDigest(Buffer.from(JSON.stringify(recipe)));l.resume_proof_digest=resumeCheckpointDigest(Buffer.from(JSON.stringify(proof)));});
 const agents=path.join(base,`aiterm-mcp-${process.getuid()}`,'agents');fs.mkdirSync(path.dirname(agents),{mode:0o700});fs.mkdirSync(agents,{mode:0o700});
 for(const r of f.records)fs.writeFileSync(resumeCheckpointRecordPath(f.scope,r),Buffer.from(r.bytes_base64,'base64'),{mode:0o600});
 const previous=process.env.AITERM_STATE_BASE;process.env.AITERM_STATE_BASE=base;
 return {f,agents,root,done(){if(previous===undefined)delete process.env.AITERM_STATE_BASE;else process.env.AITERM_STATE_BASE=previous;fs.rmSync(dir,{recursive:true,force:true});}};
}
test('offline checkpoint leaves every source byte and directory entry untouched',()=>{
 const x=onDisk();try {
  const before=fs.readdirSync(x.agents).sort(),data=before.map(n=>fs.readFileSync(path.join(x.agents,n)));
  const result=decodeResumeCheckpoint(createOfflineResumeCheckpoint('offline',id));assert.deepEqual(result.scope,x.f.scope);
  assert.deepEqual(fs.readdirSync(x.agents).sort(),before);before.forEach((n,i)=>assert.deepEqual(fs.readFileSync(path.join(x.agents,n)),data[i]));
 }finally{x.done();}
});
test('missing state never creates a cold directory or falls back to tmp',()=>{
 const x=onDisk();try{const missing=path.join(x.f.scope.state_base,'absent');process.env.AITERM_STATE_BASE=missing;
 assert.throws(()=>createOfflineResumeCheckpoint('offline',id));assert.equal(fs.existsSync(missing),false);
 }finally{x.done();}
});
test('symlink, unsafe record permissions and replaced vendor roots refuse',()=>{
 const x=onDisk();try{
  const file=resumeCheckpointRecordPath(x.f.scope,x.f.records.find(r=>r.kind==='recipe'));const bytes=fs.readFileSync(file);
  fs.chmodSync(file,0o644);assert.throws(()=>createOfflineResumeCheckpoint('offline',id));fs.chmodSync(file,0o600);
  fs.unlinkSync(file);fs.symlinkSync(file+'.missing',file);assert.throws(()=>createOfflineResumeCheckpoint('offline',id));fs.unlinkSync(file);fs.writeFileSync(file,bytes,{mode:0o600});
  fs.renameSync(x.root,x.root+'.old');fs.writeFileSync(x.root,'retained native root\n',{mode:0o600});assert.throws(()=>createOfflineResumeCheckpoint('offline',id));
 }finally{x.done();}
});
function failedFixture(){
 const f=fixture(),b='b'.repeat(32),a=f.scope.launch_id;f.scope.launch_id=b;
 const m=JSON.parse(Buffer.from(f.records.find(r=>r.kind==='metadata').bytes_base64,'base64'));
 const recipe=JSON.parse(Buffer.from(f.records.find(r=>r.kind==='recipe').bytes_base64,'base64'));
 const pointer=f.records.find(r=>r.kind==='generation');Object.assign(pointer,resumeCheckpointRecord(b,'generation',Buffer.from(JSON.stringify({schema:'aiterm.agent-generation.v1',launch_id:b,previous_launch_id:a}))));
 f.records.push(resumeCheckpointRecord(a,'attempt',Buffer.from(JSON.stringify({schema:'aiterm.agent-resume-attempt.v1',launch_id:a,next_launch_id:b,state:'failed',at:m.created_at,recipe_digest:resumeCheckpointDigest(Buffer.from(JSON.stringify(recipe)))}))));
 f.records.push(resumeCheckpointRecord(b,'metadata',Buffer.from(JSON.stringify({...m,launch_id:b,resumed_from:a,event_file:m.event_file.replace(a,b)}))));
 f.records.push(resumeCheckpointRecord(b,'recipe',Buffer.from(JSON.stringify({...recipe,launch_id:b}))));
 f.records.push(resumeCheckpointRecord(b,'native',Buffer.from(JSON.stringify({schema:'aiterm.agent-resume-native.v1',launch_id:b,session_id:'offline',native_id:'$2',server_pid:11,server_started_identity:'linux:2',pane_id:'%2',pane_pid:12,pane_started_identity:'linux:3'}))));
 return f;
}
test('published failed chain preserves the original failed bytes',()=>{
 const f=failedFixture(),old=f.records.find(r=>r.kind==='attempt');const b=encodeResumeCheckpoint(f);
 assert.equal(decodeResumeCheckpoint(b).records.find(r=>r.kind==='attempt').bytes_base64,old.bytes_base64);
});
test('failed chains reject processing, recipe changes and missing native receipts',()=>{
 for(const mutation of [f=>change(f,'attempt',a=>a.state='resuming'),f=>{f.records=f.records.filter(r=>r.kind!=='native');},f=>{
  const r=f.records.find(r=>r.kind==='recipe'&&r.launch_id===f.scope.launch_id);const v=JSON.parse(Buffer.from(r.bytes_base64,'base64'));v.reasoning_effort='low';Object.assign(r,resumeCheckpointRecord(r.launch_id,'recipe',Buffer.from(JSON.stringify(v))));
 }]){const f=failedFixture();mutation(f);assert.throws(()=>encodeResumeCheckpoint(f));}
});
import {restoreOfflineResumeCheckpoint} from '../dist/resume-checkpoint-files.js';
import {parseResumeStateArgs,RESUME_STATE_ERROR} from '../dist/resume-state-cli.js';
const absent=()=>({state:'known',sessions:[]});
function restoreFixture(){const x=onDisk(),bytes=createOfflineResumeCheckpoint('offline',id),expected={session_id:'offline',launch_id:id,sha256:resumeCheckpointDigest(bytes)};
 fs.rmSync(path.dirname(x.agents),{recursive:true});return {...x,bytes,expected};}
test('restore publishes exact original bytes and only the same digest is idempotent',()=>{
 const x=restoreFixture();try{
  assert.equal(restoreOfflineResumeCheckpoint(x.bytes,x.expected,absent),'restored');
  for(const r of x.f.records)assert.deepEqual(fs.readFileSync(resumeCheckpointRecordPath(x.f.scope,r)),Buffer.from(r.bytes_base64,'base64'));
  assert.equal(restoreOfflineResumeCheckpoint(x.bytes,x.expected,absent),'already_restored');
  assert.throws(()=>restoreOfflineResumeCheckpoint(x.bytes,{...x.expected,sha256:'0'.repeat(64)},absent));
  const r=x.f.records.find(r=>r.kind==='metadata');fs.appendFileSync(resumeCheckpointRecordPath(x.f.scope,r),' ');
  assert.throws(()=>restoreOfflineResumeCheckpoint(x.bytes,x.expected,absent));
 }finally{x.done();}
});
test('restore rejects target, native and missing root before creating destination state',()=>{
 const x=restoreFixture();try{
  for(const [e,n] of [[{...x.expected,launch_id:'b'.repeat(32)},absent],[x.expected,()=>({state:'unknown'})],[x.expected,()=>({state:'known',sessions:[{session_id:'offline'}]})]])assert.throws(()=>restoreOfflineResumeCheckpoint(x.bytes,e,n));
  assert.equal(fs.existsSync(x.agents),false);fs.renameSync(x.root,x.root+'.gone');assert.throws(()=>restoreOfflineResumeCheckpoint(x.bytes,x.expected,absent));assert.equal(fs.existsSync(x.agents),false);
 }finally{x.done();}
});
test('same digest resumes completed partial files without changing old failed history',()=>{
 const x=restoreFixture();try{
  let calls=0;assert.throws(()=>restoreOfflineResumeCheckpoint(x.bytes,x.expected,()=>++calls>2?{state:'unknown'}:absent()));
  assert.equal(restoreOfflineResumeCheckpoint(x.bytes,x.expected,absent),'restored');
  assert.equal(restoreOfflineResumeCheckpoint(x.bytes,x.expected,absent),'already_restored');
 }finally{x.done();}
});
test('CLI exact arguments and safe error bytes are bounded',()=>{
 assert.equal(Buffer.byteLength(RESUME_STATE_ERROR),33);
 assert.deepEqual(parseResumeStateArgs(['checkpoint','--session','offline','--launch',id]),{operation:'checkpoint',session_id:'offline',launch_id:id});
 for(const args of [['checkpoint','--session','offline','--launch',id,'--sha256','0'.repeat(64)],['restore','--session','offline','--launch',id],['checkpoint','--session','offline','--session','offline','--launch',id],['close']])assert.throws(()=>parseResumeStateArgs(args));
});
import {spawnSync} from 'node:child_process';
const cliArgs=['dist/resume-state-cli.js'];
test('real process CLI separates private bundle and receipt then restores without native startup',()=>{
 const x=onDisk();try{
  const cp=spawnSync(process.execPath,[...cliArgs,'checkpoint','--session','offline','--launch',id],{env:process.env,maxBuffer:18*1024*1024});
  assert.equal(cp.status,0,cp.stderr.toString());assert.deepEqual(decodeResumeCheckpoint(cp.stdout).scope,x.f.scope);
  const receipt=JSON.parse(cp.stderr);assert.equal(receipt.outcome,'saved');assert.equal(receipt.checkpoint_sha256,resumeCheckpointDigest(cp.stdout));assert.equal(Object.keys(receipt).length,6);assert.ok(cp.stderr.length<=512);
  fs.rmSync(path.dirname(x.agents),{recursive:true});
  const rs=spawnSync(process.execPath,[...cliArgs,'restore','--session','offline','--launch',id,'--sha256',receipt.checkpoint_sha256],{env:process.env,input:cp.stdout,maxBuffer:4096});
  assert.equal(rs.status,0,rs.stderr.toString());assert.equal(rs.stderr.length,0);assert.equal(JSON.parse(rs.stdout).outcome,'restored');assert.ok(rs.stdout.length<=512);
  const again=spawnSync(process.execPath,[...cliArgs,'restore','--session','offline','--launch',id,'--sha256',receipt.checkpoint_sha256],{env:process.env,input:cp.stdout,maxBuffer:4096});
  assert.equal(again.status,0,again.stderr.toString());assert.equal(JSON.parse(again.stdout).outcome,'already_restored');
  const bad=spawnSync(process.execPath,[...cliArgs,'restore','--session','offline','--launch',id,'--sha256',receipt.checkpoint_sha256],{env:process.env,input:Buffer.from('secret invalid input'),maxBuffer:4096});
  assert.equal(bad.status,2);assert.equal(bad.stdout.length,0);assert.equal(bad.stderr.toString(),RESUME_STATE_ERROR);
 }finally{x.done();}
});
