// 0.70.105 (a532b2): the neutral names input_ref / --input-ref beside steer_id / --steer. Same value, same rules.
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const { parseArgs } = await import("../dist/aiterm-wait-cli.js");
const { createAitermServer } = await import("../dist/index.js");
const ref = "0123456789abcdef";
const other = "fedcba9876543210";

test("aiterm-wait: --input-ref is --steer under a neutral name", () => {
  const old = parseArgs(["--session", "seat", "--cursor", "7", "--steer", ref]);
  const neutral = parseArgs(["--session", "seat", "--cursor", "7", "--input-ref", ref]);
  assert.deepEqual(neutral, old);
  assert.equal(neutral.steer, ref);
});

test("aiterm-wait: the two names are one option: a repeat, a bad value, a missing cursor-free mix are refused alike", () => {
  assert.throws(() => parseArgs(["--session", "seat", "--cursor", "7", "--steer", ref, "--input-ref", ref]), /重複/);
  assert.throws(() => parseArgs(["--session", "seat", "--cursor", "7", "--input-ref", ref, "--input-ref", ref]), /重複/);
  assert.throws(() => parseArgs(["--session", "seat", "--input-ref", "not-hex"]), /--input-ref が不正/);
  assert.throws(() => parseArgs(["--session", "seat", "--input-ref"]), /値がありません/);
  assert.throws(() => parseArgs(["--session", "seat", "--input-ref", ref, "--operation", `sha256:${"ab".repeat(32)}`]), /併用できません/);
  assert.throws(() => parseArgs(["--session", "seat", "--cursor", "7", "--input", "a".repeat(32), "--input-ref", ref]), /--input requires/);
});

async function connect() {
  const server = createAitermServer(), client = new Client({ name: "input-ref-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  return client;
}

test("pty_read takes input_ref only (steer_id was removed in 0.70.107); without agent_transcript it is refused", async () => {
  const client = await connect();
  try {
    const tools = await client.listTools();
    const props = tools.tools.find(tool => tool.name === "pty_read").inputSchema.properties;
    assert.ok(props.input_ref && !props.steer_id, "only the neutral name is published");
    const text = result => result.content.map(part => part.text ?? "").join("\n");
    const alone = await client.callTool({ name: "pty_read", arguments: { session_id: "no-such-seat", input_ref: ref } });
    assert.equal(alone.isError, true);
    assert.match(text(alone), /agent_transcript:true時だけ/);
    assert.equal(other.length, 16);
  } finally { await client.close(); }
});
