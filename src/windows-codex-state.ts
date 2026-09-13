// WindowsのSteer保存先とPowerShell境界。接続記録の読取ではACLを変更しない。
import { execFileSync } from "node:child_process";
import { mkdirSync, lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { resolveWindowsPowerShell7 } from "./windows-powershell.js";
import { CodexDeliveryError } from "./codex-delivery-error.js";

export const quotePowerShell = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export function windowsPowerShellSync(script: string, timeout = 15_000): string {
  const source = "$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n" + script;
  try {
    return execFileSync(resolveWindowsPowerShell7(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
      Buffer.from(source, "utf16le").toString("base64")], {
      encoding: "utf8", windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new CodexDeliveryError("CODEX_WINDOWS_OPERATION_FAILED", "WindowsのSteer設定・接続情報を確認できません");
  }
}

function makePrivate(target: string, directory: boolean): void {
  const stat = lstatSync(target);
  if (!isAbsolute(target) || stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
    throw new CodexDeliveryError("CODEX_RELAY_PATH_INVALID", "Steer保存先が不正です");
  }
  windowsPowerShellSync(`
$target = ${quotePowerShell(target)}
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$previous = Get-Acl -LiteralPath $target
if ($previous.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -notin @($sid.Value, 'S-1-5-32-544')) { throw '所有者が一致しません' }
$acl = [System.Security.AccessControl.${directory ? "DirectorySecurity" : "FileSecurity"}]::new()
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', '${directory ? "ContainerInherit, ObjectInherit" : "None"}', 'None', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $target -AclObject $acl
$actual = Get-Acl -LiteralPath $target
if ($actual.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or !$actual.AreAccessRulesProtected) { throw 'ACLの適用を確認できません' }
`);
}

export function ensurePrivateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true });
  makePrivate(directory, true);
}

export function makeFilePrivate(file: string): void { makePrivate(file, false); }
