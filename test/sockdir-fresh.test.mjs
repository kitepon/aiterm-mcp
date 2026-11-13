import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createCodexAgentMetadata} from '../dist/harnesses/codex.js';
import {ensureStateRoot} from '../dist/agent-shared.js';
import {writeAgentLifecycle} from '../dist/agent-lifecycle.js';
import {SOCK, SOCKDIR} from '../dist/tmux-runtime.js';
const core = await import('../dist/core.js');

test('a hibernated seat closes on a fresh container before any launch created SOCKDIR (a46 lab)', () => {
  ensureStateRoot();
  const meta = createCodexAgentMetadata('sockdir_fresh', process.env.HOME, 'none', {}, undefined,
    {agentRole:'subagent',parentSessionId:'test-parent',delegationDepth:1,lineage:'test-parent>codex:sockdir_fresh',delegationAllowed:true});
  writeAgentLifecycle(meta, {schema:'aiterm.agent-lifecycle.v1',launch_id:meta.launch_id,state:'hibernated',socket:SOCK,
    at:new Date().toISOString(),anchor:'fixture',native_id:'$1',recipe_digest:'a'.repeat(64),
    pane:{pid:1,process_group_id:null,started_identity:'fixture-only',argv_digest:'b'.repeat(64)}});
  fs.rmSync(SOCKDIR, {recursive: true, force: true});
  assert.equal(core.closeSessionResult('sockdir_fresh').outcome, 'closed');
});
