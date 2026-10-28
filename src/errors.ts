// aiterm のエラー基盤。AitermError と telemetry 所有の失敗経路だけを持つ末端モジュール。
import { recordRuntimeError, type RuntimeErrorCode } from "./runtime-error-store.js";

export class AitermError extends Error {
  code: number;
  configurationFailure?: {
    schema: "aiterm.agent-configure-error.v1";
    session_id: string;
    outcome: "not_applied" | "outcome_unknown";
    effect: "not_started" | "possible";
  };
  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

/** A harness authentication check refused launch before any session creation.
 * Keep the native CLI's status body and credential diagnostics out of the wire. */
export class AgentAuthenticationPreflightError extends AitermError {
  constructor(readonly reasonCode: "CLAUDE_AUTH_NOT_AUTHENTICATED" | "CLAUDE_AUTH_STATUS_UNCONFIRMED" | "CLAUDE_AUTH_STATUS_TIMEOUT", message: string) {
    super(message, 2);
    this.name = "AgentAuthenticationPreflightError";
  }
}

export class TelemetryOwnedError extends AitermError {
  readonly telemetryCode: RuntimeErrorCode;
  constructor(message: string, code: number, telemetryCode: RuntimeErrorCode, cause?: unknown) {
    super(message, code);
    this.name = "TelemetryOwnedError";
    this.telemetryCode = telemetryCode;
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

export function telemetryOwnedFailure(telemetryCode: RuntimeErrorCode, error: unknown, fallbackCode = 1): TelemetryOwnedError {
  if (error instanceof TelemetryOwnedError) return error;
  recordRuntimeError(telemetryCode);
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof AitermError ? error.code : fallbackCode;
  return new TelemetryOwnedError(message, code, telemetryCode, error);
}
export function ownTelemetryFailure(telemetryCode: RuntimeErrorCode, error: unknown, fallbackCode = 1): never {
  throw telemetryOwnedFailure(telemetryCode, error, fallbackCode);
}

export function ptyDependencyError(message: string, observe = true): never {
  const error = new AitermError(message, 2);
  if (observe) ownTelemetryFailure("AITERM.PTY_DEPENDENCY_UNAVAILABLE", error, 2);
  throw error;
}
