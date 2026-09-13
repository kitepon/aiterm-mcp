// Codex親の配送。Steerを選択した環境は同じ公式App Server、それ以外は公式queueを使う。
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import * as path from "node:path";
import { resolveAgentBin } from "./agent-resolver.js";
import { realCodexHome } from "./harnesses/codex.js";
import { CodexDeliveryError } from "./codex-delivery-error.js";
import { readRelayConfig, parentRelaySocket } from "./codex-relay-config.js";
import { withCodexRelay, verifyLoadedParent } from "./codex-relay-client.js";
export { CodexDeliveryError } from "./codex-delivery-error.js";

export interface CodexParent {
  thread_id: string;
  codex_home: string;
}

/** modelの引数ではなく、CodexがMCP要求へ付けるmetadataだけを宛先にする。 */
export function codexParentFromRequest(clientName: string | undefined, metadata: unknown): CodexParent | null {
  if (clientName !== "codex-mcp-client") return null;
  const threadId = (metadata as { threadId?: unknown } | undefined)?.threadId;
  if (typeof threadId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId)) {
    throw new CodexDeliveryError("CODEX_PARENT_ID_UNAVAILABLE", "MCP要求に親のthreadIdがありません。対応するCodexへ更新してください");
  }
  return { thread_id: threadId, codex_home: path.resolve(realCodexHome()) };
}

// testは実process境界をfixtureへ差し替える。MCPの公開パラメータには出さない。
export interface CodexReceiverRuntime {
  executable?: string;
  args?: string[];
  timeout_ms?: number;
  socket_path?: string;
}

function relaySocket(runtime?: CodexReceiverRuntime): string | null {
  if (runtime) return runtime.socket_path ?? null;
  const config = readRelayConfig();
  return config?.enabled ? parentRelaySocket(config) : null;
}

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
};

async function withCodexReceiver<T>(
  parent: CodexParent,
  action: (request: (method: string, params: unknown) => Promise<any>) => Promise<T>,
  runtime: CodexReceiverRuntime = {},
): Promise<T> {
  const executable = runtime.executable ?? resolveAgentBin("codex");
  if (!executable) throw new CodexDeliveryError("CODEX_RECEIVER_UNAVAILABLE", "Codexの実行ファイルを確認できません");
  const child = spawn(executable, runtime.args ?? ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "ignore"],
    env: { ...process.env, CODEX_HOME: parent.codex_home },
    windowsHide: true,
  });
  const pending = new Map<number, Pending>();
  let sequence = 0;
  let stopped = false;
  let transportError: string | null = null;
  const failTransport = (message: string) => {
    transportError = message;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new CodexDeliveryError("CODEX_RECEIVER_TRANSPORT_FAILED", message, item.method === "thread/queue/add"));
    }
    pending.clear();
  };
  child.on("error", (error: NodeJS.ErrnoException) => failTransport(`Codexを起動できません（${error.code ?? "unknown"}）`));
  child.stdin.on("error", (error: NodeJS.ErrnoException) => failTransport(`Codexへの書込みに失敗しました（${error.code ?? "unknown"}）`));
  const exited = new Promise<void>((resolve) => child.once("close", (code, signal) => {
    if (!stopped) failTransport(`Codexの接続が終了しました（exit=${code}, signal=${signal}）`);
    resolve();
  }));
  const reader = createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    let value: any;
    try { value = JSON.parse(line); } catch {
      failTransport("Codexが不正なJSON応答を返しました");
      return;
    }
    const item = pending.get(value?.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(value.id);
    if (value.error) {
      item.reject(new CodexDeliveryError("CODEX_RECEIVER_REJECTED", typeof value.error.message === "string" ? value.error.message : "公式受信口が要求を拒否しました"));
    } else if ("result" in value) item.resolve(value.result);
    else item.reject(new CodexDeliveryError("CODEX_RECEIVER_INVALID_RESPONSE", "公式受信口の応答にresultがありません", item.method === "thread/queue/add"));
  });
  const request = (method: string, params: unknown): Promise<any> => new Promise((resolve, reject) => {
    if (transportError) {
      reject(new CodexDeliveryError("CODEX_RECEIVER_TRANSPORT_FAILED", transportError));
      return;
    }
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new CodexDeliveryError("CODEX_RECEIVER_TIMEOUT", `${method}の応答を確認できません`, method === "thread/queue/add"));
    }, runtime.timeout_ms ?? 15_000);
    pending.set(id, { resolve, reject, timer, method });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
  try {
    await request("initialize", { clientInfo: { name: "aiterm_parent_delivery", version: "1" }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    return await action(request);
  } finally {
    stopped = true;
    for (const item of pending.values()) clearTimeout(item.timer);
    pending.clear();
    child.stdin.end();
    // stdio終了を公式processへ伝える。終了しない外部processだけを明示的に停止する。
    const terminate = setTimeout(() => child.kill("SIGKILL"), 2_000);
    await exited;
    clearTimeout(terminate);
    reader.close();
  }
}

/** 子へ送る前に、同じstoreの宛先と公式キューの対応を確認する。本文は保存・表示しない。 */
export async function verifyCodexParent(parent: CodexParent, runtime?: CodexReceiverRuntime): Promise<void> {
  const socket = relaySocket(runtime);
  if (socket) {
    await withCodexRelay(socket, request => verifyLoadedParent(request, parent.thread_id), runtime?.timeout_ms);
    return;
  }
  await withCodexReceiver(parent, async (request) => {
    const response = await request("thread/read", { threadId: parent.thread_id, includeTurns: false });
    if (response?.thread?.id !== parent.thread_id) {
      throw new CodexDeliveryError("CODEX_PARENT_UNAVAILABLE", "同じCodex環境で親threadを確認できません");
    }
    const subagent = response.thread.source?.subAgent;
    if (subagent && typeof subagent === "object" && "thread_spawn" in subagent) {
      throw new CodexDeliveryError("CODEX_PARENT_UNSUPPORTED", "Codexのnative sub-agentは外部processからのキュー入力を受け付けません");
    }
    await request("thread/queue/list", { threadId: parent.thread_id, limit: 1 });
  }, runtime);
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
  return withCodexReceiver(parent, async (request) => {
    const result = await request("thread/queue/add", {
      threadId: parent.thread_id,
      input: [{ type: "text", text, text_elements: [] }],
      clientUserMessageId: deliveryId,
    });
    if (typeof result?.queuedSubmission?.id !== "string") {
      throw new CodexDeliveryError("CODEX_RECEIVER_INVALID_RESPONSE", "キューの受付IDを確認できません", true);
    }
    return { queued_submission_id: result.queuedSubmission.id };
  }, runtime);
}
