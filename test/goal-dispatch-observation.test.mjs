import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('goal dispatch observes once and retains the manager binding observation', {skip:process.platform==='win32'}, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'goal-dispatch-'));
  const bin=path.join(root,'tmux'),calls=path.join(root,'calls');
  fs.writeFileSync(bin,`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
if(args.includes('-V'))console.log('tmux 3.6');
`,{mode:0o755});
  Object.assign(process.env,{HOME:root,TMPDIR:root,XDG_RUNTIME_DIR:root,AITERM_TMUX:bin});
  const {agentGoal}=await import('../dist/core.js');
  try {
    const r=await agentGoal({session_id:'missing-goal-fixture',launch_id:'a'.repeat(32),action:'inspect'});
    assert.equal(r.availability,'unavailable');
    assert.equal(r.mutation,'not_requested');
    assert.equal(r.reason,'binding_unavailable');
    const rows=fs.readFileSync(calls,'utf8').trim().split('\n').map(x=>JSON.parse(x));
    assert.equal(rows.filter(row=>row.includes('list-sessions')).length,2);
    assert.ok(rows.every(row=>row.includes('-V')||row.includes('list-sessions')));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
