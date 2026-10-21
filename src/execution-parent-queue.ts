// Current Claude PreToolUse/delivery evidence for the queue producer. This is
// not a cached vendor-session alias and cannot authorize Codex/Cursor by name.
import * as fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ExecutionPoint } from "./execution-contract.js";
import type { ExecutionState } from "./execution-store.js";
import { parentSourceSchema, type createParentSourceEvidence } from "./execution-parent-source.js";
import { ExecutionError } from "./execution-wire.js";

type Binding = ExecutionState["parent_deliveries"][number];
const nativeId = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const endpointSchema = z.object({ kind: z.literal("claude"), session_id: z.uuid(), request_id: nativeId, hook_root: z.string() }).strict();
const invocationSchema = z.object({ request_id: nativeId, session_id: z.uuid(), agent_id: z.string().nullable(),
  parent_pid: z.number().int().positive(), parent_started_identity: z.string().min(1).max(256) }).strict();
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function read(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw new ExecutionError("EXECUTION_UNCONFIRMED"); }
}
export function createParentQueueEndpointEvidence(input: {
  actor: { pid: number; started_identity: string } | null;
  sourceEvidence: ReturnType<typeof createParentSourceEvidence>; claudeHookRoot: string;
}) {
  if (!path.isAbsolute(input.claudeHookRoot) || /[\r\n\0]/.test(input.claudeHookRoot)) throw new ExecutionError("EXECUTION_INVALID");
  const root = path.resolve(input.claudeHookRoot), actor = input.actor && { ...input.actor }, sourceEvidence = input.sourceEvidence;
  // A request exists before a delivery binding does. Check the actual native
  // hook owner at ingress as well as at bind/queue; do not let an invalid old
  // record become valid by rereading a different request after an await.
  const verifyIngress = (endpoint: unknown, proofInput: unknown): string => {
    const parsed = parentSourceSchema.safeParse(proofInput);
    if (!actor || !parsed.success) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    const proof = parsed.data, parent = proof.source;
    if (proof.endpoint.vendor !== "claude") throw new ExecutionError("EXECUTION_UNSUPPORTED");
    if (!same(proof.mcp_process, actor)) throw new ExecutionError("EXECUTION_CONFLICT");
    sourceEvidence.verify(parent, endpoint, proof, true); sourceEvidence.verifyActor(parent, proof, actor);
    const ep = endpointSchema.safeParse(endpoint);
    if (!ep.success || !path.isAbsolute(ep.data.hook_root) || path.resolve(ep.data.hook_root) !== root
      || ep.data.session_id !== proof.endpoint.session_id || ep.data.request_id !== proof.endpoint.request_id)
      throw new ExecutionError("EXECUTION_STALE_GENERATION");
    const directory = path.join(root, ep.data.request_id);
    if (fs.existsSync(path.join(directory, "closed.json"))) throw new ExecutionError("EXECUTION_STALE_GENERATION");
    const invocation = invocationSchema.safeParse(read(path.join(directory, "request.json")));
    if (!invocation.success || invocation.data.request_id !== ep.data.request_id
      || invocation.data.session_id !== ep.data.session_id || invocation.data.agent_id !== null
      || !same({ pid: invocation.data.parent_pid, started_identity: invocation.data.parent_started_identity }, proof.harness_process))
      throw new ExecutionError("EXECUTION_STALE_GENERATION");
    sourceEvidence.verifyActor(parent, proof, proof.harness_process);
    return directory;
  };
  const verify = (parent: ExecutionPoint, endpoint: unknown, binding: Readonly<Binding>, phase: "bind" | "queue"): boolean => {
    const parsed = parentSourceSchema.safeParse(binding.source_evidence);
    if (!parsed.success) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    if (!same(parsed.data.request, binding.request) || !same(binding.parent, parent)) throw new ExecutionError("EXECUTION_CONFLICT");
    const directory = verifyIngress(endpoint, parsed.data);
    const deliveryFile = path.join(directory, "delivery.json");
    // The existing manager writes the native delivery binding just after our
    // before_send companion. It must exist for actual queue, and an existing
    // conflicting binding is refused even during the initial bind phase.
    if (phase !== "bind" || fs.existsSync(deliveryFile)) {
      const delivery = z.object({ delivery_id: z.uuid() }).strict().safeParse(read(deliveryFile));
      if (!delivery.success || delivery.data.delivery_id !== binding.delivery_id) return false;
    }
    return true;
  };
  return Object.assign(verify, {
    verifyIngress: (endpoint: unknown, proof: unknown): void => { verifyIngress(endpoint, proof); },
    verifyCompanion: (id: string, endpoint: unknown, proof: unknown): void => {
      const directory = verifyIngress(endpoint, proof), expected = z.uuid().parse(id);
      const file = path.join(directory, "delivery.json");
      if (fs.existsSync(file)) {
        const existing = z.object({ delivery_id: z.uuid() }).strict().safeParse(read(file));
        if (!existing.success || existing.data.delivery_id !== expected) throw new ExecutionError("EXECUTION_CONFLICT");
      }
    },
  });
}
