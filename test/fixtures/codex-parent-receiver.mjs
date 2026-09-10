// Codex公式受信口のprocess境界fixture。モデルや外部ネットワークを使わない。
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const [mode, logFile] = process.argv.slice(2);
const send = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + "\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (logFile) appendFileSync(logFile, JSON.stringify({ ...request, codex_home: process.env.CODEX_HOME }) + "\n");
  const { id, method, params } = request;
  if (method === "initialize") return send(id, { userAgent: "codex-fixture" });
  if (method === "initialized") return;
  if (method === "thread/read") return send(id, { thread: { id: params.threadId, source: mode === "native-child" ? { subAgent: { thread_spawn: {} } } : "cli" } });
  if (method === "thread/queue/list") return send(id, { data: [], nextCursor: null });
  if (method === "thread/queue/add") {
    if (mode === "reject") return process.stdout.write(JSON.stringify({ id, error: { code: -32600, message: "入力が上限を超えました" } }) + "\n");
    if (mode === "exit") return process.exit(9);
    if (mode === "timeout") return;
    if (mode === "invalid") return process.stdout.write("JSONではありません\n");
    if (mode === "no-id") return send(id, { queuedSubmission: {} });
    return send(id, { queuedSubmission: { id: "fixture-queue-id", input: params.input } });
  }
  throw new Error(`未対応の試験要求: ${method}`);
});
