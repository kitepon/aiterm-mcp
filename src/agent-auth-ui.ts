import { createHash } from "node:crypto";
import { AitermError } from "./errors.js";
import { z } from "zod";
import type { AgentAuthPane, AgentAuthResult } from "./agent-auth.js";

// Existing native identities, not an application flow ID. Legacy launch_id stays null.
export const authBindingSchema = z.object({
  session_id: z.string(), launch_id: z.string().nullable(),
  metadata_identity: z.string(), native_id: z.string(), pane_id: z.string(),
  server_pid: z.number().int().positive(), server_started: z.string(),
  pane_pid: z.number().int().positive(), pane_started: z.string(),
}).strict();
export type AuthBinding = z.infer<typeof authBindingSchema>;
export const authResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("authorization_code"), value: z.string().min(1).max(8192).regex(/^[!-~]+$/) }).strict(),
  z.object({ kind: z.literal("choice"), id: z.string().regex(/^option-[1-9]$/) }).strict(),
]);
export type AuthResponse = z.infer<typeof authResponseSchema>;
export const authUiSchema = z.object({
  schema: z.literal("aiterm.auth-ui.v1"),
  stage: z.enum(["open_url", "device_code", "paste_code", "select", "waiting", "complete", "failed", "unavailable"]),
  title: z.string(), message: z.string(), binding: authBindingSchema.nullable(),
  url: z.string().nullable(), user_code: z.string().nullable(),
  input: z.enum(["authorization_code", "choice"]).nullable(),
  prompt_digest: z.string().nullable(),
  choices: z.array(z.object({ id: z.string(), label: z.string() }).strict()),
}).strict();
export type AuthUi = z.infer<typeof authUiSchema>;
export type AuthPaneUi = Pick<AuthUi, "stage" | "title" | "message" | "input" | "choices">;
export function authPromptDigest(pane: AgentAuthPane): string | null {
  return pane.ui ? createHash("sha256").update(JSON.stringify({ ui: pane.ui, url: pane.url })).digest("hex") : null;
}
export function authUi(result: AgentAuthResult, pane: AgentAuthPane | undefined, binding: AuthBinding | null): AuthUi {
  const base = { schema: "aiterm.auth-ui.v1" as const, binding, url: result.url, user_code: result.user_code,
    choices: [], input: null, prompt_digest: pane ? authPromptDigest(pane) : null };
  if (result.status === "authenticated") return { ...base, stage: "complete", title: "認証完了", message: "公式CLIで認証完了を確認しました。" };
  if (result.status === "failed") return { ...base, stage: "failed", title: "認証を完了できません", message: result.message ?? "公式CLIの状態を確認してください。" };
  if (pane?.ui && binding) return { ...base, ...pane.ui };
  if (binding && result.url) return { ...base, stage: result.user_code ? "device_code" : "open_url", title: "公式認証ページを開く",
    message: result.user_code ? "公式ページで表示のデバイスコードを入力してください。" : "公式ページで認証し、この画面で完了をお待ちください。" };
  return { ...base, stage: result.input_required ? "unavailable" : "waiting", title: "認証状態を確認中",
    message: result.input_required ? "公式画面の入力段階を安全に識別できません。入力は送信できません。" : "公式CLIの認証結果を待っています。" };
}

export class AuthResponseError extends AitermError {
  constructor(public readonly reason_code: string, public readonly effect: "not_issued" | "unknown", message: string) { super(`${reason_code}: ${message}`, 2); }
}
export const authResponseFailureSchema = z.object({ schema: z.literal("aiterm.auth-response-error.v1"),
  harness: z.string(), session_id: z.string().nullable(), code: z.string(), effect: z.enum(["not_issued", "unknown"]), message: z.string() }).strict();
