import { spawn, type SpawnSyncReturns } from "node:child_process";
import path from "node:path";

/** spawnSync と同じ形の結果を、event loop を止めずに返す。timeout は ETIMEDOUT、出力の上限超えは ENOBUFS の error にする。 */
export function spawnCollect(bin: string, args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; timeout: number; maxBuffer: number; windowsHide?: boolean }): Promise<SpawnSyncReturns<string>> {
  return new Promise(done => {
    let stdout = "", stderr = "", error: Error | undefined, settled = false;
    let child: ReturnType<typeof spawn>;
    const finish = (status: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      done({ pid: child?.pid ?? 0, output: [null, stdout, stderr], stdout, stderr, status: error ? null : status, signal, ...(error ? { error } : {}) });
    };
    const stop = (code: string) => { error ??= Object.assign(new Error(`${path.basename(bin)} ${code}`), { code }); child.kill("SIGKILL"); };
    const timer = setTimeout(() => stop("ETIMEDOUT"), options.timeout);
    try { child = spawn(bin, args, { env: options.env, windowsHide: options.windowsHide, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (reason) { error = reason as Error; finish(null, null); return; }
    child.on("error", reason => { error ??= reason; finish(null, null); });
    child.on("close", (status, signal) => finish(status, signal));
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => { stdout += chunk; if (stdout.length > options.maxBuffer) stop("ENOBUFS"); });
    child.stderr!.on("data", (chunk: string) => { if (stderr.length < options.maxBuffer) stderr += chunk; });
  });
}

/**
 * Shares one run among the callers that arrive together, without serving a stale one:
 * a caller only receives a run that began after its call. Callers arriving while a run is in flight share the next run,
 * so a burst of N callers costs at most two runs.
 */
export function freshShared<T>(run: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null, queued: Promise<T> | null = null;
  const start = (): Promise<T> => {
    queued = null;
    const current = running = run();
    const clear = () => { if (running === current) running = null; };
    current.then(clear, clear);
    return current;
  };
  return () => queued ?? (running ? (queued = running.then(start, start)) : start());
}
