import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {paneTtyInputOwnerReady} from '../dist/core.js';
const raw='speed 38400 baud; -icanon -echo isig;';
const ready='10 10 Ss /bin/bash\n20 20 Sl+ /usr/local/bin/codex\n21 20 Sl+ codex worker';
test('TTY input requires the original PID and process group, foreground status, and explicit raw flags',()=>{
 assert.equal(paneTtyInputOwnerReady(ready,20,20,raw),true);
 for(const [pid,group] of [[99,20],[20,99],[0,20],[20,0]])assert.equal(paneTtyInputOwnerReady(ready,pid,group,raw),false);
 for(const mode of ['', 'echo -icanon', '-echo icanon', '-echo', '-icanon', 'unreadable'])assert.equal(paneTtyInputOwnerReady(ready,20,20,mode),false);
});
test('stopped, background, foreign foreground group, dead or malformed observations never authorize input',()=>{
 for(const listing of [ready.replace('Sl+','T'),ready.replaceAll('Sl+','Sl'),ready+'\n30 30 S+ another-codex',ready.replace('Sl+','Z+'),'invalid OS response',''])
  assert.equal(paneTtyInputOwnerReady(listing,20,20,raw),false,listing);
});
