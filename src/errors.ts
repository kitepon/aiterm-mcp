// aiterm のエラー基盤。AitermError と telemetry 所有の失敗経路だけを持つ末端モジュール。
import { recordRuntimeError, type RuntimeErrorCode } from "./runtime-error-store.js";

export class AitermError extends Error {
  code: number;
  sendFailure?: {
    schema: "aiterm.agent-send-error.v1";
    code: "STEER_NOT_QUEUED" | "STEER_STILL_QUEUED";
    outcome: "outcome_unknown";
    effect: "possible";
    session_id: string; launch_id: string; vendor: string; harness: string;
    event_cursor: number | null; steer_id: string | null; interim_from: string | null;
  };
  configurationFailure?: {
    schema: "aiterm.agent-configure-error.v1";
    session_id: string;
    outcome: "not_applied" | "outcome_unknown";
    effect: "not_started" | "possible";
  };
  /** Claudeの選ぶ画面での拒否。selection_excludedは、sを打つ前に断り、閉じた画面を読んだ時だけtrue。 */
  configureRefusal?: { code: string; relaunch: boolean; selection_excluded: boolean };
  /** Native setup failed and a complete listing then showed this session name absent (tmux-runtime). */
  nativeSessionAbsent?: string;
  /** remote-terminal.md R18: a fresh launch that left no seat. */
  launchNotStarted?: { harness: string; phase?: "input"; code?: "AGENT_AUTH_REQUIRED" | "AGENT_STARTUP_BLOCKED"; action?: string };
  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

/** An input refusal decided from the launch arguments alone, before any native or process exists (remote-terminal.md R18, phase "input"). */
export function launchInputRefusal(harness: string, reason: string): AitermError {
  const error = new AitermError(`AGENT_LAUNCH_NOT_STARTED: ${reason}`, 2);
  error.launchNotStarted = { harness, phase: "input" };
  return error;
}

/** The launch stopped on a startup screen Aiterm does not answer and closed the seat it created (R18, AGENT_STARTUP_BLOCKED). */
export function launchStartupBlocked(harness: string, reason: string, action: string): AitermError {
  const error = new AitermError(`AGENT_STARTUP_BLOCKED: 起動の途中の画面で止まったため、作った席を閉じました。席は残っていません。reason=${reason}\n${action}`, 2);
  error.launchNotStarted = { harness, phase: "input", code: "AGENT_STARTUP_BLOCKED", action };
  return error;
}

/** The harness CLI is not logged in; the launch is refused before any session exists (remote-terminal.md R18, code AGENT_AUTH_REQUIRED). */
export function launchAuthRequired(harness: string, reason: string): AitermError {
  const error = new AitermError(`AGENT_LAUNCH_NOT_STARTED: AGENT_AUTH_REQUIRED: ${reason}`, 2);
  error.launchNotStarted = { harness, phase: "input", code: "AGENT_AUTH_REQUIRED" };
  return error;
}

/** Admission refusal before the requested resume starts. */
export class AgentResumeUnavailableError extends AitermError {
  readonly resumeUnavailable;
  constructor(sessionId: string) {
    super("AGENT_RESUME_UNAVAILABLE: 保存した再開対象を確認できません。新規起動も本文送信もしていません。", 2);
    this.resumeUnavailable = { schema: "aiterm.agent-resume-unavailable.v1" as const,
      code: "AGENT_RESUME_UNAVAILABLE" as const, session_id: sessionId,
      outcome: "unavailable" as const, effect: "not_started" as const, input: "not_sent" as const };
  }
}

/** Resume failures occur before the caller's body reaches the input path. */
export class AgentResumeError extends AitermError {
  readonly resumeFailure;
  constructor(code: "AGENT_RESUME_UNCONFIRMED" | "AGENT_RESUME_FAILED", message: string, sessionId: string, launchId: string) {
    super(`${code}: ${message}`, 2);
    this.resumeFailure = { schema: "aiterm.agent-resume-error.v1" as const, code,
      session_id: sessionId, launch_id: launchId, input: "not_sent" as const, recovery: "inspect_session" as const };
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
