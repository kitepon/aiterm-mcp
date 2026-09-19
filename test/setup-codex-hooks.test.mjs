import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {configureCodexSteer,mergeCodexParentHooks,codexHookCommand} from '../dist/setup-codex-hooks.js';
import {readCodexHookConfig} from '../dist/codex-hook-state.js';
import {spawnSync} from 'node:child_process';
import {resolveWindowsPowerShell7} from '../dist/windows-powershell.js';

test('WindowsのhookコマンドはPowerShellから標準入出力と引用符を保って実行できる',{skip:process.platform!=='win32'},t=>{
  const root=fs.mkdtempSync(join(tmpdir(),"aiterm hook ' 日本語 "));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const hook=join(root,'hook.mjs');
  fs.writeFileSync(hook,"let input='';for await(const chunk of process.stdin)input+=chunk;process.stdout.write(JSON.stringify({input,directory:process.argv[2]}));");
  const input=JSON.stringify({message:'日本語の回答'});
  const result=spawnSync(resolveWindowsPowerShell7(),['-NoLogo','-NoProfile','-NonInteractive','-Command',codexHookCommand(process.execPath,hook,root)],{input,encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{input,directory:root});
});

function fixture(t) {
  const root=fs.mkdtempSync(join(tmpdir(),'aiterm hook setup '));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const home=join(root,'codex'); fs.mkdirSync(home);
  const hook=join(root,'hook.js'); fs.writeFileSync(hook,'');
  const events=[]; let legacy=null; let rows=[];
  const runtime={platform:'darwin',directory:join(root,'state'),codex_home:home,node:process.execPath,hook,
    findBinary:()=>'/official/codex',processes:()=>rows,legacy:()=>legacy,
    disableLegacy:async()=>{events.push('disable');legacy={...legacy,enabled:false};return {status:'restart_required'};},
    verify:async(config,approve)=>{events.push(approve?'approve':'read'); const value=JSON.parse(fs.readFileSync(join(home,'hooks.json'),'utf8'));assert(value.hooks.Stop.some(group=>group.hooks.some(hook=>hook.command===config.command)));}};
  return {root,home,hook,runtime,events,setLegacy:value=>{legacy=value;},setProcesses:value=>{rows=value;}};
}

test('公式hookの承認と読戻しを終えてから旧中継を解除する',async t=>{
  const f=fixture(t); f.setLegacy({enabled:true}); f.setProcesses([{pid:20,started_identity:'old',command:'/official/codex app-server'}]);
  assert.equal((await configureCodexSteer('enable',f.runtime)).status,'restart_required');
  assert.deepEqual(f.events,['approve','disable']);
  assert.equal((await configureCodexSteer('status',f.runtime)).status,'restart_required');
  f.setProcesses([{pid:20,started_identity:'new',command:'/official/codex app-server'}]);
  assert.equal((await configureCodexSteer('status',f.runtime)).status,'ready');
});

test('再実行でも他のhookと元の設定を保持し、解除では自分の登録だけを除く',async t=>{
  const f=fixture(t); const file=join(f.home,'hooks.json');
  const foreign={matcher:'Bash',hooks:[{type:'command',command:'other-hook',timeout:8}]};
  fs.writeFileSync(file,JSON.stringify({description:'他製品の設定',hooks:{Stop:[foreign],SessionStart:[foreign]}}));
  await configureCodexSteer('enable',f.runtime); const before=fs.readFileSync(file,'utf8');
  await configureCodexSteer('enable',f.runtime); assert.equal(fs.readFileSync(file,'utf8'),before);
  await configureCodexSteer('disable',f.runtime);
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{description:'他製品の設定',hooks:{Stop:[foreign],SessionStart:[foreign]}});
  assert.equal(readCodexHookConfig(f.runtime.directory).enabled,false);
});

test('承認が拒否された時は旧中継を解除せず、readyを記録しない',async t=>{
  const f=fixture(t); f.setLegacy({enabled:true});
  await assert.rejects(configureCodexSteer('enable',{...f.runtime,verify:async()=>{throw new Error('承認拒否');}}),/承認拒否/);
  assert.deepEqual(f.events,[]); assert.equal(readCodexHookConfig(f.runtime.directory),null);
});

test('後続hookが増えても再導入は既存位置を保ち、不要な再起動を要求しない',async t=>{
  const f=fixture(t); const file=join(f.home,'hooks.json');
  assert.equal((await configureCodexSteer('enable',f.runtime)).status,'ready');
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  const foreign={hooks:[{type:'command',command:'later-hook'}]};
  for(const event of ['PostToolUse','Stop']) value.hooks[event].push(foreign);
  fs.writeFileSync(file,JSON.stringify(value));
  const before=fs.readFileSync(file,'utf8');
  f.setProcesses([{pid:20,started_identity:'current',command:'/official/codex app-server'}]);
  assert.equal((await configureCodexSteer('enable',f.runtime)).status,'ready');
  assert.equal(fs.readFileSync(file,'utf8'),before);
  assert.deepEqual(readCodexHookConfig(f.runtime.directory).stale_processes,[]);
});

test('旧起動設定の解除失敗は新設定を残し、再実行で移行を続行する',async t=>{
  const f=fixture(t); f.setLegacy({enabled:true});
  await assert.rejects(configureCodexSteer('enable',{...f.runtime,disableLegacy:async()=>{throw new Error('解除失敗');}}),/解除失敗/);
  assert.equal(readCodexHookConfig(f.runtime.directory).enabled,true);
  assert.equal((await configureCodexSteer('status',f.runtime)).status,'restart_required');
  assert.equal((await configureCodexSteer('enable',f.runtime)).status,'ready');
});

test('不正な既存hook設定は書き換えない',t=>{
  const f=fixture(t); const file=join(f.home,'hooks.json');
  for(const text of ['{broken','[]','{"hooks":[]}','{"hooks":{"Stop":{}}}']) {
    fs.writeFileSync(file,text); assert.throws(()=>mergeCodexParentHooks(file,'ours'),/hook/); assert.equal(fs.readFileSync(file,'utf8'),text);
  }
});

test('Nodeが欠けてもdisableは実行でき、未対応OSのenableは設定しない',async t=>{
  const f=fixture(t);
  assert.equal((await configureCodexSteer('enable',{...f.runtime,platform:'linux'})).status,'unsupported');
  assert.equal(fs.existsSync(join(f.home,'hooks.json')),false);
  await configureCodexSteer('enable',f.runtime);
  await configureCodexSteer('disable',{...f.runtime,node:'/missing/node',hook:'/missing/hook'});
  assert.equal((await configureCodexSteer('status',f.runtime)).status,'disabled');
});
