// The caller's command after a seat was launched or resumed (launch-identity-input.md "Post-launch command", remote-terminal.md R25, a532b1).
// A generic hook: it names no product. Run by the Aiterm that created the native seat, as the seat's user, never through a shell.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { liveNodeExecutable } from "./live-node.js";
import { privateEnvValue } from "./private-env.js";
import { SOCKDIR } from "./tmux-runtime.js";

export const POST_LAUNCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 24 * 1024;
export const postLaunchSchema = z.object({
  command: z.array(z.string().min(1).refine(arg => !arg.includes("\0"), "no NUL")).min(1).max(16),
}).strict().refine(spec => spec.command.reduce((sum, arg) => sum + Buffer.byteLength(arg), 0) <= MAX_BYTES, `the command is at most ${MAX_BYTES} bytes in all`);
export type PostLaunch = z.infer<typeof postLaunchSchema>;
export interface PostLaunchResult { status: "ok" | "failed" | "timeout"; exit_code: number | null }

/** The names whose private-line values this launch consumed: its env_vars and every `${NAME}` its mcp_config headers refer to. */
export function consumedPrivateNames(args: { env_vars?: string[]; mcp_config?: { mcpServers?: Record<string, unknown> } | null }): string[] {
  const names = new Set<string>(args.env_vars ?? []);
  for (const server of Object.values(args.mcp_config?.mcpServers ?? {}) as Array<{ headers?: Record<string, unknown> }>)
    for (const value of Object.values(server?.headers ?? {})) if (typeof value === "string") for (const m of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) names.add(m[1]!);
  return [...names];
}

/** `aiterm-session-alive <session> --tmpdir BASE` as an absolute argv, so a caller with no node on PATH, and no TEMP/TMPDIR, still asks this Aiterm's multiplexer. */
export function aliveArgv(session: string): string[] {
  return [liveNodeExecutable(), fileURLToPath(new URL("./session-alive-cli.js", import.meta.url)), session, "--tmpdir", path.dirname(SOCKDIR)];
}

export async function runPostLaunch(spec: PostLaunch, context: { session: string; event: "launch" | "resume"; cwd?: string | null; names: string[]; timeoutMs?: number }): Promise<PostLaunchResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("AITERM_AGENT_")) delete env[key];
  env.AITERM_SESSION_ID = context.session;
  env.AITERM_HOOK_EVENT = context.event;
  env.AITERM_SESSION_ALIVE = JSON.stringify(aliveArgv(context.session));
  const port = privateEnvValue("AITERM_SEAT_FORWARD_PORT");
  if (port !== undefined) env.AITERM_SEAT_FORWARD_PORT = port;
  for (const name of context.names) { const value = privateEnvValue(name); if (value !== undefined) env[name] = value; }
  const [first, ...rest] = spec.command;
  const file = first === "node" ? liveNodeExecutable() : first!;
  return new Promise<PostLaunchResult>(resolve => {
    let settled = false;
    const done = (result: PostLaunchResult, note?: string) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (result.status !== "ok") process.stderr.write(`aiterm post_launch ${result.status} (${context.session}): ${note ?? `exit ${result.exit_code}`}\n`);
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try { child = spawn(file, rest, { env, ...(context.cwd ? { cwd: context.cwd } : {}), stdio: "ignore", detached: process.platform !== "win32", windowsHide: true }); }
    catch (error) { resolve({ status: "failed", exit_code: null }); process.stderr.write(`aiterm post_launch failed (${context.session}): ${error instanceof Error ? error.message : String(error)}\n`); return; }
    const timer = setTimeout(() => {
      // POSIX: the hook leads its own process group; Windows: taskkill the tree. A program that must outlive the hook detached itself.
      try { if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }); else process.kill(-child.pid!, "SIGKILL"); } catch { /* gone already */ }
      done({ status: "timeout", exit_code: null }, `no exit in ${context.timeoutMs ?? POST_LAUNCH_TIMEOUT_MS} ms`);
    }, context.timeoutMs ?? POST_LAUNCH_TIMEOUT_MS);
    child.on("error", error => done({ status: "failed", exit_code: null }, error.message));
    child.on("exit", code => done(code === 0 ? { status: "ok", exit_code: 0 } : { status: "failed", exit_code: code }));
    child.unref();
  });
}
