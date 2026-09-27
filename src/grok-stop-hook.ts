#!/usr/bin/env node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { currentUid as uid, runtimeStateBase } from "./state-root.js";

const LAUNCH_ID_RE = /^[0-9a-f]{32}$/;
const SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_STDIN_BYTES = 1024 * 1024;

function fail(message: string): never {
  process.stderr.write(`aiterm grok-stop-hook: ${message}\n`);
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
  const root = path.join(runtimeStateBase(), `aiterm-mcp-${uid()}`);
  const agents = path.join(root, "agents");
  // per-user runtime dir 前提のため、symlink・owner・link 数・mode の検査は撤去した
  // （共有 /tmp に敵対的同居主体がいる前提の防御。オーナー裁定 2026-08-19）。
  return agents;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += b.length;
    if (total > MAX_STDIN_BYTES) fail("payload が大きすぎます");
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function appendEvent(file: string, event: unknown): void {
  const line = JSON.stringify(event) + "\n";
  if (Buffer.byteLength(line, "utf8") > 64 * 1024) fail("event line が大きすぎます");
  const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_WRONLY, 0o600);
  try {
    const st = fs.fstatSync(fd);
    // st は短書き込み時の巻き戻し（ftruncate）に使う。安全性検査としては使わない。
    const written = fs.writeSync(fd, line, undefined, "utf8");
    if (written < Buffer.byteLength(line, "utf8")) {
      fs.ftruncateSync(fd, st.size);
      fail(`event file への書込みが途中で終了しました: ${file}`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

async function main(): Promise<void> {
  if (!hasAitermEnv()) noop();
  const kind = process.env.AITERM_AGENT_KIND;
  const session = process.env.AITERM_SESSION_ID || process.env.AITERM_AGENT_SESSION_ID || "";
  const launchId = process.env.AITERM_AGENT_LAUNCH_ID || "";
  if (kind !== "grok") fail(`AITERM_AGENT_KIND が grok ではありません: ${kind ?? ""}`);
  if (!SESSION_RE.test(session)) fail(`session id が不正です: ${session}`);
  if (!LAUNCH_ID_RE.test(launchId)) fail(`launch id が不正です: ${launchId}`);

  let payload: Record<string, unknown> = {};
  const input = await readStdin();
  if (input.trim()) {
    try {
      payload = JSON.parse(input) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }

  const agents = agentsDir();
  const eventFile = path.join(agents, `${session}.${launchId}.events.jsonl`);
  appendEvent(eventFile, {
    type: "agent_done",
    vendor: kind,
    aiterm_session: session,
    launch_id: launchId,
    vendor_session_id: str(payload.sessionId),
    turn_id: str(payload.promptId),
    reason: str(payload.reason) ?? str(payload.hookEventName) ?? "stop",
    done_status: "turn_done",
    at: new Date().toISOString(),
  });
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
