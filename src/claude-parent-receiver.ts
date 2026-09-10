// Claude Codeの公式hookを受信口にする。待機processはharnessが所有し、親のturnを止めない。
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { ensureStateRoot, writeJson0600 } from "./agent-shared.js";
import { readRuntimeProcesses } from "./process-runtime.js";
import { AitermError } from "./errors.js";

const requestId = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const invocationSchema = z.object({
  request_id: requestId, session_id: z.uuid(), agent_id: z.string().nullable(),
  parent_pid: z.number().int().positive(), parent_started_identity: z.string(),
}).strict();
type Invocation = z.infer<typeof invocationSchema>;

export const claudeParentSchema = z.object({
  kind: z.literal("claude"), request_id: requestId, session_id: z.uuid(), hook_root: z.string(),
}).strict();
export type ClaudeParent = z.infer<typeof claudeParentSchema>;

export class ClaudeDeliveryError extends AitermError {
  constructor(readonly delivery_code: string, message: string, readonly outcome_unknown = false) {
    super(`${delivery_code}: ${message}`, 2);
  }
}

function defaultRoot(): string { return path.join(ensureStateRoot(), "claude-parent-hooks"); }
function processIdentity(pid: number): string | undefined { return readRuntimeProcesses().find(entry => entry.pid === pid)?.started_identity; }
function directory(parent: ClaudeParent): string { return path.join(parent.hook_root, parent.request_id); }
function readInvocation(parent: ClaudeParent): Invocation {
  let value: Invocation;
  try { value = invocationSchema.parse(JSON.parse(fs.readFileSync(path.join(directory(parent), "request.json"), "utf8"))); }
  catch { throw new ClaudeDeliveryError("CLAUDE_PARENT_HOOK_UNAVAILABLE", "親のhook記録がありません。aiterm-setupを実行し、Claude Codeのhookを有効にしてください"); }
  if (value.request_id !== parent.request_id || value.session_id !== parent.session_id) {
    throw new ClaudeDeliveryError("CLAUDE_PARENT_SESSION_MISMATCH", "要求とhookの会話が一致しません");
  }
  return value;
}

function assertOpen(parent: ClaudeParent): void {
  if (fs.existsSync(path.join(directory(parent), "closed.json"))) {
    throw new ClaudeDeliveryError("CLAUDE_PARENT_SESSION_CLOSED", "依頼元の会話は終了しました。回答を別の会話へ送っていません");
  }
}

export function prepareClaudeHookRequest(input: unknown, root = defaultRoot()): void {
  const event = z.object({ session_id: z.uuid(), tool_use_id: requestId, agent_id: z.string().optional() }).parse(input);
  const identity = processIdentity(process.ppid);
  if (!identity) throw new ClaudeDeliveryError("CLAUDE_PARENT_PROCESS_UNAVAILABLE", "hookを起動した親processを確認できません");
  const dir = path.join(root, event.tool_use_id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeJson0600(path.join(dir, "request.json"), {
    request_id: event.tool_use_id, session_id: event.session_id, agent_id: event.agent_id ?? null,
    parent_pid: process.ppid, parent_started_identity: identity,
  } satisfies Invocation);
}

/** 起動時envのsession IDは/clearで古くなるため、実際のPreToolUseとの相関だけを使う。 */
export function claudeParentFromRequest(clientName: string | undefined, metadata: unknown, root = defaultRoot()): ClaudeParent | null {
  if (clientName !== "claude-code") return null;
  const parsed = requestId.safeParse((metadata as Record<string, unknown> | undefined)?.["claudecode/toolUseId"]);
  if (!parsed.success) throw new ClaudeDeliveryError("CLAUDE_PARENT_ID_UNAVAILABLE", "MCP要求にtoolUseIdがありません。対応するClaude Codeへ更新してください");
  let invocation: Invocation;
  try { invocation = invocationSchema.parse(JSON.parse(fs.readFileSync(path.join(root, parsed.data, "request.json"), "utf8"))); }
  catch { throw new ClaudeDeliveryError("CLAUDE_PARENT_HOOK_UNAVAILABLE", "親のPreToolUse hookを確認できません。aiterm-setupを実行し、hookを有効にしてください"); }
  const parent: ClaudeParent = { kind: "claude", request_id: parsed.data, session_id: invocation.session_id, hook_root: root };
  verifyClaudeParent(parent);
  return parent;
}

export function verifyClaudeParent(parent: ClaudeParent): void {
  const invocation = readInvocation(parent);
  if (invocation.agent_id) throw new ClaudeDeliveryError("CLAUDE_PARENT_SUBAGENT_UNSUPPORTED", "agent_id付きのClaude会話（--agent起動またはnative subagent）への自動配送には対応していません");
  assertOpen(parent);
}

export function bindClaudeParentDelivery(parent: ClaudeParent, deliveryId: string): void {
  verifyClaudeParent(parent);
  writeJson0600(path.join(directory(parent), "delivery.json"), { delivery_id: z.uuid().parse(deliveryId) });
}

/** SessionEndはその時点の依頼だけを終了する。同じ会話をresumeした新規依頼は別requestになる。 */
export function closeClaudeParentSession(input: unknown, root = defaultRoot()): void {
  const { session_id } = z.object({ session_id: z.uuid() }).parse(input);
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, "request.json");
    if (!fs.existsSync(file)) continue;
    const invocation = invocationSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (invocation.session_id === session_id) writeJson0600(path.join(root, entry.name, "closed.json"), { session_id });
  }
}

// filesystemの通知を先に登録してから状態を読む。producerの終了は低頻度のprocess照合でも検出する。
function waitForFileState<T>(dir: string, inspect: () => T | undefined): Promise<T> {
  return new Promise((resolve, reject) => {
    let finished = false;
    let timer: NodeJS.Timeout | undefined;
    const watcher = fs.watch(dir, () => check());
    const finish = (error: unknown, value?: T) => {
      if (finished) return;
      finished = true;
      watcher.close();
      if (timer) clearInterval(timer);
      if (error) reject(error); else resolve(value!);
    };
    const check = () => {
      if (finished) return;
      try { const value = inspect(); if (value !== undefined) finish(null, value); }
      catch (error) { finish(error); }
    };
    watcher.on("error", error => finish(error));
    timer = setInterval(check, 5000);
    check();
  });
}

function assertParentAlive(invocation: Invocation): void {
  if (processIdentity(invocation.parent_pid) !== invocation.parent_started_identity) {
    throw new ClaudeDeliveryError("CLAUDE_PARENT_PROCESS_CLOSED", "依頼元のClaude processは終了しました。回答は保存したままです");
  }
}

export async function submitClaudeParentAnswer(parent: ClaudeParent, deliveryId: string, text: string): Promise<{ queued_submission_id: null }> {
  const invocation = readInvocation(parent);
  const dir = directory(parent);
  // 会話終了でも確定本文を失わない。終了判定より先に保存する。
  writeJson0600(path.join(dir, "answer.json"), { delivery_id: deliveryId, text });
  await waitForFileState(dir, () => {
    const emitted = path.join(dir, "emitted.json");
    if (fs.existsSync(emitted)) {
      const value = JSON.parse(fs.readFileSync(emitted, "utf8"));
      if (value.delivery_id !== deliveryId) throw new ClaudeDeliveryError("CLAUDE_PARENT_DELIVERY_MISMATCH", "hookの配送IDが一致しません", true);
      return true;
    }
    assertOpen(parent);
    const failed = path.join(dir, "failed.json");
    if (fs.existsSync(failed)) {
      const value = JSON.parse(fs.readFileSync(failed, "utf8"));
      throw new ClaudeDeliveryError("CLAUDE_PARENT_HOOK_FAILED", "親へのhook出力が失敗しました。回答は保存したままです", value.outcome_unknown === true);
    }
    const hookFile = path.join(dir, "hook.json");
    if (fs.existsSync(hookFile)) {
      const hook = z.object({ pid: z.number().int().positive(), started_identity: z.string() }).parse(JSON.parse(fs.readFileSync(hookFile, "utf8")));
      if (processIdentity(hook.pid) !== hook.started_identity) {
        throw new ClaudeDeliveryError("CLAUDE_PARENT_HOOK_CLOSED", "親の受信hookが終了しました。自動再送はしていません", fs.existsSync(path.join(dir, "sending.json")));
      }
    }
    assertParentAlive(invocation);
    return undefined;
  });
  return { queued_submission_id: null };
}

export async function runClaudeResultHook(input: unknown, emit: (text: string) => void | Promise<void>, root = defaultRoot()): Promise<0 | 2> {
  const event = z.object({ session_id: z.uuid(), tool_use_id: requestId }).parse(input);
  const parent: ClaudeParent = { kind: "claude", request_id: event.tool_use_id, session_id: event.session_id, hook_root: root };
  const invocation = readInvocation(parent);
  const dir = directory(parent);
  const binding = path.join(dir, "delivery.json");
  if (!fs.existsSync(binding)) {
    fs.rmSync(dir, { recursive: true });
    return 0;
  }
  const deliveryId = z.uuid().parse(JSON.parse(fs.readFileSync(binding, "utf8")).delivery_id);
  const identity = processIdentity(process.pid);
  if (!identity) throw new ClaudeDeliveryError("CLAUDE_PARENT_HOOK_UNAVAILABLE", "受信hookのprocessを確認できません");
  writeJson0600(path.join(dir, "hook.json"), { pid: process.pid, started_identity: identity });
  try {
  const answer = await waitForFileState(dir, () => {
    if (fs.existsSync(path.join(dir, "closed.json"))) return null;
    assertParentAlive(invocation);
    const file = path.join(dir, "answer.json");
    if (!fs.existsSync(file)) return undefined;
    const value = z.object({ delivery_id: z.uuid(), text: z.string() }).strict().parse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (value.delivery_id !== deliveryId) throw new ClaudeDeliveryError("CLAUDE_PARENT_DELIVERY_MISMATCH", "保存された回答の配送IDが一致しません");
    return value;
  });
  if (!answer) return 0;
  assertOpen(parent);
  writeJson0600(path.join(dir, "sending.json"), { delivery_id: deliveryId });
  await emit(answer.text);
  writeJson0600(path.join(dir, "emitted.json"), { delivery_id: deliveryId });
  // Claudeが定めるasyncRewakeの再開信号。子の成功/失敗は本文のoutcomeで区別する。
  return 2;
  } catch (error) {
    writeJson0600(path.join(dir, "failed.json"), { outcome_unknown: fs.existsSync(path.join(dir, "sending.json")) });
    throw error;
  }
}
