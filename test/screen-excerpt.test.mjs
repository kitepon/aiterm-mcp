import './seat-env.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startupScreenExcerpt} from '../dist/screen-excerpt.js';

test('the excerpt keeps the last 20 non-empty lines and drops blank lines and control codes',()=>{
  const screen=Array.from({length:30},(_,i)=>`line ${i+1}\x1b[31m\n\n`).join('');
  const lines=startupScreenExcerpt(screen).split('\n');
  assert.equal(lines.length,20);
  assert.equal(lines[0],'line 11');
  assert.equal(lines.at(-1),'line 30');
});
test('URL queries, long opaque tokens, secret-named values and e-mail are masked; plain words stay',()=>{
  const out=startupScreenExcerpt([
    'Visit https://claude.ai/oauth/authorize?code=true&state=abc123def456 to log in',
    'token sk-ant-oat01-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
    'ANTHROPIC_API_KEY=hunter2',
    'Paste code here if prompted > ',
    'mail someone@example.com',
    'Press Enter to continue… ',
  ].join('\n'));
  assert.doesNotMatch(out,/state=abc123|AbCdEf|hunter2|someone@|code=true/u);
  assert.match(out,/https:\/\/claude\.ai\/oauth\/authorize\?\[masked\]/u);
  assert.match(out,/Press Enter to continue…$/u);
  assert.match(startupScreenExcerpt('Welcome to Claude Code v2.1.332'),/Claude Code v2\.1\.332/u);
  assert.equal(startupScreenExcerpt("bell@host:/srv/x$ eval \"AITERM_AGENT_KIND='claude' KEY=v\"\nSelect login method:"),'Select login method:');
  assert.match(out,/\[email\]/u);
});
test('no readable screen gives null; a huge screen is capped',()=>{
  assert.equal(startupScreenExcerpt('  \n \n'),null);
  assert.equal(startupScreenExcerpt(undefined),null);
  assert.ok(startupScreenExcerpt(('x'.repeat(5000)+'\n').repeat(20)).length<=3000);
});
