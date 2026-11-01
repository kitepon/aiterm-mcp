import * as fs from "node:fs";
import {processStartIdentity} from "./process-start.js";
// OSのprocess表とnative PIDの所有者。argvは相関にだけ使い、公開identityにはdigestだけを載せる。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { AitermError } from "./errors.js";
import { lazyRelayExecutable } from "./lazy-relay.js";
import { isWin } from "./tmux-runtime.js";
import { resolveWindowsPowerShell7 } from "./windows-powershell.js";
import type { ExecutionActorObservation } from "./execution-lock.js";

export interface NativeProcessIdentity {
  pid: number;
  process_group_id: number | null;
  started_identity: string;
  argv_digest: string;
}

export interface RuntimeProcess extends NativeProcessIdentity {
  session_identity?: string | null;
  zombie?: boolean;
  executable?: string;
  parent_pid: number;
  cpu_seconds: number;
  command: string;
  stopped: boolean | null;
}

/** Claude's native macOS keep-awake helper does no user work of its own. */
export function macKeepAwakeProcess(row: RuntimeProcess, harness?: NativeProcessIdentity | null, platform: NodeJS.Platform = process.platform): boolean {
  const started = Date.parse(row.started_identity), parentStarted = Date.parse(harness?.started_identity ?? "");
  return platform === "darwin" && !!harness && row.parent_pid === harness.pid && Number.isFinite(started)
    && Number.isFinite(parentStarted) && started >= parentStarted && /^(?:\/usr\/bin\/)?caffeinate -i -t 300$/.test(row.command.trim());
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

export function parsePosixProcessTable(text: string, includeSession = false, platform: NodeJS.Platform = process.platform): RuntimeProcess[] {
  const leaders = new Set<number>();
  const rows: RuntimeProcess[] = text.split("\n").filter(line => line.trim()).map(line => {
    const match = (includeSession
      ? /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(\S+)\s+(.+)$/
      : /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(\S+)\s+(.+)$/).exec(line);
    if (!match) throw new AitermError("process一覧の形式を認識できません", 2);
    const offset = includeSession ? 1 : 0;
    const command = match[7 + offset].trim();
    if (match[4 + offset].includes("s")) leaders.add(Number(match[1]));
    return {
      pid: Number(match[1]), parent_pid: Number(match[2]), process_group_id: Number(match[3]),
      stopped: match[4 + offset].includes("T"), zombie: match[4 + offset].includes("Z"),
      ...(includeSession ? { session_identity: match[4] } : {}),
      started_identity: match[5 + offset].trim(), cpu_seconds: parseCpuTime(match[6 + offset]), command,
      argv_digest: createHash("sha256").update(command).digest("hex"),
    };
  });
  // Darwin sess is a kernel pointer hidden as zero; stat's s is the actual session-leader flag.
  if (includeSession && platform === "darwin") {
    const byPid = new Map(rows.map(row => [row.pid, row]));
    for (const row of rows) {
      let leader: RuntimeProcess | undefined = Number.isFinite(Date.parse(row.started_identity)) ? row : undefined;
      const seen = new Set<number>();
      while (leader && !leaders.has(leader.pid) && !seen.has(leader.pid)) {
        seen.add(leader.pid);
        leader = leader.parent_pid <= 1 ? undefined : parentProcess(leader, byPid);
        if (leader && !Number.isFinite(Date.parse(leader.started_identity))) leader = undefined;
      }
      row.session_identity = leader && leaders.has(leader.pid) ? `${leader.pid}:${leader.started_identity}` : null;
    }
  }
  return rows;
}

// AitermがOSのprocess表を引く時のコマンドの形。席のprocessを数える側が、これを利用者の作業と取り違えないために使う。
const POSIX_PS = "/bin/ps";
const POSIX_TABLE_ARGS = ["-axww", "-o", "pid=,ppid=,pgid=,stat=,lstart=,time=,command="];
const POSIX_SESSION_TABLE_ARGS = ["-axww", "-o", "pid=,ppid=,pgid=,sess=,stat=,lstart=,time=,command="];
const POSIX_IDENTITY_ARGS = ["-o", "pid=,lstart=", "-p"];
const POSIX_ELAPSED_ARGS = ["-o", "etime=", "-p"];
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
  return command === `${POSIX_PS} ${POSIX_TABLE_ARGS.join(" ")}` || command.startsWith(`${POSIX_PS} ${POSIX_IDENTITY_ARGS.join(" ")} `)
    || command === `${POSIX_PS} ${POSIX_SESSION_TABLE_ARGS.join(" ")}`
    || command.startsWith(`${POSIX_PS} ${POSIX_ELAPSED_ARGS.join(" ")} `);
}

/** Windowsのconsole host。console processの起動に付いて立ち、最後のconsole processが終わると消える。 */
export function windowsConsoleHost(row: RuntimeProcess): boolean {
  const first = /^(?:"([^"]+)"|(\S+))/.exec(row.command);
  const name = (row.executable || first?.[1] || first?.[2] || "").replace(/\\/g, "/");
  return path.posix.basename(name).toLowerCase() === "conhost.exe";
}

export function readRuntimeProcesses(includeSession = false): RuntimeProcess[] {
  if (!isWin) {
    const result = spawnSync(POSIX_PS, includeSession ? POSIX_SESSION_TABLE_ARGS : POSIX_TABLE_ARGS, {
      encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, timeout: 10000, maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) throw new AitermError("OSのprocess一覧を取得できません", 2);
    return parsePosixProcessTable(result.stdout, includeSession);
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

/** A held Process handle on Windows prevents a PID replacement from becoming the target. */
export function signalRuntimeProcess(target: NativeProcessIdentity, signal: "SIGTERM" | "SIGKILL", group: boolean): void {
  if (!Number.isSafeInteger(target.pid) || target.pid <= 1 || !Number.isFinite(Date.parse(target.started_identity))
    || (group && (!Number.isSafeInteger(target.process_group_id) || target.process_group_id! <= 1)))
    throw new Error("invalid_process_signal_target");
  if (!isWin) {
    try { process.kill(group ? -target.process_group_id! : target.pid, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    return;
  }
  const script = [
    "$ErrorActionPreference='Stop'",
    `try { $target=[Diagnostics.Process]::GetProcessById(${target.pid}) } catch [ArgumentException] { exit 3 }`,
    "try {",
    "[void]$target.Handle",
    `if(([DateTimeOffset]$target.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() -ne ${Date.parse(target.started_identity)}) { exit 4 }`,
    signal === "SIGTERM" ? "[void]$target.CloseMainWindow()" : "$target.Kill()",
    "} finally { $target.Dispose() }",
  ].join("\n");
  const result = spawnSync(resolveWindowsPowerShell7(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", timeout: 10_000, windowsHide: true });
  if (result.error || ![0, 3].includes(result.status!)) throw new Error("native_process_signal_unconfirmed");
}

/** そのpidのprocessが今あるか。OSへ直接聞き、processを起こさない。権限が無くて触れないprocessも「ある」と読む。 */
function pidExists(pid: number): boolean {
  if (pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/**
 * 指定したpidの開始時刻だけを引く。readRuntimeProcessesと同じ開始時刻を返し、存在しないpidは結果に含めない。
 * process表にpidはあるが開始時刻を読めない時は、started_identityをnullで返す（pidが無いのとは区別する）。
 * 全processのargvを読む一覧取得は、processの多い端末で重い（定期実行から呼ばない）。
 */
export function readProcessIdentities(pids: number[]): { pid: number; started_identity: string | null }[] {
  if (pids.some(pid => !Number.isSafeInteger(pid) || pid < 0)) throw new AitermError("process照会のpidが不正です", 2);
  // 居ないpidは、OSへ直接聞いて先に除く。全部居なければ、processを起こさない。
  // macOSのpsは、範囲の外のpidが1つ混ざると、居るprocessの分も出さずに誤りで終わる。
  const wanted = [...new Set(pids)].filter(pidExists);
  if (wanted.length === 0) return [];
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
  // 開始時刻を読めない行も、pidがprocess表にある印として返す。
  // WMI（Win32_Process）は使わない。絞っても1回に0.1〜0.3秒かかり、WMIの側のprocess（wmiprvse）のCPUを使う
  // （process 1300個のWindowsで測った 2026-10-12。ADR 0112）。.NETのprocessの読み（OpenProcessとGetProcessTimes）は1個1.5ミリ秒。
  // 開始時刻は同じ値になる（WMIはマイクロ秒で切り捨てた値を返し、どちらも1ミリ秒で切り捨てて使う。888個のprocessで食い違いは0）。
  // 権限が無くて読めないprocessだけ、WMIへ聞き直す。
  const script = [
    ...WINDOWS_PROBE_HEADER,
    "$rows=@()",
    `foreach ($id in @(${wanted.join(",")})) {`,
    "  try { $p=[Diagnostics.Process]::GetProcessById($id) } catch [ArgumentException] { continue }",
    "  $started=$null",
    "  try { $started=$p.StartTime.ToUniversalTime().ToString('o') }",
    "  catch [InvalidOperationException] { continue }",
    "  catch {",
    "    $w=Get-CimInstance Win32_Process -Filter \"ProcessId=$id\" -Property CreationDate",
    "    if ($null -eq $w) { continue }",
    "    if ($null -ne $w.CreationDate) { $started=$w.CreationDate.ToUniversalTime().ToString('o') }",
    "  }",
    "  $rows += [ordered]@{ pid=[int]$id; started_identity=$started }",
    "}",
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
    if (!row || !Number.isSafeInteger(row.pid)) throw new AitermError("Windows process一覧のfieldが不正です", 2);
    if (row.started_identity === null) return { pid: row.pid, started_identity: null };
    if (typeof row.started_identity !== "string" || !Number.isFinite(Date.parse(row.started_identity)))
      throw new AitermError("Windows process一覧のfieldが不正です", 2);
    return { pid: row.pid, started_identity: new Date(row.started_identity).toISOString() };
  });
}

/** Private metadata-lock recovery read, not actor/invocation termination proof.
 * An empty/failed identity read alone cannot prove absence: require ESRCH from
 * the native PID probe as well. EPERM/unknown errors remain unknown. No signal
 * other than the existing read-only signal 0 and no process termination.
 */
export function observeExecutionActor(pid: number): ExecutionActorObservation {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new AitermError("process照会のpidが不正です", 2);
  const unknown = { state: "unknown" as const, pid };
  try {
    const rows = readProcessIdentities([pid]);
    if (rows.length === 1 && rows[0].pid === pid && rows[0].started_identity
      && Number.isFinite(Date.parse(rows[0].started_identity)))
      return { state: "present", actor: { pid, started_identity: rows[0].started_identity } };
    if (rows.length) return unknown;
    try { process.kill(pid, 0); return unknown; }
    catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH" ? { state: "absent", pid } : unknown; }
  } catch { return unknown; }
}

/** `ps -o etime=`の「[[日-]時:]分:秒」を秒にする。 */
export function parsePosixElapsed(value: string): number | null {
  const match = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600 + Number(match[3]) * 60 + Number(match[4]);
}

/**
 * processが始まってからの秒数。process表に無ければnull。OSへ照会できなかった時は例外にする。
 * 開始時刻でなく経過で返す。POSIXのpsが出す開始時刻は、time zoneの設定と時計合わせで読みが変わる。
 */
export function processElapsedSeconds(pid: number): number | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new AitermError("process照会のpidが不正です", 2);
  if (isWin) {
    const row = readProcessIdentities([pid])[0];
    if (!row) return null;
    if (row.started_identity === null) throw new AitermError("processの開始時刻を取得できません", 2);
    return Math.max(0, (Date.now() - Date.parse(row.started_identity)) / 1000);
  }
  const result = spawnSync(POSIX_PS, [...POSIX_ELAPSED_ARGS, String(pid)], {
    encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, timeout: 10000,
  });
  const text = (result.stdout ?? "").trim();
  // 該当するprocessが無い時、psは何も出さずstatus 1で終わる。
  if (result.error || (result.status !== 0 && !(result.status === 1 && !text))) throw new AitermError("OSのprocess一覧を取得できません", 2);
  if (!text) return null;
  const elapsed = parsePosixElapsed(text);
  if (elapsed === null) throw new AitermError("processの経過時間の形式を認識できません", 2);
  return elapsed;
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
  return lazyRelayExecutable(first?.[1] ?? first?.[2] ?? "");
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

/** Official native registries use Linux boot ticks and a PID namespace.
 * Other OS registry birth formats require their own accepted adapter. */
export function readLinuxProcessRegistrationIdentity(pid:number): {procStart:string;pidDomain:string}|null {
  if(process.platform!=="linux")return null;
  try{
    const start=processStartIdentity(pid,"linux");
    const domain=fs.readlinkSync(`/proc/${pid}/ns/pid`);
    if(!start?.startsWith("linux:")||!/^pid:\[\d+\]$/u.test(domain))return null;
    return {procStart:start.slice(6),pidDomain:`linux::${domain}`};
  }catch{return null;}
}


/** A detached seat clock sleeps in the native shell; exit 75 retries admission without keeping Node resident. */
export function idleClockCommand(delayMs: number, executable: string, args: string[], windows = isWin): { executable: string; args: string[] } {
  if (!Number.isFinite(delayMs) || !executable || [executable, ...args].some(value => value.includes("\0")))
    throw new Error("invalid_delayed_process");
  const seconds = Math.min(86_400, Math.max(1, Math.ceil(delayMs / 1000)));
  if (!windows) return { executable: "/bin/sh", args: ["-c",
    'aiterm_delay=$1; shift; sleep "$aiterm_delay" || exit; while :; do "$@"; aiterm_status=$?; [ "$aiterm_status" -eq 75 ] || exit "$aiterm_status"; sleep 60 || exit; done',
    "aiterm-idle-clock", String(seconds), executable, ...args] };
  const quote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
  const script = `$ErrorActionPreference='Stop'; Start-Sleep -Seconds ${seconds}; do { & ${[executable, ...args].map(quote).join(" ")}; if ($null -eq $LASTEXITCODE) { exit 2 }; $aiterm_status=$LASTEXITCODE; if ($aiterm_status -eq 75) { Start-Sleep -Seconds 60 } } while ($aiterm_status -eq 75); exit $aiterm_status`;
  return { executable: resolveWindowsPowerShell7(), args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64")] };
}
