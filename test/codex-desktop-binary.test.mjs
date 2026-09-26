import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { currentCodexDesktopBinary } from "../dist/codex-desktop-binary.js";
import { desktopBundledCodex } from "../dist/setup-codex-relay.js";

const config = (binary) => ({
  schema: "aiterm.codex-parent-hooks.v1", enabled: true, codex_home: "/home/u/.codex", binary,
  command: "node hook.js", node: "/usr/bin/node", hook: "/opt/aiterm/dist/codex-parent-hook.js", stale_processes: [],
});

test("currentCodexDesktopBinary: 保存した場所が残っていればそのまま使い、探し直さない", async () => {
  const binary = await currentCodexDesktopBinary(config("/apps/codex"), { exists: () => true, find: () => assert.fail("探し直さない") });
  assert.equal(binary, "/apps/codex");
});

test("currentCodexDesktopBinary: Desktop更新で消えた場所は探し直し、設定を書き換える", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-desktop-binary-"));
  // Windows実測: 版ごとのcache directoryが13995fba801849b0からd23520d1e41bfb24へ替わった。
  const stale = config("C:\\Users\\u\\AppData\\Local\\OpenAI\\Codex\\bin\\13995fba801849b0\\codex.exe");
  const fresh = "C:\\Users\\u\\AppData\\Local\\OpenAI\\Codex\\bin\\d23520d1e41bfb24\\codex.exe";
  const binary = await currentCodexDesktopBinary(stale, { directory, exists: () => false, find: () => fresh });
  assert.equal(binary, fresh);
  const saved = JSON.parse(fs.readFileSync(path.join(directory, "config.json"), "utf8"));
  assert.deepEqual(saved, { ...stale, binary: fresh });
  fs.rmSync(directory, { recursive: true, force: true });
});

test("currentCodexDesktopBinary: 探し直せなければ理由付きで失敗し、別のCodexへ切り替えない", async () => {
  await assert.rejects(
    currentCodexDesktopBinary(config("/gone/codex"), { exists: () => false, find: () => { throw new Error("Codex Desktopのインストール先を一つに特定できません"); } }),
    (error) => error.delivery_code === "CODEX_DESKTOP_BINARY_MOVED" && /aiterm-setup --codex-steer enable/.test(error.message),
  );
});

test("desktopBundledCodex: ChatGPT.appの新旧どちらの同梱場所も見つける", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-desktop-app-"));
  const app = path.join(root, "ChatGPT.app");
  const current = path.join(app, "Contents", "Resources", "codex-cli", "CodexCLI.app", "Contents", "MacOS", "codex");
  assert.equal(desktopBundledCodex(app), null);
  fs.mkdirSync(path.join(app, "Contents", "Resources"), { recursive: true });
  fs.writeFileSync(path.join(app, "Contents", "Resources", "codex"), "");
  assert.equal(desktopBundledCodex(app), path.join(app, "Contents", "Resources", "codex"));
  fs.mkdirSync(path.dirname(current), { recursive: true });
  fs.writeFileSync(current, "");
  assert.equal(desktopBundledCodex(app), current, "新しい配置を優先する");
  fs.rmSync(root, { recursive: true, force: true });
});
