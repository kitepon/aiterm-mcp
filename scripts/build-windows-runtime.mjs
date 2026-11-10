#!/usr/bin/env node
// Build the provisioned terminal runtime for Windows x64 (docs/architecture/remote-terminal.md R16/R17), no compilation:
//   node scripts/build-windows-runtime.mjs <version> <outDir> [--package <npm spec or .tgz>]
// -> <outDir>/aiterm-runtime-<version>-win32-x64.zip and aiterm-runtime-<version>-win32-SHA256SUMS.
// The zip holds the official Node win-x64 build, the published aiterm-mcp with production dependencies and CRLF bin\*.cmd
// wrappers (the same four names as the POSIX runtimes), and bin\psmux.exe from the pinned official psmux release (MIT), so
// the terminal needs no psmux of its own. Runs on a windows-latest runner (tar.exe writes the zip); elsewhere it needs zip and unzip.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [version, outArg, ...rest] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? "") || !outArg) {
  process.stderr.write("usage: node scripts/build-windows-runtime.mjs <x.y.z> <outDir> [--package <spec|tgz>]\n");
  process.exit(2);
}
const at = rest.indexOf("--package");
const packageSpec = at >= 0 ? path.resolve(rest[at + 1]) : `aiterm-mcp@${version}`;
const out = path.resolve(outArg);
const work = path.join(out, ".work");
fs.mkdirSync(path.join(work, "dl"), { recursive: true });

// Pinned like the other builders (same Node release); the zip must also match the published SHASUMS256.txt.
const NODE = "22.23.4";
const NODE_ZIP = `node-v${NODE}-win-x64.zip`;
const NODE_SHA256 = "cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20";
const DIST = `https://nodejs.org/dist/v${NODE}`;
// psmux: the version Aiterm requires at least (tmux-runtime.ts psmuxVersionSupported), official windows-x64 release zip.
const PSMUX = "3.3.8";
const PSMUX_ZIP = `psmux-v${PSMUX}-windows-x64.zip`;
const PSMUX_SHA256 = "1ad127ba937194a890b933a73d9b023e297bd73dc742abd841bf159984c2effe";
const onWindows = process.platform === "win32";

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"], ...options });
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
// bsdtar (Windows' own System32\tar.exe) reads and writes zip; elsewhere unzip and zip do. Named by path: on a runner
// whose PATH has Git's GNU tar first, "tar" reads "D:\..." as a remote host.
const bsdtar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
const unzip = (zip, dir) => (onWindows ? run(bsdtar, ["-xf", zip, "-C", dir]) : run("unzip", ["-q", zip, "-d", dir]));
const zipUp = (zip, parent, name) => (onWindows ? run(bsdtar, ["-a", "-cf", zip, "-C", parent, name]) : run("zip", ["-qr", zip, name], { cwd: parent }));

async function download(url, file) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`download ${url}: HTTP ${response.status}`);
      fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      return;
    } catch (error) {
      console.error(`download ${url} attempt ${attempt}: ${error.message}`);
      if (attempt >= 3) throw error;
    }
  }
}

// CRLF: cmd.exe reads a batch file line by line and a lone LF can split a command at the wrong byte.
const WRAPPER = (script) => [
  "@echo off",
  "rem Aiterm provisioned runtime: the bundled Node and psmux; runtime bin first on PATH.",
  "setlocal",
  'set "PATH=%~dp0;%PATH%"',
  'set "AITERM_PSMUX=%~dp0psmux.exe"',
  `"%~dp0..\\node\\node.exe" "%~dp0..\\lib\\node_modules\\aiterm-mcp\\${script.replace(/\//g, "\\")}" %*`,
  "exit /b %ERRORLEVEL%",
  "",
].join("\r\n");
const WRAPPED = ["aiterm-mcp", "aiterm-wait", "aiterm-remote-terminal", "aiterm-transcript-read"];

function find(dir, wanted) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...find(file, wanted));
    else if (wanted.test(entry.name)) found.push(file);
  }
  return found;
}

process.on("uncaughtException", (error) => { process.stderr.write(`${error?.stack ?? error}\n`); process.exit(1); });
try {
  const sumsFile = path.join(work, "dl", `SHASUMS256-${NODE}.txt`);
  await download(`${DIST}/SHASUMS256.txt`, sumsFile);
  const published = new Map(fs.readFileSync(sumsFile, "utf8").split("\n").map((line) => line.trim().split(/\s+/)).filter((f) => f.length === 2).map(([sum, name]) => [name, sum]));

  const pkgDir = path.join(work, "package");
  fs.rmSync(pkgDir, { recursive: true, force: true });
  fs.mkdirSync(pkgDir, { recursive: true });
  run(onWindows ? "npm.cmd" : "npm", ["install", "--prefix", pkgDir, "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts", "--no-package-lock", packageSpec], { shell: onWindows });
  const installed = JSON.parse(fs.readFileSync(path.join(pkgDir, "node_modules", "aiterm-mcp", "package.json"), "utf8"));
  if (installed.version !== version) throw new Error(`installed aiterm-mcp ${installed.version}, expected ${version}`);
  const native = find(path.join(pkgDir, "node_modules"), /\.node$/);
  if (native.length) throw new Error(`native addons would tie the package to one platform: ${native.join(", ")}`);

  const name = `aiterm-runtime-${version}-win32-x64`;
  const archive = path.join(work, "dl", NODE_ZIP);
  await download(`${DIST}/${NODE_ZIP}`, archive);
  if (sha256(archive) !== NODE_SHA256 || sha256(archive) !== published.get(NODE_ZIP)) throw new Error(`sha256 mismatch for ${NODE_ZIP}`);
  const node = path.join(work, "node-win");
  fs.rmSync(node, { recursive: true, force: true });
  fs.mkdirSync(node, { recursive: true });
  unzip(archive, node);
  const nodeRoot = path.join(node, `node-v${NODE}-win-x64`);
  const root = path.join(work, "stage", name);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  fs.mkdirSync(path.join(root, "node"), { recursive: true });
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.copyFileSync(path.join(nodeRoot, "node.exe"), path.join(root, "node", "node.exe"));
  fs.copyFileSync(path.join(nodeRoot, "LICENSE"), path.join(root, "node", "LICENSE"));
  fs.cpSync(path.join(pkgDir, "node_modules"), path.join(root, "lib", "node_modules"), { recursive: true });
  for (const bin of WRAPPED) {
    const script = installed.bin?.[bin];
    if (!script) throw new Error(`package has no bin ${bin}`);
    fs.writeFileSync(path.join(root, "bin", `${bin}.cmd`), WRAPPER(script.replace(/^\.\//, "")));
  }
  const psmuxArchive = path.join(work, "dl", PSMUX_ZIP);
  await download(`https://github.com/psmux/psmux/releases/download/v${PSMUX}/${PSMUX_ZIP}`, psmuxArchive);
  if (sha256(psmuxArchive) !== PSMUX_SHA256) throw new Error(`sha256 mismatch for ${PSMUX_ZIP}`);
  const psmuxDir = path.join(work, "psmux");
  fs.rmSync(psmuxDir, { recursive: true, force: true });
  fs.mkdirSync(psmuxDir, { recursive: true });
  unzip(psmuxArchive, psmuxDir);
  fs.copyFileSync(path.join(psmuxDir, "psmux.exe"), path.join(root, "bin", "psmux.exe"));
  fs.copyFileSync(path.join(psmuxDir, "LICENSE"), path.join(root, "bin", "psmux.LICENSE"));
  fs.writeFileSync(path.join(root, "RUNTIME"), `${name}\n`);
  const zip = path.join(out, `${name}.zip`);
  fs.rmSync(zip, { force: true });
  zipUp(zip, path.dirname(root), name);
  const sum = `${sha256(zip)}  ${name}.zip`;
  if (onWindows) {
    // The runner can run it: extract the zip as a terminal would, call the wrapper and its bundled psmux.
    const smoke = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? process.env.TEMP ?? out, "aiterm-runtime-smoke-"));
    try {
      unzip(zip, smoke);
      const probe = Buffer.from("C:\\", "utf8").toString("base64");
      const result = JSON.parse(execFileSync(path.join(smoke, name, "bin", "aiterm-remote-terminal.cmd"), ["path-status", "--path-base64", probe], { encoding: "utf8", shell: true }).trim());
      if (result.exists !== true || result.directory !== true) throw new Error(`smoke: path-status of C:\\ answered ${JSON.stringify(result)}`);
      const psmuxVersion = execFileSync(path.join(smoke, name, "bin", "psmux.exe"), ["-V"], { encoding: "utf8" });
      // psmux -V prints a "tmux X" line before its own "psmux X (...)" line.
      if (!new RegExp(`^psmux ${PSMUX.replaceAll(".", "\\.")}\\b`, "m").test(psmuxVersion)) throw new Error(`smoke: bundled psmux answered ${psmuxVersion}`);
    } finally { fs.rmSync(smoke, { recursive: true, force: true }); }
  } else process.stdout.write("not a Windows host: the zip was built but not run\n");
  fs.writeFileSync(path.join(out, `aiterm-runtime-${version}-win32-SHA256SUMS`), `${sum}\n`);
  fs.rmSync(path.join(work, "stage"), { recursive: true, force: true });
  process.stdout.write(`${sum}\n`);
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
}
process.exit(0);
