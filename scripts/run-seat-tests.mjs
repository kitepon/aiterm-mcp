#!/usr/bin/env node
import '../test/seat-env.mjs';
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';

const args = process.argv.slice(2);
const valid = file => file === 'test/*.test.mjs'
  ? readdirSync('test').some(name => name.endsWith('.test.mjs'))
  : /^(?:test|scripts)\/(?:[\w-]+\/)*[\w.-]+\.test\.mjs$/.test(file) && statSync(file, { throwIfNoEntry: false })?.isFile();
if (args[0] !== '--test' || args.length < 2 || !args.slice(1).every(valid)) {
  throw new Error('test files must be explicit repository tests or test/*.test.mjs');
}
// node --test preloads only its workers; this parent owns their Windows temp tree.
const result = spawnSync(process.execPath, ['--import', './test/seat-env.mjs', ...args], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
