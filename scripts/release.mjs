#!/usr/bin/env node

// releaseの正規入口。version同期、CHANGELOG見出し、metadata検査、commit、push、tag、MCPB、
// GitHub Releaseまでを一回で行う。npm publishはtag起点のCIが行い、本scriptはその完了を待たない。

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version = process.argv[2];
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  process.stderr.write("releaseはnpm run release -- <version>から起動してください。\n");
  process.exit(2);
}
if (!/^\d+\.\d+\.\d+$/u.test(version ?? "")) {
  process.stderr.write("usage: npm run release -- <x.y.z>\n");
  process.exit(2);
}

const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options })?.trim();
const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};
const readText = (file) => readFileSync(path.join(root, file), "utf8");
const writeText = (file, text) => writeFileSync(path.join(root, file), text, "utf8");
const readJson = (file) => JSON.parse(readText(file));
const writeJson = (file, value) => writeText(file, `${JSON.stringify(value, null, 2)}\n`);

if (run("git", ["branch", "--show-current"]) !== "main") fail("releaseはmainからだけ行います。");
if (run("git", ["status", "--porcelain"]) !== "") fail("working treeに未commitの変更があります。先にcommitしてください。");
run("git", ["fetch", "--no-tags", "origin", "main"]);
if (run("git", ["rev-parse", "HEAD"]) !== run("git", ["rev-parse", "origin/main"])) fail("HEADがorigin/mainと一致しません。先にpushまたはpullしてください。");

const pkg = readJson("package.json");
const previous = pkg.version;
if (previous === version) fail(`package.jsonは既に${version}です。`);
if (run("git", ["tag", "--list", `v${version}`]) !== "") fail(`tag v${version}は既に存在します。`);

// CHANGELOG: Unreleasedの本文を新versionへ移す。
const changelog = readText("CHANGELOG.md");
const unreleased = changelog.match(/^## \[Unreleased\]\n\n([\s\S]*?)(?=^## \[)/mu);
if (!unreleased) fail("CHANGELOG.mdに## [Unreleased]がありません。");
if (unreleased[1].trim() === "") fail("CHANGELOG.mdのUnreleasedが空です。release内容を先に書いてください。");
const date = new Date().toISOString().slice(0, 10);
const repo = "https://github.com/kitepon/aiterm-mcp";
let nextChangelog = changelog.replace(
  /^## \[Unreleased\]\n\n/mu,
  `## [Unreleased]\n\n## [${version}] - ${date}\n\n`,
);
const unreleasedLink = `[Unreleased]: ${repo}/compare/v${previous}...HEAD`;
if (!nextChangelog.includes(unreleasedLink)) fail(`CHANGELOG.mdに「${unreleasedLink}」がありません。`);
nextChangelog = nextChangelog.replace(
  unreleasedLink,
  `[Unreleased]: ${repo}/compare/v${version}...HEAD\n[${version}]: ${repo}/compare/v${previous}...v${version}`,
);
writeText("CHANGELOG.md", nextChangelog);

// version同期。
pkg.version = version;
writeJson("package.json", pkg);
const lock = readJson("package-lock.json");
lock.version = version;
lock.packages[""].version = version;
writeJson("package-lock.json", lock);
const server = readJson("server.json");
server.version = version;
for (const entry of server.packages) entry.version = version;
writeJson("server.json", server);
const manifest = readJson("mcpb/manifest.json");
manifest.version = version;
writeJson("mcpb/manifest.json", manifest);
for (const readme of ["README.md", "README.ja.md"]) {
  const text = readText(readme);
  const marker = `v${previous}`;
  if (text.split(marker).length !== 2) fail(`${readme}に現行公開版 ${marker} が1箇所だけある前提が崩れています。`);
  writeText(readme, text.replace(marker, `v${version}`));
}

// clean cloneでも配布物を検査できるよう、検査前に現行metadataからbuildする。
run(process.execPath, [npmCli, "run", "build"], { stdio: "inherit" });
run(process.execPath, ["--test", "test/release-metadata.test.mjs", "test/repository-contract.test.mjs"], { stdio: "inherit" });

const files = [
  "CHANGELOG.md", "package.json", "package-lock.json", "server.json", "mcpb/manifest.json", "README.md", "README.ja.md",
];
run("git", ["add", "--", ...files]);
run("git", ["commit", "--quiet", "-m", `${version}を公開する`, "--", ...files]);
run("git", ["push", "origin", "main"], { stdio: "inherit" });
run("git", ["tag", `v${version}`]);
run("git", ["push", "origin", `v${version}`], { stdio: "inherit" });

// Windowsのnpm.cmdも、起動元npmのJS入口をNodeへ渡してshell差を吸収する。
run(process.execPath, [npmCli, "run", "mcpb:build"], { stdio: "inherit" });
const escaped = version.replace(/\./gu, "\\.");
const notes = nextChangelog.match(new RegExp(`^## \\[${escaped}\\][^\\n]*\\n\\n([\\s\\S]*?)(?=^## \\[)`, "mu"))[1].trim();
run("gh", ["release", "create", `v${version}`, "dist/aiterm-mcp.mcpb", "--title", `v${version}`, "--notes", notes], { stdio: "inherit" });

process.stdout.write([
  `v${version}: main push、tag、GitHub Releaseまで完了。`,
  "npm publishはtag起点のCI、Official Registry登録はrelease起点のCIが進めます。",
  `確認: npm view aiterm-mcp@${version} version`,
  "",
].join("\n"));
