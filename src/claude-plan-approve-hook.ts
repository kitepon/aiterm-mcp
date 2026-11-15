#!/usr/bin/env node
// Claude PermissionRequest hook for ExitPlanMode only (harness-contracts.md "ExitPlanModeの承認").
// The dialog "Ready to code?" would hold the seat's turn until a person picks 1: this answers it as option 1, the seat's own
// bypass mode. Anything that does not match exactly prints nothing and exits 0, so Claude Code keeps asking as before.
const MAX_STDIN_BYTES = 8 * 1024 * 1024;

const AITERM_ENV = ["AITERM_AGENT_KIND", "AITERM_SESSION_ID", "AITERM_AGENT_SESSION_ID", "AITERM_AGENT_LAUNCH_ID"];

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += bytes.length;
    if (total > MAX_STDIN_BYTES) return "";
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function planApproval(payload: unknown, env: NodeJS.ProcessEnv = process.env): object | null {
  const input = payload as { hook_event_name?: unknown; tool_name?: unknown; tool_input?: { plan?: unknown } } | null;
  // Claude Code 2.1.325 ignores a bare "allow" for ExitPlanMode (a tool that needs the user's own answer): the decision
  // must carry updatedInput, the call's own input unchanged (verified on a real seat, a141).
  if (!input || typeof input !== "object" || input.hook_event_name !== "PermissionRequest" || input.tool_name !== "ExitPlanMode"
    || typeof input.tool_input?.plan !== "string" || !AITERM_ENV.some(name => env[name])) return null;
  return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow", updatedInput: input.tool_input,
    updatedPermissions: [{ type: "setMode", mode: "bypassPermissions", destination: "session" }] } } };
}

async function main(): Promise<void> {
  let payload: unknown = null;
  try { payload = JSON.parse(await readStdin()); } catch { /* not JSON: no decision */ }
  const decision = planApproval(payload);
  if (decision) process.stdout.write(JSON.stringify(decision) + "\n");
}

// Run only as the hook entry; importing it (tests) has no effect.
if (process.argv[1] && /claude-plan-approve-hook\.js$/.test(process.argv[1])) await main();
