import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
// remote-terminal.md R23/R24 (a521): images to and from a terminal seat.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const { IMAGE_MAX_BYTES, imageDirectory, imageReadRoots, putImage, readImage, sniffImage, uploadImages } = await import("../dist/remote-image.js");
const { createAitermServer } = await import("../dist/index.js");

const png = (extra = 0) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8 + extra, 1)]);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const gif = Buffer.from("GIF89a\0\0\0\0");
const webp = Buffer.from("RIFF\0\0\0\0WEBPVP8 ");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "remote-image-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const codeOf = fn => { try { fn(); } catch (error) { return /^([A-Z_]+):/.exec(error.message)?.[1] ?? error.message; } return null; };

test("the first bytes decide the type, never the name", () => {
  assert.deepEqual([png(), jpg, gif, webp].map(bytes => sniffImage(bytes)?.mime), ["image/png", "image/jpeg", "image/gif", "image/webp"]);
  assert.equal(sniffImage(Buffer.from("<svg></svg>")), null);
  assert.equal(sniffImage(Buffer.from("RIFF\0\0\0\0WAVEfmt ")), null);
  assert.equal(sniffImage(Buffer.alloc(0)), null);
});

test("image_put stores under a name made here, 0600, and refuses non-images and oversize", () => {
  const stored = putImage(png().toString("base64"));
  assert.equal(path.dirname(stored.path), imageDirectory());
  assert.match(path.basename(stored.path), /^[0-9a-f-]{36}\.png$/);
  assert.equal(stored.mime_type, "image/png");
  assert.deepEqual(fs.readFileSync(stored.path), png());
  if (process.platform !== "win32") assert.equal(fs.statSync(stored.path).mode & 0o777, 0o600);
  assert.equal(codeOf(() => putImage(Buffer.from("hello").toString("base64"))), "IMAGE_NOT_AN_IMAGE");
  assert.equal(codeOf(() => putImage(png(IMAGE_MAX_BYTES).toString("base64"))), "IMAGE_TOO_LARGE");
  fs.rmSync(stored.path);
});

test("image_read answers one file inside the allowed folders and refuses everything else with a code", () => {
  const inside = path.join(tmp, "inside"), outside = path.join(tmp, "outside");
  fs.mkdirSync(inside); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(inside, "a.png"), png());
  fs.writeFileSync(path.join(inside, "text.png"), "not an image");
  fs.writeFileSync(path.join(outside, "b.png"), png());
  const read = file => readImage(file, [inside]);
  const got = read(path.join(inside, "a.png"));
  assert.equal(got.mime_type, "image/png");
  assert.deepEqual(got.bytes, png());
  assert.equal(codeOf(() => read("a.png")), "IMAGE_PATH_INVALID");
  assert.equal(codeOf(() => read(path.join(inside, "missing.png"))), "IMAGE_NOT_FOUND");
  assert.equal(codeOf(() => read(path.join(inside, "text.png"))), "IMAGE_NOT_AN_IMAGE");
  assert.equal(codeOf(() => read(inside)), "IMAGE_PATH_NOT_ALLOWED"); // the folder itself is not a file inside it
  assert.equal(codeOf(() => read(path.join(outside, "b.png"))), "IMAGE_PATH_NOT_ALLOWED");
  assert.equal(codeOf(() => read(path.join(inside, "..", "outside", "b.png"))), "IMAGE_PATH_NOT_ALLOWED");
  if (process.platform !== "win32") {
    fs.symlinkSync(path.join(outside, "b.png"), path.join(inside, "link.png"));
    assert.equal(codeOf(() => read(path.join(inside, "link.png"))), "IMAGE_PATH_NOT_ALLOWED"); // a symlink out of the folder is followed, then refused
  }
  fs.writeFileSync(path.join(inside, "big.png"), Buffer.concat([png(), Buffer.alloc(IMAGE_MAX_BYTES)]));
  assert.equal(codeOf(() => read(path.join(inside, "big.png"))), "IMAGE_TOO_LARGE");
  assert.ok(imageReadRoots("/work/seat").includes("/work/seat") && imageReadRoots(null).includes(imageDirectory()));
});

test("uploadImages checks every image before the first upload and keeps the order", async () => {
  const a = path.join(tmp, "one.png"), b = path.join(tmp, "two.jpg");
  fs.writeFileSync(a, png()); fs.writeFileSync(b, jpg);
  const calls = [];
  const put = async data => { calls.push(data); return `/remote/${calls.length}`; };
  assert.deepEqual(await uploadImages([a, b], put), ["/remote/1", "/remote/2"]);
  assert.deepEqual(calls, [png().toString("base64"), jpg.toString("base64")]);
  calls.length = 0;
  for (const [images, code] of [[[a, path.join(tmp, "nope.png")], "IMAGE_NOT_FOUND"], [[a, "rel.png"], "IMAGE_PATH_INVALID"], [[a, path.join(tmp, "x.txt")], "IMAGE_NOT_AN_IMAGE"],
    [Array(9).fill(a), "IMAGE_TOO_MANY"]]) {
    await assert.rejects(uploadImages(images, put), new RegExp(`^AitermError: ${code}|${code}`));
    assert.equal(calls.length, 0, `${code}: nothing was uploaded`);
  }
});

// A fake terminal: fake ssh runs this stdio MCP server, which records its calls and answers image_put by `mode`.
async function relayRun(t, mode, image) {
  const dir = fs.mkdtempSync(path.join(tmp, "relay-"));
  const record = path.join(dir, "calls.jsonl");
  const server = path.join(dir, "server.mjs");
  const sdk = name => JSON.stringify(new URL(`../node_modules/@modelcontextprotocol/sdk/dist/esm/${name}`, import.meta.url).href);
  fs.writeFileSync(server, `import fs from "node:fs";
import { Server } from ${sdk("server/index.js")};
import { StdioServerTransport } from ${sdk("server/stdio.js")};
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } from ${sdk("types.js")};
const s = new Server({ name: "aiterm-mcp", version: "9.9.9" }, { capabilities: { tools: {} } });
s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
s.setRequestHandler(CallToolRequestSchema, async r => {
  fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ name: r.params.name, args: r.params.arguments }) + "\\n");
  if (r.params.name === "image_put") {
    if (${JSON.stringify(mode)} === "old") throw new McpError(ErrorCode.InvalidParams, "Tool image_put not found");
    if (${JSON.stringify(mode)} === "large") return { isError: true, content: [{ type: "text", text: "aiterm: IMAGE_TOO_LARGE: an image is at most 26214400 bytes" }] };
    return { content: [{ type: "text", text: "stored" }], structuredContent: { schema: "aiterm.image-put.v1", path: "/remote/tmp/aiterm-images/one.png", mime_type: "image/png", bytes: 16 } };
  }
  return { content: [{ type: "text", text: "sent" }] };
});
await s.connect(new StdioServerTransport());
`);
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "ssh"), `#!/bin/sh\ncase "$*" in *aiterm-probe*) echo posix; exit 0;; esac\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(server)}\n`, { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${saved}`;
  t.after(() => { process.env.PATH = saved; });
  const aiterm = createAitermServer(), client = new Client({ name: "image-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await aiterm.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); });
  const result = await client.callTool({ name: "pty_send", arguments: { session_id: "t1", text: "look", remote: { host: `image-relay-${mode}` }, image } });
  const calls = fs.existsSync(record) ? fs.readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  return { result, calls };
}

test("pty_send image to a terminal uploads the bytes, then sends the terminal's own path", { skip: process.platform === "win32" }, async t => {
  const file = path.join(tmp, "send.png");
  fs.writeFileSync(file, png());
  const { calls } = await relayRun(t, "ok", [file]);
  assert.deepEqual(calls.map(call => call.name), ["image_put", "pty_send"]);
  assert.equal(calls[0].args.data_base64, png().toString("base64"));
  assert.deepEqual(calls[1].args.image, ["/remote/tmp/aiterm-images/one.png"]);
  assert.equal(calls[1].args.text, "look");
});

test("a terminal without image_put, a refused upload and a bad local file all stop before anything is typed", { skip: process.platform === "win32" }, async t => {
  const file = path.join(tmp, "stop.png");
  fs.writeFileSync(file, png());
  for (const [mode, image, code] of [["old", [file], "REMOTE_IMAGE_UNSUPPORTED"], ["large", [file], "IMAGE_TOO_LARGE"], ["ok", [path.join(tmp, "none.png")], "IMAGE_NOT_FOUND"]]) {
    const { result, calls } = await relayRun(t, mode, image);
    assert.equal(result.isError, true, mode);
    assert.match(result.content.map(item => item.text ?? "").join("\n"), new RegExp(code), mode);
    assert.equal(calls.some(call => call.name === "pty_send"), false, `${mode}: pty_send was never sent`);
  }
});
