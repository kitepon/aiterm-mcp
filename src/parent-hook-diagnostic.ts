// 親配送hook（Claude Code・Cursor）の登録状態を、利用者設定の読取りだけで要約する。
// 設定の本文、path、環境値は返さない。書込みと修復はaiterm-setupが所有する。
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as steer from "aiterm-steer-delivery";
import { resolveAgentBin } from "./agent-resolver.js";
import { AITERM_PROFILE } from "./steer-profile.js";

export type ParentHookStatus = "ready" | "setup_required" | "not_applicable" | "unverified";
export type ParentHookReason = "hooks_not_registered" | "hooks_disabled" | "hook_script_missing" | "settings_unreadable";
export type ParentHookDiagnostic = { status: ParentHookStatus; reason_code: ParentHookReason | null };
export type ParentDeliveryDiagnostic = {
  diagnostic_schema: "aiterm-mcp.parent-delivery-diagnostics.v1";
  caller: "claude" | "cursor" | "other";
  caller_status: ParentHookStatus;
  setup_command: string;
  hooks: { claude: ParentHookDiagnostic; cursor: ParentHookDiagnostic };
};

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const ready: ParentHookDiagnostic = { status: "ready", reason_code: null };
const required = (reason_code: ParentHookReason): ParentHookDiagnostic => ({ status: "setup_required", reason_code });
const unreadable: ParentHookDiagnostic = { status: "unverified", reason_code: "settings_unreadable" };

function readSettings(file: string): Record<string, unknown> | null | undefined {
  if (!existsSync(file)) return null;
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/u, ""));
    return record(value) ? value : undefined;
  } catch { return undefined; }
}

function detected(kind: "claude" | "cursor", home: string): boolean {
  try { if (resolveAgentBin(kind)) return true; } catch { /* 解決できないCLIは未検出として扱う */ }
  return kind === "cursor" && existsSync(join(home, ".cursor"));
}

/** aiterm-setupが登録するeventのすべてに、当製品のhook入口があり、その入口が実在するか。 */
export function claudeParentHookDiagnostic(file: string): ParentHookDiagnostic {
  const settings = readSettings(file);
  if (settings === undefined) return unreadable;
  if (settings === null || settings.hooks === undefined) return required("hooks_not_registered");
  if (!record(settings.hooks)) return unreadable;
  if (settings.disableAllHooks === true) return required("hooks_disabled");
  const entry = AITERM_PROFILE.hooks.claude;
  const owned = (value: string) => value === entry || value.endsWith(`/${entry}`) || value.endsWith(`\\${entry}`);
  const scripts: string[] = [];
  for (const event of Object.keys(steer.claudeParentHookEntries(AITERM_PROFILE, { command: "", script: entry }))) {
    const groups = settings.hooks[event];
    if (groups !== undefined && !Array.isArray(groups)) return unreadable;
    const found = (groups ?? []).flatMap(group => record(group) && Array.isArray(group.hooks) ? group.hooks : [])
      .filter(hook => record(hook) && hook.type === "command" && Array.isArray(hook.args) && typeof hook.args[0] === "string" && owned(hook.args[0]))
      .map(hook => ((hook as Record<string, unknown>).args as string[])[0]);
    if (found.length === 0) return required("hooks_not_registered");
    scripts.push(...found);
  }
  return scripts.every(script => existsSync(script)) ? ready : required("hook_script_missing");
}

export function cursorParentHookDiagnostic(file: string): ParentHookDiagnostic {
  const document = readSettings(file);
  if (document === undefined) return unreadable;
  return document !== null && steer.cursorParentHooksRegistered(AITERM_PROFILE, document) ? ready : required("hooks_not_registered");
}

/** 呼出元がそのclient自身なら、CLIを解決できなくても設定を読む。それ以外の未検出clientは対象外とする。 */
export function parentDeliveryDiagnostic(caller: "claude" | "cursor" | undefined, options: {
  home?: string; claudeSettings?: string; cursorHooks?: string; detect?: (kind: "claude" | "cursor") => boolean;
} = {}): ParentDeliveryDiagnostic {
  const home = options.home ?? process.env.HOME ?? homedir();
  const detect = options.detect ?? ((kind: "claude" | "cursor") => detected(kind, home));
  const absent: ParentHookDiagnostic = { status: "not_applicable", reason_code: null };
  const hooks = {
    claude: caller === "claude" || detect("claude")
      ? claudeParentHookDiagnostic(options.claudeSettings ?? join(process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "settings.json")) : absent,
    cursor: caller === "cursor" || detect("cursor")
      ? cursorParentHookDiagnostic(options.cursorHooks ?? steer.cursorHooksFile(home)) : absent,
  };
  return {
    diagnostic_schema: "aiterm-mcp.parent-delivery-diagnostics.v1",
    caller: caller ?? "other",
    caller_status: caller ? hooks[caller].status : "not_applicable",
    setup_command: AITERM_PROFILE.setup_command,
    hooks,
  };
}
