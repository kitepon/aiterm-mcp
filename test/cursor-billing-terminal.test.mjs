import './seat-env.mjs';
import assert from 'node:assert/strict';import {test,after}from'node:test';import fs from'node:fs';import os from'node:os';import path from'node:path';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'cursor-billing-'));
process.env.HOME=root;process.env.TMPDIR=root;process.env.XDG_RUNTIME_DIR=root;
const {createCursorAgentMetadata,observeCursorDone,cursorPaneObservation}=await import('../dist/harnesses/cursor.js');
after(()=>fs.rmSync(root,{recursive:true,force:true}));
const screen='Cursor Agent v2026.10.22\nError: {"error":{"code":"prepaid_balance_exhausted","message":"You do not have enough credits to run this model.","model_pricing_type":"third_party_model"}}\n';
function metadata(){return createCursorAgentMetadata('private_billing',root,'pending','read-only',{agentRole:'subagent',parentSessionId:'host-root',delegationDepth:1,lineage:'host-root>cursor:private_billing',delegationAllowed:true});}
test('current prepaid billing refusal ends the dispatched wait as typed error even without a new user record',async()=>{
 const result=await observeCursorDone(metadata(),0,0,()=>screen);
 assert.equal(result.outcome,'error');assert.equal(result.error_kind,'prepaid_balance_exhausted');assert.match(result.error,/prepaid_balance_exhausted/);
 const pane=cursorPaneObservation(screen);assert.equal(pane.state,'blocked');assert.equal(pane.reason,'prepaid_balance_exhausted');
});
test('old prepaid error followed by a composer or a later running turn is not a current terminal failure',async()=>{
 for(const suffix of ['\n→ Plan, search, build anything\n','\n→ Add a follow-up\n','\n→ user draft\n','\nGenerating... (ctrl+c to stop)\n']){
  const result=await observeCursorDone(metadata(),0,0,()=>screen+suffix);
  assert.equal(result.outcome,'running',suffix);
 }
});
test('only a complete provider error object makes a current prepaid terminal',async()=>{
 const {cursorProviderFailure}=await import('../dist/harnesses/cursor.js');
 for(const content of ['local tool failed\nDiagnostic example: {"code":"prepaid_balance_exhausted"}', '{"error":{"code":"prepaid_balance_exhausted", BROKEN']){
  const text=`Cursor Agent v2026.10.22\nError: ${content}\n`;
  assert.equal(cursorProviderFailure(text),null);
  assert.equal((await observeCursorDone(metadata(),0,0,()=>text)).outcome,'running');
  assert.notEqual(cursorPaneObservation(text).reason,'prepaid_balance_exhausted');
 }
 const multiline='Error: {\n  "error": {"code": "prepaid_balance_exhausted", "message": "Credits unavailable"}\n}\n';
 assert.equal(cursorProviderFailure(multiline)?.kind,'prepaid_balance_exhausted');
 assert.equal((await observeCursorDone(metadata(),0,0,()=>multiline)).outcome,'error');
});
test('Codex 429 reconnecting remains a live retry, never a Cursor prepaid terminal or usage exhaustion',async()=>{
 const {codexPaneObservation,codexUsageLimit}=await import('../dist/harnesses/codex.js');
 const retry='Codex\n◦ Working (14m • esc to interrupt)\nReconnecting... 4/5\n429 Too Many Requests\n';
 assert.equal(codexPaneObservation(retry).state,'busy');
 assert.equal(codexUsageLimit({type:'event_msg',payload:{type:'error',message:'429 Too Many Requests',codex_error_info:'rate_limit_exceeded'}}),null);
 const observed=await observeCursorDone(metadata(),0,0,()=>retry);assert.equal(observed.outcome,'running');
});
