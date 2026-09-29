// Claude Codeの公式hookを受信口にする。待機processはharnessが所有し、親のturnを止めない。本体はaiterm-steer-delivery。
import * as path from "node:path";
import { z } from "zod";
import * as steer from "aiterm-steer-delivery";
import { ensureStateRoot } from "./agent-shared.js";
import { AITERM_PROFILE } from "./steer-profile.js";

// 配送記録の検証はAitermのzodで行う（パッケージのschemaと同じ形）。
export const claudeParentSchema = z.object({
  kind: z.literal("claude"), request_id: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/), session_id: z.uuid(), hook_root: z.string(),
}).strict();
export type ClaudeParent = steer.ClaudeParent;
export const ClaudeDeliveryError = steer.ClaudeDeliveryError;
export type ClaudeDeliveryError = steer.ClaudeDeliveryError;

function defaultRoot(): string { return path.join(ensureStateRoot(), "claude-parent-hooks"); }

export function prepareClaudeHookRequest(input: unknown, root = defaultRoot()): void { steer.prepareClaudeHookRequest(input, root); }

/** 起動時envのsession IDは/clearで古くなるため、実際のPreToolUseとの相関だけを使う。 */
export function claudeParentFromRequest(clientName: string | undefined, metadata: unknown, root = defaultRoot()): ClaudeParent | null {
  return steer.claudeParentFromRequest(AITERM_PROFILE, clientName, metadata, root);
}
export function verifyClaudeParent(parent: ClaudeParent): void { steer.verifyClaudeParent(AITERM_PROFILE, parent); }
export function bindClaudeParentDelivery(parent: ClaudeParent, deliveryId: string): void { steer.bindClaudeParentDelivery(AITERM_PROFILE, parent, deliveryId); }
/** SessionEndはその時点の依頼だけを終了する。同じ会話をresumeした新規依頼は別requestになる。 */
export function closeClaudeParentSession(input: unknown, root = defaultRoot()): void { steer.closeClaudeParentSession(input, root); }
export function submitClaudeParentAnswer(parent: ClaudeParent, deliveryId: string, text: string): Promise<{ queued_submission_id: null }> {
  return steer.submitClaudeParentAnswer(AITERM_PROFILE, parent, deliveryId, text);
}
export function runClaudeResultHook(input: unknown, emit: (text: string) => void | Promise<void>, root = defaultRoot()): Promise<0 | 2> {
  return steer.runClaudeResultHook(AITERM_PROFILE, input, emit, root);
}
