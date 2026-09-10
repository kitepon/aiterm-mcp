import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ParentDeliveryManager } from "../dist/parent-delivery.js";
import { CodexDeliveryError } from "../dist/codex-parent-receiver.js";

const parent = (suffix = "1") => ({ thread_id: `11111111-2222-4333-8444-55555555555${suffix}`, codex_home: path.join(os.tmpdir(), "親のCodex") });
const boundary = (session = "child", cursor = 0) => ({ session_id: session, launch_id: "a".repeat(32), vendor: "codex", harness: "codex-cli", event_cursor: cursor, operation_id: null });
const observation = (b, outcome = "done", turn = "turn-1") => ({ schema: "aiterm.agent-wait-result.v1", ...b, outcome,
  vendor_session_id: "vendor-session", turn_id: turn, malformed_events: 0, at: new Date().toISOString(), rate_limit: null, error: null });
const key = (session, cursor) => `${session}:${cursor}`;
async function until(condition) {
  const end = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > end) throw new Error("試験の条件が成立しませんでした");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
function records(root) {
  const result = [];
  const scan = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (entry.name.endsWith(".json") && entry.name !== "owner.json") result.push({ file, value: JSON.parse(fs.readFileSync(file, "utf8")) });
    }
  };
  for (const directory of ["active", "results"]) scan(path.join(root, directory));
  return result;
}
function setup(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-delivery-"));
  const waiters = new Map();
  const observed = new Map();
  const answers = new Map([["turn-1", "一つ目の回答"], ["turn-2", "二つ目の回答"]]);
  const submitted = [];
  const managers = [];
  const dependencies = {
    processes: () => [{ pid: process.pid, started_identity: "fixture-parent" }],
    verify: async () => {},
    observe: async (session, options) => {
      const id = key(session, options.cursor);
      if (options.timeout === 0 || observed.has(id)) return observed.get(id) ?? observation(boundary(session, options.cursor), "running", null);
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject };
        const list = waiters.get(id) ?? [];
        list.push(waiter); waiters.set(id, list);
        options.signal?.addEventListener("abort", () => {
          waiters.set(id, (waiters.get(id) ?? []).filter(item => item !== waiter));
          reject(new Error("観測を停止しました"));
        }, { once: true });
      });
    },
    answer: async (_session, options) => {
      assert.equal(options.raw, true);
      const text = answers.get(options.completion.turn_id);
      return { text, display: text, turn_id: options.completion.turn_id, raw_chars: text.length, harness: "codex-cli", vendor: "codex" };
    },
    submit: async (target, id, text) => {
      submitted.push({ target, id, text });
      return { queued_submission_id: `queue-${id}` };
    },
    ...overrides,
  };
  const create = () => {
    const manager = new ParentDeliveryManager({ root, dependencies }); managers.push(manager); return manager;
  };
  const finish = (b, turn = "turn-1", outcome = "done") => {
    const value = observation(b, outcome, turn);
    observed.set(key(b.session_id, b.event_cursor), value);
    for (const waiter of waiters.get(key(b.session_id, b.event_cursor)) ?? []) waiter.resolve(value);
    waiters.delete(key(b.session_id, b.event_cursor));
  };
  t.after(async () => { for (const manager of managers) await manager.close(); fs.rmSync(root, { recursive: true }); });
  return { root, create, finish, submitted, answers, observed };
}

test("親ごとの宛先を記録し、子の完了後に本文を一度ずつ自動配送する", async (t) => {
  const h = setup(t); const manager = h.create();
  const first = manager.request(parent("1")); const second = manager.request(parent("2"));
  await first.before_send(boundary("one"));
  await second.before_send(boundary("two"));
  assert.equal(first.result().state, "waiting");
  assert.equal(h.submitted.length, 0);
  h.finish(boundary("one")); h.finish(boundary("two"), "turn-2");
  await until(() => manager.status("one")[0]?.state === "submitted" && manager.status("two")[0]?.state === "submitted");
  assert.equal(h.submitted.length, 2);
  assert.match(h.submitted.find(v => v.target.thread_id === parent("1").thread_id).text, /一つ目の回答$/);
  assert.match(h.submitted.find(v => v.target.thread_id === parent("2").thread_id).text, /二つ目の回答$/);
  assert.equal("text" in manager.status("one")[0], false, "観測receiptへ本文を出さない");
});

test("初手が即完了しても回収し、保存した本文は次の回答で置換されない", async (t) => {
  const h = setup(t); const manager = h.create();
  h.finish(boundary());
  const first = manager.request(parent()); await first.before_send(boundary());
  await until(() => first.result().state === "submitted");
  h.answers.set("turn-1", "書き換えた値");
  const second = manager.request(parent()); await second.before_send(boundary("child", 100));
  h.finish(boundary("child", 100), "turn-2");
  await until(() => second.result().state === "submitted");
  assert.match(h.submitted[0].text, /一つ目の回答$/);
  assert.equal(records(h.root).find(v => v.value.delivery_id === first.result().delivery_id).value.text, "一つ目の回答");
});

test("同じ子への並行dispatchは前の回答を保存するまで拒否する", async (t) => {
  const h = setup(t); const manager = h.create();
  const result = await Promise.allSettled([manager.request(parent()).before_send(boundary()), manager.request(parent("2")).before_send(boundary())]);
  assert.equal(result.filter(v => v.status === "fulfilled").length, 1);
  assert.match(result.find(v => v.status === "rejected").reason.message, /PARENT_RESULT_PENDING/);
  assert.equal(records(h.root).length, 1);
});

test("別のMCP接続から同じ子へ同時dispatchしても一つだけ受け付ける", async (t) => {
  const h = setup(t); const a = h.create(); const b = h.create();
  const result = await Promise.allSettled([a.request(parent()).before_send(boundary()), b.request(parent("2")).before_send(boundary())]);
  assert.equal(result.filter(v => v.status === "fulfilled").length, 1);
  assert.match(result.find(v => v.status === "rejected").reason.message, /PARENT_RESULT_PENDING/);
  assert.equal(records(h.root).length, 1);
});

test("送信拒否と結果不明を区別し、回答本文を保存して再送しない", async (t) => {
  for (const unknown of [false, true]) {
    let count = 0;
    const h = setup(t, { submit: async () => { count++; throw new CodexDeliveryError("CODEX_RECEIVER_TIMEOUT", "試験", unknown); } });
    const manager = h.create(); const request = manager.request(parent());
    await request.before_send(boundary()); h.finish(boundary());
    await until(() => request.result().state === (unknown ? "unknown" : "failed"));
    await manager.close();
    const resumed = h.create(); await resumed.recover();
    assert.equal(count, 1);
    assert.equal(records(h.root)[0].value.text, "一つ目の回答");
    assert.equal(resumed.status("child")[0].error_code, "CODEX_RECEIVER_TIMEOUT");
  }
});

test("MCP再起動後は保存した未送信回答を同じ親へ配送し、複数processの回収を重複させない", async (t) => {
  const h = setup(t); const manager = h.create();
  await manager.request(parent()).before_send(boundary());
  await manager.close();
  const stored = records(h.root)[0];
  Object.assign(stored.value, { state: "ready", text: "保存済みの本文", child_outcome: "done", child_turn_id: "turn-1" });
  fs.writeFileSync(stored.file, JSON.stringify(stored.value));
  const a = h.create(); const b = h.create(); await Promise.all([a.recover(), b.recover()]);
  await until(() => a.status("child")[0]?.state === "submitted");
  assert.equal(h.submitted.length, 1);
  assert.equal(h.submitted[0].target.thread_id, parent().thread_id);
  assert.match(h.submitted[0].text, /保存済みの本文$/);
});

test("キュー送信中のMCP終了はunknownにし、本文を保持して自動再送しない", async (t) => {
  const h = setup(t); const manager = h.create();
  await manager.request(parent()).before_send(boundary()); await manager.close();
  const stored = records(h.root)[0];
  Object.assign(stored.value, { state: "sending", text: "失ってはいけない本文", child_outcome: "done" });
  fs.writeFileSync(stored.file, JSON.stringify(stored.value));
  const resumed = h.create(); await resumed.recover();
  assert.equal(resumed.status("child")[0].state, "unknown");
  assert.equal(h.submitted.length, 0);
  assert.equal(records(h.root)[0].value.text, "失ってはいけない本文");
});

test("MCP切断中も子の依頼を失わず、再接続後に同じ完了境界から回収する", async (t) => {
  const h = setup(t); const manager = h.create();
  await manager.request(parent()).before_send(boundary()); await manager.close();
  h.finish(boundary());
  const resumed = h.create(); await resumed.recover();
  await until(() => resumed.status("child")[0]?.state === "submitted");
  assert.equal(h.submitted.length, 1);
});

test("子のエラー・利用上限・closeは成功回答にせず終了状態を配送する", async (t) => {
  const h = setup(t); const manager = h.create();
  for (const outcome of ["error", "rate_limited", "closed"]) {
    const b = boundary(outcome); await manager.request(parent()).before_send(b); h.finish(b, null, outcome);
  }
  await until(() => h.submitted.length === 3);
  for (const outcome of ["error", "rate_limited", "closed"]) assert.ok(h.submitted.some(v => v.text.includes(`outcome=${outcome}`)));
});
