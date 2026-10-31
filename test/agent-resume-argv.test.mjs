import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {claudeAgentArgv,claudeResumeArgv} from '../dist/harnesses/claude.js';
import {codexAgentArgv,codexResumeArgv} from '../dist/harnesses/codex.js';
const session='11111111-2222-4333-8444-555555555555';
const meta={aiterm_session:'resume-argv',launch_id:'a'.repeat(32),vendor_session_id:session,node_platform:process.platform,
 agent_role:'subagent',parent_session_id:'host-root',delegation_depth:1,lineage:'host-root>codex:resume-argv',delegation_allowed:true};

test('Claude resume retains launch settings but selects the saved ID without a new session or initial body',()=>{
 const m={...meta,kind:'claude',claude_settings:'settings with spaces.json'};
 const expected=claudeAgentArgv('claude-fixture','model','high',null,m);
 expected[expected.indexOf('--session-id')]='--resume';
 const argv=claudeResumeArgv('claude-fixture','model','high',m);
 assert.deepEqual(argv,expected);assert.equal(argv[argv.indexOf('--resume')+1],session);
 assert.equal(argv.includes('--fork-session'),false);assert.equal(argv.includes('--continue'),false);
});
test('Codex resume explicitly selects the thread and cwd, retaining all launch overrides without a prompt',()=>{
 const m={...meta,kind:'codex',hook_route:'shared_codex_home',write_scope:'read-only'};
 const original=codexAgentArgv('codex-fixture','model','high',null,m);
 const argv=codexResumeArgv('codex-fixture','model','high',m,process.env.HOME);
 assert.deepEqual(argv,['codex-fixture','resume',session,...original.slice(1),'--cd',process.env.HOME]);
 assert.equal(argv.includes('--last'),false);assert.equal(argv.includes('fork'),false);
});
test('unknown or non-ID conversations and unknown cwd cannot fall back to a picker or new conversation',()=>{
 for(const id of [null,'','session title','../file','--last']){
  assert.throws(()=>claudeResumeArgv('claude',null,null,{...meta,kind:'claude',vendor_session_id:id}),/AGENT_RESUME_UNSUPPORTED/);
  assert.throws(()=>codexResumeArgv('codex',null,null,{...meta,kind:'codex',vendor_session_id:id},process.env.HOME),/AGENT_RESUME_UNSUPPORTED/);
 }
 assert.throws(()=>claudeResumeArgv('claude',null,null,{...meta,kind:'grok'}));
 for(const cwd of ['relative','bad\0cwd'])assert.throws(()=>codexResumeArgv('codex',null,null,{...meta,kind:'codex'},cwd));
});
