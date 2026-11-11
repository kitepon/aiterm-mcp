import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const rt = await import("../dist/remote-terminal.js");
const { createAitermServer } = await import("../dist/index.js");

const skip = process.platform === "win32" || spawnSync("ssh-keygen", ["-?"]).error !== undefined;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "steer-relay-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Fake terminal: pty_send answers as a terminal steer receipt does, with the terminal's own node path in wait_process.
const steerId = "0123456789abcdef";
const terminalWait = { executable: "/Users/kite/.aiterm/runtime/current/node/bin/node", args: ["/Users/kite/aiterm-wait-cli.js", "--session", "seat_s", "--cursor", "7", "--steer", steerId], windows_start_process_argument_list: null };
const sdk = name => JSON.stringify(new URL(`../node_modules/@modelcontextprotocol/sdk/dist/esm/${name}`, import.meta.url).href);
const serverFile = path.join(tmp, "server.mjs");
fs.writeFileSync(serverFile, `import { Server } from ${sdk("server/index.js")};
import { StdioServerTransport } from ${sdk("server/stdio.js")};
import { CallToolRequestSchema, ListToolsRequestSchema } from ${sdk("types.js")};
const s = new Server({ name: "aiterm-mcp", version: "0.70.18" }, { capabilities: { tools: {} } });
s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
const wait = ${JSON.stringify(terminalWait)};
s.setRequestHandler(CallToolRequestSchema, async (r) => {
  const steer = { schema: "aiterm.pty-send-result.v1", mode: "agent_steer", session_id: r.params.arguments.session_id, event_cursor: 7, wait_process: wait,
    launch_id: "a".repeat(32), vendor: "claude", harness: "claude-code", submit_residue: null, pane_input_recovery: [] };
  const ref = { "aiterm/steer": { schema: "aiterm.steer-ref.v1", steer_id: ${JSON.stringify(steerId)}, interim_from: null } };
  if (r.params.arguments.text === "followed") return { content: [{ type: "text", text: "steered" }], structuredContent: steer, _meta: ref };
  if (r.params.arguments.text === "no-ref") return { content: [{ type: "text", text: "steered" }], structuredContent: steer, _meta: { other: 1 } };
  return { content: [{ type: "text", text: "aiterm: steer unconfirmed" }], isError: true,
    structuredContent: { session_id: r.params.arguments.session_id, event_cursor: 7, steer_id: ${JSON.stringify(steerId)}, interim_from: null, wait_process: wait } };
});
await s.connect(new StdioServerTransport());
`);
const fakeBin = path.join(tmp, "bin");
fs.mkdirSync(fakeBin);
fs.writeFileSync(path.join(fakeBin, "ssh"), `#!/bin/sh
case "$*" in *aiterm-probe*) echo posix; exit 0;; esac
exec ${JSON.stringify(process.execPath)} ${JSON.stringify(serverFile)}
`, { mode: 0o755 });

test("relayed steer: wait_process waits for the steer's turn over ssh, or is dropped with the steer-ref when it cannot be followed", { skip }, async t => {
  const savedPath = process.env.PATH;
  process.env.PATH = `${fakeBin}${path.delimiter}${savedPath}`;
  t.after(() => { process.env.PATH = savedPath; });
  const key = path.join(tmp, "id"), known = path.join(tmp, "known");
  assert.equal(spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]).status, 0);
  const [type, blob] = fs.readFileSync(`${key}.pub`, "utf8").trim().split(/\s+/);
  fs.writeFileSync(known, `10.8.1.1 ${type} ${blob}\n`);
  const { ref } = rt.registerBinding({ target: { host: "10.8.1.1", user: "kite", port: 22 }, keyFile: key, knownHostsFile: known });
  rt.bindTerminalSession("seat_s", ref);
  const server = createAitermServer(), client = new Client({ name: "steer-relay-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  const send = text => client.callTool({ name: "pty_send", arguments: { session_id: "seat_s", text, force: true }, _meta: { "aiterm/caller": "BellTeam" } });
  const sshWait = wait => {
    assert.equal(wait.executable, "ssh");
    assert.equal(wait.args.some(arg => arg.includes("/Users/kite")), false, "not the terminal's node path");
    assert.match(wait.args.at(-1), new RegExp(`aiterm-wait.*--session seat_s .*--cursor 7 --steer ${steerId}`));
  };
  try {
    const followed = await send("followed");
    assert.equal(followed.structuredContent.event_cursor, 7);
    sshWait(followed.structuredContent.wait_process);
    assert.equal(followed._meta["aiterm/steer"].steer_id, steerId);

    const noRef = await send("no-ref");
    assert.equal(noRef.structuredContent.event_cursor, null);
    assert.equal(noRef.structuredContent.wait_process, null);
    assert.equal(noRef._meta?.["aiterm/steer"], undefined);
    assert.equal(noRef._meta.other, 1);

    const failed = await send("unconfirmed");
    assert.equal(failed.isError, true);
    sshWait(failed.structuredContent.wait_process);
  } finally { await client.close(); }
});
