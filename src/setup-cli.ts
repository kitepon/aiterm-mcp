#!/usr/bin/env node
import { runSetup } from "./setup.js";
import { removeClaudeParentHooks } from "./setup-integrations.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { configureCodexSteer, type CodexSteerAction } from "./setup-codex-relay.js";
import { readRelayConfig } from "./codex-relay-config.js";

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
  process.stdout.write("使い方: aiterm-setup [--json] [--codex-steer enable|disable|status]\n依存準備、AIへの登録、MCPと端末の実動作確認を行います。対話実行ではAiterm単品かCodex Desktop Steer付きかを選べます。SteerはmacOS対応で、初回はCodexの再起動が必要です。disableは元の起動設定へ戻し、statusは実際の接続を確認します。--jsonは対話せず、Steerの選択を維持します。\n旧版へ戻す前のClaude専用hook解除: --remove-claude-parent-hooks\n");
} else {
  try {
    let action: CodexSteerAction | undefined;
    let json = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--json" && !json) json = true;
      else if (args[i] === "--codex-steer" && !action && ["enable", "disable", "status"].includes(args[i + 1])) action = args[++i] as CodexSteerAction;
      else throw new Error("使い方: aiterm-setup [--json] [--codex-steer enable|disable|status]");
    }
    const onlySteer = action === "disable" || action === "status";
    if (!action && !json && process.stdin.isTTY && process.stderr.isTTY && process.platform === "darwin") {
      const enabled = readRelayConfig()?.enabled ?? false;
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      try {
        const answer = (await prompt.question(`導入方法: 1=Aiterm単品（公式キュー配送）、2=Codex DesktopへSteerと終了後再開を有効化 [${enabled ? "2" : "1"}]: `)).trim();
        if (answer && !["1", "2"].includes(answer)) throw new Error("導入方法は1または2で指定してください");
        action = (answer || (enabled ? "2" : "1")) === "2" ? "enable" : "disable";
      } finally { prompt.close(); }
    }
    const result = onlySteer
      ? { schema: "aiterm.codex-steer-result.v1", ...await configureCodexSteer(action) }
      : await runSetup({ codex_steer: action });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = ["ready", "disabled"].includes(result.status) ? 0 : result.status === "restart_required" ? 3 : 2;
  } catch (error) {
    process.stderr.write(`aiterm-setup: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
