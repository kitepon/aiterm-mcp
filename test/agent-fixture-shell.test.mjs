import './seat-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFixtureShellReady } from './agent-fixture-shell.mjs';
const marker='<<<AITERM_FAKE_ARGV_DONE>>>';

test('fixture input waits for the argv printer and its child shell prompt', () => {
  assert.equal(agentFixtureShellReady(`PS C:\\repo> encoded-launch-command`,marker),false);
  assert.equal(agentFixtureShellReady(`${marker}\nstarting child shell`,marker),false);
  assert.equal(agentFixtureShellReady('PS C:\\repo> ',marker),false);
  assert.equal(agentFixtureShellReady(`${marker}\r\nPS C:\\repo> `,marker),true);
});

test('fixture readiness rejects a marker echoed inside a shell command', () => {
  assert.equal(agentFixtureShellReady(`echo '${marker}'\nPS C:\\repo> `,marker),false);
});
