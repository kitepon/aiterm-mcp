import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {codexGoalUiState,editCodexGoalObjective,submitCodexGoalCommand} from '../dist/harnesses/codex-goal-editor.js';
import {AgentGoalNotIssuedError} from '../dist/agent-goal.js';
const screens=JSON.parse(fs.readFileSync(new URL('./fixtures/codex-goal-screens.json',import.meta.url),'utf8'));
const goal={threadId:'native-thread',objective:'Artificial first line\nArtificial second line',status:'paused',tokenBudget:100,tokensUsed:7,timeUsedSeconds:2,createdAt:1,updatedAt:2};
const editor=text=>`  \x1b[1mEdit goal\x1b[0m\n\n\x1b[38;5;75m›\x1b[39m ${text.replaceAll('\n','\n  ')}\n\n  \x1b[1menter\x1b[0;2m submit · \x1b[0;1mesc\x1b[0;2m back\x1b[0m\n`;
const main=text=>screens.mainEmpty.replace('\x1b[2mAsk Codex to do anything\x1b[0m',text);
function ui({draft=false,deletes=true,cancels=true}={}){
 let frame=draft?screens.mainUserDraft:screens.mainEmpty,clock=0;const events=[];let submitted=0;
 return {events,get submitted(){return submitted;},read:()=>frame,now:()=>clock,pause:async ms=>{clock+=ms;},
 async paste(text){events.push(['paste',text]);frame=codexGoalUiState(frame).kind==='editor'?editor(text):main(text);},
 async keys(keys){events.push(['keys',keys]);if(keys[0]==='Enter'){
   if(codexGoalUiState(frame).kind==='editor'){submitted++;frame=screens.mainEmpty;}else frame=screens.editorOriginal;
  }else if(keys.every(k=>k==='BSpace')&&deletes)frame=screens.editorEmpty;
  else if(keys[0]==='Escape'&&cancels)frame=screens.mainEmpty;
 }};
}
test('recorded native styles distinguish placeholders, literal draft and editor body',()=>{
 assert.equal(codexGoalUiState(screens.mainEmpty).empty,true);
 assert.equal(codexGoalUiState(screens.mainUserDraft).empty,false);
 assert.deepEqual(codexGoalUiState(screens.editorOriginal),{kind:'editor',empty:false,text:goal.objective});
 assert.equal(codexGoalUiState(screens.editorEmpty).empty,true);
 assert.deepEqual(codexGoalUiState(screens.editorReserved),{kind:'editor',empty:false,text:'pause'});
 assert.equal(codexGoalUiState(main('Ask Codex to do anything')).empty,false);
 assert.equal(codexGoalUiState(editor('Type a goal objective and press Enter')).empty,false);
});
test('editor sends literal reserved/unicode multiline once after native empty confirmation',async()=>{
 for(const objective of ['pause','人工の目的 🧪\n二行目の edit と clear']){
  const port=ui();await editCodexGoalObjective(port,goal,objective);
  assert.equal(port.submitted,1);assert.deepEqual(port.events.filter(e=>e[0]==='paste').map(e=>e[1]),['/goal edit',objective]);
 }
});
test('existing draft is preserved without any goal command or key',async()=>{
 const port=ui({draft:true});await assert.rejects(submitCodexGoalCommand(port,'clear'),e=>e instanceof AgentGoalNotIssuedError);
 assert.equal(port.events.length,0);assert.equal(port.submitted,0);
});
test('failed native deletion cancels only its editor and never submits objective',async()=>{
 const port=ui({deletes:false});await assert.rejects(editCodexGoalObjective(port,goal,'Changed'),e=>e instanceof AgentGoalNotIssuedError);
 assert.equal(port.submitted,0);assert.equal(codexGoalUiState(port.read()).kind,'composer');
 assert.deepEqual(port.events.filter(e=>e[0]==='paste').map(e=>e[1]),['/goal edit']);
});
test('unconfirmed cancel stays unknown, without another editor or command attempt',async()=>{
 const port=ui({deletes:false,cancels:false});await assert.rejects(editCodexGoalObjective(port,goal,'Changed'),e=>!(e instanceof AgentGoalNotIssuedError));
 assert.equal(port.submitted,0);assert.equal(port.events.filter(e=>e[0]==='paste').length,1);
});
test('native file objectives and terminal control text refuse before input',async()=>{
 for(const [before,objective] of [[{...goal,objective:'Read the Codex goal objective file at /native/file before continuing.'},'Changed'],[goal,'bad\x1btext']]){
  const port=ui();await assert.rejects(editCodexGoalObjective(port,before,objective),e=>e instanceof AgentGoalNotIssuedError);
  assert.equal(port.events.length,0);
 }
});
