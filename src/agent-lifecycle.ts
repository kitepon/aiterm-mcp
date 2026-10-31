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
  kind: z.enum(["claude", "codex"]), vendor_session_id: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/),
  executable: absolute, cwd: absolute, model: z.string().nullable(), reasoning_effort: z.string().nullable(), fast: z.boolean(),
  environment: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().refine(value => !value.includes("\0"))),
}).strict();
export type AgentResumeRecipe = z.infer<typeof agentResumeRecipeSchema>;
const identity = z.object({ pid: z.number().int().positive(), process_group_id: z.number().int().positive().nullable(),
  started_identity: z.string().min(1), argv_digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const agentLifecycleSchema = z.object({ schema: z.literal("aiterm.agent-lifecycle.v1"), launch_id: launchId,
  state: z.enum(["stopping", "hibernated"]), at: z.iso.datetime(), anchor: z.string().min(1),
  native_id: z.string().regex(/^\$\d+$/), pane: identity, recipe_digest: z.string().regex(/^[a-f0-9]{64}$/),
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
