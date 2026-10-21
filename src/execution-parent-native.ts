// Separate processes join the already accepted parent delivery at their actual
// emit/wake boundary. There is no payload, retry, TTL or new invocation ID.
import { AsyncResource } from "node:async_hooks";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ExecutionStore, ExecutionState } from "./execution-store.js";
import { executionLaunchSchema, type ExecutionPoint } from "./execution-contract.js";
import { ExecutionError, executionErrorResult } from "./execution-wire.js";
import { beforeExecutionEffect, withExecutionEffectScope } from "./execution-effect.js";

type Stage = "dequeue" | "emit" | "wake";
type Binding = ExecutionState["parent_deliveries"][number];
type Actor = ExecutionState["parent_effects"][number]["actor"];
type NativeResult<T> = { value?: T; error?: ReturnType<ExecutionError["receipt"]> };
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const requestFor = (binding: Binding) => ({ kind: "delivery", delivery_id: binding.delivery_id,
  target_session_id: binding.parent.launch.session_id } as const);
function endpointDigest(value: unknown): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, canonical(value)])) : value;
  const serialized = JSON.stringify(canonical(value));
  if (!serialized) throw new ExecutionError("EXECUTION_INVALID");
  return createHash("sha256").update(serialized).digest("hex");
}
export interface ParentNativeBindings {
  store: ExecutionStore;
  actor: Actor | null;
  observeSessionGenerationSync?(session: string): unknown;
  verifyParentEndpoint?(parent: ExecutionPoint, endpoint: unknown, nativeContext?: unknown): boolean;
  // Bounded preflight waiting for the existing queue receipt, never a retry of
  // queue/emit/wake or a graph lifetime/expiry threshold.
  preparationTimeoutMs?: number;
}
export function createParentNativeAdmission(bindings: ParentNativeBindings) {
  const actor = bindings.actor && { ...bindings.actor };
  const read = (state: ExecutionState, id: string, endpoint: unknown): Binding => {
    const binding = state.parent_deliveries.find(value => value.delivery_id === id);
    if (!binding) throw new ExecutionError("EXECUTION_NOT_FOUND");
    if (binding.endpoint_digest !== endpointDigest(endpoint)) throw new ExecutionError("EXECUTION_CONFLICT");
    if (state.stopping.some(launch => same(launch, binding.parent.launch) || same(launch, binding.child.launch)))
      throw new ExecutionError("EXECUTION_STOPPING");
    const record = state.records.find(value => same(value.reservation.request, requestFor(binding)));
    if (record && (record.operations.send === "preparing" || record.operations.send === "issued"))
      throw new ExecutionError("EXECUTION_BUSY");
    if (!record || record.operations.send !== "accepted" || record.relation.phase !== "invoked"
      || record.relation.lifecycle === "retired" || !same(record.relation.target?.launch, binding.parent.launch)
      || !same(record.relation.source?.launch, binding.child.launch)) throw new ExecutionError("EXECUTION_UNCONFIRMED");
    return binding;
  };
  const verify = (binding: Binding, endpoint: unknown, nativeContext?: unknown): void => {
    if (!bindings.observeSessionGenerationSync || !bindings.verifyParentEndpoint) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    const value = bindings.observeSessionGenerationSync(binding.parent.launch.session_id) as Record<string, unknown> | null;
    if (!value || value.schema !== "aiterm.pty-observe-result.v1" || value.session_id !== binding.parent.launch.session_id
      || value.exists !== true) throw new ExecutionError("EXECUTION_UNCONFIRMED");
    const launch = executionLaunchSchema.safeParse({ session_id: value.session_id, launch_id: value.launch_id });
    if (!launch.success) throw new ExecutionError("EXECUTION_UNCONFIRMED");
    if (!same(launch.data, binding.parent.launch) || !bindings.verifyParentEndpoint(binding.parent, endpoint, nativeContext))
      throw new ExecutionError("EXECUTION_STALE_GENERATION");
  };
  return {
    async run<T>(idInput: string | readonly string[], stageInput: Stage, endpointInput: unknown,
      body: (endpoint: unknown, effect: () => void) => Promise<T>, nativeContextInput?: unknown): Promise<NativeResult<T>> {
      let issued = false, finished = false, observed = false, value: T | undefined;
      let id = "", ids: string[] = [], stage: Stage = "emit", binding: Binding | undefined;
      try {
        ids = z.array(z.uuid()).min(1).parse(typeof idInput === "string" ? [idInput] : idInput);
        if (new Set(ids).size !== ids.length) throw new ExecutionError("EXECUTION_INVALID");
        id = ids[0]; stage = z.enum(["dequeue", "emit", "wake"]).parse(stageInput);
        const endpoint = structuredClone(endpointInput);
        const nativeContext = nativeContextInput === undefined ? undefined : structuredClone(nativeContextInput);
        if (!actor || !bindings.store.transactionSync || !bindings.observeSessionGenerationSync || !bindings.verifyParentEndpoint)
          throw new ExecutionError("EXECUTION_UNSUPPORTED");
        const timeout = bindings.preparationTimeoutMs ?? 2000;
        if (!Number.isFinite(timeout) || timeout < 0) throw new ExecutionError("EXECUTION_INVALID");
        const deadline = performance.now() + timeout;
        for (;;) {
          try {
            binding = await bindings.store.transaction(state => {
              const result = read(state, id, endpoint); verify(result, endpoint, nativeContext);
              for (const each of ids.slice(1)) if (!same(read(state, each, endpoint).parent.launch, result.parent.launch))
                throw new ExecutionError("EXECUTION_CONFLICT");
              const prior = state.parent_effects.find(value => ids.includes(value.delivery_id) && value.stage === stage);
              if (prior) throw new ExecutionError(prior.state === "accepted" ? "EXECUTION_CONFLICT" : "EXECUTION_UNCONFIRMED",
                prior.state === "accepted" ? "not_started" : "possible");
              return result;
            }, { readOnly: true });
            break;
          } catch (error) {
            if (!(error instanceof ExecutionError) || error.code !== "EXECUTION_BUSY" || performance.now() >= deadline) throw error;
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
        const request = requestFor(binding), slotStage = `parent_${stage}` as const;
        const issue = () => {
          if (finished || issued) throw new ExecutionError("EXECUTION_CONFLICT", issued ? "possible" : "not_started");
          bindings.store.transactionSync!(state => {
            const fresh = read(state, id, endpoint); verify(fresh, endpoint, nativeContext);
            for (const each of ids.slice(1)) if (!same(read(state, each, endpoint).parent.launch, fresh.parent.launch))
              throw new ExecutionError("EXECUTION_CONFLICT");
            if (state.parent_effects.some(value => ids.includes(value.delivery_id) && value.stage === stage))
              throw new ExecutionError("EXECUTION_CONFLICT");
            if (state.slots.some(value => value.session_id === fresh.parent.launch.session_id))
              throw new ExecutionError("EXECUTION_UNCONFIRMED");
            for (const each of ids) state.parent_effects.push({ delivery_id: each, stage, state: "issued", actor });
            state.slots.push({ session_id: fresh.parent.launch.session_id, expected_launch_id: fresh.parent.launch.launch_id,
              stage: slotStage, state: "issued", request, source: fresh.child.launch,
              sources: [...new Map(ids.map(each => { const child = read(state, each, endpoint).child.launch;
                return [JSON.stringify(child), child] as const; })).values()] });
          });
          issued = true;
        };
        value = await withExecutionEffectScope(binding.parent.launch.session_id, issue, () => {
          const effect = AsyncResource.bind(() => beforeExecutionEffect(binding!.parent.launch.session_id));
          return body(structuredClone(endpoint), effect);
        });
        finished = true;
        if (!issued) throw new ExecutionError("EXECUTION_UNCONFIRMED");
        observed = true; // only a clean frame provides a genuine native receipt
        await bindings.store.transaction(state => {
          const leases = state.parent_effects.filter(value => ids.includes(value.delivery_id) && value.stage === stage);
          const slot = state.slots.find(value => value.stage === slotStage && same(value.request, request));
          if (leases.length !== ids.length || leases.some(lease => lease.state !== "issued" || !same(lease.actor, actor)) || !slot || slot.state !== "issued")
            throw new ExecutionError("EXECUTION_UNCONFIRMED", "possible");
          // A stop may already have fenced this launch while draining us. That
          // does not erase its genuine effect receipt; generation still matches.
          verify(binding!, endpoint, nativeContext);
          for (const lease of leases) lease.state = "accepted";
          state.slots = state.slots.filter(value => value !== slot);
        });
        return { value };
      } catch (error) {
        finished = true;
        if (issued) {
          try {
            await bindings.store.transaction(state => {
              for (const lease of state.parent_effects) if (ids.includes(lease.delivery_id) && lease.stage === stage && same(lease.actor, actor)) lease.state = "unknown";
              for (const slot of state.slots) if (binding && same(slot.request, requestFor(binding))
                && slot.stage === `parent_${stage}`) slot.state = "unknown";
            });
          } catch { /* existing issued state remains unconfirmed */ }
        }
        const failure = error instanceof ExecutionError ? error : new ExecutionError("EXECUTION_UNCONFIRMED");
        const receipt = executionErrorResult(new ExecutionError(failure.code, issued || failure.effect === "possible" ? "possible" : "not_started"));
        return { ...(observed ? { value } : {}), error: receipt._meta["aiterm/execution_error"] as ReturnType<ExecutionError["receipt"]> };
      }
    },
  };
}
