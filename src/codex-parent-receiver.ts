// Codex親の配送は公式queueを使う。旧中継の選択はsetupで移行するまで維持する。
// 公式queueの配送はaiterm-steer-deliveryが持ち、旧中継（relay）だけをAitermに残す。
import * as steer from "aiterm-steer-delivery";
import { CodexDeliveryError } from "./codex-delivery-error.js";
import { readRelayConfig, parentRelaySocket } from "./codex-relay-config.js";
import { withCodexRelay, verifyLoadedParent } from "./codex-relay-client.js";
import { readCodexHookConfig } from "./codex-hook-state.js";
import { AITERM_PROFILE } from "./steer-profile.js";
export { CodexDeliveryError };

export type CodexParent = steer.CodexParent;
export const codexParentFromRequest = steer.codexParentFromRequest;

// testは実process境界をfixtureへ差し替える。MCPの公開パラメータには出さない。
export interface CodexReceiverRuntime extends steer.CodexReceiverRuntime {
  socket_path?: string;
}

function relaySocket(runtime?: CodexReceiverRuntime): string | null {
  if (runtime) return runtime.socket_path ?? null;
  if (readCodexHookConfig()?.enabled) return null;
  const config = readRelayConfig();
  return config?.enabled ? parentRelaySocket(config) : null;
}

export async function withCodexReceiver<T>(
  parent: CodexParent,
  action: (request: (method: string, params: unknown) => Promise<any>) => Promise<T>,
  runtime: CodexReceiverRuntime = {},
): Promise<T> {
  return steer.withCodexReceiver(AITERM_PROFILE, parent, action, runtime);
}

/** 子へ送る前に、同じstoreの宛先と公式キューの対応を確認する。本文は保存・表示しない。 */
export async function verifyCodexParent(parent: CodexParent, runtime?: CodexReceiverRuntime): Promise<void> {
  const socket = relaySocket(runtime);
  if (socket) {
    await withCodexRelay(socket, request => verifyLoadedParent(request, parent.thread_id), runtime?.timeout_ms);
    return;
  }
  await steer.verifyCodexParent(AITERM_PROFILE, parent, runtime);
}

export interface CodexParentCheck {
  /** 確かめた親thread。旧中継で確かめた時はcwdとsourceを読まない。 */
  thread: steer.CodexParentThread;
  /** enabled＝動いている番へ同じ番で渡せる（hookが登録・承認済みで、親がhookの導入後に起きている。または旧中継）。disabled＝公式キューだけ（番が終わってから届く）。 */
  steer: "enabled" | "disabled";
}

/**
 * 親を確かめ、渡した文が同じ番へ入るかどうかも返す。ほかの製品がAitermへ配送を頼む入口（aiterm-parent-delivery）が使う。
 * 確かめる中身は`verifyCodexParent`と同じ。hookが有効なのに未承認・親が導入前から動いている時は、今までどおり理由つきで断る。
 */
export async function checkCodexParent(parent: CodexParent, runtime?: CodexReceiverRuntime): Promise<CodexParentCheck> {
  const socket = relaySocket(runtime);
  if (socket) {
    await withCodexRelay(socket, request => verifyLoadedParent(request, parent.thread_id), runtime?.timeout_ms);
    return { thread: { thread_id: parent.thread_id, cwd: null, source: null }, steer: "enabled" };
  }
  const thread = await steer.verifyCodexParent(AITERM_PROFILE, parent, runtime);
  const config = runtime ? (runtime.hook_directory ? readCodexHookConfig(runtime.hook_directory) : null) : readCodexHookConfig();
  return { thread, steer: config?.enabled ? "enabled" : "disabled" };
}

export async function submitCodexParentAnswer(
  parent: CodexParent,
  deliveryId: string,
  text: string,
  runtime?: CodexReceiverRuntime,
): Promise<{ queued_submission_id: string | null }> {
  const socket = relaySocket(runtime);
  if (socket) {
    return withCodexRelay(socket, async request => {
      await verifyLoadedParent(request, parent.thread_id);
      // 公式の同一処理内で、実行中はSteer、終了済みなら開始する。本文は一度だけ送る。
      const result = await request("turn/start", { threadId: parent.thread_id,
        input: [{ type: "text", text, text_elements: [] }], clientUserMessageId: deliveryId });
      if (typeof result?.turn?.id !== "string" || !result.turn.id) {
        throw new CodexDeliveryError("CODEX_RECEIVER_INVALID_RESPONSE", "配送先turnの受付IDを確認できません", true);
      }
      return { queued_submission_id: null };
    }, runtime?.timeout_ms);
  }
  return steer.submitCodexParentAnswer(AITERM_PROFILE, parent, deliveryId, text, runtime);
}
