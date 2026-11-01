import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {codexSettingsPreview,codexPreviewMatchesSettings,inspectIdleSettings} from '../dist/harnesses/idle-settings.js';
const expected={model:'gpt-6.1-sol',reasoning_effort:'high',fast:false};
function codexUi(settings=expected){
 let menu=false,query='',selected;const keys=[],commands=[];
 const reset=()=>selected={'model-with-reasoning':true,'current-dir':true,'thread-name':true,'fast-mode':false};reset();
 const screen=()=>{
  if(!menu)return 'OpenAI Codex\n› Ask Codex to do anything\nGPT-6.1-Sol high · /project';
  const model=settings.model+' '+settings.reasoning_effort+(settings.fast?' Fast':'');
  const preview=[selected['model-with-reasoning']?model:null,selected['current-dir']?'/project':null,selected['thread-name']?'thread name':null,selected['fast-mode']?(settings.fast?'Fast':'Standard'):null].filter(Boolean).join(' · ');
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
test('Codex native preview reads model, effort and explicit speed, then cancels without a save',async()=>{
 const ui=codexUi();assert.equal(await inspectIdleSettings('codex',expected,ui),true);
 assert.deepEqual(ui.commands,['/statusline']);assert.equal(ui.keys.at(-1),'Escape');assert.equal(await ui.ready(),true);
});
for(const changes of [{model:'different-model'},{reasoning_effort:'low'},{fast:true}])test('Codex native settings mismatch '+JSON.stringify(changes),async()=>{
 const ui=codexUi({...expected,...changes});assert.equal(await inspectIdleSettings('codex',expected,ui),false);
 assert.equal(ui.keys.at(-1),'Escape');assert.equal(await ui.ready(),true);
});
test('Codex current Fast is also read explicitly',async()=>{
 const wanted={...expected,fast:true},ui=codexUi(wanted);assert.equal(await inspectIdleSettings('codex',wanted,ui),true);
});
test('old notices, absent tier, clipped or ambiguous preview and inconsistent values are unknown',()=>{
 for(const preview of ['gpt-6.1-sol high','gpt-6.1-sol high · /project','Service tier set to default','gpt-6.1-sol high · Standard · branch','gpt-6.1-sol high Fast · Standard','gpt-6.1-sol high · Fast','gpt-6.1-sol hi… · Standard'])assert.equal(codexPreviewMatchesSettings(preview,expected),false,preview);
 assert.equal(codexSettingsPreview('Configure Status Line\n› [x] fast-mode  Speed\nStandard'),null);
});
function claudeUi({effort='high',model='Sonnet 5',cursor=true,fastUnknown=false}={}){
 let view='idle';const keys=[],commands=[];
 return {keys,commands,
  screen(){if(view==='idle')return 'Claude Code\n❯';if(view==='model')return 'Select model\n'+(cursor?'❯ ':'  ')+'1. '+model+' ✔\n● '+effort+' effort\nEnter to set as default · s to use this session only · Esc to cancel';return '↯ Fast mode\n'+(fastUnknown?'Unavailable layout changed':'Fast mode requires usage credits · /usage-credits to turn them on')+'\nEsc to cancel';},
  async command(text){commands.push(text);assert(['/model','/fast'].includes(text));view=text.slice(1);},
  text(){throw new Error('no text input inside Claude menus');},
  key(key){keys.push(key);assert.equal(key,'Escape');view='idle';},
  async ready(){return view==='idle';},
 };
}
const claude={model:'claude-sonnet-5',reasoning_effort:'high',fast:false};
test('Claude reads the current checked model and effort and explicit unavailable fast state',async()=>{
 const ui=claudeUi();assert.equal(await inspectIdleSettings('claude',claude,ui),true);
 assert.deepEqual(ui.commands,['/model','/fast']);assert.deepEqual(ui.keys,['Escape','Escape']);
});
for(const options of [{model:'Opus 5.5'},{effort:'low'},{cursor:false},{fastUnknown:true}])test('Claude refuses mismatched or unconfirmed native menus '+JSON.stringify(options),async()=>{
 const ui=claudeUi(options);assert.equal(await inspectIdleSettings('claude',claude,ui),false);assert.equal(await ui.ready(),true);
});
test('unconfirmed recipe or harness does not open any native menu',async()=>{
 const ui=codexUi();assert.equal(await inspectIdleSettings('codex',{...expected,model:null},ui),false);
 assert.equal(await inspectIdleSettings('grok',expected,ui),false);assert.deepEqual(ui.commands,[]);
});

test('an old settings menu above the current composer is not an active menu',async()=>{
 const ui=codexUi();await ui.command('/statusline');
 assert.equal(codexSettingsPreview(ui.screen()+'\n› Ask Codex to do anything'),null);
});

test('Claude aliases and dated models without an exact native identity open no menus',async()=>{
 for(const model of ['default','sonnet','claude-sonnet-5-20261001']){
  const ui=claudeUi();assert.equal(await inspectIdleSettings('claude',{...claude,model},ui),false);assert.deepEqual(ui.commands,[]);assert.deepEqual(ui.keys,[]);
 }
});
