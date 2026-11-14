// Native hook entries, owned by Aiterm. The caller writes the CLI files (bd14); this writes only Aiterm's own codex config.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as steer from "aiterm-steer-delivery";
import { parseNativeExecutionArguments } from "./execution-native-server.js";
import { AITERM_PROFILE } from "./steer-profile.js";
import { ExecutionError } from "./execution-wire.js";
import { setupNodeExecutable } from "./setup-node.js";

/**
 * bd14 (setup-update.md "CLIのhookの項目を返す"): the hooks Aiterm needs, as bellteam.harness-entries.v1, for a caller that is
 * the one writer of the CLI files. The entries are what Steer's own writers put into an empty file (no copy of their shapes);
 * the only file written is Aiterm's codex-parent-hooks/config.json that the Codex hook reads. Codex trust is the caller's.
 */
export async function nativeExecutionHarnessEntries(home: string, options: {
  stateRoot: string; socket: string; providerFile: string; codexBinary?: string;
  clients?: readonly ("claude" | "cursor" | "codex")[]; provider?: typeof steer;
}) {
  const dist = path.dirname(fileURLToPath(import.meta.url));
  const parsed = parseNativeExecutionArguments(["--execution-interrupt", "--state-root", options.stateRoot, "--socket", options.socket,
    "--steer-provider", options.providerFile]);
  const clients = [...new Set(options.clients ?? ["claude", "cursor", "codex"])];
  if (process.platform === "win32" || !path.isAbsolute(home) || parsed.mode !== "mcp"
    || clients.some(client => !["claude", "cursor", "codex"].includes(client))
    || (clients.includes("codex") && (!options.codexBinary || !path.isAbsolute(options.codexBinary))))
    throw new ExecutionError("EXECUTION_INVALID");
  const provider: typeof steer = options.provider ?? await import(pathToFileURL(parsed.providerFile).href);
  const node = setupNodeExecutable();
  const profile = { ...AITERM_PROFILE, state_root: () => parsed.expectedScope.state_root, config_root: () => path.join(home, ".config", "aiterm-mcp") };
  const hook = (file: string) => ({ command: node, script: path.join(dist, file) });
  const hooks: Record<string, Record<string, unknown[]>> = {};
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-harness-entries-"));
  try {
    const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")).hooks as Record<string, unknown[]>;
    if (clients.includes("claude")) {
      provider.mergeClaudeParentHooks(profile, path.join(scratch, "settings.json"), hook(profile.hooks.claude));
      hooks.claude = read(path.join(scratch, "settings.json"));
    }
    if (clients.includes("cursor")) {
      provider.mergeCursorParentHooks(profile, path.join(scratch, "hooks.json"), hook(profile.hooks.cursor));
      hooks.cursor = read(path.join(scratch, "hooks.json"));
    }
    if (clients.includes("codex")) {
      const directory = path.join(home, ".config", "aiterm-mcp", "codex-parent-hooks"), script = path.join(dist, profile.hooks.codex);
      const command = provider.codexHookCommand(node, script, directory);
      hooks.codex = provider.planCodexParentHooks(path.join(scratch, "codex-hooks.json"), command).next.hooks;
      provider.writeHookJson(path.join(directory, "config.json"), provider.codexHookConfigSchema(profile).parse({ schema: profile.codex_hook_schema,
        enabled: true, codex_home: path.join(home, ".codex"), binary: options.codexBinary, command, node, hook: script, stale_processes: [] }));
    }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  const version = (JSON.parse(fs.readFileSync(path.join(dist, "..", "package.json"), "utf8")) as { version: string }).version;
  return { schema: "bellteam.harness-entries.v1" as const, product: "aiterm", version, mcpServers: {}, settings: {},
    owns: { commandIncludes: [profile.hooks.claude, profile.hooks.cursor, profile.hooks.codex, "execution-native-server.js"] }, hooks };
}
