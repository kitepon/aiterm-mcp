// Apple PROC_PIDTBSDINFO (proc_bsdinfo), validated against the current native
// Grok registration. Keep microseconds; ps lstart has insufficient precision.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const BSD_INFO_BYTES=136;
const validPid=(pid:number)=>Number.isSafeInteger(pid)&&pid>0&&pid<=2147483647;
export function parseDarwinBsdBirth(info:Buffer,returnedBytes:number,pid:number):string|null{
  if(!validPid(pid)||!Buffer.isBuffer(info)||info.length!==BSD_INFO_BYTES||returnedBytes!==BSD_INFO_BYTES||info.readUInt32LE(12)!==pid)return null;
  const seconds=info.readBigUInt64LE(120),micros=info.readBigUInt64LE(128),birth=seconds*1000000n+micros;
  if(seconds===0n||micros>=1000000n||birth>BigInt(Number.MAX_SAFE_INTEGER))return null;
  return String(birth);
}
let query:((pid:number,flavor:number,arg:number,info:Buffer,size:number)=>number)|undefined;
export function readDarwinProcessBirth(pid:number):string|null{
  if(process.platform!=='darwin'||!validPid(pid))return null;
  try{
    if(!query){
      const koffi:typeof import('koffi')=require('koffi');
      query=koffi.load('/usr/lib/libproc.dylib').func('int proc_pidinfo(int pid, int flavor, uint64_t arg, void *buffer, int buffersize)');
    }
    const info=Buffer.alloc(BSD_INFO_BYTES);
    return parseDarwinBsdBirth(info,query(pid,3,0,info,info.length),pid);
  }catch{return null;}
}
