#!/usr/bin/env node
// Upload the built runtime (docs/architecture/remote-terminal.md R17) to the GitHub Release v<version>:
//   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo node scripts/upload-runtime-assets.mjs <version> <outDir>
// Published assets are never replaced: tarballs first, SHA256SUMS last; a release that already has SHA256SUMS is done.
import fs from "node:fs";
import path from "node:path";

const [version, outDir] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
if (!/^\d+\.\d+\.\d+$/.test(version ?? "") || !outDir || !token || !repo) {
  process.stderr.write("usage: GITHUB_TOKEN=.. GITHUB_REPOSITORY=owner/repo node scripts/upload-runtime-assets.mjs <x.y.z> <outDir>\n");
  process.exit(2);
}
const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
const api = async (url, init = {}) => {
  const response = await fetch(url, { ...init, headers: { ...headers, ...init.headers } });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${url}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
};

const release = await api(`https://api.github.com/repos/${repo}/releases/tags/v${version}`);
const existing = new Set(release.assets.map(asset => asset.name));
const sums = `aiterm-runtime-${version}-SHA256SUMS`;
if (existing.has(sums)) { process.stdout.write(`v${version} already has ${sums}; nothing replaced\n`); process.exit(0); }
const tarballs = fs.readdirSync(outDir).filter(name => name.startsWith(`aiterm-runtime-${version}-darwin-`) && name.endsWith(".tar.gz")).sort();
if (tarballs.length !== 2) throw new Error(`expected 2 runtime tarballs in ${outDir}, found ${tarballs.length}`);
const partial = tarballs.filter(name => existing.has(name));
// A tarball from another build would not match this build's SHA256SUMS.
if (partial.length) throw new Error(`v${version} already has ${partial.join(", ")} without ${sums}; delete those assets and run again`);
for (const name of [...tarballs, sums]) {
  const body = fs.readFileSync(path.join(outDir, name));
  const uploaded = await api(`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
    method: "POST", headers: { "content-type": name.endsWith(".gz") ? "application/gzip" : "text/plain" }, body });
  process.stdout.write(`uploaded ${uploaded.name} (${uploaded.size} bytes)\n`);
}
