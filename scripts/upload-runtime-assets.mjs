#!/usr/bin/env node
// Upload the built runtime (docs/architecture/remote-terminal.md R17) to the GitHub Release v<version>:
//   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo node scripts/upload-runtime-assets.mjs <version> <outDir>
// <outDir> holds the four tarballs (darwin and linux, arm64 and x64) and the Windows zip (win32-x64) collected from the build jobs; the one SHA256SUMS
// is computed here over exactly those files. Published assets are never replaced: tarballs first, SHA256SUMS last;
// a release that already has SHA256SUMS is done.
import { createHash } from "node:crypto";
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
// One fixed list: the SHA256SUMS names exactly these five files, which is what every terminal bootstrap looks its own up in.
const runtimeAssets = (version) => [...["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].map(platform => `aiterm-runtime-${version}-${platform}.tar.gz`), `aiterm-runtime-${version}-win32-x64.zip`];
const tarballs = runtimeAssets(version);
const missing = tarballs.filter(name => !fs.existsSync(path.join(outDir, name)));
if (missing.length) throw new Error(`runtime assets missing in ${outDir}: ${missing.join(", ")}`);
fs.writeFileSync(path.join(outDir, sums), tarballs.map(name => `${createHash("sha256").update(fs.readFileSync(path.join(outDir, name))).digest("hex")}  ${name}`).join("\n") + "\n");
const partial = tarballs.filter(name => existing.has(name));
// A tarball from another build would not match this build's SHA256SUMS.
if (partial.length) throw new Error(`v${version} already has ${partial.join(", ")} without ${sums}; delete those assets and run again`);
for (const name of [...tarballs, sums]) {
  const body = fs.readFileSync(path.join(outDir, name));
  const uploaded = await api(`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
    method: "POST", headers: { "content-type": name.endsWith(".gz") ? "application/gzip" : name.endsWith(".zip") ? "application/zip" : "text/plain" }, body });
  process.stdout.write(`uploaded ${uploaded.name} (${uploaded.size} bytes)\n`);
}
