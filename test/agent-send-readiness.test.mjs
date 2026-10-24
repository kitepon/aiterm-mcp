// Readiness-to-steer interleavings through the real product dispatcher and tmux.
import './seat-env.mjs';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

if (process.platform === 'win32') {
  test('controlled native readiness interleavings', { skip: 'POSIX tmux renderer fixture' }, () => {});
} else {
const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.TMPDIR;
assert(root.startsWith('/tmp/at-'));
assert(!process.env.AITERM_AGENT_LAUNCH_ID && !process.env.AITERM_STATE_BASE);
const product = path.resolve(here, '..');
const moduleAt = name => import(pathToFileURL(path.join(product, 'dist', name)).href);
const control = path.join(root, 'screen-control.json'), trace = path.join(root, 'native-trace.jsonl');
const realTmux = spawnSync('which', ['tmux'], { encoding: 'utf8' }).stdout.trim();
assert(path.isAbsolute(realTmux));
const socket = path.join(root, 'claude-tmux-sockets', 'claude.sock');
const IDLE = 'OpenAI Codex\n› Ask Codex to do anything\n  mock-model high · /synthetic\n';
const BUSY = 'OpenAI Codex\n• Working (1s • esc to interrupt)\n› Ask Codex to do anything\n  mock-model high · /synthetic\n';
const STARTUP = 'OpenAI Codex\n◦ Starting MCP servers\n';
const SHELL = 'synthetic-shell$ \n';
const MODAL = 'OpenAI Codex\nWould you like to run the following command?\n› 1. Yes\nenter select · esc cancel\n';
const wrapper = path.join(root, 'tmux-controlled.mjs');
fs.writeFileSync(wrapper, [
  `#!${process.execPath}`,
  `import fs from 'node:fs'; import {spawnSync} from 'node:child_process';`,
  `const a=process.argv.slice(2), socket=${JSON.stringify(socket)}, trace=${JSON.stringify(trace)}, control=${JSON.stringify(control)};`,
  `if (!a.includes('-V') && a[a.indexOf('-S')+1]!==socket) { process.stderr.write('fixture refuses other socket'); process.exit(91); }`,
  `let c=null; try {c=JSON.parse(fs.readFileSync(control,'utf8'));}catch{}`,
  `const capture=a.includes('capture-pane') && a.includes('-45');`,
  `if(c && capture) { c.samples++; fs.writeFileSync(control,JSON.stringify(c));`,
  ` if(c.samples===3 && ['stop','uncertain'].includes(c.patch)) { const {FileExecutionStore}=await import(${JSON.stringify(pathToFileURL(path.join(product,'dist/execution-store.js')).href)}); new FileExecutionStore(c.graph).transactionSync(state=>{if(c.patch==='stop')state.stopping.push(c.target);else state.slots.push({session_id:c.target.session_id,expected_launch_id:c.target.launch_id,stage:'send',state:'unknown',request:null});}); }`,
  ` if(c.dieAtSample===c.samples)fs.writeFileSync(c.exitFlag,'exit');`,
  ` const screen=c.mode==='race' ? (c.samples<=2 ? ${JSON.stringify(IDLE)} : ${JSON.stringify(BUSY)}) : c.mode==='modal' ? (c.samples<=2 ? ${JSON.stringify(IDLE)} : ${JSON.stringify(MODAL)}) : c.mode==='busy' ? ${JSON.stringify(BUSY)} : c.mode==='startup' ? (c.samples<3 ? ${JSON.stringify(STARTUP)} : ${JSON.stringify(IDLE)}) : c.mode==='dead' ? ${JSON.stringify(SHELL)} : null;`,
  ` if(screen!==null) {fs.appendFileSync(trace,JSON.stringify({at:Date.now(),event:'screen',sample:c.samples,state:c.mode==='race'?(c.samples<=2?'idle':'busy'):c.mode})+'\\n'); process.stdout.write(screen); process.exit(0); } }`,
  `if(c && a.some(x=>['paste-buffer','send-keys','load-buffer','set-environment'].includes(x))) fs.appendFileSync(trace,JSON.stringify({at:Date.now(),event:'native',command:a.find(x=>['paste-buffer','send-keys','load-buffer','set-environment'].includes(x))})+'\\n');`,
  `const r=spawnSync(${JSON.stringify(realTmux)},a,{input:fs.readFileSync(0),encoding:'utf8',maxBuffer:16*1024*1024});if(c?.dieAfterPaste&&a.includes('paste-buffer'))fs.writeFileSync(c.exitFlag,'exit');process.stdout.write(r.stdout??'');process.stderr.write(r.stderr??'');process.exit(r.status??1);`,
].join('\n')+'\n', { mode: 0o700 });
process.env.AITERM_TMUX = wrapper;
const fake = path.join(root, 'codex-fixture.mjs');
fs.writeFileSync(fake, [
  `import fs from 'node:fs';`,
  `const [ledger,exitFlag]=process.argv.slice(2);`,
  `process.stdout.write(${JSON.stringify(IDLE)});`,
  `if(process.stdin.isTTY)process.stdin.setRawMode(true);`,
  `process.stdin.on('data',b=>fs.appendFileSync(ledger,b.toString('hex')));`,
  `setInterval(()=>{if(fs.existsSync(exitFlag))process.exit(0);},25);`,
].join('\n')+'\n');
const codexHome = process.env.CODEX_HOME;
fs.mkdirSync(codexHome, { recursive: true });
for(const [name,text] of [['auth.json','{}\n'],['history.jsonl','{}\n'],['config.toml','model = "test-model"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n']])fs.writeFileSync(path.join(codexHome,name),text);
const core = await moduleAt('core.js');
const {codexRunningTurn} = await moduleAt('harnesses/codex.js');
const {FileExecutionStore} = await moduleAt('execution-store.js');
const {ExecutionService} = await moduleAt('execution-service.js');
const {createExecutionRuntime} = await moduleAt('execution-runtime.js');
const {createExecutionDispatcher} = await moduleAt('execution-dispatch.js');
const delay = ms => new Promise(done=>setTimeout(done,ms));
const source = { session_id: 'readiness-source', launch_id: 'a'.repeat(32) };
const sourcePoint = { launch: source, boundary: null };
const posix = process.platform === 'win32' ? 'POSIX controlled tmux renderer fixture' : false;
function redactedRollout(launch,caseName,active) {
  const dir=path.join(codexHome,'sessions','2026','10','24');fs.mkdirSync(dir,{recursive:true});
  const id=randomUUID(), file=path.join(dir,`rollout-2026-10-24T00-00-00-${id}.jsonl`);
  const head=[{type:'session_meta',payload:{id,originator:'codex-tui',source:'cli'}},
    {type:'response_item',payload:{type:'message',role:'developer',content:[{type:'input_text',text:`AITERM_AGENT_LAUNCH_ID=${launch}`}]}},
    {type:'event_msg',payload:{type:'task_started',turn_id:`synthetic-${caseName}`}}];
  if(!active)head.push({type:'event_msg',payload:{type:'task_complete',turn_id:`synthetic-${caseName}`,last_agent_message:'synthetic done'}});
  fs.writeFileSync(file,head.map(x=>JSON.stringify(x)).join('\n')+'\n');
  return {kind:'codex',codex_home:codexHome,hook_route:'shared_codex_home',launch_id:launch,created_at:new Date(Date.now()-60000).toISOString(),vendor_session_id:null};
}
async function scenario(mode) {
  const ledger=path.join(root,`${mode}.hex`),exitFlag=path.join(root,`${mode}.exit`),bin=path.join(root,`codex-${mode}.sh`);
  fs.writeFileSync(bin,`#!/bin/sh\n'${process.execPath}' '${fake}' '${ledger}' '${exitFlag}'\n`,{mode:0o700});
  process.env.CODEX_BIN=bin;
  const [sid]=core.openAgent('codex',{agent_done:true});
  assert(sid.startsWith('t'));
  let row={mode,sid};
  try {
    let live;
    for(let n=0;n<100;n++){live=core.observeSession(sid);if(live.harness_alive===true&&live.state==='idle')break;await delay(50);}
    assert.equal(live.harness_alive,true);assert.equal(live.state,'idle');
    const meta=redactedRollout(live.launch_id,mode,mode!=='startup');
    row.synthetic_turn_before=codexRunningTurn(meta);
    if(mode==='dead'){
      fs.writeFileSync(exitFlag,'exit');
      for(let n=0;n<100;n++){live=core.observeSession(sid);if(live.harness_alive===false)break;await delay(25);}
      assert.equal(live.harness_alive,false);assert.equal(live.reason,'harness_exited');
    }
    row.observation_before={state:live.state,reason:live.reason,harness_alive:live.harness_alive};
    const store=new FileExecutionStore(path.join(root,`graph-${mode}`));
    const observe = session => {
      const value = session === source.session_id ? { schema: 'aiterm.pty-observe-result.v1', session_id: session, exists: true, launch_id: source.launch_id } : core.observeSessionGeneration(session);
      let selected;try{selected=JSON.parse(fs.readFileSync(control,'utf8'));}catch{}
      if(selected?.samples>=3 && (mode==='replace-source'&&session===source.session_id || mode==='replace-target'&&session===sid))return {...value,launch_id:'f'.repeat(32)};
      return value;
    };
    const runtime=createExecutionRuntime({observeSession:observe,observeSessionSync:observe,sourceContext:async()=>sourcePoint,
      async observeDone(){throw new Error('no completion expected');}});
    const service=new ExecutionService(store,runtime);
    const dispatcher=createExecutionDispatcher({service,nativeIdentity:{pid:process.pid,started_identity:'synthetic-probe-start'},sourceEnvironment:{},initializedClientName:()=> 'bellteam',observeSessionGeneration:core.observeSessionGeneration});
    const request={kind:'delivery',delivery_id:randomUUID(),target_session_id:sid};
    await service.execute({action:'register',source_session_id:source.session_id,reservation:{schema:'aiterm.execution-reservation.v1',request,source:{launch:source,boundary:null},target:{session_id:sid,expected_launch_id:live.launch_id}}});
    const renderedMode=['stop','uncertain','replace-source','replace-target'].includes(mode)?'race':mode==='dies-during-wait'?'startup':mode==='dies-after-paste'?'busy':mode;
    fs.writeFileSync(control,JSON.stringify({mode:renderedMode,samples:0,patch:mode,graph:store.directory,target:{session_id:sid,launch_id:live.launch_id},exitFlag,dieAtSample:mode==='dies-during-wait'?2:null,dieAfterPaste:mode==='dies-after-paste'}));fs.writeFileSync(trace,'');
    const started=performance.now();let originalFailure=null;
    const result=await dispatcher.dispatch('pty_send',{session_id:sid,text:`SYNTHETIC_${mode.toUpperCase()}_MARKER`,require_agent:true},
      {_meta:{'aiterm/execution':{schema:'aiterm.execution-ref.v1',request}}},async()=>{
        try{
          const receipt=await core.sendAgentMessage(sid,`SYNTHETIC_${mode.toUpperCase()}_MARKER`);
          return {content:[{type:'text',text:'synthetic receipt'}],structuredContent:{schema:'aiterm.pty-send-result.v1',mode:receipt.schema==='aiterm.agent-steer.v1'?'agent_steer':'agent_dispatch',session_id:sid,launch_id:live.launch_id,event_cursor:receipt.event_cursor}};
        }catch(error){originalFailure=error.message;return {isError:true,content:[{type:'text',text:`aiterm: ${error.message}`}]} ;}
      });
    row.elapsed_ms=Math.round(performance.now()-started);await delay(100);
    const record=await service.execute({action:'status',request});
    const received=fs.existsSync(ledger)?Buffer.from(fs.readFileSync(ledger,'utf8'),'hex').toString('utf8'):'';
    const traceRows=fs.readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
    row={...row,isError:result.isError===true,receipt_mode:result.structuredContent?.mode??null,execution_error:result._meta?.['aiterm/execution_error']??null,
      original_failure:originalFailure,operations:record.operations,phase:record.relation.phase,lifecycle:record.relation.lifecycle,target:record.relation.target,
      slots:store.snapshot().slots.length,input_bytes:Buffer.byteLength(received),marker_count:received.split(`SYNTHETIC_${mode.toUpperCase()}_MARKER`).length-1,
      capture_samples:JSON.parse(fs.readFileSync(control,'utf8')).samples,trace:traceRows,synthetic_turn_after:codexRunningTurn(meta)};
    if(mode==='stop'||mode==='uncertain'||mode==='replace-source'||mode==='replace-target'){
      assert.equal(row.isError,true);assert.equal(row.marker_count,0);assert.equal(row.operations.send,'not_sent');
      assert.equal(row.execution_error.effect,'not_started');
      assert.equal(row.slots,mode==='uncertain'?1:0,'unrelated uncertain slot is retained');
      const expected=mode==='stop'?'EXECUTION_STOPPING':mode==='uncertain'?'EXECUTION_UNCONFIRMED':'EXECUTION_STALE_GENERATION';
      assert.equal(row.execution_error.code,expected);
    } else if(mode==='dies-after-paste') {
      assert.equal(row.isError,true);assert.equal(row.marker_count,1);assert.equal(row.execution_error.effect,'possible');
      assert.equal(row.operations.send,'unknown');assert.equal(row.slots,1);
      assert.doesNotMatch(row.original_failure,/文字列は送信していません/);
      assert.equal(traceRows.filter(x=>x.event==='native'&&x.command==='send-keys').length,0,'no Enter reaches the shell after harness exit');
    } else if(mode==='modal') {
      assert.equal(row.isError,true);assert.equal(row.marker_count,0);assert.equal(row.execution_error.effect,'not_started');
      assert.match(row.original_failure,/state=blocked reason=command_approval/);
    } else if(mode==='busy'||mode==='race'){
      assert.equal(row.receipt_mode,'agent_steer');assert.equal(row.marker_count,1);assert.equal(row.execution_error,null);
      assert.equal(row.operations.send,'accepted');assert.equal(row.slots,0);
      assert(row.elapsed_ms<10000,'ordinary busy input does not wait for the 30-second readiness deadline');
    } else if(mode==='startup') {
      assert.equal(row.receipt_mode,'agent_dispatch');assert.equal(row.marker_count,1);
      assert.equal(row.operations.send,'accepted');assert(row.capture_samples>=4,'startup samples do not count as idle readiness');
    } else {
      assert.equal(row.isError,true);assert.match(row.original_failure,/reason=harness_exited/);
      assert.equal(row.marker_count,0);assert.deepEqual(row.execution_error,{schema:'aiterm.execution-error.v1',code:'EXECUTION_UNCONFIRMED',effect:'not_started',follow_up:'status_only'});
      assert.equal(row.operations.send,'not_sent');assert.equal(row.slots,0);assert(row.elapsed_ms<5000,'a known exited harness is rejected before the readiness deadline');
    }
    if(mode==='race'){
      assert.equal(row.synthetic_turn_before,row.synthetic_turn_after);
      assert.deepEqual(traceRows.filter(x=>x.event==='screen').slice(0,3).map(x=>x.state),['idle','idle','busy']);
    }
    if(mode==='race'||mode==='dies-after-paste'){
      let replayCalled=false;
      const again=await dispatcher.dispatch('pty_send',{session_id:sid,text:'NO_REPLAY',require_agent:true},{_meta:{'aiterm/execution':{schema:'aiterm.execution-ref.v1',request}}},()=>{replayCalled=true;throw new Error('unexpected replay');});
      assert.equal(again.isError,true);
      assert.equal(replayCalled,false,'issued request cannot reenter the native handler');
    }
    return row;
  } finally {fs.rmSync(control,{force:true});core.closeSession(sid);}
}
for(const [mode,label] of [['race','pending Codex input selects steer when busy returns during readiness'],['busy','initial busy input remains a single steer'],['dead','known exited harness refuses before waiting and never receives input'],['startup','a starting live harness still waits for idle readiness']]) {
  test(label,{skip:posix},async t=>{const r=await scenario(mode);t.diagnostic(JSON.stringify({mode,elapsed_ms:r.elapsed_ms,receipt:r.receipt_mode,marker_count:r.marker_count,error:r.execution_error}));});
}
for(const mode of ['stop','uncertain','replace-source','replace-target','modal','dies-during-wait','dies-after-paste']) {
  test(`pending input boundary: ${mode}`,async()=>{await scenario(mode);});
}
}
