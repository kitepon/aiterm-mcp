// runtime-error-storeの試験（runtime-error-store*.test.mjs）が共有する準備。試験は入れない。
// 1つだった試験fileを2つに分けたのは、fileの中の試験が1本ずつ順に走るため（Windowsでは保存のたびに権限の設定を確かめるので、
// この1 fileで236秒かかっていた）。
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  RUNTIME_ERROR_DEFINITIONS,
  RuntimeErrorStore,
  defaultRuntimeErrorPaths,
  recordRuntimeError,
  runtimeErrorStoreDiagnostic,
  validateRuntimeObservation,
  windowsPrivateDaclCommand,
  windowsPrivateDaclVerifyCommand,
} from "../dist/runtime-error-store.js";
import { expectedHostProfiles } from "../dist/runtime-error-os.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_URL = pathToFileURL(path.join(HERE, "..", "dist", "core.js")).href;
const STORE_URL = pathToFileURL(path.join(HERE, "..", "dist", "runtime-error-store.js")).href;
const actualProfile = () => process.platform === "darwin" ? "mac"
  : process.platform === "win32" ? "windows-native"
    : (process.env.WSL_DISTRO_NAME || /microsoft/i.test(os.release()) ? "wsl" : "server");

function applyWindowsPrivateAcl(target, kind = "file") {
  if (process.platform !== "win32") return;
  const command = windowsPrivateDaclCommand(target, kind);
  const result = spawnSync(command.command, command.args, { encoding: "utf8", windowsHide: true, env: command.env });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

function fixture(enabled = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-runtime-errors-"));
  const configPath = path.join(root, "config.json");
  const storePath = path.join(root, "state", "runtime-errors.json");
  const platform = process.platform === "win32" ? "win32" : "darwin";
  const profile = platform === "win32" ? "windows-native" : "mac";
  fs.writeFileSync(configPath, JSON.stringify({
    schema_version: "1.0",
    host: { id: "test-host", profile },
    collection: { enabled },
    reporting: { enabled: false },
  }), { mode: 0o600 });
  applyWindowsPrivateAcl(configPath);
  let now = Date.parse("2026-07-13T00:00:00.000Z");
  const stderr = [];
  const store = new RuntimeErrorStore({
    configPath,
    storePath,
    platform,
    arch: "arm64",
    productVersion: "0.12.1-test",
    now: () => new Date(now),
    stderr: (line) => stderr.push(line),
  });
  return {
    root, configPath, storePath, store, stderr, platform, profile,
    tick(ms = 1000) { now += ms; },
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

export { HERE, CORE_URL, STORE_URL, actualProfile, applyWindowsPrivateAcl, fixture };
