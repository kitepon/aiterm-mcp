// One receipt per opt-in configuration request. Reconciliation never starts work.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { stateRoot, ensureStateRoot } from "./agent-shared.js";
import { writeExecutionCheckpoint } from "./execution-checkpoint.js";
import { withConfigurationEffects } from "./configuration-effect.js";
import { AitermError } from "./errors.js";
import type { AgentConfigureResult } from "./core.js";

export const configurationRequestSchema = z.object({
  id: z.uuid(), launch_id: z.string().regex(/^[a-f0-9]{32}$/), digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const settingsSchema = z.object({ model: z.string().max(512).nullable(), reasoning_effort: z.string().max(512).nullable(), fast: z.boolean().nullable() }).strict();
type SettingsInput = { model?: string | null; reasoning_effort?: string | null; fast?: boolean | null };
export function configurationSettings(input: SettingsInput): z.infer<typeof settingsSchema> {
  return settingsSchema.parse({ model: input.model?.trim() || null, reasoning_effort: input.reasoning_effort?.trim() || null, fast: input.fast ?? null });
}
export function configurationRequestDigest(input: SettingsInput): string {
  return createHash("sha256").update(JSON.stringify(configurationSettings(input))).digest("hex");
}
export const configurationBindingSchema = configurationRequestSchema.extend({ session_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }).strict();
type Binding = z.infer<typeof configurationBindingSchema>;
const resultSchema = z.object({ schema: z.literal("aiterm.agent-configure-result.v1"), session_id: z.string(),
  provider: z.enum(["claude", "codex", "grok", "cursor", "antigravity"]),
  harness: z.enum(["claude-code", "codex-cli", "grok-cli", "cursor-cli", "antigravity-cli"]),
  model: z.string().nullable(), reasoning_effort: z.string().nullable(), fast: z.boolean().nullable() }).strict();
const recordSchema = z.object({ schema: z.literal("aiterm.configuration-request.v1"), binding: configurationBindingSchema,
  requested: settingsSchema, terminal_at: z.iso.datetime().nullable(), native_effect: z.enum(["not_issued", "possible", "selection_excluded"]),
  outcome: z.enum(["applied", "not_applied", "outcome_unknown"]), result: resultSchema.nullable(),
}).strict().refine(value => configurationRequestDigest(value.requested) === value.binding.digest
  && (value.result === null || value.result.session_id === value.binding.session_id)
  && (value.terminal_at !== null || value.result === null && value.outcome === "outcome_unknown")
  && (value.outcome !== "applied" || value.terminal_at !== null && value.result !== null));
type Record = z.infer<typeof recordSchema>;
export const configurationReceiptSchema = z.object({ schema: z.literal("aiterm.agent-configure-request-result.v1"),
  binding: configurationBindingSchema, request_state: z.enum(["not_recorded", "unavailable", "pending_or_unknown", "terminal"]),
  outcome: z.enum(["applied", "not_applied", "outcome_unknown"]), later_effect: z.enum(["excluded", "unconfirmed"]),
  terminal_at: z.iso.datetime().nullable(), result: resultSchema.nullable(),
  current: z.object({ availability: z.literal("unsupported") }).strict(), observed_at: z.iso.datetime(),
}).strict();
export type ConfigurationReceipt = z.infer<typeof configurationReceiptSchema>;
const failureSchema = z.object({ schema: z.literal("aiterm.agent-configure-error.v1"), session_id: z.string(),
  outcome: z.enum(["not_applied", "outcome_unknown"]), effect: z.enum(["not_started", "possible"]) }).strict()
  .refine(value => value.outcome === "not_applied" ? value.effect === "not_started" : value.effect === "possible");
export const configurationToolOutputSchema = z.object({ ...resultSchema.partial().shape, ...configurationReceiptSchema.partial().shape,
  ...z.object(failureSchema.shape).partial().shape,
  schema: z.enum(["aiterm.agent-configure-result.v1", "aiterm.agent-configure-error.v1", "aiterm.agent-configure-request-result.v1"]),
  outcome: configurationReceiptSchema.shape.outcome.optional(),
}).strict().superRefine((value, context) => {
  const schema = value.schema === "aiterm.agent-configure-result.v1" ? resultSchema
    : value.schema === "aiterm.agent-configure-error.v1" ? failureSchema : configurationReceiptSchema;
  if (!schema.safeParse(value).success) context.addIssue({ code: "custom", message: "Invalid configuration result variant" });
});
function directory(binding: Binding): string { return path.join(stateRoot(), "configuration-requests", binding.id); }
function sameBinding(a: Binding, b: Binding): boolean {
  return a.id === b.id && a.session_id === b.session_id && a.launch_id === b.launch_id && a.digest === b.digest;
}
function readRecord(binding: Binding): Record {
  const file = path.join(directory(binding), "receipt.json");
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | noFollow);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > 8192) throw new Error("invalid receipt file");
    const buffer = Buffer.alloc(8193);
    const count = fs.readSync(fd, buffer, 0, buffer.length, 0), after = fs.fstatSync(fd), current = fs.lstatSync(file);
    if (count !== before.size || count > 8192 || after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || current.isSymbolicLink() || current.dev !== after.dev || current.ino !== after.ino) throw new Error("receipt changed");
    const record = recordSchema.parse(JSON.parse(buffer.subarray(0, count).toString("utf8")));
    if (!sameBinding(record.binding, binding)) throw new AitermError("CONFIGURATION_REQUEST_CONFLICT", 2);
    return record;
  } finally { fs.closeSync(fd); }
}
function receipt(binding: Binding, record: Record | null, missing: "not_recorded" | "unavailable" = "unavailable"): ConfigurationReceipt {
  return { schema: "aiterm.agent-configure-request-result.v1", binding,
    request_state: record ? record.terminal_at === null ? "pending_or_unknown" : "terminal" : missing,
    outcome: record?.outcome ?? "outcome_unknown",
    later_effect: record && record.terminal_at !== null && record.native_effect !== "possible" ? "excluded" : "unconfirmed",
    terminal_at: record?.terminal_at ?? null, result: record?.result ?? null,
    current: { availability: "unsupported" }, observed_at: new Date().toISOString() };
}
export function reconcileConfigurationRequest(input: Binding): ConfigurationReceipt {
  const binding = configurationBindingSchema.parse(input);
  try { return receipt(binding, readRecord(binding)); }
  catch (error) {
    if (error instanceof AitermError) throw error;
    // A missing receipt inside a claimed directory never permits a second apply.
    try { fs.lstatSync(directory(binding)); }
    catch (missing) { if ((missing as NodeJS.ErrnoException).code === "ENOENT") return receipt(binding, null, "not_recorded"); }
    return receipt(binding, null);
  }
}
export async function applyConfigurationRequest(input: Binding, settings: SettingsInput, apply: () => Promise<AgentConfigureResult>): Promise<{
  receipt: ConfigurationReceipt; error?: Error;
}> {
  const binding = configurationBindingSchema.parse(input), requested = configurationSettings(settings);
  if (configurationRequestDigest(requested) !== binding.digest) throw new AitermError("CONFIGURATION_REQUEST_DIGEST_MISMATCH: not issued", 2);
  if (process.platform === "win32") throw new AitermError("CONFIGURATION_REQUEST_UNSUPPORTED: durable directory sync unavailable; not issued", 2);
  const parent = path.join(ensureStateRoot(), "configuration-requests");
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  try { fs.mkdirSync(directory(binding), { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return { receipt: reconcileConfigurationRequest(binding) };
  }
  const record: Record = { schema: "aiterm.configuration-request.v1", binding, requested, terminal_at: null,
    native_effect: "not_issued", outcome: "outcome_unknown", result: null };
  const save = () => writeExecutionCheckpoint(path.join(directory(binding), "receipt.json"), recordSchema.parse(record));
  save(); // A failed durable admission leaves a claimed, non-replayable request.
  let failure: Error | undefined;
  try {
    record.result = await withConfigurationEffects(() => {
      if (record.native_effect === "possible") return;
      record.native_effect = "possible";
      save(); // Mark before native input; a failed checkpoint refuses input.
    }, apply);
    record.outcome = "applied";
  } catch (error) {
    failure = error instanceof Error ? error : new Error("configuration failed");
    const detail = (failure as Error & { configurationFailure?: { outcome: string } }).configurationFailure;
    record.outcome = detail?.outcome === "not_applied" ? "not_applied" : "outcome_unknown";
    // UI input was issued, but the adapter read the picker closed before any selecting key (configure-reconcile.md).
    if (record.outcome === "not_applied" && record.native_effect === "possible" && (failure as AitermError).configureRefusal?.selection_excluded)
      record.native_effect = "selection_excluded";
  }
  record.terminal_at = new Date().toISOString();
  try { save(); }
  catch { return { receipt: receipt(binding, null), error: new AitermError("CONFIGURATION_RECEIPT_UNAVAILABLE: do not replay", 2) }; }
  return { receipt: receipt(binding, record), ...(failure ? { error: failure } : {}) };
}
