#!/usr/bin/env node
// Build the provisioned terminal runtime (docs/architecture/remote-terminal.md R16/R17) on macOS:
//   node scripts/build-macos-runtime.mjs <version> <outDir> [--package <npm spec or .tgz>]
// -> <outDir>/aiterm-runtime-<version>-darwin-{arm64,x64}.tar.gz and aiterm-runtime-<version>-SHA256SUMS.
// Each tarball holds the official Node binary, the published aiterm-mcp with production dependencies, wrappers, and a
// tmux that links libevent, utf8proc and jemalloc statically and only macOS system libraries otherwise.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [version, outArg, ...rest] = process.argv.slice(2);
if (process.platform !== "darwin" || !/^\d+\.\d+\.\d+$/.test(version ?? "") || !outArg) {
  process.stderr.write("usage (macOS): node scripts/build-macos-runtime.mjs <x.y.z> <outDir> [--package <spec|tgz>]\n");
  process.exit(2);
}
const at = rest.indexOf("--package");
const packageSpec = at >= 0 ? path.resolve(rest[at + 1]) : `aiterm-mcp@${version}`;
const out = path.resolve(outArg);
const work = path.join(out, ".work");
fs.mkdirSync(path.join(work, "dl"), { recursive: true });

// Pinned inputs; bump together with their sha256.
const NODE = "22.23.4";
const SOURCES = {
  "node-arm64": [`https://nodejs.org/dist/v${NODE}/node-v${NODE}-darwin-arm64.tar.gz`, "c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428"],
  "node-x64": [`https://nodejs.org/dist/v${NODE}/node-v${NODE}-darwin-x64.tar.gz`, "efcc2b0db6f94bf53eddb038fe2b370277a042bd29e4f19b8f8e23598795b819"],
  tmux: ["https://github.com/tmux/tmux/releases/download/3.8/tmux-3.8.tar.gz", "e79c699c7e949dccd0a4a125e17b8d1261e311b16979dbc8eb34542f3966d82e"],
  libevent: ["https://github.com/libevent/libevent/releases/download/release-2.1.13-stable/libevent-2.1.13-stable.tar.gz", "f7e9383b8c0baa81b687e5b5eecc01beefaf1b19b64151d95ed61647fe7a315c"],
  utf8proc: ["https://github.com/JuliaStrings/utf8proc/releases/download/v2.12.0/utf8proc-2.12.0.tar.gz", "a393fbef160835fb315bc3e91ba8d86f7a73a7cec9e6198b6c60b848b498bfeb"],
  // tmux requires jemalloc on macOS (configure: macOS calloc(3) may not zero some allocations).
  jemalloc: ["https://github.com/jemalloc/jemalloc/releases/download/5.4.0/jemalloc-5.4.0.tar.bz2", "200776fac271093e7c2f21edd6d62657ecd2be578d9328633f2a86bfa6ef4f1d"],
};
// lgPage: Apple silicon 16 KiB pages, Intel 4 KiB (jemalloc cannot probe it when cross-compiling).
const ARCHES = { arm64: { clang: "arm64", triple: "aarch64-apple-darwin", min: "11.0", lgPage: "14" }, x64: { clang: "x86_64", triple: "x86_64-apple-darwin", min: "10.15", lgPage: "12" } };
const hostArch = process.arch === "arm64" ? "arm64" : "x64";
// Compilers see only the system toolchain, never Homebrew headers, libraries or pkg-config.
const CLEAN_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"], ...options });
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function fetchPinned(key) {
  const [url, want] = SOURCES[key];
  const file = path.join(work, "dl", path.basename(url));
  if (!fs.existsSync(file) || sha256(file) !== want) {
    // Builds block the event loop for minutes, so a pooled keep-alive socket can be closed by the server by the
    // next download ("fetch failed"). A new attempt takes a new connection; the pinned sha256 still decides.
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`download ${url}: HTTP ${response.status}`);
        fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
        break;
      } catch (error) {
        console.error(`download ${url} attempt ${attempt}: ${error.message}${error.cause ? ` (${error.cause.code ?? error.cause.message})` : ""}`);
        if (attempt >= 3) throw error;
      }
    }
  }
  if (sha256(file) !== want) throw new Error(`sha256 mismatch for ${url}`);
  return file;
}

function extract(archive, into) {
  fs.rmSync(into, { recursive: true, force: true });
  fs.mkdirSync(into, { recursive: true });
  run("tar", ["-xf", archive, "-C", into, "--strip-components", "1"]);
  return into;
}

async function buildTmux(arch) {
  const a = ARCHES[arch];
  const prefix = path.join(work, `deps-${arch}`);
  fs.rmSync(prefix, { recursive: true, force: true });
  fs.mkdirSync(path.join(prefix, "include"), { recursive: true });
  fs.mkdirSync(path.join(prefix, "lib"), { recursive: true });
  const cc = `clang -arch ${a.clang} -mmacosx-version-min=${a.min}`;
  const env = { PATH: CLEAN_PATH, HOME: os.homedir(), CC: cc, CFLAGS: "-O2", PKG_CONFIG: "/usr/bin/false", MACOSX_DEPLOYMENT_TARGET: a.min };
  const cross = arch === hostArch ? [] : [`--build=${ARCHES[hostArch].triple}`, `--host=${a.triple}`];
  const jobs = String(os.availableParallelism());

  const libevent = extract(await fetchPinned("libevent"), path.join(work, `libevent-${arch}`));
  run("./configure", [`--prefix=${prefix}`, "--disable-shared", "--enable-static", "--disable-openssl", "--disable-samples",
    "--disable-libevent-regress", "--disable-debug-mode", "--disable-dependency-tracking", ...cross], { cwd: libevent, env });
  run("make", ["-j", jobs], { cwd: libevent, env });
  run("make", ["install"], { cwd: libevent, env });

  const utf8proc = extract(await fetchPinned("utf8proc"), path.join(work, `utf8proc-${arch}`));
  run("make", ["libutf8proc.a", `CC=${cc}`, "CFLAGS=-O2"], { cwd: utf8proc, env });
  fs.copyFileSync(path.join(utf8proc, "libutf8proc.a"), path.join(prefix, "lib", "libutf8proc.a"));
  fs.copyFileSync(path.join(utf8proc, "utf8proc.h"), path.join(prefix, "include", "utf8proc.h"));

  // Unprefixed (tmux calls mallctl), static only.
  const jemalloc = extract(await fetchPinned("jemalloc"), path.join(work, `jemalloc-${arch}`));
  run("./configure", [`--prefix=${prefix}`, "--with-jemalloc-prefix=", "--disable-cxx", `--with-lg-page=${a.lgPage}`, ...cross], { cwd: jemalloc, env });
  run("make", ["-j", jobs, "build_lib_static"], { cwd: jemalloc, env });
  run("make", ["install_include", "install_lib_static"], { cwd: jemalloc, env });

  const tmux = extract(await fetchPinned("tmux"), path.join(work, `tmux-${arch}`));
  const inc = `-I${path.join(prefix, "include")}`;
  run("./configure", ["--enable-utf8proc", "--enable-jemalloc", "--with-TERM=screen-256color", "--disable-dependency-tracking", ...cross], { cwd: tmux, env: { ...env,
    CPPFLAGS: inc, LDFLAGS: `-L${path.join(prefix, "lib")}`,
    LIBEVENT_CORE_CFLAGS: inc, LIBEVENT_CORE_LIBS: path.join(prefix, "lib", "libevent_core.a"),
    LIBUTF8PROC_CFLAGS: inc, LIBUTF8PROC_LIBS: path.join(prefix, "lib", "libutf8proc.a"),
    // force_load: the archive's macOS malloc-zone registration has no referenced symbol and would be dropped otherwise.
    JEMALLOC_CFLAGS: inc, JEMALLOC_LIBS: `-Wl,-force_load,${path.join(prefix, "lib", "libjemalloc.a")}` } });
  run("make", ["-j", jobs], { cwd: tmux, env });
  return path.join(tmux, "tmux");
}

/** Only macOS system libraries, and the expected architecture. */
function checkBinary(file, arch) {
  const archs = execFileSync("lipo", ["-archs", file], { encoding: "utf8" }).trim();
  if (archs !== ARCHES[arch].clang) throw new Error(`${file}: architectures ${archs}, expected ${ARCHES[arch].clang}`);
  const libs = execFileSync("otool", ["-L", file], { encoding: "utf8" }).split("\n").slice(1).map(line => line.trim().split(" ")[0]).filter(Boolean);
  const foreign = libs.filter(lib => !lib.startsWith("/usr/lib/") && !lib.startsWith("/System/"));
  if (foreign.length) throw new Error(`${file} links non-system libraries: ${foreign.join(", ")}`);
}

const WRAPPER = (script) => `#!/bin/sh
# Aiterm provisioned runtime: the bundled Node only; runtime bin (aiterm-*, tmux) first on PATH.
R=$(cd "$(dirname "$0")/.." && pwd)
PATH="$R/bin:$PATH"; export PATH
exec "$R/node/bin/node" "$R/lib/node_modules/aiterm-mcp/${script}" "$@"
`;
const WRAPPED = ["aiterm-mcp", "aiterm-wait", "aiterm-remote-terminal", "aiterm-transcript-read"];

process.on("uncaughtException", (error) => { process.stderr.write(`${error?.stack ?? error}\n`); process.exit(1); });
try {
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
for (const arch of Object.keys(ARCHES)) {
  const name = `aiterm-runtime-${version}-darwin-${arch}`;
  const root = path.join(work, "stage", name);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  fs.mkdirSync(path.join(root, "node", "bin"), { recursive: true });
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  const node = extract(await fetchPinned(`node-${arch}`), path.join(work, `node-${arch}`));
  fs.copyFileSync(path.join(node, "bin", "node"), path.join(root, "node", "bin", "node"));
  fs.copyFileSync(path.join(node, "LICENSE"), path.join(root, "node", "LICENSE"));
  fs.chmodSync(path.join(root, "node", "bin", "node"), 0o755);
  run("cp", ["-R", path.join(pkgDir, "node_modules"), path.join(root, "lib", "node_modules")]);
  const tmux = await buildTmux(arch);
  fs.copyFileSync(tmux, path.join(root, "bin", "tmux"));
  fs.chmodSync(path.join(root, "bin", "tmux"), 0o755);
  for (const bin of WRAPPED) {
    const script = installed.bin?.[bin];
    if (!script) throw new Error(`package has no bin ${bin}`);
    fs.writeFileSync(path.join(root, "bin", bin), WRAPPER(script.replace(/^\.\//, "")), { mode: 0o755 });
  }
  fs.writeFileSync(path.join(root, "RUNTIME"), `${name}\n`);
  checkBinary(path.join(root, "bin", "tmux"), arch);
  checkBinary(path.join(root, "node", "bin", "node"), arch);
  const tarball = path.join(out, `${name}.tar.gz`);
  run("tar", ["-czf", tarball, "-C", path.dirname(root), name], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  sums.push(`${sha256(tarball)}  ${name}.tar.gz`);
  if (arch === hostArch) {
    // The host architecture runs: extract the tarball as a terminal would and run its smoke.
    const smoke = fs.mkdtempSync(path.join("/tmp", "aiterm-runtime-smoke-"));
    try {
      run("tar", ["-xzf", tarball, "-C", smoke]);
      const tmuxBin = path.join(smoke, name, "bin", "tmux"), socket = path.join(smoke, "t.sock");
      run(tmuxBin, ["-f", "/dev/null", "-S", socket, "new-session", "-d", "sleep 30"]);
      const term = execFileSync(tmuxBin, ["-S", socket, "show-options", "-gv", "default-terminal"], { encoding: "utf8" }).trim();
      run(tmuxBin, ["-S", socket, "kill-server"]);
      if (term !== "screen-256color") throw new Error(`tmux default-terminal is ${term}`);
      run(path.join(smoke, name, "bin", "aiterm-remote-terminal"), ["runtime-smoke", "--expect-version", version], { stdio: ["ignore", "inherit", "inherit"] });
    } finally { fs.rmSync(smoke, { recursive: true, force: true }); }
  }
}
fs.writeFileSync(path.join(out, `aiterm-runtime-${version}-SHA256SUMS`), `${sums.join("\n")}\n`);
fs.rmSync(path.join(work, "stage"), { recursive: true, force: true });
process.stdout.write(`${sums.join("\n")}\n`);
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
}
process.exit(0);
