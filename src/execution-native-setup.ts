// Native entry registration, owned by Aiterm. Writes only the supplied home;
// callers retain approval/deployment responsibility. No Bot/member API exists here.
import path from "node:path";
import { pathToFileURL } from "node:url";
import type * as steer from "aiterm-steer-delivery";
import { parseNativeExecutionArguments } from "./execution-native-server.js";
import { AITERM_PROFILE } from "./steer-profile.js";
import { ExecutionError } from "./execution-wire.js";
import type { Registration } from "./setup-integrations.js";
import type { ExecutionWorkerScope } from "./execution-parent-worker.js";
import { codexHookCommand } from "./setup-codex-hooks.js";

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
