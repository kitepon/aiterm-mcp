// Validates existing core observe/wait contracts. The callbacks may call core
// directly. Evidence callbacks must not re-enter ExecutionStore (service holds
// its short lock while validating evidence); guardedClose runs outside that
// transaction and must use the existing issued slot. No live I/O at import.
import { z } from "zod";
import { executionLaunchSchema, executionPointSchema, type ExecutionPoint, type ExecutionLaunch } from "./execution-contract.js";
import { ExecutionError, type ExecutionRegister } from "./execution-wire.js";
import type { ExecutionRuntime } from "./execution-service.js";

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
  observeDone(session: string, options: { cursor: number; operation_id?: string; steer?: string; timeout: 0 }): Promise<unknown>;
  // This context is resolved by the trusted runtime/Bridge transport adapter.
  // Never implement it by selecting a latest job or blindly echoing a claim.
  sourceContext?(input: ExecutionRegister): Promise<ExecutionPoint | null>;
  // Must share admission with launch/send/configure and compare the expected
  // generation at the actual effect. A name-only core.close is not a substitute.
  guardedClose?(expected: ExecutionLaunch): Promise<void>;
  invocationFence?(point: ExecutionPoint): Promise<"closed" | "unknown">;
  relationCoverage?(roots: ExecutionLaunch[], sessionIdHint?: string): Promise<"complete" | "incomplete">;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function createExecutionRuntime(bindings: ExecutionRuntimeBindings): ExecutionRuntime {
  const observe: ExecutionRuntime["observe"] = async session => {
    try {
      const result = observeSchema.parse(await bindings.observeSession(session));
      if (result.session_id !== session) return { state: "unknown" };
      if (!result.exists) return result.launch_id === null ? { state: "absent" } : { state: "unknown" };
      return { state: "present", launch: result.launch_id ? { session_id: session, launch_id: result.launch_id } : null };
    } catch { return { state: "unknown" }; }
  };
  return {
    observe,
    async sourceEvidence(input) {
      let context: ExecutionPoint | null = null;
      try {
        const resolved = await bindings.sourceContext?.(input);
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
        const fence = await bindings.invocationFence?.(point).catch(() => "unknown" as const) ?? "unknown";
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
