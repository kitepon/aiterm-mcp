import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

assert.equal(process.platform,'win32','factory token diagnostic is Windows-only');
const identity=spawnSync('whoami',[],{encoding:'utf8',timeout:10000});
assert.equal(identity.status,0,'cannot read actual Windows token owner');
assert.match(identity.stdout.trim(),/\\factory-runner$/i,'refuse a different token owner');
const bash=path.join(process.env.ProgramFiles??'C:\\Program Files','Git','bin','bash.exe');
assert(fs.statSync(bash).isFile(),'standard Git Bash must exist');
function probe(mode){
  const context=Object.fromEntries(['USERNAME','USERPROFILE','TEMP','TMP','TMPDIR'].map(k=>[k,process.env[k]??null]));
  const cygpath=spawnSync(bash,['--noprofile','--norc','-c','cygpath -w /tmp'],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
  const mount=spawnSync(bash,['--noprofile','--norc','-c','mount'],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
  const checks=spawnSync(bash,['--noprofile','--norc','-c',`printf 'TEMP=%s\\nTMP=%s\\nTMPDIR=%s\\n' "$TEMP" "$TMP" "$TMPDIR"; for flag in d r w x; do test -$flag /tmp; printf '%s=%s\\n' "$flag" "$?"; done; ls -U /tmp >/dev/null; printf 'listing_exit=%s\\n' "$?"`],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
  const resolved=(cygpath.stdout??'').trim();
  const native={path:resolved,exists:null,is_directory:null,entries:null,error:null};
  if(cygpath.status===0&&/^[A-Za-z]:[\\/]/.test(resolved)){
    try{native.is_directory=fs.statSync(resolved).isDirectory();native.exists=true;native.entries=fs.readdirSync(resolved).length;}
    catch(e){native.exists=e.code==='ENOENT'?false:null;native.error={code:e.code,syscall:e.syscall};}
  }
  const result=r=>({exit:r.status,error:r.error?.code??null,stderr:r.stderr});
  return{mode,at:new Date().toISOString(),whoami:identity.stdout.trim(),context,
    cygpath:{...result(cygpath),path:resolved},mount:{...result(mount),tmp_lines:(mount.stdout??'').split(/\r?\n/).filter(s=>s.includes(' on /tmp '))},
    checks:{...result(checks),stdout:checks.stdout},native,readonly:true};
}
if(process.argv[2]==='isolated')console.log(JSON.stringify(probe('isolated')));
else{
  const normal=probe('normal');
  const child=spawnSync(process.execPath,['--import',pathToFileURL(path.resolve('test/seat-env.mjs')).href,fileURLToPath(import.meta.url),'isolated'],
    {encoding:'utf8',timeout:45000,maxBuffer:1024*1024});
  assert.equal(child.status,0,child.stderr||'isolated read failed');
  const isolated=JSON.parse(child.stdout.trim());
  assert.equal(isolated.mode,'isolated');assert.notEqual(isolated.context.TEMP,normal.context.TEMP,'seat isolation must be active');
  const after=probe('normal-after-child');
  console.log('FACTORY_TMP_READ '+JSON.stringify({schema:'aiterm.windows-factory-tmp-read.v1',normal,isolated,after,
    isolated_root_exists_after:fs.existsSync(isolated.context.TEMP),readonly:true,not_product_acceptance:true}));
}
