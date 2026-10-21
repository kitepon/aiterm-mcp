// Native hook endpoint proof for the already accepted existing delivery. Only
// synchronous local metadata reads; no queue, completion inference or CLI I/O.
// Wake/openers and channels lacking native context are deliberately unsupported.
import * as fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ExecutionPoint } from "./execution-contract.js";
import type { ExecutionState } from "./execution-store.js";
import { parentSourceSchema, type createParentSourceEvidence } from "./execution-parent-source.js";
import { ExecutionError } from "./execution-wire.js";

type Binding = ExecutionState["parent_deliveries"][number];
type Actor = { pid: number; started_identity: string };
const nativeId = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const conversationId = z.string().min(1).max(200).refine(value => !value.includes("/") && !value.includes("\\") && !value.includes(".."));
const codex = z.object({ thread_id: z.uuid(), codex_home: z.string() }).strict();
const claude = z.object({ kind: z.literal("claude"), session_id: z.uuid(), request_id: nativeId, hook_root: z.string() }).strict();
const cursor = z.object({ kind: z.literal("cursor"), hook_root: z.string() }).strict();
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function root(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (!path.isAbsolute(value) || /[\r\n\0]/.test(value)) throw new ExecutionError("EXECUTION_INVALID");
  return path.resolve(value);
}
function read(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw new ExecutionError("EXECUTION_UNCONFIRMED"); }
}
export function createNativeParentEndpointEvidence(input: {
  actor: Actor | null; sourceEvidence: ReturnType<typeof createParentSourceEvidence>;
  // Resolve once from this process's actual product scope, not endpoint args.
  codexHome?: string | null; claudeHookRoot?: string | null; cursorHookRoot?: string | null;
}) {
  const actor = input.actor && { ...input.actor }, sourceEvidence = input.sourceEvidence;
  const roots = { codex: root(input.codexHome), claude: root(input.claudeHookRoot), cursor: root(input.cursorHookRoot) };
  return (parent: ExecutionPoint, endpoint: unknown, nativeContext?: unknown, binding?: Readonly<Binding>): boolean => {
    if (!actor || !binding || !nativeContext) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    const parsed = parentSourceSchema.safeParse(binding.source_evidence);
    if (!parsed.success) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    const proof = parsed.data;
    if (!same(binding.parent, parent) || !same(proof.request, binding.request)) throw new ExecutionError("EXECUTION_CONFLICT");
    sourceEvidence.verify(parent, endpoint, proof);
    sourceEvidence.verifyActor(parent, proof, actor);
    if (proof.endpoint.vendor === "codex") {
      const ep = codex.safeParse(endpoint), event = z.object({ session_id: z.uuid(), turn_id: z.string().min(1).max(256) }).safeParse(nativeContext);
      if (!roots.codex) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      if (!event.success) throw new ExecutionError("EXECUTION_UNCONFIRMED");
      return ep.success && event.success && root(ep.data.codex_home) === roots.codex
        && ep.data.thread_id === proof.endpoint.thread_id && event.data.session_id === ep.data.thread_id;
    }
    if (proof.endpoint.vendor === "claude") {
      const ep = claude.safeParse(endpoint), event = z.object({ session_id: z.uuid(), tool_use_id: nativeId }).safeParse(nativeContext);
      if (!roots.claude) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      if (!event.success) throw new ExecutionError("EXECUTION_UNCONFIRMED");
      if (!ep.success || !event.success || root(ep.data.hook_root) !== roots.claude || ep.data.session_id !== proof.endpoint.session_id
        || ep.data.request_id !== proof.endpoint.request_id || event.data.session_id !== ep.data.session_id
        || event.data.tool_use_id !== ep.data.request_id) return false;
      const directory = path.join(roots.claude, ep.data.request_id);
      if (fs.existsSync(path.join(directory, "closed.json"))) return false;
      const invocation = z.object({ request_id: nativeId, session_id: z.uuid(), agent_id: z.string().nullable(),
        parent_pid: z.number().int().positive(), parent_started_identity: z.string().min(1).max(256) }).strict().safeParse(read(path.join(directory, "request.json")));
      const delivery = z.object({ delivery_id: z.uuid() }).strict().safeParse(read(path.join(directory, "delivery.json")));
      if (!invocation.success || !delivery.success || delivery.data.delivery_id !== binding.delivery_id || invocation.data.agent_id !== null
        || invocation.data.request_id !== ep.data.request_id || invocation.data.session_id !== ep.data.session_id) return false;
      const owner = { pid: invocation.data.parent_pid, started_identity: invocation.data.parent_started_identity };
      sourceEvidence.verifyActor(parent, proof, owner);
      // A sibling MCP/hook descendant is not the CLI that owned PreToolUse.
      // Keep the original native harness identity at the worker boundary too.
      return same(owner, proof.harness_process);
    }
    const ep = cursor.safeParse(endpoint), event = z.object({ conversation_id: conversationId,
      hook_event_name: z.enum(["postToolUse", "postToolUseFailure"]) }).safeParse(nativeContext);
    if (!roots.cursor) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    if (!event.success) throw new ExecutionError("EXECUTION_UNCONFIRMED");
    if (!ep.success || !event.success || root(ep.data.hook_root) !== roots.cursor) return false;
    // Only this exact recorded delivery's native binding is admissible. A Bot
    // name, a root-only MCP parent, or a latest conversation is not a binding.
    const bound = z.object({ conversation_id: conversationId, created_at: z.string() }).strict()
      .safeParse(read(path.join(roots.cursor, "deliveries", binding.delivery_id, "bind.json")));
    return bound.success && bound.data.conversation_id === event.data.conversation_id;
  };
}
