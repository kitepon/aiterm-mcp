import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {claudeAgentArgv,claudeResumeArgv} from '../dist/harnesses/claude.js';
import {codexAgentArgv,codexResumeArgv,codexTranscriptMatchesLaunch} from '../dist/harnesses/codex.js';
import {resolveForkSource,forkInputKey} from '../dist/core.js';
import {agentsDir} from '../dist/agent-shared.js';
import {probeWriteBan,writeBanPrefix,windowsWriteBanArgv} from '../dist/write-ban.js';
const main='11111111-2222-4333-8444-555555555555', own='66666666-7777-4888-9999-000000000000';
const ban={path:'/srv/project',method:'landlock'};
const base={aiterm_session:'main-fork-abc',launch_id:'a'.repeat(32),vendor_session_id:own,node_platform:process.platform,created_at:new Date(Date.now()-1000).toISOString(),
 agent_role:'subagent',parent_session_id:'host-root',delegation_depth:1,lineage:'host-root>x',delegation_allowed:true,
 fork_of:{session_id:'main',vendor_session_id:main,write_ban:ban,first_input:forkInputKey('What is  the\ncodeword?')}};
const at=(argv,flag)=>argv[argv.indexOf(flag)+1];

test('a Claude fork keeps its own session ID and the main\'s tools; resume drops only the fork pair',()=>{
 const meta={...base,kind:'claude',claude_settings:'s.json'};
 const argv=claudeAgentArgv('claude',null,null,null,meta);
 assert.equal(at(argv,'--session-id'),own);assert.equal(at(argv,'--resume'),main);assert.ok(argv.includes('--fork-session'));
 assert.equal(argv.some(a=>/^--(tools|disallowed|strict-mcp)/.test(a)),false);
 const resumed=claudeResumeArgv('claude',null,null,meta);
 assert.equal(at(resumed,'--resume'),own);assert.equal(resumed.filter(a=>a==='--resume').length,1);
 assert.equal(resumed.includes('--fork-session')||resumed.includes(main),false);
});
test('a Codex fork starts with `codex fork <main>`; resume selects the fork\'s own thread',()=>{
 const meta={...base,kind:'codex',hook_route:'shared_codex_home'};
 assert.deepEqual(codexAgentArgv('codex',null,null,null,meta).slice(0,3),['codex','fork',main]);
 const resumed=codexResumeArgv('codex',null,null,meta,os.tmpdir());
 assert.deepEqual(resumed.slice(0,3),['codex','resume',own]);assert.equal(resumed.includes('fork')||resumed.includes(main),false);
});
test('a forked Codex rollout binds by its parent and the first input, never by another main or input',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fork-bind-')),file=path.join(dir,'rollout.jsonl');
 const write=(parent,text)=>fs.writeFileSync(file,[{type:'session_meta',payload:{id:own,originator:'codex-tui',source:'cli',forked_from_id:parent}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}}].map(o=>JSON.stringify(o)).join('\n')+'\n');
 const meta={...base,kind:'codex',hook_route:'shared_codex_home'};
 write(main,'preface\nWhat is the codeword?');assert.equal(codexTranscriptMatchesLaunch(file,meta),true);
 write('99999999-2222-4333-8444-555555555555','What is the codeword?');assert.equal(codexTranscriptMatchesLaunch(file,meta),false);
 write(main,'another question');assert.equal(codexTranscriptMatchesLaunch(file,meta),false);
 fs.rmSync(dir,{recursive:true,force:true});
});
test('fork requests that cannot hold the contract never start a seat',()=>{
 const ok={prompt:'q'},probe=()=>ban;
 assert.throws(()=>resolveForkSource('grok',{session_id:'main'},ok,probe),/FORK_UNSUPPORTED/);
 assert.throws(()=>resolveForkSource('claude',{session_id:'main'},{},probe),/FORK_INVALID/);
 for(const extra of [{write_scope:'read-only'},{require_existing_resume:true},{throughline_source_session:'s'},{configuration_root:'/x'}])
  assert.throws(()=>resolveForkSource('claude',{session_id:'main'},{...ok,...extra},probe),/FORK_INVALID/);
 assert.throws(()=>resolveForkSource('codex',{session_id:'no-such-seat-fork'},ok,probe),/FORK_SOURCE_UNAVAILABLE/);
 if(process.platform!=='win32')assert.throws(()=>probeWriteBan(os.tmpdir(),'win32'),/READONLY_UNENFORCEABLE/,'the Windows helper cannot prove the ban on another OS');
 assert.throws(()=>probeWriteBan('/'),/READONLY_UNENFORCEABLE/);
});
test('a closed main forks from the conversation its close saved, and refuses once that conversation is gone',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fork-closed-')),cwd=path.join(tmp,'project'),rollout=path.join(tmp,'rollout.jsonl');
 fs.mkdirSync(cwd);fs.writeFileSync(rollout,'{}\n');
 const parent=path.join(tmp,'roots'),home=path.join(parent,'1st'),transcript=path.join(home,'projects',cwd.replace(/[^a-zA-Z0-9]/g,'-'),`${main}.jsonl`);
 fs.mkdirSync(path.dirname(transcript),{recursive:true});fs.writeFileSync(transcript,'{}\n');
 const saved=(name,v)=>fs.writeFileSync(path.join(agentsDir(),`${name}.fork-source.json`),JSON.stringify(v));
 const ok={prompt:'q'},probe=()=>ban,prev=process.env.AITERM_CLAUDE_CONFIG_ROOTS;
 process.env.AITERM_CLAUDE_CONFIG_ROOTS=parent;
 try{
  saved('closed-codex-main',{kind:'codex',cwd,vendor_session_id:main,rollout});
  const r=resolveForkSource('codex',{session_id:'closed-codex-main'},ok,probe);
  assert.equal(r.fork_of.vendor_session_id,main);assert.equal(r.cwd,cwd);assert.equal(r.fork_of.session_id,'closed-codex-main');
  assert.throws(()=>resolveForkSource('claude',{session_id:'closed-codex-main'},ok,probe),/FORK_SOURCE_UNAVAILABLE/,'another harness never forks it');
  saved('closed-claude-main',{kind:'claude',cwd,vendor_session_id:main,claude_home:home});
  const c=resolveForkSource('claude',{session_id:'closed-claude-main'},ok,probe);
  assert.equal(c.fork_of.vendor_session_id,main);assert.equal(fs.realpathSync(c.root.root),fs.realpathSync(home));
  fs.rmSync(rollout);fs.rmSync(transcript);
  assert.throws(()=>resolveForkSource('codex',{session_id:'closed-codex-main'},ok,probe),/FORK_SOURCE_UNAVAILABLE.*no longer exists/);
  assert.throws(()=>resolveForkSource('claude',{session_id:'closed-claude-main'},ok,probe),/FORK_SOURCE_UNAVAILABLE.*no longer exists/);
 }finally{
  if(prev===undefined)delete process.env.AITERM_CLAUDE_CONFIG_ROOTS;else process.env.AITERM_CLAUDE_CONFIG_ROOTS=prev;
  for(const n of ['closed-codex-main','closed-claude-main'])fs.rmSync(path.join(agentsDir(),`${n}.fork-source.json`),{force:true});
  fs.rmSync(tmp,{recursive:true,force:true});
 }
});
test('the write-ban refuses every write route inside the folder and allows writes outside',{skip:process.platform==='win32'},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fork-ban-')),inside=path.join(root,'project'),outside=path.join(root,'outside');
 fs.mkdirSync(inside);fs.mkdirSync(outside);fs.writeFileSync(path.join(inside,'kept.txt'),'k');
 const b=probeWriteBan(inside);
 const [bin,...args]=writeBanPrefix(b);
 const script=`echo x > '${inside}/redir.txt' 2>/dev/null && echo REDIR; touch '${inside}/t' 2>/dev/null && echo TOUCH; `+
  `mkdir '${inside}/d' 2>/dev/null && echo MKDIR; true > '${inside}/kept.txt' 2>/dev/null && echo TRUNC; mv '${inside}/kept.txt' '${outside}/' 2>/dev/null && echo MOVE; `+
  `echo y > '${outside}/o.txt' && echo OUTSIDE; cat '${inside}/kept.txt'`;
 const r=spawnSync(bin,[...args,'/bin/sh','-c',script],{encoding:'utf8'});
 assert.equal(r.stdout.trim().split('\n').join(' '),'OUTSIDE k',r.stderr);
 assert.deepEqual(fs.readdirSync(inside),['kept.txt']);assert.equal(fs.readFileSync(path.join(outside,'o.txt'),'utf8'),'y\n');
 fs.rmSync(root,{recursive:true,force:true});
});
test('Windows: the restricted-token write-ban refuses every write route inside the folder and allows writes outside',{skip:process.platform!=='win32'},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fork-ban-')),inside=path.join(root,'project'),outside=path.join(root,'outside');
 fs.mkdirSync(path.join(inside,'sub'),{recursive:true});fs.mkdirSync(outside);fs.writeFileSync(path.join(inside,'kept.txt'),'k');
 const b=probeWriteBan(inside);assert.equal(b.method,'restricted-token');
 const q=p=>`'${p.replaceAll("'","''")}'`,P=q(inside),O=q(outside);
 const script=[`function T($n,[scriptblock]$b){try{& $b 2>$null|Out-Null;if($?){$n}}catch{}}`,
  `T NEW {Set-Content -ErrorAction Stop (Join-Path ${P} n.txt) x}`,`T APPEND {Add-Content -ErrorAction Stop (Join-Path ${P} kept.txt) y}`,
  `T MKDIR {New-Item -ErrorAction Stop -ItemType Directory (Join-Path ${P} d)}`,`T DELETE {Remove-Item -ErrorAction Stop (Join-Path ${P} sub)}`,
  `T RENAME {Rename-Item -ErrorAction Stop (Join-Path ${P} kept.txt) k2.txt}`,
  `T ACL {$a=Get-Acl (Join-Path ${P} kept.txt);$a.SetAccessRuleProtection($true,$false);Set-Acl -ErrorAction Stop (Join-Path ${P} kept.txt) $a}`,
  `T CMD {cmd /c "echo x> ${inside}\\c.txt";if($LASTEXITCODE){throw 'x'}}`,
  `T OUTSIDE {Set-Content -ErrorAction Stop (Join-Path ${O} o.txt) y}`,`Get-Content (Join-Path ${P} kept.txt)`].join('\n');
 const [bin,...args]=windowsWriteBanArgv(b,['pwsh','-NoProfile','-NonInteractive','-Command',script]);
 const r=spawnSync(bin,args,{encoding:'utf8'});
 assert.equal(r.stdout.trim().split(/\r?\n/).join(' '),'OUTSIDE k',r.stderr);
 assert.deepEqual(fs.readdirSync(inside).sort(),['kept.txt','sub']);
 fs.writeFileSync(path.join(inside,'main.txt'),'m');assert.equal(fs.readFileSync(path.join(inside,'main.txt'),'utf8'),'m','the main process keeps writing');
 fs.rmSync(root,{recursive:true,force:true});
});
test('a forked rollout before its first input stays undecided, so a waiter re-reads it',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fork-early-')),file=path.join(dir,'rollout.jsonl');
 fs.writeFileSync(file,[{type:'session_meta',payload:{id:own,originator:'codex-tui',source:'cli',forked_from_id:main}},{type:'turn_context',payload:{}}].map(o=>JSON.stringify(o)).join('\n')+'\n');
 const meta={...base,kind:'codex',hook_route:'shared_codex_home'};
 assert.equal(codexTranscriptMatchesLaunch(file,meta),false);
 fs.appendFileSync(file,JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'What is the codeword?'}]}})+'\n');
 assert.equal(codexTranscriptMatchesLaunch(file,meta),true);
 fs.rmSync(dir,{recursive:true,force:true});
});
