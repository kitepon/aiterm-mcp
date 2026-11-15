import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
// Z43 (Kiro, 2026-11-15): a Claude root's settings.json can be a symlink to a shared file. The restore after a typed /model must
// edit the real file (not replace the link with a copy), and a dangling lock link must not hang the process.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { restoreJsonSetting, withUserConfigLock } = await import("../dist/user-config.js");
const base = fs.mkdtempSync(path.join(os.tmpdir(), "uc-link-"));
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

test("restoreJsonSetting writes through a symlinked settings.json and keeps the link", () => {
  const real = path.join(base, "shared-settings.json");
  const link = path.join(base, "root-settings.json");
  fs.writeFileSync(real, '{"a":1}\n');
  fs.symlinkSync(real, link);
  const before = fs.readFileSync(link);
  fs.writeFileSync(real, '{"a":1,"model":"opus"}\n'); // what Claude Code saves as the default
  assert.equal(restoreJsonSetting(link, before, "model"), true);
  assert.ok(fs.lstatSync(link).isSymbolicLink(), "the link stays a link");
  assert.equal(fs.readFileSync(real, "utf8"), '{"a":1}\n', "the shared file itself is restored");
});

test("withUserConfigLock locks the real file and does not hang on a dangling lock link", async () => {
  const real = path.join(base, "s2.json");
  const link = path.join(base, "r2.json");
  fs.writeFileSync(real, "{}");
  fs.symlinkSync(real, link);
  fs.symlinkSync(`${real}.aiterm-lock`, `${link}.aiterm-lock`); // the BellTeam layout: the lock link points at a lock that does not exist
  const old = new Date(Date.now() - 600_000);
  fs.lutimesSync(`${link}.aiterm-lock`, old, old);
  let ran = false;
  await Promise.race([
    withUserConfigLock(link, async () => { ran = true; }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("the lock wait hung")), 5000)),
  ]);
  assert.ok(ran);
  assert.equal(fs.existsSync(`${real}.aiterm-lock`), false, "the lock is released");
});
