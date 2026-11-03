import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { codexFailureCategory } from '../dist/harnesses/codex.js';
import { claudeApiErrorFromLine, claudeFailureCategory } from '../dist/harnesses/claude.js';
import { parseClaudeOperationMarker } from '../dist/claude-operation-marker.js';
import { parseArgs } from '../dist/aiterm-wait-cli.js';
import { remoteWaitCommand } from '../dist/remote.js';

const capacity='Selected model is at capacity. Please try a different model.';
const complete=error=>({type:'event_msg',payload:{type:'task_complete',error}});
test('provider classifications require native error records, preserve auth failures and separate limits from capacity',()=>{
  for(const [info,message,expected] of [
    ['server_overloaded',capacity,'capacity'], ['other',capacity,'capacity'], ['usage_limit_exceeded','limit','rate_limited'],
    ['rate_limit_exceeded','rate','rate_limited'], ['internal_server_error','temporary','transient'],
    [{http_connection_failed:{http_status_code:429}},'429','rate_limited'],
    [{http_connection_failed:{http_status_code:401}},'401','other'],
    [{http_connection_failed:{http_status_code:503}},'503','transient'], ['unknown','unrecognized','other'],
  ]) assert.equal(codexFailureCategory(complete({message,codex_error_info:info})),expected);
  for(const record of [{type:'response_item',payload:{type:'message',role:'user',content:capacity}},
    {type:'event_msg',payload:{type:'user_message',message:capacity}},complete(null)]) assert.equal(codexFailureCategory(record),null);
  for(const [status,text,expected] of [[529,'overloaded','capacity'],[429,'limit','rate_limited'],[503,'temporary','transient'],
    [401,'unauthorized','other'],[null,"You've reached your Fable limit. Run /usage-credits to continue or switch models with /model.",'rate_limited']]) {
    const error=claudeApiErrorFromLine(JSON.stringify({type:'assistant',isApiErrorMessage:true,apiErrorStatus:status,message:{content:text}}));
    assert.equal(claudeFailureCategory(error),expected);
  }
  assert.equal(claudeApiErrorFromLine(JSON.stringify({type:'assistant',isApiErrorMessage:true,isSidechain:true})),null);
});

test('input reservation rejects malformed identity and keeps 64 bit native file identities without number rounding',()=>{
  const marker={schema:'aiterm.claude-operation-marker.v3',event_cursor:0,operation_id:null,input_id:'a'.repeat(32),
    transcript:{session_id:'session',cursor:0,device:'9007199254740993',inode:'18446744073709551615'}};
  assert.equal(parseClaudeOperationMarker(marker).transcript.inode,'18446744073709551615');
  for(const changed of [{input_id:'x'},{event_cursor:-1},{transcript:{...marker.transcript,inode:42}},
    {transcript:{...marker.transcript,device:null}},{transcript:{...marker.transcript,unexpected:true}}])
    assert.throws(()=>parseClaudeOperationMarker({...marker,...changed}));
  assert.equal(parseClaudeOperationMarker({schema:'aiterm.claude-operation-marker.v1',operation_id:null}).eventCursor,null);
});

test('bound wait and all remote shells retain the same input identity and reject option injection',()=>{
  const input='a'.repeat(32);
  assert.equal(parseArgs(['--session','child','--cursor','0','--input',input]).inputId,input);
  for(const args of [['--session','child','--input',input],['--session','child','--cursor','0','--input','invalid'],
    ['--session','child','--cursor','0','--input',input,'--input',input],
    ['--session','child','--cursor','0','--input',input,'--steer','b'.repeat(16)]]) assert.throws(()=>parseArgs(args));
  for(const shell of ['posix','powershell','cmd']) {
    assert.match(remoteWaitCommand(shell,'child',0,null,1,input),new RegExp('--input '+input));
    assert.throws(()=>remoteWaitCommand(shell,'child',0,null,1,'x; command'));
  }
});
