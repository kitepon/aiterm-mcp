// BugHubへの実行時エラーの報告。明示して有効にした端末だけが、合鍵のファイルにある宛先へ累計を送る。
// 既定では通信しない。送るのは常に別processで、MCP processは通信しない。判断はADR 0079。
import { spawn } from "node:child_process";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultRuntimeErrorReportPaths, readBoundedFile, runtimeErrorReportingStatus } from "./runtime-error-os.js";
import { RuntimeErrorStore, type RuntimeErrorRecord } from "./runtime-error-store.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };
const WORKER = fileURLToPath(new URL("./runtime-error-worker.js", import.meta.url));
const REPORT_SCHEMA = "1.0" as const;
const REPORT_STATE_SCHEMA = "1.0" as const;
const MAX_REPORT_RECORDS = 500;
const MAX_REPORT_BYTES = 512 * 1024;
const MAX_CREDENTIAL_BYTES = 8 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
// 受け口の上限は端末×製品ごとに1分に1回。自動の送信は、未受領がある時だけ、多くても1時間に1回。
const MANUAL_MIN_INTERVAL_MS = 60_000;
const AUTO_MIN_INTERVAL_MS = 60 * 60_000;
const LOCK_STALE_MS = 2 * 60_000;

type ReportRecord = Pick<RuntimeErrorRecord,
  "fingerprint" | "error_code" | "component" | "message_template" | "severity" | "status"
  | "occurrence_count" | "first_seen" | "last_seen" | "product_version" | "state_schema_version">;
type ReportResolution = { fingerprint: string; resolved_at: string; reason_code: string };
export interface RuntimeErrorReport {
  schema_version: typeof REPORT_SCHEMA;
  report_id: string;
  product_id: "aiterm-mcp";
  installed_version: string;
  observed_at: string;
  runtime_errors: ReportRecord[];
  resolutions: ReportResolution[];
}

/** 契約にある項目だけを載せる。端末名・OS・arch・保存用の連番は送らない（端末は合鍵から決まる）。 */
export function buildRuntimeErrorReport(
  records: readonly RuntimeErrorRecord[],
  options: { installedVersion: string; reportId: string; observedAt: string },
): RuntimeErrorReport {
  if (records.length > MAX_REPORT_RECORDS) throw new Error(`1回のreportは${MAX_REPORT_RECORDS}件までです`);
  return {
    schema_version: REPORT_SCHEMA,
    report_id: options.reportId,
    product_id: "aiterm-mcp",
    installed_version: options.installedVersion,
    observed_at: options.observedAt,
    runtime_errors: records.map((record) => ({
      fingerprint: record.fingerprint, error_code: record.error_code, component: record.component,
      message_template: record.message_template, severity: record.severity, status: record.status,
      occurrence_count: record.occurrence_count, first_seen: record.first_seen, last_seen: record.last_seen,
      product_version: record.product_version, state_schema_version: record.state_schema_version,
    })),
    resolutions: records.filter((record) => record.status === "resolved" && record.resolved_at !== null && record.reason_code !== null)
      .map((record) => ({ fingerprint: record.fingerprint, resolved_at: record.resolved_at as string, reason_code: record.reason_code as string })),
  };
}

export function reportBodyDigest(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

/** sig = HMAC-SHA256(secret, ts + "\n" + 送ったバイト列のSHA-256の16進)。secretは文字列をそのままUTF-8で鍵にする。 */
export function signReport(secret: string, ts: string, body: Uint8Array): string {
  return createHmac("sha256", Buffer.from(secret, "utf8")).update(`${ts}\n${reportBodyDigest(body)}`).digest("hex");
}

export function reportAuthorization(keyId: string, ts: string, sig: string): string {
  return `BugHub-HMAC-SHA256 key_id=${keyId}, ts=${ts}, sig=${sig}`;
}

/** 受領とみなすのは、accepted・report_idの一致・応答の署名がそろった時だけ。別の機器が返した200を受領にしない。 */
export function verifyReportResponse(secret: string, reportId: string, response: unknown): boolean {
  if (typeof response !== "object" || response === null || Array.isArray(response)) return false;
  const value = response as { accepted?: unknown; report_id?: unknown; received_at?: unknown; sig?: unknown };
  if (value.accepted !== true || value.report_id !== reportId) return false;
  if (typeof value.received_at !== "string" || typeof value.sig !== "string" || !/^[0-9a-f]{64}$/.test(value.sig)) return false;
  const expected = createHmac("sha256", Buffer.from(secret, "utf8")).update(`${reportId}\n${value.received_at}`).digest();
  return timingSafeEqual(expected, Buffer.from(value.sig, "hex"));
}

export interface ProductCredential { url: string; key_id: string; secret: string }
export type ProductCredentialResult =
  | { status: "ready"; credential: ProductCredential }
  | { status: "missing" }
  | { status: "rejected"; reason: "unsafe_file" | "malformed" };

/** 合鍵のファイルは、本人だけが読める通常のファイルだけを読む。無い端末は「無い」と返し、失敗にしない。 */
export function readProductCredential(file: string, platform: NodeJS.Platform = process.platform): ProductCredentialResult {
  let text: string;
  try { text = readBoundedFile(file, MAX_CREDENTIAL_BYTES, platform, true); }
  catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { status: "missing" } : { status: "rejected", reason: "unsafe_file" };
  }
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return { status: "rejected", reason: "malformed" };
    const credential = value as Partial<ProductCredential>;
    if (Object.keys(credential).sort().join(",") !== "key_id,secret,url") return { status: "rejected", reason: "malformed" };
    if (typeof credential.url !== "string" || typeof credential.key_id !== "string" || typeof credential.secret !== "string"
      || !/^[A-Za-z0-9._-]{1,128}$/.test(credential.key_id) || credential.secret.length < 1 || credential.secret.length > 1024) {
      return { status: "rejected", reason: "malformed" };
    }
    const url = new URL(credential.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { status: "rejected", reason: "malformed" };
    return { status: "ready", credential: { url: credential.url, key_id: credential.key_id, secret: credential.secret } };
  } catch { return { status: "rejected", reason: "malformed" }; }
}

export function setRuntimeErrorReporting(file: string, enabled: boolean): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ schema_version: "1.0", enabled })}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

export type ReportStatus =
  | "accepted" | "disabled" | "no_credential" | "credential_rejected" | "nothing_to_report"
  | "deferred" | "halted" | "delivery_unknown" | "rejected" | "rate_limited";
export interface ReportResult {
  status: ReportStatus;
  http_status: number | null;
  reported_records: number;
  acknowledged_cursor: number | null;
}
interface ReportState {
  schema_version: typeof REPORT_STATE_SCHEMA;
  last_attempt_at: string | null;
  last_status: ReportStatus | null;
  last_http_status: number | null;
  last_accepted_at: string | null;
  // 401・403を受けた時の合鍵のファイルの更新時刻。同じファイルのまま自動で送り続けない。
  halted_credential_mtime_ms: number | null;
}
const EMPTY_REPORT_STATE = (): ReportState => ({
  schema_version: REPORT_STATE_SCHEMA, last_attempt_at: null, last_status: null, last_http_status: null,
  last_accepted_at: null, halted_credential_mtime_ms: null,
});

export function readReportState(file: string): ReportState {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ReportState>;
    if (value?.schema_version !== REPORT_STATE_SCHEMA) return EMPTY_REPORT_STATE();
    return { ...EMPTY_REPORT_STATE(), ...value };
  } catch { return EMPTY_REPORT_STATE(); }
}

function writeReportState(file: string, state: ReportState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

export interface ReportOptions {
  trigger: "manual" | "auto";
  store?: RuntimeErrorStore;
  paths?: { reportingConfigPath: string; credentialPath: string; reportStatePath: string };
  platform?: NodeJS.Platform;
  installedVersion?: string;
  now?: () => Date;
  fetch?: typeof fetch;
}

/**
 * 未受領の記録がある時に、その時点の累計を1回送る。受領を確かめられた時だけ受け取り済みにする。
 * 届いたか分からない時は何も進めない。次の機会に、その時点の累計を新しいreport_idで送り直す。
 */
export async function reportRuntimeErrors(options: ReportOptions): Promise<ReportResult> {
  const platform = options.platform ?? process.platform;
  const paths = options.paths ?? defaultRuntimeErrorReportPaths({ platform });
  const now = options.now ?? (() => new Date());
  const result = (status: ReportStatus, extra: Partial<ReportResult> = {}): ReportResult =>
    ({ status, http_status: null, reported_records: 0, acknowledged_cursor: null, ...extra });
  if (runtimeErrorReportingStatus(paths.reportingConfigPath, platform) !== "enabled") return result("disabled");
  const credential = readProductCredential(paths.credentialPath, platform);
  if (credential.status === "missing") return result("no_credential");
  if (credential.status === "rejected") return result("credential_rejected");
  const store = options.store ?? new RuntimeErrorStore();
  const snapshot = store.snapshot();
  if (snapshot.collection !== "enabled" || snapshot.cursor <= snapshot.acknowledged_cursor) return result("nothing_to_report");

  const lock = `${paths.reportStatePath}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  try { fs.mkdirSync(lock); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // 別のprocessが送っている。途中で落ちたprocessの残りだけ、時間を置いて引き取る。
    let stale = false;
    try { stale = now().getTime() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS; } catch { /* 相手が外した */ }
    if (!stale) return result("deferred");
    try { fs.rmdirSync(lock); fs.mkdirSync(lock); } catch { return result("deferred"); }
  }
  try {
    const state = readReportState(paths.reportStatePath);
    const started = now();
    const sinceLast = state.last_attempt_at === null ? Infinity : started.getTime() - Date.parse(state.last_attempt_at);
    if (sinceLast < (options.trigger === "auto" ? AUTO_MIN_INTERVAL_MS : MANUAL_MIN_INTERVAL_MS)) return result("deferred");
    let credentialMtime: number | null = null;
    try { credentialMtime = fs.statSync(paths.credentialPath).mtimeMs; } catch { /* 読めた直後に消えた時は下の送信結果に任せる */ }
    if (options.trigger === "auto" && state.halted_credential_mtime_ms !== null && state.halted_credential_mtime_ms === credentialMtime) {
      return result("halted");
    }

    // tsとobserved_atは同じ時刻から作る（受け口は両者が10分より離れたreportを断る）。
    const ts = String(Math.floor(started.getTime() / 1000));
    const reportId = randomUUID();
    const report = buildRuntimeErrorReport(snapshot.records, {
      installedVersion: options.installedVersion ?? pkg.version, reportId,
      observedAt: new Date(Number(ts) * 1000).toISOString(),
    });
    const body = Buffer.from(JSON.stringify(report), "utf8");
    if (body.byteLength > MAX_REPORT_BYTES) throw new Error("reportが大きすぎます");
    const finish = (status: ReportStatus, httpStatus: number | null, acknowledged: number | null = null): ReportResult => {
      writeReportState(paths.reportStatePath, {
        ...state, last_attempt_at: started.toISOString(), last_status: status, last_http_status: httpStatus,
        last_accepted_at: status === "accepted" ? started.toISOString() : state.last_accepted_at,
        halted_credential_mtime_ms: status === "halted" ? credentialMtime : null,
      });
      return result(status, { http_status: httpStatus, reported_records: report.runtime_errors.length, acknowledged_cursor: acknowledged });
    };

    let response: Response;
    let text: string;
    try {
      response = await (options.fetch ?? fetch)(credential.credential.url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          "content-type": "application/json",
          authorization: reportAuthorization(credential.credential.key_id, ts, signReport(credential.credential.secret, ts, body)),
        },
        body,
      });
      text = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
    } catch { return finish("delivery_unknown", null); }
    if (response.status === 200) {
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { /* 署名を確かめられない200は受領にしない */ }
      if (!verifyReportResponse(credential.credential.secret, reportId, parsed)) return finish("delivery_unknown", 200);
      store.acknowledge(snapshot.cursor);
      return finish("accepted", 200, snapshot.cursor);
    }
    // 合鍵が無効な間は、同じファイルのまま自動で送り続けない。時刻のずれ（401 timestamp_skew）は合鍵の問題ではない。
    if ((response.status === 401 && !/skew/i.test(text)) || response.status === 403) return finish("halted", response.status);
    if (response.status === 429) return finish("rate_limited", 429);
    if (response.status >= 500) return finish("delivery_unknown", response.status);
    return finish("rejected", response.status);
  } finally {
    try { fs.rmdirSync(lock); } catch { /* 古いlockとして引き取られた */ }
  }
}

/**
 * 自動の送信を別processへ頼む。呼ぶ側（MCP process・記録のworker・CLI）は通信しない。
 * 有効でない端末では何も起動しない。node:testの子で動く時も起動しない（試験が、その端末の本物の記録を
 * 開発中の版の名前で送らないように）。
 */
export function triggerRuntimeErrorReport(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_TEST_CONTEXT) return false;
  try {
    if (runtimeErrorReportingStatus(defaultRuntimeErrorReportPaths().reportingConfigPath) !== "enabled") return false;
    const child = spawn(process.execPath, [WORKER, "report"], { stdio: "ignore", detached: true, windowsHide: true, env });
    child.once("error", () => { /* 送れない時は次の機会に送る */ });
    child.unref();
    return true;
  } catch { return false; }
}
