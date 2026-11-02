import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCodexResumeSettings} from '../dist/harnesses/idle-settings.js';
const expected={model:'gpt-6.1-sol',reasoning_effort:'high',fast:false};
const vendor='11111111-2222-4333-8444-555555555555';
function codexUi(settings=expected,thread=vendor){
 let menu=false,query='',selected;const keys=[],commands=[];
 const reset=()=>selected={'model-with-reasoning':true,'current-dir':true,'thread-name':true,'fast-mode':false,'thread-id':false};reset();
 const screen=()=>{
  if(!menu)return 'OpenAI Codex\n› Ask Codex to do anything\nGPT-6.1-Sol high · /project';
  const model=settings.model+' '+settings.reasoning_effort+(settings.fast?' Fast':'');
  const preview=[selected['model-with-reasoning']?model:null,selected['current-dir']?'/project':null,selected['thread-name']?'thread name':null,selected['fast-mode']?(settings.fast?'Fast':'Standard'):null,selected['thread-id']?thread:null].filter(Boolean).join(' · ');
  return 'Configure Status Line\nSelect which items to display in the status line.\n\n'+(query||'Type to search')+'\n\n'+Object.entries(selected).filter(([id])=>!query||id.includes(query)).map(([id,on],i)=>(i===0?'› ':'  ')+'['+(on?'x':' ')+'] '+id+'  Current setting').join('\n')+'\n\n'+preview+'\nspace toggle · ←/→ reorder · enter save · esc cancel';
 };
 return {keys,commands,screen,
  async command(text){commands.push(text);assert.equal(text,'/statusline');menu=true;query='';reset();},
  text(text){query+=text;},
  key(...choices){for(const key of choices){keys.push(key);assert.notEqual(key,'Enter','no preview is saved');
   if(key==='BSpace')query=query.slice(0,-1);else if(key==='Space')selected[query]=!selected[query];else if(key==='Escape')menu=false;else throw new Error('unexpected key');}},
  async ready(){return !menu;},
  original(){return selected;},
 };
}

test('fresh native thread and settings are available before any task event, without saving the menu',async()=>{
 const ui=codexUi();assert.deepEqual(await inspectCodexResumeSettings(vendor,ui),expected);
 assert.deepEqual(ui.commands,['/statusline']);assert.equal(ui.keys.at(-1),'Escape');assert.equal(await ui.ready(),true);
});
for(const thread of ['11111111-2222-4333-8444-666666666666',null,'11111111-2222-4333-8444-555555555…'])test('different or incomplete current thread is not accepted: '+thread,async()=>{
 const ui=codexUi(expected,thread);assert.equal(await inspectCodexResumeSettings(vendor,ui),null);assert.equal(await ui.ready(),true);assert(!ui.keys.includes('Enter'));
});
test('reads mismatched settings so caller can restore them only after the thread matches',async()=>{
 const settings={model:'other-model',reasoning_effort:'low',fast:true},ui=codexUi(settings);
 assert.deepEqual(await inspectCodexResumeSettings(vendor,ui),settings);
});
test('legacy native session-id item is supported',async()=>{
 const ui=codexUi(),screen=ui.screen,text=ui.text;
 ui.screen=()=>screen().replaceAll('thread-id','session-id');ui.text=value=>text(value==='session-id'?'thread-id':value);
 assert.deepEqual(await inspectCodexResumeSettings(vendor,ui),expected);
});
test('invalid requested identity never issues a command',async()=>{
 const ui=codexUi();assert.equal(await inspectCodexResumeSettings('not-a-uuid',ui),null);assert.deepEqual(ui.commands,[]);
});
test('stale preview below a current composer is rejected and never saved',async()=>{
 const ui=codexUi(),screen=ui.screen;ui.screen=()=>screen()+'\n› new draft';
 assert.equal(await inspectCodexResumeSettings(vendor,ui),null);assert(!ui.keys.includes('Enter'));
});

test('an existing native menu is not treated as a fresh response or closed',async()=>{
 const ui=codexUi();await ui.command('/statusline');
 assert.equal(await inspectCodexResumeSettings(vendor,ui),null);assert.deepEqual(ui.commands,['/statusline']);assert.deepEqual(ui.keys,[]);
});
test('a preview is not returned when the composer fails to return after cancel',async()=>{
 const ui=codexUi();ui.ready=async()=>false;
 assert.equal(await inspectCodexResumeSettings(vendor,ui),null);assert.equal(ui.keys.at(-1),'Escape');
});
test('extra or duplicate thread identity in the current preview remains unknown',async()=>{
 const ui=codexUi(),screen=ui.screen;ui.screen=()=>screen().replace(vendor,vendor+' · '+vendor);
 assert.equal(await inspectCodexResumeSettings(vendor,ui),null);assert.equal(await ui.ready(),true);
});
