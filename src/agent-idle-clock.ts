import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readProcessIdentities, idleClockCommand } from "./process-runtime.js";
import { liveNodeExecutable } from "./live-node.js";
import { readAgentIdleClock, readAgentResumeNative, writeAgentIdleClock, type AgentIdleClock } from "./agent-lifecycle.js";
import type { AgentMetadata } from "./agent-shared.js";
import type { IdleCheckResult } from "./agent-idle.js";

// Test fixtures drive the controller explicitly, without arming unattended timers.
export const AGENT_IDLE_ENABLED = !process.env.NODE_TEST_CONTEXT;
const CLI = fileURLToPath(new URL("./agent-idle-cli.js", import.meta.url));
export function idleClockDeadline(result: IdleCheckResult, now: number): number | null {
  if (result.outcome === "hibernated" || result.outcome === "unconfirmed" || ["dead", "missing"].includes(result.reason)) return null;
  return result.due_at !== null && result.due_at > now ? result.due_at : now + 60_000;
}
function detached(command: { executable: string; args: string[] }): ChildProcess {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("AITERM_AGENT_")) delete env[key];
  const child = spawn(command.executable, command.args, { stdio: "ignore", detached: true, windowsHide: true, env });
  child.unref();
  return child;
}
export function isAgentIdleClockOwner(clock: AgentIdleClock): boolean {
  return [process.pid, process.ppid].includes(clock.owner.pid) && readProcessIdentities([clock.owner.pid])
    .some(row => row.started_identity === clock.owner.started_identity);
}
/** Called under the existing seat send lock; the record is not an independent admission. */
export async function armAgentIdleClock(meta: AgentMetadata, anchor: string | null, wakeAt: number,
  replaceToken?: string): Promise<"armed" | "existing" | "superseded"> {
  const previous = readAgentIdleClock(meta);
  if (replaceToken !== undefined && previous?.token !== replaceToken) return "superseded";
  if (replaceToken === undefined && previous && readProcessIdentities([previous.owner.pid])
    .some(row => row.started_identity === previous.owner.started_identity)) return "existing";
  const token = randomBytes(16).toString("hex");
  const child = detached(idleClockCommand(wakeAt - Date.now(), liveNodeExecutable(), [CLI,
    "--session", meta.aiterm_session, "--launch", meta.launch_id, "--clock", token]));
  try {
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    const owner = child.pid === undefined ? undefined : readProcessIdentities([child.pid]).find(row => row.pid === child.pid);
    if (!owner?.started_identity) throw new Error("idle_clock_owner_unconfirmed");
    const clock: AgentIdleClock = { schema: "aiterm.agent-idle-clock.v1", launch_id: meta.launch_id,
      token, owner: { pid: owner.pid, started_identity: owner.started_identity }, anchor, wake_at: new Date(wakeAt).toISOString() };
    writeAgentIdleClock(meta, clock);
    return "armed";
  } catch (error) {
    // Only this newly spawned sleeper is ours; an older or uncertain owner is never killed.
    if (child.exitCode === null) child.kill();
    throw error;
  }
}
export function requestAgentIdleClock(session: string, launchId: string): void {
  if (!AGENT_IDLE_ENABLED) return;
  try {
    if (!readAgentResumeNative({ aiterm_session: session, launch_id: launchId })) return;
    const clock = readAgentIdleClock({ aiterm_session: session, launch_id: launchId });
    if (clock && readProcessIdentities([clock.owner.pid]).some(row => row.started_identity === clock.owner.started_identity)) return;
  } catch { process.stderr.write("aiterm: idle_clock_state_unconfirmed\n"); return; }
  const child = detached(idleClockCommand(0, liveNodeExecutable(), [CLI, "--session", session, "--launch", launchId]));
  child.once("error", () => { process.stderr.write("aiterm: idle_clock_start_failed\n"); });
}
