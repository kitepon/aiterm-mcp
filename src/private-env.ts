// Values a bound remote terminal hands over on the private stdin line (remote-terminal.md R5).
// They stay out of process.env so no child process or tmux server inherits them implicitly;
// a launch reads them by name through env_vars, exactly like inherited values.
import type { Readable } from "node:stream";
import { AitermError } from "./errors.js";

export const PRIVATE_ENV_SCHEMA = "aiterm.private-env.v1";
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_LINE = 256 * 1024;
const values = new Map<string, string>();

export function parsePrivateEnvLine(line: string): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { throw new AitermError("PRIVATE_ENV_INVALID: the private env line is not JSON", 2); }
  const env = (parsed as { schema?: unknown; env?: unknown } | null);
  if (!env || env.schema !== PRIVATE_ENV_SCHEMA || typeof env.env !== "object" || env.env === null || Array.isArray(env.env))
    throw new AitermError("PRIVATE_ENV_INVALID: unexpected private env schema", 2);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env.env as Record<string, unknown>)) {
    if (!NAME.test(name) || typeof value !== "string" || value.includes("\0"))
      throw new AitermError("PRIVATE_ENV_INVALID: invalid private env entry", 2);
    out[name] = value;
  }
  return out;
}

export function setPrivateEnv(env: Record<string, string>): void {
  for (const [name, value] of Object.entries(env)) values.set(name, value);
}

/** A value that came only on the private stdin line, never this process's env. */
export function privateEnvValue(name: string): string | undefined {
  return values.get(name);
}

/** The value a launch uses for an env_vars name: the private value first, then this process's env. */
export function launchEnvValue(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return values.get(name) ?? env[name];
}

/** Read exactly one line before the MCP stream starts and give the rest back to the stream. */
export function readPrivateEnvLine(stream: Readable): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const finish = (error: Error | null, env?: Record<string, string>) => {
      stream.off("data", onData); stream.off("end", onEnd); stream.off("error", onError);
      stream.pause();
      if (error) reject(error); else resolve(env!);
    };
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const at = buffered.indexOf(0x0a);
      if (at < 0) {
        if (buffered.length > MAX_LINE) finish(new AitermError("PRIVATE_ENV_INVALID: the private env line is too long", 2));
        return;
      }
      const rest = buffered.subarray(at + 1);
      let env: Record<string, string>;
      try { env = parsePrivateEnvLine(buffered.subarray(0, at).toString("utf8")); }
      catch (error) { finish(error as Error); return; }
      // Detach first: unshift on a flowing stream emits synchronously and would re-enter this handler.
      finish(null, env);
      if (rest.length) stream.unshift(rest);
    };
    const onEnd = () => finish(new AitermError("PRIVATE_ENV_INVALID: stdin ended before the private env line", 2));
    const onError = (error: Error) => finish(error);
    stream.on("data", onData); stream.on("end", onEnd); stream.on("error", onError);
  });
}
