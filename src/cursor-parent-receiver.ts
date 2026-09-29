// Cursor親の受信口。会話への差し込みはCursor公式hookのadditional_context、idle時の起床は受け口processが担う。
// 本体はaiterm-steer-delivery。
import * as path from "node:path";
import { z } from "zod";
import * as steer from "aiterm-steer-delivery";
import { ensureStateRoot, stateRootCandidates } from "./agent-shared.js";
import { AITERM_PROFILE } from "./steer-profile.js";

// 配送記録の検証はAitermのzodで行う（パッケージのschemaと同じ形）。
export const cursorParentSchema = z.object({ kind: z.literal("cursor"), hook_root: z.string() }).strict();
export type CursorParent = steer.CursorParent;
export const CursorDeliveryError = steer.CursorDeliveryError;
export type CursorDeliveryError = steer.CursorDeliveryError;
export type CursorReceiveResult = steer.CursorReceiveResult;
export const { isCursorMcpClient, cursorHooksFile, prepareCursorDelivery, submitCursorParentAnswer, receiveCursorAnswer } = steer;

export function cursorHookRoot(state = ensureStateRoot()): string {
  return path.join(state, "cursor-parent-hooks");
}
/** hookと受信processが配送記録を探す置き場（先頭はこのprocessのもの）。理由は stateRootCandidates。 */
export function cursorHookRoots(): string[] {
  return stateRootCandidates().map(state => cursorHookRoot(state));
}
export function cursorParentHooksRegistered(document: unknown): boolean { return steer.cursorParentHooksRegistered(AITERM_PROFILE, document); }
export function verifyCursorParent(parent: CursorParent, hooksFile = cursorHooksFile()): void { steer.verifyCursorParent(AITERM_PROFILE, parent, hooksFile); }
export function cursorParentFromRequest(
  clientName: string | undefined,
  options: { hookRoot?: string; hooksFile?: string } = {},
): CursorParent | null {
  if (!isCursorMcpClient(clientName)) return null;
  return steer.cursorParentFromRequest(AITERM_PROFILE, clientName, { hookRoot: options.hookRoot ?? cursorHookRoot(), hooksFile: options.hooksFile });
}
export function handleCursorHook(raw: string, hookRoot = cursorHookRoot()): Promise<Record<string, unknown>> {
  return steer.handleCursorHook(AITERM_PROFILE, raw, hookRoot);
}
