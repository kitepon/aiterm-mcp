// Accepted native hook references for a parent return. They identify the hook
// context, not necessarily the recipient execution turn (especially Stop).
// No dispatch cursor is manufactured/rekeyed and no completion fence is closed.
import { z } from "zod";
import { executionLaunchSchema } from "./execution-contract.js";
import { parentSourceSchema } from "./execution-parent-source.js";
import type { ExecutionStore, ExecutionState } from "./execution-store.js";
import { ExecutionError } from "./execution-wire.js";

const nativeId = z.string().min(1).max(256);
const toolId = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const conversationId = z.string().min(1).max(200).refine(value => !value.includes("/") && !value.includes("\\") && !value.includes(".."));
const nativeSchema = z.discriminatedUnion("vendor", [
  z.object({ vendor: z.literal("codex"), session_id: z.uuid(), turn_id: nativeId,
    hook_event_name: z.enum(["PostToolUse", "Stop"]).nullable() }).strict(),
  z.object({ vendor: z.literal("claude"), session_id: z.uuid(), tool_use_id: toolId }).strict(),
  z.object({ vendor: z.literal("cursor"), conversation_id: conversationId,
    hook_event_name: z.enum(["postToolUse", "postToolUseFailure"]) }).strict(),
]);
export const parentHookReferenceSchema = z.object({
  schema: z.literal("aiterm.parent-hook-reference.v1"), target: executionLaunchSchema, native: nativeSchema,
}).strict();
export type ParentHookReference = z.infer<typeof parentHookReferenceSchema>;
type Binding = ExecutionState["parent_deliveries"][number];
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Called only inside a verified native issue transaction, after the concrete
 * endpoint/actor/scope resolver accepted this exact binding and frozen context.
 * Parsing alone is not source evidence and this function is not a tool input.
 */
export function parentHookReference(binding: Readonly<Binding>, _endpoint: unknown, nativeContext: unknown): ParentHookReference {
  const parsed = parentSourceSchema.safeParse(binding.source_evidence);
  if (!parsed.success) throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const proof = parsed.data;
  if (!same(proof.source, binding.parent) || !same(proof.request, binding.request)) throw new ExecutionError("EXECUTION_CONFLICT");
  const context = nativeContext && typeof nativeContext === "object" ? nativeContext as Record<string, unknown> : {};
  const native = nativeSchema.safeParse(proof.endpoint.vendor === "codex"
    ? { vendor: "codex", session_id: context.session_id, turn_id: context.turn_id, hook_event_name: context.hook_event_name ?? null }
    : proof.endpoint.vendor === "claude" ? { vendor: "claude", session_id: context.session_id, tool_use_id: context.tool_use_id }
      : { vendor: "cursor", conversation_id: context.conversation_id, hook_event_name: context.hook_event_name });
  if (!native.success) throw new ExecutionError("EXECUTION_UNCONFIRMED");
  if (native.data.vendor === "codex" && proof.endpoint.vendor === "codex" && native.data.session_id !== proof.endpoint.thread_id)
    throw new ExecutionError("EXECUTION_CONFLICT");
  if (native.data.vendor === "claude" && proof.endpoint.vendor === "claude"
    && (native.data.session_id !== proof.endpoint.session_id || native.data.tool_use_id !== proof.endpoint.request_id))
    throw new ExecutionError("EXECUTION_CONFLICT");
  return parentHookReferenceSchema.parse({ schema: "aiterm.parent-hook-reference.v1", target: binding.parent.launch, native: native.data });
}

/** Historical hook-context lookup, not a runtime observe/finish or replay.
 * Issued, unknown, absent and retired records do not yield references. Even an
 * accepted reference does not prove which execution consumed the emitted text.
 * Later correlation must establish recipient acceptance, generation and end.
 */
export async function readAcceptedParentHookReference(store: ExecutionStore, deliveryInput: string): Promise<ParentHookReference | null> {
  const delivery = z.uuid().parse(deliveryInput);
  return store.transaction(state => {
    const binding = state.parent_deliveries.find(value => value.delivery_id === delivery);
    if (!binding) throw new ExecutionError("EXECUTION_NOT_FOUND");
    const record = state.records.find(value => value.reservation.request.kind === "delivery"
      && value.reservation.request.delivery_id === delivery && value.reservation.request.target_session_id === binding.parent.launch.session_id);
    if (!record || record.operations.send !== "accepted" || record.relation.phase !== "invoked" || record.relation.lifecycle === "retired") return null;
    if (!same(record.relation.target?.launch, binding.parent.launch) || !same(record.relation.source?.launch, binding.child.launch))
      throw new ExecutionError("EXECUTION_UNCONFIRMED");
    const effects = state.parent_effects.filter(value => value.delivery_id === delivery && value.stage === "emit");
    if (effects.length > 1) throw new ExecutionError("EXECUTION_UNCONFIRMED");
    const effect = effects[0];
    if (!effect || effect.state !== "accepted" || !effect.hook_reference) return null;
    const alias = parentHookReferenceSchema.parse(effect.hook_reference);
    if (!same(alias.target, binding.parent.launch) || !same(parentHookReference(binding, undefined, alias.native), alias))
      throw new ExecutionError("EXECUTION_UNCONFIRMED");
    return alias;
  }, { readOnly: true });
}
