import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

for(const platform of ['linux','win32'])test(`native process read failures retain safe OS details without argv or output (${platform})`,()=>{
 const run=spawnSync(process.execPath,['--input-type=module','-e',`
  import assert from 'node:assert/strict';import cp from 'node:child_process';
  import {syncBuiltinESMExports} from 'node:module';
  Object.defineProperty(process,'platform',{value:${JSON.stringify(platform)}});
  let result,reads=0;cp.spawnSync=(bin,args)=>{
   if(bin==='where.exe')return {status:0,stdout:'C:/Program Files/PowerShell/7/pwsh.exe'};
   if(args.includes('-Command'))return {status:0,stdout:JSON.stringify({edition:'Core',major:7})};
   assert(bin==='/bin/ps'||args.includes('-EncodedCommand'));reads++;return result;
  };syncBuiltinESMExports();
  const m=await import('./dist/process-runtime.js');
  const probes=[['table',()=>m.readRuntimeProcesses()],['session_table',()=>m.readRuntimeProcesses(true)],
   ['identity',()=>m.readProcessIdentities([process.pid])],
   [process.platform==='win32'?'identity':'elapsed',()=>m.processElapsedSeconds(process.pid)]];
  for(const nativeCode of ['ETIMEDOUT','ENOBUFS','PRIVATE',null])for(const [probe,call]of probes){
   result={status:nativeCode?null:2,signal:nativeCode?'SIGTERM':null,
    error:nativeCode?Object.assign(Error('PRIVATE argv'),{code:nativeCode}):undefined,stdout:'PRIVATE',stderr:'PRIVATE'};
   assert.throws(call,error=>{
    assert.equal(error.code,2);assert(!error.message.includes('PRIVATE'));
    assert(error.message.includes('{'),'OS probe failure details were discarded');
    const fields=JSON.parse(error.message.slice(error.message.indexOf('{')));
    assert.deepEqual(fields,{probe,code:nativeCode==='PRIVATE'?'UNKNOWN':nativeCode,
     status:result.status,signal:result.signal,stdout_bytes:7,stderr_bytes:7});
    assert(error instanceof m.ProcessProbeError);
    assert.deepEqual(error.processFailure,{code:fields.code,status:fields.status,signal:fields.signal});
    assert(Object.isFrozen(error.processFailure));return true;
   });
  }
  assert.equal(reads,16);
 `],{encoding:'utf8',timeout:10000});
 assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'');assert.equal(run.stderr,'');
});
