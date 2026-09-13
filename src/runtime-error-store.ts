import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { defaultRuntimeErrorPaths, windowsPrivateDaclCommand, windowsPrivateDaclVerifyCommand, expectedHostProfiles, readBoundedFile, processStartIdentity, forceKill } from "./runtime-error-os.js";
export { defaultRuntimeErrorPaths, windowsPrivateDaclCommand, windowsPrivateDaclVerifyCommand } from "./runtime-error-os.js";
import { fileURLToPath } from "node:url";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };
const STORE_SCHEMA = "aiterm-mcp.runtime-errors.v2" as const;
const STATE_SCHEMA = "1.0" as const;
const MAX_CONFIG_BYTES = 16 * 1024;
const MAX_STORE_BYTES = 1024 * 1024;
const POSIX_WORKER_TIMEOUT_MS = 2_000;
// Windows はprivate DACLの適用とreadbackをPowerShell 7境界で行う。診断は最大2回、
// 記録はlock queueとstate更新で複数回この境界を通るため、process起動だけを想定した
// POSIXの2秒上限では正常処理まで強制終了する。各境界自身の5秒上限は維持し、worker全体だけ分ける。
const WINDOWS_DIAGNOSTIC_WORKER_TIMEOUT_MS = 12_000;
const WINDOWS_RECORD_WORKER_TIMEOUT_MS = 30_000;

export const RUNTIME_ERROR_DEFINITIONS = Object.freeze({
  "AITERM.PTY_DEPENDENCY_UNAVAILABLE": Object.freeze({
    component: "pty-dependency", message_template: "PTY dependency is unavailable", severity: "high",
  }),
  "AITERM.PERSISTENCE_WRITE_FAILED": Object.freeze({
    component: "persistence", message_template: "PTY persistence operation failed", severity: "high",
  }),
  "AITERM.VENDOR_LAUNCHER_FAILED": Object.freeze({
    component: "vendor-launcher", message_template: "Optional vendor launcher failed", severity: "warn",
  }),
} as const);

export type RuntimeErrorCode = keyof typeof RUNTIME_ERROR_DEFINITIONS;
export type RuntimeObservation = { code: RuntimeErrorCode };
type CollectionStatus = "enabled" | "disabled" | "malformed";
type RuntimeStatus = "open" | "resolved";
type DiagnosticStatus = "ready" | "not_applicable" | "unverified";

export interface RuntimeErrorRecord {
  product: "aiterm-mcp";
  product_version: string;
  component: string;
  error_code: RuntimeErrorCode;
  message_template: string;
  severity: "high" | "warn";
  fingerprint: string;
  occurrence_count: number;
  first_seen: string;
  last_seen: string;
  state_schema_version: "1.0";
  os: "darwin" | "linux" | "windows";
  arch: "x64" | "arm64" | "arm" | "ia32";
  status: RuntimeStatus;
  resolved_at: string | null;
  reason_code: "operator_resolved" | null;
  sequence: number;
}

interface StoreState {
  schema_version: typeof STORE_SCHEMA;
  cursor: number;
  acknowledged_cursor: number;
  records: RuntimeErrorRecord[];
}

export interface RuntimeErrorSnapshot extends StoreState { collection: CollectionStatus }
export interface RuntimeErrorDiagnostic {
  status: DiagnosticStatus;
  collection: CollectionStatus;
  record_count: number | null;
  unacknowledged_count: number | null;
}

export interface RuntimeErrorStoreOptions {
  configPath?: string;
  storePath?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  productVersion?: string;
  home?: string;
  localAppData?: string;
  xdgConfigHome?: string;
  xdgStateHome?: string;
  now?: () => Date;
  stderr?: (line: string) => void;
  maxRecords?: number;
  windowsAclTimeoutMs?: number;
}

const TOP_KEYS = ["schema_version", "cursor", "acknowledged_cursor", "records"] as const;
const RECORD_KEYS = [
  "product", "product_version", "component", "error_code", "message_template", "severity", "fingerprint",
  "occurrence_count", "first_seen", "last_seen", "state_schema_version", "os", "arch", "status",
  "resolved_at", "reason_code", "sequence",
] as const;
const DIAGNOSTIC_KEYS = ["status", "collection", "record_count", "unacknowledged_count"] as const;
const ARCHES = new Set(["x64", "arm64", "arm", "ia32"]);

const EMPTY_STATE = (): StoreState => ({ schema_version: STORE_SCHEMA, cursor: 0, acknowledged_cursor: 0, records: [] });
// readLock と queue scan の内部だけで使う。entry 本文など外部入力の Error message で
// disappearance を判定しないため、公開せず型そのものを識別子にする。
class LockDisappearedOrReplacedError extends Error {
  constructor() { super("runtime error store lock が消滅または置換されました"); }
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}
function validUtc(value: unknown): value is string {
  return typeof value === "string" && value.endsWith("Z") && Number.isFinite(Date.parse(value));
}

export function validateRuntimeObservation(value: unknown): RuntimeObservation {
  if (!isObject(value)) throw new Error("runtime observation は object 必須です");
  if (!exactKeys(value, ["code"])) throw new Error("runtime observation に allowlist 外 field があります");
  if (typeof value.code !== "string" || !(value.code in RUNTIME_ERROR_DEFINITIONS)) {
    throw new Error("runtime observation code は allowlist 外です");
  }
  return { code: value.code as RuntimeErrorCode };
}

function validateCanonicalConfig(config: unknown, platform: NodeJS.Platform): boolean {
  if (!isObject(config) || !exactKeys(config, ["schema_version", "host", "collection", "reporting"])) return false;
  if (config.schema_version !== "1.0" || !isObject(config.host) || !exactKeys(config.host, ["id", "profile"])) return false;
  if (typeof config.host.id !== "string" || config.host.id.length < 1 || config.host.id.length > 64
    || !/^[a-z0-9][a-z0-9._-]*$/.test(config.host.id)) return false;
  if (typeof config.host.profile !== "string" || !expectedHostProfiles(platform).includes(config.host.profile)) return false;
  if (!isObject(config.collection) || !exactKeys(config.collection, ["enabled"])
    || typeof config.collection.enabled !== "boolean") return false;
  if (!isObject(config.reporting)) return false;
  const reportingKeys = Object.keys(config.reporting);
  if (reportingKeys.some((key) => !["enabled", "endpoint", "credential_file"].includes(key))
    || !reportingKeys.includes("enabled") || typeof config.reporting.enabled !== "boolean") return false;
  if ("endpoint" in config.reporting) {
    if (typeof config.reporting.endpoint !== "string" || config.reporting.endpoint.length > 2048
      || !/^https?:\/\//.test(config.reporting.endpoint)) return false;
    try { if (!["http:", "https:"].includes(new URL(config.reporting.endpoint).protocol)) return false; } catch { return false; }
  }
  if ("credential_file" in config.reporting
    && (typeof config.reporting.credential_file !== "string"
      || config.reporting.credential_file.length < 1 || config.reporting.credential_file.length > 4096)) return false;
  if (config.reporting.enabled && (!("endpoint" in config.reporting) || !("credential_file" in config.reporting))) return false;
  return true;
}

function collectionStatus(configPath: string, platform: NodeJS.Platform): CollectionStatus {
  let text: string;
  try { text = readBoundedFile(configPath, MAX_CONFIG_BYTES, platform, true); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "disabled" : "malformed"; }
  try {
    const config: unknown = JSON.parse(text);
    if (!validateCanonicalConfig(config, platform)) return "malformed";
    return (config as { collection: { enabled: boolean } }).collection.enabled ? "enabled" : "disabled";
  } catch { return "malformed"; }
}

function platformName(platform: NodeJS.Platform): "darwin" | "linux" | "windows" {
  return platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
}
function fingerprintFor(code: RuntimeErrorCode): string {
  const definition = RUNTIME_ERROR_DEFINITIONS[code];
  return createHash("sha256").update(["aiterm-mcp", definition.component, code, definition.message_template].join("\0")).digest("hex");
}
function projectRecord(record: Record<string, unknown>): RuntimeErrorRecord {
  return Object.fromEntries(RECORD_KEYS.map((key) => [key, record[key]])) as unknown as RuntimeErrorRecord;
}

function validateRecord(value: unknown, cursor: number): RuntimeErrorRecord | null {
  if (!isObject(value) || !exactKeys(value, RECORD_KEYS)) return null;
  if (value.product !== "aiterm-mcp" || typeof value.product_version !== "string"
    || !/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/.test(value.product_version)) return null;
  if (typeof value.error_code !== "string" || !(value.error_code in RUNTIME_ERROR_DEFINITIONS)) return null;
  const code = value.error_code as RuntimeErrorCode;
  const def = RUNTIME_ERROR_DEFINITIONS[code];
  if (value.component !== def.component || value.message_template !== def.message_template || value.severity !== def.severity
    || value.fingerprint !== fingerprintFor(code)) return null;
  if (!Number.isSafeInteger(value.occurrence_count) || Number(value.occurrence_count) < 1
    || !validUtc(value.first_seen) || !validUtc(value.last_seen)
    || Date.parse(value.first_seen) > Date.parse(value.last_seen)) return null;
  if (value.state_schema_version !== STATE_SCHEMA || !["darwin", "linux", "windows"].includes(String(value.os))
    || typeof value.arch !== "string" || !ARCHES.has(value.arch)
    || !["open", "resolved"].includes(String(value.status))) return null;
  if ((value.status === "open" && (value.resolved_at !== null || value.reason_code !== null))
    || (value.status === "resolved" && (!validUtc(value.resolved_at)
      || Date.parse(value.resolved_at) < Date.parse(value.last_seen)
      || value.reason_code !== "operator_resolved"))) return null;
  if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1 || Number(value.sequence) > cursor) return null;
  return projectRecord(value);
}

function validateState(value: unknown, maxRecords = 256): StoreState | null {
  if (!isObject(value) || !exactKeys(value, TOP_KEYS) || value.schema_version !== STORE_SCHEMA
    || !Number.isSafeInteger(value.cursor) || Number(value.cursor) < 0
    || !Number.isSafeInteger(value.acknowledged_cursor) || Number(value.acknowledged_cursor) < 0
    || Number(value.acknowledged_cursor) > Number(value.cursor)
    || !Array.isArray(value.records) || value.records.length > maxRecords) return null;
  const records = value.records.map((record) => validateRecord(record, Number(value.cursor)));
  if (records.some((record) => record === null)) return null;
  const typed = records as RuntimeErrorRecord[];
  if (new Set(typed.map((record) => record.fingerprint)).size !== typed.length
    || new Set(typed.map((record) => record.sequence)).size !== typed.length) return null;
  return {
    schema_version: STORE_SCHEMA,
    cursor: Number(value.cursor),
    acknowledged_cursor: Number(value.acknowledged_cursor),
    records: typed.map((record) => projectRecord(record as unknown as Record<string, unknown>)),
  };
}

export class RuntimeErrorStore {
  readonly configPath: string;
  readonly storePath: string;
  private readonly platform: NodeJS.Platform;
  private readonly arch: RuntimeErrorRecord["arch"];
  private readonly productVersion: string;
  private readonly now: () => Date;
  private readonly stderr: (line: string) => void;
  private readonly maxRecords: number;
  private readonly windowsAclTimeoutMs: number;

  constructor(options: RuntimeErrorStoreOptions = {}) {
    const defaults = defaultRuntimeErrorPaths(options);
    this.configPath = options.configPath ?? defaults.configPath;
    this.storePath = options.storePath ?? defaults.storePath;
    this.platform = options.platform ?? process.platform;
    if (!ARCHES.has(options.arch ?? process.arch)) throw new Error("arch が不正です");
    this.arch = (options.arch ?? process.arch) as RuntimeErrorRecord["arch"];
    this.productVersion = options.productVersion ?? pkg.version;
    this.now = options.now ?? (() => new Date());
    this.stderr = options.stderr ?? ((line) => process.stderr.write(line));
    this.maxRecords = options.maxRecords ?? 256;
    this.windowsAclTimeoutMs = options.windowsAclTimeoutMs ?? 5000;
    if (!Number.isInteger(this.maxRecords) || this.maxRecords < 1 || this.maxRecords > 256) throw new Error("maxRecords は 1..256 必須です");
  }

  collectionStatus(): CollectionStatus { return collectionStatus(this.configPath, this.platform); }

  private assertPrivateDirectory(dir: string): void {
    const info = fs.lstatSync(dir);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("runtime error store directory が安全ではありません");
    if (this.platform !== "win32") {
      if (typeof process.getuid !== "function" || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700) {
        throw new Error("runtime error store directory owner/mode が不正です");
      }
    }
  }

  private readState(): StoreState {
    const dir = path.dirname(this.storePath);
    try { this.assertPrivateDirectory(dir); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_STATE(); throw error; }
    if (this.platform === "win32") {
      this.applyWindowsDacl(dir, "directory");
      if (fs.existsSync(this.storePath)) this.applyWindowsDacl(this.storePath, "file");
    }
    let text: string;
    try { text = readBoundedFile(this.storePath, MAX_STORE_BYTES, this.platform, this.platform !== "win32"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_STATE(); throw error; }
    const value: unknown = JSON.parse(text);
    const legacy = isObject(value) && value.schema_version === "aiterm-mcp.runtime-errors.v1";
    const state = validateState(legacy ? { ...value, schema_version: STORE_SCHEMA } : value, this.maxRecords);
    if (!state) throw new Error("runtime error store schema が不正です");
    // 旧集約は初回版だけを保持した。複数回発生した記録の最終発生版は復元できない。
    if (legacy) for (const record of state.records) {
      if (record.occurrence_count > 1) record.product_version = "unknown";
    }
    return state;
  }

  private applyWindowsDacl(target: string, kind: "directory" | "file"): void {
    const command = windowsPrivateDaclCommand(target, kind);
    const result = spawnSync(command.command, command.args, {
      encoding: "utf8", windowsHide: true, timeout: this.windowsAclTimeoutMs, maxBuffer: 16 * 1024, env: command.env,
    });
    if (result.error || result.status !== 0) throw new Error("Windows private DACL の適用/readback に失敗しました");
  }

  private ensurePrivateDirectory(): void {
    const dir = path.dirname(this.storePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (this.platform === "win32") this.applyWindowsDacl(dir, "directory");
    else fs.chmodSync(dir, 0o700);
    this.assertPrivateDirectory(dir);
  }

  private atomicWrite(state: StoreState): void {
    const validated = validateState(state, this.maxRecords);
    if (!validated) throw new Error("書込 state が不正です");
    this.ensurePrivateDirectory();
    const dir = path.dirname(this.storePath);
    const temp = path.join(dir, `.${path.basename(this.storePath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
    let fd: number | null = null;
    try {
      fd = fs.openSync(temp, "wx", 0o600);
      fs.writeFileSync(fd, JSON.stringify(validated) + "\n", "utf8");
      fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
      fs.renameSync(temp, this.storePath);
      if (this.platform === "win32") this.applyWindowsDacl(this.storePath, "file");
      else fs.chmodSync(this.storePath, 0o600);
    } finally {
      if (fd !== null) try { fs.closeSync(fd); } catch { /* noop */ }
      try { fs.unlinkSync(temp); } catch { /* renamed or cleanup */ }
    }
  }

  private readLock(lock: string): { pid: number; start_id: string; token: string } {
    let text: string;
    if (this.platform === "win32") {
      this.applyWindowsDacl(lock, "file");
      text = readBoundedFile(lock, 4096, this.platform, false);
    } else {
      const before = fs.lstatSync(lock);
      // APFS の高競合では readdir snapshot 後、正当に unlink 済みの entry が pre-open
      // lstat で nlink=0 と観測される。これは置換／消滅として caller の既存 skip 経路へ渡す。
      if (before.nlink === 0) throw new LockDisappearedOrReplacedError();
      if (!before.isFile() || before.isSymbolicLink() || before.nlink < 1 || before.nlink > 2
        || before.uid !== process.getuid!() || (before.mode & 0o777) !== 0o600 || before.size > 4096) {
        throw new Error("runtime error store lock が不正です");
      }
      const fd = fs.openSync(lock, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const after = fs.fstatSync(fd);
        if (before.dev !== after.dev || before.ino !== after.ino || after.nlink === 0) throw new LockDisappearedOrReplacedError();
        if (after.nlink < 1 || after.nlink > 2) throw new Error("runtime error store lock が不正です");
        text = fs.readFileSync(fd, "utf8");
      } finally { fs.closeSync(fd); }
    }
    const parsed: unknown = JSON.parse(text);
    if (!isObject(parsed) || !exactKeys(parsed, ["pid", "start_id", "token"])
      || !Number.isInteger(parsed.pid) || Number(parsed.pid) < 1
      || typeof parsed.start_id !== "string" || parsed.start_id.length > 256
      || typeof parsed.token !== "string" || !/^[0-9a-f]{32}$/.test(parsed.token)) throw new Error("runtime error store lock が不正です");
    return { pid: Number(parsed.pid), start_id: parsed.start_id, token: parsed.token };
  }

  private publishOwnerFile(target: string, owner: { pid: number; start_id: string; token: string }): void {
    const queue = path.dirname(target);
    const temporary = `${queue}.publish.${owner.token}.${randomBytes(8).toString("hex")}.tmp`;
    let fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(owner) + "\n", "utf8"); fs.fsyncSync(fd);
      fs.closeSync(fd); fd = -1;
      if (this.platform === "win32") this.applyWindowsDacl(temporary, "file");
      fs.renameSync(temporary, target);
    } finally {
      if (fd >= 0) try { fs.closeSync(fd); } catch { /* noop */ }
      try { fs.unlinkSync(temporary); } catch { /* rename済みまたはcleanup済み */ }
    }
  }

  private withLock<T>(fn: () => T): T {
    this.ensurePrivateDirectory();
    const queue = `${this.storePath}.lock-queue`;
    try { fs.mkdirSync(queue, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    if (this.platform === "win32") this.applyWindowsDacl(queue, "directory");
    else {
      const info = fs.lstatSync(queue);
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid!()
        || (info.mode & 0o777) !== 0o700) throw new Error("runtime error lock queue のowner/modeが不正です");
    }
    const identityTimeoutMs = this.platform === "win32" ? this.windowsAclTimeoutMs : 1000;
    const startId = processStartIdentity(process.pid, this.platform, identityTimeoutMs);
    if (!startId) throw new Error("process start identity を取得できません");
    const owner = { pid: process.pid, start_id: startId, token: randomBytes(16).toString("hex") };
    const ticketPattern = /^(\d{16})-([0-9a-f]{32})\.ticket$/;
    const choosingPattern = /^choosing-([0-9a-f]{32})\.json$/;
    const choosing = path.join(queue, `choosing-${owner.token}.json`);
    let ticket: string | null = null;
    try {
      this.publishOwnerFile(choosing, owner);
      let maximum = 0;
      for (const name of fs.readdirSync(queue)) {
        const match = ticketPattern.exec(name);
        if (!match) {
          if (choosingPattern.test(name)) continue;
          throw new Error("runtime error lock queue に不正なentryがあります");
        }
        maximum = Math.max(maximum, Number(match[1]));
      }
      if (!Number.isSafeInteger(maximum) || maximum >= 9_999_999_999_999_999) {
        throw new Error("runtime error lock ticket が上限に達しました");
      }
      const ticketNumber = maximum + 1;
      const ticketName = `${String(ticketNumber).padStart(16, "0")}-${owner.token}.ticket`;
      ticket = path.join(queue, ticketName);
      this.publishOwnerFile(ticket, owner);
      fs.unlinkSync(choosing);
      // 期限はqueue全体の総待ち時間ではなく、同じ先頭ownerが進まない時間を測る。
      // 正常な前任者がticketを順に解放するたびに予算を更新し、長いqueueをbusyと誤認しない。
      let deadline = Date.now() + 1_500;
      let blockingTicket: string | null = null;
      let choosingBlockers = new Set<string>();
      for (;;) {
        const names = fs.readdirSync(queue).sort();
        let hasLiveChoosing = false;
        const liveChoosing = new Set<string>();
        for (const name of names.filter((candidate) => choosingPattern.test(candidate))) {
          const currentPath = path.join(queue, name);
          let current: { pid: number; start_id: string; token: string };
          try { current = this.readLock(currentPath); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof LockDisappearedOrReplacedError) continue;
            throw error;
          }
          if (name !== `choosing-${current.token}.json`) throw new Error("runtime error choosing entry が不正です");
          // 通常待機ではkill(0)だけを使う。macOSのprocess start identityは外部psを起動するため、
          // 全waiterが全pollで呼ぶとqueue自身が進めなくなる。PID再利用の照合はstall時だけ行う。
          let live = processExists(current.pid);
          if (live && Date.now() >= deadline) {
            const identity = processStartIdentity(current.pid, this.platform, identityTimeoutMs);
            live = identity === current.start_id || (!identity && processExists(current.pid));
          }
          if (live) { hasLiveChoosing = true; liveChoosing.add(name); }
          else {
            try { fs.unlinkSync(currentPath); } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
          }
        }
        if (hasLiveChoosing) {
          if (choosingBlockers.size === 0
            || [...choosingBlockers].some((name) => !liveChoosing.has(name))) {
            deadline = Date.now() + 1_500;
          }
          choosingBlockers = liveChoosing;
          if (Date.now() >= deadline) throw new Error("runtime error store is busy");
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          continue;
        }
        choosingBlockers = new Set();
        let firstLive: string | null = null;
        const ticketNames = fs.readdirSync(queue).sort();
        for (const name of ticketNames.filter((candidate) => ticketPattern.test(candidate))) {
          const currentPath = path.join(queue, name);
          let current: { pid: number; start_id: string; token: string };
          try { current = this.readLock(currentPath); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof LockDisappearedOrReplacedError) continue;
            throw error;
          }
          if (!name.endsWith(`-${current.token}.ticket`)) throw new Error("runtime error lock ticket が不正です");
          let live = processExists(current.pid);
          if (live && name === blockingTicket && Date.now() >= deadline) {
            const identity = processStartIdentity(current.pid, this.platform, identityTimeoutMs);
            live = identity === current.start_id || (!identity && processExists(current.pid));
          }
          if (!live) {
            try { fs.unlinkSync(currentPath); } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
            continue;
          }
          firstLive = name;
          break;
        }
        if (firstLive === ticketName) break;
        if (firstLive !== blockingTicket) {
          blockingTicket = firstLive;
          deadline = Date.now() + 1_500;
        }
        if (Date.now() >= deadline) throw new Error("runtime error store is busy");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
      return fn();
    } finally {
      try { fs.unlinkSync(choosing); } catch { /* publish前failureまたは既にticket化 */ }
      if (ticket) {
        try {
          const current = this.readLock(ticket);
          if (current.token === owner.token && current.pid === owner.pid && current.start_id === owner.start_id) {
            fs.unlinkSync(ticket);
          }
        } catch { /* 自分の固有ticketだけを片付ける */ }
      }
    }
  }

  private compactAcknowledgedResolved(state: StoreState): void {
    if (state.records.length < this.maxRecords) return;
    state.records = state.records.filter((record) => !(record.status === "resolved" && record.sequence <= state.acknowledged_cursor));
  }

  record(value: unknown): boolean {
    const observation = validateRuntimeObservation(value);
    if (this.collectionStatus() !== "enabled") return false;
    return this.withLock(() => {
      const state = this.readState();
      const definition = RUNTIME_ERROR_DEFINITIONS[observation.code];
      const fingerprint = fingerprintFor(observation.code);
      let record = state.records.find((item) => item.fingerprint === fingerprint);
      if (!record) {
        this.compactAcknowledgedResolved(state);
        if (state.records.length >= this.maxRecords) throw new Error("runtime error store capacity reached; unacknowledged records are preserved");
      }
      const seen = this.now().toISOString();
      const sequence = state.cursor + 1;
      if (record) {
        record.product_version = this.productVersion;
        record.occurrence_count += 1; record.last_seen = seen; record.status = "open";
        record.resolved_at = null; record.reason_code = null; record.sequence = sequence;
      } else {
        record = {
          product: "aiterm-mcp", product_version: this.productVersion, component: definition.component,
          error_code: observation.code, message_template: definition.message_template, severity: definition.severity,
          fingerprint, occurrence_count: 1, first_seen: seen, last_seen: seen, state_schema_version: STATE_SCHEMA,
          os: platformName(this.platform), arch: this.arch, status: "open",
          resolved_at: null, reason_code: null, sequence,
        };
        state.records.push(record);
      }
      state.cursor = sequence; this.atomicWrite(state); return true;
    });
  }

  tryRecord(value: unknown): boolean {
    const observation = validateRuntimeObservation(value);
    try { return this.record(observation); }
    catch { this.stderr("aiterm: runtime error store unavailable\n"); return false; }
  }

  snapshot(): RuntimeErrorSnapshot {
    const collection = this.collectionStatus();
    const state = collection === "enabled" ? this.readState() : EMPTY_STATE();
    return {
      collection, schema_version: state.schema_version, cursor: state.cursor,
      acknowledged_cursor: state.acknowledged_cursor,
      records: state.records.map((record) => projectRecord(record as unknown as Record<string, unknown>)),
    };
  }

  private changeStatus(fingerprint: string, status: RuntimeStatus): boolean {
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error("fingerprint が不正です");
    if (this.collectionStatus() !== "enabled") return false;
    return this.withLock(() => {
      const state = this.readState(); const record = state.records.find((item) => item.fingerprint === fingerprint);
      if (!record) return false; if (record.status === status) return true;
      state.cursor += 1; record.status = status;
      record.resolved_at = status === "resolved" ? this.now().toISOString() : null;
      record.reason_code = status === "resolved" ? "operator_resolved" : null;
      record.sequence = state.cursor; this.atomicWrite(state); return true;
    });
  }
  resolve(fingerprint: string): boolean { return this.changeStatus(fingerprint, "resolved"); }
  reopen(fingerprint: string): boolean { return this.changeStatus(fingerprint, "open"); }

  acknowledge(cursor: number): RuntimeErrorSnapshot {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("ack cursor が不正です");
    if (this.collectionStatus() !== "enabled") return this.snapshot();
    this.withLock(() => {
      const state = this.readState();
      if (cursor < state.acknowledged_cursor) throw new Error("ack cursor must be monotonic");
      if (cursor > state.cursor) throw new Error("ack cursor is ahead of current cursor");
      state.acknowledged_cursor = cursor; this.atomicWrite(state);
    });
    return this.snapshot();
  }

  diagnostic(): RuntimeErrorDiagnostic {
    const collection = this.collectionStatus();
    if (collection === "disabled") return { status: "not_applicable", collection, record_count: 0, unacknowledged_count: 0 };
    if (collection === "malformed") return { status: "unverified", collection, record_count: null, unacknowledged_count: null };
    try {
      const state = this.readState();
      return { status: "ready", collection, record_count: state.records.length,
        unacknowledged_count: state.records.filter((record) => record.sequence > state.acknowledged_cursor).length };
    } catch { return { status: "unverified", collection, record_count: null, unacknowledged_count: null }; }
  }
}

const WORKER = fileURLToPath(new URL("./runtime-error-worker.js", import.meta.url));
function fixedStoreFailure(stderr: (line: string) => void): void { stderr("aiterm: runtime error store unavailable\n"); }
function defaultWorkerTimeoutMs(action: "record" | "diagnostic"): number {
  if (process.platform !== "win32") return POSIX_WORKER_TIMEOUT_MS;
  return action === "record" ? WINDOWS_RECORD_WORKER_TIMEOUT_MS : WINDOWS_DIAGNOSTIC_WORKER_TIMEOUT_MS;
}

export function recordRuntimeError(code: RuntimeErrorCode, options: {
  workerPath?: string; timeoutMs?: number; stderr?: (line: string) => void;
} = {}): boolean {
  validateRuntimeObservation({ code });
  const stderr = options.stderr ?? ((line) => process.stderr.write(line));
  let reported = false;
  const report = () => { if (!reported) { reported = true; fixedStoreFailure(stderr); } };
  try {
    const child = spawn(process.execPath, [options.workerPath ?? WORKER, "record", code], {
      stdio: "ignore", windowsHide: true, env: process.env,
    });
    const timer = setTimeout(() => { report(); forceKill(child); }, options.timeoutMs ?? defaultWorkerTimeoutMs("record"));
    timer.unref();
    child.once("error", report);
    child.once("exit", (exitCode, signal) => { clearTimeout(timer); if (exitCode !== 0 || signal) report(); });
    child.unref();
    return true;
  } catch { report(); return false; }
}

function validDiagnostic(value: unknown): value is RuntimeErrorDiagnostic {
  if (!isObject(value) || !exactKeys(value, DIAGNOSTIC_KEYS)) return false;
  return ["ready", "not_applicable", "unverified"].includes(String(value.status))
    && ["enabled", "disabled", "malformed"].includes(String(value.collection))
    && [value.record_count, value.unacknowledged_count].every((item) => item === null || (Number.isInteger(item) && Number(item) >= 0));
}

export async function runtimeErrorStoreDiagnostic(options: { workerPath?: string; timeoutMs?: number } = {}): Promise<RuntimeErrorDiagnostic> {
  const fallback: RuntimeErrorDiagnostic = { status: "unverified", collection: "malformed", record_count: null, unacknowledged_count: null };
  return await new Promise((resolve) => {
    let settled = false; let stdout = "";
    const finish = (value: RuntimeErrorDiagnostic) => { if (!settled) { settled = true; resolve(value); } };
    let child;
    try {
      child = spawn(process.execPath, [options.workerPath ?? WORKER, "diagnostic"], {
        stdio: ["ignore", "pipe", "ignore"], windowsHide: true, env: process.env,
      });
    } catch { finish(fallback); return; }
    const timer = setTimeout(() => { forceKill(child); finish(fallback); }, options.timeoutMs ?? defaultWorkerTimeoutMs("diagnostic"));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { if (stdout.length <= 4096) stdout += chunk; });
    child.once("error", () => { clearTimeout(timer); finish(fallback); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || stdout.length > 4096) { finish(fallback); return; }
      try { const parsed: unknown = JSON.parse(stdout); finish(validDiagnostic(parsed) ? parsed : fallback); }
      catch { finish(fallback); }
    });
  });
}

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
