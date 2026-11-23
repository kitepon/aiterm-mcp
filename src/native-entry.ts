// The native entry of the parent's own Aiterm (generic name, 0.70.109; bellteam-boundary.md "汎用の入口"): the delivery MCP (the default server),
// and the hook modes of the CLIs. execution-native-server.ts is its old name (same code, the old argument list that requires
// --execution-interrupt) until the release that drops it. Ordinary index main stays unchanged.
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type * as steer from "aiterm-steer-delivery";
import { stateRoot } from "./agent-shared.js";
import { isWin, SOCK, WIN_NS } from "./tmux-runtime.js";
import type { StopDependencies } from "./agent-stop.js";
import { AITERM_PROFILE } from "./steer-profile.js";
import { ExecutionError } from "./execution-wire.js";
import { createAitermServer } from "./index.js";
import { parseRuntimeAdoptionConfig, type RuntimeAdoptionConfig } from "./runtime-adoption.js";

/** The delivery server of the parent's own Aiterm: the default server (agent_stop included, 0.70.110); the dependencies are for tests. */
export function createNativeDeliveryServer(dependencies: StopDependencies & {
  goalOrigin?: NonNullable<Parameters<typeof createAitermServer>[0]>["goalOrigin"];
  runtimeAdoption?: RuntimeAdoptionConfig;
} = {}) {
  const { goalOrigin, runtimeAdoption, ...stop } = dependencies;
  return createAitermServer({ goalOrigin, runtimeAdoption, stop });
}

export type NativeProvider = Pick<typeof steer, "codexParentFromRequest" | "claudeParentFromRequest" | "cursorParentFromRequest"
  | "verifyCodexParent" | "verifyClaudeParent" | "verifyCursorParent">;
/** The scope of this machine's Aiterm (state root and multiplexer): what the caller's registration of the entry carries. */
export function localScope(): { state_root: string; multiplexer: { kind: "socket" | "namespace"; key: string } } {
  return { state_root: stateRoot(), multiplexer: isWin ? { kind: "namespace", key: WIN_NS } : { kind: "socket", key: SOCK } };
}

/** `--execution-interrupt` is accepted and ignored: the old entry required it, and one command line may start either entry during the move. */
export function parseNativeEntryArguments(args: string[]) {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    "execution-interrupt": { type: "boolean" }, "state-root": { type: "string" },
    socket: { type: "string" }, "steer-provider": { type: "string" },
    mode: { type: "string", default: "mcp" }, "codex-home": { type: "string" }, "hook-directory": { type: "string" },
    // Opt-in lifecycle; argv (not env) so it never leaks into seats/hooks spawned by this MCP.
    "runtime-adoption": { type: "string" }, "runtime-generation": { type: "string" }, "runtime-scope": { type: "string" },
  } });
  if (!values["state-root"] || !values.socket || !values["steer-provider"]
    || [values["state-root"], values.socket, values["steer-provider"]].some(value => !path.isAbsolute(value) || /[\r\n\0]/.test(value)))
    throw new ExecutionError("EXECUTION_INVALID");
  if (!["mcp", "claude-hook", "cursor-hook", "codex-hook"].includes(values.mode!)
    || (values.mode === "codex-hook" && (!values["codex-home"] || !values["hook-directory"]))
    || [values["codex-home"], values["hook-directory"]].some(value => value !== undefined && (!path.isAbsolute(value) || /[\r\n\0]/.test(value))))
    throw new ExecutionError("EXECUTION_INVALID");
  const lifecycle = ["runtime-adoption", "runtime-generation", "runtime-scope"] as const;
  const lifecycleCount = lifecycle.filter(name => values[name] !== undefined).length;
  if (lifecycleCount && (lifecycleCount !== lifecycle.length || values.mode !== "mcp")) throw new ExecutionError("EXECUTION_INVALID");
  let runtimeAdoption: RuntimeAdoptionConfig | undefined;
  if (lifecycleCount) try {
    runtimeAdoption = parseRuntimeAdoptionConfig({ mode: values["runtime-adoption"], generation: values["runtime-generation"],
      scope: values["runtime-scope"], stateRoot: values["state-root"] });
  } catch { throw new ExecutionError("EXECUTION_INVALID"); }
  return { ...(runtimeAdoption ? { runtimeAdoption } : {}), mode: values.mode!, codexHome: values["codex-home"], hookDirectory: values["hook-directory"], expectedScope: { state_root: values["state-root"], multiplexer: { kind: "socket" as const, key: values.socket } },
    providerFile: values["steer-provider"] };
}
export async function runNativeEntry(options: ReturnType<typeof parseNativeEntryArguments>) {
  if (options.mode === "mcp") {
    await createNativeDeliveryServer({ runtimeAdoption: options.runtimeAdoption }).connect(new StdioServerTransport());
  } else {
    const provider = await import(pathToFileURL(options.providerFile).href) as NativeProvider;
    const method = options.mode === "claude-hook" ? "runClaudeHookMain" : options.mode === "cursor-hook" ? "runCursorHookMain" : "runCodexHookMain";
    const hookProvider = provider as NativeProvider & Pick<typeof steer, "runClaudeHookMain" | "runCursorHookMain" | "runCodexHookMain">;
    if (typeof hookProvider[method] !== "function") throw new ExecutionError("EXECUTION_UNSUPPORTED");
    const profile = { ...AITERM_PROFILE, state_root: () => options.expectedScope.state_root };
    if (options.mode === "claude-hook") await hookProvider.runClaudeHookMain(profile, path.join(options.expectedScope.state_root, "claude-parent-hooks"));
    else if (options.mode === "cursor-hook") await hookProvider.runCursorHookMain(profile, path.join(options.expectedScope.state_root, "cursor-parent-hooks"));
    else await hookProvider.runCodexHookMain(profile, options.hookDirectory);
  }
}
async function main() { await runNativeEntry(parseNativeEntryArguments(process.argv.slice(2))); }
let entry = false;
try { entry = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { /* library import */ }
if (entry) main().catch(error => { console.error("aiterm native entry:", error instanceof ExecutionError ? error.code : "startup_failed"); process.exitCode = 1; });
