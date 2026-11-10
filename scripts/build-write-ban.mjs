#!/usr/bin/env node
// Builds the static Linux fork write-ban helpers (ADR 0140) from native/write-ban/aiterm-write-ban.c.
// Toolchain: zig 0.15.2 from PyPI (`pip install ziglang==0.15.2`), so the bytes are reproducible on any machine.
// `--check` rebuilds into a temp dir and fails when the committed binaries differ from the source.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const src = path.join(root, "native/write-ban/aiterm-write-ban.c");
const check = process.argv.includes("--check");
const out = check ? fs.mkdtempSync(path.join(os.tmpdir(), "write-ban-")) : path.join(root, "native/write-ban");
const python = process.env.ZIGLANG_PYTHON ?? "python3";
let differs = false;
for (const [target, arch] of [["x86_64-linux-musl", "x64"], ["aarch64-linux-musl", "arm64"]]) {
  const file = path.join(out, `linux-${arch}`, "aiterm-write-ban");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = spawnSync(python, ["-m", "ziglang", "cc", "-target", target, "-static", "-Os", "-s", "-Wall", "-Wextra", "-Werror", "-o", file, src], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
  fs.chmodSync(file, 0o755);
  if (check && !fs.readFileSync(file).equals(fs.readFileSync(path.join(root, "native/write-ban", `linux-${arch}`, "aiterm-write-ban")))) {
    console.error(`linux-${arch}/aiterm-write-ban differs from its source`);
    differs = true;
  }
}
if (check) fs.rmSync(out, { recursive: true, force: true });
process.exit(differs ? 1 : 0);
