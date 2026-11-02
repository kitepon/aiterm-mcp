import fs from "node:fs";
import { z } from "zod";
import { agentMetadataPath, writeJson0600 } from "./agent-shared.js";
import { AitermError } from "./errors.js";
import { ExecutionError, executionErrorCodeSchema } from "./execution-wire.js";
import { ProcessProbeError } from "./process-runtime.js";

const launch = z.string().regex(/^[a-f0-9]{32}$/);
const systemCode = z.enum(["ETIMEDOUT", "ENOBUFS", "EAGAIN", "ENOENT", "EACCES", "ENOMEM", "EMFILE", "ENFILE", "E2BIG", "EPERM", "UNKNOWN"]);
const signal = z.enum(["SIGABRT", "SIGALRM", "SIGBUS", "SIGFPE", "SIGHUP", "SIGILL", "SIGINT", "SIGKILL", "SIGPIPE", "SIGQUIT", "SIGSEGV", "SIGTERM", "SIGTRAP", "SIGUSR1", "SIGUSR2"]);
const integer = z.number().int().safe();
const reason = z.enum(["composer_ready", "turn_running", "command_approval", "mcp_approval", "hooks_review", "rate_limit_model_switch",
  "startup_dialog", "unknown_dialog", "unrecognized_screen", "vendor_onboarding_required", "tool_approval", "project_mcp_consent",
  "session_missing", "pane_dead", "native_pane_process_unresolved", "harness_exited", "harness_start_unconfirmed",
  "harness_process_unresolved", "harness_process_ambiguous", "harness_stopped", "unknown"]);
const readiness = z.object({ status: z.enum(["ready", "blocked"]), reason }).strict();
export const resumeFailurePhaseSchema = z.enum(["recipe_validation", "generation_preparation", "attempt_save", "native_create", "native_identity",
  "environment_setup", "vendor_start", "generation_publish", "readiness", "configuration_restore", "ready_save"]);
export type ResumeFailurePhase = z.infer<typeof resumeFailurePhaseSchema>;
const cause = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("process_probe"), code: systemCode.nullable(), exit_code: integer.nullable(), signal: signal.nullable() }).strict(),
  z.object({ kind: z.literal("system"), code: systemCode.nullable(), exit_code: z.null(), signal: z.null() }).strict(),
  z.object({ kind: z.literal("execution"), code: executionErrorCodeSchema, exit_code: z.null(), signal: z.null() }).strict(),
  z.object({ kind: z.literal("aiterm"), code: integer, exit_code: z.null(), signal: z.null() }).strict(),
  z.object({ kind: z.literal("unknown"), code: z.null(), exit_code: z.null(), signal: z.null() }).strict(),
]);
export const agentResumeFailureSchema = z.object({
  schema: z.literal("aiterm.agent-resume-failure.v1"), session_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), launch_id: launch,
  previous_launch_id: launch, next_launch_id: launch.nullable(), phase: resumeFailurePhaseSchema, readiness: readiness.nullable(), cause,
  body_input: z.literal("not_sent"), native_outcome: z.literal("unknown"), attempt_record: z.enum(["failed", "unknown", "not_created"]),
  attempted_at: z.iso.datetime().nullable(), observed_at: z.iso.datetime(),
}).strict().refine(value => value.next_launch_id === null ? value.launch_id === value.previous_launch_id
  : value.next_launch_id !== value.previous_launch_id && value.launch_id === value.next_launch_id);
export type AgentResumeFailure = z.infer<typeof agentResumeFailureSchema>;

export function safeResumeFailureCause(error: unknown): z.infer<typeof cause> {
  const unknown = { kind: "unknown", code: null, exit_code: null, signal: null } as const;
  try {
    if (error instanceof ProcessProbeError) return { kind: "process_probe", code: systemCode.safeParse(error.processFailure.code).data ?? null,
      exit_code: integer.safeParse(error.processFailure.status).data ?? null, signal: signal.safeParse(error.processFailure.signal).data ?? null };
    if (error instanceof ExecutionError) return cause.parse({ kind: "execution", code: error.code, exit_code: null, signal: null });
    if (error instanceof AitermError) return cause.parse({ kind: "aiterm", code: error.code, exit_code: null, signal: null });
    if (error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string") return {
      kind: "system", code: systemCode.safeParse((error as NodeJS.ErrnoException).code).data ?? "UNKNOWN", exit_code: null, signal: null };
  } catch { /* A broken error object must not replace the original failure. */ }
  return unknown;
}

export function safeResumeReadiness(value: { status: string; reason: string } | null): AgentResumeFailure["readiness"] {
  if (!value || (value.status !== "ready" && value.status !== "blocked")) return null;
  return { status: value.status, reason: reason.safeParse(value.reason).data ?? "unknown" };
}

/** Caller holds the seat send admission. Keep the first saved failure, including invalid existing files. */
export function recordAgentResumeFailure(input: Omit<AgentResumeFailure, "schema" | "cause" | "body_input" | "native_outcome" | "observed_at">, error: unknown): void {
  try {
    const value = agentResumeFailureSchema.parse({ ...input, schema: "aiterm.agent-resume-failure.v1", cause: safeResumeFailureCause(error),
      body_input: "not_sent", native_outcome: "unknown", observed_at: new Date().toISOString() });
    const file = agentMetadataPath(value.session_id, value.launch_id).replace(/\.agent\.json$/, ".resume-failure.json");
    try { fs.lstatSync(file); return; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return; }
    writeJson0600(file, value);
  } catch { /* Diagnostics must not alter resume, its exception, or its attempt record. */ }
}
