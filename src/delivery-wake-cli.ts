#!/usr/bin/env node
// aiterm-delivery-wake — 眠っているAitermのMCP本体を、親配送の引き取りのために起こすべきかを返す。
// MCPを使う時だけ起こす中継（mcp-lazy）の先行起動の判定に渡す。本体が眠っている間は、終了した持ち主の配送を
// 引き取る者が居ない（引き取りは起きている本体が5秒おきに行う）。
// exit 0=起こす / 1=眠ったままでよい / 2=引数の誤り。stdoutへは何も出さない。
// 中継の下で動くので、子processを起こさない（起こすと席のprocess数に入る）。node builtinとstate-rootだけに依存する。
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { currentUid, runtimeStateBase } from "./state-root.js";

export type WakeParent = "codex" | "claude" | "cursor";

const DIRECTORY: Record<WakeParent, string> = {
  codex: "parent-deliveries", claude: "claude-parent-deliveries", cursor: "cursor-parent-deliveries",
};
// 起こす役を引き受けた印の寿命。起こした本体は起動してすぐ引き取る。引き取られないまま過ぎたら、次の判定が引き受け直す。
const CLAIM_TTL_MS = 30_000;
const USAGE = "usage: aiterm-delivery-wake --parent <codex|claude|cursor>";

export interface WakeDependencies {
  // そのpidのprocessが今あるか。
  exists: (pid: number) => boolean;
  // そのpidのprocessの開始時刻（epoch ms）。分からないOSと読めない時はnull。
  started_at: (pid: number) => number | null;
  now: () => number;
}

function processExists(pid: number): boolean {
  if (pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

// psのlstartと同じ値を/procから作る（起動時刻＋開始tick。LinuxのUSER_HZは100）。/procの無いOSはnull。
function linuxStartedAt(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const ticks = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
    const boot = Number(/^btime (\d+)$/m.exec(fs.readFileSync("/proc/stat", "utf8"))?.[1]);
    return Number.isFinite(ticks) && Number.isFinite(boot) ? (boot + Math.floor(ticks / 100)) * 1000 : null;
  } catch { return null; }
}

const DEFAULTS: WakeDependencies = { exists: processExists, started_at: linuxStartedAt, now: () => Date.now() };

function ownerGone(owner: unknown, deps: WakeDependencies): boolean {
  const value = owner as { pid?: unknown; started_identity?: unknown; closed?: unknown } | null;
  if (!value || !Number.isSafeInteger(value.pid) || typeof value.started_identity !== "string" || typeof value.closed !== "boolean") return false;
  if (value.closed) return true;
  const pid = value.pid as number;
  if (!deps.exists(pid)) return true;
  // 同じpidが別のprocessへ再利用されていないかを、開始時刻で見る。照合できない時は生きている扱い（本体が起きた時に照合する）。
  const recorded = Date.parse(value.started_identity);
  const actual = deps.started_at(pid);
  return Number.isFinite(recorded) && actual !== null && Math.abs(actual - recorded) > 2_000;
}

/**
 * 終了した持ち主の下に、引き取られていない配送の記録があれば、起こす役を引き受けてtrueを返す。
 * 同じ種類の席は全部が同じ判定を回す。印を先に作れた1席だけが起こす。
 */
export function shouldWakeForDeliveries(stateRoot: string, parent: WakeParent, dependencies: Partial<WakeDependencies> = {}): boolean {
  const deps = { ...DEFAULTS, ...dependencies };
  let wake = false;
  for (const prefix of ["", "remote-"]) {
    const root = path.join(stateRoot, prefix + DIRECTORY[parent]);
    const active = path.join(root, "active");
    const claims = path.join(root, "wake-claims");
    let owners: fs.Dirent[];
    try { owners = fs.readdirSync(active, { withFileTypes: true }); }
    catch { continue; }
    const orphaned = new Set<string>();
    for (const directory of owners) {
      if (!directory.isDirectory()) continue;
      const ownerDir = path.join(active, directory.name);
      let owner: unknown;
      let records: string[];
      try {
        owner = JSON.parse(fs.readFileSync(path.join(ownerDir, "owner.json"), "utf8"));
        records = fs.readdirSync(ownerDir).filter(name => name !== "owner.json" && name.endsWith(".json"));
      } catch { continue; }
      if (records.length > 0 && ownerGone(owner, deps)) orphaned.add(directory.name);
    }
    // 引き取りが済んだ持ち主の印を片付ける。
    try {
      for (const name of fs.readdirSync(claims)) if (!orphaned.has(name)) fs.rmSync(path.join(claims, name), { recursive: true, force: true });
    } catch { /* 印の置き場がまだ無い */ }
    for (const name of orphaned) {
      const claim = path.join(claims, name);
      try {
        fs.mkdirSync(claims, { recursive: true, mode: 0o700 });
        fs.mkdirSync(claim, { mode: 0o700 });
        wake = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const now = deps.now();
        if (now - fs.statSync(claim).mtimeMs < CLAIM_TTL_MS) continue;
        fs.utimesSync(claim, now / 1000, now / 1000);
        wake = true;
      }
    }
  }
  return wake;
}

function main(argv: string[]): number {
  if (argv.length !== 2 || argv[0] !== "--parent" || !(argv[1] in DIRECTORY)) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  return shouldWakeForDeliveries(path.join(runtimeStateBase(), `aiterm-mcp-${currentUid()}`), argv[1] as WakeParent) ? 0 : 1;
}

function invokedDirectly(): boolean {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (invokedDirectly()) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`aiterm-delivery-wake: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 3;
  }
}
