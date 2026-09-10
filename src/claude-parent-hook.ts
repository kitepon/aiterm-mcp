#!/usr/bin/env node
// Claude Codeが直接起動する公式hook。MCP stdioとは別processで本文をstderrへ返す。
import { prepareClaudeHookRequest, runClaudeResultHook, closeClaudeParentSession } from "./claude-parent-receiver.js";

async function main(): Promise<void> {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  const event = JSON.parse(input);
  switch (event.hook_event_name) {
    case "PreToolUse": prepareClaudeHookRequest(event); break;
    case "PostToolUse":
      process.exitCode = await runClaudeResultHook(event, text => new Promise<void>((resolve, reject) => {
        process.stderr.write(text, error => error ? reject(error) : resolve());
      }));
      break;
    case "SessionEnd": closeClaudeParentSession(event); break;
    default: throw new Error("CLAUDE_PARENT_HOOK_EVENT_INVALID: 未対応のhookです");
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "CLAUDE_PARENT_HOOK_FAILED"}\n`);
  process.exitCode = 2;
});
