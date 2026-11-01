// OS process birth identity, shared by native ownership and runtime store.
import * as fs from "node:fs";
import {spawnSync} from "node:child_process";
import {resolveWindowsPowerShell7} from "./windows-powershell.js";

export function processStartIdentities(pids: number[], platform: NodeJS.Platform, timeoutMs = 1000): (string | null)[] {
  if (platform !== "win32") return pids.map(pid => processStartIdentity(pid, platform, timeoutMs));
  const wanted = [...new Set(pids.filter(pid => Number.isSafeInteger(pid) && pid > 0))];
  if (!wanted.length) return pids.map(() => null);
  const script = "$rows=@(foreach($id in ($env:AITERMMCP_PROCESS_IDS -split ',')){ $start=$null; try { $p=Get-Process -Id ([int]$id) -ErrorAction Stop; $start=$p.StartTime.ToUniversalTime().Ticks.ToString() } catch {}; [ordered]@{pid=[int]$id;start=$start} }); ConvertTo-Json -InputObject $rows -Compress";
  const result = spawnSync(resolveWindowsPowerShell7(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", timeout: timeoutMs, maxBuffer: 4096, windowsHide: true,
    env: { ...process.env, AITERMMCP_PROCESS_IDS: wanted.join(",") },
  });
  let rows: unknown;
  try { rows = result.status === 0 ? JSON.parse(result.stdout ?? "") : null; } catch { rows = null; }
  if (!Array.isArray(rows) || rows.length !== wanted.length
    || rows.some((row, i) => !row || row.pid !== wanted[i]
      || row.start !== null && (typeof row.start !== "string" || !/^\d+$/.test(row.start))))
    return pids.map(() => null);
  const starts = new Map(rows.map(row => [row.pid, row.start === null ? null : `win32:${row.start}`]));
  return pids.map(pid => starts.get(pid) ?? null);
}

export function processStartIdentity(pid: number, platform: NodeJS.Platform, timeoutMs = 1000): string | null {
  if (!Number.isInteger(pid) || pid < 1) return null;
  if (platform === "linux") {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      const fields = stat.slice(close + 2).split(" ");
      return fields[19] ? `linux:${fields[19]}` : null;
    } catch { return null; }
  }
  if (platform === "win32") {
    return processStartIdentities([pid], platform, timeoutMs)[0];
  }
  // lstart の日付書式は LC_TIME で変わり、locale の違う観測者間で identity が割れる
  // （caveat: ps-locale-lstart-lc-time-ascii-argv-lc-ctype-digest。Lattice 0.63.4 と同じ固定）
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8", timeout: 1000, maxBuffer: 4096, env: { ...process.env, LC_ALL: "C" },
  });
  const value = result.status === 0 ? (result.stdout ?? "").trim() : "";
  return value ? `${platform}:${value}` : null;
}
