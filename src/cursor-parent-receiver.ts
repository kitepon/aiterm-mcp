// Cursor親の受信口。会話への差し込みはCursor公式hookのadditional_context、idle時の起床は受け口processが担う。
import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { ensureStateRoot, waitForFileState, writeJson0600 } from "./agent-shared.js";
import { AitermError } from "./errors.js";

export const cursorParentSchema = z.object({
  kind: z.literal("cursor"),
  hook_root: z.string(),
}).strict();
export type CursorParent = z.infer<typeof cursorParentSchema>;

const deliveryIdSchema = z.string().uuid();
const dispatchTools = new Set([
  "agent_launch", "claude_agent", "codex_agent", "grok_agent", "composer_agent", "pty_send", "claude_turn",
]);

export class CursorDeliveryError extends AitermError {
  constructor(readonly delivery_code: string, message: string, readonly outcome_unknown = false) {
    super(`${delivery_code}: ${message}`, 2);
  }
}

export function isCursorMcpClient(clientName: string | undefined): boolean {
  if (clientName === undefined) return false;
  return clientName === "cursor-vscode" || clientName.startsWith("cursor-vscode ");
}

export function cursorHookRoot(state = ensureStateRoot()): string {
  return path.join(state, "cursor-parent-hooks");
}

export function cursorHooksFile(home = process.env.HOME ?? homedir()): string {
  return path.join(process.env.CURSOR_HOME ?? path.join(home, ".cursor"), "hooks.json");
}

export function cursorParentHooksRegistered(document: unknown): boolean {
  if (document === null || typeof document !== "object" || Array.isArray(document)) return false;
  const hooks = (document as { hooks?: unknown }).hooks;
  if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) return false;
  const owns = (event: string) => {
    const list = (hooks as Record<string, unknown>)[event];
    return Array.isArray(list) && list.some(entry => {
      if (entry === null || typeof entry !== "object") return false;
      const command = (entry as { command?: unknown }).command;
      return typeof command === "string" && command.includes("cursor-parent-hook.js");
    });
  };
  return owns("postToolUse") && owns("afterMCPExecution");
}

export function verifyCursorParent(parent: CursorParent, hooksFile = cursorHooksFile()): void {
  cursorParentSchema.parse(parent);
  let document: unknown;
  try { document = JSON.parse(fs.readFileSync(hooksFile, "utf8")); }
  catch { throw new CursorDeliveryError("CURSOR_PARENT_HOOK_UNAVAILABLE", "Cursorのhookが登録されていません。aiterm-setupを実行してください"); }
  if (!cursorParentHooksRegistered(document)) {
    throw new CursorDeliveryError("CURSOR_PARENT_HOOK_UNAVAILABLE", "Cursorのhookが登録されていません。aiterm-setupを実行してください");
  }
}

export function cursorParentFromRequest(
  clientName: string | undefined,
  options: { hookRoot?: string; hooksFile?: string } = {},
): CursorParent | null {
  if (!isCursorMcpClient(clientName)) return null;
  const parent: CursorParent = { kind: "cursor", hook_root: options.hookRoot ?? cursorHookRoot() };
  verifyCursorParent(parent, options.hooksFile);
  return parent;
}

function deliveryDir(parent: CursorParent, deliveryId: string): string {
  return path.join(parent.hook_root, "deliveries", deliveryIdSchema.parse(deliveryId));
}

export function prepareCursorDelivery(parent: CursorParent, deliveryId: string): void {
  cursorParentSchema.parse(parent);
  fs.mkdirSync(deliveryDir(parent, deliveryId), { recursive: true, mode: 0o700 });
}

export async function submitCursorParentAnswer(
  parent: CursorParent,
  deliveryId: string,
  text: string,
  timeoutMs = 86_400_000,
): Promise<{ queued_submission_id: null }> {
  const dir = deliveryDir(parent, deliveryId);
  writeJson0600(path.join(dir, "answer.json"), { delivery_id: deliveryId, text });
  try {
    await waitForFileState(dir, () => fs.existsSync(path.join(dir, "claim.json")) ? true : undefined, timeoutMs);
  } catch (error) {
    if (error instanceof Error && error.message === "WAIT_FOR_FILE_TIMEOUT") {
      throw new CursorDeliveryError("CURSOR_PARENT_DELIVERY_UNCLAIMED", "Cursor親が時間内に回答を受け取りませんでした。回答は保存したままです");
    }
    throw error;
  }
  return { queued_submission_id: null };
}

function conversationId(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) return null;
  if (value.includes("/") || value.includes("\\") || value.includes("..")) return null;
  return value;
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); }
  catch { return null; }
}

function deliveryIdFromResult(value: unknown, depth = 0): string | null {
  if (depth > 3 || value === null || value === undefined) return null;
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (parsed === null || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const structured = record.structuredContent;
  const carrier = structured !== null && typeof structured === "object" ? structured as Record<string, unknown> : record;
  const parentDelivery = carrier.parent_delivery;
  if (parentDelivery !== null && typeof parentDelivery === "object") {
    const id = (parentDelivery as { delivery_id?: unknown }).delivery_id;
    if (typeof id === "string" && deliveryIdSchema.safeParse(id).success) return id;
  }
  if (depth === 0 && Array.isArray(record.content)) {
    for (const entry of record.content) {
      if (entry !== null && typeof entry === "object" && (entry as { type?: unknown }).type === "text") {
        const text = (entry as { text?: unknown }).text;
        if (typeof text === "string") {
          const id = deliveryIdFromResult(text, depth + 1);
          if (id) return id;
        }
      }
    }
  }
  return null;
}

function toolBaseName(name: string): string {
  const tail = name.split(/[:.]/).pop() ?? name;
  return tail.replace(/^mcp__aiterm__/, "");
}

function claim(dir: string, channel: "hook" | "receiver"): boolean {
  try {
    fs.writeFileSync(path.join(dir, "claim.json"), JSON.stringify({ channel, at: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

function bind(hookRoot: string, deliveryId: string, conv: string): void {
  const dir = path.join(hookRoot, "deliveries", deliveryId);
  if (!fs.existsSync(dir)) return;
  const bindFile = path.join(dir, "bind.json");
  if (!fs.existsSync(bindFile)) {
    writeJson0600(bindFile, { conversation_id: conv, created_at: new Date().toISOString() });
  }
  const indexDir = path.join(hookRoot, "conversations", conv);
  fs.mkdirSync(indexDir, { recursive: true, mode: 0o700 });
  const index = path.join(indexDir, deliveryId);
  if (!fs.existsSync(index)) fs.writeFileSync(index, "", { mode: 0o600 });
}

function inject(hookRoot: string, conv: string): string[] {
  const indexDir = path.join(hookRoot, "conversations", conv);
  if (!fs.existsSync(indexDir)) return [];
  const pending = fs.readdirSync(indexDir).flatMap(deliveryId => {
    const dir = path.join(hookRoot, "deliveries", deliveryId);
    const answerFile = path.join(dir, "answer.json");
    const bindFile = path.join(dir, "bind.json");
    if (!fs.existsSync(answerFile) || !fs.existsSync(bindFile)) return [];
    const answer = z.object({ delivery_id: z.string(), text: z.string() }).parse(JSON.parse(fs.readFileSync(answerFile, "utf8")));
    const bound = z.object({ conversation_id: z.string(), created_at: z.string() }).parse(JSON.parse(fs.readFileSync(bindFile, "utf8")));
    if (answer.delivery_id !== deliveryId || bound.conversation_id !== conv) return [];
    return [{ deliveryId, dir, created_at: bound.created_at, text: answer.text }];
  }).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const texts: string[] = [];
  for (const item of pending) {
    const index = path.join(indexDir, item.deliveryId);
    if (!claim(item.dir, "hook")) {
      if (fs.existsSync(path.join(item.dir, "claim.json"))) fs.rmSync(index, { force: true });
      continue;
    }
    texts.push(item.text);
    fs.rmSync(index, { force: true });
  }
  return texts;
}

export async function handleCursorHook(raw: string, hookRoot = cursorHookRoot()): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return {}; }
  if (parsed === null || typeof parsed !== "object") return {};
  const event = parsed as Record<string, unknown>;
  const name = event.hook_event_name;
  if (name !== "afterMCPExecution" && name !== "postToolUse" && name !== "postToolUseFailure") return {};
  const conv = conversationId(event.conversation_id);
  if (!conv) return {};
  const toolName = typeof event.tool_name === "string" ? event.tool_name : "";
  if (dispatchTools.has(toolBaseName(toolName))) {
    const payload = name === "afterMCPExecution" ? event.result_json : event.tool_output;
    const deliveryId = deliveryIdFromResult(payload);
    if (deliveryId) bind(hookRoot, deliveryId, conv);
  }
  if (name === "postToolUse" || name === "postToolUseFailure") {
    const texts = inject(hookRoot, conv);
    if (texts.length > 0) return { additional_context: texts.join("\n\n") };
  }
  return {};
}

export type CursorReceiveResult = { outcome: "delivered"; text: string } | { outcome: "delivered_by_hook" } | { outcome: "timeout" };

export async function receiveCursorAnswer(hookRoot: string, deliveryId: string, timeoutMs = 86_400_000): Promise<CursorReceiveResult> {
  const id = deliveryIdSchema.parse(deliveryId);
  const dir = path.join(hookRoot, "deliveries", id);
  if (!fs.existsSync(dir)) throw new CursorDeliveryError("CURSOR_PARENT_DELIVERY_UNKNOWN", "Cursor配送の記録がありません");
  const answerFile = path.join(dir, "answer.json");
  try {
    await waitForFileState(dir, () => fs.existsSync(answerFile) ? true : undefined, timeoutMs);
  } catch (error) {
    if (error instanceof Error && error.message === "WAIT_FOR_FILE_TIMEOUT") return { outcome: "timeout" };
    throw error;
  }
  const answer = z.object({ delivery_id: z.string(), text: z.string() }).parse(JSON.parse(fs.readFileSync(answerFile, "utf8")));
  if (answer.delivery_id !== id) throw new CursorDeliveryError("CURSOR_PARENT_DELIVERY_MISMATCH", "保存された回答の配送IDが一致しません");
  if (!claim(dir, "receiver")) return { outcome: "delivered_by_hook" };
  return { outcome: "delivered", text: answer.text };
}
