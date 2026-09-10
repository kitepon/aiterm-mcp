#!/usr/bin/env node
import { runSetup } from "./setup.js";
import { removeClaudeParentHooks } from "./setup-integrations.js";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--remove-claude-parent-hooks") {
  try {
    const status = removeClaudeParentHooks(join(process.env.CLAUDE_CONFIG_DIR ?? join(process.env.HOME ?? homedir(), ".claude"), "settings.json"));
    process.stdout.write(`${JSON.stringify({ schema: "aiterm.claude-parent-hooks-remove-result.v1", status })}\n`);
  } catch (error) {
    process.stderr.write(`aiterm-setup: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
} else if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  process.stdout.write("使い方: aiterm-setup [--json | --remove-claude-parent-hooks]\n製品の依存準備、検出したAIへの登録、MCPと端末の実動作確認を行います。結果はJSONで返します。旧版へ戻す前の専用hook解除も、この入口で行います。\n");
} else if (args.length > 1 || (args.length === 1 && args[0] !== "--json")) {
  process.stderr.write("使い方: aiterm-setup [--json]\n");
  process.exitCode = 2;
} else {
  const result = await runSetup();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === "ready" ? 0 : 2;
}
