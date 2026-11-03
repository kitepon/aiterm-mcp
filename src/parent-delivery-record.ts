// 配送記録の検証と本文形式。予約・監視・回収・receipt投影はmanagerが持つ。
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { AitermError } from "./errors.js";
import { remoteTargetSchema } from "./remote-contract.js";
import { claudeParentSchema } from "./claude-parent-receiver.js";
import { cursorParentSchema } from "./cursor-parent-receiver.js";
import { executionRequestSchema } from "./execution-contract.js";
import { parentSourceSchema } from "./execution-parent-source.js";
import { executionActorSchema } from "./execution-inventory.js";

export const failureObservationSchema = z.object({
  category: z.enum(["capacity", "rate_limited", "transient", "other"]),
  execution: z.enum(["not_started", "started", "unknown"]),
  boundary: z.object({ event_cursor: z.number().int().nonnegative(), operation_id: z.string().nullable(), turn_id: z.string().nullable(),
    input_id: z.string().regex(/^[a-f0-9]{32}$/).optional() }).strict().nullable(),
  terminal: z.boolean(), future_effects: z.literal("unknown"),
}).strict();

export const recordSchema = z.object({
  schema: z.literal("aiterm.parent-delivery.v1"),
  delivery_id: z.uuid(),
  created_at: z.string(),
  updated_at: z.string(),
  parent: z.union([z.object({ thread_id: z.uuid(), codex_home: z.string() }).strict(), claudeParentSchema, cursorParentSchema]),
  boundary: z.object({
    session_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    launch_id: z.string().regex(/^[0-9a-f]{32}$/),
    vendor: z.enum(["claude", "codex", "grok", "cursor", "antigravity"]),
    harness: z.enum(["claude-code", "codex-cli", "grok-cli", "cursor-cli", "antigravity-cli"]),
    event_cursor: z.number().int().nonnegative(), operation_id: z.string().nullable(),
    input_id: z.string().regex(/^[a-f0-9]{32}$/).optional(),
    // 別端末の子。remote用の保存場所にだけ書き、旧版のreaderへ渡さない。
    remote: remoteTargetSchema.optional(),
  }).strict(),
  state: z.enum(["waiting", "ready", "sending", "submitted", "failed", "unknown"]),
  text: z.string().nullable(),
  child_outcome: z.enum(["done", "closed", "rate_limited", "error"]).nullable(),
  child_turn_id: z.string().nullable(),
  child_error_kind: z.string().nullable().optional(),
  child_vendor_session_id: z.string().nullable().optional(),
  child_failure: failureObservationSchema.optional(),
  error: z.string().nullable(),
  queued_submission_id: z.string().nullable(),
  // Private references for this existing delivery, never a payload/retry queue.
  // Legacy unmounted records retain their original shape.
  execution: z.object({ request: executionRequestSchema, source_evidence: parentSourceSchema.optional(),
    origin_owner: executionActorSchema.optional() }).strict().optional(),
}).strict().superRefine((record, context) => {
  const failed = record.child_failure?.boundary;
  if (failed && (failed.event_cursor !== record.boundary.event_cursor || failed.operation_id !== record.boundary.operation_id
    || failed.turn_id !== record.child_turn_id || failed.input_id !== record.boundary.input_id)) context.addIssue({ code: "custom", message: "failure must match the original child boundary" });
  if (record.execution?.source_evidence && JSON.stringify(record.execution.request) !== JSON.stringify(record.execution.source_evidence.request))
    context.addIssue({ code: "custom", message: "parent delivery source request must match its original reference" });
  const execution = record.execution;
  if (execution?.origin_owner && (execution.request.kind !== "mcp" || !execution.source_evidence
    || execution.origin_owner.pid !== execution.request.process_pid
    || execution.origin_owner.started_identity !== execution.request.process_started_identity
    || JSON.stringify(execution.origin_owner) !== JSON.stringify(execution.source_evidence.mcp_process)))
    context.addIssue({ code: "custom", message: "origin owner must match the original MCP request and source process" });
});

export type DeliveryRecord = z.infer<typeof recordSchema>;

export function readRecord(file: string): DeliveryRecord {
  try {
    const record = recordSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (path.basename(file) !== `${record.delivery_id}.json`) throw new Error("配送IDが一致しません");
    return record;
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    throw new AitermError("PARENT_DELIVERY_STATE_INVALID: 配送記録を読めません", 2);
  }
}

export function answerMessage(record: DeliveryRecord): string {
  return "Aitermの子エージェントからの実行結果です。子の回答として扱ってください。\n" +
    `delivery_id=${record.delivery_id}\nsession=${record.boundary.session_id}\nharness=${record.boundary.harness}\n` +
    `launch_id=${record.boundary.launch_id}\nturn_id=${record.child_turn_id ?? "unknown"}\n` +
    `outcome=${record.child_outcome}\n` +
    (record.child_failure ? `failure=${JSON.stringify(record.child_failure)}\nvendor_session_id=${record.child_vendor_session_id ?? "unknown"}\nerror_kind=${record.child_error_kind ?? "unknown"}\n` : "") +
    `\n${record.text ?? ""}`;
}
