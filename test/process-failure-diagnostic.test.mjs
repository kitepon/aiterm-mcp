import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('process diagnostics retain the original failure without emitting payload or argv', {skip:process.platform==='win32'},()=>{
 const result=spawnSync(process.execPath,['--input-type=module','-e',`
  import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
  cp.spawnSync=()=>({status:null,signal:'SIGTERM',error:Object.assign(new Error('PRIVATE'),{code:'ETIMEDOUT'}),stdout:'PRIVATE',stderr:'PRIVATE'});
  syncBuiltinESMExports();
  const m=await import('./dist/process-runtime.js');
  for(const run of [()=>m.readRuntimeProcesses(),()=>m.readRuntimeProcesses(true),()=>m.readProcessIdentities([process.pid])])
   try{run();throw Error('expected rejection')}catch(e){if(e.message!=='OSのprocess一覧を取得できません')throw e;}
 `],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr);
 assert.equal(result.stdout,'');assert(!result.stderr.includes('PRIVATE'));
 const rows=result.stderr.trim().split('\n').map(JSON.parse);
 assert.deepEqual(rows.map(r=>r.probe),['table','session_table','identity']);
 for(const row of rows){assert.equal(row.schema,'aiterm.process-probe-failure.v1');assert.equal(row.code,'ETIMEDOUT');assert.equal(row.status,null);assert.equal(row.signal,'SIGTERM');assert.equal(row.stdout_bytes,7);assert.equal(row.stderr_bytes,7);assert(row.ms>=0);}
});
