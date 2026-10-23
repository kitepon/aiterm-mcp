// Diagnostics only. Run with --import <product>/test/seat-env.mjs from product cwd.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const core = await import(pathToFileURL(path.join(process.cwd(),'dist/core.js')));
const runtime = await import(pathToFileURL(path.join(process.cwd(),'dist/tmux-runtime.js')));
assert.equal(process.platform,'win32');
const rg = spawnSync('where.exe',['rg.exe'],{encoding:'utf8'}).stdout?.trim().split(/\r?\n/)[0];
assert.ok(rg && path.isAbsolute(rg),'installed rg path is required');
const rgDir=path.dirname(rg), quote=x=>"'"+x.replaceAll("'","''")+"'";
process.env.AITERM_TEST_PARENT_MARKER='unregistered-probe-value';
process.env.AITERM_TEST_REGISTERED_MARKER='registered-probe-value';
const hash=x=>createHash('sha256').update(x).digest('hex');
const result={schema:'aiterm.windows-boundary-probe.v1',parent:{rgByName:spawnSync('rg',['--version']).status===0,rgByAbsolute:spawnSync(rg,['--version']).status===0,pathContainsRgDir:process.env.PATH.split(path.delimiter).includes(rgDir),pathKeyNames:Object.keys(process.env).filter(x=>x.toLowerCase()==='path'),pathSha256:hash(process.env.PATH)},cases:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const stripped=x=>x.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,'');
async function query(session,tag,expr){
 const at=Math.min(5,tag.length-1);
 const cmd=`[Console]::WriteLine((${quote(tag.slice(0,at))}+${quote(tag.slice(at)+'=')}) + (${expr}))`;
 core.send(session,cmd,{force:true,mark:true});
 const output=await core.readOutput(session,{wait:true,timeout:5,raw:true});
 const line=stripped(output).split(/\r?\n/).find(x=>x.startsWith(tag+'='));
 if(!line)throw Error('missing scalar marker '+tag);
 return line.slice(tag.length+1);
}
const expected='日本語';
for(const explicitPath of [false,true]){
 const session=explicitPath?'boundary-explicit-path':'boundary-inherited-path';
 const row={explicitPath};result.cases.push(row);
 let opened=false;
 try{
  core.openSession(session,'pwsh',['AITERM_TEST_REGISTERED_MARKER',...(explicitPath?['PATH']:[])]);opened=true;
  const deadline=performance.now()+5000;
  for(;;){const pane=runtime.tmuxCommand(false,'capture-pane','-p','-t',session);if(/(?:^|\n)PS [^\r\n]*>\s*$/.test(stripped(pane.stdout)))break;if(performance.now()>=deadline)throw Error('fixture PowerShell prompt not observed');await pause(50);}
  row.paneCommand=runtime.tmuxCommand(false,'display-message','-p','-t',session,'#{pane_current_command}').stdout.trim();
  const props=`[ordered]@{rgByName=[bool](Get-Command rg -ErrorAction SilentlyContinue);rgAbsoluteExists=(Test-Path ${quote(rg)});pathContainsRgDir=($env:PATH.Split(';') -contains ${quote(rgDir)});parentMarker=($env:AITERM_TEST_PARENT_MARKER -eq 'unregistered-probe-value');registeredMarker=($env:AITERM_TEST_REGISTERED_MARKER -eq 'registered-probe-value');inputCodePage=[Console]::InputEncoding.CodePage;outputCodePage=[Console]::OutputEncoding.CodePage;outputRedirected=[Console]::IsOutputRedirected;psVersion=$PSVersionTable.PSVersion.ToString()} | ConvertTo-Json -Compress`;
  row.pane=JSON.parse(await query(session,'PANE_JSON',props));
  row.rawBefore=Array.from(await query(session,'RAW_BEFORE',quote(expected)),x=>x.codePointAt(0));
  row.base64Before=Array.from(await query(session,'B64_BEFORE',`[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(expected).toString('base64')}'))`),x=>x.codePointAt(0));
  core.send(session,'[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $OutputEncoding = [Text.UTF8Encoding]::new($false)',{force:true,mark:true});
  await core.readOutput(session,{wait:true,timeout:5,raw:true});
  row.rawAfter=Array.from(await query(session,'RAW_AFTER',quote(expected)),x=>x.codePointAt(0));
  row.base64After=Array.from(await query(session,'B64_AFTER',`[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(expected).toString('base64')}'))`),x=>x.codePointAt(0));
  row.expectedCodePoints=Array.from(expected,x=>x.codePointAt(0));
 }catch(error){row.error=error.message;}finally{if(opened)try{core.closeSession(session);}catch(error){row.cleanupError=error.message;}}
}
console.log('BOUNDARY_PROBE_RESULT='+JSON.stringify(result));
assert.equal(result.cases.filter(x=>x.error||x.cleanupError).length,0,'all probes and cleanup must complete');
