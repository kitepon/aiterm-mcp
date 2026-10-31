import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {armAgentIdleClock,idleClockDeadline,AGENT_IDLE_ENABLED} from '../dist/agent-idle-clock.js';
import {readAgentIdleClock,writeAgentIdleClock,retireAgentIdleClock} from '../dist/agent-lifecycle.js';
import {readProcessIdentities,readRuntimeProcesses,processSubtree,idleClockCommand} from '../dist/process-runtime.js';
import {parseIdleArgs} from '../dist/agent-idle-cli.js';
const base={outcome:'skipped',reason:'turn_running',anchor:null,due_at:null,stalled:false};
const meta={aiterm_session:'clock-fixture',launch_id:'a'.repeat(32)};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function stopOwnClock(){
 const clock=readAgentIdleClock(meta);
 if(clock&&readProcessIdentities([clock.owner.pid]).some(row=>row.started_identity===clock.owner.started_identity)){
  // The detached POSIX sleeper has its own group; Windows has only its PowerShell root while sleeping.
  try{process.kill(process.platform==='win32'?clock.owner.pid:-clock.owner.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
 }
 retireAgentIdleClock(meta);
}

test('deadline retains the native end clock and retries busy observations without a resident Node',()=>{
 assert.equal(idleClockDeadline({...base,outcome:'not_due',anchor:'native',due_at:5000},1000),5000);
 for(const reason of ['turn_running','blocked','background_work_or_unknown','input_without_turn_end','superseded_timer'])
  assert.equal(idleClockDeadline({...base,reason},1000),61000);
 for(const outcome of ['hibernated','unconfirmed'])assert.equal(idleClockDeadline({...base,outcome},1000),null);
 for(const reason of ['dead','missing'])assert.equal(idleClockDeadline({...base,reason},1000),null);
});

test('clock CLI validates generations and duplicate arguments, with production entry disabled',()=>{
 const args=['--session','seat','--launch','b'.repeat(32),'--clock','c'.repeat(32)];
 assert.deepEqual(parseIdleArgs(args),{session_id:'seat',launch_id:'b'.repeat(32),token:'c'.repeat(32)});
 for(const bad of [[],['--session','../seat','--launch','b'.repeat(32)],[...args,'--session','other'],[...args,'--wat','x'],
  ['--session','seat','--launch','b'.repeat(32),'--clock','not-a-token']])assert.throws(()=>parseIdleArgs(bad));
 assert.equal(AGENT_IDLE_ENABLED,false,'resume/public acceptance is not complete');
 const run=spawnSync(process.execPath,['dist/agent-idle-cli.js',...args],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).reason,'lifecycle_not_enabled');
});

test('one native sleeper owns a launch; a dead owner is recovered without touching a newer token',async t=>{
 t.after(stopOwnClock);
 assert.equal(await armAgentIdleClock(meta,'first',Date.now()+60000),'armed');
 const first=readAgentIdleClock(meta);assert.equal(first.anchor,'first');
 assert.equal(await armAgentIdleClock(meta,'later',Date.now()+120000),'existing');
 assert.equal(readAgentIdleClock(meta).token,first.token);
 assert.equal(await armAgentIdleClock(meta,'later',Date.now()+120000,'f'.repeat(32)),'superseded');
 assert.equal(readAgentIdleClock(meta).token,first.token);
 await stopOwnClock();
 writeAgentIdleClock(meta,{...first,owner:{pid:process.pid,started_identity:'not-this-process'}});
 assert.equal(await armAgentIdleClock(meta,'second',Date.now()+60000),'armed');
 assert.notEqual(readAgentIdleClock(meta).token,first.token);assert.equal(readAgentIdleClock(meta).anchor,'second');
 retireAgentIdleClock(meta,first.token);assert.notEqual(readAgentIdleClock(meta),null);
});

test('native sleep delays literal argv in a separate session; only the final command runs Node',
 {timeout:15000},async t=>{
 const worker=join(process.env.HOME,"timer worker ' $().mjs"),output=join(process.env.HOME,'timer-result');
 const body='literal $HOME $(false) `false` " apostrophe\' 日本語';
 fs.writeFileSync(worker,"import fs from 'node:fs';fs.writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)));\n");
 const command=idleClockCommand(1500,process.execPath,[worker,output,body]);
 const started=Date.now(),child=spawn(command.executable,command.args,{detached:true,stdio:'ignore'});
 const done=once(child,'exit');
 t.after(()=>{if(child.exitCode===null)child.kill();});
 await once(child,'spawn');
 if(process.platform!=='win32'){
  const rows=readRuntimeProcesses(true),own=rows.find(row=>row.pid===process.pid),timer=rows.find(row=>row.pid===child.pid);
  assert.ok(timer);assert.notEqual(timer.session_identity,own.session_identity);assert.match(timer.command,/^\/bin\/sh /);
 }
 await sleep(100);assert.equal(fs.existsSync(output),false);
 const [code]=await done;assert.equal(code,0);assert.ok(Date.now()-started>=1900);
 assert.deepEqual(JSON.parse(fs.readFileSync(output,'utf8')),[body]);
 assert.throws(()=>idleClockCommand(NaN,process.execPath,[]));
 assert.throws(()=>idleClockCommand(0,process.execPath,['bad\0arg']));
});


test('a transient admission refusal retries in the sleeper, while other failures exit once',
 {skip:process.platform==='win32'?'POSIX sleep fixture':false,timeout:15000},async()=>{
 const bin=join(process.env.HOME,'clock-sleep-bin'),sleeps=join(process.env.HOME,'sleep-count'),count=join(process.env.HOME,'clock-attempts');
 fs.mkdirSync(bin);fs.writeFileSync(join(bin,'sleep'),`#!/bin/sh\nprintf '%s\\n' "$1" >> '${sleeps}'\n`,{mode:0o700});
 const worker=join(process.env.HOME,'clock-retry.mjs');
 fs.writeFileSync(worker,"import fs from 'node:fs';const file=process.argv[2];const n=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8')):0;fs.writeFileSync(file,String(n+1));process.exit(n===0?Number(process.argv[3]):0);\n");
 for(const code of [75,2]){
  fs.rmSync(count,{force:true});fs.rmSync(sleeps,{force:true});
  const command=idleClockCommand(1,process.execPath,[worker,count,String(code)]);
  const run=spawnSync(command.executable,command.args,{env:{...process.env,PATH:bin+':'+process.env.PATH},encoding:'utf8',timeout:10000});
  assert.equal(run.status,code===75?0:2,run.stderr);
  assert.equal(Number(fs.readFileSync(count,'utf8')),code===75?2:1);
  assert.equal(fs.readFileSync(sleeps,'utf8'),code===75?'1\n60\n':'1\n');
 }
});


test('a short controller exits before its sleeper can belong to the managed caller tree',
 {timeout:15000},async t=>{
 t.after(stopOwnClock);
 const launcher=join(process.env.HOME,'clock-launcher.mjs');
 fs.writeFileSync(launcher,`import {armAgentIdleClock} from ${JSON.stringify(new URL('../dist/agent-idle-clock.js',import.meta.url).href)};await armAgentIdleClock(${JSON.stringify(meta)},null,Date.now()+60000);\n`);
 const child=spawn(process.execPath,[launcher],{stdio:'ignore'}),done=once(child,'exit');
 const [code]=await done;assert.equal(code,0);
 const clock=readAgentIdleClock(meta);assert.ok(clock);
 const rows=readRuntimeProcesses(true);assert.ok(rows.some(row=>row.pid===clock.owner.pid));
 assert.equal(rows.some(row=>row.pid===child.pid),false);
 assert.equal(processSubtree(rows,process.pid).some(row=>row.pid===clock.owner.pid),false);
});
