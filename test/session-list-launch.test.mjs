import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('normal pty_list exposes managed launch snapshots without activity observation', {skip:process.platform==='win32'}, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'list-launch-'));
  const bin=path.join(root,'tmux'),calls=path.join(root,'calls');
  fs.writeFileSync(bin,`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+String.fromCharCode(10));
if(args.includes('-V'))console.log('tmux 3.6');
if(args.includes('list-sessions'))for(const name of ['managed','plain'])console.log([name,'bash',0,80,24].join(String.fromCharCode(9)));
`,{mode:0o755});
  Object.assign(process.env,{HOME:root,TMPDIR:root,XDG_RUNTIME_DIR:root,AITERM_TMUX:bin});
  const {createCodexAgentMetadata}=await import('../dist/harnesses/codex.js');
  const meta=createCodexAgentMetadata('managed',root,'none',{},undefined,{agentRole:'subagent',parentSessionId:'host-root',delegationDepth:1,lineage:'host-root>codex:fixture',delegationAllowed:true});
  const client=new Client({name:'list-launch-proof',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/index.js')],env:{...process.env},stderr:'pipe'});
  try {
    await client.connect(transport);
    const tools=await client.listTools();
    const schema=tools.tools.find(tool=>tool.name==='pty_list').outputSchema.properties.sessions.items;
    assert.ok(!schema.required.includes('launch_id'),'legacy remote results may omit launch_id');
    const r=await client.callTool({name:'pty_list',arguments:{}});
    assert.equal(r.isError,undefined);
    assert.equal(r.structuredContent.schema,'aiterm.pty-list-result.v1');
    const rows=r.structuredContent.sessions;
    assert.equal(rows.find(row=>row.session_id==='managed').launch_id,meta.launch_id);
    assert.equal(rows.find(row=>row.session_id==='plain').launch_id,null);
    const native=fs.readFileSync(calls,'utf8').trim().split('\n').map(x=>JSON.parse(x));
    assert.equal(native.filter(row=>row.includes('list-sessions')).length,1);
    assert.ok(native.every(row=>row.includes('-V')||row.includes('list-sessions')));
  } finally {await client.close();fs.rmSync(root,{recursive:true,force:true});}
});
