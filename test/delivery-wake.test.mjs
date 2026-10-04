import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, after } from "node:test";
import { fileURLToPath } from "node:url";
import { shouldWakeForDeliveries } from "../dist/delivery-wake-cli.js";

const base = mkdtempSync(join(tmpdir(), "aiterm-delivery-wake-"));
after(() => rmSync(base, { recursive: true, force: true }));
const STARTED = "Sun Oct  4 04:29:50 2026";
const startedAt = Date.parse(STARTED);
let seq = 0;
function stateWith(directory, owner, records) {
  const root = join(base, `state-${seq++}`);
  const ownerDir = join(root, directory, "active", `${owner.pid}-0123456789abcdef-owner`);
  mkdirSync(ownerDir, { recursive: true });
  writeFileSync(join(ownerDir, "owner.json"), JSON.stringify(owner));
  for (const id of records) writeFileSync(join(ownerDir, `${id}.json`), "{}");
  return root;
}
const alive = { exists: () => true, started_at: () => startedAt };
const gone = { exists: () => false, started_at: () => null };

test("生きている持ち主の配送と、記録の無い持ち主では起こさない", () => {
  const owner = { pid: 4242, started_identity: STARTED, closed: false };
  assert.equal(shouldWakeForDeliveries(stateWith("cursor-parent-deliveries", owner, ["a"]), "cursor", alive), false);
  assert.equal(shouldWakeForDeliveries(stateWith("cursor-parent-deliveries", owner, []), "cursor", gone), false);
  assert.equal(shouldWakeForDeliveries(join(base, "no-state"), "cursor", gone), false);
});

test("終了した持ち主・closeした持ち主・pidが再利用された持ち主の配送が残っていれば起こす", () => {
  const owner = { pid: 4242, started_identity: STARTED, closed: false };
  assert.equal(shouldWakeForDeliveries(stateWith("cursor-parent-deliveries", owner, ["a"]), "cursor", gone), true);
  assert.equal(shouldWakeForDeliveries(stateWith("claude-parent-deliveries", { ...owner, closed: true }, ["a"]), "claude", alive), true);
  assert.equal(shouldWakeForDeliveries(stateWith("parent-deliveries", owner, ["a"]), "codex", { exists: () => true, started_at: () => startedAt + 60_000 }), true);
  assert.equal(shouldWakeForDeliveries(stateWith("remote-parent-deliveries", owner, ["a"]), "codex", gone), true);
  // 開始時刻を照合できないOSでは、pidがあれば生きている扱いにする。
  assert.equal(shouldWakeForDeliveries(stateWith("parent-deliveries", owner, ["a"]), "codex", { exists: () => true, started_at: () => null }), false);
});

test("別の種類の親の配送では起こさない", () => {
  const root = stateWith("claude-parent-deliveries", { pid: 4242, started_identity: STARTED, closed: false }, ["a"]);
  assert.equal(shouldWakeForDeliveries(root, "cursor", gone), false);
  assert.equal(shouldWakeForDeliveries(root, "codex", gone), false);
  assert.equal(shouldWakeForDeliveries(root, "claude", gone), true);
});

test("同じ配送で起こすのは1席だけ。引き取られないまま30秒過ぎたら次の判定が起こす", () => {
  const root = stateWith("cursor-parent-deliveries", { pid: 4242, started_identity: STARTED, closed: false }, ["a"]);
  const claims = join(root, "cursor-parent-deliveries", "wake-claims");
  assert.equal(shouldWakeForDeliveries(root, "cursor", gone), true);
  assert.equal(shouldWakeForDeliveries(root, "cursor", gone), false);
  const [claim] = readdirSync(claims);
  const past = (Date.now() - 31_000) / 1000;
  utimesSync(join(claims, claim), past, past);
  assert.equal(shouldWakeForDeliveries(root, "cursor", gone), true);
  assert.equal(shouldWakeForDeliveries(root, "cursor", gone), false);
  // 本体が引き取ると、持ち主の下から記録が無くなる。印も片付く。
  rmSync(join(root, "cursor-parent-deliveries", "active", claim, "a.json"));
  assert.equal(shouldWakeForDeliveries(root, "cursor", gone), false);
  assert.deepEqual(readdirSync(claims), []);
});

test("コマンドは exit 0=起こす / 1=眠ったまま / 2=引数の誤り で返し、stdoutへ何も出さない", { skip: process.platform === "win32" }, () => {
  const cli = fileURLToPath(new URL("../dist/delivery-wake-cli.js", import.meta.url));
  const run = (stateBase, ...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, AITERM_STATE_BASE: stateBase } });
  const stateBase = join(base, "cli");
  const ownerDir = join(stateBase, `aiterm-mcp-${process.getuid()}`, "cursor-parent-deliveries", "active", "1-0123456789abcdef-owner");
  mkdirSync(ownerDir, { recursive: true });
  writeFileSync(join(ownerDir, "owner.json"), JSON.stringify({ pid: 2 ** 22 + 1, started_identity: STARTED, closed: false }));
  assert.equal(run(stateBase, "--parent", "cursor").status, 1);
  writeFileSync(join(ownerDir, "a.json"), "{}");
  const wake = run(stateBase, "--parent", "cursor");
  assert.deepEqual([wake.status, wake.stdout], [0, ""]);
  assert.equal(run(stateBase, "--parent", "cursor").status, 1);
  assert.equal(run(stateBase, "--parent", "claude").status, 1);
  assert.equal(run(stateBase, "--parent", "grok").status, 2);
  assert.equal(run(stateBase).status, 2);
});
