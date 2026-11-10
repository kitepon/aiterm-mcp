// authorize-key (remote-terminal.md R14): one password-only SSH login that appends the terminal's held public key
// to ~/.ssh/authorized_keys. The password lives only in this process's memory and one askpass socket connection.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { WINDOWS_STDIN_SCRIPT_COMMAND } from "./remote.js";
import { RemoteTerminalError, agentAlive, binding, bindingStatus, classifySshFailure, credentialPublicKeyFile, publicKey,
  readCredential, sshEnvironment, type Binding } from "./remote-terminal.js";

export const ASKPASS_SOCKET_ENV = "AITERM_ASKPASS_SOCKET";
const PUBLIC_KEY = /^[A-Za-z0-9@.-]+ [A-Za-z0-9+/]+={0,3}$/;
const MAX_PASSWORD_BYTES = 1023; // ssh reads at most 1024 bytes from askpass, cut at the first CR/LF

/** The key this binding authenticates with afterwards: native key file, or the one credential-load holds. */
function heldPublicKey(b: Binding): string {
  let line: string;
  if (b.key_file) {
    const key = publicKey(b.key_file);
    if ("reason" in key) throw new RemoteTerminalError("CREDENTIAL_UNAVAILABLE", key.reason);
    line = key.line;
  } else {
    const loaded = readCredential(b.ref);
    if (!loaded || !agentAlive(loaded.socket))
      throw new RemoteTerminalError("CREDENTIAL_NOT_LOADED", "the terminal's credential is not loaded; resolve the handle and run credential-load first");
    try { line = fs.readFileSync(credentialPublicKeyFile(b.ref), "utf8").trim().split(/\s+/).slice(0, 2).join(" "); }
    catch { throw new RemoteTerminalError("CREDENTIAL_NOT_LOADED", "the loaded credential has no public key; run credential-load again"); }
  }
  if (!PUBLIC_KEY.test(line)) throw new RemoteTerminalError("CREDENTIAL_UNAVAILABLE", "the held public key is malformed");
  return line;
}

/** Checks that need no password: done before the caller's stdin is read. */
export function prepareAuthorization(ref: string): { b: Binding; key: string } {
  const b = binding(ref);
  const status = bindingStatus(ref);
  if (!status.trust.available) throw new RemoteTerminalError(status.trust.reason ?? "HOST_TRUST_MISSING", "the terminal's host key is not trusted", "confirm the new host key");
  return { b, key: heldPublicKey(b) };
}

/** Raw stdin bytes, nothing removed. Values ssh's askpass cannot carry exactly are refused, never altered. */
export function checkPassword(password: Buffer): void {
  let text = "";
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(password); } catch { /* invalid below */ }
  // eslint-disable-next-line no-control-regex
  if (password.length === 0 || password.length > MAX_PASSWORD_BYTES || !text || /[\x00\r\n]/.test(text))
    throw new RemoteTerminalError("PASSWORD_INVALID", "the password must be 1-1023 bytes of UTF-8 on stdin without NUL, CR or LF (no trailing newline)");
}

export function authorizedKeysScript(key: string): string {
  const [type, blob] = key.split(" ");
  return [
    "umask 077",
    `k='${key}'; t='${type}'; b='${blob}'`,
    'd="$HOME/.ssh"; f="$d/authorized_keys"',
    'mkdir -p "$d" 2>/dev/null && chmod 700 "$d" 2>/dev/null || exit 21',
    'if [ ! -e "$f" ]; then : > "$f" 2>/dev/null || exit 22; fi',
    'chmod 600 "$f" 2>/dev/null || exit 22',
    // Same key type and blob anywhere on a line: options and comments do not matter.
    `if awk -v t="$t" -v b="$b" '{for(i=1;i<NF;i++) if($i==t && $(i+1)==b) f=1} END{exit f?0:1}' "$f" 2>/dev/null; then echo "AITERM_AUTHORIZE ALREADY_AUTHORIZED"; exit 0; fi`,
    'if [ -s "$f" ] && [ -n "$(tail -c 1 "$f")" ]; then printf \'\\n\' >> "$f" || exit 22; fi',
    'printf \'%s\\n\' "$k" >> "$f" || exit 22',
    'echo "AITERM_AUTHORIZE AUTHORIZED"',
    "",
  ].join("\n");
}

/** PowerShell variant (5.1 and 7, ASCII only, run from stdin). Decides the file from the user's group and sshd_config, then the same protocol:
 * markers on stdout (the nested exit code is not reliable under `pwsh -c`), ERROR 21 = the folder, 22 = the file or its ACL. */
export function windowsAuthorizedKeysScript(key: string): string {
  const [type, blob] = key.split(" ");
  return [
    "$ErrorActionPreference = 'Stop'",
    `$key = '${key}'; $type = '${type}'; $blob = '${blob}'`,
    "function Done($text) { Write-Output ('AITERM_AUTHORIZE ' + $text); exit 0 }",
    "function Fail($n) { Write-Output ('AITERM_AUTHORIZE_ERROR ' + $n); exit $n }",
    // sshd reads administrators_authorized_keys instead of the user's file only for Administrators and only with the default Match block.
    "$shared = $false",
    "try {",
    "  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
    "  $cfg = Join-Path $env:ProgramData 'ssh\\sshd_config'",
    "  if ($admin -and (Test-Path -LiteralPath $cfg)) {",
    "    $in = $false",
    "    foreach ($line in [IO.File]::ReadAllLines($cfg)) {",
    "      $t = $line.Trim()",
    "      if ($t -match '^Match\\s') { $in = ($t -match '^Match\\s+Group\\s+administrators\\s*$') }",
    "      elseif ($in -and $t -match '^AuthorizedKeysFile\\s+__PROGRAMDATA__/ssh/administrators_authorized_keys\\s*$') { $shared = $true }",
    "    }",
    "  }",
    "} catch { $shared = $false }",
    "$dir = Join-Path $env:USERPROFILE '.ssh'",
    "if ($shared) { $file = Join-Path $env:ProgramData 'ssh\\administrators_authorized_keys' } else { $file = Join-Path $dir 'authorized_keys' }",
    "try { if (-not $shared) { New-Item -ItemType Directory -Force -Path $dir | Out-Null } } catch { Fail 21 }",
    "try {",
    "  $text = ''",
    "  if (Test-Path -LiteralPath $file) { $text = [IO.File]::ReadAllText($file) }",
    "  foreach ($line in ($text -split '\\r?\\n')) {",
    "    $f = $line.Trim() -split '\\s+'",
    "    for ($i = 0; $i -lt $f.Length - 1; $i++) { if ($f[$i] -eq $type -and $f[$i + 1] -eq $blob) { Done 'ALREADY_AUTHORIZED' } }",
    "  }",
    '  $nl = "`n"; if ($text.Contains("`r`n")) { $nl = "`r`n" }',
    "  $prefix = ''; if ($text.Length -gt 0 -and -not $text.EndsWith(\"`n\")) { $prefix = $nl }",
    "  [IO.File]::AppendAllText($file, $prefix + $key + $nl, (New-Object System.Text.UTF8Encoding($false)))",
    // sshd ignores the shared file unless only Administrators and SYSTEM may use it (well-known SIDs: names are localized).
    "  if ($shared) { & icacls.exe $file /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F' | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'acl' } }",
    "} catch { Fail 22 }",
    "Done 'AUTHORIZED'",
    "",
  ].join("\n");
}

export type AuthorizeSystem = "posix" | "windows";

export function passwordSshArguments(b: Binding, system: AuthorizeSystem = "posix"): string[] {
  return ["-F", "/dev/null", "-T", "-o", "BatchMode=no", "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${b.known_hosts_file}`, "-o", "GlobalKnownHostsFile=/dev/null", "-o", "CheckHostIP=no",
    ...(b.host_key_alias ? ["-o", `HostKeyAlias=${b.host_key_alias}`] : []),
    "-o", "PubkeyAuthentication=no", "-o", "IdentityAgent=none", "-o", "IdentitiesOnly=yes", "-o", "IdentityFile=none",
    "-o", "PreferredAuthentications=password", "-o", "PasswordAuthentication=yes", "-o", "KbdInteractiveAuthentication=no",
    "-o", "GSSAPIAuthentication=no", "-o", "HostbasedAuthentication=no", "-o", "NumberOfPasswordPrompts=1",
    "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "ConnectTimeout=15",
    "-l", b.target.user, "-p", String(b.target.port), "--", b.target.host, system === "windows" ? WINDOWS_STDIN_SCRIPT_COMMAND : "/bin/sh -s"];
}

const shq = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

export async function authorizeKey(prepared: { b: Binding; key: string }, password: Buffer, system: AuthorizeSystem = "posix"): Promise<{ schema: string; ref: string; result: "AUTHORIZED" | "ALREADY_AUTHORIZED" }> {
  const dir = fs.mkdtempSync(path.join("/tmp", "aiterm-ap-"));
  let served = 0;
  const server = net.createServer(connection => { served += 1; if (served === 1) connection.end(password); else connection.end(); });
  try {
    checkPassword(password);
    fs.chmodSync(dir, 0o700);
    const socket = path.join(dir, "s");
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socket, resolve); });
    const helper = path.join(dir, "askpass");
    const cli = fileURLToPath(new URL("./remote-terminal-cli.js", import.meta.url));
    fs.writeFileSync(helper, `#!/bin/sh\nexec ${shq(process.execPath)} ${shq(cli)} askpass "$@"\n`, { mode: 0o700 });
    const env = { ...sshEnvironment(), SSH_ASKPASS: helper, SSH_ASKPASS_REQUIRE: "force", DISPLAY: process.env.DISPLAY ?? "aiterm:0", [ASKPASS_SOCKET_ENV]: socket };
    const run = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn("ssh", passwordSshArguments(prepared.b, system), { env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => child.kill(), 120_000);
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-4000); });
      child.on("error", reject);
      child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
      child.stdin.on("error", () => { /* ssh ended before reading the script: classified by its exit */ });
      child.stdin.end(system === "windows" ? windowsAuthorizedKeysScript(prepared.key) : authorizedKeysScript(prepared.key));
    });
    const marker = /AITERM_AUTHORIZE (AUTHORIZED|ALREADY_AUTHORIZED)/.exec(run.stdout)?.[1] as "AUTHORIZED" | "ALREADY_AUTHORIZED" | undefined;
    if (run.code === 0 && marker) return { schema: "aiterm.remote-key-authorization.v1", ref: prepared.b.ref, result: marker };
    const failed = Number(/AITERM_AUTHORIZE_ERROR (21|22)/.exec(run.stdout)?.[1] ?? run.code);
    if (failed === 21 || failed === 22) throw new RemoteTerminalError("AUTHORIZED_KEYS_WRITE_FAILED", "~/.ssh/authorized_keys could not be written on the terminal");
    const denied = /Permission denied \(([^)]*)\)/.exec(run.stderr);
    if (denied) {
      if (served > 0) throw new RemoteTerminalError("PASSWORD_REJECTED", "the terminal rejected the password");
      if (!denied[1].split(",").includes("password")) throw new RemoteTerminalError("PASSWORD_AUTH_DISABLED", "the terminal does not offer password login");
      throw new RemoteTerminalError("AUTH_FAILED", "the password could not be offered to the terminal");
    }
    if (run.code === 255) { const f = classifySshFailure(run.stderr); throw new RemoteTerminalError(f.code, f.message, f.action); }
    throw new RemoteTerminalError("COMMAND_FAILED", "authorized_keys could not be updated on the terminal");
  } finally {
    password.fill(0);
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The SSH_ASKPASS helper: answer a password prompt once from the parent's socket, nothing else. */
export function askpass(prompt: string, socket: string | undefined): void {
  if (!socket || !/password/i.test(prompt) || /passphrase|yes\/no/i.test(prompt)) process.exit(1);
  const chunks: Buffer[] = [];
  const connection = net.createConnection(socket);
  connection.on("data", (chunk: Buffer) => chunks.push(chunk));
  connection.on("error", () => process.exit(1));
  connection.on("end", () => {
    const value = Buffer.concat(chunks);
    if (value.length === 0) process.exit(1);
    process.stdout.write(Buffer.concat([value, Buffer.from("\n")]), () => { value.fill(0); process.exit(0); });
  });
}
