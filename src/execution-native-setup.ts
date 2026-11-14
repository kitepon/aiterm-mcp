// Native entry registration, owned by Aiterm. Writes only the supplied home;
// callers retain approval/deployment responsibility. No Bot/member API exists here.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as steer from "aiterm-steer-delivery";
import { parseNativeExecutionArguments } from "./execution-native-server.js";
import { AITERM_PROFILE } from "./steer-profile.js";
import { ExecutionError } from "./execution-wire.js";
import type { Registration } from "./setup-integrations.js";
import type { ExecutionWorkerScope } from "./execution-parent-worker.js";
import { codexHookCommand } from "./setup-codex-hooks.js";
import { setupNodeExecutable } from "./setup-node.js";

type Provider = Pick<typeof steer, "mergeClaudeParentHooks" | "removeClaudeParentHooks" | "mergeCursorParentHooks"
  | "removeCursorParentHooks" | "configureCodexSteer"> & { DELIVERY_ADMISSION_CONTRACT?: unknown };
export async function configureNativeExecutionHooks(home: string, options: {
  registration: Registration; expectedScope: ExecutionWorkerScope; providerFile: string; codexBinary?: string;
  clients?: readonly ("claude" | "cursor" | "codex")[];
  // Complete setup fakes only. No CLI is run by unit fixtures.
  provider?: Provider; codexRuntime?: Partial<steer.CodexSteerRuntime>;
}) {
  if (process.platform === "win32" || !path.isAbsolute(home) || !path.isAbsolute(options.registration.command)
    || !path.isAbsolute(options.registration.args[0] ?? "") || path.basename(options.registration.args[0]) !== "execution-native-server.js")
    throw new ExecutionError("EXECUTION_INVALID");
  const previousRegistration = structuredClone(options.registration), scope = structuredClone(options.expectedScope);
  const parsed = parseNativeExecutionArguments(previousRegistration.args.slice(1));
  if (parsed.mode !== "mcp" || JSON.stringify(parsed.expectedScope) !== JSON.stringify(scope)
    || path.resolve(parsed.providerFile) !== path.resolve(options.providerFile)) throw new ExecutionError("EXECUTION_CONFLICT");
  const provider: Provider = options.provider ?? await import(pathToFileURL(options.providerFile).href);
  const clients = [...new Set(options.clients ?? ["claude", "cursor", "codex"])];
  if (clients.some(client => !["claude", "cursor", "codex"].includes(client))
    || (clients.includes("codex") && (!options.codexBinary || !path.isAbsolute(options.codexBinary))))
    throw new ExecutionError("EXECUTION_INVALID");
  const dist = path.dirname(previousRegistration.args[0]);
  const registration = { command: previousRegistration.command, args: [path.join(dist, "index.js")] };
  const profile = { ...AITERM_PROFILE, state_root: () => scope.state_root,
    config_root: () => path.join(home, ".config", "aiterm-mcp") };
  const previousProfile = { ...profile, hooks: {
    claude: path.basename(previousRegistration.args[0]), cursor: path.basename(previousRegistration.args[0]), codex: path.basename(previousRegistration.args[0]),
  } };
  const hook = (file: string) => ({ command: registration.command, script: path.join(dist, file) });
  const quote = (word: string) => "'" + word.replace(/'/g, "'\"'\"'") + "'";
  const command = (file: string) => [registration.command, path.join(dist, file)].map(quote).join(" ");
  const result: Record<string, unknown> = {}, commands: Record<string, string> = {};
  if (clients.includes("claude")) {
    const file = path.join(home, ".claude", "settings.json");
    const removed = provider.removeClaudeParentHooks(previousProfile, file);
    result.claude = provider.mergeClaudeParentHooks(profile, file, hook(profile.hooks.claude));
    if (removed === "removed" && result.claude === "unchanged") result.claude = "configured";
    commands.claude = "exec " + command(profile.hooks.claude);
  }
  if (clients.includes("cursor")) {
    const file = path.join(home, ".cursor", "hooks.json");
    const removed = provider.removeCursorParentHooks(previousProfile, file);
    result.cursor = provider.mergeCursorParentHooks(profile, file, hook(profile.hooks.cursor));
    if (removed === "removed" && result.cursor === "unchanged") result.cursor = "configured";
    commands.cursor = command(profile.hooks.cursor);
  }
  if (clients.includes("codex")) {
    const directory = path.join(home, ".config", "aiterm-mcp", "codex-parent-hooks"), codexHome = path.join(home, ".codex");
    const hookFile = path.join(dist, profile.hooks.codex);
    const runtime = { ...options.codexRuntime, directory, codex_home: codexHome, node: registration.command,
      hook: hookFile, findBinary: () => options.codexBinary! };
    result.codex = await provider.configureCodexSteer(profile, "enable", runtime);
    commands.codex = codexHookCommand(registration.command, hookFile, directory);
  }
  return { results: result, commands, registration, relation_scope: "untracked" as const };
}

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
