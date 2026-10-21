// Private same-scope MCP parent producer. No public/index/profile mount. Queue
// aliases lacking current independent native proof remain unsupported.
import path from "node:path";
import type * as steer from "aiterm-steer-delivery";
import { observeAgentDone, observeExecutionNativeCreationScope } from "./core.js";
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

export interface ParentProducerRuntime extends ParentWorkerRuntime {
  sourceEnvironment(): Readonly<Record<string, string | undefined>>;
  decodeParent(client: string, meta: unknown): unknown | null;
  observeDone(session: string, options: { cursor: number; operation_id?: string; steer?: string; timeout: 0 }): Promise<unknown>;
  observeNativeSessions?(): unknown;
}
const localProducerRuntime: ParentProducerRuntime = {
  ...localParentWorkerRuntime,
  sourceEnvironment: () => Object.fromEntries([...EXECUTION_SOURCE_ENV_NAMES, ...EXECUTION_SCOPE_ENV_NAMES].map(name => [name, process.env[name]])),
  decodeParent: (client, meta) => codexParentFromRequest(client, meta)
    ?? claudeParentFromRequest(client, meta, path.join(stateRoot(), "claude-parent-hooks"))
    ?? cursorParentFromRequest(client, { hookRoot: path.join(stateRoot(), "cursor-parent-hooks") }),
  observeDone: observeAgentDone,
  observeNativeSessions: observeExecutionNativeCreationScope,
};
export function createExecutionParentProducer(input: {
  profile: steer.ProductProfile; expectedScope: ExecutionWorkerScope; provider?: SteerProvider;
  runtime?: ParentProducerRuntime; claudeRuntime?: Parameters<typeof steer.submitClaudeParentAnswer>[4];
}) {
  const runtime = input.runtime ?? localProducerRuntime;
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
  const sourceEvidence = createParentSourceEvidence({ decode: (client, meta) => { assertScope(); return runtime.decodeParent(client, meta); },
    observeParentProcess: session => { assertScope(); return runtime.observeParentProcess(session); } });
  const executionRuntime = createExecutionRuntime({ sourceEnvironment,
    observeSession: observe, observeSessionSync: observe,
    ...(typeof runtime.observeNativeSessions === "function" ? { observeNativeSessionsSync: () => {
      assertScope(); return runtime.observeNativeSessions!();
    } } : {}),
    observeDone: (session, options) => { assertScope(); return runtime.observeDone(session, options); } });
  const service = new ExecutionService(store, executionRuntime);
  const parent = createExecutionParentAdapter({ store, service, sourceEvidence, observeSessionGeneration: observe,
    verifyParentEndpoint: createParentQueueEndpointEvidence({ actor, sourceEvidence, claudeHookRoot: path.join(scope.state_root, "claude-parent-hooks") }) });
  const native = createParentNativeAdmission({ store, actor, sourceEvidence, observeSessionGenerationSync: observe,
    hookReference: parentHookReference,
    verifyParentEndpoint: createNativeParentEndpointEvidence({ actor, sourceEvidence,
      claudeHookRoot: path.join(scope.state_root, "claude-parent-hooks"), cursorHookRoot: path.join(scope.state_root, "cursor-parent-hooks") }) });
  const execution = createParentManagerExecution({ parent, native, profile, provider: input.provider, claudeRuntime: input.claudeRuntime });
  const worker = { profile: Object.freeze(Object.assign({}, profile, { delivery_admission: createSteerExecutionAdmission(null, native) })),
    store, native, scope: structuredClone(scope), relation_coverage: "incomplete" as const };
  return { execution, parent, native, service, store, scope: structuredClone(scope), worker,
    startup: Object.freeze({ actor: Object.freeze({ ...actor }), sourceEnvironment, assertScope, observeSessionGeneration: observe }),
    relation_coverage: "incomplete" as const };
}
