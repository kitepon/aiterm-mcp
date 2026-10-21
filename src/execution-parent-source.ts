// Additional provenance for the actual native MCP parent decoder. This is an
// internal local-correlation gate, not cryptographic client authentication, a
// native turn alias, or proof that a vendor endpoint is still loaded. Existing
// independent endpoint verification is mandatory at queue/emit/wake as well.
import { z } from "zod";
import { executionPointSchema, executionRequestSchema, type ExecutionPoint } from "./execution-contract.js";
import { currentExecutionIngress } from "./execution-context.js";
import { ExecutionError } from "./execution-wire.js";

const identity = z.object({ pid: z.number().int().positive(), started_identity: z.string().min(1).max(256) }).strict();
const endpoint = z.discriminatedUnion("vendor", [
  z.object({ vendor: z.literal("codex"), thread_id: z.uuid() }).strict(),
  z.object({ vendor: z.literal("claude"), session_id: z.uuid(), request_id: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/) }).strict(),
  // Cursor's MCP ingress has no native conversation ID. It stays absent here;
  // the later hook/delivery binding must independently prove that endpoint.
  z.object({ vendor: z.literal("cursor") }).strict(),
]);
export const parentSourceSchema = z.object({
  schema: z.literal("aiterm.parent-source.v1"), request: executionRequestSchema.options[4],
  source: executionPointSchema, client_name: z.string().min(1).max(256),
  mcp_process: identity, harness_process: identity, endpoint,
}).strict();
export type ParentSource = z.infer<typeof parentSourceSchema>;
// The actual issue boundary is synchronous. A pending promise is missing proof,
// even if it will later resolve true; it must not accidentally pass a truth test.
export function requireParentEndpointEvidence(value: unknown): void {
  if (value === true) return;
  if (value && (typeof value === "object" || typeof value === "function") && "then" in value) {
    void Promise.resolve(value).catch(() => {}); // suppress only the rejected proof, never an effect result
  }
  throw new ExecutionError(value === false ? "EXECUTION_STALE_GENERATION" : "EXECUTION_UNSUPPORTED");
}
const snapshotSchema = z.object({
  schema: z.literal("aiterm.execution-parent-process.v1"), source: executionPointSchema,
  harness: z.enum(["codex-cli", "claude-code", "cursor-cli", "grok-cli"]), harness_process: identity,
  processes: z.array(identity.extend({ parent_pid: z.number().int().nonnegative() }).strict()),
}).strict();
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const processIdentity = (row: { pid: number; started_identity: string }) => ({ pid: row.pid, started_identity: row.started_identity });
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, canonical(value)])) : value;
const equalEndpoint = (a: unknown, b: unknown): boolean => same(canonical(a), canonical(b));

export interface ParentSourceBindings {
  // Call the existing native decoders with the initialized client and SDK meta.
  // Never decode a tool argument or read a latest job/vendor-session cache.
  decode(clientName: string, metadata: unknown): unknown | null;
  // Private core adapter: generation + unique native harness + same process
  // table snapshot. No screen, argv, environment, or arbitrary current Bot ID.
  observeParentProcess(session: string): unknown;
  // Mandatory in the serving producer; standalone primitive fixtures may
  // capture their own synchronous frame without an asynchronous dispatcher.
  requireFrozenIngress?: boolean;
}
export function createParentSourceEvidence(bindings: ParentSourceBindings) {
  const requireFrozenIngress = bindings.requireFrozenIngress === true;
  const observe = (source: ExecutionPoint) => {
    let value: z.infer<typeof snapshotSchema>;
    try { value = snapshotSchema.parse(bindings.observeParentProcess(source.launch.session_id)); }
    catch (error) {
      if (error instanceof ExecutionError) throw error;
      throw new ExecutionError("EXECUTION_UNCONFIRMED");
    }
    if (!same(value.source.launch, source.launch)) throw new ExecutionError("EXECUTION_STALE_GENERATION");
    const rows = new Map(value.processes.map(row => [row.pid, row]));
    const harness = rows.get(value.harness_process.pid);
    if (rows.size !== value.processes.length || !harness || !same(processIdentity(harness), value.harness_process))
      throw new ExecutionError("EXECUTION_UNCONFIRMED");
    return value;
  };
  const nativeEndpoint = (value: unknown): z.infer<typeof endpoint> => {
    if (!value || typeof value !== "object") throw new ExecutionError("EXECUTION_UNSUPPORTED");
    const parent = value as Record<string, unknown>;
    return endpoint.parse(parent.kind === "claude" ? { vendor: "claude", session_id: parent.session_id, request_id: parent.request_id }
      : parent.kind === "cursor" ? { vendor: "cursor" } : { vendor: "codex", thread_id: parent.thread_id });
  };
  const compatible = (proof: ParentSource, snapshot: z.infer<typeof snapshotSchema>) => {
    const expected = { codex: "codex-cli", claude: "claude-code", cursor: "cursor-cli" }[proof.endpoint.vendor];
    if (snapshot.harness !== expected || !same(snapshot.harness_process, proof.harness_process))
      throw new ExecutionError("EXECUTION_STALE_GENERATION");
  };
  const lineage = (snapshot: z.infer<typeof snapshotSchema>, actor: z.infer<typeof identity>): void => {
    const rows = new Map(snapshot.processes.map(row => [row.pid, row]));
    let row = rows.get(actor.pid);
    if (!row || !same(processIdentity(row), actor)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
    if (!Number.isFinite(Date.parse(actor.started_identity)) || !Number.isFinite(Date.parse(snapshot.harness_process.started_identity)))
      throw new ExecutionError("EXECUTION_UNCONFIRMED");
    const seen = new Set<number>();
    for (;;) {
      if (seen.has(row.pid)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
      seen.add(row.pid);
      if (row.pid === snapshot.harness_process.pid) return;
      const parent = rows.get(row.parent_pid);
      const childTime = Date.parse(row.started_identity), parentTime = parent && Date.parse(parent.started_identity);
      if (!parent || !Number.isFinite(childTime) || !Number.isFinite(parentTime) || parentTime! > childTime)
        throw new ExecutionError("EXECUTION_UNCONFIRMED");
      row = parent;
    }
  };
  const fresh = (endpointInput: unknown, decodedInput?: { value: unknown }): ParentSource => {
    const context = currentExecutionIngress();
    const request = context?.request, ingress = context?.ingress;
    if (request?.kind !== "mcp" || !ingress?.source || !ingress.client_name || !ingress.native_identity)
      throw new ExecutionError("EXECUTION_UNSUPPORTED");
    const actual = identity.parse(ingress.native_identity);
    if (actual.pid !== request.process_pid || actual.started_identity !== request.process_started_identity)
      throw new ExecutionError("EXECUTION_UNCONFIRMED");
    const decoded = decodedInput ? decodedInput.value : bindings.decode(ingress.client_name, ingress.metadata);
    if (!decoded || !equalEndpoint(decoded, endpointInput)) throw new ExecutionError("EXECUTION_CONFLICT");
    const snapshot = observe(ingress.source);
    const proof = parentSourceSchema.parse({ schema: "aiterm.parent-source.v1", request,
      source: ingress.source, client_name: ingress.client_name, mcp_process: actual,
      harness_process: snapshot.harness_process, endpoint: nativeEndpoint(decoded) });
    compatible(proof, snapshot); lineage(snapshot, actual);
    return proof;
  };
  const frozenSchema = z.object({ endpoint: z.unknown(), proof: parentSourceSchema }).strict();
  return {
    // Serving producer only: call synchronously at ingress, before any target
    // or metadata await. Decode exactly once; actor/source proof is captured in
    // the same request frame, not from a later hook file or latest job.
    captureIngress() {
      const context = currentExecutionIngress(), ingress = context?.ingress;
      if (context?.request.kind !== "mcp" || !ingress?.source || !ingress.client_name || !ingress.native_identity) return null;
      const decoded = bindings.decode(ingress.client_name, ingress.metadata);
      if (!decoded) return null;
      return frozenSchema.parse({ endpoint: structuredClone(decoded), proof: fresh(decoded, { value: decoded }) });
    },
    // Read only the immutable ingress selection. A later decoder/default root
    // cannot manufacture a parent when ingress explicitly had none.
    endpointFromIngress(): unknown | null {
      const context = currentExecutionIngress(), ingress = context?.ingress;
      if (!context || !ingress) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      if (context.request.kind !== "mcp") return null; // fixed host delivery/room/call context
      if (!Object.hasOwn(ingress, "native_parent")) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      if (ingress.native_parent === null) return null;
      const fixed = frozenSchema.safeParse(ingress.native_parent);
      if (!fixed.success) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      // capture requires this exact snapshot/request/source/client/actor and
      // independently reobserves current native generation/lineage.
      this.capture(fixed.data.endpoint);
      return structuredClone(fixed.data.endpoint);
    },
    capture(endpointInput: unknown): ParentSource {
      const context = currentExecutionIngress(), ingress = context?.ingress;
      if (ingress && Object.hasOwn(ingress, "native_parent")) {
        const fixed = frozenSchema.safeParse(ingress.native_parent);
        if (!fixed.success) throw new ExecutionError("EXECUTION_UNSUPPORTED");
        const { proof, endpoint } = fixed.data;
        if (!same(proof.request, context!.request) || !same(proof.source, ingress.source)
          || proof.client_name !== ingress.client_name || !same(proof.mcp_process, ingress.native_identity)
          || !equalEndpoint(endpoint, endpointInput) || !same(nativeEndpoint(endpoint), proof.endpoint))
          throw new ExecutionError("EXECUTION_CONFLICT");
        const snapshot = observe(proof.source); compatible(proof, snapshot); lineage(snapshot, proof.mcp_process);
        return parentSourceSchema.parse(proof);
      }
      // Standalone private adapters can still capture their own synchronous
      // frame. The serving participant always supplies native_parent (or null)
      // and cannot use this legacy path after an asynchronous wait.
      if (requireFrozenIngress) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      return fresh(endpointInput);
    },
    verify(parent: ExecutionPoint, endpointInput: unknown, proofInput: unknown, initial = false): void {
      const parsed = parentSourceSchema.safeParse(proofInput);
      if (!parsed.success) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      const proof = parsed.data;
      if (proof.request.process_pid !== proof.mcp_process.pid || proof.request.process_started_identity !== proof.mcp_process.started_identity)
        throw new ExecutionError("EXECUTION_CONFLICT");
      if (!same(proof.source, parent) || !same(nativeEndpoint(endpointInput), proof.endpoint))
        throw new ExecutionError("EXECUTION_CONFLICT");
      const snapshot = observe(parent); compatible(proof, snapshot);
      // before_send must still have the same live serving process. Later
      // delivery can outlive that MCP process; its immutable provenance is not
      // replaced with another caller. Independent endpoint/native proof remains.
      if (initial) lineage(snapshot, proof.mcp_process);
    },
    verifyActor(parent: ExecutionPoint, proofInput: unknown, actorInput: unknown): void {
      const parsed = parentSourceSchema.safeParse(proofInput), actor = identity.safeParse(actorInput);
      if (!parsed.success || !actor.success) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      if (!same(parsed.data.source, parent)) throw new ExecutionError("EXECUTION_CONFLICT");
      const snapshot = observe(parent); compatible(parsed.data, snapshot); lineage(snapshot, actor.data);
    },
  };
}
