// Validates existing core observe/wait contracts. The callbacks may call core
// directly. Evidence callbacks must not re-enter ExecutionStore (service holds
// its short lock while validating evidence); guardedClose runs outside that
// transaction and must use the existing issued slot. No live I/O at import.
import { z } from "zod";
import { executionLaunchSchema, executionPointSchema, type ExecutionPoint, type ExecutionLaunch } from "./execution-contract.js";
import { ExecutionError, executionTransportSourceSchema, type ExecutionRegister } from "./execution-wire.js";
import type { ExecutionRuntime } from "./execution-service.js";

// Names already injected by core's agent launchers. Forward dynamically from
// the calling CLI into its stdio MCP, never from a supervisor's latest job.
export const EXECUTION_SOURCE_ENV_NAMES = [
  "AITERM_SESSION_ID", "AITERM_AGENT_SESSION_ID", "AITERM_AGENT_LAUNCH_ID",
] as const;
// State and multiplexer selection are independent of caller identity. Preserve
// present values; do not manufacture empty values or unresolved ${env:...}.
export const EXECUTION_SCOPE_ENV_NAMES = [
  "AITERM_STATE_BASE", "TMPDIR", "XDG_RUNTIME_DIR", "TEMP", "TMP",
] as const;

/** Snapshot at transport startup; current runtime generation still must match.
 * This is local transport context, not authentication against hostile clients.
 * Native turn/tool identity is unavailable here and must remain null.
 */
export function executionSourceFromEnvironment(env: Readonly<Record<string, string | undefined>>): ExecutionPoint | null {
  const primary = env.AITERM_SESSION_ID, alias = env.AITERM_AGENT_SESSION_ID;
  if (primary !== undefined && !executionLaunchSchema.shape.session_id.safeParse(primary).success) return null;
  if (alias !== undefined && !executionLaunchSchema.shape.session_id.safeParse(alias).success) return null;
  if (primary !== undefined && alias !== undefined && primary !== alias) return null;
  const launch = executionLaunchSchema.safeParse({
    session_id: primary ?? alias, launch_id: env.AITERM_AGENT_LAUNCH_ID,
  });
  return launch.success ? { launch: launch.data, boundary: null } : null;
}

const observeSchema = z.object({
  schema: z.literal("aiterm.pty-observe-result.v1"), session_id: executionLaunchSchema.shape.session_id,
  exists: z.boolean(), launch_id: executionLaunchSchema.shape.launch_id.nullable(),
});
const waitSchema = z.object({
  schema: z.literal("aiterm.agent-wait-result.v1"), session_id: executionLaunchSchema.shape.session_id,
  launch_id: executionLaunchSchema.shape.launch_id,
  outcome: z.enum(["done", "running", "timeout", "closed", "rate_limited", "error", "not_taken"]),
  operation_id: z.string().nullable(), turn_id: z.string().nullable(),
  steer: z.object({ placement: z.enum(["same_turn", "next_turn", "unknown"]) }).optional(),
});
export interface ExecutionRuntimeBindings {
  observeSession(session: string): unknown | Promise<unknown>;
  observeSessionSync?(session: string): unknown;
  // Complete native session listing from this exact product/multiplexer scope.
  // Unknown/malformed or duplicated IDs must not prove absence or ownership.
  observeNativeSessionsSync?(): unknown;
  observeDone(session: string, options: { cursor: number; operation_id?: string; steer?: string; timeout: 0 }): Promise<unknown>;
  // For a direct stdio transport only. Read once at factory construction, never
  // reinterpret an env change or an incoming registration as caller context.
  sourceEnvironment?: Readonly<Record<string, string | undefined>>;
  // This context is resolved by the trusted runtime/Bridge transport adapter.
  // Never implement it by selecting a latest job or blindly echoing a claim.
  sourceContext?(input: ExecutionRegister): Promise<ExecutionPoint | null>;
  // Must share admission with launch/send/configure and compare the expected
  // generation at the actual effect. A name-only core.close is not a substitute.
  guardedClose?(expected: ExecutionLaunch): Promise<void>;
  invocationFence?(point: ExecutionPoint): Promise<"closed" | "unknown">;
  relationCoverage?(roots: ExecutionLaunch[], sessionIdHint?: string): Promise<"complete" | "incomplete">;
  observeInterruptionSync?(point: ExecutionPoint): unknown;
  selectInterruptionSync?(expected: ExecutionLaunch): unknown;
  interruptKeySync?(point: ExecutionPoint): unknown;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function createExecutionRuntime(bindings: ExecutionRuntimeBindings): ExecutionRuntime {
  for (const name of ["observeInterruptionSync", "selectInterruptionSync", "interruptKeySync"] as const)
    if (bindings[name] !== undefined && typeof bindings[name] !== "function") throw new ExecutionError("EXECUTION_UNSUPPORTED");
  const interruption = bindings.observeInterruptionSync;
  const selectInterruption = bindings.selectInterruptionSync, interruptKey = bindings.interruptKeySync;
  const environmentSource = bindings.sourceEnvironment ? executionSourceFromEnvironment(bindings.sourceEnvironment) : null;
  const parseObservation = (session: string, value: unknown): Awaited<ReturnType<ExecutionRuntime["observe"]>> => {
    try {
      const result = observeSchema.parse(value);
      if (result.session_id !== session) return { state: "unknown" };
      if (!result.exists) return result.launch_id === null ? { state: "absent" } : { state: "unknown" };
      return { state: "present", launch: result.launch_id ? { session_id: session, launch_id: result.launch_id } : null };
    } catch { return { state: "unknown" }; }
  };
  const observe: ExecutionRuntime["observe"] = async session => {
    try { return parseObservation(session, await bindings.observeSession(session)); }
    catch { return { state: "unknown" }; }
  };
  return {
    ...(interruption ? { interruptionSync: (point: ExecutionPoint) => interruption(executionPointSchema.parse(point)) } : {}),
    ...(selectInterruption ? { selectInterruptionSync: (expected: ExecutionLaunch) => selectInterruption(executionLaunchSchema.parse(expected)) } : {}),
    ...(interruptKey ? { interruptKeySync: (point: ExecutionPoint) => interruptKey(executionPointSchema.parse(point)) } : {}),
    observe,
    ...(bindings.observeNativeSessionsSync ? { nativeSessionSync: (session: string) => {
      try {
        const parsed = z.object({ state: z.literal("known"), server: z.object({ pid: z.number().int().positive(),
          started_identity: z.string().min(1).max(256) }).strict().nullable().optional(), sessions: z.array(z.object({
          session_id: executionLaunchSchema.shape.session_id, native_id: z.string().regex(/^\$\d+$/),
        }).strict()) }).strict().parse(bindings.observeNativeSessionsSync!());
        if (new Set(parsed.sessions.map(value => value.session_id)).size !== parsed.sessions.length
          || new Set(parsed.sessions.map(value => value.native_id)).size !== parsed.sessions.length) return { state: "unknown" } as const;
        const target = parsed.sessions.find(value => value.session_id === session);
        return target ? { state: "present", native_id: target.native_id, ...(parsed.server ? { server: parsed.server } : {}) } as const
          : { state: "absent", ...(parsed.server ? { server: parsed.server } : {}) } as const;
      } catch { return { state: "unknown" } as const; }
    } } : {}),
    ...(bindings.observeSessionSync ? { observeSync: (session: string) => {
      try { return parseObservation(session, bindings.observeSessionSync!(session)); }
      catch { return { state: "unknown" } as const; }
    } } : {}),
    async sourceEvidence(input, transportContext) {
      let context: ExecutionPoint | null = null;
      try {
        const resolved = transportContext !== undefined ? executionTransportSourceSchema.parse(transportContext).source
          : bindings.sourceContext ? await bindings.sourceContext(input) : environmentSource;
        context = resolved ? executionPointSchema.parse(resolved) : null;
      } catch { /* no runtime proof */ }
      if (!context) return { runtime_launch: null, caller_bound: false, invocation_boundary: null };
      const current = await observe(context.launch.session_id);
      return { runtime_launch: current.state === "present" ? current.launch : null,
        caller_bound: current.state === "present" && same(current.launch, context.launch),
        invocation_boundary: context.boundary };
    },
    async completion(point) {
      const unknown = { state: "unknown", fence: "unknown" } as const;
      const fixed = executionPointSchema.safeParse(point);
      if (!fixed.success) return unknown;
      point = fixed.data;
      if (!point.boundary) return unknown;
      const before = await observe(point.launch.session_id);
      if (before.state !== "present" || !same(before.launch, point.launch)) return unknown;
      try {
        const boundary = point.boundary;
        // A steer follows its own ledger; operation_id and steer are mutually
        // exclusive in the existing core wait API. Do not weaken this silently.
        if (boundary.steer_id && boundary.operation_id) return unknown;
        const result = waitSchema.parse(await bindings.observeDone(point.launch.session_id, {
          cursor: boundary.event_cursor, timeout: 0,
          ...(boundary.operation_id ? { operation_id: boundary.operation_id } : {}),
          ...(boundary.steer_id ? { steer: boundary.steer_id } : {}),
        }));
        if (result.session_id !== point.launch.session_id || result.launch_id !== point.launch.launch_id
          || (boundary.operation_id && result.operation_id !== boundary.operation_id)
          || (boundary.turn_id && result.turn_id !== boundary.turn_id)) return unknown;
        if (boundary.steer_id && (!result.steer || result.steer.placement === "unknown")) return unknown;
        const after = await observe(point.launch.session_id);
        if (result.outcome === "closed")
          return after.state === "absent" ? { state: "interrupted", fence: "closed" } : unknown;
        if (after.state !== "present" || !same(after.launch, point.launch)) return unknown;
        // core's typed error means the harness recorded a terminal turn error;
        // generic MCP/RPC errors do not satisfy waitSchema and cannot get here.
        if (result.outcome !== "done" && result.outcome !== "error") return unknown;
        const evidence = await bindings.invocationFence?.(structuredClone(point)).catch(() => "unknown" as const) ?? "unknown";
        const final = await observe(point.launch.session_id);
        if (final.state !== "present" || !same(final.launch, point.launch)) return unknown;
        const fence = evidence === "closed" ? "closed" : "unknown";
        return { state: "completed", fence };
      } catch { return unknown; }
    },
    async close(expected) {
      if (!bindings.guardedClose) throw new ExecutionError("EXECUTION_UNSUPPORTED", "not_started");
      await bindings.guardedClose(executionLaunchSchema.parse(expected));
    },
    async coverage(roots, sessionIdHint) {
      try { return await bindings.relationCoverage?.(roots, sessionIdHint) ?? "incomplete"; }
      catch { return "incomplete"; }
    },
  };
}
