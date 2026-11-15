// Caller launch fields (launch-identity-input.md "Caller launch fields") shared by grok-cli, cursor-cli and antigravity-cli:
// one reading of `mcp_config` and the checks that decide, before any seat exists, whether a harness can carry it.
// Codex keeps its own copy of the same rules (codex.ts codexMcpOverrides) and error codes.
import * as fs from "node:fs";
import * as path from "node:path";
import { AitermError } from "../errors.js";
import { writeJson0600 } from "../agent-shared.js";

export type CallerLabel = "GROK" | "CURSOR" | "ANTIGRAVITY";
/** `bearer`: Authorization 'Bearer ${NAME}'. `env`: a header whose whole value is '${NAME}'. `literal`: the value as written. */
export interface CallerHeader { name: string; kind: "bearer" | "env" | "literal"; value: string }
export interface CallerServer { name: string; url: string; headers: CallerHeader[]; replace: boolean }

// The text travels in one argv element (Linux caps one at 128 KiB) or the typed first prompt.
export const CALLER_PROMPT_MAX = 64 * 1024;
const MCP_SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,128}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
// Names every seat has whatever env_vars says (core.ts agentEnvEntries), known before the seat exists.
const SEAT_ENV_NAMES = new Set(["AITERM_SESSION_ID", "AITERM_AGENT_SESSION_ID", "AITERM_AGENT_LAUNCH_ID"]);

/** `mcp_config` -> servers. Refuses (<LABEL>_MCP_CONFIG_UNSUPPORTED) what an http server table with env-named headers cannot say. */
export function parseCallerMcp(mcp: unknown, label: CallerLabel): CallerServer[] {
  const refuse = (message: string): never => { throw new AitermError(`${label}_MCP_CONFIG_UNSUPPORTED: ${message}`, 2); };
  const servers = (mcp as { mcpServers?: unknown } | null)?.mcpServers;
  if (!mcp || typeof mcp !== "object" || Object.keys(mcp).some(key => key !== "mcpServers") || !servers || typeof servers !== "object" || Array.isArray(servers))
    return refuse("mcp_config must be {mcpServers: {...}}");
  return Object.entries(servers as Record<string, unknown>).map(([name, server]) => {
    if (!MCP_SERVER_NAME.test(name)) return refuse(`server name '${name}' must be letters, digits, '_' or '-'`);
    const spec = server as { type?: unknown; url?: unknown; headers?: unknown } | null;
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) return refuse(`server '${name}' must be an object`);
    if (Object.keys(spec).some(key => !["type", "url", "headers", "replace"].includes(key))) return refuse(`server '${name}' may only have type, url, headers and replace`);
    if ((spec as { replace?: unknown }).replace !== undefined && typeof (spec as { replace?: unknown }).replace !== "boolean") return refuse(`server '${name}': replace must be true or false`);
    if (spec.type !== undefined && spec.type !== "http") return refuse(`server '${name}': only type 'http' is supported here (got '${String(spec.type)}')`);
    let url: URL | null = null;
    try { url = typeof spec.url === "string" ? new URL(spec.url) : null; } catch { /* refused below */ }
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return refuse(`server '${name}': url must be an http(s) URL`);
    if (spec.headers !== undefined && (!spec.headers || typeof spec.headers !== "object" || Array.isArray(spec.headers))) return refuse(`server '${name}': headers must be an object`);
    const seen = new Set<string>();
    const headers = Object.entries((spec.headers ?? {}) as Record<string, unknown>).map(([header, value]): CallerHeader => {
      if (!HEADER_NAME.test(header) || typeof value !== "string") return refuse(`server '${name}': header '${header}' must be a plain name with a string value`);
      if (seen.has(header.toLowerCase())) return refuse(`server '${name}': header '${header}' is given twice`);
      seen.add(header.toLowerCase());
      const bearer = header.toLowerCase() === "authorization" ? /^Bearer \$\{([^}]*)\}$/.exec(value)?.[1] : undefined;
      const whole = /^\$\{([^}]*)\}$/.exec(value)?.[1];
      if (bearer !== undefined || whole !== undefined) {
        const envName = (bearer ?? whole)!;
        if (!ENV_NAME.test(envName)) return refuse(`server '${name}': header '${header}' names an invalid environment variable`);
        return { name: header, kind: bearer !== undefined ? "bearer" : "env", value: envName };
      }
      if (value.includes("${")) return refuse(`server '${name}': header '${header}' mixes text with \${NAME}; only the whole value or 'Bearer \${NAME}' can be given`);
      return { name: header, kind: "literal", value };
    });
    return { name, url: spec.url as string, headers, replace: (spec as { replace?: unknown }).replace === true };
  });
}

/** The text and servers of a caller input, or the refusal. `null` mcp -> no servers. */
export function checkCallerInput(label: CallerLabel, prompt: string | null | undefined, mcp: unknown): CallerServer[] {
  if (prompt != null && (!prompt.trim() || Buffer.byteLength(prompt, "utf8") > CALLER_PROMPT_MAX))
    throw new AitermError(`append_system_prompt must be non-empty and at most 64 KiB for ${label.toLowerCase()}`, 2);
  return mcp == null ? [] : parseCallerMcp(mcp, label);
}

/** Every `${NAME}` the servers name must have a value at launch, or the seat would start with an empty secret. */
export function assertCallerEnv(label: CallerLabel, servers: CallerServer[], valueOf: (name: string) => string | undefined, preStart = false): void {
  for (const server of servers) for (const header of server.headers) {
    if (header.kind === "literal") continue;
    if (valueOf(header.value) === undefined && !(preStart && SEAT_ENV_NAMES.has(header.value)))
      throw new AitermError(`${label}_MCP_ENV_UNAVAILABLE: header '${header.name}' of server '${server.name}' uses \${${header.value}}, which has no value at launch; list ${header.value} in env_vars`, 2);
  }
}

/** The header value with every `${NAME}` replaced by the seat's value (for a harness that does not expand them). */
export function resolveCallerHeader(label: CallerLabel, header: CallerHeader, valueOf: (name: string) => string | undefined): string {
  if (header.kind === "literal") return header.value;
  const value = valueOf(header.value);
  if (value === undefined || value === "") throw new AitermError(`${label}_MCP_ENV_UNAVAILABLE: \${${header.value}} has no value at launch`, 2);
  return header.kind === "bearer" ? `Bearer ${value}` : value;
}

/** 0600 file inside a seat folder (created 0700) of Aiterm's launch state. */
export function writeCallerJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeJson0600(file, value);
}

export function readCallerText(file: string | undefined): string | null {
  return file ? fs.readFileSync(file, "utf8") : null;
}

// ---------------------------------------------------------------- Caller name precedence (launch-identity-input.md)
export interface CallerMcpPrecedence { dropped: string[]; replaced: string[] }

/**
 * The caller config the seat gets: an entry whose name the seat's own harness config defines is dropped unless it says
 * `replace: true`. Not a refusal: the seat launches with the rest. Throws only on a `replace` that is not a boolean.
 */
export function applyCallerPrecedence(mcp: Record<string, unknown>, own: ReadonlySet<string>): { config: Record<string, unknown>; precedence: CallerMcpPrecedence } {
  const servers = (mcp.mcpServers ?? {}) as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  const precedence: CallerMcpPrecedence = { dropped: [], replaced: [] };
  for (const [name, server] of Object.entries(servers)) {
    const replace = (server as { replace?: unknown } | null)?.replace;
    if (replace !== undefined && typeof replace !== "boolean") throw new AitermError(`mcp_config server '${name}': replace must be true or false`, 2);
    if (own.has(name)) (replace === true ? precedence.replaced : precedence.dropped).push(name);
    if (!own.has(name) || replace === true) kept[name] = server;
  }
  return { config: { ...mcp, mcpServers: kept }, precedence };
}

/** The same config with every `replace` key removed (for a harness file that takes only its own keys). */
export function withoutReplaceKeys(mcp: Record<string, unknown>): Record<string, unknown> {
  const servers = (mcp.mcpServers ?? {}) as Record<string, unknown>;
  return { ...mcp, mcpServers: Object.fromEntries(Object.entries(servers).map(([name, server]) => {
    if (!server || typeof server !== "object" || Array.isArray(server)) return [name, server];
    const { replace: _replace, ...rest } = server as Record<string, unknown>;
    return [name, rest];
  })) };
}

/** Keys of `mcpServers` in a JSON file (Claude, Antigravity); a missing or unreadable file names nothing. */
export function jsonMcpServerNames(file: string, pick: (config: any) => unknown = config => config?.mcpServers): string[] {
  let config: unknown;
  try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return []; }
  const servers = pick(config);
  return servers && typeof servers === "object" && !Array.isArray(servers) ? Object.keys(servers) : [];
}

/** `[mcp_servers.NAME]` table names in a config.toml (Codex, Grok); a missing file names nothing.
 * shortcut: reads section headers only, an inline-table or dotted-key definition is not seen; upgrade with a TOML parser. */
export function tomlMcpServerNames(file: string): string[] {
  let body = "";
  try { body = fs.readFileSync(file, "utf8"); } catch { return []; }
  const names: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const header = /^\s*\[\s*mcp_servers\s*\.\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*\]\s*(?:#.*)?$/.exec(line);
    if (header) names.push(header[1] ?? header[2] ?? header[3]);
  }
  return names;
}
