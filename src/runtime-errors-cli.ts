#!/usr/bin/env node
import process from "node:process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RuntimeErrorStore } from "./runtime-error-store.js";
import { defaultRuntimeErrorReportPaths, runtimeErrorReportingStatus } from "./runtime-error-os.js";
import {
  readProductCredential, readReportState, reportRuntimeErrors, setRuntimeErrorReporting, triggerRuntimeErrorReport,
} from "./runtime-error-report.js";

type Command =
  | { name: "snapshot" }
  | { name: "ack"; cursor: number }
  | { name: "resolve" | "reopen"; fingerprint: string }
  | { name: "report" }
  | { name: "reporting"; action: "enable" | "disable" | "status" };

function parseArgs(argv: string[]): Command {
  const [name, flag, value, ...rest] = argv;
  if (rest.length > 0) throw new Error("引数が多すぎます");
  if (name === "snapshot" && flag === undefined) return { name };
  if (name === "ack" && flag === "--cursor" && value !== undefined && /^\d+$/.test(value)) {
    const cursor = Number(value);
    if (Number.isSafeInteger(cursor)) return { name, cursor };
  }
  if ((name === "resolve" || name === "reopen") && flag === "--fingerprint" && value !== undefined) {
    if (/^[0-9a-f]{64}$/.test(value)) return { name, fingerprint: value };
  }
  if (name === "report" && flag === undefined) return { name };
  if (name === "reporting" && (flag === "enable" || flag === "disable" || flag === "status") && value === undefined) {
    return { name, action: flag };
  }
  throw new Error("使い方: aiterm-runtime-errors snapshot | ack --cursor N | resolve|reopen --fingerprint SHA256 | report | reporting enable|disable|status");
}

function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

// 報告の状態。宛先・合鍵・pathは出さない。
function reportingStatus(): Record<string, unknown> {
  const paths = defaultRuntimeErrorReportPaths();
  const snapshot = new RuntimeErrorStore().snapshot();
  const state = readReportState(paths.reportStatePath);
  return {
    reporting: runtimeErrorReportingStatus(paths.reportingConfigPath),
    credential: readProductCredential(paths.credentialPath).status,
    collection: snapshot.collection,
    unreported: Math.max(0, snapshot.cursor - snapshot.acknowledged_cursor),
    last_attempt_at: state.last_attempt_at, last_status: state.last_status,
    last_http_status: state.last_http_status, last_accepted_at: state.last_accepted_at,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const command = parseArgs(argv);
  if (command.name === "report") {
    const result = await reportRuntimeErrors({ trigger: "manual" });
    emit({ ok: result.status === "accepted" || result.status === "nothing_to_report", command: command.name, result });
    if (result.status !== "accepted" && result.status !== "nothing_to_report") process.exitCode = 1;
    return;
  }
  if (command.name === "reporting") {
    if (command.action !== "status") {
      setRuntimeErrorReporting(defaultRuntimeErrorReportPaths().reportingConfigPath, command.action === "enable");
    }
    emit({ ok: true, command: command.name, action: command.action, status: reportingStatus() });
    return;
  }
  const store = new RuntimeErrorStore();
  if (command.name === "snapshot") {
    emit({ ok: true, command: command.name, snapshot: store.snapshot() });
    return;
  }
  if (command.name === "ack") {
    emit({ ok: true, command: command.name, snapshot: store.acknowledge(command.cursor) });
    return;
  }
  const changed = command.name === "resolve"
    ? store.resolve(command.fingerprint)
    : store.reopen(command.fingerprint);
  emit({ ok: true, command: command.name, changed, snapshot: store.snapshot() });
  // 解決・開き直しも受け口へ知らせる（有効にした端末だけ。送るのは別process）。
  if (changed) triggerRuntimeErrorReport();
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  try {
    const invoked = realpathSync(process.argv[1]);
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    return process.platform === "win32"
      ? invoked.toLowerCase() === modulePath.toLowerCase()
      : invoked === modulePath;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  main().catch(() => {
    // CLI も privacy allowlist を守り、store/config の生例外や path を stdout/stderr に反射しない。
    process.stderr.write("aiterm-runtime-errors: operation failed\n");
    emit({ ok: false, code: "AITERM_RUNTIME_ERROR_STORE_OPERATION_FAILED" });
    process.exitCode = 1;
  });
}
