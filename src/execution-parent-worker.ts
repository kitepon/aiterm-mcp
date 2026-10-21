// Explicit process-local factory for guarded native hooks. Not installed in
// static AITERM_PROFILE or live hook entrypoints. Public steer 0.4.7 is refused.
import path from "node:path";
import * as installedSteer from "aiterm-steer-delivery";
import { stateRoot } from "./agent-shared.js";
import { isWin, SOCK, WIN_NS } from "./tmux-runtime.js";
import { readProcessIdentities } from "./process-runtime.js";
import { observeExecutionParentProcess, observeExecutionSessionGeneration } from "./core.js";
import { executionStoreDirectory } from "./execution-store.js";
import { ParticipantExecutionStore } from "./execution-participant-store.js";
import { createParentSourceEvidence } from "./execution-parent-source.js";
import { createNativeParentEndpointEvidence } from "./execution-parent-endpoint.js";
import { createParentNativeAdmission } from "./execution-parent-native.js";
import { createSteerExecutionAdmission } from "./execution-steer.js";
import { ExecutionError } from "./execution-wire.js";
import { parentHookReference } from "./execution-parent-alias.js";
import { requireExecutionEffectScope } from "./execution-effect.js";

export interface ExecutionWorkerScope {
  state_root: string; multiplexer: { kind: "socket" | "namespace"; key: string };
}
export interface ParentWorkerRuntime {
  scope(): ExecutionWorkerScope;
  actor(): { pid: number; started_identity: string | null } | null;
  // Bounded native process identity read for existing inventory references.
  // Its absence in an injected runtime is unknown, never a local OS fallback.
  observeActors?(pids: number[]): unknown;
  observeParentProcess(session: string): unknown;
  observeSessionGeneration(session: string): unknown;
}
export type ParentAdmissionProvider = { withDeliveryEffect?: unknown; DELIVERY_ADMISSION_CONTRACT?: unknown };
export const localParentWorkerRuntime: ParentWorkerRuntime = {
  scope: () => ({ state_root: stateRoot(), multiplexer: isWin ? { kind: "namespace", key: WIN_NS } : { kind: "socket", key: SOCK } }),
  actor: () => readProcessIdentities([process.pid])[0] ?? null,
  observeActors: readProcessIdentities,
  observeParentProcess: observeExecutionParentProcess, observeSessionGeneration: observeExecutionSessionGeneration,
};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function scope(input: ExecutionWorkerScope): ExecutionWorkerScope {
  if (!input || typeof input.state_root !== "string" || !path.isAbsolute(input.state_root) || !input.multiplexer
    || typeof input.multiplexer.key !== "string" || !input.multiplexer.key
    || !["socket", "namespace"].includes(input.multiplexer.kind)) throw new ExecutionError("EXECUTION_UNSUPPORTED");
  if (input.multiplexer.kind === "socket" && !path.isAbsolute(input.multiplexer.key)) throw new ExecutionError("EXECUTION_UNSUPPORTED");
  // Validate both components using the same canonical store namespace as MCP.
  executionStoreDirectory(input.state_root, input.multiplexer);
  return { state_root: path.resolve(input.state_root), multiplexer: { ...input.multiplexer } };
}
export function createExecutionParentEnvironment(input: {
  profile: installedSteer.ProductProfile; expectedScope: ExecutionWorkerScope;
  provider?: ParentAdmissionProvider;
  // Product-owned native observations. Tests inject a complete synthetic
  // runtime; absent fields never fall back individually into a live runtime.
  runtime?: ParentWorkerRuntime;
}) {
  const provider = (input.provider ?? installedSteer) as ParentAdmissionProvider;
  const assertContract = () => {
    const contract = provider.DELIVERY_ADMISSION_CONTRACT as Record<string, unknown> | undefined;
    if (typeof provider.withDeliveryEffect !== "function" || contract?.schema !== "steer.delivery-admission.v1"
      || contract.native_context !== true || contract.cursor_profile_parameter !== true || contract.serialized_required !== true
      || contract.multi_delivery_emit !== true) throw new ExecutionError("EXECUTION_UNSUPPORTED");
  };
  assertContract();
  const originalRuntime = input.runtime ?? localParentWorkerRuntime, expected = scope(structuredClone(input.expectedScope));
  const profile = Object.assign({}, input.profile);
  const runtime = originalRuntime;
  if (typeof runtime.scope !== "function" || typeof runtime.actor !== "function"
    || typeof runtime.observeParentProcess !== "function" || typeof runtime.observeSessionGeneration !== "function"
    || (runtime.observeActors !== undefined && typeof runtime.observeActors !== "function"))
    throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const observed = runtime.actor();
  if (!observed || !Number.isSafeInteger(observed.pid) || observed.pid < 1 || !observed.started_identity
    || !Number.isFinite(Date.parse(observed.started_identity))) throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const actor = { pid: observed.pid, started_identity: observed.started_identity };
  const assertScope = () => {
    assertContract();
    const productRoot = profile.state_root();
    const currentActor = runtime.actor();
    if (typeof productRoot !== "string" || !path.isAbsolute(productRoot)
      || !same(scope(runtime.scope()), expected) || path.resolve(productRoot) !== expected.state_root
      || currentActor?.pid !== actor.pid || currentActor.started_identity !== actor.started_identity)
      throw new ExecutionError("EXECUTION_UNSUPPORTED");
  };
  assertScope();
  const store = new ParticipantExecutionStore(executionStoreDirectory(expected.state_root, expected.multiplexer), actor, assertScope);
  return { runtime, profile, actor, store, scope: expected, assertScope };
}
export function createExecutionParentWorker(input: {
  profile: installedSteer.ProductProfile; expectedScope: ExecutionWorkerScope;
  provider?: ParentAdmissionProvider; runtime?: ParentWorkerRuntime; codexHome?: string | null;
}) {
  const { runtime, profile, actor, store, scope: expected, assertScope } = createExecutionParentEnvironment(input);
  const sourceEvidence = createParentSourceEvidence({ decode: () => null, // a native worker cannot fabricate new MCP provenance
    observeParentProcess: session => { assertScope(); return runtime.observeParentProcess(session); } });
  const endpoint = createNativeParentEndpointEvidence({ actor, sourceEvidence, codexHome: input.codexHome,
    claudeHookRoot: path.join(expected.state_root, "claude-parent-hooks"), cursorHookRoot: path.join(expected.state_root, "cursor-parent-hooks") });
  const native = createParentNativeAdmission({ store, actor, sourceEvidence,
    hookReference: parentHookReference,
    observeSessionGenerationSync: session => { assertScope(); return runtime.observeSessionGeneration(session); },
    verifyParentEndpoint: endpoint });
  const admission = createSteerExecutionAdmission(null, native);
  store.enroll(["parent_worker"]);
  requireExecutionEffectScope(true);
  // Queue producer is a different role. A missing original MCP/service binding
  // is unsupported, never routed through a new reservation or legacy producer.
  return { profile: Object.assign(profile, { delivery_admission: admission }), store, scope: structuredClone(expected),
    inventory: () => store.inventory(typeof runtime.observeActors === "function" ? pids => { assertScope(); return runtime.observeActors!(pids); } : undefined),
    native, relation_coverage: "incomplete" as const };
}
