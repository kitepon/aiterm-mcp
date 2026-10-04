// OSのprocess表とnative PIDの所有者。argvは相関にだけ使い、公開identityにはdigestだけを載せる。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
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

// AitermがOSのprocess表を引く時のコマンドの形。席のprocessを数える側が、これを利用者の作業と取り違えないために使う。
const POSIX_PS = "/bin/ps";
const POSIX_TABLE_ARGS = ["-axww", "-o", "pid=,ppid=,pgid=,stat=,lstart=,time=,command="];
const POSIX_IDENTITY_ARGS = ["-o", "pid=,lstart=", "-p"];
const WINDOWS_PROBE_HEADER = ["$ErrorActionPreference='Stop'", "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)"];
const WINDOWS_PROBE_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand"];
// 先頭2行だけのbase64。3 byteの区切りで切り、後ろの行に左右されない前方一致にする。
const WINDOWS_PROBE_PREFIX = (() => {
  const bytes = Buffer.from(WINDOWS_PROBE_HEADER.join("\n") + "\n", "utf16le");
  return bytes.subarray(0, bytes.length - bytes.length % 3).toString("base64");
})();

/** Aitermがprocess表を引くために起こしたprocessか。引く側のAitermは、数えられる席の中のMCP processでもある。 */
export function aitermProcessProbe(command: string): boolean {
  if (command.includes(` ${WINDOWS_PROBE_ARGS.join(" ")} ${WINDOWS_PROBE_PREFIX}`)) return true;
  return command === `${POSIX_PS} ${POSIX_TABLE_ARGS.join(" ")}` || command.startsWith(`${POSIX_PS} ${POSIX_IDENTITY_ARGS.join(" ")} `);
}

/** Windowsのconsole host。console processの起動に付いて立ち、最後のconsole processが終わると消える。 */
export function windowsConsoleHost(row: RuntimeProcess): boolean {
  const first = /^(?:"([^"]+)"|(\S+))/.exec(row.command);
  const name = (row.executable || first?.[1] || first?.[2] || "").replace(/\\/g, "/");
  return path.posix.basename(name).toLowerCase() === "conhost.exe";
}

export function readRuntimeProcesses(): RuntimeProcess[] {
  if (!isWin) {
    const result = spawnSync(POSIX_PS, POSIX_TABLE_ARGS, {
      encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, timeout: 10000, maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) throw new AitermError("OSのprocess一覧を取得できません", 2);
    return parsePosixProcessTable(result.stdout);
  }
  const script = [
    ...WINDOWS_PROBE_HEADER,
    "@(Get-CimInstance Win32_Process | Where-Object { $null -ne $_.CreationDate -and $null -ne $_.CommandLine } | ForEach-Object {",
    "[ordered]@{ pid=[int]$_.ProcessId; parent_pid=[int]$_.ParentProcessId; executable=[string]$_.ExecutablePath; started_identity=$_.CreationDate.ToUniversalTime().ToString('o'); command=$_.CommandLine; cpu_seconds=([double]$_.KernelModeTime+[double]$_.UserModeTime)/10000000 }",
    "}) | ConvertTo-Json -Compress",
  ].join("\n");
  const result = spawnSync(resolveWindowsPowerShell7(), [...WINDOWS_PROBE_ARGS, Buffer.from(script, "utf16le").toString("base64")], {
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

/**
 * 指定したpidの開始時刻だけを引く。readRuntimeProcessesと同じ開始時刻を返し、存在しないpidは結果に含めない。
 * 全processのargvを読む一覧取得は、processの多い端末で重い（定期実行から呼ばない）。
 */
export function readProcessIdentities(pids: number[]): { pid: number; started_identity: string }[] {
  const wanted = [...new Set(pids)];
  if (wanted.length === 0) return [];
  if (wanted.some(pid => !Number.isSafeInteger(pid) || pid < 0)) throw new AitermError("process照会のpidが不正です", 2);
  if (!isWin) {
    const result = spawnSync(POSIX_PS, [...POSIX_IDENTITY_ARGS, wanted.join(",")], {
      encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, timeout: 10000,
    });
    // 該当するprocessが一つも無い時、psは何も出さずstatus 1で終わる。
    if (result.error || (result.status !== 0 && !(result.status === 1 && !result.stdout.trim()))) {
      throw new AitermError("OSのprocess一覧を取得できません", 2);
    }
    return result.stdout.split("\n").filter(line => line.trim()).map(line => {
      const match = /^\s*(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s*$/.exec(line);
      if (!match) throw new AitermError("process一覧の形式を認識できません", 2);
      return { pid: Number(match[1]), started_identity: match[2].trim() };
    });
  }
  // CommandLineの読めないprocess（別の権限のserviceなど）も返す。pidが使い回された先を「別のprocess」と確かめるのに要る。
  const script = [
    ...WINDOWS_PROBE_HEADER,
    `$rows=@(Get-CimInstance Win32_Process -Filter "${wanted.map(pid => `ProcessId=${pid}`).join(" OR ")}" | Where-Object { $null -ne $_.CreationDate } | ForEach-Object {`,
    "[ordered]@{ pid=[int]$_.ProcessId; started_identity=$_.CreationDate.ToUniversalTime().ToString('o') }",
    "})",
    "ConvertTo-Json -Compress -InputObject $rows",
  ].join("\n");
  const result = spawnSync(resolveWindowsPowerShell7(), [...WINDOWS_PROBE_ARGS, Buffer.from(script, "utf16le").toString("base64")], {
    encoding: "utf8", timeout: 15000, windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new AitermError("Windowsのnative process一覧を取得できません", 2);
  let rows: unknown;
  try { rows = JSON.parse(result.stdout); } catch { throw new AitermError("Windows process一覧のJSONを読めません", 2); }
  if (!Array.isArray(rows)) throw new AitermError("Windows process一覧が配列ではありません", 2);
  return rows.map(row => {
    if (!row || !Number.isSafeInteger(row.pid) || typeof row.started_identity !== "string"
      || !Number.isFinite(Date.parse(row.started_identity))) throw new AitermError("Windows process一覧のfieldが不正です", 2);
    return { pid: row.pid, started_identity: new Date(row.started_identity).toISOString() };
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

// 中継（mcp-lazy）は、登録されたMCPの本体と先行起動の判定を、自分の直接の子として起こす。
// 見分けるのは起動した実行ファイルの名前（argvの先頭のbasenameが`mcp-lazy`で始まる）。取り決めはmcp-lazyのREADMEにある。
export function lazyRelayProcess(command: string): boolean {
  const first = /^(?:"([^"]+)"|(\S+))/.exec(command);
  return path.posix.basename((first?.[1] ?? first?.[2] ?? "").replace(/\\/g, "/")).toLowerCase().startsWith("mcp-lazy");
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
