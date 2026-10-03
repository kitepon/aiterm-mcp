#!/usr/bin/env node
import process from "node:process";
import { RuntimeErrorStore, validateRuntimeObservation } from "./runtime-error-store.js";
import { reportRuntimeErrors, triggerRuntimeErrorReport } from "./runtime-error-report.js";

async function main(): Promise<void> {
  const [action, code, ...rest] = process.argv.slice(2);
  if (rest.length > 0) throw new Error("invalid args");
  if (action === "report" && code === undefined) {
    await reportRuntimeErrors({ trigger: "auto" });
    return;
  }
  const store = new RuntimeErrorStore();
  if (action === "record" && code) {
    // 記録できた時だけ、受け口への報告を別processへ頼む（有効にした端末だけ）。このworkerは通信しない。
    if (store.record(validateRuntimeObservation({ code }))) triggerRuntimeErrorReport();
    return;
  }
  if (action === "diagnostic" && code === undefined) {
    process.stdout.write(`${JSON.stringify(store.diagnostic())}\n`);
    return;
  }
  throw new Error("invalid action");
}

main().catch(() => { process.exitCode = 1; });
