import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {observeManagedSpan,withManagedSpan,managedSpanDirectory} from '../dist/managed-seat-turn.js';
import {parentPaneEvidence} from '../dist/agent-screen-observation.js';
import {agentEventPath,writeAgentMetadata} from '../dist/agent-shared.js';
import {agentManagedClaudeSettingsPath,agentClaudeResultPath} from '../dist/harnesses/claude.js';
import {cursorTranscriptForSession} from '../dist/harnesses/cursor.js';
import {antigravityBindingFile} from '../dist/harnesses/antigravity.js';

const rule='────────────────', uuid='11111111-2222-4333-8444-555555555555';
const frames={
 claude:{busy:['Claude Code','✻ Musing… (esc to interrupt)',rule,'❯ ',rule,'  bypass permissions'].join('\n'),
  ready:['Claude Code','● finished',rule,'❯ ',rule,'  bypass permissions'].join('\n')},
 grok:{busy:'Waiting for response… 12s [stop]\n│ >                      │\n╰──────── Grok 4.6 (medium) · always-approve ─╯',
  ready:'╭────────────────────────╮\n│ >                      │\n╰──────── Grok 4.6 (medium) · always-approve ─╯'},
 cursor:{busy:'Cursor Agent\n⠋ Working\n→ \nctrl+c to stop\n',ready:'Cursor Agent\n→ Add a follow-up\n'},
 antigravity:{busy:'⣯ Working...\n>\nesc to cancel',ready:'finished\n>\n? for shortcuts'}
};
const at=ms=>new Date(1800000000000+ms).toISOString();
const directory=()=>fs.mkdtempSync(path.join(process.env.HOME,'managed-span-'));

test('four existing native frame routes exclude quoted old hints, preprompt hooks and acceptance queues',()=>{
 for(const [kind,frame] of Object.entries(frames)){
  assert.equal(parentPaneEvidence(kind,frame.busy),'busy',kind);
  assert.equal(parentPaneEvidence(kind,frame.ready),'ready',kind);
  assert.equal(parentPaneEvidence(kind,'quoted ctrl+c to stop / Working... / esc to interrupt\n'+frame.ready),'ready',kind);
 }
 assert.equal(parentPaneEvidence('grok',frames.grok.busy.replace('Waiting for response… 12s','Waiting for the agent to accept the prompt…')),'unknown');
 assert.equal(parentPaneEvidence('cursor','Cursor Agent\n⠋ Working\n→ Plan, search, build anything\n'),'unknown');
 assert.equal(parentPaneEvidence('claude',frames.claude.busy.replace('Musing… (esc to interrupt)','Musing… (running UserPromptSubmit hook · 0s)')),'unknown');
 assert.equal(parentPaneEvidence('antigravity','Terms of Service\n> Allow'),'unknown');
 assert.equal(parentPaneEvidence('grok','Connection failed\n'+frames.grok.ready),'unknown');
});

test('fresh unchanged 12min parent wait retains first observed ID/start without heartbeat; busy wins over completion',()=>{
 const file=path.join(directory(),'span.json');
 const first=observeManagedSpan(file,'binding','busy','old-terminal',at(0));
 assert.deepEqual(Object.keys(first).sort(),['state','turn_id','started_at','event_cursor','interim_from','wait_process'].sort());
 assert.deepEqual([first.event_cursor,first.interim_from,first.wait_process],[null,null,null]);
 const bytes=fs.readFileSync(file,'utf8'),stat=fs.statSync(file);
 assert.deepEqual(observeManagedSpan(file,'binding','busy','late-or-child-terminal',at(720000)),first);
 assert.equal(fs.readFileSync(file,'utf8'),bytes);assert.equal(fs.statSync(file).mtimeMs,stat.mtimeMs);
 assert.equal(observeManagedSpan(file,'binding','unknown','late-or-child-terminal',at(721000)),null);
 assert.deepEqual(observeManagedSpan(file,'binding','busy',null,at(722000)),first);
 assert.equal(first.started_at,at(0));
});

test('positive root terminal needs settled readiness; continuation retains span and next actual work gets a new ID',()=>{
 const file=path.join(directory(),'span.json'),first=observeManagedSpan(file,'same','busy','old',at(0));
 assert.equal(observeManagedSpan(file,'same','ready','old',at(100)),null,'Old terminal cannot finish this parent');
 assert.equal(observeManagedSpan(file,'same','ready','new',at(200)),null,'First ready is not terminal');
 assert.deepEqual(observeManagedSpan(file,'same','busy','new',at(300)),first,'Stop veto or followup is same parent');
 assert.equal(observeManagedSpan(file,'same','ready','new',at(400)),null);
 assert.deepEqual(observeManagedSpan(file,'same','ready','new',at(700)),{state:'idle'});
 const next=observeManagedSpan(file,'same','busy','new',at(800));
 assert.notEqual(next.turn_id,first.turn_id);assert.equal(next.started_at,at(800));
});

test('restart uses saved identity only with new live evidence; corrupt identity and changed native generation never borrow it',()=>{
 const file=path.join(directory(),'span.json'),first=observeManagedSpan(file,'original','busy',null,at(0));
 assert.deepEqual(observeManagedSpan(file,'original','busy',null,at(1000)),first);
 assert.equal(observeManagedSpan(file,'original','ready',null,at(2000)),null,'No terminal is unavailable, not idle');
 const replacement=observeManagedSpan(file,'replacement','busy',null,at(3000));
 assert.notEqual(replacement.turn_id,first.turn_id);
 fs.writeFileSync(file,'{');assert.equal(observeManagedSpan(file,'replacement','busy',null,at(4000)),null);
 assert.equal(observeManagedSpan(file,'replacement','ready','positive',at(5000)),null);
 assert.deepEqual(observeManagedSpan(file,'replacement','ready','positive',at(5300)),{state:'idle'});
});

test('real metadata producer projects four original rows from mocked live native reads; no CLI or pane is launched',
 {skip:process.platform!=='linux'?'Linux native-table fixture only':false},async t=>{
 const tmux=path.join(process.env.HOME,'tmux-fixture');fs.writeFileSync(tmux,'',{mode:0o700});process.env.AITERM_TMUX=tmux;
 const metas={},screens={},terminals={},dead=new Set();let activeKind='claude',born='Sat Nov 7 06:00:00 2026',replaced=false,replaceAtCapture=false,clock=1800000000000,elapsed=0,readCost=0;
 const performanceDescriptor=Object.getOwnPropertyDescriptor(global,'performance');
 Object.defineProperty(global,'performance',{configurable:true,value:{now:()=>elapsed}});
 t.after(()=>Object.defineProperty(global,'performance',performanceDescriptor));
 const NativeDate=Date;global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
 t.after(()=>{global.Date=NativeDate;});
 for(const kind of Object.keys(frames)){
  const name='span_'+kind,launch='abcd'.repeat(8),home=path.join(process.env.HOME,kind);
  const meta={kind,aiterm_session:name,launch_id:launch,event_file:agentEventPath(name,launch),created_at:new Date().toISOString(),cwd:process.env.HOME,
   vendor_session_id:uuid,initial_prompt:'none',node_platform:process.platform,agent_executable:'native-'+kind,
   agent_role:'subagent',parent_session_id:'fixture_parent',delegation_depth:1,lineage:'host-root>codex:fixture_parent',delegation_allowed:true,
   hook_route:'shared_'+kind+'_home',[kind+'_home']:home};
  if(kind==='claude')Object.assign(meta,{hook_route:'shared_claude_settings',claude_settings:agentManagedClaudeSettingsPath(name,launch),result_file:agentClaudeResultPath(name,launch)});
  if(kind==='cursor'||kind==='grok')meta.completion_route=kind+'_transcript';
  if(kind==='grok'){fs.mkdirSync(home,{recursive:true});meta.grok_auth_path=path.join(home,'auth.json');fs.writeFileSync(meta.grok_auth_path,'{}');}
  writeAgentMetadata(meta);metas[kind]=meta;screens[kind]=frames[kind].busy;
  if(kind==='cursor'){
   const transcript=cursorTranscriptForSession(meta,uuid);fs.mkdirSync(path.dirname(transcript),{recursive:true});fs.writeFileSync(transcript,JSON.stringify({role:'user',content:'actual root input'})+'\n');
   terminals[kind]=()=>fs.appendFileSync(transcript,JSON.stringify({type:'turn_ended',status:'success'})+'\n');
  }else if(kind==='grok'){
   const transcript=path.join(home,'sessions',encodeURIComponent(fs.realpathSync(meta.cwd)),uuid,'events.jsonl');fs.mkdirSync(path.dirname(transcript),{recursive:true});fs.writeFileSync(transcript,JSON.stringify({type:'turn_started',ts:'native-start'})+'\n');
   terminals[kind]=()=>fs.appendFileSync(transcript,JSON.stringify({type:'turn_ended',outcome:'completed',ts:'native-end'})+'\n');
  }else{
   if(kind==='antigravity'){
    const transcript=path.join(home,'brain',uuid,'.system_generated','transcript.json');fs.mkdirSync(path.dirname(transcript),{recursive:true});fs.writeFileSync(transcript,'[]');
    fs.writeFileSync(antigravityBindingFile(meta),JSON.stringify({conversation_id:uuid,transcript}));
   }
   terminals[kind]=()=>fs.appendFileSync(meta.event_file,JSON.stringify({type:'agent_done',vendor:kind,aiterm_session:name,launch_id:launch,vendor_session_id:uuid,
    turn_id:kind==='claude'?null:'1-0',operation_id:null,reason:'native root terminal',done_status:'turn_done',result_digest:'a'.repeat(64),result_bytes:0,at:new Date().toISOString()})+'\n');
  }
 }
 const oldSpawn=childProcess.spawnSync,oldKill=process.kill,calls=[];
 const result=stdout=>({status:0,signal:null,stdout,stderr:'',pid:0,output:[null,stdout,'']});
 childProcess.spawnSync=(bin,args)=>{
  calls.push([bin,args]);
  if(bin===tmux){
   if(args.includes('-V'))return result('tmux 3.5\n');
   if(args.includes('list-sessions'))return result(Object.values(metas).map(m=>args.at(-1).includes('#{pane_current_command}')
    ?`${m.aiterm_session}\t${m.kind}\t0\t80\t24`:`$1\t${m.aiterm_session}`).join('\n')+'\n');
   const target=args[args.indexOf('-t')+1];activeKind=Object.keys(metas).find(k=>metas[k].aiterm_session===target)??activeKind;
   if(args.includes('display-message'))return result('222\t0\n');
   if(args.includes('capture-pane')){assert.equal(args.slice(args.indexOf('capture-pane')).includes('-S'),false,'No scrollback');if(replaceAtCapture)replaced=true;elapsed+=readCost;return result(screens[activeKind]);}
  }
  if(args.includes('pid=,lstart=')){
   const ids=args.at(-1).split(',').map(Number);return result(ids.filter(id=>id!==2147483000).map(id=>`${id} ${born}`).join('\n')+'\n');
  }
  if(args.includes('pid=,ppid=,pgid=,stat=,lstart=,time=,command='))return result(
   `222 1 222 S ${born} 00:00:00 bash\n`+(dead.has(activeKind)?'':`333 222 333 S ${replaced?'Sat Nov 7 06:00:01 2026':born} 00:00:00 native-${activeKind} ${metas[activeKind].launch_id}\n`));
  throw Error('Unexpected subprocess: '+JSON.stringify([bin,args]));
 };
 process.kill=(pid,signal)=>{if(pid===2147483000&&signal===0)throw Object.assign(Error('gone'),{code:'ESRCH'});return oldKill(pid,signal);};
 syncBuiltinESMExports();t.after(()=>{childProcess.spawnSync=oldSpawn;process.kill=oldKill;syncBuiltinESMExports();});
 const core=await import('../dist/core.js');
 const row=kind=>core.readSeatTurns([metas[kind].aiterm_session]).seats[0];
 for(const kind of Object.keys(frames)){
  activeKind=kind;const first=row(kind);assert.equal(first.harness,{claude:'claude-code',grok:'grok-cli',cursor:'cursor-cli',antigravity:'antigravity-cli'}[kind]);
  assert.equal(first.turn?.state,'running',kind+' '+JSON.stringify(calls.at(-1)));
  assert.equal(first.turn.started_at,new Date().toISOString());
  const stateFile=path.join(managedSpanDirectory(metas[kind]),'span.json'),unchanged=fs.readFileSync(stateFile,'utf8');
  clock+=720000;assert.deepEqual(row(kind).turn,first.turn);assert.equal(fs.readFileSync(stateFile,'utf8'),unchanged);
  screens[kind]='No distinguishable parent occupancy';assert.equal(row(kind).turn,null,'Quiet ambiguous wait stays unavailable');
  screens[kind]=frames[kind].busy;assert.deepEqual(row(kind).turn,first.turn,'Fresh positive occupancy restores same captured span');
  if(kind==='claude'){
   fs.appendFileSync(metas[kind].event_file,JSON.stringify({type:'agent_done',vendor:kind,aiterm_session:metas[kind].aiterm_session,launch_id:metas[kind].launch_id,
    vendor_session_id:uuid,turn_id:null,operation_id:null,done_status:'turn_done',result_digest:'b'.repeat(64),result_bytes:0})+'\n');
   screens[kind]=frames[kind].ready;assert.equal(row(kind).turn,null);clock+=300;assert.equal(row(kind).turn,null,'No native event timestamp cannot become read-time terminal');
   screens[kind]=frames[kind].busy;assert.deepEqual(row(kind).turn,first.turn);
  }
  terminals[kind]();assert.deepEqual(row(kind).turn,first.turn,'Current busy wins over late terminal');
  screens[kind]=frames[kind].ready;assert.equal(row(kind).turn,null,'First ready is unavailable');clock+=300;
  assert.deepEqual(row(kind).turn,{state:'idle'},kind+' actual root terminal + settled ready');
  screens[kind]=frames[kind].busy;assert.notEqual(row(kind).turn.turn_id,first.turn.turn_id);
  dead.add(kind);assert.equal(row(kind).turn,null);dead.delete(kind);
 }
 activeKind='claude';replaceAtCapture=true;assert.equal(row('claude').turn,null,'Native birth changing during read is unavailable');
 replaceAtCapture=false;replaced=false;
 readCost=15000;assert.equal(row('claude').turn,null,'A read outside observation freshness is unavailable');
 readCost=6000;
 const batch=core.readSeatTurns(Object.values(metas).map(meta=>meta.aiterm_session));
 assert.equal(batch.seats[0].turn,null,'An early row cannot be restamped fresh after later slow reads');
 assert.equal(batch.seats.at(-1).turn.state,'running');readCost=0;
 const meta=metas.claude;
 const lockDir=path.join(managedSpanDirectory(meta),'lock');
 withManagedSpan(meta,()=>assert.equal(withManagedSpan(meta,()=>{throw Error('Concurrent writer');}),null));
 fs.mkdirSync(lockDir);fs.writeFileSync(path.join(lockDir,'owner.json'),JSON.stringify({pid:2147483000,started_identity:born,token:'dead'}));
 assert.equal(withManagedSpan(meta,()=>42),42,'Dead observer lock recovers by retained inode quarantine');
 assert.ok(fs.readdirSync(managedSpanDirectory(meta)).some(name=>name.startsWith('retired-')));
 assert.ok(calls.every(([bin])=>bin===tmux||bin==='/bin/ps'));
});
