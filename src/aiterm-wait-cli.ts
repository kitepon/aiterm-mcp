#!/usr/bin/env node
// aiterm-wait — agent turn 完了eventの純リーダー観測CLI。
// 完了/timeout/close を1行のJSON receiptで返してexitする。lock・PTY・dispatch状態には一切触れない。
// 親AIホストのバックグラウンドタスクとして起動し、exitを「観測終了の通知」として使う。
// exit≠完了: exit code は outcome を映す（0=done / 5=running=未完了 / 3=timeout=未完了 / 4=closed / 6=rate_limited=harness利用上限 / 7=error=turnがエラー終了 / 1=waiter自身のエラー）。
// --timeout 0 は待たずに一度だけ観測する照会で、未完了は running（timeout と混同させない）。
// receipt の outcome が正で、done 以外は未完了。timeout の既定は core の DEFAULT_AGENT_DONE_TIMEOUT（600秒）。
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import { AitermError, detectAgentRateLimit, observeAgentDone, type AgentWaitObservation } from "./core.js";

interface WaitCommand {
  session: string;
  operationId: string | null;
  timeout: number;
  cursor: number | null;
}

const SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const OPERATION_RE = /^sha256:[0-9a-f]{64}$/;
const USAGE =
  "usage: aiterm-wait --session <name> [--cursor <event_cursor>] [--operation sha256:<64hex>] [--timeout <sec>]" +
  "（--timeout 0 は待たずに一度だけ観測する照会で、未完了は outcome=running / exit 5）";

export function parseArgs(argv: string[]): WaitCommand {
  let session: string | null = null;
  let operationId: string | null = null;
  let timeout: number | null = null;
  let cursor: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--session" || a === "--operation" || a === "--timeout" || a === "--cursor") {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${a} に値がありません。${USAGE}`);
      i++;
      if (a === "--session") {
        if (session !== null) throw new Error(`--session が重複しています。${USAGE}`);
        if (!SESSION_RE.test(v)) throw new Error(`--session が不正です。${USAGE}`);
        session = v;
      } else if (a === "--operation") {
        if (operationId !== null) throw new Error(`--operation が重複しています。${USAGE}`);
        if (!OPERATION_RE.test(v)) throw new Error(`--operation が不正です。${USAGE}`);
        operationId = v;
      } else if (a === "--cursor") {
        if (cursor !== null) throw new Error(`--cursor が重複しています。${USAGE}`);
        if (!/^\d+$/.test(v)) throw new Error(`--cursor は0以上の整数完了境界だけを受理します。${USAGE}`);
        cursor = Number(v);
      } else {
        if (timeout !== null) throw new Error(`--timeout が重複しています。${USAGE}`);
        if (!/^\d+$/.test(v)) throw new Error(`--timeout は0以上の整数秒だけを受理します。${USAGE}`);
        timeout = Number(v);
        if (timeout > 86400) throw new Error(`--timeout は86400秒以下だけを受理します。${USAGE}`);
      }
    } else {
      throw new Error(`不明な引数です: ${a}。${USAGE}`);
    }
  }
  if (session === null) throw new Error(`--session は必須です。${USAGE}`);
  return { session, operationId, timeout: timeout ?? 600, cursor };
}

function emit(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + "\n");
}

// outcome → exit code。exit status しか見えないホストでも done とそれ以外を誤読できないようにする。
// Record で全 outcome を型に強制する: 語を足して対応表を直し忘れると undefined→exit 0 になり、
// 「まだ終わっていない」が「完了」として親へ届く。その取りこぼしを compile error で止める。
const OUTCOME_EXIT_CODES: Record<AgentWaitObservation["outcome"], number> = {
  done: 0,
  running: 5,
  timeout: 3,
  closed: 4,
  rate_limited: 6,
  error: 7,
};

export async function main(argv: string[]): Promise<void> {
  const cmd = parseArgs(argv);
  let result: AgentWaitObservation;
  try {
    result = await observeAgentDone(cmd.session, {
      operation_id: cmd.operationId,
      timeout: cmd.timeout,
      cursor: cmd.cursor,
    });
  } catch (e) {
    // Grok は利用上限に達すると auth 正本を自壊させることがあり（2026-08-22 実測）、
    // metadata検証が認証不在で止まる。現在のviewportに上限パネルがある場合だけ
    // rate_limitedとして返し、古いlogで現在の認証エラーを置き換えない。
    if (e instanceof AitermError && /Grok 認証正本/.test(e.message)) {
      const limited = detectAgentRateLimit("grok", cmd.session);
      if (limited) {
        emit({
          ok: false,
          code: "AGENT_RATE_LIMITED",
          vendor: "grok",
          rate_limit: limited,
          message:
            "Grok が利用上限に達している。別のベンダーのモデルに切り替えてください。" +
            "（認証正本の不在は上限時に CLI が auth を自壊させた痕跡で、未ログインの誤診に注意）",
        });
        process.exitCode = 6;
        return;
      }
    }
    throw e;
  }
  emit(result);
  process.exitCode = OUTCOME_EXIT_CODES[result.outcome];
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const self = fileURLToPath(import.meta.url);
    const a = fs.realpathSync(entry);
    const b = fs.realpathSync(self);
    if (a === b) return true;
    return process.platform === "win32" && a.toLowerCase() === b.toLowerCase();
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    // 引数不正・相関エラーの文言は親AI向けに設計済みのため envelope に載せる。
    // 想定外の例外は raw を反映せず固定文言に落とす（privacy-safe）。
    const known = e instanceof AitermError || (e instanceof Error && e.message.includes(USAGE));
    emit({
      ok: false,
      code: "AITERM_WAIT_FAILED",
      message: known ? (e as Error).message : "aiterm-wait: operation failed",
    });
    process.stderr.write("aiterm-wait: operation failed\n");
    process.exitCode = 1;
  });
}
