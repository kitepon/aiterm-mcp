#!/usr/bin/env node
// Build the provisioned terminal runtime for Linux (docs/architecture/remote-terminal.md R16/R17):
//   node scripts/build-linux-runtime.mjs <version> <outDir> [--package <npm spec or .tgz>]
// -> <outDir>/aiterm-runtime-<version>-linux-{x64,arm64}.tar.gz and aiterm-runtime-<version>-linux-SHA256SUMS.
// Each tarball holds the official Node binary, the published aiterm-mcp with production dependencies, the same bin/
// wrappers as the macOS runtime and a fully static tmux (musl; libevent, utf8proc and ncurses linked in). Both
// architectures are cross-built on any Linux host with zig 0.15.2 from PyPI (`pip install ziglang==0.15.2`; set
// ZIGLANG_PYTHON to the python that has it), the same toolchain as scripts/build-write-ban.mjs.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
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

// tmux, libevent and utf8proc are the macOS builder's pins; bump them together with their sha256. machine: ELF e_machine.
const SOURCES = {
  tmux: ["https://github.com/tmux/tmux/releases/download/3.8/tmux-3.8.tar.gz", "e79c699c7e949dccd0a4a125e17b8d1261e311b16979dbc8eb34542f3966d82e"],
  libevent: ["https://github.com/libevent/libevent/releases/download/release-2.1.13-stable/libevent-2.1.13-stable.tar.gz", "f7e9383b8c0baa81b687e5b5eecc01beefaf1b19b64151d95ed61647fe7a315c"],
  utf8proc: ["https://github.com/JuliaStrings/utf8proc/releases/download/v2.12.0/utf8proc-2.12.0.tar.gz", "a393fbef160835fb315bc3e91ba8d86f7a73a7cec9e6198b6c60b848b498bfeb"],
  ncurses: ["https://ftp.gnu.org/gnu/ncurses/ncurses-6.5.tar.gz", "136d91bc269a9a5785e5f9e980bc76ab57428f604ce3e5a5a90cebc767971cc6"],
};
const TARGETS = {
  x64: { zig: "x86_64-linux-musl", gnu: "x86_64-pc-linux-gnu", machine: 62 },
  arm64: { zig: "aarch64-linux-musl", gnu: "aarch64-unknown-linux-gnu", machine: 183 },
};
// Terminals ncurses answers from its own table when the terminal has no terminfo database or lacks the entry.
const FALLBACKS = "screen-256color,tmux-256color,xterm-256color,xterm,screen,tmux,linux,vt100,dumb,ansi";
const python = process.env.ZIGLANG_PYTHON ?? "python3";

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

async function fetchPinned(key) {
  const [url, want] = SOURCES[key];
  const file = path.join(work, "dl", path.basename(url));
  if (!fs.existsSync(file) || sha256(file) !== want) await download(url, file);
  if (sha256(file) !== want) throw new Error(`sha256 mismatch for ${url}`);
  return file;
}

function extract(archive, into) {
  fs.rmSync(into, { recursive: true, force: true });
  fs.mkdirSync(into, { recursive: true });
  run("tar", ["-xf", archive, "-C", into, "--strip-components", "1"]);
  return into;
}

/** zig cc/ar/ranlib as plain executables for the architecture, so configure scripts can use them as CC/AR/RANLIB. */
function zigTools(arch) {
  const dir = path.join(work, "zig-bin");
  fs.mkdirSync(dir, { recursive: true });
  const tool = (name, args) => { const file = path.join(dir, name); fs.writeFileSync(file, `#!/bin/sh\nexec '${python}' -m ziglang ${args} "$@"\n`, { mode: 0o755 }); return file; };
  return { cc: tool(`cc-${arch}`, `cc -target ${TARGETS[arch].zig}`), ar: tool("ar", "ar"), ranlib: tool("ranlib", "ranlib") };
}

/** A fully static musl tmux for the architecture. Returns the prefix holding the dependencies and the tmux binary. */
async function buildTmux(arch) {
  const t = TARGETS[arch];
  const prefix = path.join(work, `deps-${arch}`);
  fs.rmSync(prefix, { recursive: true, force: true });
  fs.mkdirSync(path.join(prefix, "include"), { recursive: true });
  fs.mkdirSync(path.join(prefix, "lib"), { recursive: true });
  const { cc, ar, ranlib } = zigTools(arch);
  // pkg-config is off: nothing of the build machine's libraries can be found.
  const env = { ...process.env, CC: cc, AR: ar, RANLIB: ranlib, CFLAGS: "-O2", PKG_CONFIG: "/usr/bin/false" };
  const cross = arch === hostArch ? [] : [`--build=${TARGETS[hostArch].gnu}`, `--host=${t.zig}`];
  const jobs = String(os.availableParallelism());

  const libevent = extract(await fetchPinned("libevent"), path.join(work, `libevent-${arch}`));
  run("./configure", [`--prefix=${prefix}`, "--disable-shared", "--enable-static", "--disable-openssl", "--disable-samples",
    "--disable-libevent-regress", "--disable-debug-mode", "--disable-dependency-tracking", ...cross], { cwd: libevent, env });
  run("make", ["-j", jobs], { cwd: libevent, env });
  run("make", ["install"], { cwd: libevent, env });

  const utf8proc = extract(await fetchPinned("utf8proc"), path.join(work, `utf8proc-${arch}`));
  run("make", ["libutf8proc.a", `CC=${cc}`, `AR=${ar}`, "CFLAGS=-O2"], { cwd: utf8proc, env });
  fs.copyFileSync(path.join(utf8proc, "libutf8proc.a"), path.join(prefix, "lib", "libutf8proc.a"));
  fs.copyFileSync(path.join(utf8proc, "utf8proc.h"), path.join(prefix, "include", "utf8proc.h"));

  // The terminal's own terminfo database is read first (the usual directories); the fallback entries answer when it has
  // none, so tmux starts on a machine without ncurses-base. Compiling them needs tic/infocmp that run on the build
  // machine: the native build's own, or for the other architecture the host architecture's (built first).
  const ncurses = extract(await fetchPinned("ncurses"), path.join(work, `ncurses-${arch}`));
  const hostTools = arch === hostArch ? [] : [`--with-build-cc=${zigTools(hostArch).cc}`,
    `--with-tic-path=${path.join(work, `deps-${hostArch}`, "bin", "tic")}`, `--with-infocmp-path=${path.join(work, `deps-${hostArch}`, "bin", "infocmp")}`];
  run("./configure", [`--prefix=${prefix}`, "--without-shared", "--without-debug", "--without-ada", "--without-cxx", "--without-cxx-binding",
    "--without-manpages", "--without-tests", "--without-gpm", "--disable-stripping", "--enable-pc-files=no", `--with-fallbacks=${FALLBACKS}`,
    "--with-terminfo-dirs=/etc/terminfo:/lib/terminfo:/usr/share/terminfo:/usr/lib/terminfo", "--with-default-terminfo-dir=/usr/share/terminfo",
    ...cross, ...hostTools], { cwd: ncurses, env });
  run("make", ["-j", jobs], { cwd: ncurses, env });
  run("make", ["install.libs", "install.includes", "install.progs"], { cwd: ncurses, env });

  const tmux = extract(await fetchPinned("tmux"), path.join(work, `tmux-${arch}`));
  const inc = `-I${path.join(prefix, "include")}`;
  // The tarball carries the generated cmd-parse.c; YACC=true only satisfies configure's check, so no yacc is needed.
  fs.utimesSync(path.join(tmux, "cmd-parse.c"), new Date(), new Date());
  run("./configure", ["--enable-utf8proc", "--with-TERM=screen-256color", "--disable-dependency-tracking", ...cross], { cwd: tmux, env: { ...env, YACC: "true",
    CPPFLAGS: inc, LDFLAGS: `-static -s -L${path.join(prefix, "lib")}`,
    LIBEVENT_CORE_CFLAGS: inc, LIBEVENT_CORE_LIBS: path.join(prefix, "lib", "libevent_core.a"),
    LIBUTF8PROC_CFLAGS: inc, LIBUTF8PROC_LIBS: path.join(prefix, "lib", "libutf8proc.a"),
    LIBNCURSESW_CFLAGS: `${inc}/ncursesw`, LIBNCURSESW_LIBS: path.join(prefix, "lib", "libncursesw.a") } });
  run("make", ["-j", jobs], { cwd: tmux, env });
  return path.join(tmux, "tmux");
}

/** A statically linked (no interpreter, no dynamic section) 64-bit little-endian ELF executable of the architecture. */
function checkBinary(file, arch) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) !== 0x7f454c46 || b[4] !== 2 || b[5] !== 1) throw new Error(`${file}: not a 64-bit little-endian ELF file`);
  if (b.readUInt16LE(18) !== TARGETS[arch].machine) throw new Error(`${file}: ELF machine ${b.readUInt16LE(18)}, expected ${TARGETS[arch].machine}`);
  const phoff = Number(b.readBigUInt64LE(32)), size = b.readUInt16LE(54), count = b.readUInt16LE(56);
  for (let i = 0; i < count; i++) {
    const type = b.readUInt32LE(phoff + i * size);
    if (type === 2 || type === 3) throw new Error(`${file} is not statically linked (program header type ${type})`);
  }
}

/** The extracted runtime's tmux with no terminfo database in reach: version, default terminal, a session that echoes. */
function smokeTmux(tmuxBin, dir) {
  const socket = path.join(dir, "t.sock");
  const env = { ...process.env, SHELL: "/bin/sh", TERM: "xterm-256color", TERMINFO_DIRS: path.join(dir, "no-terminfo") };
  const out = (args) => execFileSync(tmuxBin, ["-f", "/dev/null", "-S", socket, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (!/^tmux \d+\.\d+/.test(execFileSync(tmuxBin, ["-V"], { env, encoding: "utf8" }))) throw new Error("tmux -V gave no version");
  try {
    out(["new-session", "-d", "-x", "80", "-y", "24", "echo aiterm-tmux-smoke; sleep 30"]);
    const term = out(["show-options", "-gv", "default-terminal"]).trim();
    if (term !== "screen-256color") throw new Error(`tmux default-terminal is ${term}`);
    for (let i = 0; ; i++) {
      if (out(["capture-pane", "-p"]).includes("aiterm-tmux-smoke")) break;
      if (i >= 50) throw new Error("tmux pane never showed the smoke text");
      execFileSync("sleep", ["0.1"]);
    }
  } finally { try { out(["kill-server"]); } catch { /* no server */ } }
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
  // The host architecture first: its tic/infocmp compile the other architecture's ncurses fallbacks.
  for (const arch of [hostArch, ...Object.keys(NODES).filter((a) => a !== hostArch)]) {
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
    fs.copyFileSync(await buildTmux(arch), path.join(root, "bin", "tmux"));
    fs.chmodSync(path.join(root, "bin", "tmux"), 0o755);
    for (const bin of WRAPPED) {
      const script = installed.bin?.[bin];
      if (!script) throw new Error(`package has no bin ${bin}`);
      fs.writeFileSync(path.join(root, "bin", bin), WRAPPER(script.replace(/^\.\//, "")), { mode: 0o755 });
    }
    fs.writeFileSync(path.join(root, "RUNTIME"), `${name}\n`);
    checkBinary(path.join(root, "bin", "tmux"), arch);
    const tarball = path.join(out, `${name}.tar.gz`);
    run("tar", ["-czf", tarball, "-C", path.dirname(root), name]);
    sums.push(`${sha256(tarball)}  ${name}.tar.gz`);
    if (arch === hostArch) {
      // The host architecture runs: extract the tarball as a terminal would, start its tmux and run its smoke.
      const smoke = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "aiterm-runtime-smoke-"));
      try {
        run("tar", ["-xzf", tarball, "-C", smoke]);
        smokeTmux(path.join(smoke, name, "bin", "tmux"), smoke);
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
