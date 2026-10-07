// Steerの正規導入。公式hookを登録・承認してから、旧中継の起動差し替えを解除する。本体はaiterm-steer-delivery。
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as steer from "aiterm-steer-delivery";
import { readRelayConfig, relayConfigDirectory } from "./codex-relay-config.js";
import { configureCodexSteer as configureLegacyRelay } from "./setup-codex-relay.js";
import { readCodexHookConfig, type CodexHookConfig } from "./codex-hook-state.js";
import { AITERM_PROFILE } from "./steer-profile.js";
import type { CodexSteerAction, CodexSteerResult } from "./codex-relay-setup.js";
export type { CodexSteerAction, CodexSteerResult } from "./codex-relay-setup.js";

export function codexSteerSelected(): boolean { return readCodexHookConfig()?.enabled === true || readRelayConfig()?.enabled === true; }
export const codexHookCommand = steer.codexHookCommand;

export function mergeCodexParentHooks(file: string, command: string | null, previousCommand?: string): boolean {
  return steer.mergeCodexParentHooks(AITERM_PROFILE, file, command, previousCommand);
}

export async function verifyCodexHookRegistration(config: CodexHookConfig, approve: boolean): Promise<void> {
  await steer.verifyCodexHookRegistration(AITERM_PROFILE, config, approve);
}

export async function configureCodexSteer(action: CodexSteerAction = "status", overrides: Partial<steer.CodexSteerRuntime> = {}): Promise<CodexSteerResult> {
  return steer.configureCodexSteer(AITERM_PROFILE, action, {
    hook: fileURLToPath(new URL("./codex-parent-hook.js", import.meta.url)),
    legacy: readRelayConfig, disableLegacy: () => configureLegacyRelay("disable"), verify: verifyCodexHookRegistration,
    ...overrides,
  });
}

export type CodexParentSteerResult = CodexSteerResult & { changed: boolean };

/**
 * aiterm-setupを通らない導入（コンテナの起動時など）が、Codexの親配送のhookを登録する入口（ADR 0098）。
 * - `home`を引数で受け、その下（`.codex`と`.config/aiterm-mcp/codex-parent-hooks`）だけを書く。
 * - 動いているCodexは要らない。Codexの実行ファイルを一時的に起こし、登録の読戻しと承認を公式の口（hooks/list・config/batchWrite）で行う。
 * - 登録済みで、公式の読戻しでも承認済みなら、何も書かない（`changed:false`）。登録が外れていた・commandが変わった時だけ書き直す。
 * - 失敗は投げない。`{status:"failed", reason_code}`で返す（書き換える前の`hooks.json`は`.aiterm-backup`に残る）。
 * 登録より前から動いているCodexは、起き直すまで同じ番への配送を受けられない（`restart_required`）。
 */
export async function ensureCodexParentSteer(home: string, options: {
  codex_home?: string; binary?: string;
  /** 試験が実process境界（processの一覧など）を差し替える。導入からは渡さない。 */
  runtime?: Partial<steer.CodexSteerRuntime>;
} = {}): Promise<CodexParentSteerResult> {
  try {
    if (!path.isAbsolute(home)) throw new steer.SetupError("codex_steer_home_invalid", "homeは絶対pathで指定してください");
    const directory = path.join(home, ".config", "aiterm-mcp", "codex-parent-hooks");
    const codexHome = options.codex_home ?? path.join(home, ".codex");
    const hook = fileURLToPath(new URL("./codex-parent-hook.js", import.meta.url));
    const overrides: Partial<steer.CodexSteerRuntime> = {
      directory, codex_home: codexHome,
      legacy: () => readRelayConfig(relayConfigDirectory(home)),
      verify: (config, approve) => steer.verifyCodexHookRegistration(AITERM_PROFILE, config, approve, directory),
      ...(options.binary ? { findBinary: () => options.binary! } : {}),
      ...options.runtime,
    };
    const previous = readCodexHookConfig(directory);
    const expected = steer.codexHookCommand(steer.setupNodeExecutable(process.execPath), hook, directory);
    if (previous?.enabled && previous.command === expected && path.resolve(previous.codex_home) === path.resolve(codexHome)) {
      // 登録の読戻しが通れば書かない。通らない時（ほかの導入がhooks.jsonを書き直して登録が外れた等）は、下で登録し直す。
      const status = await configureCodexSteer("status", overrides).catch(() => null);
      if (status && (status.status === "ready" || status.status === "restart_required")) return { ...status, changed: false };
    }
    return { ...await configureCodexSteer("enable", overrides), changed: true };
  } catch (error) {
    const value = error as { code?: unknown; delivery_code?: unknown };
    const reason = typeof value?.delivery_code === "string" ? value.delivery_code : typeof value?.code === "string" ? value.code : "codex_steer_setup_failed";
    return { status: "failed", reason_code: reason, changed: false };
  }
}

