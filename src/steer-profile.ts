// Aitermがaiterm-steer-deliveryへ渡す製品の識別情報。保存場所・hook入口の名前・案内文は従来のまま。
import * as path from "node:path";
import type { ProductProfile } from "aiterm-steer-delivery";
import { ensureStateRoot } from "./agent-shared.js";
import { relayConfigDirectory } from "./codex-relay-config.js";

export const AITERM_PROFILE: ProductProfile = {
  id: "aiterm",
  display_name: "Aiterm",
  setup_command: "aiterm-setup",
  codex_steer_command: "aiterm-setup --codex-steer enable",
  mcp_server: "aiterm",
  dispatch_tools: ["agent_launch", "claude_agent", "codex_agent", "grok_agent", "pty_send", "claude_turn"],
  state_root: ensureStateRoot,
  config_root: () => path.dirname(relayConfigDirectory()),
  hooks: { codex: "codex-parent-hook.js", claude: "claude-parent-hook.js", cursor: "cursor-parent-hook.js" },
  codex_client_name: "aiterm_parent_delivery",
  codex_hook_schema: "aiterm.codex-parent-hooks.v1",
  backup_suffix: ".aiterm-backup",
};
