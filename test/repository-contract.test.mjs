import './seat-env.mjs'; // 最初のimportに置く（ADR 0121）
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  assertPackedMarkdownClosed,
  documentTargets,
} from '../scripts/markdown-pack-contract.mjs';

// npm 12 は `npm pack --json` を package 名を key にした object で返す（npm 11 までは配列）。両方を受ける。
const packedEntry = (packed) => (Array.isArray(packed) ? packed[0] : Object.values(packed)[0]);
const execFileAsync = promisify(execFile);
const root = new URL('..', import.meta.url);

test('npm pack内の全Markdownは相対linkと画像をpack内だけで解決する', async () => {
  const { stdout } = await execFileAsync(
    'npm',
    ['pack', '--dry-run', '--ignore-scripts', '--json'],
    { cwd: root, maxBuffer: 16 * 1024 * 1024, shell: process.platform === 'win32' },
  );
  const files = new Set(packedEntry(JSON.parse(stdout)).files.map((file) => file.path));
  const markdownFiles = [...files].filter((path) => path.endsWith('.md'));
  assert.ok(markdownFiles.length > 0, 'npm packにMarkdownが含まれていません');

  for (const markdownPath of markdownFiles) {
    const source = await readFile(new URL(markdownPath, root), 'utf8');
    assertPackedMarkdownClosed(files, markdownPath, source);
  }
});

test('Markdown ASTはreference、nested、HTMLの実効targetだけを抽出する', () => {
  const targets = documentTargets(`
[![badge](https://img.example/badge.svg)](docs/badges.md)
[API](docs/api_(v1).md)

![hero][asset]

[asset]: images/hero.png

\`[inline code](missing-inline.md)\`

\`\`\`md
[fenced code](missing-fenced.md)
\`\`\`

<a href="docs/a&amp;b.md"><img src="images/direct.png" srcset="data:image/svg+xml,%3Csvg%3E 1x, images/two.png 2x">
`);

  assert.deepEqual(targets, [
    'docs/badges.md',
    'https://img.example/badge.svg',
    'docs/api_(v1).md',
    'images/hero.png',
    'docs/a&b.md',
    'images/direct.png',
    'data:image/svg+xml,%3Csvg%3E',
    'images/two.png',
  ]);
});

test('reference-styleの欠落targetもnpm pack閉包違反にする', () => {
  assert.throws(
    () => assertPackedMarkdownClosed(
      new Set(['README.md']),
      'README.md',
      '![hero][asset]\n\n[asset]: images/missing.png',
    ),
    /images\/missing\.png/,
  );
});

test('製品CIはlocal full、Markdown文書検査、tag/version一致を所有する', async () => {
  const workflowDirectory = new URL('../.github/workflows/', import.meta.url);
  const workflowFiles = (await readdir(workflowDirectory)).filter((path) => /\.ya?ml$/.test(path));
  const workflows = await Promise.all(workflowFiles.map(async (path) => ({
    path,
    source: await readFile(new URL(path, workflowDirectory), 'utf8'),
  })));
  for (const workflow of workflows) {
    assert.doesNotMatch(
      workflow.source,
      /uses:\s*kitepon\/dotagents\/\.github\/workflows\//,
      `${workflow.path}が外部dotagents workflowへ依存しています`,
    );
  }

  const ci = workflows.find((workflow) => workflow.path === 'ci.yml')?.source ?? '';
  const productFull = workflows.find(
    (workflow) => workflow.path === 'product-full-ci.yml',
  )?.source ?? '';
  const registry = workflows.find((workflow) => workflow.path === 'registry.yml')?.source ?? '';
  assert.match(ci, /uses:\s*\.\/\.github\/workflows\/product-full-ci\.yml\b/);
  assert.match(
    ci,
    /documentation-command:\s*npm run test:docs/,
  );
  // tag公開は他eventのCI結果を待たない。tagがrelease判断であり、祖先確認だけをgateにする。
  assert.doesNotMatch(ci, /gh run list/);
  assert.match(ci, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  assert.match(ci, /schedule:/);
  assert.match(ci, /test "\$GITHUB_REF_NAME" = "v\$version"/);
  assert.match(productFull, /documentation-command:/);
  assert.match(productFull, /scripts\/product-ci-plan\.mjs verify/);
  assert.equal((productFull.match(/shell:\s*pwsh/g) ?? []).length, 3);
  assert.doesNotMatch(productFull, /Progra~1\\Git\\bin\\bash\.exe/);
  assert.match(registry, /if: github\.event_name == 'release'/);
  assert.match(registry, /test "\$RELEASE_TAG" = "v\$version"/);
});

test('現行文書は外部dotagents workflowを製品CIの正本にしない', async () => {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--', '*.md'], { cwd: root });
  const currentPaths = stdout.split('\0').filter(Boolean).filter((path) => (
    path !== 'CHANGELOG.md'
    && !path.startsWith('docs/adr/')
    && !path.startsWith('docs/archive/')
    && !path.startsWith('docs/evidence/')
    && !path.startsWith('rag/')
  ));

  for (const path of currentPaths) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /uses:\s*kitepon\/dotagents\/\.github\/workflows\//,
      `${path}が外部dotagents workflowを呼んでいます`,
    );
    assert.doesNotMatch(
      source,
      /製品CI[^\n]*kitepon\/dotagents[^\n]*共通工場workflowだけを呼び/,
      `${path}が過去のCI所有境界を現行案内しています`,
    );
  }
});

test('ADR 0030は当時の判断を残し、現行CIへの置換を明示する', async () => {
  const adr = await readFile(
    new URL('../docs/adr/0030-release-0.25.1-acceptance.md', import.meta.url),
    'utf8',
  );
  assert.match(adr, /Status: Accepted/);
  assert.match(adr, /2026-08-30置換注記/);
  assert.match(adr, /v0\.25\.1公開受入時点の履歴/);
  assert.match(adr, /\.github\/workflows\/product-full-ci\.yml/);
  assert.match(adr, /dotagentsは工場統合、host wire、runner契約/);
  assert.match(
    adr,
    /製品CIは`kitepon\/dotagents`の共通工場workflowだけを呼び/,
  );
});

test('README画像、archive定義、旧engine履歴は現行事実を示す', async () => {
  const [readme, readmeJa, overview, design, release, oldMcpPlan] = await Promise.all([
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../README.ja.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/00_overview.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/DESIGN.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/RELEASE.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/archive/02_mcp-plan.md', import.meta.url), 'utf8'),
  ]);
  for (const source of [readme, readmeJa]) {
    assert.doesNotMatch(source, /<img src="\.github\//);
    assert.match(source, /https:\/\/raw\.githubusercontent\.com\/kitepon\/aiterm-mcp\/main\/\.github\/og\.png/);
    assert.match(source, /https:\/\/raw\.githubusercontent\.com\/kitepon\/aiterm-mcp\/main\/\.github\/demo\.gif/);
    assert.match(source, /aiterm-mcp@<known-good-version>/);
  }
  assert.match(overview, /完了・棄却・中断・失効・置換/);
  assert.match(design, /完了・棄却・中断・失効・置換済み/);
  assert.match(release, /README\.md.*README\.ja\.md.*現行公開版/);
  assert.match(oldMcpPlan, /line formatting engineは後続実装で成立済み/);
});
