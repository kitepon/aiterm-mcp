import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import test from "node:test";

const core = await import("../dist/core.js");
const { readSeatTurnsOffLoop } = await import("../dist/seat-turns-worker.js");

test("seat turns are read on the worker: same result as the synchronous read, and the caller's loop stays free", async () => {
  const ids = ["seat_worker_none_a", "seat_worker_none_b"];
  let fallbacks = 0;
  const fallback = list => { fallbacks++; return core.readSeatTurns(list); };
  let loopRan = false;
  setImmediate(() => { loopRan = true; });
  const [a, b] = await Promise.all([readSeatTurnsOffLoop(ids, fallback), readSeatTurnsOffLoop([], fallback)]);
  assert.equal(loopRan, true);
  assert.deepEqual(a, core.readSeatTurns(ids));
  assert.deepEqual(b, { schema: "aiterm.seat-turns.v1", seats: [], unread: [] });
  assert.equal(fallbacks, 0, "the worker answered, not the synchronous fallback");
});
