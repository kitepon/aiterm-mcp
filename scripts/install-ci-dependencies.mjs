#!/usr/bin/env node
// Test the reviewed Steer release source before its npm publication. Seed only
// the exact lockfile artifact; npm ci still owns dependency resolution/install.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const receipt = JSON.parse(readFileSync(path.join(root, 'scripts/fixtures/steer-release-source.json'), 'utf8'));
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const artifact = path.join(root, 'scripts/fixtures', receipt.file);
const integrity = 'sha512-' + createHash('sha512').update(readFileSync(artifact)).digest('base64');
const dependency = lock.packages['node_modules/aiterm-steer-delivery'];
if (!/^[0-9a-f]{40}$/.test(receipt.commit) || integrity !== receipt.integrity
  || dependency.version !== receipt.version || dependency.integrity !== integrity
  || dependency.resolved !== `https://registry.npmjs.org/aiterm-steer-delivery/-/aiterm-steer-delivery-${receipt.version}.tgz`)
  throw new Error('reviewed producer source archive and consumer lockfile must match');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('run with npm run ci:dependencies');
const cache = path.join(root, '.cache/native-dependency-ci');
for (const args of [['cache', 'add', artifact, '--cache', cache], ['ci', '--cache', cache, '--no-audit', '--no-fund']]) {
  const child = spawnSync(process.execPath, [npmCli, ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}
const installed = JSON.parse(readFileSync(path.join(root, 'node_modules/aiterm-steer-delivery/package.json'), 'utf8'));
if (installed.version !== receipt.version) throw new Error('installed producer version differs from the reviewed source');
console.log(`Steer ${receipt.version} source ${receipt.commit}: lockfile integrity matched; registry publication is a separate release step`);
