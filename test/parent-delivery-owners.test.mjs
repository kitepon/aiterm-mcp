import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliveryOwnerPrefix, pendingChildResultsFor } from "../dist/parent-delivery-owners.js";
import { agentMetadataPath, agentsDir } from "../dist/agent-shared.js";

// pty_observeのpending_child_deliveries。子の記録が親を名指さない時は、配送の記録の持ち主から数える。
test("親を名指さない記録は、持ち主が渡したprocessの中に居る物だけを数える", t => {
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
  assert.equal(pendingChildResultsFor("seat", [mine], undefined, root), 0, "保存場所が無い時は0");
  place("claude-parent-deliveries", mine, ["a.json"]);
  place("remote-parent-deliveries", sameSeat, ["b.json", "c.json"]);
  place("parent-deliveries", other, ["d.json"]);
  // 同じpidでも開始時刻が違えば別のprocess（pidの使い回し）。
  place("cursor-parent-deliveries", reused, ["e.json"]);
  // 届け終えた記録はresultsへ移る。数えない。
  mkdirSync(join(root, "claude-parent-deliveries", "results"), { recursive: true });
  writeFileSync(join(root, "claude-parent-deliveries", "results", "f.json"), "{}");
  assert.equal(pendingChildResultsFor("seat", [mine], undefined, root), 1);
  assert.equal(pendingChildResultsFor("seat", [mine, sameSeat], undefined, root), 3);
  assert.equal(pendingChildResultsFor("seat", [other], undefined, root), 1);
  assert.equal(pendingChildResultsFor("seat", [], undefined, root), 0);
});

// 0.70.42: 回復で記録を引き取った持ち主の席でなく、子が名指す親の席に数える（キロの席が他の席の4件を背負った件）。
test("子のmetadataが名指す親の席に数え、引き取った持ち主の席には数えない。除外の印は外す", t => {
  const root = mkdtempSync(join(tmpdir(), "aiterm-delivery-parent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const adopter = { pid: 7260, started_identity: "Thu Nov 12 23:56:23 2026" };
  const launch = (n) => n.repeat(32);
  mkdirSync(agentsDir(), { recursive: true });
  // 親の席はこの端末のAitermの席。host-rootは席ではない。
  writeFileSync(agentMetadataPath("parent_seat", launch("a")), "{}");
  const child = (session, l, parent, kind = "codex") => writeFileSync(agentMetadataPath(session, launch(l)), JSON.stringify({ kind, parent_session_id: parent }));
  child("child_one", "b", "parent_seat"); child("child_two", "c", "parent_seat", "cursor"); child("child_root", "d", "host-root");
  const dir = join(root, "claude-parent-deliveries", "active", `${deliveryOwnerPrefix(adopter)}11111111-2222-4333-8444-555555555555`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "owner.json"), JSON.stringify({ ...adopter, closed: false }));
  const record = (file, session, l) => writeFileSync(join(dir, file), JSON.stringify({ state: "waiting", boundary: { session_id: session, launch_id: launch(l) } }));
  record("1.json", "child_one", "b"); record("2.json", "child_two", "c"); record("3.json", "child_root", "d");
  assert.equal(pendingChildResultsFor("parent_seat", [], undefined, root), 2, "the parent seat waits for its two children");
  assert.equal(pendingChildResultsFor("adopter_seat", [adopter], undefined, root), 1, "the adopter keeps only the record whose parent is not a seat");
  assert.equal(pendingChildResultsFor("parent_seat", [], child => child.harness === "cursor-cli", root), 1, "a child entry removes its record");
  assert.equal(pendingChildResultsFor("parent_seat", [], child => child.session === "child_one", root), 1);
});

test("deliveryChildGone: a missing local child is gone, a remote child is not judged here", async () => {
  const { deliveryChildGone } = await import("../dist/core.js");
  assert.equal(deliveryChildGone({ session_id: "no_such_child_seat", launch_id: "e".repeat(32) }), "child_missing");
  assert.equal(deliveryChildGone({ session_id: "no_such_child_seat", launch_id: "e".repeat(32), remote: { host: "h" } }), null);
});
