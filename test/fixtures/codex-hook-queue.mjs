// hookの公開API境界だけを模擬する。所有判定・claim・出力は製品実装を使う。
import { createInterface } from 'node:readline';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
const [file, mode] = process.argv.slice(2);
const pause = new Int32Array(new SharedArrayBuffer(4));
// Windowsは、並んだ偽物が開いている最中のfileを、開いたり置き換えたりできない事がある。短く待って繰り返す。
function retry(action) {
  for (let attempt = 0; ; attempt++) {
    try { return action(); }
    catch (error) {
      if (attempt >= 200 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      Atomics.wait(pause, 0, 0, 5);
    }
  }
}
// 本物のCodexは1つのprocessがキューを持つ。この偽物は同時に動くhookの数だけ起きて、同じfileを見る。
// その場で書くと、空にしてから書き終えるまでの間に、並んだ偽物が空や途中のJSONを読んで異常終了する。
// 一時fileからのrenameで置き換えて、読む側にはいつも前か後の全体を見せる。
function replace(value) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value));
  retry(() => renameSync(temporary, file));
}
createInterface({input:process.stdin}).on('line', line => {
  const {id, method, params} = JSON.parse(line);
  const send = result => process.stdout.write(JSON.stringify({id,result})+'\n');
  if (method === 'initialize') return send({});
  if (method === 'initialized') return;
  const entries = JSON.parse(retry(() => readFileSync(file,'utf8')));
  if (method === 'thread/queue/list') {
    const offset = Number(params.cursor ?? 0);
    const limit = params.limit ?? 100;
    return send({data:entries.slice(offset,offset+limit),nextCursor:offset+limit<entries.length?String(offset+limit):null});
  }
  if (method === 'thread/queue/delete') {
    if (mode === 'reject') return process.stdout.write(JSON.stringify({id,error:{code:-32000,message:'試験用の削除拒否'}})+'\n');
    const remaining=entries.filter(entry=>entry.id!==params.queuedSubmissionId);
    replace(remaining);
    return send({deleted:remaining.length!==entries.length});
  }
  throw new Error('未対応の試験要求: '+method);
});
