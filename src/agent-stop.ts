// agent_stop (a532b2 stage 5, Tronie's ruling A via Kiro 2026-11-23): the stop key to a session and to what it called, leaf first, as a
// neutral public tool of the default server. Terminal seats (remote-terminal.md T2) take the same call: the key goes over their trusted SSH.
// Input {session_id | session_ids, pause_goals?}; pause_goals needs the user's goal origin (a trusted host, never a tool argument).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as core from "./core.js";
import { goalOriginFromHost } from "./agent-goal.js";
import { immediateStopInputSchema, immediateStopResultSchema, interruptKnownSessions, interruptKnownSessionsAndGoals } from "./execution-immediate-stop.js";
import { boundTerminalTarget } from "./remote-terminal.js";
import { acceptRemote, callRemoteTool } from "./remote.js";
import { remoteInputSchema, type RemoteTarget } from "./remote-contract.js";

/** What the stop reads and does; every piece is injectable for tests and defaults to the real one. */
export interface StopDependencies {
  children?: () => { parent: string; child: string }[];
  currentLaunchId?: (session: string) => string | null;
  sendKey?: (session: string, expectedLaunchId?: string) => unknown;
  pauseGoal?: Parameters<typeof interruptKnownSessionsAndGoals>[1]["pauseGoal"];
}
type Target = { session_id: string; status: "sent" | "failed" | "idle"; error?: string };

/** One stop key to a terminal seat, only while it runs a turn (an idle Claude would take C-c as input). */
async function stopTerminalSeat(session: string, given?: RemoteTarget): Promise<Target> {
  try {
    const target = given ?? boundTerminalTarget(session)!;
    const observed = await callRemoteTool(target, "pty_observe", { session_id: session }, 60_000);
    if ((observed.structuredContent as { state?: string } | undefined)?.state !== "busy") return { session_id: session, status: "idle" };
    const sent = await callRemoteTool(target, "pty_key", { session_id: session, key: "C-c" }, 60_000);
    return sent.isError ? { session_id: session, status: "failed", error: "TERMINAL_STOP_FAILED" } : { session_id: session, status: "sent" };
  } catch (error) {
    return { session_id: session, status: "failed", error: /^([A-Z][A-Z0-9_]+):/.exec(error instanceof Error ? error.message : "")?.[1] ?? "TERMINAL_STOP_FAILED" };
  }
}

export function registerAgentStop(server: McpServer, options: { stop?: StopDependencies; goalOrigin?: (extra: { _meta?: unknown; requestId?: unknown }) => "user" | "automatic" } = {}): void {
  const dependencies = options.stop ?? {};
  async function localStop(args: any, extra?: any) {
    const stop = {
      children: dependencies.children ?? core.agentSessionChildren,
      currentLaunchId: dependencies.currentLaunchId ?? core.interruptionLaunchId,
      sendKey: dependencies.sendKey ?? core.interruptSessionNow,
    };
    const result = args.pause_goals
      ? await interruptKnownSessionsAndGoals(args, { ...stop, pauseGoal: dependencies.pauseGoal ?? core.pauseAgentGoalForStop },
        options.goalOrigin ? options.goalOrigin(extra) : goalOriginFromHost(server.server.getClientVersion()?.name, extra._meta, server.server.getClientCapabilities()))
      : interruptKnownSessions(args, stop);
    return result as { targets: Target[] };
  }
  server.registerTool("agent_stop", {
    description: "指定sessionとその呼出先へ末端から通常の停止キーを送る。sentはキー送信結果であり終了の証明ではない。",
    // remote: every listed id runs on that remote (a seat launched with remote+ssh is not in the terminal session map, R30).
    inputSchema: { ...immediateStopInputSchema.shape, remote: remoteInputSchema.optional() },
    outputSchema: immediateStopResultSchema.shape,
  }, async (args, extra) => {
    const ids = args.session_id !== undefined ? [args.session_id] : args.session_ids ?? [];
    const given = args.remote ? acceptRemote(args.remote) : undefined;
    const terminal = given ? ids : ids.filter(id => boundTerminalTarget(id));
    if (terminal.length) {
      const local = ids.filter(id => !terminal.includes(id));
      const localTargets = local.length ? (await localStop({ ...args, session_id: undefined, session_ids: local }, extra)).targets : [];
      const targets = [...localTargets, ...await Promise.all(terminal.map(id => stopTerminalSeat(id, given)))];
      const statuses = new Set(targets.map(target => target.status));
      const status = statuses.size === 1 ? [...statuses][0] : statuses.has("sent") ? "partial" : statuses.has("failed") ? "failed" : "idle";
      const result = { ...(args.session_id !== undefined ? { session_id: args.session_id } : {}), status, targets };
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
    }
    const result = await localStop(args, extra);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
  });
}
