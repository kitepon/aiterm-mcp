#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { agentMetadataPath, subagentInstruction, writeJson0600, type AgentMetadata } from "./agent-shared.js";
import { antigravityBinding, antigravityBindingFile, antigravityFinalText, antigravityResultPath } from "./harnesses/antigravity.js";

const payloadSchema = z.object({ conversationId: z.uuid(), workspacePaths: z.array(z.string()), transcriptPath: z.string().min(1),
  executionNum: z.number().int().nonnegative().optional(), fullyIdle: z.boolean().optional(), terminationReason: z.string().optional(), error: z.string().optional() }).loose();

async function main(): Promise<unknown> {
  if (process.env.AITERM_AGENT_KIND !== "antigravity") return {};
  const name = process.env.AITERM_SESSION_ID ?? "", launch = process.env.AITERM_AGENT_LAUNCH_ID ?? "";
  const file = agentMetadataPath(name, launch);
  if (!fs.existsSync(file)) return {};
  const meta: AgentMetadata = JSON.parse(fs.readFileSync(file, "utf8"));
  if (meta.kind !== "antigravity" || meta.aiterm_session !== name || meta.launch_id !== launch) return {};
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (Buffer.byteLength(input) > 1024 * 1024) throw new Error("payload exceeds limit");
  }
  const payload = payloadSchema.parse(JSON.parse(input));
  if (!meta.cwd || !payload.workspacePaths.some(p => path.resolve(p) === path.resolve(meta.cwd!))) return {};
  const event = process.argv[2];
  if (event === "SessionStart") {
    const binding = antigravityBinding(meta);
    if (binding && binding.conversation_id !== payload.conversationId) return {};
    const expectedRoot = path.join(meta.antigravity_home!, "brain", payload.conversationId);
    if (!path.isAbsolute(payload.transcriptPath) || !path.relative(expectedRoot, payload.transcriptPath).startsWith(".system_generated" + path.sep)) return {};
    writeJson0600(antigravityBindingFile(meta), { conversation_id: payload.conversationId, transcript: payload.transcriptPath });
    return { injectSteps: [{ systemMessage: { systemMessage: subagentInstruction(meta) } }] };
  }
  const binding = antigravityBinding(meta);
  if (event !== "Stop" || !binding || binding.conversation_id !== payload.conversationId || binding.transcript !== payload.transcriptPath || payload.fullyIdle !== true) return {};
  if (payload.executionNum === undefined || !payload.terminationReason) throw new Error("Stop has no execution identity");
  const success = payload.terminationReason === "NO_TOOL_CALL" && !payload.error;
  const text = success ? antigravityFinalText(binding.transcript) : "";
  const turn = String(payload.executionNum), resultFile = antigravityResultPath(meta, turn);
  if (fs.existsSync(resultFile)) return {};
  writeJson0600(resultFile, { text, conversation_id: payload.conversationId, execution: payload.executionNum });
  const record = { type: "agent_done", vendor: "antigravity", aiterm_session: name, launch_id: launch,
    vendor_session_id: payload.conversationId, turn_id: turn, operation_id: null,
    reason: payload.terminationReason, done_status: success ? "turn_done" : "turn_error",
    result_digest: createHash("sha256").update(text).digest("hex"), result_bytes: Buffer.byteLength(text), at: new Date().toISOString() };
  fs.appendFileSync(meta.event_file, JSON.stringify(record) + "\n", { mode: 0o600 });
  return {};
}

main().then(output => process.stdout.write(JSON.stringify(output))).catch(() => {
  process.stderr.write("aiterm: Antigravity hook correlation could not be confirmed\n");
  process.stdout.write("{}");
});
