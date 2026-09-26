// OSのprocess表とnative PIDの所有者。argvは相関にだけ使い、公開identityにはdigestだけを載せる。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { AitermError } from "./errors.js";
import { isWin } from "./tmux-runtime.js";
import { resolveWindowsPowerShell7 } from "./windows-powershell.js";

export interface NativeProcessIdentity {
  pid: number;
  process_group_id: number | null;
  started_identity: string;
  argv_digest: string;
}

export interface RuntimeProcess extends NativeProcessIdentity {
  executable?: string;
  parent_pid: number;
  cpu_seconds: number;
  command: string;
  stopped: boolean | null;
}

export function processIdentity(process: RuntimeProcess): NativeProcessIdentity {
  return {
    pid: process.pid, process_group_id: process.process_group_id,
    started_identity: process.started_identity, argv_digest: process.argv_digest,
  };
}

export function parseCpuTime(value: string): number {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(value);
  if (!match) throw new AitermError("process CPU時間の形式を認識できません", 2);
  return Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600
    + Number(match[3]) * 60 + Number(match[4]);
}

export function parsePosixProcessTable(text: string): RuntimeProcess[] {
  return text.split("\n").filter(line => line.trim()).map(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (!match) throw new AitermError("process一覧の形式を認識できません", 2);
    const command = match[7].trim();
    return {
      pid: Number(match[1]), parent_pid: Number(match[2]), process_group_id: Number(match[3]),
      stopped: match[4].includes("T"),
      started_identity: match[5].trim(), cpu_seconds: parseCpuTime(match[6]), command,
      argv_digest: createHash("sha256").update(command).digest("hex"),
    };
  });
}

export function readRuntimeProcesses(): RuntimeProcess[] {
  if (!isWin) {
    const result = spawnSync("/bin/ps", ["-axww", "-o", "pid=,ppid=,pgid=,stat=,lstart=,time=,command="], {
      encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, timeout: 10000, maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) throw new AitermError("OSのprocess一覧を取得できません", 2);
    return parsePosixProcessTable(result.stdout);
  }
  const script = [
    "$ErrorActionPreference='Stop'",
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)",
    "@(Get-CimInstance Win32_Process | Where-Object { $null -ne $_.CreationDate -and $null -ne $_.CommandLine } | ForEach-Object {",
    "[ordered]@{ pid=[int]$_.ProcessId; parent_pid=[int]$_.ParentProcessId; executable=[string]$_.ExecutablePath; started_identity=$_.CreationDate.ToUniversalTime().ToString('o'); command=$_.CommandLine; cpu_seconds=([double]$_.KernelModeTime+[double]$_.UserModeTime)/10000000 }",
    "}) | ConvertTo-Json -Compress",
  ].join("\n");
  const result = spawnSync(resolveWindowsPowerShell7(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new AitermError("Windowsのnative process一覧を取得できません", 2);
  let rows: unknown;
  try { rows = JSON.parse(result.stdout); } catch { throw new AitermError("Windows process一覧のJSONを読めません", 2); }
  if (!Array.isArray(rows)) throw new AitermError("Windows process一覧が配列ではありません", 2);
  return rows.map(row => {
    if (!row || !Number.isSafeInteger(row.pid) || !Number.isSafeInteger(row.parent_pid)
      || typeof row.command !== "string" || !Number.isFinite(row.cpu_seconds)
      || typeof row.started_identity !== "string" || !Number.isFinite(Date.parse(row.started_identity)))
      throw new AitermError("Windows process一覧のfieldが不正です", 2);
    const command = row.command.trim();
    return {
      pid: row.pid, parent_pid: row.parent_pid, process_group_id: null, stopped: null,
      executable: row.executable,
      started_identity: new Date(row.started_identity).toISOString(),
      command, cpu_seconds: row.cpu_seconds, argv_digest: createHash("sha256").update(command).digest("hex"),
    };
  });
}

// Windowsの親PIDは親の終了後も残り、別processへ再利用される。子より後に始まったprocessは
// 本当の親ではないので、親子関係として辿らない（辿ると循環や無関係なprocessの混入が起きる）。
export function parentProcess(row: RuntimeProcess, byPid: Map<number, RuntimeProcess>): RuntimeProcess | undefined {
  const parent = byPid.get(row.parent_pid);
  if (!parent || parent.pid === row.pid) return undefined;
  const parentStart = Date.parse(parent.started_identity);
  const childStart = Date.parse(row.started_identity);
  return Number.isFinite(parentStart) && Number.isFinite(childStart) && parentStart > childStart ? undefined : parent;
}

export function processSubtree(rows: RuntimeProcess[], rootPid: number): RuntimeProcess[] {
  const byPid = new Map(rows.map(row => [row.pid, row]));
  const selected = new Set([rootPid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows) {
      if (!selected.has(row.pid) && selected.has(row.parent_pid) && parentProcess(row, byPid)) {
        selected.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter(row => selected.has(row.pid));
}

export function backgroundProcesses(rows: RuntimeProcess[], root: RuntimeProcess): RuntimeProcess[] {
  // 起動時の足場processを除く既存契約。pane開始から60秒以上後に生成された子孫だけを集計する。
  const rootStart = Date.parse(root.started_identity);
  if (!Number.isFinite(rootStart)) throw new AitermError("pane開始時刻を解釈できません", 2);
  return rows.filter(row => {
    const started = Date.parse(row.started_identity);
    if (!Number.isFinite(started)) throw new AitermError("process開始時刻を解釈できません", 2);
    return started - rootStart >= 60_000;
  });
}
