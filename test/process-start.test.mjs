import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {processStartIdentity,processStartIdentities} from '../dist/process-start.js';

test('batched native births retain exact single-process identities and unknown entries',()=>{
 const ids=[process.pid,process.ppid,process.pid,-1,2147483647];
 const starts=processStartIdentities(ids,process.platform);
 assert.equal(starts[0],processStartIdentity(process.pid,process.platform));
 assert.equal(starts[1],processStartIdentity(process.ppid,process.platform));
 assert.ok(starts[0]);assert.equal(starts[2],starts[0]);
 assert.deepEqual(starts.slice(3),[null,null]);
 assert.deepEqual(processStartIdentities([],process.platform),[]);
});

test('Windows batched birth replies reject reordered, missing and malformed identities',t=>{
 let rows;
 t.mock.method(childProcess,'spawnSync',(bin,args,options)=>{
  const stdout=bin==='where.exe'?'C:\\Program Files\\PowerShell\\7\\pwsh.exe\r\n'
   :options?.env?.AITERMMCP_PROCESS_IDS?JSON.stringify(rows)
   :'{"edition":"Core","major":7}';
  return {status:0,stdout,stderr:''};
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 rows=[{pid:11,start:'638976834123456789'},{pid:22,start:null}];
 assert.deepEqual(processStartIdentities([11,22],'win32'),['win32:638976834123456789',null]);
 for(const invalid of [[...rows].reverse(),rows.slice(0,1),[{pid:11,start:638976834},{pid:22,start:null}],
  [{pid:11,start:'bad'},{pid:22,start:null}],[rows[0],rows[0]],null]){
  rows=invalid;assert.deepEqual(processStartIdentities([11,22],'win32'),[null,null]);
 }
});
