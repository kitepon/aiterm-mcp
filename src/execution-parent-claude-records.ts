// Private historical file correlation only. No native turn alias, live endpoint,
// completion fence, cleanup authorization or body export. No mkdir/probe/RPC.
import * as fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { executionPointSchema, executionRequestSchema } from "./execution-contract.js";
import { executionActorSchema } from "./execution-inventory.js";
import { parentSourceSchema } from "./execution-parent-source.js";
import type { ExecutionState } from "./execution-store.js";
import { ExecutionError } from "./execution-wire.js";

type Binding = ExecutionState["parent_deliveries"][number];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const endpointSchema = z.object({ kind: z.literal("claude"), session_id: z.uuid(),
  request_id: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/), hook_root: z.string() }).strict();
const invocationSchema = z.object({ request_id: endpointSchema.shape.request_id, session_id: z.uuid(), agent_id: z.null(),
  parent_pid: executionActorSchema.shape.pid, parent_started_identity: executionActorSchema.shape.started_identity }).strict();
const resultSchema = z.object({ schema: z.literal("aiterm.claude-turn-result.v2"),
  operation_id: z.string().regex(/^sha256:[0-9a-f]{64}$/), vendor_session_id: z.uuid(),
  result_digest: z.string().regex(/^[0-9a-f]{64}$/), result_bytes: z.number().int().nonnegative().max(4 * 1024 * 1024), text: z.string() }).strict();
export const claudeParentRecordDiagnosisSchema = z.object({
  parent_invocation: z.enum(["matched", "unconfirmed"]), delivery_binding: z.enum(["matched", "unconfirmed"]),
  child_stop: z.enum(["recorded", "unconfirmed"]), missing: z.array(z.string()),
  native_input: z.literal("unconfirmed"), interruption: z.literal("unconfirmed"), session_preserved: z.literal("unconfirmed"),
  native_fence: z.literal("unknown"), clearance: z.literal("retained"), retry: z.literal("none"),
}).strict().refine(value => value.child_stop !== "recorded" || (value.parent_invocation === "matched" && value.delivery_binding === "matched"));

export function createClaudeParentRecordDiagnosis(input: { stateRoot: string; assertScope(): void }) {
  if (!path.isAbsolute(input.stateRoot) || /[\r\n\0]/.test(input.stateRoot)) throw new ExecutionError("EXECUTION_INVALID");
  const root = path.resolve(input.stateRoot), assertScope = input.assertScope;
  return (bindingInput: Readonly<Binding>, endpointInput: unknown) => {
    let parentInvocation: "matched" | "unconfirmed" = "unconfirmed", deliveryBinding: "matched" | "unconfirmed" = "unconfirmed";
    let childStop: "recorded" | "unconfirmed" = "unconfirmed";
    const missing: string[] = [];
    // References are the saved binding, not current decoder/env/operation marker.
    const binding = z.object({ delivery_id: z.uuid(), request: executionRequestSchema, parent: executionPointSchema,
      child: executionPointSchema, source_evidence: parentSourceSchema }).safeParse(bindingInput);
    const endpoint = endpointSchema.safeParse(endpointInput);
    const snapshots: { file: string; stat: fs.BigIntStats }[] = [];
    const stable = (a: fs.BigIntStats, b: fs.BigIntStats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size
      && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && b.isFile();
    const read = (file: string, max: number, offset = 0) => {
      const before = fs.lstatSync(file, { bigint: true });
      if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(Number.MAX_SAFE_INTEGER)
        || offset > Number(before.size) || Number(before.size) - offset > max) throw new Error("records unavailable");
      const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        if (!stable(before, fs.fstatSync(fd, { bigint: true }))) throw new Error("records changed");
        if (offset) {
          const previous = Buffer.alloc(1);
          if (fs.readSync(fd, previous, 0, 1, offset - 1) !== 1 || previous[0] !== 10) throw new Error("cursor is not a line boundary");
        }
        const bytes = Buffer.alloc(Number(before.size) - offset);
        let count = 0;
        while (count < bytes.length) {
          const n = fs.readSync(fd, bytes, count, bytes.length - count, offset + count);
          if (!n) throw new Error("records truncated");
          count += n;
        }
        if (!stable(before, fs.fstatSync(fd, { bigint: true })) || !stable(before, fs.lstatSync(file, { bigint: true })))
          throw new Error("records changed");
        snapshots.push({ file, stat: before }); return bytes.toString("utf8");
      } finally { fs.closeSync(fd); }
    };
    try {
      assertScope();
      if (!binding.success || !endpoint.success) throw new Error("references invalid");
      const saved = binding.data, proof = saved.source_evidence, ep = endpoint.data, child = saved.child;
      if (saved.request.kind !== "mcp" || proof.endpoint.vendor !== "claude" || !same(proof.request, saved.request) || !same(proof.source, saved.parent)
        || saved.request.target_session_id !== child.launch.session_id || !path.isAbsolute(ep.hook_root)
        || path.resolve(ep.hook_root) !== path.join(root, "claude-parent-hooks")
        || ep.session_id !== proof.endpoint.session_id || ep.request_id !== proof.endpoint.request_id) throw new Error("references mismatched");
      const directory = path.join(root, "claude-parent-hooks", ep.request_id);
      const invocation = invocationSchema.parse(JSON.parse(read(path.join(directory, "request.json"), 8192)));
      if (invocation.request_id !== ep.request_id || invocation.session_id !== ep.session_id
        || !same({ pid: invocation.parent_pid, started_identity: invocation.parent_started_identity }, proof.harness_process))
        throw new Error("invocation mismatched");
      parentInvocation = "matched";
      const delivery = z.object({ delivery_id: z.uuid() }).strict().parse(JSON.parse(read(path.join(directory, "delivery.json"), 4096)));
      if (delivery.delivery_id !== saved.delivery_id) throw new Error("delivery mismatched");
      deliveryBinding = "matched";
      if (!child.boundary || child.boundary.operation_id === null || child.boundary.steer_id !== null) {
        missing.push("child_operation_reference_missing");
      } else {
        const stem = path.join(root, "agents", `${child.launch.session_id}.${child.launch.launch_id}`);
        const meta = z.object({ kind: z.literal("claude"), aiterm_session: z.literal(child.launch.session_id),
          launch_id: z.literal(child.launch.launch_id), vendor_session_id: z.uuid(),
          event_file: z.literal(stem + ".events.jsonl"), result_file: z.literal(stem + ".claude-result.json") })
          .parse(JSON.parse(read(stem + ".agent.json", 1024 * 1024)));
        const result = resultSchema.parse(JSON.parse(read(stem + ".claude-result.json", 4 * 1024 * 1024 + 4096)));
        if (result.operation_id !== child.boundary.operation_id || result.vendor_session_id !== meta.vendor_session_id
          || Buffer.byteLength(result.text, "utf8") !== result.result_bytes
          || createHash("sha256").update(result.text, "utf8").digest("hex") !== result.result_digest) throw new Error("result mismatched");
        const events = read(stem + ".events.jsonl", 4 * 1024 * 1024, child.boundary.event_cursor);
        if (!events.endsWith("\n")) throw new Error("partial event");
        const matching = events.trimEnd().split("\n").map(line => JSON.parse(line) as Record<string, unknown>)
          .filter(row => row.type === "agent_done" && row.vendor === "claude" && row.aiterm_session === child.launch.session_id
            && row.launch_id === child.launch.launch_id && row.operation_id === child.boundary!.operation_id);
        if (matching.length !== 1) throw new Error("Stop record missing or ambiguous");
        const event = matching[0];
        if (event.vendor_session_id !== meta.vendor_session_id || event.reason !== "Stop" || event.done_status !== "turn_done"
          || event.turn_id !== null || event.result_digest !== result.result_digest || event.result_bytes !== result.result_bytes)
          throw new Error("Stop record mismatched");
        childStop = "recorded";
      }
      assertScope();
      if (!snapshots.every(row => stable(row.stat, fs.lstatSync(row.file, { bigint: true })))) throw new Error("records changed");
    } catch {
      // Even a once-matching reference becomes unconfirmed if the enclosing
      // read or scope could not be validated. Never return partial native proof.
      parentInvocation = "unconfirmed"; deliveryBinding = "unconfirmed"; childStop = "unconfirmed";
      missing.push("claude_records_unconfirmed");
    }
    return { parent_invocation: parentInvocation, delivery_binding: deliveryBinding, child_stop: childStop,
      missing, native_input: "unconfirmed" as const, interruption: "unconfirmed" as const,
      session_preserved: "unconfirmed" as const, native_fence: "unknown" as const,
      clearance: "retained" as const, retry: "none" as const };
  };
}
