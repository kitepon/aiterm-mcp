// Explicit private native SDK/stdio composition. Ordinary index main stays
// unchanged. This entry does not claim interruption confirmation or coverage.
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type * as steer from "aiterm-steer-delivery";
import * as core from "./core.js";
import { interruptKnownSessions, interruptKnownSessionsAndGoals } from "./execution-immediate-stop.js";
import { goalOriginFromHost } from "./agent-goal.js";
import { AITERM_PROFILE } from "./steer-profile.js";
import { ExecutionError } from "./execution-wire.js";
import { createAitermServer } from "./index.js";
import { immediateStopInputSchema, immediateStopResultSchema } from "./execution-immediate-stop.js";
import { parseRuntimeAdoptionConfig, type RuntimeAdoptionConfig } from "./runtime-adoption.js";
import { boundTerminalTarget } from "./remote-terminal.js";
import { callRemoteTool } from "./remote.js";

/** One stop key to a terminal seat, only while it runs a turn (an idle Claude would take C-c as input). */
async function stopTerminalSeat(session: string): Promise<{ session_id: string; status: "sent" | "failed" | "idle"; error?: string }> {
  try {
    const target = boundTerminalTarget(session)!;
    const observed = await callRemoteTool(target, "pty_observe", { session_id: session }, 60_000);
    if ((observed.structuredContent as { state?: string } | undefined)?.state !== "busy") return { session_id: session, status: "idle" };
    const sent = await callRemoteTool(target, "pty_key", { session_id: session, key: "C-c" }, 60_000);
    return sent.isError ? { session_id: session, status: "failed", error: "TERMINAL_STOP_FAILED" } : { session_id: session, status: "sent" };
  } catch (error) {
    return { session_id: session, status: "failed", error: /^([A-Z][A-Z0-9_]+):/.exec(error instanceof Error ? error.message : "")?.[1] ?? "TERMINAL_STOP_FAILED" };
  }
}

/** Ordinary delivery and leaf-first cancel keys have no execution-store
 * registration, participant gate, shared transaction or graph write. */
export function createNativeDeliveryServer(dependencies: {
  children?: () => { parent: string; child: string }[];
  currentLaunchId?: (session: string) => string | null;
  sendKey?: (session: string, expectedLaunchId?: string) => unknown;
  goalOrigin?: NonNullable<Parameters<typeof createAitermServer>[0]>["goalOrigin"];
  pauseGoal?: Parameters<typeof interruptKnownSessionsAndGoals>[1]["pauseGoal"];
  runtimeAdoption?: RuntimeAdoptionConfig;
} = {}) {
  const server = createAitermServer({ goalOrigin: dependencies.goalOrigin, runtimeAdoption: dependencies.runtimeAdoption });
  server.registerTool("agent_stop", {
    description: "指定sessionとその呼出先へ末端から通常の停止キーを送る。sentはキー送信結果であり終了の証明ではない。",
    inputSchema: immediateStopInputSchema.shape,
    outputSchema: immediateStopResultSchema.shape,
  }, async (args, extra) => {
    // Terminal seats (remote-terminal.md T2): same tool and session handle, the key goes over the trusted SSH.
    const ids = args.session_id !== undefined ? [args.session_id] : args.session_ids ?? [];
    const terminal = ids.filter(id => boundTerminalTarget(id));
    if (terminal.length) {
      const local = ids.filter(id => !terminal.includes(id));
      const localTargets = local.length ? (await localStop({ ...args, session_id: undefined, session_ids: local }, extra)).targets : [];
      const targets = [...localTargets, ...await Promise.all(terminal.map(stopTerminalSeat))];
      const statuses = new Set(targets.map(target => target.status));
      const status = statuses.size === 1 ? [...statuses][0] : statuses.has("sent") ? "partial" : statuses.has("failed") ? "failed" : "idle";
      const result = { ...(args.session_id !== undefined ? { session_id: args.session_id } : {}), status, targets };
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
    }
    const result = await localStop(args, extra);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
  });
  async function localStop(args: any, extra?: any) {
    const stop = {
      children: dependencies.children ?? core.agentSessionChildren,
      currentLaunchId: dependencies.currentLaunchId ?? core.interruptionLaunchId,
      sendKey: dependencies.sendKey ?? core.interruptSessionNow,
    };
    const result = args.pause_goals
      ? await interruptKnownSessionsAndGoals(args, { ...stop, pauseGoal: dependencies.pauseGoal ?? core.pauseAgentGoalForStop },
        dependencies.goalOrigin ? dependencies.goalOrigin(extra) : goalOriginFromHost(server.server.getClientVersion()?.name, extra._meta, server.server.getClientCapabilities()))
      : interruptKnownSessions(args, stop);
    return result as { targets: { session_id: string; status: "sent" | "failed" | "idle"; error?: string }[] };
  }
  return server;
}

export type NativeProvider = Pick<typeof steer, "codexParentFromRequest" | "claudeParentFromRequest" | "cursorParentFromRequest"
  | "verifyCodexParent" | "verifyClaudeParent" | "verifyCursorParent">;
export function parseNativeExecutionArguments(args: string[]) {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    "execution-interrupt": { type: "boolean" }, "state-root": { type: "string" },
    socket: { type: "string" }, "steer-provider": { type: "string" },
    mode: { type: "string", default: "mcp" }, "codex-home": { type: "string" }, "hook-directory": { type: "string" },
    // Opt-in lifecycle; argv (not env) so it never leaks into seats/hooks spawned by this MCP.
    "runtime-adoption": { type: "string" }, "runtime-generation": { type: "string" }, "runtime-scope": { type: "string" },
  } });
  if (values["execution-interrupt"] !== true || !values["state-root"] || !values.socket || !values["steer-provider"]
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
async function main() {
  const options = parseNativeExecutionArguments(process.argv.slice(2));
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
let entry = false;
try { entry = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { /* library import */ }
if (entry) main().catch(error => { console.error("aiterm private execution entry:", error instanceof ExecutionError ? error.code : "startup_failed"); process.exitCode = 1; });
