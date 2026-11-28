// BugHub-ES256（ADR 0145）: 署名設定の読み取り、応答の署名の確認、認証仲介の呼び出し、送信の流れ。
import "./seat-env.mjs"; // 最初のimportに置く（ADR 0121）
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  readSigningConfig, signViaModule, verifyReportResponseEs256, reportRuntimeErrors, setRuntimeErrorReporting,
} from "../dist/runtime-error-report.js";
import { RuntimeErrorStore } from "../dist/runtime-error-store.js";

const posixOnly = process.platform === "win32" ? "POSIXの権限を使う試験" : false;
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = publicKey.export({ type: "spki", format: "pem" });
const es = (text) => sign("sha256", Buffer.from(text, "utf8"), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
const GOOD = { schema_version: "1.0", url: "http://192.0.2.1/x", key_id: "k.es256-1", item: "bughub-product-aiterm-mcp-rabbit", auth: "~/.local/bin/auth", cwd: "/home/kite/.local/share/aiterm-mcp-bughub-sign/rabbit", ssh: "kite@192.168.1.2" };

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-es256-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("署名設定: 正しい形は読み、shellへ渡せない文字・余分な項目・欠けは読まない", (t) => {
  const file = path.join(tmp(t), "signing.json");
  const put = (value) => fs.writeFileSync(file, JSON.stringify(value));
  assert.deepEqual(readSigningConfig(path.join(path.dirname(file), "none.json")), { status: "missing" });
  put(GOOD);
  assert.deepEqual(readSigningConfig(file), { status: "ready", config: { url: GOOD.url, key_id: GOOD.key_id, item: GOOD.item, auth: GOOD.auth, cwd: GOOD.cwd, ssh: GOOD.ssh } });
  const { ssh, ...direct } = GOOD;
  put(direct);
  assert.equal(readSigningConfig(file).status, "ready");
  for (const bad of [{ ...GOOD, cwd: "/x; rm -rf /" }, { ...GOOD, item: "other-item" }, { ...GOOD, auth: "auth $(id)" }, { ...GOOD, ssh: "kite@host -oProxyCommand=x" },
    { ...GOOD, extra: 1 }, { ...GOOD, url: "ftp://x/y" }, { ...GOOD, schema_version: "2.0" }, { ...GOOD, cwd: "relative/path" }]) {
    put(bad);
    assert.equal(readSigningConfig(file).status, "rejected", JSON.stringify(bad));
  }
  fs.writeFileSync(file, "{not json");
  assert.equal(readSigningConfig(file).status, "rejected");
});

test("応答の署名: BugHubの鍵で署名した、同じreport_idのaccepted応答だけを受領にする", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const at = "2026-11-28T09:00:00.000Z";
  const ok = { accepted: true, report_id: id, received_at: at, sig: es(`${id}\n${at}`), sig_alg: "ES256" };
  assert.equal(verifyReportResponseEs256(PEM, id, ok), true);
  assert.equal(verifyReportResponseEs256(PEM, id, { ...ok, sig_alg: "HS256" }), false);
  assert.equal(verifyReportResponseEs256(PEM, id, { ...ok, received_at: "2026-11-28T09:00:01.000Z" }), false);
  assert.equal(verifyReportResponseEs256(PEM, "00000000-0000-4000-8000-000000000002", ok), false);
  assert.equal(verifyReportResponseEs256(PEM, id, { ...ok, accepted: false }), false);
  assert.equal(verifyReportResponseEs256(PEM, id, { ...ok, sig: "A".repeat(86) + "==" }), false);
  assert.equal(verifyReportResponseEs256(PEM, id, null), false);
  assert.equal(verifyReportResponseEs256("not a key", id, ok), false);
});

test("認証仲介の呼び出し: cwdで走り、textを標準入力のfileで受け、64バイトの署名だけを返す", { skip: posixOnly }, async (t) => {
  const root = tmp(t);
  const cwd = path.join(root, "unit");
  fs.mkdirSync(cwd);
  const sig = Buffer.alloc(64, 7).toString("base64");
  const auth = path.join(root, "auth");
  fs.writeFileSync(auth, `#!/bin/sh\n[ "$1" = sign ] && [ "$2" = bughub-product-aiterm-mcp-test ] && [ "$(pwd -P)" = "${fs.realpathSync(cwd)}" ] || exit 1\ncat > ${root}/seen\nprintf '%s\\n' '${sig}'\n`, { mode: 0o755 });
  const config = { url: GOOD.url, key_id: "k", item: "bughub-product-aiterm-mcp-test", auth, cwd: fs.realpathSync(cwd) };
  assert.equal(await signViaModule(config, "1790000000\nabc"), sig);
  assert.equal(fs.readFileSync(path.join(root, "seen"), "utf8"), "1790000000\nabc");
  await assert.rejects(signViaModule({ ...config, item: "bughub-product-aiterm-mcp-other" }, "x"));
  fs.writeFileSync(auth, "#!/bin/sh\necho not-a-signature\n", { mode: 0o755 });
  await assert.rejects(signViaModule(config, "x"));
});

// 偽のBugHub: ES256の要求を公開鍵で確かめ、ES256の応答を返す。
async function intake(t, controller) {
  const received = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const auth = /^BugHub-ES256 key_id=([^,]+), ts=(\d+), sig=([A-Za-z0-9+/]{86}==)$/.exec(request.headers.authorization ?? "");
      const verified = auth && (() => { try { return require_verify(auth, body); } catch { return false; } })();
      const report = JSON.parse(body.toString("utf8"));
      received.push({ keyId: auth?.[1], verified });
      const at = "2026-11-28T09:00:01.000Z";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ accepted: true, report_id: report.report_id, duplicate: false, received_at: at, sig: controller.forge ? "A".repeat(86) + "==" : es(`${report.report_id}\n${at}`), sig_alg: "ES256" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { received, url: `http://127.0.0.1:${server.address().port}/api/products/v1/runtime-errors` };
}
import { verify } from "node:crypto";
function require_verify(auth, body) {
  return verify("sha256", Buffer.from(`${auth[2]}\n${createHash("sha256").update(body).digest("hex")}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(auth[3], "base64"));
}

test("報告: 署名設定があればES256で送り、応答の署名が合う時だけ受領にする。署名できない時は何も進めない", { skip: posixOnly }, async (t) => {
  const controller = { forge: false };
  const bughub = await intake(t, controller);
  const root = tmp(t);
  const xdgConfigHome = path.join(root, "config");
  const xdgStateHome = path.join(root, "state");
  const paths = {
    reportingConfigPath: path.join(xdgConfigHome, "aiterm-mcp", "runtime-error-reporting.json"),
    credentialPath: path.join(xdgConfigHome, "bughub", "product-credentials", "aiterm-mcp.json"),
    signingPath: path.join(xdgConfigHome, "aiterm-mcp", "runtime-error-signing.json"),
    reportStatePath: path.join(xdgStateHome, "aiterm-mcp", "runtime-errors-report.json"),
  };
  const clock = { value: Date.parse("2026-11-28T09:00:00.500Z") };
  const now = () => new Date(clock.value);
  const store = new RuntimeErrorStore({ home: root, xdgConfigHome, xdgStateHome, now, productVersion: "0.70.122" });
  setRuntimeErrorReporting(paths.reportingConfigPath, true);
  fs.writeFileSync(paths.signingPath, JSON.stringify({ ...GOOD, url: bughub.url }));
  assert.equal(store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" }), true);
  let calls = 0;
  const signWith = (config, text) => { calls += 1; assert.equal(config.item, GOOD.item); return Promise.resolve(es(text)); };
  const report = (sign) => reportRuntimeErrors({ trigger: "manual", store, paths, now, installedVersion: "0.70.122", sign, responseKey: PEM });

  // 署名できない: 送らず、ackも進めない。
  clock.value += 120_000;
  assert.equal((await report(() => Promise.reject(new Error("module down")))).status, "signing_unavailable");
  assert.equal(bughub.received.length, 0);
  assert.equal(store.snapshot().acknowledged_cursor, 0);
  // 応答の署名が合わない: 受領にしない。
  clock.value += 120_000;
  controller.forge = true;
  assert.equal((await report(signWith)).status, "delivery_unknown");
  assert.deepEqual(bughub.received.at(-1), { keyId: GOOD.key_id, verified: true });
  assert.equal(store.snapshot().acknowledged_cursor, 0);
  // 合う: 受領。
  clock.value += 120_000;
  controller.forge = false;
  const result = await report(signWith);
  assert.equal(result.status, "accepted");
  assert.deepEqual(bughub.received.at(-1), { keyId: GOOD.key_id, verified: true });
  assert.equal(store.snapshot().acknowledged_cursor, store.snapshot().cursor);
  assert.equal(calls, 2);
});
