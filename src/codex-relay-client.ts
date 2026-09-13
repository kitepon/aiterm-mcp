import { createConnection } from "node:net";
import WebSocket from "ws";
import { CodexDeliveryError } from "./codex-delivery-error.js";
import { verifyRelaySocket } from "./codex-relay-config.js";

export type RelayRequest = (method: string, params: unknown) => Promise<any>;

/** 公式受付へ追加接続する。Desktopへの承認要求や通知には応答しない。 */
export async function withCodexRelay<T>(socketPath: string, action: (request: RelayRequest) => Promise<T>, timeout = 15_000): Promise<T> {
  try { verifyRelaySocket(socketPath); }
  catch (error) {
    if (error instanceof CodexDeliveryError) throw error;
    throw new CodexDeliveryError("CODEX_RELAY_UNAVAILABLE", "公式App Serverのsocketがありません。Codexを再起動してください");
  }
  const socket = new WebSocket("ws://localhost/rpc", {
    createConnection: () => createConnection(socketPath), handshakeTimeout: timeout, perMessageDeflate: false,
  });
  let sequence = 0;
  let failure: string | null = null;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; writing: boolean }>();
  const fail = (message: string) => {
    failure = message;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new CodexDeliveryError("CODEX_RELAY_TRANSPORT_FAILED", message, item.writing)); }
    pending.clear();
  };
  socket.on("error", () => fail("公式App Serverとの通信が失敗しました"));
  socket.on("close", () => fail("公式App Serverとの接続が終了しました"));
  socket.on("message", (data, binary) => {
    let value: any;
    try { if (binary) throw new Error(); value = JSON.parse(data.toString()); }
    catch { fail("公式App ServerのJSON応答を読めません"); return; }
    if (value?.method !== undefined) return;
    const item = pending.get(value?.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(value.id);
    if (value.error) item.reject(new CodexDeliveryError("CODEX_RECEIVER_REJECTED", typeof value.error.message === "string" ? value.error.message : "公式受信口が要求を拒否しました"));
    else if ("result" in value) item.resolve(value.result);
    else item.reject(new CodexDeliveryError("CODEX_RECEIVER_INVALID_RESPONSE", "公式受信口の応答にresultがありません", item.writing));
  });
  const request: RelayRequest = (method, params) => new Promise((resolve, reject) => {
    if (failure || socket.readyState !== WebSocket.OPEN) { reject(new CodexDeliveryError("CODEX_RELAY_UNAVAILABLE", failure ?? "接続が開いていません")); return; }
    const id = ++sequence;
    const writing = method === "turn/start";
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new CodexDeliveryError("CODEX_RECEIVER_TIMEOUT", `${method}の応答を確認できません`, writing));
    }, timeout);
    pending.set(id, { resolve, reject, timer, writing });
    socket.send(JSON.stringify({ id, method, params }), error => { if (error) fail("公式App Serverへの送信に失敗しました"); });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", () => reject(new CodexDeliveryError("CODEX_RELAY_UNAVAILABLE", "公式App Serverへ接続できません")));
      socket.once("close", () => reject(new CodexDeliveryError("CODEX_RELAY_UNAVAILABLE", "公式App Serverが接続を閉じました")));
    });
    await request("initialize", { clientInfo: { name: "aiterm_parent_delivery", version: "1" } });
    socket.send(JSON.stringify({ method: "initialized" }));
    return await action(request);
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    pending.clear();
    socket.terminate();
  }
}

export async function verifyLoadedParent(request: RelayRequest, threadId: string): Promise<void> {
  let cursor: string | null = null;
  do {
    const result = await request("thread/loaded/list", { limit: 100, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(result?.data)) throw new CodexDeliveryError("CODEX_RECEIVER_INVALID_RESPONSE", "実行中taskの一覧を確認できません");
    if (result.data.includes(threadId)) {
      const read = await request("thread/read", { threadId, includeTurns: false });
      if (read?.thread?.id !== threadId) throw new CodexDeliveryError("CODEX_PARENT_UNAVAILABLE", "親taskの識別が一致しません");
      const subagent = read.thread.source?.subAgent;
      if (subagent && typeof subagent === "object" && "thread_spawn" in subagent) {
        throw new CodexDeliveryError("CODEX_PARENT_UNSUPPORTED", "Codexのnative sub-agentは外部processからの直接入力を受け付けません");
      }
      return;
    }
    const next = result.nextCursor ?? null;
    if (next !== null && (typeof next !== "string" || next === cursor)) throw new CodexDeliveryError("CODEX_RECEIVER_INVALID_RESPONSE", "task一覧の続きが不正です");
    cursor = next;
  } while (cursor);
  throw new CodexDeliveryError("CODEX_PARENT_UNAVAILABLE", "同じ公式App Serverに親taskがありません。別processでのresumeやqueueへの退避は行いません");
}
