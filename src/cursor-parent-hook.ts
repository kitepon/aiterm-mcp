#!/usr/bin/env node
// Cursorが起動する公式hook。MCP stdioとは別processで、差し込み文をstdoutのJSONへ返す。
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import { handleCursorHook } from "./cursor-parent-receiver.js";

async function main(): Promise<void> {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  const result = await handleCursorHook(input.length > 0 ? input : "{}");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const self = fileURLToPath(import.meta.url);
    const a = fs.realpathSync(entry);
    const b = fs.realpathSync(self);
    if (a === b) return true;
    return process.platform === "win32" && a.toLowerCase() === b.toLowerCase();
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "CURSOR_PARENT_HOOK_FAILED"}\n`);
    process.exitCode = 2;
  });
}
