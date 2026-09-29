#!/usr/bin/env node
// Cursor親がidleのとき、背景で起動して回答本文の到着を待つ受け口。本体はaiterm-steer-delivery。
import { fileURLToPath } from "node:url";
import * as steer from "aiterm-steer-delivery";
import { cursorHookRoot } from "./cursor-parent-receiver.js";
import type { AgentWaitProcess } from "./core.js";

export function cursorReceiveProcess(deliveryId: string, executable = process.execPath): AgentWaitProcess {
  return steer.cursorReceiveProcess(fileURLToPath(import.meta.url), deliveryId, executable);
}

export async function main(argv: string[]): Promise<number> {
  return steer.runCursorReceive(cursorHookRoot(), argv);
}

if (steer.isDirectExecution(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    process.stdout.write(JSON.stringify({ ok: false, code: "CURSOR_PARENT_RECEIVE_FAILED", message: error instanceof Error ? error.message : "cursor-parent-receive: operation failed" }) + "\n");
    process.exitCode = 1;
  });
}
