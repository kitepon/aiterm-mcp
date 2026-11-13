import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {observeManagedSpan} from '../dist/managed-seat-turn.js';
import {parentPaneEvidence} from '../dist/agent-screen-observation.js';

const rule='────────────────', uuid='11111111-2222-4333-8444-555555555555';
const frames={
 claude:{busy:['Claude Code','✻ Musing… (esc to interrupt)',rule,'❯ ',rule,'  bypass permissions'].join('\n'),
  ready:['Claude Code','✻ Cogitated for 11s · done 4:45 AM',rule,'❯ ',rule,'  bypass permissions'].join('\n')},
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
 // Antigravity 1.5.8 holds the turn while a background task runs (Stop only after the task ends and the model reports it).
 const agyTask=['● Running (sleep 240) (ctrl+o to expand)','','  started','',rule,'>',rule,'  ● [20:08:47] sleep 240 running',rule,'? for shortcuts            auto · Gemini 3.8 Flash · medium · 1 task(s) · /tasks'].join('\n');
 assert.equal(parentPaneEvidence('antigravity',agyTask),'busy');
 assert.equal(parentPaneEvidence('antigravity',agyTask.replace('  ● [20:08:47] sleep 240 running\n'+rule+'\n','').replace(' · 1 task(s) · /tasks','')),'ready','the task ended: no footer count');
 assert.equal(parentPaneEvidence('antigravity','  quoted · 2 task(s) · /tasks\n'+frames.antigravity.ready),'ready','a count above the composer is not the footer');
 assert.equal(parentPaneEvidence('claude',['Claude Code','● prior result',rule,'❯ ',rule,'  bypass permissions'].join('\n')),'ready_no_completion','A plain composer is also present during a quiet unfinished wait');
 assert.equal(parentPaneEvidence('grok','Connection failed\n'+frames.grok.ready),'unknown');
 for(const typed of ['/model','/effort ultracode','/fast on'])assert.equal(parentPaneEvidence('claude',['⏺ prior result','','✻ Worked for 9s','',`❯ ${typed}`,'  ⎿  Set model to Opus 5.5 for this session only with high effort','',rule,'❯ ',rule,'  bypass permissions'].join('\n')),'ready',typed+': a configure result line ends that local command');
 assert.equal(parentPaneEvidence('claude',['❯ /review','',rule,'❯ ',rule,'  bypass permissions'].join('\n')),'ready_no_completion','Any other command without its result stays a quiet wait');
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

test('a self-started span reads its words from the same binding\'s last settled idle position, never another binding\'s',()=>{
 const file=path.join(directory(),'span.json');let pos='v1:3:b:100';const p=()=>pos;
 assert.equal(observeManagedSpan(file,'seat','ready',null,at(0),p),null);
 assert.deepEqual(observeManagedSpan(file,'seat','ready',null,at(300),p),{state:'idle'});
 pos='v1:3:b:180';assert.deepEqual(observeManagedSpan(file,'seat','ready',null,at(600),p),{state:'idle'},'idle writes are tracked');
 pos='v1:3:b:999';const run=observeManagedSpan(file,'seat','busy',null,at(900),p);
 assert.equal(run.interim_from,'v1:3:b:180','start = position seen at the last settled idle, not at the late busy poll');
 assert.deepEqual(observeManagedSpan(file,'seat','busy',null,at(1200),p),run);
 assert.equal(observeManagedSpan(file,'other','busy',null,at(1500),p).interim_from,null,'a new binding never borrows a position');
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

test('fresh launch with no busy and no terminal settles ready to idle; a seen terminal or span still needs a positive one',()=>{
 const file=path.join(directory(),'span.json');
 assert.equal(observeManagedSpan(file,'fresh','ready',null,at(0)),null,'First ready is not idle');
 assert.equal(observeManagedSpan(file,'fresh','ready',null,at(100)),null,'250 ms settle');
 assert.deepEqual(observeManagedSpan(file,'fresh','ready',null,at(300)),{state:'idle'});
 const first=observeManagedSpan(file,'fresh','busy',null,at(400));
 assert.equal(first.state,'running');
 assert.equal(observeManagedSpan(file,'fresh','ready',null,at(500)),null);
 assert.equal(observeManagedSpan(file,'fresh','ready',null,at(900)),null,'Span without terminal stays unavailable');
 observeManagedSpan(file,'fresh','ready','done',at(1000));
 assert.deepEqual(observeManagedSpan(file,'fresh','ready','done',at(1300)),{state:'idle'});
 assert.equal(observeManagedSpan(file,'fresh','ready',null,at(1400)),null);
 assert.equal(observeManagedSpan(file,'fresh','ready',null,at(1700)),null,'A terminal once seen cannot be replaced by an unreadable one');
});

test('Claude ready_no_completion settles only a binding that never saw a span or terminal',()=>{
 const file=path.join(directory(),'span.json');
 assert.equal(observeManagedSpan(file,'fresh','ready_no_completion',null,at(0)),null,'First ready is not idle');
 assert.deepEqual(observeManagedSpan(file,'fresh','ready_no_completion',null,at(300)),{state:'idle'});
 assert.equal(observeManagedSpan(path.join(directory(),'span.json'),'fresh','ready_no_completion','late',at(0)),null,'A current terminal needs a completed-progress line');
 observeManagedSpan(file,'fresh','busy',null,at(400));
 assert.equal(observeManagedSpan(file,'fresh','ready_no_completion','done',at(500)),null);
 assert.equal(observeManagedSpan(file,'fresh','ready_no_completion','done',at(900)),null,'Quiet wait after work stays unavailable');
 observeManagedSpan(file,'fresh','ready','done',at(1000));
 assert.deepEqual(observeManagedSpan(file,'fresh','ready','done',at(1300)),{state:'idle'});
 assert.equal(observeManagedSpan(file,'fresh','ready_no_completion','done',at(1400)),null);
 assert.equal(observeManagedSpan(file,'fresh','ready_no_completion','done',at(1700)),null,'A recorded terminal keeps the completion-line requirement');
});

test('Claude idle compaction: its spinner opens a span and its notice settles it without a Stop (Rapi, 0.70.9)',()=>{
 const compacting=['Claude Code','✻ Cooked for 2m 32s · done 12:32 AM','','✢ Compacting conversation… (51s · ↓ 2.1k tokens)',rule,'❯ ',rule,'  bypass permissions'].join('\n');
 const compacted=['Claude Code','✻ Cooked for 2m 32s · done 12:32 AM','  ⎿  Referenced file ../x/TerminalsView.swift','',
  '⏺ Compacted while idle, before the prompt cache expired · turn off with','  "idleCompaction": false in settings.json','',rule,'❯ ',rule,'  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 3 agents'].join('\n');
 assert.equal(parentPaneEvidence('claude',compacting),'busy');
 assert.equal(parentPaneEvidence('claude',compacted),'ready_compacted');
 assert.equal(parentPaneEvidence('claude',[compacted.replace(/\n─[\s\S]*$/,''),'❯ next question','⏺ answer','',rule,'❯ ',rule,'  bypass'].join('\n')),'ready_no_completion','a later block above the composer is not the compaction');
 const file=path.join(directory(),'span.json');
 assert.equal(observeManagedSpan(file,'b','ready','stop-1',at(0)),null);
 assert.deepEqual(observeManagedSpan(file,'b','ready','stop-1',at(300)),{state:'idle'});
 assert.equal(observeManagedSpan(file,'b','busy','stop-1',at(400)).state,'running','the compaction spinner');
 assert.equal(observeManagedSpan(file,'b','ready_no_completion','stop-1',at(500)),null,'before the fix the span stayed here');
 assert.equal(observeManagedSpan(file,'b','ready_compacted','stop-1',at(600)),null,'first ready is not idle');
 assert.deepEqual(observeManagedSpan(file,'b','ready_compacted','stop-1',at(900)),{state:'idle'});
 assert.equal(observeManagedSpan(file,'b','busy','stop-1',at(1000)).state,'running','the next real turn');
 assert.equal(observeManagedSpan(file,'b','ready','stop-1',at(1300)),null,'a real turn still needs its own Stop');
});
