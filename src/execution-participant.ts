// Private composition only. No CLI entry, stdio connection, static profile or
// participant-complete claim. A separate hook process constructs its own worker
// with its own native actor in the same state/multiplexer scope.
import { createAitermServer } from "./index.js";
import { createExecutionParentProducer, type ParentProducerRuntime } from "./execution-parent-producer.js";
import { createExecutionDispatcher } from "./execution-dispatch.js";
import { ExecutionError } from "./execution-wire.js";
import type { ParentDeliveryDependencies } from "./parent-delivery.js";
import { readProcessIdentities } from "./process-runtime.js";

type ProducerOptions = Parameters<typeof createExecutionParentProducer>[0];
type ParentDependencies = Omit<ParentDeliveryDependencies, "submit">;
const functions = ["scope", "actor", "observeParentProcess", "observeSessionGeneration",
  "sourceEnvironment", "decodeParent", "observeDone"] as const;

function snapshotRuntime(input: ParentProducerRuntime): ParentProducerRuntime {
  for (const name of functions) if (typeof input[name] !== "function") throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const optional = ["selectAuthSessionName", "observeAuthSessionGeneration", "observeNativeSessions", "closeExpectedSession", "observeActors", "observeInterruptionSync", "selectInterruptionSync", "interruptKeySync", "observeOriginOwner", "observeCreatedLaunchSync"] as const;
  for (const name of optional) if (input[name] !== undefined && typeof input[name] !== "function")
    throw new ExecutionError("EXECUTION_UNSUPPORTED");
  // Capture function references before construction; later replacement of an
  // ingress options object must not replace an observer or the env supplier.
  return Object.fromEntries([...functions, ...optional.filter(name => input[name] !== undefined)]
    .map(name => [name, input[name]!.bind(input)])) as unknown as ParentProducerRuntime;
}

export function createExecutionParticipant(input: ProducerOptions & { parentDependencies?: ParentDependencies }) {
  if (input.provider && ["submitCodexParentAnswer", "submitClaudeParentAnswer", "submitCursorParentAnswer"]
    .some(name => typeof input.provider![name as keyof typeof input.provider] !== "function"))
    throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const supplied = input.parentDependencies;
  if (input.runtime && (!supplied || ["observe", "answer", "verify", "processes", "exists", "now", "wall"]
    .some(name => typeof supplied[name as keyof ParentDependencies] !== "function")))
    throw new ExecutionError("EXECUTION_UNSUPPORTED");
  if (input.runtime && typeof input.claudeRuntime?.running !== "function" && typeof input.claudeRuntime?.processes !== "function")
    throw new ExecutionError("EXECUTION_UNSUPPORTED");
  // Keep the provider/profile selection and contract separate from mutable
  // caller objects. This never upgrades an installed old provider's contract.
  const provider = input.provider && { ...input.provider,
    DELIVERY_ADMISSION_CONTRACT: structuredClone(input.provider.DELIVERY_ADMISSION_CONTRACT) };
  const profile = { ...input.profile,
    ...(input.profile.hooks ? { hooks: { ...input.profile.hooks } } : {}),
    ...(input.profile.dispatch_tools ? { dispatch_tools: [...input.profile.dispatch_tools] } : {}),
    ...(input.profile.channels ? { channels: { ...input.profile.channels } } : {}) };
  const suppliedClaude = input.claudeRuntime && { ...input.claudeRuntime };
  const claudeRuntime = suppliedClaude && { ...suppliedClaude,
    ...(suppliedClaude.processes ? { processes: () => {
      const rows = suppliedClaude.processes!();
      if (!Array.isArray(rows)) throw new ExecutionError("EXECUTION_UNSUPPORTED");
      return rows;
    } } : {}) };
  const producer = createExecutionParentProducer({ ...input, provider,
    profile, claudeRuntime, expectedScope: structuredClone(input.expectedScope),
    ...(input.runtime ? { runtime: snapshotRuntime(input.runtime) } : {}) });
  const { actor, sourceEnvironment, assertScope, observeSessionGeneration, captureNativeParent } = producer.startup;
  // This factory serves THIS MCP process, never a serialized worker actor.
  if (actor.pid !== process.pid) throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const dependencies = supplied && { ...supplied };
  const processes = dependencies?.processes ?? readProcessIdentities;
  const parentDependencies = { ...dependencies, processes: (pids: number[]) => {
    assertScope();
    const result = processes(pids);
    if (pids.includes(actor.pid)) {
      const own = result.find(value => value.pid === actor.pid);
      if (!own || own.started_identity !== actor.started_identity) throw new ExecutionError("EXECUTION_UNSUPPORTED");
    }
    return result;
  } };
  let dispatcher!: ReturnType<typeof createExecutionDispatcher>;
  const server = createAitermServer({ execution: server => {
    assertScope();
    dispatcher = createExecutionDispatcher({ service: producer.service, nativeIdentity: actor, sourceEnvironment,
      initializedClientName: () => server.server.getClientVersion()?.name, observeSessionGeneration, assertParticipant: assertScope, captureNativeParent,
      ...(producer.startup.selectAuthSessionName ? { selectAuthSessionName: producer.startup.selectAuthSessionName } : {}),
      ...(producer.startup.observeAuthSessionGeneration ? { observeAuthSessionGeneration: producer.startup.observeAuthSessionGeneration } : {}) });
    return { dispatcher, parentExecution: producer.execution, parentDependencies, parentStateRoot: producer.scope.state_root };
  } });
  producer.store.enroll(["mcp"]);
  return { ...producer, server, dispatcher, relation_coverage: "incomplete" as const };
}
