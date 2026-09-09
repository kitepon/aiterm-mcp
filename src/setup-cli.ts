#!/usr/bin/env node
import { runSetup } from "./setup.js";

const args = process.argv.slice(2);
if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  process.stdout.write("使い方: aiterm-setup [--json]\n製品の依存準備、検出したAIへの登録、MCPと端末の実動作確認を行います。結果はJSONで返します。\n");
} else if (args.length > 1 || (args.length === 1 && args[0] !== "--json")) {
  process.stderr.write("使い方: aiterm-setup [--json]\n");
  process.exitCode = 2;
} else {
  const result = await runSetup();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === "ready" ? 0 : 2;
}
