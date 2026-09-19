import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {runCodexResultHook} from '../dist/codex-parent-hooks.js';
import {assertCodexHookParentCurrent, codexInputDirectory, codexHookDeliveryState, registerCodexHookInput, finishCodexHookSubmission, readCodexHookConfig, writeHookJson} from '../dist/codex-hook-state.js';

const thread='11111111-2222-4333-8444-555555555555';
const delivery='22222222-2222-4333-8444-555555555555';
const other='33333333-2222-4333-8444-555555555555';
const fixture=fileURLToPath(new URL('./fixtures/codex-hook-queue.mjs',import.meta.url));
function setup(t) {
  const root=fs.mkdtempSync(join(tmpdir(),'aiterm hook unit '));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const directory=join(root,'state'); const home=join(root,'home'); fs.mkdirSync(home);
  writeHookJson(join(directory,'config.json'),{schema:'aiterm.codex-parent-hooks.v1',enabled:true,codex_home:home,binary:process.execPath,node:process.execPath,hook:fixture,command:'fixture',stale_processes:[]});
  const queue=join(root,'queue.json'); writeHookJson(queue,[]);
  const options={directory,codex_home:home,runtime:{executable:process.execPath,args:[fixture,queue],timeout_ms:1000}};
  const event={session_id:thread,turn_id:'turn-1',hook_event_name:'PostToolUse'};
  const enqueue=(id,text,owned=true)=>{
    if(owned) registerCodexHookInput(home,thread,id,text,directory);
    const entries=JSON.parse(fs.readFileSync(queue,'utf8')); entries.push({id:'queue-'+id,clientUserMessageId:id,input:[{type:'text',text}]}); writeHookJson(queue,entries);
    if(owned) finishCodexHookSubmission(home,thread,id,directory);
  };
  const claim=()=>JSON.parse(fs.readFileSync(join(codexInputDirectory(directory,home,thread),'claims',delivery+'.json'),'utf8'));
  return {root,directory,home,queue,options,event,enqueue,claim};
}

test('Aitermの回答だけを取り出し、他のキュー入力と本文の全量を保持する',async t=>{
  const f=setup(t); const text='日本語\n引用符"と\\\n'.repeat(5000);
  f.enqueue(delivery,text); f.enqueue(other,'利用者の入力',false);
  let output; await runCodexResultHook(f.event,async value=>{output=value;},f.options);
  assert.equal(output.hookSpecificOutput.additionalContext,text);
  assert.equal(JSON.parse(fs.readFileSync(f.queue,'utf8'))[0].clientUserMessageId,other);
  assert.equal(f.claim().state,'emitted');
  await runCodexResultHook(f.event,async value=>assert.deepEqual(value,{}),f.options);
});

test('同時に二つのhookが動いても一つだけが回答を出力する',async t=>{
  const f=setup(t); f.enqueue(delivery,'一度だけ'); const outputs=[];
  await Promise.all([1,2].map(()=>runCodexResultHook(f.event,async value=>{outputs.push(value);},f.options)));
  assert.equal(outputs.filter(value=>value.hookSpecificOutput).length,1);
  assert.equal(f.claim().state,'emitted');
});

test('本文が書き換えられていたらキューから削除しない',async t=>{
  const f=setup(t); f.enqueue(delivery,'元の回答');
  const entries=JSON.parse(fs.readFileSync(f.queue,'utf8')); entries[0].input[0].text='別の内容'; writeHookJson(f.queue,entries);
  await assert.rejects(runCodexResultHook(f.event,async()=>assert.fail('出力しない'),f.options),error=>error.delivery_code==='CODEX_HOOK_INPUT_CHANGED');
  assert.equal(JSON.parse(fs.readFileSync(f.queue,'utf8')).length,1);
});

test('別threadのhookには回答を渡さない',async t=>{
  const f=setup(t); f.enqueue(delivery,'宛先を固定');
  await runCodexResultHook({...f.event,session_id:other},async value=>assert.deepEqual(value,{}),f.options);
  assert.equal(JSON.parse(fs.readFileSync(f.queue,'utf8')).length,1);
});

test('hook出力に失敗した本文はunknownで保存し、自動再送しない',async t=>{
  const f=setup(t); f.enqueue(delivery,'保存する回答');
  await assert.rejects(runCodexResultHook(f.event,async()=>{throw new Error('EPIPE');},f.options),/EPIPE/);
  assert.equal(f.claim().state,'unknown'); assert.equal(f.claim().text,'保存する回答');
  assert.equal(codexHookDeliveryState(f.home,thread,delivery,f.directory),'unknown');
  await runCodexResultHook(f.event,async value=>assert.deepEqual(value,{}),f.options);
});

test('削除が拒否されたらunknownを記録し、元のキューは残る',async t=>{
  const f=setup(t); f.enqueue(delivery,'残る回答'); f.options.runtime.args.push('reject');
  await assert.rejects(runCodexResultHook(f.event,async()=>assert.fail(),f.options),/削除拒否/);
  assert.equal(f.claim().state,'unknown'); assert.equal(JSON.parse(fs.readFileSync(f.queue,'utf8')).length,1);
});

test('一覧をページ末尾まで読み、最後のAiterm回答を取り出す',async t=>{
  const f=setup(t); writeHookJson(f.queue,Array.from({length:110},(_,i)=>({id:'foreign-'+i,clientUserMessageId:'foreign-'+i,input:[]})));
  f.enqueue(delivery,'最終ページ');
  await runCodexResultHook({...f.event,hook_event_name:'Stop'},async value=>assert.deepEqual(value,{decision:'block',reason:'最終ページ'}),f.options);
  assert.equal(JSON.parse(fs.readFileSync(f.queue,'utf8')).length,110);
});

test('通常キューが消費した入力の所有記録は次のhookで整理する',async t=>{
  const f=setup(t); f.enqueue(delivery,'通常配送'); writeHookJson(f.queue,[]);
  await runCodexResultHook(f.event,async value=>assert.deepEqual(value,{}),f.options);
  assert.deepEqual(fs.readdirSync(join(codexInputDirectory(f.directory,f.home,thread),'pending')),[]);
});

test('中断された取り出しは再送せず、状態照会でunknownを返す',t=>{
  const f=setup(t); const file=join(codexInputDirectory(f.directory,f.home,thread),'claims',delivery+'.json');
  writeHookJson(file,{state:'deleting',pid:process.pid,started_identity:'終了済みのprocess識別子'});
  assert.equal(codexHookDeliveryState(f.home,thread,delivery,f.directory),'unknown');
});

test('取り出し所有権の確保直後は、まだ公式キューへ投入済みとして照会できる',t=>{
  const f=setup(t); f.enqueue(delivery,'取り出し前');
  const directory=codexInputDirectory(f.directory,f.home,thread);
  fs.mkdirSync(join(directory,'claims'));
  fs.linkSync(join(directory,'pending',delivery+'.json'),join(directory,'claims',delivery+'.json'));
  assert.equal(codexHookDeliveryState(f.home,thread,delivery,f.directory),null);
});

test('導入前の親からの依頼とhook消失は子への依頼前に理由付きで拒否する',t=>{
  const f=setup(t); const config=readCodexHookConfig(f.directory);
  config.stale_processes=[{pid:20,started_identity:'before'}];
  const rows=[{pid:30,parent_pid:20,started_identity:'mcp'},{pid:20,parent_pid:1,started_identity:'before'}];
  assert.throws(()=>assertCodexHookParentCurrent(config,rows,30),error=>error.delivery_code==='CODEX_STEER_RESTART_REQUIRED');
  rows[1].started_identity='after'; assertCodexHookParentCurrent(config,rows,30);
  config.hook=join(f.root,'消えたhook');
  assert.throws(()=>assertCodexHookParentCurrent(config,rows,30),error=>error.delivery_code==='CODEX_HOOK_RUNTIME_UNAVAILABLE');
});
