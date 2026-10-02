// 認証receiptの共通形。資格情報と生のCLI出力は保存・公開しない。
import type { AgentHarness, AgentKind } from "./agent-shared.js";

export interface AgentAuthResult {
  schema: "aiterm.agent-auth-result.v1";
  harness: AgentHarness;
  status: "waiting" | "authenticated" | "blocked" | "failed";
  session_id: string | null;
  url: string | null;
  user_code: string | null;
  input_required: boolean;
  message: string | null;
}

export interface AgentAuthPlan {
  args: string[];
  env: [string, string][];
}

export interface AgentAuthStatus {
  status: "authenticated" | "unauthenticated" | "failed" | "unsupported";
  verify_onboarding?: boolean;
  message: string | null;
}

export interface AgentAuthPane {
  url: string | null;
  user_code: string | null;
  input_required: boolean;
  message: string | null;
  failed?: boolean;
  onboarding_complete?: boolean;
}

export interface AgentAuthMetadata {
  kind: AgentKind;
  bin: string;
  cwd: string;
  phase: "login" | "onboarding";
  env_vars: string[];
}

/** CLIが示した公式HTTPS URLだけを返す。tokenやOAuth callbackのcodeは公開しない。 */
export function authUrl(screen: string, hosts: readonly string[]): string | null {
  for (const match of screen.matchAll(/https:\/\/[^\s<>"']+/g)) {
    const candidate = match[0].replace(/[).,;]+$/, "");
    let url: URL;
    try { url = new URL(candidate); } catch { continue; }
    if (url.username || url.password || !hosts.includes(url.hostname) || url.hash) continue;
    if ([...url.searchParams.keys()].some(key => /^(?:access_token|refresh_token|id_token|token|code)$/i.test(key))) continue;
    return candidate;
  }
  return null;
}

/** 明示されたdevice code欄だけを読む。一般のtokenや認証情報は抽出しない。 */
export function authUserCode(screen: string): string | null {
  return /(?:enter (?:this|the following) (?:one[- ]time )?code|(?:one[- ]time |user |device |verification )?code\s*:)(?:\s*\([^\n]*\))?\s*:?[ \t]*(?:\n\s*)?([A-Z0-9]{4}-[A-Z0-9]{4,5})\b/i.exec(screen)?.[1] ?? null;
}
