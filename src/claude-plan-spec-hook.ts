#!/usr/bin/env node
// Claude PreToolUse hook for EnterPlanMode only (harness-contracts.md "EnterPlanModeの前に仕様を書かせる").
// EnterPlanMode takes no arguments, so a seat that calls it without having written what it will plan falls into plan mode's
// "ask the user" flow and an unattended seat stalls there. This turns the first such call back, once per prompt, telling the
// AI to write the spec in its own words. Anything unexpected prints nothing and exits 0 (allow).
import * as fs from "node:fs";
import * as path from "node:path";
import { currentUid, runtimeStateBase } from "./state-root.js";

const MAX_STDIN_BYTES = 8 * 1024 * 1024;
const TAIL_BYTES = 512 * 1024;
const POLL_MS = 50;
const WAIT_MS = 600; // rows that are readable at all show up within ~110 ms (measured); waiting longer never helped
// shortcut: a length floor, because the spec is the AI's own words and a tool cannot judge it; raise it if seats pass one-line stubs.
const SPEC_MIN_CHARS = 80;

const AITERM_ENV = ["AITERM_AGENT_KIND", "AITERM_SESSION_ID", "AITERM_AGENT_SESSION_ID", "AITERM_AGENT_LAUNCH_ID"];

const GUIDANCE = "プランモードに入る前に、プランを練りたい内容の詳細な仕様を、あなた自身の言葉で書いてください。"
  + "何を作る・直す・調べるのか、範囲、守る条件、終わりの形を書いたうえで、もう一度 EnterPlanMode を呼んでください。"
  + "（この呼びの直前に書き終えている場合は、書き直さずにもう一度 EnterPlanMode を呼ぶだけで入れます。）";

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

/** The transcript's tail as text (a cut first line is dropped), or null when it cannot be read. */
function readTail(file: string): string | null {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - TAIL_BYTES);
      const buffer = Buffer.alloc(size - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      const text = buffer.toString("utf8");
      return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}

type Block = { type?: unknown; id?: unknown; text?: unknown };
type Row = { message?: { id?: unknown; content?: unknown } };

function blocksOf(row: Row): Block[] {
  return Array.isArray(row.message?.content) ? row.message!.content as Block[] : [];
}

/**
 * What the transcript says about the spec of this EnterPlanMode call: the characters of assistant text written since the last
 * real user prompt up to the call (earlier messages of the same prompt count; text in the call's own message counts up to the
 * tool_use), and whether the call's tool_use row is in the file yet. In the interactive CLI (2.1.325) the rows of the message
 * that holds the call are often not in the file while the hook runs, however long it waits (measured 2026-11-15, up to 2.6 s),
 * so `visible: false` means "not readable", not "nothing written".
 */
export function specEvidence(transcript: string, toolUseId: string): { visible: boolean; chars: number } {
  const rows: (Row & { type?: unknown })[] = [];
  for (const line of transcript.split("\n")) {
    try { rows.push(JSON.parse(line) as Row); } catch { /* a half-written or foreign line */ }
  }
  const isCall = (block: Block) => block?.type === "tool_use" && block.id === toolUseId;
  const at = rows.findIndex(row => blocksOf(row).some(isCall));
  const end = at < 0 ? rows.length : at + 1;
  // A real prompt is a user row that holds text (a tool_result-only user row is the answer to a tool call).
  let prompt = end - 1;
  while (prompt >= 0 && !(rows[prompt].type === "user"
    && (typeof rows[prompt].message?.content === "string" || blocksOf(rows[prompt]).some(block => block?.type === "text")))) prompt -= 1;
  let chars = 0;
  for (let i = prompt + 1; i < end; i += 1) {
    if (rows[i].type !== "assistant") continue;
    const blocks = blocksOf(rows[i]);
    for (const block of i === at ? blocks.slice(0, blocks.findIndex(isCall)) : blocks) {
      if (block?.type === "text" && typeof block.text === "string") chars += block.text.trim().length;
    }
  }
  return { visible: at >= 0, chars };
}

function stateFile(env: NodeJS.ProcessEnv): string | null {
  const seat = env.AITERM_SESSION_ID;
  const launch = env.AITERM_AGENT_LAUNCH_ID;
  if (!seat || !launch) return null;
  return path.join(runtimeStateBase(), `aiterm-mcp-${currentUid()}`, "agents", `${seat}.${launch}.claude-plan-spec`);
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function planSpecDecision(
  payload: unknown,
  env: NodeJS.ProcessEnv = process.env,
  timing: { waitMs: number; pollMs: number } = { waitMs: WAIT_MS, pollMs: POLL_MS },
): Promise<object | null> {
  const input = payload as { hook_event_name?: unknown; tool_name?: unknown; session_id?: unknown; prompt_id?: unknown;
    transcript_path?: unknown; tool_use_id?: unknown } | null;
  if (!input || typeof input !== "object" || input.hook_event_name !== "PreToolUse" || input.tool_name !== "EnterPlanMode"
    || !AITERM_ENV.some(name => env[name])) return null;
  const file = stateFile(env);
  if (!file || typeof input.session_id !== "string" || typeof input.prompt_id !== "string" || typeof input.tool_use_id !== "string"
    || typeof input.transcript_path !== "string" || !path.isAbsolute(input.transcript_path)) return null;
  const key = `${input.session_id}\n${input.prompt_id}`;
  try { if (fs.readFileSync(file, "utf8") === key) return null; } catch { /* nothing recorded yet */ }
  let evidence = { visible: false, chars: 0 };
  for (let waited = 0; ; waited += timing.pollMs) {
    const tail = readTail(input.transcript_path);
    if (tail === null) return null;
    evidence = specEvidence(tail, input.tool_use_id);
    if (evidence.chars >= SPEC_MIN_CHARS || evidence.visible || waited >= timing.waitMs) break;
    await sleep(timing.pollMs);
  }
  if (evidence.chars >= SPEC_MIN_CHARS) return null;
  // Record the turn-back first: if it cannot be recorded the second call could not be let through, so allow instead.
  try { fs.writeFileSync(file, key, { mode: 0o600 }); } catch { return null; }
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: GUIDANCE } };
}

async function main(): Promise<void> {
  let payload: unknown = null;
  try { payload = JSON.parse(await readStdin()); } catch { /* not JSON: no decision */ }
  const decision = await planSpecDecision(payload);
  if (decision) process.stdout.write(JSON.stringify(decision) + "\n");
}

// Run only as the hook entry; importing it (tests) has no effect.
if (process.argv[1] && /claude-plan-spec-hook\.js$/.test(process.argv[1])) await main();
