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
  const registration = structuredClone(options.registration), scope = structuredClone(options.expectedScope);
  const parsed = parseNativeExecutionArguments(registration.args.slice(1));
  if (parsed.mode !== "mcp" || JSON.stringify(parsed.expectedScope) !== JSON.stringify(scope)
    || path.resolve(parsed.providerFile) !== path.resolve(options.providerFile)) throw new ExecutionError("EXECUTION_CONFLICT");
  const provider: Provider = options.provider ?? await import(pathToFileURL(options.providerFile).href);
  if ((provider.DELIVERY_ADMISSION_CONTRACT as { native_hook_args?: unknown } | undefined)?.native_hook_args !== true)
    throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const clients = [...new Set(options.clients ?? ["claude", "cursor", "codex"])];
  if (clients.some(client => !["claude", "cursor", "codex"].includes(client))
    || (clients.includes("codex") && (!options.codexBinary || !path.isAbsolute(options.codexBinary))))
    throw new ExecutionError("EXECUTION_INVALID");
  const profile = { ...AITERM_PROFILE, state_root: () => scope.state_root,
    config_root: () => path.join(home, ".config", "aiterm-mcp"), hooks: {
      claude: path.basename(registration.args[0]), cursor: path.basename(registration.args[0]), codex: path.basename(registration.args[0]),
    } };
  // Hook processes may inherit a reduced CLI environment. Set only the two
  // non-secret scope roots before Node loads its native constants; preserve
  // the caller's dynamic source/launch env instead of stamping a setup-time ID.
  const prefix = ["AITERM_STATE_BASE=" + path.dirname(scope.state_root),
    "TMPDIR=" + path.dirname(path.dirname(scope.multiplexer.key)), registration.command, registration.args[0],
    "--execution-interrupt", "--state-root", scope.state_root, "--socket", scope.multiplexer.key,
    "--steer-provider", options.providerFile];
  const hook = (mode: string, extra: string[] = []) => ({ command: "/usr/bin/env", script: prefix[0], args: [...prefix.slice(1), "--mode", mode, ...extra] });
  const quote = (word: string) => "'" + word.replace(/'/g, "'\"'\"'") + "'";
  const command = (mode: string, extra: string[] = []) => ["/usr/bin/env", ...prefix, "--mode", mode, ...extra].map(quote).join(" ");
  const result: Record<string, unknown> = {}, commands: Record<string, string> = {};
  if (clients.includes("claude")) {
    const file = path.join(home, ".claude", "settings.json");
    const removed = provider.removeClaudeParentHooks(AITERM_PROFILE, file);
    result.claude = provider.mergeClaudeParentHooks(profile, file, hook("claude-hook"));
    if (removed === "removed" && result.claude === "unchanged") result.claude = "configured";
    commands.claude = "exec " + command("claude-hook");
  }
  if (clients.includes("cursor")) {
    const file = path.join(home, ".cursor", "hooks.json");
    const removed = provider.removeCursorParentHooks(AITERM_PROFILE, file);
    result.cursor = provider.mergeCursorParentHooks(profile, file, hook("cursor-hook"));
    if (removed === "removed" && result.cursor === "unchanged") result.cursor = "configured";
    commands.cursor = command("cursor-hook");
  }
  if (clients.includes("codex")) {
    const directory = path.join(home, ".config", "aiterm-mcp", "codex-parent-hooks"), codexHome = path.join(home, ".codex");
    const nativeCommand = command("codex-hook", ["--codex-home", codexHome, "--hook-directory", directory]);
    const runtime = { ...options.codexRuntime, directory, codex_home: codexHome, node: registration.command,
      hook: registration.args[0], findBinary: () => options.codexBinary!, hookCommand: () => nativeCommand };
    result.codex = await provider.configureCodexSteer(profile, "enable", runtime);
    commands.codex = nativeCommand;
  }
  return { results: result, commands, registration, relation_scope: "recorded" as const };
}
