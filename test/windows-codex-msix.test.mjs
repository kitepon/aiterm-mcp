import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { quotePowerShell } from '../dist/windows-codex-state.js';

const family = process.env.AITERM_TEST_CODEX_PACKAGE;
const binary = process.env.AITERM_TEST_CODEX_BINARY;
test('Windows: MSIX仮想AppDataから起動しても中継initializeとEOFが成功する', {
  skip: process.platform !== 'win32' || !family || !binary,
  timeout: 60_000,
}, async t => {
  // AppData外に観測結果を置き、package境界をまたいで同じファイルを読む。
  const prefix = join(homedir(), 'aiterm-msix-test-');
  const work = mkdtempSync(prefix);
  t.after(() => {
    assert.ok(work.startsWith(prefix));
    rmSync(work, { recursive: true, force: true });
  });
  const name = `aiterm-msix-test-${randomUUID()}`;
  const args = [resolve('test/fixtures/windows-codex-msix.mjs'), process.cwd(), work, name, binary]
    .map(value => `"${value}"`).join(' ');
  execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Invoke-CommandInDesktopPackage -PackageFamilyName ${quotePowerShell(family)} -AppId App -Command ${quotePowerShell(process.execPath)} -Args ${quotePowerShell(args)}`,
  ], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
  const result = join(work, 'result.json');
  const deadline = Date.now() + 35_000;
  while (!existsSync(result) && Date.now() < deadline) await setTimeout(100);
  assert.ok(existsSync(result), 'MSIX試験processの結果を確認できること');
  const report = JSON.parse(readFileSync(result, 'utf8'));
  assert.equal(report.error, undefined, JSON.stringify(report.error));
  assert.equal(report.initialize_and_eof, true);
  assert.equal(existsSync(report.logical), false, 'MSIXの試験領域を片付けること');
  t.diagnostic(JSON.stringify({ msix_virtualized: report.logical !== report.physical, initialize_and_eof: true, version: report.version }));
});
