// Explicit private native SDK/stdio composition. Ordinary index main stays
// unchanged. This entry does not claim interruption confirmation or coverage.
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type * as steer from "aiterm-steer-delivery";
import * as core from "./core.js";
import { localParentWorkerRuntime, createExecutionParentWorker, type ParentWorkerRuntime } from "./execution-parent-worker.js";
import type { ParentProducerRuntime } from "./execution-parent-producer.js";
import { createExecutionParticipant } from "./execution-participant.js";
import { registerExecutionTools } from "./execution-tools.js";
import { AITERM_PROFILE } from "./steer-profile.js";
import { EXECUTION_SOURCE_ENV_NAMES, EXECUTION_SCOPE_ENV_NAMES } from "./execution-runtime.js";
import { observeExecutionActor } from "./process-runtime.js";
import { ExecutionError } from "./execution-wire.js";

type ParticipantOptions = Parameters<typeof createExecutionParticipant>[0];
export type NativeProvider = NonNullable<ParticipantOptions["provider"]> & Pick<typeof steer,
  "codexParentFromRequest" | "claudeParentFromRequest" | "cursorParentFromRequest"
  | "verifyCodexParent" | "verifyClaudeParent" | "verifyCursorParent">;
export function createNativeExecutionServer(input: {
  interruptCurrentRun: true; expectedScope: ParticipantOptions["expectedScope"]; provider: NativeProvider;
  // Complete injected fake runtime only; missing primitives never use live OS.
  runtime?: ParentProducerRuntime; parentDependencies?: ParticipantOptions["parentDependencies"];
  claudeRuntime?: ParticipantOptions["claudeRuntime"];
}) {
  if (input.interruptCurrentRun !== true || !input.expectedScope || !path.isAbsolute(input.expectedScope.state_root)
    || input.expectedScope.multiplexer?.kind !== "socket" || !path.isAbsolute(input.expectedScope.multiplexer.key))
    throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const expectedScope = structuredClone(input.expectedScope), provider = { ...input.provider };
  for (const name of ["codexParentFromRequest", "claudeParentFromRequest", "cursorParentFromRequest",
    "verifyCodexParent", "verifyClaudeParent", "verifyCursorParent"] as const)
    if (typeof provider[name] !== "function") throw new ExecutionError("EXECUTION_UNSUPPORTED");
  if (input.runtime && ["selectInterruptionSync", "observeInterruptionSync", "interruptKeySync"]
    .some(name => typeof input.runtime![name as keyof ParentProducerRuntime] !== "function"))
    throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const profile = { ...AITERM_PROFILE, state_root: () => expectedScope.state_root };
  const runtime: ParentProducerRuntime = input.runtime ?? {
    ...localParentWorkerRuntime,
    sourceEnvironment: () => Object.fromEntries([...EXECUTION_SOURCE_ENV_NAMES, ...EXECUTION_SCOPE_ENV_NAMES].map(name => [name, process.env[name]])),
    decodeParent: (client, meta) => provider.codexParentFromRequest(client, meta)
      ?? provider.claudeParentFromRequest(profile, client, meta, path.join(expectedScope.state_root, "claude-parent-hooks"))
      ?? provider.cursorParentFromRequest(profile, client, { hookRoot: path.join(expectedScope.state_root, "cursor-parent-hooks") }),
    observeDone: core.observeAgentDone,
    observeNativeSessions: core.observeExecutionNativeCreationScope,
    closeExpectedSession: core.closeExpectedAgentSession, // explicit management only, never stop fallback
    observeInterruptionSync: core.observeExpectedAgentRunInterruption,
    selectInterruptionSync: core.selectExpectedAgentRunInterruption,
    interruptKeySync: core.interruptExpectedAgentRun,
    observeOriginOwner: observeExecutionActor,
  };
  // Both native and fake compositions supply every I/O dependency explicitly.
  // An injected runtime never inherits individual native functions.
  const participant = input.runtime
    ? createExecutionParticipant({ profile, expectedScope, provider, runtime,
      parentDependencies: input.parentDependencies, claudeRuntime: input.claudeRuntime })
    : createExecutionParticipant({ profile, expectedScope, provider, runtime,
      parentDependencies: nativeParentDependencies(provider, profile), claudeRuntime: { running: nativeProcessRunning } });
  registerExecutionTools(participant.server, participant.service, { interruptCurrentRun: true });
  return participant;
}

// Existing native functions, not alternate queue/transport implementations.
import { observeAnywhere, answerAnywhere } from "./remote.js";
import { readProcessIdentities } from "./process-runtime.js";
function nativeProcessExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}
function nativeProcessRunning(pid: number, start: string): boolean {
  return readProcessIdentities([pid]).some(row => row.pid === pid && row.started_identity === start);
}
function nativeParentDependencies(provider: NativeProvider, profile: steer.ProductProfile): NonNullable<ParticipantOptions["parentDependencies"]> {
  return { observe: observeAnywhere, answer: answerAnywhere, verify: async parent => {
    if ("kind" in parent && parent.kind === "claude") provider.verifyClaudeParent(profile, parent);
    else if ("kind" in parent && parent.kind === "cursor") provider.verifyCursorParent(profile, parent);
    else await provider.verifyCodexParent(profile, parent as steer.CodexParent);
  },
    processes: readProcessIdentities, exists: nativeProcessExists, now: () => performance.now(), wall: () => Date.now() };
}
export function createNativeExecutionWorker(input: {
  interruptCurrentRun: true; expectedScope: ParticipantOptions["expectedScope"]; provider: NativeProvider;
  runtime?: ParentWorkerRuntime; codexHome?: string;
}) {
  if (input.interruptCurrentRun !== true || !input.expectedScope || !path.isAbsolute(input.expectedScope.state_root)
    || input.expectedScope.multiplexer?.kind !== "socket" || !path.isAbsolute(input.expectedScope.multiplexer.key))
    throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const expectedScope = structuredClone(input.expectedScope), provider = { ...input.provider };
  return createExecutionParentWorker({ expectedScope, provider, runtime: input.runtime,
    profile: { ...AITERM_PROFILE, state_root: () => expectedScope.state_root }, codexHome: input.codexHome });
}
export function parseNativeExecutionArguments(args: string[]) {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    "execution-interrupt": { type: "boolean" }, "state-root": { type: "string" },
    socket: { type: "string" }, "steer-provider": { type: "string" },
    mode: { type: "string", default: "mcp" }, "codex-home": { type: "string" }, "hook-directory": { type: "string" },
  } });
  if (values["execution-interrupt"] !== true || !values["state-root"] || !values.socket || !values["steer-provider"]
    || [values["state-root"], values.socket, values["steer-provider"]].some(value => !path.isAbsolute(value) || /[\r\n\0]/.test(value)))
    throw new ExecutionError("EXECUTION_INVALID");
  if (!["mcp", "claude-hook", "cursor-hook", "codex-hook"].includes(values.mode!)
    || (values.mode === "codex-hook" && (!values["codex-home"] || !values["hook-directory"]))
    || [values["codex-home"], values["hook-directory"]].some(value => value !== undefined && (!path.isAbsolute(value) || /[\r\n\0]/.test(value))))
    throw new ExecutionError("EXECUTION_INVALID");
  return { mode: values.mode!, codexHome: values["codex-home"], hookDirectory: values["hook-directory"], expectedScope: { state_root: values["state-root"], multiplexer: { kind: "socket" as const, key: values.socket } },
    providerFile: values["steer-provider"] };
}
async function main() {
  const options = parseNativeExecutionArguments(process.argv.slice(2));
  const provider = await import(pathToFileURL(options.providerFile).href) as NativeProvider;
  if (options.mode === "mcp") {
    const participant = createNativeExecutionServer({ interruptCurrentRun: true, expectedScope: options.expectedScope, provider });
    await participant.server.connect(new StdioServerTransport());
  } else {
    const method = options.mode === "claude-hook" ? "runClaudeHookMain" : options.mode === "cursor-hook" ? "runCursorHookMain" : "runCodexHookMain";
    const hookProvider = provider as NativeProvider & Pick<typeof steer, "runClaudeHookMain" | "runCursorHookMain" | "runCodexHookMain">;
    if (typeof hookProvider[method] !== "function") throw new ExecutionError("EXECUTION_UNSUPPORTED");
    const worker = createNativeExecutionWorker({ interruptCurrentRun: true, expectedScope: options.expectedScope, provider, codexHome: options.codexHome });
    if (options.mode === "claude-hook") await hookProvider.runClaudeHookMain(worker.profile, path.join(worker.scope.state_root, "claude-parent-hooks"));
    else if (options.mode === "cursor-hook") await hookProvider.runCursorHookMain(worker.profile, path.join(worker.scope.state_root, "cursor-parent-hooks"));
    else await hookProvider.runCodexHookMain(worker.profile, options.hookDirectory);
  }
}
let entry = false;
try { entry = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { /* library import */ }
if (entry) main().catch(error => { console.error("aiterm private execution entry:", error instanceof ExecutionError ? error.code : "startup_failed"); process.exitCode = 1; });
