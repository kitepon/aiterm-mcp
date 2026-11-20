// The claude-machine harness (機械Claude, a471, ruling 14): Claude Code run as `claude -p --input-format stream-json --output-format stream-json`
// under claude-machine-host, its output passed through as data. It shares with the claude (TUI) harness only the binary, the login, the session
// files, the hooks and the transcript readers (files, never screens); everything that launches, observes, sends to or stops the seat is here.
// Contract: docs/architecture/claude-machine-stream.md. The claude harness (claude.ts) knows nothing of this module.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AitermError } from "../errors.js";
import { windowsAgentArgv, resolveWinPaneShell } from "../agent-resolver.js";
import { agentsDir, assertSessionName, LAUNCH_ID_RE, shq, type AgentMetadata } from "../agent-shared.js";
import { claudeMachineMarker, type ClaudeMachineStateFile } from "../claude-machine.js";
import { claudeAgentArgv, claudeResumeArgv, hookNodeExecutable } from "./claude.js";

export const CLAUDE_MACHINE_HARNESS = "claude-machine" as const;

/** A seat of this harness: Claude Code's vendor identity (hooks, transcript, completion) with the machine driver. */
export const isClaudeMachine = (meta: Pick<AgentMetadata, "kind" | "claude_harness"> | null | undefined): boolean =>
  meta?.kind === "claude" && meta.claude_harness === CLAUDE_MACHINE_HARNESS;

/** The seat's data files, one set per launch: claude's stdout lines unchanged, the lines Aiterm forwards to its stdin, the host's state. */
export function agentClaudeMachineFilePath(name: string, launchId: string, kind: "stream" | "input" | "state"): string {
  assertSessionName(name);
  if (!LAUNCH_ID_RE.test(launchId)) throw new AitermError(`launch_id が不正です: ${launchId}`, 2);
  return path.join(agentsDir(), `${name}.${launchId}.claude-${kind === "state" ? "machine-state.json" : `${kind}.jsonl`}`);
}

/** The host's state file, or null before it exists or when it cannot be read whole (the host replaces it atomically). */
export function readClaudeMachineState(meta: { aiterm_session: string; launch_id: string }): ClaudeMachineStateFile | null {
  try {
    const value = JSON.parse(fs.readFileSync(agentClaudeMachineFilePath(meta.aiterm_session, meta.launch_id, "state"), "utf8"));
    return value?.schema === "aiterm.claude-machine-state.v1" ? value as ClaudeMachineStateFile : null;
  } catch { return null; }
}

/** The pane runs claude-machine-host, which starts `claude` with the machine flags. The first prompt is a first message, not a positional
 * argument: it goes by a 0600 file the host reads once and deletes. */
export function claudeMachineAgentArgv(bin: string, model: string | null, effort: string | null, prompt: string | null, meta: AgentMetadata): string[] {
  return hostArgv(claudeAgentArgv(bin, model, effort, null, meta), prompt, meta);
}

/** The same for a resume of the saved conversation (`--resume <id>`, no first prompt). */
export function claudeMachineResumeArgv(bin: string, model: string | null, effort: string | null, meta: AgentMetadata): string[] {
  return hostArgv(claudeResumeArgv(bin, model, effort, meta), null, meta);
}

function hostArgv(claudeParts: string[], prompt: string | null, meta: AgentMetadata): string[] {
  const host = fileURLToPath(new URL("../claude-machine-host.js", import.meta.url));
  if (!fs.existsSync(host)) throw new AitermError(`AGENT_MACHINE_UNAVAILABLE: claude-machine-host が見つかりません。npm run build を実行してください: ${host}`, 2);
  let promptFile: string[] = [];
  if (prompt) {
    const file = `${meta.claude_settings}.first-prompt`;
    fs.writeFileSync(file, prompt, { mode: 0o600 });
    promptFile = ["--first-prompt-file", file];
  }
  // Windows: the host spawns claude without a shell, so an npm shim or a script wrapper is resolved here exactly as the TUI launch line does.
  const claude = process.platform === "win32" ? windowsAgentArgv(claudeParts, () => resolveWinPaneShell("bash")) : claudeParts;
  const files = (["stream", "input"] as const).map(kind => agentClaudeMachineFilePath(meta.aiterm_session, meta.launch_id, kind));
  for (const file of files) fs.closeSync(fs.openSync(file, "a", 0o600)); // exist before the host and the first send
  return [hookNodeExecutable(), host, "--stream-file", files[0], "--input-file", files[1],
    "--state-file", agentClaudeMachineFilePath(meta.aiterm_session, meta.launch_id, "state"),
    "--replay-user-messages", ...(meta.fork_of ? ["--deny-questions"] : []), ...promptFile, "--", ...claude];
}

/** The typed launch line: every token after the host's own flags may be a path or text, so quote all that are not flags. */
export function buildClaudeMachineAgentCmd(bin: string, model: string | null, effort: string | null, prompt: string | null, meta: AgentMetadata): string {
  return claudeMachineAgentArgv(bin, model, effort, prompt, meta).map(arg => (/^--?(?:[a-z][a-z-]*)?$/.test(arg) ? arg : shq(arg))).join(" ");
}

/** What Aiterm's observers read of a machine seat: the one-line form of the host's state (claude-machine-stream.ts), not a pane. */
export function claudeMachinePaneObservation(screen: string): import("../agent-shared.js").HarnessPaneObservation | null {
  const machine = claudeMachineMarker(screen);
  if (!machine) return null;
  if (machine.state === "idle") return { state: "idle", reason: "composer_ready" };
  if (machine.state === "busy") return { state: "busy", reason: "turn_running" };
  if (machine.state === "blocked") return { state: "blocked", reason: machine.reason ?? "unknown_dialog" };
  return { state: "unknown", reason: machine.state === "exited" ? "harness_exited" : "machine_starting" };
}

/** -p writes its interrupt row into the transcript only at the next input; the host's last result is the earlier evidence. */
export function claudeMachineInterruptedAfter(meta: { aiterm_session: string; launch_id: string }, sinceMs: number): boolean {
  const end = readClaudeMachineState(meta)?.last_result;
  return typeof end?.terminal_reason === "string" && end.terminal_reason.startsWith("aborted") && Date.parse(end.at) >= sinceMs;
}
