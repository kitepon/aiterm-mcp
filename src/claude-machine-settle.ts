// a535: a claude-machine turn whose Stop hook failed (the runtime folder it named was gone) has no agent_done, so every waiter and
// transcript reader waits for a Stop that never comes. The host's own state says the turn is over (result in, its Stop hooks answered,
// idle): run the same hook, from this code, with the stream's result text. docs/architecture/claude-machine-stream.md.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { agentClaudeOperationPath, claudeHookScriptPath } from "./harnesses/claude.js";
import { agentClaudeMachineFilePath, isClaudeMachine, readClaudeMachineState } from "./harnesses/claude-machine.js";
import type { AgentMetadata } from "./agent-shared.js";

export const MACHINE_SETTLE_GRACE_MS = 3000;
const TAIL_BYTES = 4 * 1024 * 1024;

/** The last `result` event's text in the launch's stream, or null. */
function lastStreamResult(meta: AgentMetadata): { text: string; at: number } | null {
  const file = agentClaudeMachineFilePath(meta.aiterm_session, meta.launch_id, "stream");
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, "r");
    let text: string;
    try {
      const start = Math.max(0, size - TAIL_BYTES), buffer = Buffer.alloc(size - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      text = buffer.toString("utf8");
    } finally { fs.closeSync(fd); }
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].startsWith("{") || !lines[i].includes('"type":"result"')) continue;
      try { const event = JSON.parse(lines[i]); if (event?.type === "result" && typeof event.result === "string") return { text: event.result, at: Date.now() }; } catch { /* a cut first line */ }
    }
  } catch { /* no stream */ }
  return null;
}

/** True when it wrote the turn's completion. Only for a seat whose operation marker is still open while the host says idle. */
export function settleMachineTurnWithoutStop(meta: AgentMetadata, hasDone: () => boolean, now = Date.now()): boolean {
  if (!isClaudeMachine(meta) || !meta.vendor_session_id) return false;
  const state = readClaudeMachineState(meta);
  if (!state || state.state !== "idle" || state.exited || state.pending.length > 0 || !state.last_result) return false;
  if (now - Date.parse(state.at) < MACHINE_SETTLE_GRACE_MS) return false;
  let marker: fs.Stats;
  try { marker = fs.lstatSync(agentClaudeOperationPath(meta.aiterm_session, meta.launch_id)); } catch { return false; }
  if (Date.parse(state.last_result.at) < marker.mtimeMs || hasDone()) return false;
  const result = lastStreamResult(meta);
  if (!result) return false;
  const run = spawnSync(process.execPath, [claudeHookScriptPath()], { timeout: 10_000, encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "Stop", session_id: meta.vendor_session_id, last_assistant_message: result.text, stop_hook_active: false }),
    env: { ...process.env, AITERM_AGENT_KIND: "claude", AITERM_SESSION_ID: meta.aiterm_session, AITERM_AGENT_LAUNCH_ID: meta.launch_id } });
  return run.status === 0;
}
