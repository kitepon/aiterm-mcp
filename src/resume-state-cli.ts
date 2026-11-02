#!/usr/bin/env node
import {fileURLToPath} from 'node:url';
import {createOfflineResumeCheckpoint,restoreOfflineResumeCheckpoint} from './resume-checkpoint-files.js';
import {RESUME_CHECKPOINT_MAX_BYTES,resumeCheckpointDigest} from './resume-checkpoint.js';
export const RESUME_STATE_ERROR='aiterm: RESUME_STATE_UNCONFIRMED\n';
export function parseResumeStateArgs(args:string[]):{operation:'checkpoint'|'restore';session_id:string;launch_id:string;sha256?:string}{
  const [operation,...rest]=args;if(operation!=='checkpoint'&&operation!=='restore')throw Error();
  const fields:Record<string,string>={};
  for(let i=0;i<rest.length;i+=2){const k=rest[i],v=rest[i+1];
    if(!['--session','--launch',...(operation==='restore'?['--sha256']:[])].includes(k)||v===undefined||fields[k]!==undefined)throw Error();fields[k]=v;}
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(fields['--session']??'')||!/^[a-f0-9]{32}$/.test(fields['--launch']??'')
    ||operation==='restore'&&!/^[a-f0-9]{64}$/.test(fields['--sha256']??''))throw Error();
  return {operation,session_id:fields['--session'],launch_id:fields['--launch'],...(operation==='restore'?{sha256:fields['--sha256']}:{})};
}
async function input():Promise<Buffer>{
  let size=0;const chunks:Buffer[]=[];
  for await(const chunk of process.stdin){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=b.length;if(size>RESUME_CHECKPOINT_MAX_BYTES)throw Error();chunks.push(b);}
  return Buffer.concat(chunks,size);
}
function output(stream:NodeJS.WriteStream,bytes:Buffer|string):Promise<void>{
  return new Promise((resolve,reject)=>stream.write(bytes,error=>error?reject(error):resolve()));
}
export async function main(args=process.argv.slice(2)):Promise<number>{
  const quiet=()=>{};process.stdout.on('error',quiet);process.stderr.on('error',quiet);
  try{
    const p=parseResumeStateArgs(args);let bytes:Buffer,outcome:'saved'|'restored'|'already_restored';
    if(p.operation==='checkpoint'){bytes=createOfflineResumeCheckpoint(p.session_id,p.launch_id);outcome='saved';}
    else{bytes=await input();const {observeExecutionNativeSessions}=await import('./core.js');
      outcome=restoreOfflineResumeCheckpoint(bytes,{session_id:p.session_id,launch_id:p.launch_id,sha256:p.sha256!},observeExecutionNativeSessions);}
    const receipt=JSON.stringify({schema:'aiterm.resume-state-result.v1',operation:p.operation,session_id:p.session_id,
      launch_id:p.launch_id,checkpoint_sha256:resumeCheckpointDigest(bytes),outcome})+'\n';
    if(Buffer.byteLength(receipt)>512)throw Error();
    if(p.operation==='checkpoint'){await output(process.stdout,bytes);await output(process.stderr,receipt);}
    else await output(process.stdout,receipt);
    return 0;
  }catch{try{await output(process.stderr,RESUME_STATE_ERROR);}catch{}return 2;}
  finally{process.stdout.removeListener('error',quiet);process.stderr.removeListener('error',quiet);}
}
if(process.argv[1]===fileURLToPath(import.meta.url))process.exitCode=await main();
