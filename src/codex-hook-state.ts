// Codexの設定領域にはhook登録だけを置き、配送の所有情報はAitermが保持する。本体はaiterm-steer-delivery。
import * as steer from "aiterm-steer-delivery";
import type { RuntimeProcess } from "aiterm-steer-delivery";
import { AITERM_PROFILE } from "./steer-profile.js";

export type CodexHookConfig = steer.CodexHookConfig;
export const codexHookConfigSchema = steer.codexHookConfigSchema(AITERM_PROFILE);
export const { writeHookJson, codexInputDirectory, hookInputSchema, answerDigest } = steer;
export function codexHookDirectory(): string { return steer.codexHookDirectory(AITERM_PROFILE); }
export function readCodexHookConfig(directory = codexHookDirectory()): CodexHookConfig | null { return steer.readCodexHookConfig(AITERM_PROFILE, directory); }
export function registerCodexHookInput(home: string, thread: string, id: string, text: string, root = codexHookDirectory()): void {
  steer.registerCodexHookInput(home, thread, id, text, root);
}
export function finishCodexHookSubmission(home: string, thread: string, id: string, root: string): void { steer.finishCodexHookSubmission(home, thread, id, root); }
export function codexHookDeliveryState(home: string, thread: string, id: string, root = codexHookDirectory()): "sending" | "unknown" | null {
  return steer.codexHookDeliveryState(home, thread, id, root);
}
export function ownedCodexHooks(response: any, command: string, file: string): any[] { return steer.ownedCodexHooks(AITERM_PROFILE, response, command, file); }
export function assertCodexHooksReady(response: any, command: string, file: string): void { steer.assertCodexHooksReady(AITERM_PROFILE, response, command, file); }
export function assertCodexHookParentCurrent(config: CodexHookConfig, rows?: RuntimeProcess[], pid = process.pid): void {
  steer.assertCodexHookParentCurrent(AITERM_PROFILE, config, rows, pid);
}
