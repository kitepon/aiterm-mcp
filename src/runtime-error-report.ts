// BugHubへの実行時エラーの報告。明示して有効にした端末だけが、合鍵のファイルにある宛先へ累計を送る。
// 既定では通信しない。送るのは常に別processで、MCP processは通信しない。判断はADR 0079。
import { spawn } from "node:child_process";
import { createHash, createHmac, createPublicKey, randomUUID, timingSafeEqual, verify } from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultRuntimeErrorReportPaths, forceKill, readBoundedFile, runtimeErrorReportingStatus } from "./runtime-error-os.js";
import { liveNodeExecutable } from "./live-node.js";
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

// BugHubの応答用公開鍵（ES256）。鍵が替わる時は新版を出す。
const BUGHUB_RESPONSE_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEX+kilvDhn190l4Z+iR5J4KusmOSJ
ZVBQjMaLGOshDFzUwB7IxiJsgLMpQzOdoEWM21DCBpL1QyY1COU2cmuE1g==
-----END PUBLIC KEY-----`;
const MAX_SIGNING_CONFIG_BYTES = 4 * 1024;
const SIGN_TIMEOUT_MS = 30_000;

/** 署名設定（秘密なし）。鍵は認証仲介の中にだけある。sshがあれば、そのtargetでmain-serverへ入りcwdで署名する。 */
export interface SigningConfig { url: string; key_id: string; item: string; auth: string; cwd: string; ssh?: string }
export type SigningConfigResult = { status: "ready"; config: SigningConfig } | { status: "missing" } | { status: "rejected" };

/** 設定の文字列はshellへ渡すので、使える文字を絞る。 */
export function readSigningConfig(file: string | undefined, platform: NodeJS.Platform = process.platform): SigningConfigResult {
  if (file === undefined) return { status: "missing" };
  let text: string;
  try { text = readBoundedFile(file, MAX_SIGNING_CONFIG_BYTES, platform, false); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? { status: "missing" } : { status: "rejected" }; }
  try {
    const value = JSON.parse(text) as Record<string, unknown> | null;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return { status: "rejected" };
    const keys = Object.keys(value).sort().join(",");
    if (keys !== "auth,cwd,item,key_id,schema_version,url" && keys !== "auth,cwd,item,key_id,schema_version,ssh,url") return { status: "rejected" };
    const ok = (field: string, pattern: RegExp) => typeof value[field] === "string" && pattern.test(value[field] as string);
    if (value.schema_version !== "1.0" || !ok("key_id", /^[A-Za-z0-9._-]{1,128}$/) || !ok("item", /^bughub-product-aiterm-mcp-[a-z0-9-]{1,40}$/)
      || !ok("auth", /^[A-Za-z0-9._\/~-]{1,200}$/) || !ok("cwd", /^\/[A-Za-z0-9._\/-]{1,200}$/)
      || ("ssh" in value && !ok("ssh", /^[A-Za-z0-9._-]{1,64}@[A-Za-z0-9.-]{1,253}$/))) return { status: "rejected" };
    const url = new URL(value.url as string);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { status: "rejected" };
    const { url: u, key_id, item, auth, cwd, ssh } = value as Record<string, string>;
    return { status: "ready", config: { url: u, key_id, item, auth, cwd, ...(ssh === undefined ? {} : { ssh }) } };
  } catch { return { status: "rejected" }; }
}

/**
 * 認証仲介の`auth sign <品目>`へtextを渡し、base64の生r‖s（64バイト）を返す。textは一時fileから渡す（Windowsのsshはpipeで止まる）。
 * 断られた・止まっている・sshが通らない時は投げる。
 */
export function signViaModule(config: SigningConfig, text: string, platform: NodeJS.Platform = process.platform): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-sign-"));
  const input = path.join(dir, "text");
  fs.writeFileSync(input, text, { mode: 0o600 });
  const fd = fs.openSync(input, "r");
  const ssh = platform === "win32" ? path.win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "OpenSSH", "ssh.exe") : "ssh";
  return new Promise((resolve, reject) => {
    const child = config.ssh === undefined
      ? spawn(config.auth, ["sign", config.item], { cwd: config.cwd, stdio: [fd, "pipe", "ignore"], windowsHide: true })
      : spawn(ssh, ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", config.ssh, `cd ${config.cwd} && exec ${config.auth} sign ${config.item}`], { stdio: [fd, "pipe", "ignore"], windowsHide: true });
    let out = "";
    let settled = false;
    const timer = setTimeout(() => forceKill(child), SIGN_TIMEOUT_MS);
    const settle = (error: Error | null) => {
      if (settled) return;
      settled = true; clearTimeout(timer); fs.closeSync(fd); fs.rmSync(dir, { recursive: true, force: true });
      const signature = out.trim();
      if (error || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) reject(error ?? new Error("署名を得られませんでした"));
      else resolve(signature);
    };
    child.stdout?.on("data", (chunk: Buffer) => { if (out.length < 1024) out += chunk.toString("utf8"); });
    child.once("error", (error) => settle(error));
    child.once("close", (code) => settle(code === 0 ? null : new Error("署名の呼び出しが失敗しました")));
  });
}

export function authorizationEs256(keyId: string, ts: string, sig: string): string {
  return `BugHub-ES256 key_id=${keyId}, ts=${ts}, sig=${sig}`;
}

/** ES256の受領。HMACの場合と同じく、accepted・report_idの一致・応答署名がそろった時だけ。 */
export function verifyReportResponseEs256(publicKey: string, reportId: string, response: unknown): boolean {
  if (typeof response !== "object" || response === null || Array.isArray(response)) return false;
  const value = response as { accepted?: unknown; report_id?: unknown; received_at?: unknown; sig?: unknown; sig_alg?: unknown };
  if (value.accepted !== true || value.report_id !== reportId || value.sig_alg !== "ES256") return false;
  if (typeof value.received_at !== "string" || typeof value.sig !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(value.sig)) return false;
  try {
    return verify("sha256", Buffer.from(`${reportId}\n${value.received_at}`, "utf8"), { key: createPublicKey(publicKey), dsaEncoding: "ieee-p1363" }, Buffer.from(value.sig, "base64"));
  } catch { return false; }
}

export function setRuntimeErrorReporting(file: string, enabled: boolean): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ schema_version: "1.0", enabled })}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

export type ReportStatus =
  | "accepted" | "disabled" | "no_credential" | "credential_rejected" | "nothing_to_report"
  | "deferred" | "halted" | "delivery_unknown" | "rejected" | "rate_limited" | "signing_unavailable";
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
  paths?: { reportingConfigPath: string; credentialPath: string; reportStatePath: string; signingPath?: string };
  platform?: NodeJS.Platform;
  sign?: (config: SigningConfig, text: string) => Promise<string>;
  responseKey?: string;
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
  // 署名設定があればES256。無い端末だけ従来の合鍵（HMAC）。全端末が切り替わったらHMACの経路を消す。
  const signing = readSigningConfig(paths.signingPath, platform);
  if (signing.status === "rejected") return result("credential_rejected");
  const credential = signing.status === "ready" ? null : readProductCredential(paths.credentialPath, platform);
  if (credential?.status === "missing") return result("no_credential");
  if (credential?.status === "rejected") return result("credential_rejected");
  const credentialFile = signing.status === "ready" ? paths.signingPath as string : paths.credentialPath;
  const target = signing.status === "ready" ? signing.config : (credential as { status: "ready"; credential: ProductCredential }).credential;
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
    try { credentialMtime = fs.statSync(credentialFile).mtimeMs; } catch { /* 読めた直後に消えた時は下の送信結果に任せる */ }
    if (options.trigger === "auto" && state.halted_credential_mtime_ms !== null && state.halted_credential_mtime_ms === credentialMtime) {
      return result("halted");
    }

    // tsとobserved_atは同じ時刻から作る（受け口は両者が10分より離れたreportを断る）。
    // observed_atは秒へ切り捨てず、載せる記録のどの時刻よりも前にしない。受け口は、記録や解決が観測より後のreportを
    // 422で断る。記録の時刻はミリ秒まで持つので、切り捨てると、記録の直後（同じ秒の中）の自動送信が断られていた。
    const ts = String(Math.floor(started.getTime() / 1000));
    const observed = Math.max(started.getTime(), ...snapshot.records.flatMap((record) =>
      [Date.parse(record.last_seen), record.resolved_at === null ? 0 : Date.parse(record.resolved_at)]));
    const reportId = randomUUID();
    const report = buildRuntimeErrorReport(snapshot.records, {
      installedVersion: options.installedVersion ?? pkg.version, reportId,
      observedAt: new Date(observed).toISOString(),
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

    let authorization: string;
    if (signing.status === "ready") {
      try { authorization = authorizationEs256(target.key_id, ts, await (options.sign ?? signViaModule)(signing.config, `${ts}\n${reportBodyDigest(body)}`)); }
      catch { return finish("signing_unavailable", null); }
    } else authorization = reportAuthorization(target.key_id, ts, signReport((credential as { status: "ready"; credential: ProductCredential }).credential.secret, ts, body));
    let response: Response;
    let text: string;
    try {
      response = await (options.fetch ?? fetch)(target.url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "content-type": "application/json", authorization },
        body,
      });
      text = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
    } catch { return finish("delivery_unknown", null); }
    if (response.status === 200) {
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { /* 署名を確かめられない200は受領にしない */ }
      const verified = signing.status === "ready"
        ? verifyReportResponseEs256(options.responseKey ?? BUGHUB_RESPONSE_KEY, reportId, parsed)
        : verifyReportResponse((credential as { status: "ready"; credential: ProductCredential }).credential.secret, reportId, parsed);
      if (!verified) return finish("delivery_unknown", 200);
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
    const child = spawn(liveNodeExecutable(), [WORKER, "report"], { stdio: "ignore", detached: true, windowsHide: true, env });
    child.once("error", () => { /* 送れない時は次の機会に送る */ });
    child.unref();
    return true;
  } catch { return false; }
}
