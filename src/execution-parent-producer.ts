// Private same-scope MCP parent producer. No public/index/profile mount. Queue
// aliases lacking current independent native proof remain unsupported.
import path from "node:path";
import type * as steer from "aiterm-steer-delivery";
import { observeAgentDone, observeExecutionCreatedLaunch, observeExecutionNativeCreationScope, closeExpectedAgentSession } from "./core.js";
import type { ExecutionLaunch, ExecutionPoint } from "./execution-contract.js";
import { codexParentFromRequest } from "./codex-parent-receiver.js";
import { claudeParentFromRequest } from "./claude-parent-receiver.js";
import { cursorParentFromRequest } from "./cursor-parent-receiver.js";
import { stateRoot } from "./agent-shared.js";
import { createExecutionParentEnvironment, localParentWorkerRuntime, type ParentWorkerRuntime, type ExecutionWorkerScope } from "./execution-parent-worker.js";
import { createExecutionRuntime, EXECUTION_SOURCE_ENV_NAMES, EXECUTION_SCOPE_ENV_NAMES } from "./execution-runtime.js";
import { ExecutionService } from "./execution-service.js";
import { createParentSourceEvidence } from "./execution-parent-source.js";
import { createParentQueueEndpointEvidence } from "./execution-parent-queue.js";
import { createExecutionParentAdapter } from "./execution-parent.js";
import { createParentNativeAdmission } from "./execution-parent-native.js";
import { createNativeParentEndpointEvidence } from "./execution-parent-endpoint.js";
import { createParentManagerExecution, type SteerProvider } from "./execution-parent-manager.js";
import { ExecutionError } from "./execution-wire.js";
import { parentHookReference } from "./execution-parent-alias.js";
import { createSteerExecutionAdmission } from "./execution-steer.js";
import { requireExecutionEffectScope } from "./execution-effect.js";
import { observeExecutionActor } from "./process-runtime.js";
import { createClaudeParentRecordDiagnosis } from "./execution-parent-claude-records.js";

export interface ParentProducerRuntime extends ParentWorkerRuntime {
  observeOriginOwner?(pid: number): unknown;
  sourceEnvironment(): Readonly<Record<string, string | undefined>>;
  decodeParent(client: string, meta: unknown): unknown | null;
  observeDone(session: string, options: { cursor: number; operation_id?: string; steer?: string; timeout: 0 }): Promise<unknown>;
  observeNativeSessions?(): unknown;
  observeCreatedLaunchSync?(target: ExecutionLaunch): unknown;
  // Synchronous product primitive only. An injected runtime with no primitive
  // remains unsupported; it must not call the default core by individual fallback.
  closeExpectedSession?(expected: ExecutionLaunch): void;
  observeInterruptionSync?(point: ExecutionPoint): unknown;
  selectInterruptionSync?(expected: ExecutionLaunch, candidates?: readonly ExecutionPoint[]): unknown;
  interruptKeySync?(point: ExecutionPoint): unknown;
}
const localProducerRuntime: ParentProducerRuntime = {
  ...localParentWorkerRuntime,
  observeOriginOwner: observeExecutionActor,
  sourceEnvironment: () => Object.fromEntries([...EXECUTION_SOURCE_ENV_NAMES, ...EXECUTION_SCOPE_ENV_NAMES].map(name => [name, process.env[name]])),
  decodeParent: (client, meta) => codexParentFromRequest(client, meta)
    ?? claudeParentFromRequest(client, meta, path.join(stateRoot(), "claude-parent-hooks"))
    ?? cursorParentFromRequest(client, { hookRoot: path.join(stateRoot(), "cursor-parent-hooks") }),
  observeDone: observeAgentDone,
  observeNativeSessions: observeExecutionNativeCreationScope,
  observeCreatedLaunchSync: observeExecutionCreatedLaunch,
  closeExpectedSession: closeExpectedAgentSession,
};
export function createExecutionParentProducer(input: {
  profile: steer.ProductProfile; expectedScope: ExecutionWorkerScope; provider?: SteerProvider;
  deferEnrollment?: boolean;
  runtime?: ParentProducerRuntime; claudeRuntime?: Parameters<typeof steer.submitClaudeParentAnswer>[4];
}) {
  const runtime = input.runtime ?? localProducerRuntime;
  for (const name of ["observeCreatedLaunchSync", "observeInterruptionSync", "selectInterruptionSync", "interruptKeySync", "observeOriginOwner"] as const)
    if (runtime[name] !== undefined && typeof runtime[name] !== "function") throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const createdLaunch = runtime.observeCreatedLaunchSync?.bind(runtime);
  const interruption = runtime.observeInterruptionSync?.bind(runtime);
  const selectInterruption = runtime.selectInterruptionSync?.bind(runtime), interruptKey = runtime.interruptKeySync?.bind(runtime);
  const observeActors = runtime.observeActors?.bind(runtime);
  const observeOriginOwner = runtime.observeOriginOwner?.bind(runtime);
  if (typeof runtime.sourceEnvironment !== "function" || typeof runtime.decodeParent !== "function" || typeof runtime.observeDone !== "function")
    throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const environment = createExecutionParentEnvironment({ ...input, runtime });
  const { profile, actor, store, scope, assertScope } = environment;
  // One startup read shared with the serving dispatcher. Do not read a mutable
  // runtime/environment again when wiring the second half of this process.
  const originalSource = runtime.sourceEnvironment();
  if (!originalSource || typeof originalSource !== "object" || Array.isArray(originalSource))
    throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const sourceEnvironment = Object.freeze(Object.fromEntries(
    [...EXECUTION_SOURCE_ENV_NAMES, ...EXECUTION_SCOPE_ENV_NAMES].map(name => {
      const value = originalSource?.[name];
      if (value !== undefined && typeof value !== "string") throw new ExecutionError("EXECUTION_UNSUPPORTED");
      return [name, value];
    })) as Readonly<Record<string, string | undefined>>);
  const observe = (session: string) => { assertScope(); return runtime.observeSessionGeneration(session); };
  const sourceEvidence = createParentSourceEvidence({ requireFrozenIngress: true, decode: (client, meta) => { assertScope(); return runtime.decodeParent(client, meta); },
    observeParentProcess: session => { assertScope(); return runtime.observeParentProcess(session); } });
  let service!: ExecutionService;
  const executionRuntime = createExecutionRuntime({ sourceEnvironment,
    ...(interruption ? { observeInterruptionSync: (point: ExecutionPoint) => { assertScope(); return interruption(point); } } : {}),
    ...(selectInterruption ? { selectInterruptionSync: (expected: ExecutionLaunch, candidates?: readonly ExecutionPoint[]) => {
      assertScope(); return selectInterruption(expected, candidates); } } : {}),
    ...(interruptKey ? { interruptKeySync: (point: ExecutionPoint) => { assertScope(); return interruptKey(point); } } : {}),
    observeSession: observe, observeSessionSync: observe,
    ...(createdLaunch ? { observeCreatedLaunchSync: (target: ExecutionLaunch) => {
      assertScope(); return createdLaunch(target);
    } } : {}),
    ...(typeof runtime.observeNativeSessions === "function" ? { observeNativeSessionsSync: () => {
      assertScope(); return runtime.observeNativeSessions!();
    } } : {}),
    observeDone: (session, options) => { assertScope(); return runtime.observeDone(session, options); },
    guardedClose: async expected => {
      if (typeof runtime.closeExpectedSession !== "function") throw new ExecutionError("EXECUTION_UNSUPPORTED");
      assertScope();
      // Await even a malformed injected async implementation so a refusal
      // from its expired synchronous frame remains an observed result.
      await service.withExpectedCloseEffect(expected, () => runtime.closeExpectedSession!(expected));
    } });
  service = new ExecutionService(store, executionRuntime);
  const producerEndpoint = createParentQueueEndpointEvidence({ actor, sourceEvidence, claudeHookRoot: path.join(scope.state_root, "claude-parent-hooks") });
  const parent = createExecutionParentAdapter({ store, service, sourceEvidence, observeSessionGeneration: observe,
    diagnoseClaudeRecords: createClaudeParentRecordDiagnosis({ stateRoot: scope.state_root, assertScope }),
    observeActors: pids => { assertScope(); return observeActors?.([...pids]); },
    verifyParentEndpoint: producerEndpoint });
  const native = createParentNativeAdmission({ store, actor, sourceEvidence, observeSessionGenerationSync: observe,
    hookReference: parentHookReference,
    verifyParentEndpoint: createNativeParentEndpointEvidence({ actor, sourceEvidence,
      claudeHookRoot: path.join(scope.state_root, "claude-parent-hooks"), cursorHookRoot: path.join(scope.state_root, "cursor-parent-hooks") }) });
  const execution = createParentManagerExecution({ parent, native, profile, provider: input.provider, claudeRuntime: input.claudeRuntime,
    ...(observeOriginOwner ? { observeOriginOwner: (pid: number) => { assertScope(); return observeOriginOwner(pid); } } : {}),
    parentFromIngress: () => {
      assertScope();
      const endpoint = sourceEvidence.endpointFromIngress();
      if (endpoint === null) return null;
      const proof = sourceEvidence.capture(endpoint);
      if (proof.endpoint.vendor === "claude") producerEndpoint.verifyIngress(endpoint, proof);
      return endpoint;
    },
    verifyCompanion: (id, endpoint, evidence) => {
      assertScope();
      if (JSON.stringify(sourceEvidence.capture(endpoint)) !== JSON.stringify(evidence)) throw new ExecutionError("EXECUTION_CONFLICT");
      producerEndpoint.verifyCompanion(id, endpoint, evidence);
    } });
  const worker = { profile: Object.freeze(Object.assign({}, profile, { delivery_admission: createSteerExecutionAdmission(null, native) })),
    store, native, scope: structuredClone(scope), relation_coverage: "incomplete" as const };
  store.enroll(["parent_producer", "parent_worker"]);
  requireExecutionEffectScope(true);
  return { execution, parent, native, service, store, scope: structuredClone(scope), worker,
    inventory: () => store.inventory(typeof runtime.observeActors === "function" ? pids => { assertScope(); return runtime.observeActors!(pids); } : undefined),
    startup: Object.freeze({ actor: Object.freeze({ ...actor }), sourceEnvironment, assertScope, observeSessionGeneration: observe,
      captureNativeParent: () => {
        assertScope(); const fixed = sourceEvidence.captureIngress();
        // Codex/Cursor keep only their existing hook provenance here. This
        // does not upgrade their missing current queue endpoint capability.
        if (fixed?.proof.endpoint.vendor === "claude") producerEndpoint.verifyIngress(fixed.endpoint, fixed.proof);
        return fixed;
      } }),
    relation_coverage: "incomplete" as const };
}
