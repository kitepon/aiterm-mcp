import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { agentMetadataPath, writeJson0600, type AgentMetadata } from "./agent-shared.js";
import { AitermError } from "./errors.js";

const launchId = z.string().regex(/^[a-f0-9]{32}$/);
const absolute = z.string().min(1).refine(value => path.isAbsolute(value) && !value.includes("\0"));
export const agentResumeRecipeSchema = z.object({
  schema: z.literal("aiterm.agent-resume.v1"), launch_id: launchId,
  kind: z.enum(["claude", "codex"]), vendor_session_id: z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i),
  executable: absolute, cwd: absolute, configuration_root: absolute, model: z.string().nullable(), reasoning_effort: z.string().nullable(), fast: z.boolean(),
  environment: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().refine(value => !value.includes("\0")).nullable()),
}).strict();
export type AgentResumeRecipe = z.infer<typeof agentResumeRecipeSchema>;
const identity = z.object({ pid: z.number().int().positive(), process_group_id: z.number().int().positive().nullable(),
  started_identity: z.string().min(1), argv_digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const agentLifecycleSchema = z.object({ schema: z.literal("aiterm.agent-lifecycle.v1"), launch_id: launchId,
  state: z.enum(["stopping", "hibernated"]), socket: z.string().min(1).optional(), at: z.iso.datetime(), anchor: z.string().min(1),
  native_id: z.string().regex(/^\$\d+$/), pane: identity, resume_proof_digest: z.string().regex(/^[a-f0-9]{64}$/).optional(), recipe_digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type AgentLifecycle = z.infer<typeof agentLifecycleSchema>;
type Launch = Pick<AgentMetadata, "aiterm_session" | "launch_id">;
const file = (meta: Launch, suffix: string) => agentMetadataPath(meta.aiterm_session, meta.launch_id).replace(/\.agent\.json$/, suffix);
const unavailable = () => new AitermError("AGENT_LIFECYCLE_UNCONFIRMED: 席の休止・復帰記録を確認できません。", 2);
function read<T>(meta: Launch, suffix: string, schema: z.ZodType<T>): T | null {
  let body: string;
  try {
    const item = fs.lstatSync(file(meta, suffix));
    if (!item.isFile() || item.isSymbolicLink() || item.size > 4 * 1024 * 1024) throw unavailable();
    body = fs.readFileSync(file(meta, suffix), "utf8");
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw unavailable(); }
  try { return schema.parse(JSON.parse(body)); } catch { throw unavailable(); }
}
export function readAgentResumeRecipe(meta: Launch): AgentResumeRecipe | null {
  const value = read(meta, ".resume.json", agentResumeRecipeSchema);
  if (value && value.launch_id !== meta.launch_id) throw unavailable();
  return value;
}
export function writeAgentResumeRecipe(meta: AgentMetadata, input: AgentResumeRecipe): void {
  const value = agentResumeRecipeSchema.parse(input);
  if (value.launch_id !== meta.launch_id || value.vendor_session_id !== meta.vendor_session_id || value.kind !== meta.kind) throw unavailable();
  writeJson0600(file(meta, ".resume.json"), value);
}
export function agentResumeRecipeDigest(recipe: AgentResumeRecipe): string {
  return createHash("sha256").update(JSON.stringify(agentResumeRecipeSchema.parse(recipe))).digest("hex");
}
export function readAgentLifecycle(meta: Launch): AgentLifecycle | null {
  const value = read(meta, ".lifecycle.json", agentLifecycleSchema);
  if (value && value.launch_id !== meta.launch_id) throw unavailable();
  return value;
}
export function writeAgentLifecycle(meta: Launch, input: AgentLifecycle): void {
  const value = agentLifecycleSchema.parse(input);
  if (value.launch_id !== meta.launch_id) throw unavailable();
  writeJson0600(file(meta, ".lifecycle.json"), value);
}
export function cancelAgentStopping(meta: Launch, anchor: string): void {
  const value = readAgentLifecycle(meta);
  if (value === null) return;
  if (value.state !== "stopping" || value.anchor !== anchor) throw unavailable();
  fs.unlinkSync(file(meta, ".lifecycle.json"));
}

export const resumeAttemptSchema = z.object({ schema: z.literal("aiterm.agent-resume-attempt.v1"), launch_id: launchId,
  next_launch_id: launchId, state: z.enum(["resuming", "ready", "failed"]), at: z.iso.datetime(),
  recipe_digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type AgentResumeAttempt = z.infer<typeof resumeAttemptSchema>;
export function readAgentResumeAttempt(meta: Launch): AgentResumeAttempt | null {
  const value = read(meta, ".resume-attempt.json", resumeAttemptSchema);
  if (value && value.launch_id !== meta.launch_id) throw unavailable();
  return value;
}
export function writeAgentResumeAttempt(meta: Launch, value: AgentResumeAttempt): void {
  if (value.launch_id !== meta.launch_id || value.next_launch_id === meta.launch_id) throw unavailable();
  writeJson0600(file(meta, ".resume-attempt.json"), resumeAttemptSchema.parse(value));
}

export const resumeNativeSchema = z.object({ schema: z.literal("aiterm.agent-resume-native.v1"), launch_id: launchId,
  native_id: z.string().regex(/^\$\d+$/), session_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  server_pid: z.number().int().positive(), server_started_identity: z.string().min(1),
  pane_id: z.string().regex(/^%\d+$/), pane_pid: z.number().int().positive(), pane_started_identity: z.string().min(1),
}).strict();
export type AgentResumeNative = z.infer<typeof resumeNativeSchema>;
export function readAgentResumeNative(meta: Launch): AgentResumeNative | null {
  const value = read(meta, ".resume-native.json", resumeNativeSchema);
  if (value && (value.launch_id !== meta.launch_id || value.session_id !== meta.aiterm_session)) throw unavailable();
  return value;
}
export function writeAgentResumeNative(meta: Launch, value: AgentResumeNative): void {
  if (value.launch_id !== meta.launch_id || value.session_id !== meta.aiterm_session) throw unavailable();
  writeJson0600(file(meta, ".resume-native.json"), resumeNativeSchema.parse(value));
}


const idleClockSchema = z.object({ schema: z.literal("aiterm.agent-idle-clock.v1"), launch_id: launchId,
  token: launchId, owner: z.object({ pid: z.number().int().positive(), started_identity: z.string().min(1) }).strict(),
  anchor: z.string().nullable(), wake_at: z.iso.datetime() }).strict();
export type AgentIdleClock = z.infer<typeof idleClockSchema>;
export function readAgentIdleClock(meta: Launch): AgentIdleClock | null {
  const value = read(meta, ".idle-clock.json", idleClockSchema);
  if (value && value.launch_id !== meta.launch_id) throw unavailable();
  return value;
}
export function writeAgentIdleClock(meta: Launch, input: AgentIdleClock): void {
  const value = idleClockSchema.parse(input);
  if (value.launch_id !== meta.launch_id) throw unavailable();
  writeJson0600(file(meta, ".idle-clock.json"), value);
}
export function retireAgentIdleClock(meta: Launch, token?: string): void {
  const value = readAgentIdleClock(meta);
  if (value === null || (token !== undefined && value.token !== token)) return;
  fs.unlinkSync(file(meta, ".idle-clock.json"));
}


export const resumeTemplateSchema = agentResumeRecipeSchema.omit({ vendor_session_id: true, fast: true }).extend({
  schema: z.literal("aiterm.agent-resume-template.v1"), state: z.enum(["confirmed", "unconfirmed"]),
}).strict();
export type AgentResumeTemplate = z.infer<typeof resumeTemplateSchema>;
export function readAgentResumeTemplate(meta: Launch): AgentResumeTemplate | null {
  const value = read(meta, ".resume-template.json", resumeTemplateSchema);
  if (value && value.launch_id !== meta.launch_id) throw unavailable();
  return value;
}
export function writeAgentResumeTemplate(meta: AgentMetadata, input: AgentResumeTemplate): void {
  const value = resumeTemplateSchema.parse(input);
  if (value.launch_id !== meta.launch_id || value.kind !== meta.kind) throw unavailable();
  writeJson0600(file(meta, ".resume-template.json"), value);
}
export function captureAgentResumeTemplate(meta: AgentMetadata, effort: string | null, envNames: string[], configurationRoot: string, env = process.env): void {
  if (meta.kind !== "claude" && meta.kind !== "codex") return;
  // Explicit credential variables cannot be persisted as a conversation recipe.
  if (envNames.some(name => /(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTH)$/i.test(name))) return;
  writeAgentResumeTemplate(meta, { schema: "aiterm.agent-resume-template.v1", launch_id: meta.launch_id, kind: meta.kind,
    executable: meta.agent_executable!, cwd: meta.cwd!, configuration_root: configurationRoot, model: meta.model ?? null, reasoning_effort: effort,
    environment: Object.fromEntries([...new Set([...envNames, ...(meta.kind === "claude" ? ["CLAUDE_CONFIG_DIR"] : [])])].map(name => [name, env[name] ?? null])), state: "confirmed" });
}
export function finishAgentResumeConfiguration(meta: AgentMetadata, before: AgentResumeTemplate, model: string | null, effort: string | null): void {
  const complete = !!model && !!effort;
  const known = before.state === "confirmed" && (!model || model === before.model || effort !== null);
  writeAgentResumeTemplate(meta, { ...before, model: model ?? before.model, reasoning_effort: effort ?? before.reasoning_effort,
    state: complete || known ? "confirmed" : "unconfirmed" });
}
export function refreshAgentResumeRecipe(meta: AgentMetadata): AgentResumeRecipe | null {
  const template = readAgentResumeTemplate(meta);
  if (!template) {
    const recipe = readAgentResumeRecipe(meta);
    return recipe?.model && recipe.reasoning_effort
      && (meta.kind !== "claude" || Object.hasOwn(recipe.environment, "CLAUDE_CONFIG_DIR")) ? recipe : null;
  }
  if (template.state !== "confirmed" || !template.model || !template.reasoning_effort || template.model !== meta.model
    || template.executable !== meta.agent_executable || template.cwd !== meta.cwd || typeof meta.fast !== "boolean") return null;
  if (meta.kind === "claude" && (!Object.hasOwn(template.environment, "CLAUDE_CONFIG_DIR")
    || !["low", "medium", "high", "xhigh", "max"].includes(template.reasoning_effort))) return null;
  const { state, ...settings } = template;
  const candidate = agentResumeRecipeSchema.safeParse({ ...settings, schema: "aiterm.agent-resume.v1",
    vendor_session_id: meta.vendor_session_id, fast: meta.fast });
  if (!candidate.success) return null;
  const previous = readAgentResumeRecipe(meta);
  if (!previous || agentResumeRecipeDigest(previous) !== agentResumeRecipeDigest(candidate.data)) writeAgentResumeRecipe(meta, candidate.data);
  return candidate.data;
}

export const resumeResolutionSchema = z.object({ schema: z.literal("aiterm.agent-resume-resolution.v1"),
  launch_id: launchId, previous_launch_id: launchId, vendor_session_id: z.string().uuid(),
  attempt_digest: z.string().regex(/^[a-f0-9]{64}$/), recipe_digest: z.string().regex(/^[a-f0-9]{64}$/),
  resume_proof_digest: z.string().regex(/^[a-f0-9]{64}$/), native_digest: z.string().regex(/^[a-f0-9]{64}$/), at: z.iso.datetime(),
}).strict().refine(value => value.launch_id !== value.previous_launch_id);
export type AgentResumeResolution = z.infer<typeof resumeResolutionSchema>;
export function agentResumeRecordDigest(value: AgentResumeAttempt | AgentResumeNative): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function readAgentResumeResolution(meta: Launch): AgentResumeResolution | null {
  const value = read(meta, ".resume-resolution.json", resumeResolutionSchema);
  if (value && value.launch_id !== meta.launch_id) throw unavailable();
  return value;
}
export function writeAgentResumeResolution(meta: Launch, input: AgentResumeResolution): void {
  const value = resumeResolutionSchema.parse(input);
  if (value.launch_id !== meta.launch_id) throw unavailable();
  writeJson0600(file(meta, ".resume-resolution.json"), value);
}

export const recoveryOriginSchema = z.object({ schema: z.literal("aiterm.agent-resume-recovery-origin.v1"),
  launch_id: launchId, previous_launch_id: launchId, socket: z.string().min(1), at: z.iso.datetime(),
  failed_attempt_digest: z.string().regex(/^[a-f0-9]{64}$/), recipe_digest: z.string().regex(/^[a-f0-9]{64}$/),
  resume_proof_digest: z.string().regex(/^[a-f0-9]{64}$/), previous_native_digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(value => value.launch_id !== value.previous_launch_id);
export type AgentResumeRecoveryOrigin = z.infer<typeof recoveryOriginSchema>;
export function readAgentResumeRecoveryOrigin(meta: Launch): AgentResumeRecoveryOrigin | null {
  const value = read(meta, ".resume-recovery-origin.json", recoveryOriginSchema);
  if (value && value.launch_id !== meta.launch_id) throw unavailable();
  return value;
}
export function writeAgentResumeRecoveryOrigin(meta: Launch, input: AgentResumeRecoveryOrigin): void {
  const value = recoveryOriginSchema.parse(input);
  if (value.launch_id !== meta.launch_id) throw unavailable();
  writeJson0600(file(meta, ".resume-recovery-origin.json"), value);
}
/** This authorizes a cold resume source, never a successful stop or native liveness. */
export function confirmedAgentResumeRecoveryOrigin(meta: AgentMetadata): AgentResumeRecoveryOrigin | null {
  const origin = readAgentResumeRecoveryOrigin(meta);
  if (!origin) return null;
  const attempt = readAgentResumeAttempt({ aiterm_session: meta.aiterm_session, launch_id: origin.previous_launch_id });
  const recipe = readAgentResumeRecipe(meta), native = readAgentResumeNative(meta);
  if (meta.kind !== "codex" || meta.resumed_from !== origin.previous_launch_id || !attempt || attempt.state !== "failed"
    || attempt.next_launch_id !== meta.launch_id || agentResumeRecordDigest(attempt) !== origin.failed_attempt_digest
    || !recipe || recipe.vendor_session_id !== meta.vendor_session_id || agentResumeRecipeDigest(recipe) !== origin.recipe_digest
    || !native || agentResumeRecordDigest(native) !== origin.previous_native_digest) throw unavailable();
  return origin;
}
