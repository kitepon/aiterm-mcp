#!/usr/bin/env node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { currentUid as uid, runtimeStateBase } from "./state-root.js";
import { createHash, randomBytes } from "node:crypto";

const LAUNCH_ID_RE = /^[0-9a-f]{32}$/;
const SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/;
import { parseClaudeOperationMarker } from "./claude-operation-marker.js";
const MAX_STDIN_BYTES = 8 * 1024 * 1024;
const MAX_RESULT_BYTES = 4 * 1024 * 1024;

function fail(message: string): never {
  process.stderr.write(`aiterm claude-stop-hook: ${message}\n`);
  process.exit(0);
}

function noop(): never {
  process.exit(0);
}

function hasAitermEnv(): boolean {
  return !!(
    process.env.AITERM_AGENT_KIND ||
    process.env.AITERM_SESSION_ID ||
    process.env.AITERM_AGENT_SESSION_ID ||
    process.env.AITERM_AGENT_LAUNCH_ID
  );
}


function agentsDir(): string {
  // state root は OS が与えるper-user runtime dir（Windows隔離時TMPDIR／XDG_RUNTIME_DIR／os.tmpdir()）の下にある。
  // 以前はここで symlink・owner・mode を検査していたが、共有 /tmp に敵対的な同居主体がいる
  // 前提の防御であり、対応 OS の既定配置では成立しない（オーナー裁定 2026-08-19）。
  // 経路の異常は open/stat の OS エラーとしてそのまま露出させる。
  const root = path.join(runtimeStateBase(), `aiterm-mcp-${uid()}`);
  return path.join(root, "agents");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += bytes.length;
    if (total > MAX_STDIN_BYTES) fail("payload が大きすぎます");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeResult(file: string, value: unknown): void {
  const body = JSON.stringify(value) + "\n";
  if (Buffer.byteLength(body, "utf8") > MAX_STDIN_BYTES) fail("result file が大きすぎます");
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try {
    const expected = Buffer.byteLength(body, "utf8");
    const written = fs.writeSync(fd, body, undefined, "utf8");
    if (written !== expected) fail("result file への書込みが途中で終了しました");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
    throw error;
  }
}

function appendEvent(file: string, event: unknown): void {
  const line = JSON.stringify(event) + "\n";
  if (Buffer.byteLength(line, "utf8") > 64 * 1024) fail("event line が大きすぎます");
  const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_WRONLY, 0o600);
  try {
    // st は短書き込み時の巻き戻し（ftruncate）に使う。安全性検査としては使わない。
    const st = fs.fstatSync(fd);
    const expected = Buffer.byteLength(line, "utf8");
    const written = fs.writeSync(fd, line, undefined, "utf8");
    if (written !== expected) {
      fs.ftruncateSync(fd, st.size);
      fail(`event file への書込みが途中で終了しました: ${file}`);
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

interface OperationMarker {
  operationId: string | null;
  dev: number;
  ino: number;
}

function readOperationMarker(file: string): OperationMarker | null {
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    fail(`operation markerを安全に開けません: ${file}`);
  }
  try {
    const st = fs.fstatSync(fd!);
    // parse する入力の上限だけ残す（owner・link 数・mode の検査は撤去した）。
    if (st.size > 1024) {
      fail(`operation markerが大きすぎます: ${file}`);
    }
    const body = fs.readFileSync(fd!, "utf8");
    const value = JSON.parse(body) as Record<string, unknown>;
    // Reading/consuming the v2 reservation is compatibility only. Its cursor
    // is deliberately absent from agent_done/result and proves no interruption.
    const marker = parseClaudeOperationMarker(value);
    return { operationId: marker.operationId, dev: st.dev, ino: st.ino };
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    fs.closeSync(fd!);
  }
}

function consumeOperationMarker(file: string, marker: OperationMarker): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(file);
  } catch {
    fail("operation markerが完了記録中に消失しました");
  }
  // dev/ino は「先に stat したのと同じ実体か」という同一性の検査であり、operation 相関の
  // 正しさそのもの。撤去した安全設備（symlink・owner・link 数・mode）とは別物なので残す。
  if (st!.dev !== marker.dev || st!.ino !== marker.ino) {
    fail("operation markerが完了記録中に置換されました");
  }
  fs.unlinkSync(file);
}

/**
 * 席の会話ID。席の記録（Aitermが書く `…agent.json`）を先に読み、無い・読めない時だけ、起動時に環境へ入れた値を見る。
 * 記録を先にするのは、席の会話を後から結び直した時に、環境の値は起動時のまま残るため。
 * どちらも無い時は null（今までどおり、印だけで席の物と数える）。
 */
function seatVendorSessionId(agents: string, session: string, launchId: string): string | null {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(agents, `${session}.${launchId}.agent.json`), "utf8")) as Record<string, unknown>;
    if (typeof meta.vendor_session_id === "string" && meta.vendor_session_id) return meta.vendor_session_id;
  } catch {
    // 席の記録が無い・読めない。
  }
  return process.env.AITERM_AGENT_VENDOR_SESSION_ID || null;
}

async function main(): Promise<void> {
  if (!hasAitermEnv()) noop();
  const kind = process.env.AITERM_AGENT_KIND;
  const session = process.env.AITERM_SESSION_ID || process.env.AITERM_AGENT_SESSION_ID || "";
  const launchId = process.env.AITERM_AGENT_LAUNCH_ID || "";
  if (kind !== "claude") fail(`AITERM_AGENT_KIND が claude ではありません: ${kind ?? ""}`);
  if (!SESSION_RE.test(session)) fail(`session id が不正です: ${session}`);
  if (!LAUNCH_ID_RE.test(launchId)) fail(`launch id が不正です: ${launchId}`);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(await readStdin()) as Record<string, unknown>;
  } catch {
    fail("Stop payload がJSONではありません");
  }
  if (payload.hook_event_name !== "Stop") fail("Stop以外のpayloadをturn完了にできません");
  if (typeof payload.session_id !== "string" || !payload.session_id) fail("Claude session_id がありません");
  if (typeof payload.last_assistant_message !== "string") fail("last_assistant_message がありません");

  // 席の印（環境変数）は、席のprocessが起こした子や、Claude Codeの裏の常駐を通じて、席と関係の無い会話にも継がれる。
  // 席の会話と違う会話のStopは、席の記録（答え・event・番の印）に触らない（ADR 0119）。
  const agents = agentsDir();
  const seatConversation = seatVendorSessionId(agents, session, launchId);
  if (seatConversation !== null && seatConversation !== payload.session_id) noop();

  const text = payload.last_assistant_message;
  const resultBytes = Buffer.byteLength(text, "utf8");
  if (resultBytes > MAX_RESULT_BYTES) fail(`assistant result が${MAX_RESULT_BYTES} bytesを超えています`);
  const resultDigest = createHash("sha256").update(text, "utf8").digest("hex");
  const resultFile = path.join(agents, `${session}.${launchId}.claude-result.json`);
  const eventFile = path.join(agents, `${session}.${launchId}.events.jsonl`);
  const operationFile = path.join(agents, `${session}.${launchId}.claude-operation.json`);
  const operationMarker = readOperationMarker(operationFile);
  const operationId = operationMarker?.operationId ?? null;

  writeResult(resultFile, {
    schema: "aiterm.claude-turn-result.v2",
    operation_id: operationId,
    vendor_session_id: payload.session_id,
    result_digest: resultDigest,
    result_bytes: resultBytes,
    text,
  });
  appendEvent(eventFile, {
    type: "agent_done",
    vendor: "claude",
    aiterm_session: session,
    launch_id: launchId,
    vendor_session_id: payload.session_id,
    turn_id: null,
    operation_id: operationId,
    reason: "Stop",
    done_status: "turn_done",
    stop_hook_active: !!payload.stop_hook_active,
    result_digest: resultDigest,
    result_bytes: resultBytes,
    at: new Date().toISOString(),
  });
  if (operationMarker) consumeOperationMarker(operationFile, operationMarker);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
