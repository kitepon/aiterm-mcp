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
 assert.equal(parentPaneEvidence('claude',['Claude Code','● prior result',rule,'❯ ',rule,'  bypass permissions'].join('\n')),'unknown','A plain composer is also present during a quiet unfinished wait');
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
