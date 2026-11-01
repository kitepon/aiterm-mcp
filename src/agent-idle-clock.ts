import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readProcessIdentities, idleClockCommand, signalRuntimeProcess } from "./process-runtime.js";
import { resolveWindowsPowerShell7 } from "./windows-powershell.js";
import { liveNodeExecutable } from "./live-node.js";
import { readAgentIdleClock, readAgentResumeNative, writeAgentIdleClock, type AgentIdleClock } from "./agent-lifecycle.js";
import { ensureStateRoot, type AgentMetadata } from "./agent-shared.js";
import type { IdleCheckResult } from "./agent-idle.js";

// Test fixtures drive the controller explicitly, without arming unattended timers.
export const AGENT_IDLE_ENABLED = !process.env.NODE_TEST_CONTEXT;
const CLI = fileURLToPath(new URL("./agent-idle-cli.js", import.meta.url));
export function idleClockDeadline(result: IdleCheckResult, now: number): number | null {
  if (result.outcome === "hibernated" || result.outcome === "unconfirmed" || ["dead", "missing"].includes(result.reason)) return null;
  return result.due_at !== null && result.due_at > now ? result.due_at : now + 60_000;
}
async function detached(command: { executable: string; args: string[] }): Promise<AgentIdleClock["owner"]> {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("AITERM_AGENT_")) delete env[key];
  if (process.platform === "win32") {
    // PowerShell needs CREATE_NO_WINDOW: DETACHED_PROCESS skips execution, inherited consoles die with the caller.
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const directory = mkdtempSync(join(ensureStateRoot(), "idle-start-")), receipt = join(directory, "owner.json");
    try {
      const script = `$ErrorActionPreference='Stop'; $s=[Diagnostics.ProcessStartInfo]::new(${quote(command.executable)}); $s.UseShellExecute=$false; $s.CreateNoWindow=$true; foreach($a in @(${command.args.map(quote).join(",")})){$s.ArgumentList.Add($a)}; $p=[Diagnostics.Process]::Start($s); try { $owner=[ordered]@{pid=$p.Id;started_identity=$p.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress; [IO.File]::WriteAllText(${quote(receipt)},$owner) } catch { $p.Kill(); throw }`;
      // The sleeper must inherit null handles, not pipes that keep this one-shot launcher waiting.
      const result = spawnSync(resolveWindowsPowerShell7(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64")], { stdio: "ignore", env, windowsHide: true, timeout: 10_000 });
      if (result.error || result.status !== 0) throw new Error("idle_clock_start_failed");
      const owner = JSON.parse(readFileSync(receipt, "utf8"));
      if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 1 || typeof owner.started_identity !== "string"
        || !Number.isFinite(Date.parse(owner.started_identity))) throw new Error("idle_clock_owner_unconfirmed");
      return { pid: owner.pid, started_identity: new Date(owner.started_identity).toISOString() };
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  const child = spawn(command.executable, command.args, { stdio: "ignore", detached: true, env });
  child.unref();
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  const owner = child.pid === undefined ? undefined : readProcessIdentities([child.pid]).find(row => row.pid === child.pid);
  if (!owner?.started_identity) { if (child.exitCode === null) child.kill(); throw new Error("idle_clock_owner_unconfirmed"); }
  return { pid: owner.pid, started_identity: owner.started_identity };
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
  const owner = await detached(idleClockCommand(wakeAt - Date.now(), liveNodeExecutable(), [CLI,
    "--session", meta.aiterm_session, "--launch", meta.launch_id, "--clock", token]));
  try {
    const clock: AgentIdleClock = { schema: "aiterm.agent-idle-clock.v1", launch_id: meta.launch_id,
      token, owner: { pid: owner.pid, started_identity: owner.started_identity }, anchor, wake_at: new Date(wakeAt).toISOString() };
    writeAgentIdleClock(meta, clock);
    return "armed";
  } catch (error) {
    // Only this newly spawned sleeper is ours; an older or uncertain owner is never killed.
    if (readProcessIdentities([owner.pid]).some(row => row.started_identity === owner.started_identity))
      signalRuntimeProcess({ ...owner, process_group_id: null, argv_digest: "" }, "SIGKILL", false);
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
  void detached(idleClockCommand(0, liveNodeExecutable(), [CLI, "--session", session, "--launch", launchId]))
    .catch(() => { process.stderr.write("aiterm: idle_clock_start_failed\n"); });
}
