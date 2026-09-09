// Windows PowerShell実体の唯一の解決境界。5.1／cmd fallbackを持たず、検出したpwsh自身の
// edition／majorを実行時に検証してから絶対pathを返す。
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { AitermError } from "./errors.js";

export const WINDOWS_POWERSHELL_7_COMMAND = "pwsh.exe";
export const WINDOWS_POWERSHELL_7_INSTALL = "winget install --id Microsoft.PowerShell --source winget";
export const WINDOWS_POWERSHELL_7_FIXTURE = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";

export type WindowsPowerShellProbe = (command: string, args: readonly string[]) => {
  status: number | null;
  stdout?: string | null;
  error?: NodeJS.ErrnoException;
};

const defaultProbe: WindowsPowerShellProbe = (command, args) => spawnSync(command, [...args], {
  encoding: "utf8", timeout: 5000, maxBuffer: 16 * 1024, windowsHide: true,
});
let resolvedDefault: string | null = null;

export function resolveWindowsPowerShell7(probe: WindowsPowerShellProbe = defaultProbe): string {
  if (probe === defaultProbe && resolvedDefault !== null) return resolvedDefault;
  const located = probe("where.exe", [WINDOWS_POWERSHELL_7_COMMAND]);
  const resolved = located.stdout?.split(/\r?\n/u)
    .find(candidate => path.win32.isAbsolute(candidate)
      && path.win32.basename(candidate).toLowerCase() === WINDOWS_POWERSHELL_7_COMMAND)
    ?? path.win32.join(process.env.ProgramFiles ?? "C:\\Program Files", "PowerShell", "7", WINDOWS_POWERSHELL_7_COMMAND);
  const fail = (): never => { throw new AitermError(
    `PowerShell 7が必要です。Microsoft公式経路で導入してください: ${WINDOWS_POWERSHELL_7_INSTALL}`,
    2,
  ); };
  const executable = resolved as string;
  const version = probe(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
    '[ordered]@{ edition = $PSVersionTable.PSEdition; major = $PSVersionTable.PSVersion.Major } | ConvertTo-Json -Compress']);
  let identity: { edition?: unknown; major?: unknown } | null = null;
  try { identity = JSON.parse(version.stdout?.trim() ?? ""); } catch { /* typed failure below */ }
  if (version.status !== 0 || identity?.edition !== "Core"
    || !Number.isInteger(identity.major) || Number(identity.major) < 7) fail();
  if (probe === defaultProbe) resolvedDefault = executable;
  return executable;
}

export function windowsPowerShell7Command(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? resolveWindowsPowerShell7() : WINDOWS_POWERSHELL_7_FIXTURE;
}
