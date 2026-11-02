// Diagnostic observer, imported only after the test worker has loaded seat-env.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
export function classify(binary,args=[]){
 if(binary==='/bin/ps')return args[0]==='-axww'?'ps_table':'ps_identity';
 if(/(?:^|\/)(?:tmux|psmux)$/.test(binary))return 'native_mux';
 return binary===process.execPath?'node_child':null;
}
const file=process.env.PRODUCT_CI_AITERM_TIMING_FILE??path.join(os.tmpdir(),'aiterm-native-timing.jsonl');
process.env.PRODUCT_CI_AITERM_TIMING_FILE=file;
const preload='--import='+import.meta.url;
if(!(process.env.NODE_OPTIONS??'').includes(preload))process.env.NODE_OPTIONS=((process.env.NODE_OPTIONS??'')+' '+preload).trim();
const emitted={},totals={};
const record=value=>{try{fs.appendFileSync(file,JSON.stringify({schema:'aiterm.native-timing.v1',pid:process.pid,at:new Date().toISOString(),...value})+'\n',{mode:0o600});}catch{}};
const original=childProcess.spawnSync;
childProcess.spawnSync=function(binary,args,options){
 const kind=classify(binary,args),start=performance.now();
 const result=original(binary,args,options);
 if(kind){
  const ms=performance.now()-start,stat=totals[kind]??={calls:0,ms:0,max_ms:0,failures:0};
  stat.calls++;stat.ms+=ms;stat.max_ms=Math.max(stat.max_ms,ms);
  const failed=!!result.error||result.status!==0;if(failed)stat.failures++;
  if((failed||ms>=200)&&(emitted[kind]=(emitted[kind]??0)+1)<=200)record({kind,ms,status:result.status,signal:result.signal,
   code:result.error?(['ETIMEDOUT','EAGAIN','ENOBUFS','ENOENT','EACCES'].includes(result.error.code)?result.error.code:'other'):null,
   stdout_bytes:Buffer.byteLength(result.stdout??''),stderr_bytes:Buffer.byteLength(result.stderr??'')});
 }
 return result;
};
syncBuiltinESMExports();
process.once('beforeExit',()=>{
 record({kind:'summary',totals});
 if(process.argv.some(x=>x.endsWith('.test.mjs')))try{process.stderr.write(fs.readFileSync(file));}catch{}
});
