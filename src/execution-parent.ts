// The caller supplies real before_send and existing parent-delivery references.
// This is metadata/admission only: no answer text, queue, resend or vendor RPC.
import { z } from "zod";
import { createHash } from "node:crypto";
import { AsyncResource } from "node:async_hooks";
import { executionPointSchema, executionRequestSchema, executionBoundarySchema,
  executionLaunchSchema, type ExecutionPoint, type ExecutionRequest } from "./execution-contract.js";
import type { ExecutionService } from "./execution-service.js";
import type { ExecutionStore, ExecutionState } from "./execution-store.js";
import { runDeferredBoundExecution } from "./execution-tools.js";
import { beforeExecutionEffect } from "./execution-effect.js";
import { EXECUTION_REQUEST_META_KEY, ExecutionError } from "./execution-wire.js";

type Binding = ExecutionState["parent_deliveries"][number];
type QueueReceipt = { queued_submission_id: string | null };
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const deliveryId = z.uuid();
const stopped = (state: ExecutionState, point: ExecutionPoint): boolean =>
  state.stopping.some(launch => same(launch, point.launch));

export interface ExecutionParentBindings {
  store: ExecutionStore;
  service: ExecutionService;
  observeSessionGeneration(session: string): unknown | Promise<unknown>;
  // Prove the actual vendor endpoint belongs to this same managed parent
  // launch (native vendor session/home correlation). Generation alone cannot
  // authorize a different thread/hook endpoint. Missing proof is unsupported.
  verifyParentEndpoint?(parent: ExecutionPoint, endpoint: unknown): boolean;
}
/** Construct once for the same state/socket scope as the serving service. Each
 * submit/emit/wake process must look up this binding; no latest-seat fallback.
 * Public tool arguments do not provide this adapter's original request/source.
 */
export function createExecutionParentAdapter(bindings: ExecutionParentBindings) {
  const digest = (endpoint: unknown): string => {
    const canonical = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonical);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
      return value;
    };
    const serialized = JSON.stringify(canonical(endpoint));
    if (!serialized) throw new ExecutionError("EXECUTION_INVALID");
    return createHash("sha256").update(serialized).digest("hex");
  };
  const verifyEndpoint = (parent: ExecutionPoint, endpoint: unknown): void => {
    if (!bindings.verifyParentEndpoint) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    if (!bindings.verifyParentEndpoint(parent, endpoint)) throw new ExecutionError("EXECUTION_STALE_GENERATION");
  };
  const observe = async (point: ExecutionPoint): Promise<void> => {
    const value = await bindings.observeSessionGeneration(point.launch.session_id) as Record<string, unknown> | null;
    if (!value || value.schema !== "aiterm.pty-observe-result.v1" || value.session_id !== point.launch.session_id
      || value.exists !== true) throw new ExecutionError("EXECUTION_UNCONFIRMED");
    const launch = executionLaunchSchema.safeParse({ session_id: value.session_id, launch_id: value.launch_id });
    if (!launch.success) throw new ExecutionError("EXECUTION_UNCONFIRMED");
    if (!same(launch.data, point.launch)) throw new ExecutionError("EXECUTION_STALE_GENERATION");
  };
  const read = (state: ExecutionState, id: string): Binding => {
    const result = state.parent_deliveries.find(value => value.delivery_id === id);
    if (!result) throw new ExecutionError("EXECUTION_NOT_FOUND");
    return result;
  };
  const original = (state: ExecutionState, binding: Binding, accepted: boolean): ExecutionPoint | null => {
    const record = state.records.find(record => same(record.reservation.request, binding.request));
    if (!record || record.source.status !== "verified" || !same(record.relation.source, binding.parent))
      throw new ExecutionError("EXECUTION_UNCONFIRMED");
    if (stopped(state, binding.parent) || stopped(state, binding.child)) throw new ExecutionError("EXECUTION_STOPPING");
    if (record.relation.phase === "unsent" || record.relation.lifecycle === "retired") throw new ExecutionError("EXECUTION_CONFLICT");
    if (record.reservation.target.session_id !== binding.child.launch.session_id
      || (record.reservation.target.expected_launch_id !== null
        && record.reservation.target.expected_launch_id !== binding.child.launch.launch_id))
      throw new ExecutionError("EXECUTION_STALE_GENERATION");
    if (!accepted) return null;
    const target = record.relation.target;
    // before_send is the canonical dispatch boundary, not a later native turn
    // guessed from seat_turns. Its operation may be stronger than the public
    // dispatch receipt, which currently omits that field.
    if (record.operations.send !== "accepted" || !target?.boundary || !binding.child.boundary
      || !same(target.launch, binding.child.launch)
      || target.boundary.event_cursor !== binding.child.boundary.event_cursor
      || target.boundary.steer_id !== null
      || (target.boundary.operation_id !== null && target.boundary.operation_id !== binding.child.boundary.operation_id))
      throw new ExecutionError("EXECUTION_UNCONFIRMED");
    return target;
  };
  return {
    /** Called from the real request-local parent manager before_send callback,
     * after its existing delivery ID exists. Fix parent from the already
     * verified dispatch record; never vendor thread ID or current Bot name.
     */
    async bind(idInput: string, requestInput: ExecutionRequest, childInput: ExecutionPoint, endpointInput: unknown): Promise<Binding> {
      const id = deliveryId.parse(idInput), request = executionRequestSchema.parse(requestInput);
      const child = executionPointSchema.parse(childInput);
      const endpoint = structuredClone(endpointInput), endpoint_digest = digest(endpoint);
      if (!child.boundary) throw new ExecutionError("EXECUTION_INVALID");
      executionBoundarySchema.parse(child.boundary);
      return bindings.store.transaction(async state => {
        const record = state.records.find(record => same(record.reservation.request, request));
        const parent = record?.source.status === "verified" ? record.relation.source : null;
        if (!parent) throw new ExecutionError("EXECUTION_UNCONFIRMED");
        const proposed: Binding = { delivery_id: id, request, parent, child, endpoint_digest };
        original(state, proposed, false);
        await observe(parent); await observe(child);
        verifyEndpoint(parent, endpoint);
        const previous = state.parent_deliveries.find(value => value.delivery_id === id);
        if (previous && !same(previous, proposed)) throw new ExecutionError("EXECUTION_CONFLICT");
        if (!previous) state.parent_deliveries.push(proposed);
        return previous ?? proposed;
      });
    },
    /** submit must call effect() at the actual official queue/hook/wake issue
     * boundary, after preflight. This creates an independent deferred frame;
     * a recovered manager must not reuse an escaped old RPC frame.
     * One official submit is tracked by the existing delivery ID. Subsequent
     * hook/emit/wake acceptance must join that same invocation, not replay it.
     */
    async submit(idInput: string, endpointInput: unknown,
      submit: (binding: Binding, endpoint: unknown, effect: () => void) => Promise<QueueReceipt>) {
      const id = deliveryId.parse(idInput);
      const endpoint = structuredClone(endpointInput), endpoint_digest = digest(endpoint);
      const binding = await bindings.store.transaction(async state => {
        const value = read(state, id);
        if (value.endpoint_digest !== endpoint_digest) throw new ExecutionError("EXECUTION_CONFLICT");
        const canonicalChild = original(state, value, true)!;
        await observe(value.parent); await observe(value.child);
        verifyEndpoint(value.parent, endpoint);
        // Bind the exact immutable receipt point. The before_send operation is
        // corroborating alias evidence, never a different lifetime graph key.
        return { ...value, child: canonicalChild };
      }, { readOnly: true });
      const request = { kind: "delivery", delivery_id: id, target_session_id: binding.parent.launch.session_id } as const;
      await bindings.service.execute({ action: "register", source_session_id: binding.child.launch.session_id,
        reservation: { schema: "aiterm.execution-reservation.v1", request,
          source: binding.child, target: { session_id: binding.parent.launch.session_id,
            expected_launch_id: binding.parent.launch.launch_id } } },
      { schema: "aiterm.execution-source.v1", source: binding.child });
      return runDeferredBoundExecution(bindings.service, {
        [EXECUTION_REQUEST_META_KEY]: { schema: "aiterm.execution-ref.v1", request },
      }, "send", binding.parent.launch.session_id, async () => {
        let issued = false;
        // Bind the frame explicitly: a vendor callback invoked by another
        // process/turn continuation must not borrow that caller's ALS scope.
        const effect = AsyncResource.bind(() => {
          beforeExecutionEffect(binding.parent.launch.session_id, () => {
            if (issued) throw new ExecutionError("EXECUTION_CONFLICT", "possible");
            verifyEndpoint(binding.parent, endpoint);
          });
          issued = true;
        });
        const result = z.object({ queued_submission_id: z.string().min(1).nullable() }).strict()
          .parse(await submit(structuredClone(binding), structuredClone(endpoint), effect));
        if (!issued) throw new ExecutionError("EXECUTION_UNCONFIRMED");
        return { result: { content: [], structuredContent: { ...result } }, target: { launch: binding.parent.launch, boundary: null } };
      });
    },
    async lookup(idInput: string): Promise<Binding> {
      const id = deliveryId.parse(idInput);
      return bindings.store.transaction(state => read(state, id), { readOnly: true });
    },
  };
}
