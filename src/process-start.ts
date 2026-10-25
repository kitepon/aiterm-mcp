// OS process birth identity, shared by native ownership and runtime store.
import * as fs from "node:fs";
import {spawnSync} from "node:child_process";
import {resolveWindowsPowerShell7} from "./windows-powershell.js";

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
    const script = "$p=Get-Process -Id $env:AITERMMCP_PROCESS_ID -ErrorAction Stop; $p.StartTime.ToUniversalTime().Ticks";
    const result = spawnSync(resolveWindowsPowerShell7(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8", timeout: timeoutMs, maxBuffer: 4096, windowsHide: true,
      env: { ...process.env, AITERMMCP_PROCESS_ID: String(pid) },
    });
    const value = result.status === 0 ? (result.stdout ?? "").trim() : "";
    return /^\d+$/.test(value) ? `win32:${value}` : null;
  }
  // lstart の日付書式は LC_TIME で変わり、locale の違う観測者間で identity が割れる
  // （caveat: ps-locale-lstart-lc-time-ascii-argv-lc-ctype-digest。Lattice 0.63.4 と同じ固定）
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8", timeout: 1000, maxBuffer: 4096, env: { ...process.env, LC_ALL: "C" },
  });
  const value = result.status === 0 ? (result.stdout ?? "").trim() : "";
  return value ? `${platform}:${value}` : null;
}

