import './seat-env.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {parseDarwinBsdBirth,readDarwinProcessBirth} from '../dist/darwin-process-birth.js';
const pid=55273;
function record(){const b=Buffer.alloc(136);b.writeUInt32LE(pid,12);b.writeBigUInt64LE(1792963238n,120);b.writeBigUInt64LE(898270n,128);return b;}
test('Darwin BSD birth retains kernel microseconds matching the observed official Grok registration',()=>{
 assert.equal(parseDarwinBsdBirth(record(),136,pid),'1792963238898270');
 const b=record();b.writeBigUInt64LE(898271n,128);assert.equal(parseDarwinBsdBirth(b,136,pid),'1792963238898271');
});
test('Darwin birth refuses partial, foreign PID, invalid microseconds and unsafe integer output',()=>{
 for(const [buffer,bytes,id] of [[record(),0,pid],[record(),135,pid],[record(),137,pid],[record().subarray(0,128),136,pid],[record(),136,pid+1],[record(),136,0],[record(),136,2147483648]])assert.equal(parseDarwinBsdBirth(buffer,bytes,id),null);
 for(const [sec,usec] of [[0n,0n],[1792963238n,1000000n],[9007199255n,0n]]){const b=record();b.writeBigUInt64LE(sec,120);b.writeBigUInt64LE(usec,128);assert.equal(parseDarwinBsdBirth(b,136,pid),null);}
});
test('Darwin native query is never substituted by a non-Darwin process timestamp',()=>{
 if(process.platform!=='darwin'){assert.equal(readDarwinProcessBirth(process.pid),null);return;}
 const a=readDarwinProcessBirth(process.pid),b=readDarwinProcessBirth(process.pid);assert.match(a,/^\d+$/);assert.equal(a,b);assert.equal(readDarwinProcessBirth(-1),null);assert.equal(readDarwinProcessBirth(2147483648),null);
});
