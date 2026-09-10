// AI clientごとの登録形式をここに閉じ込め、setup共通処理へ漏らさない。
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { resolveAgentBin } from "./agent-resolver.js";
import { SetupError, runSetupCommand, type SetupRun } from "./setup-platform.js";
export { powershellInvocation } from "./setup-platform.js";

export type Registration = { command: string; args: string[]; type?: "stdio" };
export type IntegrationResult = { status: "ready" | "not_detected" | "failed"; reason_code?: string };
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function mergeJsonMcp(file: string, registration: Registration): "configured" | "unchanged" {
  let current: Record<string, unknown> = {};
  let target = file;
  if (existsSync(file)) {
    target = realpathSync(file);
    try { current = JSON.parse(readFileSync(target, "utf8")); }
    catch { throw new SetupError("config_invalid", "既存設定のJSONを読めません"); }
    if (!record(current) || (current.mcpServers !== undefined && !record(current.mcpServers))) {
      throw new SetupError("config_invalid", "既存設定とmcpServersはobjectである必要があります");
    }
  } else {
    try {
      if (lstatSync(file).isSymbolicLink()) throw new SetupError("config_invalid", "設定symlinkの参照先がありません");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const servers = (current.mcpServers ?? {}) as Record<string, unknown>;
  const previous = record(servers.aiterm) ? servers.aiterm : {};
  const updated = { ...previous, ...registration };
  if (isDeepStrictEqual(servers.aiterm, updated)) return "unchanged";
  const next = { ...current, mcpServers: { ...servers, aiterm: updated } };
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.aiterm-${randomUUID()}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    if (existsSync(target)) copyFileSync(target, `${target}.aiterm-backup`);
    renameSync(temporary, target);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  const observed = JSON.parse(readFileSync(target, "utf8"));
  if (!isDeepStrictEqual(observed.mcpServers?.aiterm, updated)) {
    throw new SetupError("config_readback_failed", "aiterm登録の読戻しが一致しません");
  }
  return "configured";
}

export function claudeParentHookEntries(registration: Registration): Record<string, { matcher?: string; hooks: Record<string, unknown>[] }[]> {
  const command = { type: "command", command: registration.command, args: [join(dirname(registration.args[0]), "claude-parent-hook.js")] };
  const matcher = "^mcp__aiterm__(agent_launch|claude_agent|codex_agent|grok_agent|composer_agent|pty_send|claude_turn)$";
  return {
    PreToolUse: [{ matcher, hooks: [{ ...command, timeout: 15 }] }],
    PostToolUse: [{ matcher, hooks: [{ ...command, asyncRewake: true, timeout: 86400 }] }],
    SessionEnd: [{ hooks: [{ ...command, timeout: 15 }] }],
  };
}

export function mergeClaudeParentHooks(file: string, registration: Registration): "configured" | "unchanged" {
  const target = existsSync(file) ? realpathSync(file) : file;
  let current: Record<string, unknown> = {};
  if (existsSync(target)) {
    try { current = JSON.parse(readFileSync(target, "utf8")); }
    catch { throw new SetupError("config_invalid", "Claudeのhook設定JSONを読めません"); }
  }
  if (!record(current) || (current.hooks !== undefined && !record(current.hooks))) {
    throw new SetupError("config_invalid", "Claudeのhooks設定はobjectである必要があります");
  }
  if (current.disableAllHooks === true) throw new SetupError("claude_parent_hooks_disabled", "Claudeのhookが無効です。disableAllHooksをfalseに変更してからsetupしてください");
  const hooks = { ...current.hooks as Record<string, unknown> | undefined };
  for (const [event, additions] of Object.entries(claudeParentHookEntries(registration))) {
    const previous = hooks[event] ?? [];
    if (!Array.isArray(previous) || previous.some(group => !record(group) || !Array.isArray(group.hooks))) {
      throw new SetupError("config_invalid", `Claudeの${event} hook形式を読めません`);
    }
    // 他製品のhookとmatcherはそのまま保ち、当製品の専用entryだけを更新する。
    const retained = previous.map(group => ({ ...group, hooks: (group.hooks as unknown[]).filter(hook => !isClaudeParentHook(hook))
    })).filter(group => group.hooks.length > 0);
    hooks[event] = [...retained, ...additions];
  }
  const next = { ...current, hooks };
  if (isDeepStrictEqual(current, next)) return "unchanged";
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.aiterm-${randomUUID()}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    if (existsSync(target)) copyFileSync(target, `${target}.aiterm-backup`);
    renameSync(temporary, target);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  if (!isDeepStrictEqual(JSON.parse(readFileSync(target, "utf8")), next)) {
    throw new SetupError("config_readback_failed", "Claudeのhook登録の読戻しが一致しません");
  }
  return "configured";
}

function isClaudeParentHook(hook: unknown): boolean {
  return record(hook) && hook.type === "command" && Array.isArray(hook.args)
    && typeof hook.args[0] === "string" && /[/\\]claude-parent-hook\.js$/.test(hook.args[0]);
}

/** hookを持たない旧版へ戻す前に、当製品の登録だけを除く。 */
export function removeClaudeParentHooks(file: string): "removed" | "unchanged" {
  if (!existsSync(file)) return "unchanged";
  const target = realpathSync(file);
  const current = JSON.parse(readFileSync(target, "utf8"));
  if (!record(current) || (current.hooks !== undefined && !record(current.hooks))) {
    throw new SetupError("config_invalid", "Claudeのhook設定を読めません");
  }
  if (current.hooks === undefined) return "unchanged";
  const hooks = { ...current.hooks as Record<string, unknown> | undefined };
  for (const event of ["PreToolUse", "PostToolUse", "SessionEnd"]) {
    if (hooks[event] === undefined) continue;
    if (!Array.isArray(hooks[event])) throw new SetupError("config_invalid", "Claudeのhook設定を読めません");
    hooks[event] = (hooks[event] as unknown[]).map(group => {
      if (!record(group) || !Array.isArray(group.hooks)) throw new SetupError("config_invalid", "Claudeのhook設定を読めません");
      return { ...group, hooks: group.hooks.filter(hook => !isClaudeParentHook(hook)) };
    }).filter(group => group.hooks.length > 0);
  }
  const next = { ...current, hooks };
  if (isDeepStrictEqual(current, next)) return "unchanged";
  const temporary = `${target}.aiterm-${randomUUID()}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    copyFileSync(target, `${target}.aiterm-backup`);
    renameSync(temporary, target);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  if (!isDeepStrictEqual(JSON.parse(readFileSync(target, "utf8")), next)) throw new SetupError("config_readback_failed", "Claude hook解除の読戻しが一致しません");
  return "removed";
}

export function configureIntegrations(home: string, registration: Registration, run: SetupRun = runSetupCommand, resolveClient = resolveAgentBin): Record<string, IntegrationResult> {
  const results: Record<string, IntegrationResult> = {};
  for (const client of ["claude", "codex", "grok", "cursor"] as const) {
    try {
      const executable = resolveClient(client);
      if (!executable && !(client === "cursor" && existsSync(join(home, ".cursor")))) {
        results[client] = { status: "not_detected" };
        continue;
      }
      if (client === "claude" || client === "cursor") {
        const file = client === "cursor" ? join(home, ".cursor", "mcp.json")
          : process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, ".claude.json") : join(home, ".claude.json");
        mergeJsonMcp(file, client === "claude" ? { type: "stdio", ...registration } : registration);
        if (client === "claude") {
          const version = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(run(executable!, ["--version"]));
          if (!version || Number(version[1]) < 2 || (Number(version[1]) === 2 && (Number(version[2]) < 1 || (Number(version[2]) === 1 && Number(version[3]) < 259)))) {
            throw new SetupError("claude_parent_delivery_unavailable", "自動配送にはClaude Code 2.1.259以上が必要です。公式CLIを更新してください");
          }
          mergeClaudeParentHooks(join(process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "settings.json"), registration);
        }
      } else if (client === "codex") {
        // 親threadがないsetupでは公式queue入口まで確認し、宛先は各dispatchで検証する。
        let queueHelp: string;
        try { queueHelp = run(executable!, ["queue", "--help"]); }
        catch { throw new SetupError("codex_parent_delivery_unavailable", "Codexの公式受信キューを使えません。公式CLIを更新してください"); }
        if (!queueHelp.includes("--thread") || !queueHelp.includes("--message")) {
          throw new SetupError("codex_parent_delivery_unavailable", "Codexの公式受信キューを確認できません。公式CLIを更新してください");
        }
        const servers = JSON.parse(run(executable!, ["mcp", "list", "--json"]));
        if (!Array.isArray(servers)) throw new SetupError("config_readback_failed", "CodexのMCP一覧形式を確認できません");
        const existing = servers.find((entry: Record<string, unknown>) => entry.name === "aiterm");
        const envArgs = Object.entries(existing?.transport?.env ?? {}).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
        run(executable!, ["mcp", "add", "aiterm", ...envArgs, "--", registration.command, ...registration.args]);
        const value = JSON.parse(run(executable!, ["mcp", "get", "aiterm", "--json"]));
        if (value.transport?.command !== registration.command || !isDeepStrictEqual(value.transport?.args, registration.args)) {
          throw new SetupError("config_readback_failed", "Codexのaiterm登録が一致しません");
        }
      } else {
        const servers = JSON.parse(run(executable!, ["mcp", "list", "--json"]));
        if (!Array.isArray(servers)) throw new SetupError("config_readback_failed", "GrokのMCP一覧形式を確認できません");
        const existing = servers.find((entry: Record<string, unknown>) => entry.name === "aiterm" && entry.scope === "user");
        const envArgs = Object.entries(existing?.env ?? {}).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
        run(executable!, ["mcp", "add", "--scope", "user", "aiterm", ...envArgs, "--", registration.command, ...registration.args]);
        const value = JSON.parse(run(executable!, ["mcp", "list", "--json"]));
        // 公開CLIのJSON応答を照合する。未知schemaを成功へ丸めない。
        const item = Array.isArray(value) ? value.find((entry: Record<string, unknown>) => entry.name === "aiterm") : null;
        if (!item || item.command !== registration.command || !isDeepStrictEqual(item.args, registration.args)) {
          throw new SetupError("config_readback_failed", "Grokのaiterm登録が一致しません");
        }
      }
      results[client] = { status: "ready" };
    } catch (error) {
      process.stderr.write(`aiterm-setup: ${client}: ${error instanceof Error ? error.message : String(error)}\n`);
      results[client] = { status: "failed", reason_code: error instanceof SetupError ? error.code : "integration_failed" };
    }
  }
  return results;
}
