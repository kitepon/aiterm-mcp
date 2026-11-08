import type { AgentActivity } from "./agent-activity.js";

export interface IdleSeatSnapshot {
  launch_id: string;
  created_at: string;
  vendor_session_id: string | null;
  resume_ready: boolean;
  native_configuration_confirmed: boolean;
  activity: AgentActivity;
  state: "busy" | "idle" | "blocked" | "dead" | "missing" | "unknown" | "hibernated";
  reason: string;
  attached: boolean | null;
  turn_settled: boolean | null;
  pending_child_deliveries: number | null;
  post_startup_process_count: number | null;
  window_activity_at: number | null;
  /** Claude only, read for an explicit hibernate: time of a rate_limited API error after the last input. */
  rate_limited_at?: string | null;
}
export interface IdleDecision {
  outcome: "ready" | "not_due" | "skipped";
  reason: string;
  anchor: string | null;
  due_at: number | null;
  stalled: boolean;
}

export function idleMinutes(value = process.env.AITERM_IDLE_MINUTES): number {
  if (value === undefined) return 30;
  const minutes = Number(value);
  if (!value.trim() || !Number.isFinite(minutes * 60_000) || minutes <= 0)
    throw new Error("AITERM_IDLE_MINUTES must be a positive finite duration");
  return minutes;
}

/**
 * `immediate` is an explicit hibernate request: no deadline and no attachment refusal. A Claude turn that ended on a
 * rate limit (no Stop event; the CLI then waits in its limit footer or menu) counts as ended at that error.
 * `stopBackground` (explicit hibernate only) lets the stop end the seat's background processes instead of refusing.
 */
export function decideIdleSeat(seat: IdleSeatSnapshot, now: number, minutes = 30, expectedAnchor?: string, immediate = false,
  stopBackground = false): IdleDecision {
  const result: IdleDecision = { outcome: "skipped", reason: "observation_unconfirmed", anchor: null, due_at: null, stalled: false };
  if (!Number.isFinite(now) || (!immediate && (!Number.isFinite(minutes * 60_000) || minutes <= 0))) return result;
  const limited = immediate && seat.rate_limited_at ? seat.rate_limited_at : null;
  if (!limited && (seat.state !== "idle" || seat.reason !== "composer_ready")) return { ...result, reason: seat.state === "busy" ? "turn_running" : seat.state,
    stalled: seat.state === "busy" && seat.window_activity_at !== null && Number.isFinite(seat.window_activity_at)
      && now - seat.window_activity_at >= 60 * 60_000 };
  if (!immediate && seat.attached !== false) return { ...result, reason: seat.attached === true ? "attached" : "attachment_unconfirmed" };
  if (seat.pending_child_deliveries !== 0) return { ...result, reason: "child_delivery_pending_or_unknown" };
  if (seat.post_startup_process_count !== 0 && !(immediate && stopBackground)) return { ...result, reason: "background_work_or_unknown" };
  if (!seat.vendor_session_id) return { ...result, reason: "conversation_id_unavailable" };
  if (!seat.resume_ready) return { ...result, reason: "resume_unavailable" };
  if (!limited && seat.turn_settled !== true) return { ...result, reason: "turn_end_unconfirmed" };
  const anchor = limited ?? seat.activity.last_turn_end_at ?? (!seat.activity.tracked ? seat.created_at : null);
  if (anchor === null || !Number.isFinite(Date.parse(anchor))) return { ...result, reason: "turn_end_time_unavailable" };
  const input = seat.activity.last_input_at;
  if (input !== null && (!Number.isFinite(Date.parse(input)) || Date.parse(input) > Date.parse(anchor)))
    return { ...result, reason: "input_without_turn_end" };
  const due = Date.parse(anchor) + (immediate ? 0 : minutes * 60_000);
  if (!Number.isFinite(due)) return result;
  if (expectedAnchor !== undefined && expectedAnchor !== anchor) return { ...result, reason: "superseded_timer", anchor, due_at: due };
  // A rate-limited CLI shows its limit footer or menu, not the composer the settings check reads; the saved recipe stands.
  if (now >= due && !limited && !seat.native_configuration_confirmed) return { ...result, reason: "native_configuration_unconfirmed", anchor, due_at: due };
  return { ...result, outcome: now < due ? "not_due" : "ready", reason: now < due ? "before_deadline" : "idle_timeout", anchor, due_at: due };
}

export interface IdleCheckRuntime {
  exclusive<T>(body: () => Promise<T>): Promise<T>;
  now(): number;
  snapshot(): IdleSeatSnapshot;
  /** Synchronous compare-and-record under the serving runtime's existing admission. */
  begin(seat: IdleSeatSnapshot, anchor: string): void;
  stop(verify: () => void, didIssue: () => void): Promise<boolean>;
  cancel(seat: IdleSeatSnapshot, anchor: string): void;
  finish(seat: IdleSeatSnapshot, anchor: string): void;
  record(result: IdleCheckResult): void;
}
export type IdleCheckResult = Omit<IdleDecision, "outcome"> & { outcome: IdleDecision["outcome"] | "hibernated" | "unconfirmed" };

/** The owner supplies the same seat admission used by input; no independent queue is created. */
export async function checkIdleSeat(runtime: IdleCheckRuntime, expectedLaunch: string, minutes = 30,
  expectedAnchor?: string, immediate = false, stopBackground = false): Promise<IdleCheckResult> {
  return runtime.exclusive(async () => {
    let issued = false;
    let effectIssued = false;
    let preparation: { seat: IdleSeatSnapshot; anchor: string } | null = null;
    let result: IdleCheckResult;
    try {
      const before = runtime.snapshot();
      const lastInputAt = before.activity.last_input_at;
      result = before.launch_id !== expectedLaunch
        ? { outcome: "skipped", reason: "generation_replaced", anchor: null, due_at: null, stalled: false }
        : decideIdleSeat(before, runtime.now(), minutes, expectedAnchor, immediate, stopBackground);
      if (result.outcome === "ready") {
        const anchor = result.anchor!;
        const verify = () => {
          const current = runtime.snapshot();
          const decision = decideIdleSeat(current, runtime.now(), minutes, anchor, immediate, stopBackground);
          // After the stop signal, an explicit hibernate only requires that no new input arrived (the stopping CLI may redraw anything).
          if (current.launch_id !== expectedLaunch || current.activity.last_input_at !== lastInputAt
            || (effectIssued ? !immediate && (current.attached === true || ["busy", "blocked"].includes(current.state)) : decision.outcome !== "ready"))
            throw new Error("idle_precondition_changed");
        };
        verify();
        preparation = { seat: before, anchor };
        issued = true;
        runtime.begin(before, anchor);
        const stopped = await runtime.stop(verify, () => { effectIssued = true; });
        if (!stopped) throw new Error("process_tree_exit_unconfirmed");
        verify();
        runtime.finish(before, anchor);
        result = { ...result, outcome: "hibernated" };
      }
    } catch {
      if (issued && !effectIssued && preparation) {
        try { runtime.cancel(preparation.seat, preparation.anchor); issued = false; } catch { /* Keep an uncertain stopping record. */ }
      }
      result = { outcome: issued ? "unconfirmed" : "skipped", reason: issued ? "stop_unconfirmed" : "observation_unconfirmed",
        anchor: null, due_at: null, stalled: false };
    }
    runtime.record(result);
    return result;
  });
}
