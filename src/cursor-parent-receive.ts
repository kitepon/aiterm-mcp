#!/usr/bin/env node
// Cursor親がidleのとき、背景で起動して回答本文の到着を待つ受け口。
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import { cursorHookRoot, receiveCursorAnswer } from "./cursor-parent-receiver.js";
import { windowsStartProcessArgumentList, type AgentWaitProcess } from "./core.js";

export function cursorReceiveProcess(deliveryId: string, executable = process.execPath): AgentWaitProcess {
  const args = [fileURLToPath(import.meta.url), "--delivery", deliveryId];
  return {
    executable,
    args,
    windows_start_process_argument_list: process.platform === "win32" ? windowsStartProcessArgumentList(args) : null,
  };
}

function emit(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + "\n");
}

export async function main(argv: string[]): Promise<number> {
  if (argv.length !== 2 || argv[0] !== "--delivery" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(argv[1])) {
    emit({ ok: false, code: "CURSOR_PARENT_RECEIVE_USAGE", message: "usage: cursor-parent-receive --delivery <uuid>" });
    return 1;
  }
  const result = await receiveCursorAnswer(cursorHookRoot(), argv[1]);
  if (result.outcome === "timeout") {
    emit({ delivery_id: argv[1], outcome: "timeout" });
    return 3;
  }
  if (result.outcome === "delivered_by_hook") {
    emit({ delivery_id: argv[1], outcome: "delivered_by_hook" });
    return 0;
  }
  emit({ delivery_id: argv[1], outcome: "delivered", text: result.text });
  return 0;
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
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    emit({ ok: false, code: "CURSOR_PARENT_RECEIVE_FAILED", message: error instanceof Error ? error.message : "cursor-parent-receive: operation failed" });
    process.exitCode = 1;
  });
}
