import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliveryOwnerPrefix, unfinishedDeliveriesOwnedBy } from "../dist/parent-delivery-owners.js";

// pty_observeのpending_child_deliveries。席が親として待っている子の結果を、配送の記録の持ち主から数える。
test("持ち主が渡したprocessの中に居る、届け終えていない配送だけを数える", t => {
  const root = mkdtempSync(join(tmpdir(), "aiterm-delivery-owners-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const mine = { pid: 4321, started_identity: "Sat Oct  3 10:28:48 2026" };
  const sameSeat = { pid: 4400, started_identity: "Sat Oct  3 10:40:00 2026" };
  const other = { pid: 9999, started_identity: "Sat Oct  3 10:29:02 2026" };
  const reused = { pid: 4321, started_identity: "Fri Oct  2 01:00:00 2026" };
  const place = (directory, owner, files) => {
    const dir = join(root, directory, "active", `${deliveryOwnerPrefix(owner)}11111111-2222-4333-8444-555555555555`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "owner.json"), JSON.stringify({ ...owner, closed: false }));
    for (const file of files) writeFileSync(join(dir, file), "{}");
  };
  assert.equal(unfinishedDeliveriesOwnedBy([mine], root), 0, "保存場所が無い時は0");
  place("claude-parent-deliveries", mine, ["a.json"]);
  place("remote-parent-deliveries", sameSeat, ["b.json", "c.json"]);
  place("parent-deliveries", other, ["d.json"]);
  // 同じpidでも開始時刻が違えば別のprocess（pidの使い回し）。
  place("cursor-parent-deliveries", reused, ["e.json"]);
  // 届け終えた記録はresultsへ移る。数えない。
  mkdirSync(join(root, "claude-parent-deliveries", "results"), { recursive: true });
  writeFileSync(join(root, "claude-parent-deliveries", "results", "f.json"), "{}");
  assert.equal(unfinishedDeliveriesOwnedBy([mine], root), 1);
  assert.equal(unfinishedDeliveriesOwnedBy([mine, sameSeat], root), 3);
  assert.equal(unfinishedDeliveriesOwnedBy([other], root), 1);
  assert.equal(unfinishedDeliveriesOwnedBy([], root), 0);
});
