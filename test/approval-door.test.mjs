import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Door, DOOR_BEARER, doorAddress, seatRegistration, serveDoor } from "../dist/approval-door.js";

const bearer = tail => `Bearer ${tail.padEnd(43, "x")}`;
const A = bearer("aaa"), B = bearer("bbb");

/** A fake seat ingress: `answer(auth, body)` -> [status, text]. Records what it was sent. */
async function ingress(answer) {
  const seen = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      seen.push({ method: request.method, url: request.url, auth: request.headers.authorization, type: request.headers["content-type"], body });
      const [status, text] = answer(request.headers.authorization, body);
      response.writeHead(status, { "content-type": "application/json" }).end(text);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, seen, close: () => server.close() };
}

test("seatRegistration reads the seat route and bearer from the rewritten mcp_config", () => {
  const env = { TOKEN: A.slice(7), AITERM_MCP_HEADER_0: A };
  const config = headers => ({ mcpServers: { other: { url: "https://example.com/x" }, bellteam: { url: "http://127.0.0.1:4455/api/seat-mcp?x=1", headers } } });
  assert.deepEqual(seatRegistration(config({ Authorization: "Bearer ${TOKEN}" }), name => env[name]), { port: 4455, bearer: A });
  assert.deepEqual(seatRegistration(config({ authorization: "${AITERM_MCP_HEADER_0}" }), name => env[name]), { port: 4455, bearer: A });
  assert.deepEqual(seatRegistration(config({ Authorization: A }), () => undefined), { port: 4455, bearer: A });
  assert.equal(seatRegistration(config({ Authorization: "Bearer ${MISSING}" }), name => env[name]), null);
  assert.equal(seatRegistration(config({ Authorization: "Bearer short" }), () => undefined), null);
  assert.equal(seatRegistration(config({}), () => undefined), null);
  assert.equal(seatRegistration({ mcpServers: { x: { url: "http://127.0.0.1:1/other", headers: { Authorization: A } } } }, () => undefined), null);
  assert.equal(seatRegistration(null, () => undefined), null);
  assert.ok(DOOR_BEARER.test(A));
});

test("forward posts one line with the newest seat's bearer and returns the daemon's line, a down daemon included", async () => {
  const body = await ingress(() => [200, '{"ok":false,"status":503,"code":"APPROVAL_BOX_DAEMON_UNAVAILABLE"}\n']);
  try {
    const door = new Door(() => true);
    door.register("old", body.port, A);
    door.register("new", body.port, B);
    const line = JSON.stringify({ method: "POST", path: "/v1/x", body: { n: 1 } });
    assert.equal(await door.forward(line), '{"ok":false,"status":503,"code":"APPROVAL_BOX_DAEMON_UNAVAILABLE"}');
    assert.deepEqual(body.seen, [{ method: "POST", url: "/api/seat-mcp/approval-box/local", auth: B, type: "application/json", body: line }]);
  } finally { body.close(); }
});

test("a dead bearer is dropped and the next live seat answers; a fork's bearer is skipped but kept", async () => {
  const body = await ingress(auth => auth === A ? [400, '{"error":"BELLTEAM_SEAT_UNRESOLVED"}']
    : auth === B ? [403, '{"error":"APPROVAL_BOX_DOOR_NOT_ALLOWED"}'] : [200, '{"ok":true,"result":1}']);
  try {
    const door = new Door(() => true);
    door.register("main", body.port, bearer("ccc"));
    door.register("fork", body.port, B);
    door.register("dead", body.port, A);
    assert.equal(await door.forward("{}"), '{"ok":true,"result":1}');
    assert.equal(door.size, 2); // the dead one is gone; the fork stays
    door.register("main", body.port, A); // the replacement of a seat's bearer takes effect at once
    assert.equal(door.size, 2);
  } finally { body.close(); }
});

test("errors come back as one typed line, never a drop", async () => {
  const body = await ingress(() => [413, '{"error":"APPROVAL_BOX_DOOR_TOO_LARGE"}']);
  try {
    const door = new Door(() => true);
    assert.deepEqual(JSON.parse(await door.forward("{}")), { ok: false, status: 503, code: "APPROVAL_DOOR_NO_SEAT", message: "no live seat on this computer can reach the body" });
    door.register("s", body.port, A);
    assert.deepEqual(JSON.parse(await door.forward("{}")), { ok: false, status: 413, code: "APPROVAL_BOX_DOOR_TOO_LARGE", message: "the body answered HTTP 413" });
  } finally { body.close(); }
  const closed = await ingress(() => [200, "{}"]);
  const { port } = closed; closed.close();
  await new Promise(resolve => setTimeout(resolve, 50));
  const door = new Door(() => true);
  door.register("s", port, A);
  assert.equal(JSON.parse(await door.forward("{}")).code, "APPROVAL_DOOR_ROUTE_UNAVAILABLE");
});

test("a seat leaves only after two failed liveness checks in a row", () => {
  let alive = true;
  const door = new Door(() => alive);
  door.register("s", 1, A);
  alive = false;
  assert.equal(door.sweep(), 1);
  alive = true;
  assert.equal(door.sweep(), 1); // the miss count resets
  alive = false;
  door.sweep();
  assert.equal(door.sweep(), 0);
});

test("the address is stable per host user", () => {
  assert.equal(doorAddress("linux", "/home/kite", "kite"), "/home/kite/.aiterm/approval-box-door.sock");
  assert.equal(doorAddress("darwin", "/Users/kite", "kite"), "/Users/kite/.aiterm/approval-box-door.sock");
  assert.equal(doorAddress("win32", "C:\\Users\\kite_", "kite_"), "\\\\.\\pipe\\aiterm-approval-box-door-kite_");
});

test("the served address answers registration and a large line, is 0600, and goes away when no seat is left", async () => {
  const body = await ingress((_, text) => [200, JSON.stringify({ ok: true, length: text.length })]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "door-"));
  const address = process.platform === "win32" ? `\\\\.\\pipe\\aiterm-door-test-${process.pid}` : path.join(dir, "d", "door.sock");
  let alive = true, emptied = false;
  const door = new Door(() => alive);
  const server = await serveDoor(door, address, () => { emptied = true; }, 50);
  try {
    assert.ok(server);
    if (process.platform !== "win32") assert.equal(fs.statSync(address).mode & 0o777, 0o600);
    const talk = lines => new Promise((resolve, reject) => {
      const socket = net.connect(address);
      let got = "";
      socket.setEncoding("utf8");
      socket.on("error", reject);
      socket.on("connect", () => socket.write(lines.join("\n") + "\n"));
      socket.on("data", chunk => { got += chunk; if (got.split("\n").length > lines.length) { socket.destroy(); resolve(got.trimEnd().split("\n")); } });
    });
    const big = JSON.stringify({ method: "POST", path: "/p", body: "y".repeat(5 * 1024 * 1024) });
    const replies = await talk([JSON.stringify({ aiterm_door: "register", session: "s1", port: body.port, authorization: A }), big, '{"aiterm_door":"register","session":"s2","port":0,"authorization":"x"}']);
    assert.equal(replies[0], '{"ok":true}');
    assert.equal(JSON.parse(replies[1]).length, big.length); // the whole line reached the ingress
    assert.equal(JSON.parse(replies[2]).code, "APPROVAL_DOOR_REGISTER_INVALID");
    assert.equal(body.seen[0].auth, A);
    // a second door finds the address answered and leaves it alone
    assert.equal(await serveDoor(new Door(() => true), address), null);
    alive = false;
    await new Promise(resolve => { const wait = setInterval(() => { if (emptied) { clearInterval(wait); resolve(); } }, 20); });
    if (process.platform !== "win32") assert.equal(fs.existsSync(address), false);
    // the bearer was never written under the directory that held the socket
    for (const file of fs.readdirSync(dir, { recursive: true })) assert.equal(fs.statSync(path.join(dir, file)).isFile() && fs.readFileSync(path.join(dir, file), "utf8").includes(A), false);
  } finally { server?.close(); body.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
