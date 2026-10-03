// BugHubの製品報告の契約（宛先・署名・本文・受領の条件）を、契約の試験値で固定する。
// 通信と保存は扱わない。形と署名だけを確かめる純粋関数の試験。
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildRuntimeErrorReport, reportBodyDigest, signReport, reportAuthorization,
  verifyReportResponse, readProductCredential,
} from "../dist/runtime-error-report.js";

// 契約の文書にある試験値（本物の鍵ではない）。
const SECRET = "bughub-test-secret-do-not-use-0123456789abcdef";
const TS = "1790000000";
const BODY = '{"schema_version":"1.0","report_id":"00000000-0000-4000-8000-000000000001","product_id":"caveat","installed_version":"0.19.13","observed_at":"2026-09-21T14:13:20.000Z","runtime_errors":[],"resolutions":[]}';
const BODY_SHA256 = "6a8ae99ecebde0f6d50b8e8d5273604c6e02c3df150645bd96de0e79d7710b2f";
const SIG = "e4ba0355c9d9058286a82d9622747eae264f780aa575e74859c40a6e529fa73a";
const REPORT_ID = "00000000-0000-4000-8000-000000000001";
const RECEIVED_AT = "2026-09-21T14:13:21.000Z";
const RESPONSE_SIG = "cc4ebb409cdd6a2be5f69f6acf8ebcd7f18acbe14b9ac82836797572f74a64bb";

const record = (overrides = {}) => ({
  product: "aiterm-mcp", product_version: "0.46.1", component: "pty-dependency",
  error_code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE", message_template: "PTY dependency is unavailable", severity: "high",
  fingerprint: "0b5fadbb613f3fe880172bb8bd1b97c3a558c2d3ef2e8ab83664e66a83e4e5f9", occurrence_count: 133,
  first_seen: "2026-08-30T08:10:47.762Z", last_seen: "2026-10-03T05:00:57.885Z", state_schema_version: "1.0",
  os: "linux", arch: "x64", status: "open", resolved_at: null, reason_code: null, sequence: 133, ...overrides,
});

test("report署名: 契約の試験値と一致する", () => {
  assert.equal(Buffer.byteLength(BODY), 205);
  assert.equal(reportBodyDigest(Buffer.from(BODY)), BODY_SHA256);
  assert.equal(signReport(SECRET, TS, Buffer.from(BODY)), SIG);
  assert.equal(reportAuthorization("key-1", TS, SIG), `BugHub-HMAC-SHA256 key_id=key-1, ts=${TS}, sig=${SIG}`);
});

test("report応答: 200の本文は accepted・report_id・署名がそろった時だけ受領とみなす", () => {
  const ok = { accepted: true, report_id: REPORT_ID, duplicate: false, received_at: RECEIVED_AT, sig: RESPONSE_SIG };
  assert.equal(verifyReportResponse(SECRET, REPORT_ID, ok), true);
  assert.equal(verifyReportResponse(SECRET, REPORT_ID, { ...ok, duplicate: true }), true);
  // 別の機器が返した200、他のreportの応答、欠けた応答は受領にしない。
  assert.equal(verifyReportResponse(SECRET, REPORT_ID, { ...ok, accepted: false }), false);
  assert.equal(verifyReportResponse(SECRET, "00000000-0000-4000-8000-000000000002", ok), false);
  assert.equal(verifyReportResponse(SECRET, REPORT_ID, { ...ok, received_at: "2026-09-21T14:13:22.000Z" }), false);
  assert.equal(verifyReportResponse(SECRET, REPORT_ID, { ...ok, sig: RESPONSE_SIG.replace(/^c/, "d") }), false);
  assert.equal(verifyReportResponse("another-secret", REPORT_ID, ok), false);
  assert.equal(verifyReportResponse(SECRET, REPORT_ID, { accepted: true, report_id: REPORT_ID }), false);
  assert.equal(verifyReportResponse(SECRET, REPORT_ID, null), false);
  assert.equal(verifyReportResponse(SECRET, REPORT_ID, "ok"), false);
});

test("report本文: 契約にある項目だけを載せ、解決の印はresolutionsへ分ける", () => {
  const resolved = record({
    error_code: "AITERM.VENDOR_LAUNCHER_FAILED", component: "vendor-launcher", message_template: "Optional vendor launcher failed",
    severity: "warn", fingerprint: "92d5a562b522a52b834e4e611c9340b0c1cd05ac7d4030de286cc5b0e4db722d", product_version: "unknown",
    status: "resolved", resolved_at: "2026-10-03T07:53:26.326Z", reason_code: "operator_resolved",
  });
  const body = buildRuntimeErrorReport([record(), resolved], {
    installedVersion: "0.47.1", reportId: REPORT_ID, observedAt: "2026-10-03T08:00:00.000Z",
  });
  assert.deepEqual(Object.keys(body), ["schema_version", "report_id", "product_id", "installed_version", "observed_at", "runtime_errors", "resolutions"]);
  assert.equal(body.schema_version, "1.0");
  assert.equal(body.product_id, "aiterm-mcp");
  assert.equal(body.installed_version, "0.47.1");
  // 端末名・OS・arch・保存用の連番は送らない。版がunknownの古い記録はそのまま送る。
  assert.deepEqual(Object.keys(body.runtime_errors[0]), [
    "fingerprint", "error_code", "component", "message_template", "severity", "status",
    "occurrence_count", "first_seen", "last_seen", "product_version", "state_schema_version",
  ]);
  assert.equal(body.runtime_errors[0].status, "open");
  assert.equal(body.runtime_errors[1].status, "resolved");
  assert.equal(body.runtime_errors[1].product_version, "unknown");
  assert.deepEqual(body.resolutions, [{
    fingerprint: "92d5a562b522a52b834e4e611c9340b0c1cd05ac7d4030de286cc5b0e4db722d",
    resolved_at: "2026-10-03T07:53:26.326Z", reason_code: "operator_resolved",
  }]);
  assert.throws(() => buildRuntimeErrorReport(Array(501).fill(record()), {
    installedVersion: "0.47.1", reportId: REPORT_ID, observedAt: "2026-10-03T08:00:00.000Z",
  }), /500/);
});

const posixOnly = process.platform === "win32" ? "POSIXの権限の検査" : undefined;

test("合鍵のファイル: 本人だけが読める通常のファイルだけを読む", { skip: posixOnly }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-credential-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "aiterm-mcp.json");
  const value = { url: "http://192.0.2.1:39310/api/products/v1/runtime-errors", key_id: "key-1", secret: SECRET };
  fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  assert.deepEqual(readProductCredential(file), { status: "ready", credential: value });
  // 無い端末（外の利用者）は「無い」と分かる形で返す。失敗にしない。
  assert.deepEqual(readProductCredential(path.join(dir, "missing.json")), { status: "missing" });
  // 他人が読める・symlink・形が違うファイルは使わない。
  fs.chmodSync(file, 0o644);
  assert.deepEqual(readProductCredential(file), { status: "rejected", reason: "unsafe_file" });
  fs.chmodSync(file, 0o600);
  const link = path.join(dir, "link.json");
  fs.symlinkSync(file, link);
  assert.deepEqual(readProductCredential(link), { status: "rejected", reason: "unsafe_file" });
  for (const bad of [{ ...value, extra: 1 }, { url: value.url, key_id: "key-1" }, { ...value, url: "ftp://192.0.2.1/x" }, { ...value, secret: "" }]) {
    fs.writeFileSync(file, JSON.stringify(bad), { mode: 0o600 });
    assert.deepEqual(readProductCredential(file), { status: "rejected", reason: "malformed" });
  }
  fs.writeFileSync(file, "{not json", { mode: 0o600 });
  assert.deepEqual(readProductCredential(file), { status: "rejected", reason: "malformed" });
});

// ---------------------------------------------------------------- 送信の流れ（契約どおりに振る舞う偽の受け口）
import * as http from "node:http";
import { createHmac, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RuntimeErrorStore } from "../dist/runtime-error-store.js";
import { reportRuntimeErrors, setRuntimeErrorReporting, triggerRuntimeErrorReport } from "../dist/runtime-error-report.js";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const hmac = (secret, text) => createHmac("sha256", Buffer.from(secret, "utf8")).update(text).digest("hex");

// 受け口は署名と時刻を確かめ、受けた本文を残す。modeで応答を変える。
async function intake(t) {
  const received = [];
  const control = { mode: "accept" };
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const auth = /^BugHub-HMAC-SHA256 key_id=([^,]+), ts=(\d+), sig=([0-9a-f]{64})$/.exec(request.headers.authorization ?? "");
      const signed = auth && auth[3] === hmac(SECRET, `${auth[2]}\n${createHash("sha256").update(body).digest("hex")}`);
      const report = JSON.parse(body.toString("utf8"));
      received.push({ method: request.method, url: request.url, contentType: request.headers["content-type"], keyId: auth?.[1], ts: auth?.[2], signed, report });
      const send = (status, value) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
      if (control.mode === "unauthorized") return send(401, { error: "unauthorized" });
      if (control.mode === "skew") return send(401, { error: "timestamp_skew", server_time: "2026-10-03T08:00:00.000Z" });
      if (control.mode === "busy") return send(503, { error: "unavailable" });
      if (control.mode === "invalid") return send(422, { error: "invalid_report", violations: [] });
      const receivedAt = "2026-10-03T08:00:01.000Z";
      const sig = control.mode === "forged" ? "0".repeat(64) : hmac(SECRET, `${report.report_id}\n${receivedAt}`);
      send(200, { accepted: true, report_id: report.report_id, duplicate: false, received_at: receivedAt, sig });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { received, control, url: `http://127.0.0.1:${server.address().port}/api/products/v1/runtime-errors` };
}

function reportFixture(t, url) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-report-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const xdgConfigHome = path.join(root, "config");
  const xdgStateHome = path.join(root, "state");
  const paths = {
    reportingConfigPath: path.join(xdgConfigHome, "aiterm-mcp", "runtime-error-reporting.json"),
    credentialPath: path.join(xdgConfigHome, "bughub", "product-credentials", "aiterm-mcp.json"),
    reportStatePath: path.join(xdgStateHome, "aiterm-mcp", "runtime-errors-report.json"),
  };
  const clock = { value: Date.parse("2026-10-03T08:00:00.500Z") };
  const now = () => new Date(clock.value);
  const store = new RuntimeErrorStore({ home: root, xdgConfigHome, xdgStateHome, now, productVersion: "0.47.1" });
  const placeCredential = (mode = 0o600) => {
    fs.mkdirSync(path.dirname(paths.credentialPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(paths.credentialPath, JSON.stringify({ url, key_id: "key-1", secret: SECRET }), { mode });
    fs.chmodSync(paths.credentialPath, mode);
  };
  const report = (trigger = "manual") => reportRuntimeErrors({ trigger, store, paths, now, installedVersion: "0.48.0" });
  return { root, paths, clock, store, placeCredential, report, env: { XDG_CONFIG_HOME: xdgConfigHome, XDG_STATE_HOME: xdgStateHome, HOME: root } };
}

// BugHub 2026-10-03: Latticeのreportが、故障の直後（同じ秒の中）に送ると422で断られた。observed_atを秒へ切り捨てていて、
// 記録の時刻（ミリ秒まで持つ）より前になっていた。Aitermの0.48.0も同じ作りだった。
test("報告: 記録の直後の同じ秒に送っても、observed_atを記録の時刻より前にしない", { skip: posixOnly }, async (t) => {
  const bughub = await intake(t);
  const f = reportFixture(t, bughub.url);
  setRuntimeErrorReporting(f.paths.reportingConfigPath, true);
  f.placeCredential();
  f.clock.value = Date.parse("2026-10-03T08:00:00.921Z");
  assert.equal(f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" }), true);
  f.clock.value = Date.parse("2026-10-03T08:00:00.950Z");
  assert.equal((await f.report()).status, "accepted");
  assert.equal(bughub.received[0].report.runtime_errors[0].last_seen, "2026-10-03T08:00:00.921Z");
  assert.equal(bughub.received[0].report.observed_at, "2026-10-03T08:00:00.950Z");
  assert.equal(bughub.received[0].ts, "1791014400");
  // 端末の時計が戻った時も、記録より前にしない。
  f.clock.value = Date.parse("2026-10-03T08:02:00.700Z");
  assert.equal(f.store.record({ code: "AITERM.VENDOR_LAUNCHER_FAILED" }), true);
  f.clock.value = Date.parse("2026-10-03T08:01:30.100Z");
  assert.equal((await f.report()).status, "accepted");
  assert.equal(bughub.received[1].report.observed_at, "2026-10-03T08:02:00.700Z");
});

test("報告: 既定では送らず、有効にしても合鍵の無い端末・読めない合鍵では送らない", { skip: posixOnly }, async (t) => {
  const bughub = await intake(t);
  const f = reportFixture(t, bughub.url);
  assert.equal((await f.report()).status, "disabled");
  setRuntimeErrorReporting(f.paths.reportingConfigPath, true);
  assert.equal((await f.report()).status, "no_credential");
  f.placeCredential(0o644);
  assert.equal((await f.report()).status, "credential_rejected");
  f.placeCredential();
  // 記録が無ければ送らない。
  assert.equal((await f.report()).status, "nothing_to_report");
  setRuntimeErrorReporting(f.paths.reportingConfigPath, false);
  assert.equal((await f.report()).status, "disabled");
  assert.equal(bughub.received.length, 0);
});

test("報告: 有効にした端末は記録も有効になり、受領を確かめた時だけ受け取り済みにする", { skip: posixOnly }, async (t) => {
  const bughub = await intake(t);
  const f = reportFixture(t, bughub.url);
  // 工場の収集設定が無くても、報告を有効にすれば記録できる。
  assert.equal(f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" }), false);
  setRuntimeErrorReporting(f.paths.reportingConfigPath, true);
  f.placeCredential();
  assert.equal(f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" }), true);
  assert.equal(f.store.record({ code: "AITERM.VENDOR_LAUNCHER_FAILED" }), true);
  const vendor = f.store.snapshot().records.find((record) => record.error_code === "AITERM.VENDOR_LAUNCHER_FAILED");
  assert.equal(f.store.resolve(vendor.fingerprint), true);
  const cursor = f.store.snapshot().cursor;

  const result = await f.report();
  assert.deepEqual(result, { status: "accepted", http_status: 200, reported_records: 2, acknowledged_cursor: cursor });
  assert.equal(bughub.received.length, 1);
  const got = bughub.received[0];
  assert.equal(got.method, "POST");
  assert.equal(got.contentType, "application/json");
  assert.equal(got.keyId, "key-1");
  assert.equal(got.signed, true, "本文の署名が合う");
  // tsとobserved_atは同じ時刻から作る。observed_atは秒へ切り捨てない（記録の時刻はミリ秒まで持つ）。
  assert.equal(got.ts, "1791014400");
  assert.equal(got.report.observed_at, "2026-10-03T08:00:00.500Z");
  // 受け口は、記録や解決が観測より後のreportを422で断る（time.observation_order・time.resolution_after_observation）。
  for (const record of got.report.runtime_errors) assert.ok(Date.parse(record.last_seen) <= Date.parse(got.report.observed_at));
  for (const item of got.report.resolutions) assert.ok(Date.parse(item.resolved_at) <= Date.parse(got.report.observed_at));
  assert.equal(got.report.product_id, "aiterm-mcp");
  assert.equal(got.report.installed_version, "0.48.0");
  assert.match(got.report.report_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(got.report.runtime_errors.map((record) => [record.error_code, record.status, record.occurrence_count]).sort(),
    [["AITERM.PTY_DEPENDENCY_UNAVAILABLE", "open", 1], ["AITERM.VENDOR_LAUNCHER_FAILED", "resolved", 1]]);
  assert.deepEqual(got.report.resolutions.map((item) => [item.fingerprint, item.reason_code]), [[vendor.fingerprint, "operator_resolved"]]);
  assert.ok(!JSON.stringify(got.report).includes(f.root), "pathを送らない");
  assert.equal(f.store.snapshot().acknowledged_cursor, cursor);
  // 受け取り済みなら送らない。
  f.clock.value += 5 * 60_000;
  assert.equal((await f.report()).status, "nothing_to_report");
  assert.equal(bughub.received.length, 1);
});

test("報告: 署名の合わない200・5xx・届かない宛先は「届いたか不明」とし、後で新しいreport_idで送り直す", { skip: posixOnly }, async (t) => {
  const bughub = await intake(t);
  const f = reportFixture(t, bughub.url);
  setRuntimeErrorReporting(f.paths.reportingConfigPath, true);
  f.placeCredential();
  f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" });
  bughub.control.mode = "forged";
  assert.deepEqual(await f.report(), { status: "delivery_unknown", http_status: 200, reported_records: 1, acknowledged_cursor: null });
  assert.equal(f.store.snapshot().acknowledged_cursor, 0, "受領を確かめられない時は受け取り済みにしない");
  // 受け口の上限（1分に1回）を越えて送らない。
  f.clock.value += 30_000;
  assert.equal((await f.report()).status, "deferred");
  assert.equal(bughub.received.length, 1);
  f.clock.value += 31_000;
  bughub.control.mode = "busy";
  assert.deepEqual(await f.report(), { status: "delivery_unknown", http_status: 503, reported_records: 1, acknowledged_cursor: null });
  f.clock.value += 61_000;
  bughub.control.mode = "accept";
  f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" });
  assert.equal((await f.report()).status, "accepted");
  // 送り直しは、その時点の累計を新しいreport_idで送る。
  assert.equal(bughub.received.length, 3);
  assert.equal(new Set(bughub.received.map((item) => item.report.report_id)).size, 3);
  assert.equal(bughub.received[2].report.runtime_errors[0].occurrence_count, 2);
  // 宛先へ届かない端末（家のLANの外）でも落ちない。
  const away = reportFixture(t, "http://127.0.0.1:9/api/products/v1/runtime-errors");
  setRuntimeErrorReporting(away.paths.reportingConfigPath, true);
  away.placeCredential();
  away.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" });
  assert.equal((await away.report()).status, "delivery_unknown");
  assert.equal(away.store.snapshot().acknowledged_cursor, 0);
});

test("報告: 自動の送信は多くても1時間に1回、合鍵が無効な間は同じ合鍵で送り続けない", { skip: posixOnly }, async (t) => {
  const bughub = await intake(t);
  const f = reportFixture(t, bughub.url);
  setRuntimeErrorReporting(f.paths.reportingConfigPath, true);
  f.placeCredential();
  f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" });
  assert.equal((await f.report("auto")).status, "accepted");
  f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" });
  f.clock.value += 59 * 60_000;
  assert.equal((await f.report("auto")).status, "deferred");
  assert.equal(bughub.received.length, 1);
  f.clock.value += 2 * 60_000;
  bughub.control.mode = "unauthorized";
  assert.deepEqual(await f.report("auto"), { status: "halted", http_status: 401, reported_records: 1, acknowledged_cursor: null });
  assert.equal(bughub.received.length, 2);
  // 同じ合鍵のままでは、時間が経っても自動では送らない。
  f.clock.value += 3 * 60 * 60_000;
  assert.deepEqual(await f.report("auto"), { status: "halted", http_status: null, reported_records: 0, acknowledged_cursor: null });
  assert.equal(bughub.received.length, 2);
  // 合鍵が置き直されたら、自動の送信へ戻る。
  bughub.control.mode = "accept";
  f.placeCredential();
  fs.utimesSync(f.paths.credentialPath, new Date(f.clock.value / 1000), new Date(Date.now() / 1000 + 100));
  assert.equal((await f.report("auto")).status, "accepted");
  assert.equal(bughub.received.length, 3);
  // 時刻のずれ（401 timestamp_skew）は合鍵の問題として止めない。形の違い（422）は断られたと返す。
  f.store.record({ code: "AITERM.PTY_DEPENDENCY_UNAVAILABLE" });
  f.clock.value += 61 * 60_000;
  bughub.control.mode = "skew";
  assert.equal((await f.report("auto")).status, "rejected");
  f.clock.value += 61 * 60_000;
  bughub.control.mode = "invalid";
  assert.deepEqual(await f.report("auto"), { status: "rejected", http_status: 422, reported_records: 1, acknowledged_cursor: null });
  assert.equal(f.store.snapshot().acknowledged_cursor < f.store.snapshot().cursor, true);
});

test("報告: CLIのスイッチは既定で無効、状態に宛先・合鍵・pathを出さない", { skip: posixOnly }, async (t) => {
  const f = reportFixture(t, "http://127.0.0.1:9/api/products/v1/runtime-errors");
  const cli = (...args) => {
    const result = spawnSync(process.execPath, [path.join(DIST, "runtime-errors-cli.js"), ...args], {
      encoding: "utf8", env: { ...process.env, ...f.env },
    });
    return { code: result.status, json: JSON.parse(result.stdout.trim().split("\n").pop()), stdout: result.stdout };
  };
  let out = cli("reporting", "status");
  assert.equal(out.json.status.reporting, "disabled");
  assert.equal(out.json.status.credential, "missing");
  assert.equal(out.json.status.collection, "disabled");
  assert.deepEqual(cli("report").json.result.status, "disabled");
  out = cli("reporting", "enable");
  assert.equal(out.json.status.reporting, "enabled");
  assert.equal(out.json.status.collection, "enabled");
  assert.equal((fs.statSync(f.paths.reportingConfigPath).mode & 0o777), 0o600);
  const noCredential = cli("report");
  assert.equal(noCredential.json.result.status, "no_credential");
  assert.equal(noCredential.code, 1);
  f.placeCredential();
  out = cli("reporting", "status");
  assert.equal(out.json.status.credential, "ready");
  assert.equal(out.json.status.unreported, 0);
  assert.ok(!out.stdout.includes("127.0.0.1") && !out.stdout.includes(SECRET) && !out.stdout.includes(f.root), "宛先・合鍵・pathを出さない");
  assert.equal(cli("reporting", "disable").json.status.reporting, "disabled");
});

test("報告: 試験の中からは自動の送信を起動しない", () => {
  // node:testの子で動いている時は、有効な端末でも起動しない（その端末の本物の記録を開発中の版の名前で送らない）。
  assert.ok(process.env.NODE_TEST_CONTEXT, "node:testの子で動いている");
  assert.equal(triggerRuntimeErrorReport(), false);
  assert.equal(triggerRuntimeErrorReport({ ...process.env, NODE_TEST_CONTEXT: "child-v8" }), false);
});
