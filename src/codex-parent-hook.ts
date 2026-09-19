#!/usr/bin/env node
// stdoutはCodexの公式hook出力だけに使う。失敗をStop継続のexit 2に変換しない。
import { runCodexResultHook } from "./codex-parent-hooks.js";
let input = "";
try {
  for await (const chunk of process.stdin) input += chunk;
  await runCodexResultHook(JSON.parse(input), value => new Promise<void>((resolve, reject) => {
    process.stdout.write(JSON.stringify(value) + "\n", error => error ? reject(error) : resolve());
  }), { directory: process.argv[2] });
} catch (error) {
  process.stderr.write(`CODEX_PARENT_HOOK_FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
