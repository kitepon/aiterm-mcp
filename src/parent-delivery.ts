// Aitermが所有する、子の完了観測・回答本文の保存・親への配送。
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { readAgentTranscriptResult } from "./core.js";
import { ensureStateRoot, writeJson0600, type AgentTurnBoundary, type AgentWaitObservation } from "./agent-shared.js";
import { readProcessIdentities } from "./process-runtime.js";
import { deliveryOwnerPrefix } from "./parent-delivery-owners.js";
import { CodexDeliveryError, submitCodexParentAnswer, verifyCodexParent, type CodexParent } from "./codex-parent-receiver.js";
import { claudeParentSchema, ClaudeDeliveryError, bindClaudeParentDelivery, submitClaudeParentAnswer, verifyClaudeParent, type ClaudeParent } from "./claude-parent-receiver.js";
import { cursorParentSchema, CursorDeliveryError, prepareCursorDelivery, submitCursorParentAnswer, verifyCursorParent, type CursorParent } from "./cursor-parent-receiver.js";
import { cursorReceiveProcess } from "./cursor-parent-receive.js";
import { AitermError } from "./errors.js";
import { codexHookDeliveryState } from "./codex-hook-state.js";
import { answerAnywhere, observeAnywhere, remoteKey, remoteTargetSchema, type RemoteTarget } from "./remote.js";

const recordSchema = z.object({
  schema: z.literal("aiterm.parent-delivery.v1"),
  delivery_id: z.uuid(),
  created_at: z.string(),
  updated_at: z.string(),
  parent: z.union([z.object({ thread_id: z.uuid(), codex_home: z.string() }).strict(), claudeParentSchema, cursorParentSchema]),
  boundary: z.object({
    session_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    launch_id: z.string().regex(/^[0-9a-f]{32}$/),
    vendor: z.enum(["claude", "codex", "grok", "cursor"]),
    harness: z.enum(["claude-code", "codex-cli", "grok-cli", "cursor-cli"]),
    event_cursor: z.number().int().nonnegative(), operation_id: z.string().nullable(),
    // 別端末の子。remote用の保存場所にだけ書き、旧版のreaderへ渡さない。
    remote: remoteTargetSchema.optional(),
  }).strict(),
  state: z.enum(["waiting", "ready", "sending", "submitted", "failed", "unknown"]),
  text: z.string().nullable(),
  child_outcome: z.enum(["done", "closed", "rate_limited", "error"]).nullable(),
  child_turn_id: z.string().nullable(),
  error: z.string().nullable(),
  queued_submission_id: z.string().nullable(),
}).strict();

type DeliveryRecord = z.infer<typeof recordSchema>;
export type DeliveryBoundary = AgentTurnBoundary & { remote?: RemoteTarget };

/** 子の予約と連続依頼の単位。別端末の子は接続先ごとに分け、この端末の同名sessionと衝突させない。 */
export function deliveryKey(sessionId: string, remote?: RemoteTarget): string {
  return remote ? `remote-${remoteKey(remote)}-${sessionId}` : sessionId;
}
const boundaryKey = (boundary: DeliveryRecord["boundary"]) => deliveryKey(boundary.session_id, boundary.remote);
export type ParentDeliveryReceipt = Pick<DeliveryRecord, "delivery_id" | "state" | "child_outcome" | "child_turn_id" | "queued_submission_id"> & { error_code: string | null };
type OwnedRecord = { record: DeliveryRecord; file: string; controller: AbortController; capture?: Promise<void>; task?: Promise<void>; delivery?: Promise<void> };
type Owner = {
  pid: number; started_identity: string; closed: boolean;
  // 他の持ち主の保存場所が消えても読める版の印。この印の無い生きた持ち主が居る間は、保存場所を消さない。
  removal_safe?: boolean;
  // 回収側が閉じた時の理由。持ち主が自分で閉じた時は付かない。
  closed_reason?: "pid_reused" | "process_gone";
};
// 回収の時点で見た、closeしていない持ち主の状態。
// gone: pidが無い。reused: pidは別のprocess。vanished: pidは居ると出るが、OSのprocess表に無い。
// unverified: process表にはあるが、開始時刻を読めない。
type OwnerFate = "alive" | "gone" | "reused" | "vanished" | "unverified";
type Parent = CodexParent | ClaudeParent | CursorParent;
const isClaude = (parent: Parent): parent is ClaudeParent => "kind" in parent && parent.kind === "claude";
const isCursor = (parent: Parent): parent is CursorParent => "kind" in parent && parent.kind === "cursor";
const isCodex = (parent: Parent): parent is CodexParent => !isClaude(parent) && !isCursor(parent);

async function verifyParent(parent: Parent): Promise<void> {
  if (isClaude(parent)) verifyClaudeParent(parent);
  else if (isCursor(parent)) verifyCursorParent(parent);
  else await verifyCodexParent(parent);
}

async function submitParentAnswer(parent: Parent, deliveryId: string, text: string): Promise<{ queued_submission_id: string | null }> {
  if (isClaude(parent)) return submitClaudeParentAnswer(parent, deliveryId, text);
  if (isCursor(parent)) return submitCursorParentAnswer(parent, deliveryId, text);
  return submitCodexParentAnswer(parent, deliveryId, text);
}

export interface ParentDeliveryDependencies {
  observe: typeof observeAnywhere;
  answer: (session: string, options: Parameters<typeof readAgentTranscriptResult>[1] & { remote?: RemoteTarget }) => Promise<{ text: string }>;
  submit: typeof submitParentAnswer;
  verify: typeof verifyParent;
  // 指定したpidのうち、今あるprocessの開始時刻を返す。全processの一覧は取らない。開始時刻を読めないprocessはnull。
  processes: (pids: number[]) => { pid: number; started_identity: string | null }[];
  // そのpidのprocessが今あるか。OSへ直接聞き、processを起動しない。
  exists: (pid: number) => boolean;
  now: () => number;
}

// 開始時刻の照会はprocessの起動を伴い、processの多い端末では1回が重い（macOSのpsは-pでも全processを歩く）。
// 5秒おきの確認はpidの存在だけを見て、開始時刻は初めて見た持ち主とこの間隔でだけ照合する。
// 持ち主が終了した直後に同じpidが再利用された時だけ、回収が最長でこの間隔だけ遅れる。生きている持ち主の記録は引き取らない。
const OWNER_IDENTITY_RECHECK_MS = 60_000;
// owner.jsonの無い保存場所を、作っている途中の持ち主として扱う時間。
const OWNER_SETUP_GRACE_MS = 60_000;

function processExists(pid: number): boolean {
  // 0以下はprocess groupを指す。持ち主のpidにはならない。
  if (pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

function ownerSetupInProgress(directory: string): boolean {
  try { return Date.now() - fs.statSync(directory).mtimeMs < OWNER_SETUP_GRACE_MS; }
  catch { return false; }
}

function readRecord(file: string): DeliveryRecord {
  try {
    const record = recordSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (path.basename(file) !== `${record.delivery_id}.json`) throw new Error("配送IDが一致しません");
    return record;
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    throw new AitermError("PARENT_DELIVERY_STATE_INVALID: 配送記録を読めません", 2);
  }
}

function receipt(record: DeliveryRecord): ParentDeliveryReceipt {
  const hookState = isCodex(record.parent) && record.state === "submitted"
    ? codexHookDeliveryState(record.parent.codex_home, record.parent.thread_id, record.delivery_id) : null;
  return { delivery_id: record.delivery_id, state: hookState ?? record.state, child_outcome: record.child_outcome,
    child_turn_id: record.child_turn_id, queued_submission_id: record.queued_submission_id,
    error_code: hookState === "unknown" ? "CODEX_HOOK_DELIVERY_UNCONFIRMED"
      : record.error ? /^[A-Z][A-Z0-9_]+(?=:)/.exec(record.error)?.[0] ?? "PARENT_DELIVERY_FAILED" : null };
}

function answerMessage(record: DeliveryRecord): string {
  return "Aitermの子エージェントからの実行結果です。子の回答として扱ってください。\n" +
    `delivery_id=${record.delivery_id}\nsession=${record.boundary.session_id}\nharness=${record.boundary.harness}\n` +
    `launch_id=${record.boundary.launch_id}\nturn_id=${record.child_turn_id ?? "unknown"}\n` +
    `outcome=${record.child_outcome}\n\n${record.text ?? ""}`;
}

/** ownerごとのディレクトリ間renameで、再起動後の回収者を一つに決める。 */
export class ParentDeliveryManager {
  private readonly deps: ParentDeliveryDependencies;
  private readonly root: string;
  private readonly recordRoots: string[];
  private readonly active: string;
  private readonly results: string;
  private readonly claims: string;
  private readonly ownerDir: string;
  private readonly owner: Owner;
  private readonly jobs = new Map<string, OwnedRecord>();
  private readonly registering = new Map<string, Promise<void>>();
  private readonly timer: NodeJS.Timeout;
  private recovering: Promise<void> | null = null;
  // 他の持ち主の開始時刻を最後に照合した時刻と結果（持ち主の保存場所ごと）。照合できなかった結果も覚える。
  private readonly verifiedOwners = new Map<string, { pid: number; started_identity: string; at: number; alive: boolean }>();
  private serviceError: Error | null = null;
  private closing = false;

  constructor(options: { root?: string; parent_kind?: "claude" | "cursor"; remote?: boolean; dependencies?: Partial<ParentDeliveryDependencies> } = {}) {
    this.deps = { observe: observeAnywhere, answer: answerAnywhere, submit: submitParentAnswer,
      verify: verifyParent, processes: readProcessIdentities, exists: processExists,
      now: () => performance.now(), ...options.dependencies };
    const stateRoot = ensureStateRoot();
    // 別端末の子の記録はremote-で始まる保存場所へ分け、boundary.remoteを知らない旧版のreaderへ渡さない。
    const prefix = options.remote ? "remote-" : "";
    const directory = options.parent_kind === "claude" ? "claude-parent-deliveries"
      : options.parent_kind === "cursor" ? "cursor-parent-deliveries" : "parent-deliveries";
    this.root = options.root ?? path.join(stateRoot, prefix + directory);
    // 旧版のCodex／Claude readerへ未知のparentを渡さない。公開照会と子の予約だけは保存場所を横断する。
    this.recordRoots = options.root ? [options.root] : [
      path.join(stateRoot, prefix + "parent-deliveries"),
      path.join(stateRoot, prefix + "claude-parent-deliveries"),
      path.join(stateRoot, prefix + "cursor-parent-deliveries"),
    ];
    this.active = path.join(this.root, "active");
    this.results = path.join(this.root, "results");
    this.claims = path.join(options.root ?? path.join(stateRoot, prefix + "parent-deliveries"), "claims");
    const ownProcess = this.deps.processes([process.pid]).find((entry) => entry.pid === process.pid);
    if (!ownProcess || ownProcess.started_identity === null) throw new AitermError("PARENT_DELIVERY_OWNER_UNKNOWN: 配送processを識別できません", 2);
    this.owner = { pid: process.pid, started_identity: ownProcess.started_identity, closed: false, removal_safe: true };
    this.ownerDir = path.join(this.active, `${deliveryOwnerPrefix(this.owner)}${randomUUID()}`);
    fs.mkdirSync(this.ownerDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.results, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.claims, { recursive: true, mode: 0o700 });
    writeJson0600(path.join(this.ownerDir, "owner.json"), this.owner);
    // MCPの再接続と旧process終了の順序が前後しても、終了したownerの記録を回収する。
    this.timer = setInterval(() => { void this.recover().catch((error) => this.reportServiceError(error)); }, 5_000);
    this.timer.unref();
    void this.recover().catch((error) => this.reportServiceError(error));
  }

  private reportServiceError(error: unknown): void {
    this.serviceError = error instanceof Error ? error : new Error(String(error));
    process.stderr.write("aiterm: PARENT_DELIVERY_STATE_UNAVAILABLE（配送状態を確認してください）\n");
  }

  async prepare(parent: Parent): Promise<void> {
    if (this.closing) throw new AitermError("PARENT_DELIVERY_CLOSED: MCP接続を終了しています", 2);
    if (this.serviceError) throw this.serviceError;
    await this.recover();
    await this.deps.verify(parent);
  }

  request(parent: Parent): {
    before_send: (boundary: DeliveryBoundary) => Promise<void>;
    result: () => ParentDeliveryReceipt | null;
    failed: (error: unknown) => void;
    wait_process: () => ReturnType<typeof cursorReceiveProcess> | null;
  } {
    let job: OwnedRecord | null = null;
    return {
      before_send: async (boundary) => {
        const key = deliveryKey(boundary.session_id, boundary.remote);
        const previous = this.registering.get(key) ?? Promise.resolve();
        const registration = previous.then(async () => {
          await this.beforeChange(key, true);
          const now = new Date().toISOString();
          const record: DeliveryRecord = { schema: "aiterm.parent-delivery.v1", delivery_id: randomUUID(),
            created_at: now, updated_at: now, parent, boundary, state: "waiting", text: null,
            child_outcome: null, child_turn_id: null, error: null, queued_submission_id: null };
          job = { record, file: path.join(this.ownerDir, `${record.delivery_id}.json`), controller: new AbortController() };
          this.save(job);
          // 記録を調べてから作るだけでは、別processが同時に同じ子を予約できる。
          // 同一filesystemのhard link作成で、回答をまだ保存していない依頼を一つに決める。
          try { fs.linkSync(job.file, path.join(this.claims, `${key}.json`)); }
          catch (error) {
            fs.unlinkSync(job.file);
            job = null;
            if ((error as NodeJS.ErrnoException).code === "EEXIST") {
              throw new AitermError("PARENT_RESULT_PENDING: 同じ子の回答保存を別の依頼が所有しています", 2);
            }
            throw error;
          }
          if (isClaude(parent)) bindClaudeParentDelivery(parent, record.delivery_id);
          if (isCursor(parent)) {
            try { prepareCursorDelivery(parent, record.delivery_id); }
            catch (error) {
              this.releaseClaim(job);
              fs.unlinkSync(job.file);
              job = null;
              throw error;
            }
          }
          this.jobs.set(record.delivery_id, job);
          this.watch(job);
        });
        this.registering.set(key, registration);
        try { await registration; }
        finally { if (this.registering.get(key) === registration) this.registering.delete(key); }
      },
      result: () => job ? receipt(job.record) : null,
      wait_process: () => job && isCursor(parent) ? cursorReceiveProcess(job.record.delivery_id) : null,
      failed: (error) => {
        if (!job || job.record.state !== "waiting") return;
        job.controller.abort();
        job.record.state = "unknown";
        job.record.error = `AGENT_DISPATCH_UNCONFIRMED: ${error instanceof Error ? error.message : String(error)}`;
        this.finish(job);
      },
    };
  }

  private save(job: OwnedRecord): void {
    job.record.updated_at = new Date().toISOString();
    writeJson0600(job.file, job.record);
  }

  private finish(job: OwnedRecord): void {
    this.releaseClaim(job);
    this.save(job);
    const destination = path.join(this.results, `${job.record.delivery_id}.json`);
    if (job.file !== destination) { fs.renameSync(job.file, destination); job.file = destination; }
    this.jobs.delete(job.record.delivery_id);
  }

  private releaseClaim(job: OwnedRecord): void {
    const file = path.join(this.claims, `${boundaryKey(job.record.boundary)}.json`);
    try {
      const claim = JSON.parse(fs.readFileSync(file, "utf8"));
      // 回収済みrecordを復旧している間に始まった、次の依頼の予約は触らない。
      if (claim.delivery_id === job.record.delivery_id) fs.unlinkSync(file);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }

  private watch(job: OwnedRecord): void {
    const boundary = job.record.boundary;
    job.task = (async () => {
      try {
        const completion = await this.deps.observe(boundary.session_id, {
          cursor: boundary.event_cursor, operation_id: boundary.operation_id,
          timeout: Infinity, signal: job.controller.signal, ...(boundary.remote ? { remote: boundary.remote } : {}),
        });
        await this.capture(job, completion);
      } catch (error) {
        if (job.controller.signal.aborted) return;
        await this.captureFailure(job, error);
      }
    })().catch((error) => this.reportServiceError(error));
  }

  private async capture(job: OwnedRecord, completion: AgentWaitObservation): Promise<void> {
    if (job.capture) return job.capture;
    if (job.record.state !== "waiting") return;
    job.capture = (async () => {
      if (completion.launch_id !== job.record.boundary.launch_id) throw new AitermError("PARENT_DELIVERY_LAUNCH_CHANGED: 子のlaunchが置換されました", 2);
      if (completion.outcome === "running" || completion.outcome === "timeout") throw new AitermError("PARENT_DELIVERY_NOT_COMPLETED: 子の完了を確認できません", 2);
      const record = job.record;
      record.child_outcome = completion.outcome;
      record.child_turn_id = completion.turn_id;
      if (completion.outcome === "done") {
        const answer = await this.deps.answer(record.boundary.session_id, { completion, operation_id: completion.operation_id, raw: true,
          ...(record.boundary.remote ? { remote: record.boundary.remote } : {}) });
        if (record.state !== "waiting") return;
        // 回答を空で終えたturnも完了として届ける。親が完了を知る手段はこの配送だけなので、本文の代わりに知らせを入れる。
        record.text = answer.text.trim() ? answer.text : "子のターンは完了しましたが、回答の本文は空でした。";
      } else {
        record.text = completion.error ?? completion.rate_limit ?? "子のセッションが閉じられたため、回答はありません。";
      }
      record.state = "ready";
      this.save(job);
      // 次の依頼へ進める時点は本文保存まで。親の受付を待たせない。
      job.delivery = this.deliver(job).catch((error) => this.reportServiceError(error));
    })();
    return job.capture;
  }

  private async captureFailure(job: OwnedRecord, error: unknown): Promise<void> {
    if (job.record.state !== "waiting") throw error;
    job.record.child_outcome = "error";
    job.record.error = `AGENT_RESULT_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`;
    job.record.text = job.record.error;
    job.record.state = "ready";
    this.save(job);
    await this.deliver(job);
  }

  private async deliver(job: OwnedRecord): Promise<void> {
    this.releaseClaim(job);
    job.record.state = "sending";
    this.save(job);
    try {
      const result = await this.deps.submit(job.record.parent, job.record.delivery_id, answerMessage(job.record));
      job.record.queued_submission_id = result.queued_submission_id;
      job.record.state = "submitted";
    } catch (error) {
      const known = error instanceof CodexDeliveryError || error instanceof ClaudeDeliveryError || error instanceof CursorDeliveryError;
      job.record.state = known && !error.outcome_unknown ? "failed" : "unknown";
      job.record.error = error instanceof Error ? error.message : String(error);
    }
    this.finish(job);
  }

  /** 次の入力・closeより先に、既に完了した前の本文を確保する。keyは`deliveryKey`（この端末の子はsession名）。 */
  async beforeChange(key: string, requireCaptured = false): Promise<void> {
    for (const job of this.jobs.values()) {
      if (boundaryKey(job.record.boundary) !== key || job.record.state !== "waiting") continue;
      const boundary = job.record.boundary;
      const completion = await this.deps.observe(boundary.session_id, { cursor: boundary.event_cursor, operation_id: boundary.operation_id, timeout: 0,
        ...(boundary.remote ? { remote: boundary.remote } : {}) });
      if (completion.outcome !== "running" && completion.outcome !== "timeout") {
        await this.capture(job, completion);
      }
      if (requireCaptured && job.record.state === "waiting") {
        throw new AitermError("PARENT_RESULT_PENDING: 前の依頼の完了と回答保存が済んでいません", 2);
      }
    }
    // 別のMCP processが同じ子の回答を保存中なら、入力で記録を上書きしない。
    if (requireCaptured && this.records().some((record) => boundaryKey(record.boundary) === key && record.state === "waiting")) {
      throw new AitermError("PARENT_RESULT_PENDING: 別の依頼の回答保存が済んでいません", 2);
    }
  }

  private files(): string[] {
    const files: string[] = [];
    for (const root of this.recordRoots) {
      const results = path.join(root, "results");
      if (fs.existsSync(results)) files.push(...fs.readdirSync(results).filter((name) => name.endsWith(".json")).map((name) => path.join(results, name)));
      const active = path.join(root, "active");
      if (!fs.existsSync(active)) continue;
      for (const owner of fs.readdirSync(active, { withFileTypes: true })) {
        if (!owner.isDirectory()) continue;
        const directory = path.join(active, owner.name);
        let names: string[];
        // 一覧を取った後に、回収が終了した持ち主の保存場所を消す事がある。
        try { names = fs.readdirSync(directory); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        files.push(...names.filter((name) => name !== "owner.json" && name.endsWith(".json")).map((name) => path.join(directory, name)));
      }
    }
    return files;
  }

  private records(): DeliveryRecord[] {
    const records: DeliveryRecord[] = [];
    for (const file of this.files()) {
      try { records.push(readRecord(file)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return records;
  }

  status(key: string): ParentDeliveryReceipt[] {
    if (this.serviceError) throw this.serviceError;
    return this.records().filter((record) => boundaryKey(record.boundary) === key)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)).map(receipt);
  }

  recover(): Promise<void> {
    if (this.recovering) return this.recovering;
    if (this.closing) return Promise.resolve();
    this.recovering = this.recoverOrphans().finally(() => { this.recovering = null; });
    return this.recovering;
  }

  private async recoverOrphans(): Promise<void> {
    // 生存を確かめる相手は、closeしていない他の持ち主だけ。居なければOSへ問い合わせない。
    // この処理は5秒おきに全MCP processで回る。全processの一覧を取ると、processの多い端末で負荷になる。
    const directories = fs.readdirSync(this.active, { withFileTypes: true })
      .filter((directory) => directory.isDirectory() && path.join(this.active, directory.name) !== this.ownerDir);
    const now = this.deps.now();
    const fate = new Map<string, OwnerFate>();
    const unverified: { name: string; pid: number; started_identity: string }[] = [];
    for (const directory of directories) {
      let owner: Partial<Owner>;
      try { owner = JSON.parse(fs.readFileSync(path.join(this.active, directory.name, "owner.json"), "utf8")); }
      catch { continue; /* 形式の検査と失敗の扱いは下の回収で行う */ }
      if (owner?.closed !== false || !Number.isSafeInteger(owner.pid) || typeof owner.started_identity !== "string") continue;
      const pid = owner.pid as number;
      if (!this.deps.exists(pid)) { fate.set(directory.name, "gone"); continue; }
      const verified = this.verifiedOwners.get(directory.name);
      if (verified && verified.pid === pid && verified.started_identity === owner.started_identity
        && now - verified.at < OWNER_IDENTITY_RECHECK_MS) fate.set(directory.name, verified.alive ? "alive" : "unverified");
      else unverified.push({ name: directory.name, pid, started_identity: owner.started_identity });
    }
    if (unverified.length > 0) {
      const processes = this.deps.processes([...new Set(unverified.map((entry) => entry.pid))]);
      for (const entry of unverified) {
        const row = processes.find((candidate) => candidate.pid === entry.pid);
        // pidは居ると出たのにprocess表に無いのは、照会の直前に終了したか、終了したprocessの名残
        // （Windowsでは、誰かがhandleを握っている間、終了したprocessのpidが空かず、権限の低いprocessからは「居るが開けない」と見える）。
        const state: OwnerFate = !row ? "vanished" : row.started_identity === null ? "unverified"
          : row.started_identity === entry.started_identity ? "alive" : "reused";
        fate.set(entry.name, state);
        // 終了と分かった持ち主は下で閉じるので、照合の結果を覚えない。
        if (state === "alive" || state === "unverified") {
          this.verifiedOwners.set(entry.name, { pid: entry.pid, started_identity: entry.started_identity, at: now, alive: state === "alive" });
        }
      }
    }
    for (const name of this.verifiedOwners.keys()) {
      const state = fate.get(name);
      if (state !== "alive" && state !== "unverified") this.verifiedOwners.delete(name);
    }
    // 記録を引き取り終えた、終了した持ち主の保存場所。残すと、回収のたびに全部を読み直す。
    const finished: string[] = [];
    // pidが無いと分かった、closeしていない持ち主。保存場所を消せない回は、閉じた事だけを書く。
    const goneOwners: { file: string; owner: Owner }[] = [];
    // owner.jsonの無い、古い保存場所。
    const abandoned: string[] = [];
    // 旧版は、読んでいる最中に他の持ち主の保存場所が消えると回収が止まる。印の無い持ち主が生きている間は消さない。
    let removalBlocked = false;
    for (const directory of directories) {
      const oldDir = path.join(this.active, directory.name);
      const ownerFile = path.join(oldDir, "owner.json");
      let owner: Owner;
      try { owner = JSON.parse(fs.readFileSync(ownerFile, "utf8")); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new AitermError("PARENT_DELIVERY_OWNER_INVALID: 配送所有者の記録を読めません", 2);
        // 作っている途中の持ち主は版が分からない。
        if (ownerSetupInProgress(oldDir)) removalBlocked = true;
        else abandoned.push(oldDir);
        continue;
      }
      if (!Number.isSafeInteger(owner.pid) || typeof owner.started_identity !== "string" || typeof owner.closed !== "boolean") {
        throw new AitermError("PARENT_DELIVERY_OWNER_INVALID: 配送所有者の形式が不正です", 2);
      }
      const state = fate.get(directory.name);
      // 生死を確かめた後に現れた持ち主は、次の回で扱う。生きている持ち主の記録は引き取らない。
      if (!owner.closed && (state === undefined || state === "alive")) {
        if (owner.removal_safe !== true) removalBlocked = true;
        continue;
      }
      if (!owner.closed && state === "unverified" && owner.removal_safe !== true) removalBlocked = true;
      let names: string[];
      try { names = fs.readdirSync(oldDir); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      for (const name of names.filter((name) => name !== "owner.json" && name.endsWith(".json"))) {
        const oldFile = path.join(oldDir, name);
        const file = path.join(this.ownerDir, name);
        // 元のpathが消えるrenameを使うため、同じ旧recordを二つのprocessで回収できない。
        try { fs.renameSync(oldFile, file); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        const record = readRecord(file);
        const job: OwnedRecord = { record, file, controller: new AbortController() };
        this.jobs.set(record.delivery_id, job);
        if (record.state === "sending") {
          record.state = "unknown";
          record.error = "PARENT_DELIVERY_INTERRUPTED: 回答送信中にMCP processが終了しました。自動再送はしていません";
          this.finish(job);
        } else if (record.state === "waiting" || record.state === "ready") {
          try {
            if (record.state === "waiting") this.watch(job);
            else {
              await this.deps.verify(record.parent);
              job.delivery = this.deliver(job).catch((error) => this.reportServiceError(error));
            }
          } catch (error) {
            record.state = "failed";
            record.error = error instanceof Error ? error.message : String(error);
            this.finish(job);
          }
        } else this.finish(job);
      }
      if (!owner.closed && (state === "reused" || state === "vanished")) {
        // 同じpidと開始時刻の組は二度と現れない。閉じた事にして、どの版の回収にも照合を繰り返させない。
        // 書けなかった時は次の回でもう一度照合する。配送には影響しない。
        const reason = state === "reused" ? "pid_reused" : "process_gone";
        try { writeJson0600(ownerFile, { ...owner, closed: true, closed_reason: reason } satisfies Owner); }
        catch { /* 次の回 */ }
        continue;
      }
      // 持ち主が自分で閉じた保存場所と、pidがもう無い持ち主の保存場所だけを消す。
      // 回収側が閉じた保存場所は、そのpidが空くまで残す。
      const ended = owner.closed ? owner.closed_reason === undefined || !this.deps.exists(owner.pid) : state === "gone";
      if (ended) finished.push(oldDir);
      if (!owner.closed && state === "gone") goneOwners.push({ file: ownerFile, owner });
    }
    if (removalBlocked) {
      // 消せない間も、終了した持ち主は閉じておく。pidの有無は見る側の権限で変わる事があり（ADR 0086）、
      // 閉じていない持ち主は、前の版の回収が照会の相手にし続ける。
      for (const { file, owner } of goneOwners) {
        try { writeJson0600(file, { ...owner, closed: true, closed_reason: "process_gone" } satisfies Owner); }
        catch { /* 次の回 */ }
      }
      return;
    }
    // 片付けの失敗は配送に影響しない。残った保存場所は次の回でもう一度消す。
    for (const directory of finished) {
      try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* 次の回 */ }
    }
    for (const directory of abandoned) {
      try { fs.rmdirSync(directory); } catch { /* 空でない、または既に無い */ }
    }
  }

  async close(): Promise<void> {
    // 閉じた後の保存場所は、記録を引き取った他の持ち主が消す。二度目のcloseは何も書かない。
    if (this.owner.closed) return;
    this.closing = true;
    clearInterval(this.timer);
    await this.recovering;
    await Promise.allSettled(this.registering.values());
    const jobs = [...this.jobs.values()];
    for (const job of jobs) if (job.record.state === "waiting") job.controller.abort();
    await Promise.all(jobs.map((job) => job.task));
    await Promise.all(jobs.map((job) => job.delivery));
    this.owner.closed = true;
    writeJson0600(path.join(this.ownerDir, "owner.json"), this.owner);
  }
}
