// The installer's preserve/reset input (docs/architecture/runtime-adoption.md "State volume declaration"). Pure data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const file = new URL('../state-compat.json', import.meta.url);
const declaration = JSON.parse(readFileSync(file, 'utf8'));
const overlap = JSON.parse(readFileSync(new URL('../runtime-overlap.json', import.meta.url), 'utf8'));
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

test('state-compat.json follows aiterm.state-compat.v1 and ships in the package', () => {
  assert.ok(statSync(file).size <= 64 * 1024);
  assert.ok(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).files.includes('state-compat.json'));
  assert.equal(declaration.schema, 'aiterm.state-compat.v1');
  const paths = [];
  for (const [id, store] of Object.entries(declaration.stores)) {
    assert.match(id, ID);
    const segments = store.path.split('/');
    assert.ok(!store.path.startsWith('/') && !store.path.startsWith('.bellteam-'));
    assert.ok(segments.every(s => s && s !== '.' && s !== '..'));
    paths.push(store.path);
    for (const format of [store.writes, ...store.reads, ...store.resets]) assert.match(format, ID);
    assert.ok(store.reads.includes(store.writes));
    // A format is either read or reset, never both; nothing readable may be discarded.
    assert.ok(store.resets.every(format => !store.reads.includes(format)));
    for (const range of store.legacy) {
      assert.match(range.from, VERSION); assert.match(range.through, VERSION);
      assert.ok(cmp(range.from, range.through) <= 0);
      assert.ok(store.reads.includes(range.format) || store.resets.includes(range.format));
    }
  }
  for (const a of paths) for (const b of paths) if (a !== b) assert.ok(!b.startsWith(`${a}/`), `${b} nests in ${a}`);
});

test('state-root v1 is exactly the runtime-overlap stores at their v1 formats', () => {
  // When any overlap store changes format, split it into its own state-compat store before writing it.
  for (const [store, entry] of Object.entries(overlap.stores)) {
    const v1 = store === 'provider-hooks' ? 'steer-v1' : 'v1';
    assert.equal(entry.writes, v1, store);
    assert.ok(entry.reads.includes(v1), store);
  }
  assert.equal(declaration.stores['state-root'].writes, 'v1');
});
