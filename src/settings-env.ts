import { AitermError } from "./errors.js";
import { isSecretEnvName } from "./agent-lifecycle.js";

// Environment values a launch caller hands to a Claude Code seat: written into the per-launch settings `env` block (a442f).
// Values live in plain files (settings, resume template), so a secret goes through env_vars by name, never here.
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const CODE_MODE_ENV = "CLAUDE_CODE_EXPERIMENTAL_CODE_MODE";
/** The caller asked for Code Mode (a442h): Aiterm may then answer its first-start confirm. */
export const wantsCodeMode = (env: Record<string, string> | null | undefined): boolean => env?.[CODE_MODE_ENV] === "1";
export const SETTINGS_ENV_MAX_ENTRIES = 32;
export const SETTINGS_ENV_MAX_VALUE = 4096;

export function checkSettingsEnv(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return null;
  const fail = (why: string) => new AitermError(`settings_env: ${why}`, 2);
  if (typeof value !== "object" || Array.isArray(value)) throw fail("an object of name -> string value");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;
  if (entries.length > SETTINGS_ENV_MAX_ENTRIES) throw fail(`at most ${SETTINGS_ENV_MAX_ENTRIES} entries`);
  for (const [name, item] of entries) {
    if (!NAME_RE.test(name)) throw fail(`${JSON.stringify(name)} is not an environment variable name`);
    if (isSecretEnvName(name) || name.startsWith("AITERM_") || name === "CLAUDE_CONFIG_DIR")
      throw fail(`${name} is not accepted here (secrets go by name in env_vars; AITERM_* and CLAUDE_CONFIG_DIR belong to Aiterm)`);
    if (typeof item !== "string" || item.includes("\0") || item.length > SETTINGS_ENV_MAX_VALUE)
      throw fail(`${name} must be a string of at most ${SETTINGS_ENV_MAX_VALUE} characters without NUL`);
  }
  return Object.fromEntries(entries as [string, string][]);
}
