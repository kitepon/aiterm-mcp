// Claude Codeの設定root（CLAUDE_CONFIG_DIR）を席・認証ごとに選ぶ時の受入。資格情報は読まない。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AitermError } from "./errors.js";

/** root is the resolved directory; selector is the CLAUDE_CONFIG_DIR value (null = unset, the default root). */
export interface ClaudeConfigRoot { root: string; selector: string | null }

const rejected = (detail: string) => new AitermError(`AGENT_CONFIGURATION_ROOT_REJECTED: ${detail}`, 2);
const real = (value: string): string | null => { try { return fs.realpathSync(value); } catch { return null; } };

export function claudeDefaultConfigRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.HOME ?? os.homedir(), ".claude");
}

/**
 * Accept the default root, or a direct child of a parent listed in AITERM_CLAUDE_CONFIG_ROOTS.
 * Protects against running a seat or a login on credentials of an unintended directory.
 */
export function resolveClaudeConfigurationRoot(requested: string, env: NodeJS.ProcessEnv = process.env): ClaudeConfigRoot {
  if (!path.isAbsolute(requested)) throw rejected("configuration_rootは絶対パスで指定してください。");
  const fallback = path.resolve(claudeDefaultConfigRoot(env));
  const actual = real(requested);
  if (path.resolve(requested) === fallback || (actual !== null && actual === real(fallback))) return { root: fallback, selector: null };
  if (actual === null || !fs.statSync(actual).isDirectory()) throw rejected("configuration_rootのディレクトリがありません。");
  const parents = (env.AITERM_CLAUDE_CONFIG_ROOTS ?? "").split(path.delimiter)
    .filter(parent => path.isAbsolute(parent)).map(real).filter(parent => parent !== null);
  if (!parents.includes(path.dirname(actual)))
    throw rejected("configuration_rootは既定のroot（~/.claude）か、AITERM_CLAUDE_CONFIG_ROOTSに並べた親の直下のディレクトリだけです。");
  return { root: actual, selector: actual };
}

const LOGIN_TOKEN = /^sk-ant-oat01-[A-Za-z0-9_-]{20,}$/u;
/**
 * The login a seat launcher gives a slot: `<parent in AITERM_CLAUDE_CONFIG_ROOTS>/<slot>/oauth-token` as
 * CLAUDE_CODE_OAUTH_TOKEN. When `rootSelected` is false and the slot directory is itself a Claude root (it has
 * `.claude.json`), it is also the root, as for a seat of that slot. Refused rather than read on another account's login.
 */
export function withClaudeSlotLogin(env: NodeJS.ProcessEnv, slot: string, rootSelected = false): NodeJS.ProcessEnv {
  const unavailable = () => new AitermError(`CLAUDE_LOGIN_UNAVAILABLE: claude_login '${slot}' のoauth-tokenを` +
    "AITERM_CLAUDE_CONFIG_ROOTSの下に読めません。一覧は読んでいません。", 2);
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(slot)) throw unavailable();
  for (const parent of (env.AITERM_CLAUDE_CONFIG_ROOTS ?? "").split(path.delimiter).filter(parent => path.isAbsolute(parent))) {
    let token: string;
    try { token = fs.readFileSync(path.join(parent, slot, "oauth-token"), "utf8").trim(); } catch { continue; }
    if (!LOGIN_TOKEN.test(token)) throw unavailable();
    const own = !rootSelected && fs.existsSync(path.join(parent, slot, ".claude.json"))
      ? withClaudeConfigRoot(env, resolveClaudeConfigurationRoot(path.join(parent, slot), env)) : env;
    return { ...own, CLAUDE_CODE_OAUTH_TOKEN: token };
  }
  throw unavailable();
}

/** The same environment with this root selected. */
export function withClaudeConfigRoot(env: NodeJS.ProcessEnv, selected: ClaudeConfigRoot): NodeJS.ProcessEnv {
  const next = { ...env };
  if (selected.selector === null) delete next.CLAUDE_CONFIG_DIR; else next.CLAUDE_CONFIG_DIR = selected.selector;
  return next;
}
