#!/usr/bin/env node
// Build the provisioned terminal runtime for Linux (docs/architecture/remote-terminal.md R16/R17), no compilation:
//   node scripts/build-linux-runtime.mjs <version> <outDir> [--package <npm spec or .tgz>]
// -> <outDir>/aiterm-runtime-<version>-linux-{x64,arm64}.tar.gz and aiterm-runtime-<version>-linux-SHA256SUMS.
// Each tarball holds the official Node binary, the published aiterm-mcp with production dependencies and the same bin/
// wrappers as the macOS runtime. There is no tmux: the terminal's own is used (provision answers PROVISION_TMUX_MISSING without one).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [version, outArg, ...rest] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? "") || !outArg) {
  process.stderr.write("usage: node scripts/build-linux-runtime.mjs <x.y.z> <outDir> [--package <spec|tgz>]\n");
  process.exit(2);
}
const at = rest.indexOf("--package");
const packageSpec = at >= 0 ? path.resolve(rest[at + 1]) : `aiterm-mcp@${version}`;
const out = path.resolve(outArg);
const work = path.join(out, ".work");
fs.mkdirSync(path.join(work, "dl"), { recursive: true });

// Pinned like the macOS builder (same Node release); each tarball must also match the published SHASUMS256.txt.
const NODE = "22.23.4";
const NODES = {
  x64: "b8492284c76a54baf58d61668dd0e41ee0fc98adabf9503d30f05d08f55b4406",
  arm64: "f7a1e486dbc8b286847815b477d4fb5e9fb963ed4489c3e1588853d685f589f9",
};
const DIST = `https://nodejs.org/dist/v${NODE}`;
const hostArch = process.arch === "arm64" ? "arm64" : "x64";

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"], ...options });
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

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

const WRAPPER = (script) => `#!/bin/sh
# Aiterm provisioned runtime: the bundled Node only; runtime bin (aiterm-*) first on PATH. tmux is the system's.
R=$(cd "$(dirname "$0")/.." && pwd)
PATH="$R/bin:$PATH"; export PATH
exec "$R/node/bin/node" "$R/lib/node_modules/aiterm-mcp/${script}" "$@"
`;
const WRAPPED = ["aiterm-mcp", "aiterm-wait", "aiterm-remote-terminal", "aiterm-transcript-read"];

process.on("uncaughtException", (error) => { process.stderr.write(`${error?.stack ?? error}\n`); process.exit(1); });
try {
  const sumsFile = path.join(work, "dl", `SHASUMS256-${NODE}.txt`);
  await download(`${DIST}/SHASUMS256.txt`, sumsFile);
  const published = new Map(fs.readFileSync(sumsFile, "utf8").split("\n").map((line) => line.trim().split(/\s+/)).filter((f) => f.length === 2).map(([sum, name]) => [name, sum]));

  // The package once: pure JavaScript, the same for both architectures.
  const pkgDir = path.join(work, "package");
  fs.rmSync(pkgDir, { recursive: true, force: true });
  fs.mkdirSync(pkgDir, { recursive: true });
  run("npm", ["install", "--prefix", pkgDir, "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts", "--no-package-lock", packageSpec]);
  const installed = JSON.parse(fs.readFileSync(path.join(pkgDir, "node_modules", "aiterm-mcp", "package.json"), "utf8"));
  if (installed.version !== version) throw new Error(`installed aiterm-mcp ${installed.version}, expected ${version}`);
  const native = execFileSync("find", [path.join(pkgDir, "node_modules"), "-name", "*.node"], { encoding: "utf8" }).trim();
  if (native) throw new Error(`native addons would tie the package to one architecture: ${native}`);

  const sums = [];
  for (const arch of Object.keys(NODES)) {
    const name = `aiterm-runtime-${version}-linux-${arch}`;
    const nodeName = `node-v${NODE}-linux-${arch}.tar.gz`;
    const archive = path.join(work, "dl", nodeName);
    await download(`${DIST}/${nodeName}`, archive);
    if (sha256(archive) !== NODES[arch] || sha256(archive) !== published.get(nodeName)) throw new Error(`sha256 mismatch for ${nodeName}`);
    const node = path.join(work, `node-${arch}`);
    fs.rmSync(node, { recursive: true, force: true });
    fs.mkdirSync(node, { recursive: true });
    run("tar", ["-xf", archive, "-C", node, "--strip-components", "1"]);
    const root = path.join(work, "stage", name);
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(path.join(root, "bin"), { recursive: true });
    fs.mkdirSync(path.join(root, "node", "bin"), { recursive: true });
    fs.mkdirSync(path.join(root, "lib"), { recursive: true });
    fs.copyFileSync(path.join(node, "bin", "node"), path.join(root, "node", "bin", "node"));
    fs.copyFileSync(path.join(node, "LICENSE"), path.join(root, "node", "LICENSE"));
    fs.chmodSync(path.join(root, "node", "bin", "node"), 0o755);
    run("cp", ["-R", path.join(pkgDir, "node_modules"), path.join(root, "lib", "node_modules")]);
    for (const bin of WRAPPED) {
      const script = installed.bin?.[bin];
      if (!script) throw new Error(`package has no bin ${bin}`);
      fs.writeFileSync(path.join(root, "bin", bin), WRAPPER(script.replace(/^\.\//, "")), { mode: 0o755 });
    }
    fs.writeFileSync(path.join(root, "RUNTIME"), `${name}\n`);
    const tarball = path.join(out, `${name}.tar.gz`);
    run("tar", ["-czf", tarball, "-C", path.dirname(root), name]);
    sums.push(`${sha256(tarball)}  ${name}.tar.gz`);
    if (arch === hostArch) {
      // The host architecture runs: extract the tarball as a terminal would and run its smoke against the system tmux.
      const smoke = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "aiterm-runtime-smoke-"));
      try {
        run("tar", ["-xzf", tarball, "-C", smoke]);
        run(path.join(smoke, name, "bin", "aiterm-remote-terminal"), ["runtime-smoke", "--expect-version", version]);
      } finally { fs.rmSync(smoke, { recursive: true, force: true }); }
    }
  }
  fs.writeFileSync(path.join(out, `aiterm-runtime-${version}-linux-SHA256SUMS`), `${sums.join("\n")}\n`);
  fs.rmSync(path.join(work, "stage"), { recursive: true, force: true });
  process.stdout.write(`${sums.join("\n")}\n`);
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
}
process.exit(0);
