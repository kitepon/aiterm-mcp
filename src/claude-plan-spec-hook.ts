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
const WAIT_MS = 1500;
// shortcut: a length floor, because the spec is the AI's own words and a tool cannot judge it; raise it if seats pass one-line stubs.
const SPEC_MIN_CHARS = 80;

const AITERM_ENV = ["AITERM_AGENT_KIND", "AITERM_SESSION_ID", "AITERM_AGENT_SESSION_ID", "AITERM_AGENT_LAUNCH_ID"];

const GUIDANCE = "プランモードに入る前に、プランを練りたい内容の詳細な仕様を、あなた自身の言葉で書いてください。"
  + "何を作る・直す・調べるのか、範囲、守る条件、終わりの形を書いたうえで、もう一度 EnterPlanMode を呼んでください。";

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
 * Characters of assistant text written right before the tool_use `toolUseId` in the same assistant message
 * (Claude Code writes one transcript line per content block, all with the same message.id); null while the tool_use is not there yet.
 */
export function specChars(transcript: string, toolUseId: string): number | null {
  const rows: Row[] = [];
  for (const line of transcript.split("\n")) {
    try { rows.push(JSON.parse(line) as Row); } catch { /* a half-written or foreign line */ }
  }
  const at = rows.findIndex(row => blocksOf(row).some(block => block?.type === "tool_use" && block.id === toolUseId));
  if (at < 0) return null;
  const own = blocksOf(rows[at]);
  const blocks = own.slice(0, own.findIndex(block => block?.type === "tool_use" && block.id === toolUseId));
  const messageId = rows[at].message?.id;
  if (typeof messageId === "string") {
    for (let j = at - 1; j >= 0; j -= 1) {
      if (!rows[j].message) continue; // bookkeeping rows (ai-title, attachment...) can sit between the blocks of one message
      if (rows[j].message!.id !== messageId) break;
      blocks.push(...blocksOf(rows[j]));
    }
  }
  const texts = blocks.filter(block => block?.type === "text" && typeof block.text === "string");
  return texts.reduce((sum, block) => sum + (block.text as string).trim().length, 0);
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
  let chars: number | null = null;
  for (let waited = 0; ; waited += timing.pollMs) {
    const tail = readTail(input.transcript_path);
    if (tail === null) return null;
    chars = specChars(tail, input.tool_use_id);
    if (chars !== null || waited >= timing.waitMs) break;
    await sleep(timing.pollMs);
  }
  if (chars !== null && chars >= SPEC_MIN_CHARS) return null;
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
