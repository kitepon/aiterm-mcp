import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {configureCodexModel} from '../dist/harnesses/codex-configure.js';
import {keepingUserDefaults} from '../dist/user-config.js';

const modelScreen='Select Model and Effort\n› 1. GPT-6.1-Sol (current)\nenter select · esc back';
const effortScreen='Select Reasoning Level\n  1. Low  Fast\n› 2. Medium (current)  Balanced\n  3. High  Deeper\nenter select · esc back';
test('Codex UI preserves command, selection boundary, new notice and cleanup order',async()=>{
  for(const failure of [null,'before','after']) {
    const effects=[];let screen='composer';const error=new Error(failure);
    const ui={screen:()=>screen,command:async text=>{effects.push(text);screen=modelScreen;},
      waitForText:async text=>{assert.ok(screen.includes(text));return screen;},
      key:(key)=>{effects.push(key);if(key==='Escape')screen='composer';
        else if(key==='Enter')screen=effortScreen;
        else {screen='• Model changed to gpt-6.1-sol high standard for this session only';if(failure==='after')throw error;}}};
    const before=()=>{effects.push('before');if(failure==='before')throw error;};
    const promise=configureCodexModel('fixture',null,'high',before,ui);
    if(failure)await assert.rejects(promise,e=>e===error);else await promise;
    assert.deepEqual(effects,failure==='before'?['/model','Enter','before','Escape']:['/model','Enter','before','3']);
  }
});
test('user defaults snapshot precedes action; restore runs on success and failure and remains best effort',async()=>{
  const file=path.join(process.env.HOME,'defaults.json');fs.writeFileSync(file,'before');
  for(const fail of [false,true]) {
    const calls=[];const error=new Error('action failed');
    const promise=keepingUserDefaults(file,before=>{
      calls.push(before.toString());throw new Error('restore unavailable');
    },async()=>{calls.push('action');if(fail)throw error;return 'result';});
    if(fail)await assert.rejects(promise,e=>e===error);else assert.equal(await promise,'result');
    assert.deepEqual(calls,['action','before','before','before']);
    assert.equal(fs.existsSync(file+'.aiterm-lock'),false);
  }
});
