// Catalog-only Claude config root per configuration root (harness-contracts.md C1-C4).
// Claude Code writes its served-catalog flag into the root's global config regardless of identity, so seats and logins
// sharing a root make the model list flap. The catalog runs in its own root that only the catalog writes.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ensureStateRoot } from "./agent-shared.js";
import { claudeDefaultConfigRoot } from "./claude-config-root.js";

const FRESH_MS = 10 * 60_000;

export interface ClaudeCatalogRoot { env: NodeJS.ProcessEnv; lastDigest(): string | null; remember(digest: string): void }

/**
 * The catalog-only root for the root `env` selects, holding only the root's access token. null when the root has no
 * file credential (macOS Keychain), the env authenticates by token/API key, or the access token is near expiry:
 * the caller then runs on the root itself as before, which lets Claude Code refresh there.
 */
export function claudeCatalogRoot(env: NodeJS.ProcessEnv, now = Date.now()): ClaudeCatalogRoot | null {
  if (env.CLAUDE_CODE_OAUTH_TOKEN || env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return null;
  const root = env.CLAUDE_CONFIG_DIR || claudeDefaultConfigRoot(env);
  let oauth: any;
  try { oauth = JSON.parse(fs.readFileSync(path.join(root, ".credentials.json"), "utf8"))?.claudeAiOauth; } catch { return null; }
  if (typeof oauth?.accessToken !== "string" || typeof oauth.expiresAt !== "number" || oauth.expiresAt - now < FRESH_MS) return null;
  let real = root;
  try { real = fs.realpathSync(root); } catch {}
  const dir = path.join(ensureStateRoot(), "claude-catalog", createHash("sha256").update(real).digest("hex").slice(0, 16));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // The refresh token is single-use: a refresh here would sign the root out, so the copy cannot refresh.
  const { refreshToken: _refresh, ...access } = oauth;
  const tmp = path.join(dir, `.credentials.${randomUUID()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify({ claudeAiOauth: access }), { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, ".credentials.json"));
  const digestFile = path.join(dir, "last-catalog.sha256");
  return {
    env: { ...env, CLAUDE_CONFIG_DIR: dir },
    lastDigest: () => { try { return fs.readFileSync(digestFile, "utf8"); } catch { return null; } },
    remember: digest => fs.writeFileSync(digestFile, digest, { mode: 0o600 }),
  };
}
