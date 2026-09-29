// Steerの正規導入。公式hookを登録・承認してから、旧中継の起動差し替えを解除する。本体はaiterm-steer-delivery。
import { fileURLToPath } from "node:url";
import * as steer from "aiterm-steer-delivery";
import { readRelayConfig } from "./codex-relay-config.js";
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
