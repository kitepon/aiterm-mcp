import fs from 'node:fs';
import path from 'node:path';
import {resumeCheckpointSchema,resumeCheckpointSuffixes,resumeCheckpointRecord,resumeCheckpointRecordPath,
  validateResumeCheckpoint,encodeResumeCheckpoint,resumeCheckpointDigest,RESUME_CHECKPOINT_FILE_BYTES,
  RESUME_CHECKPOINT_MAX_BYTES,type ResumeCheckpoint} from './resume-checkpoint.js';
function refuse():never {throw new Error('RESUME_STATE_UNCONFIRMED');}
function directory(file:string,uid:number):void {
  const st=fs.lstatSync(file);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==uid||(st.mode&0o077)!==0||fs.realpathSync(file)!==file)refuse();
}
function stable(a:fs.Stats,b:fs.Stats):boolean {
  return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
}
function readRecord(file:string,uid:number,optional:boolean):Buffer|null {
  let fd:number|undefined;
  try {
    let item:fs.Stats;
    try {item=fs.lstatSync(file);} catch(error){if(optional&&(error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
    if(item.isSymbolicLink()||fs.realpathSync(file)!==file)refuse();
    fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.uid!==uid||(before.mode&0o077)!==0||before.size>RESUME_CHECKPOINT_FILE_BYTES)refuse();
    const bytes=Buffer.alloc(before.size);let offset=0;
    while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)refuse();offset+=n;}
    const after=fs.fstatSync(fd);
    if(bytes.length!==before.size||!stable(before,after)||!stable(after,fs.lstatSync(file)))refuse();
    return bytes;
  } finally {if(fd!==undefined)fs.closeSync(fd);}
}
/** Validate the retained vendor file; state-directory inode is deliberately not the vendor identity. */
export function verifyResumeCheckpointRoots(bundle:ResumeCheckpoint):void {
  for(const record of bundle.records.filter(r=>r.kind==='proof')){
    const proof=JSON.parse(Buffer.from(record.bytes_base64,'base64').toString('utf8'));
    if(fs.realpathSync(proof.file)!==proof.file)refuse();
    const fd=fs.openSync(proof.file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try {
      const before=fs.fstatSync(fd),prefix=Buffer.alloc(proof.prefix_bytes);
      if(!before.isFile()||before.uid!==bundle.scope.uid||(before.mode&0o022)!==0
        ||String(before.dev)!==proof.device||String(before.ino)!==proof.inode||before.size<proof.cursor)refuse();
      if(fs.readSync(fd,prefix,0,prefix.length,0)!==prefix.length||resumeCheckpointDigest(prefix)!==proof.prefix_sha256
        ||!stable(before,fs.fstatSync(fd))||!stable(before,fs.lstatSync(proof.file)))refuse();
    } finally {fs.closeSync(fd);}
  }
}
/** Caller owns source shutdown and restart prevention. This function never creates state or locks. */
export function createOfflineResumeCheckpoint(session_id:string,launch_id:string):Buffer {
  if(process.platform!=='linux'||typeof process.getuid!=='function')refuse();
  const state_base=process.env.AITERM_STATE_BASE,uid=process.getuid();
  if(!state_base||!path.isAbsolute(state_base)||path.normalize(state_base)!==state_base)refuse();
  directory(state_base,uid);
  const dir=path.join(state_base,`aiterm-mcp-${uid}`,'agents');directory(path.dirname(dir),uid);directory(dir,uid);
  // Parse target before deriving any path. Configuration/vendor fields are filled from selected metadata below.
  const provisional=resumeCheckpointSchema.shape.scope.parse({session_id,launch_id,uid,node_platform:'linux',state_base,
    socket:path.join(process.env.TMPDIR??'/tmp','claude-tmux-sockets','claude.sock'),configuration_root:'/placeholder',vendor_session_id:'00000000-0000-4000-8000-000000000000'});
  const records:ResumeCheckpoint['records']=[],reads=new Map<string,Buffer|null>();let total=0;
  const read=(id:string,kind:keyof typeof resumeCheckpointSuffixes,optional=false)=>{
    const file=resumeCheckpointRecordPath(provisional,{launch_id:id,kind}),bytes=readRecord(file,uid,optional);
    reads.set(file,bytes);
    if(bytes){total+=Math.ceil(bytes.length/3)*4;if(total>RESUME_CHECKPOINT_MAX_BYTES||records.length>=512)refuse();records.push(resumeCheckpointRecord(id,kind,bytes));}return bytes;
  };
  read(launch_id,'generation');
  let id:string|undefined=launch_id;const seen=new Set<string>();let selected:any;
  while(id!==undefined){
    if(seen.has(id)||seen.size>=64||!/^[a-f0-9]{32}$/.test(id))refuse();seen.add(id);
    const m=JSON.parse(read(id,'metadata')!.toString('utf8'));selected??=m;
    for(const kind of Object.keys(resumeCheckpointSuffixes) as (keyof typeof resumeCheckpointSuffixes)[])
      if(kind!=='generation'&&kind!=='metadata')read(id,kind,true);
    id=m.resumed_from;
  }
  const bundle=validateResumeCheckpoint({schema:'aiterm.resume-checkpoint.v1',scope:{...provisional,
    configuration_root:selected.codex_home,vendor_session_id:selected.vendor_session_id},records});
  verifyResumeCheckpointRoots(bundle);
  for(const [file,bytes] of reads){const again=readRecord(file,uid,bytes===null);if(bytes===null?again!==null:!again?.equals(bytes))refuse();}
  return encodeResumeCheckpoint(bundle);
}
