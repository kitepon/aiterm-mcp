#!/usr/bin/env node
// Isolated diagnostic branch only: this is not a product regression gate.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
for (const args of [['scripts/clean-build.mjs'], ['node_modules/typescript/bin/tsc'], ['--import', './test/seat-env.mjs', '--test', 'test/seat-env.test.mjs']]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
process.argv = [process.execPath, path.resolve('scripts/windows-input-boundary-diagnostic.mjs'), process.cwd(), path.resolve('diagnostic-evidence'), 'load-parent'];
await import(pathToFileURL(process.argv[1]));
