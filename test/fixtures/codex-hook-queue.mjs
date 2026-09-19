// hookの公開API境界だけを模擬する。所有判定・claim・出力は製品実装を使う。
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';
const [file, mode] = process.argv.slice(2);
createInterface({input:process.stdin}).on('line', line => {
  const {id, method, params} = JSON.parse(line);
  const send = result => process.stdout.write(JSON.stringify({id,result})+'\n');
  if (method === 'initialize') return send({});
  if (method === 'initialized') return;
  const entries = JSON.parse(readFileSync(file,'utf8'));
  if (method === 'thread/queue/list') {
    const offset = Number(params.cursor ?? 0);
    const limit = params.limit ?? 100;
    return send({data:entries.slice(offset,offset+limit),nextCursor:offset+limit<entries.length?String(offset+limit):null});
  }
  if (method === 'thread/queue/delete') {
    if (mode === 'reject') return process.stdout.write(JSON.stringify({id,error:{code:-32000,message:'試験用の削除拒否'}})+'\n');
    const remaining=entries.filter(entry=>entry.id!==params.queuedSubmissionId);
    writeFileSync(file,JSON.stringify(remaining));
    return send({deleted:remaining.length!==entries.length});
  }
  throw new Error('未対応の試験要求: '+method);
});
