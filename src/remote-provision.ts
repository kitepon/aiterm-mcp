// provision (remote-terminal.md R16): install this Aiterm version as a product-owned runtime on a macOS, Linux or Windows terminal,
// before any terminal MCP exists. Runs over the binding's trusted key SSH; the terminal fetches the release assets.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { RemoteTerminalError, binding, bindingStatus, classifySshFailure, pinnedSshArguments, sshEnvironment, trustedSshArguments, trustedTarget } from "./remote-terminal.js";
import type { PinnedSsh } from "./remote-contract.js";
import { WINDOWS_STDIN_SCRIPT_COMMAND, remotePlatform } from "./remote.js";
import { verifySetupRuntime } from "./setup.js";
import { psmuxBin, psmuxVersionSupported } from "./tmux-runtime.js";
import type { RetireResult } from "./runtime-retire.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

export const RUNTIME_RELEASE_BASE = "https://github.com/kitepon/aiterm-mcp/releases/download";

/** The terminal-side bootstrap, run as `/bin/sh -s -- VERSION BASE`. Prints one result line. */
export const PROVISION_SCRIPT = String.raw`set -u
V="$1"; BASE="$2"
fail() { echo "AITERM_PROVISION_ERROR $1"; exit 3; }
case "$(uname -s)" in
  Darwin)
    OS=darwin
    case "$(uname -m)" in
      arm64) A=arm64 ;;
      x86_64) if [ "$(sysctl -in hw.optional.arm64 2>/dev/null)" = 1 ]; then A=arm64; else A=x64; fi ;;
      *) fail PROVISION_PLATFORM_UNSUPPORTED ;;
    esac ;;
  Linux)
    OS=linux
    case "$(uname -m)" in
      x86_64) A=x64 ;;
      aarch64|arm64) A=arm64 ;;
      *) fail PROVISION_PLATFORM_UNSUPPORTED ;;
    esac ;;
  *) fail PROVISION_PLATFORM_UNSUPPORTED ;;
esac
NAME="aiterm-runtime-$V-$OS-$A"
ROOT="$HOME/.aiterm/runtime"
mkdir -p "$ROOT" 2>/dev/null && chmod 700 "$HOME/.aiterm" "$ROOT" 2>/dev/null || fail RUNTIME_DIR_UNAVAILABLE
smoke() { "$1/bin/aiterm-remote-terminal" runtime-smoke --expect-version "$V" >/dev/null 2>&1 </dev/null; }
LOCK="$ROOT/.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  p=$(cat "$LOCK/pid" 2>/dev/null)
  if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then fail PROVISION_BUSY; fi
  rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || fail PROVISION_BUSY
fi
echo $$ > "$LOCK/pid"
STAGE="$ROOT/.stage-$$"
trap 'rm -rf "$STAGE" "$LOCK"' EXIT
# Seats that still run older Aiterm code are hibernated by the new runtime (retire-stale); a failure never undoes the result above it.
retire() {
  S=$(cut -d' ' -f1 "$ROOT/ACTIVATED" 2>/dev/null)
  [ -n "$S" ] && set -- --since "$S" || set --
  o=$("$ROOT/current/bin/aiterm-remote-terminal" retire-stale "$@" </dev/null 2>/dev/null | tail -n 1)
  case "$o" in '{"schema":"aiterm.retire-stale.v1"'*) echo "AITERM_PROVISION_RETIRE $o" ;; *) echo "AITERM_PROVISION_RETIRE_ERROR" ;; esac
}
if [ "$(cat "$ROOT/current/RUNTIME" 2>/dev/null)" = "$NAME" ] && smoke "$ROOT/current"; then
  echo "AITERM_PROVISION ALREADY_CURRENT $V $A"; retire; exit 0
fi
rm -rf "$ROOT"/.stage-*
mkdir -p "$STAGE/x" || fail RUNTIME_DIR_UNAVAILABLE
get() { curl -fsSL --retry 2 --connect-timeout 20 -o "$STAGE/$1" "$BASE/v$V/$1"; rc=$?; [ $rc = 0 ] && return 0; [ $rc = 22 ] && fail RUNTIME_ARTIFACT_UNAVAILABLE; fail RUNTIME_DOWNLOAD_FAILED; }
get "aiterm-runtime-$V-SHA256SUMS"
get "$NAME.tar.gz"
want=$(awk -v n="$NAME.tar.gz" '$2==n || $2=="*"n {print $1}' "$STAGE/aiterm-runtime-$V-SHA256SUMS")
if command -v shasum >/dev/null 2>&1; then got=$(shasum -a 256 "$STAGE/$NAME.tar.gz" | cut -d' ' -f1); else got=$(sha256sum "$STAGE/$NAME.tar.gz" | cut -d' ' -f1); fi
[ -n "$want" ] && [ "$want" = "$got" ] || fail RUNTIME_VERIFY_FAILED
tar -xzf "$STAGE/$NAME.tar.gz" -C "$STAGE/x" 2>/dev/null || fail RUNTIME_EXTRACT_FAILED
N="$STAGE/x/$NAME"
[ "$(cat "$N/RUNTIME" 2>/dev/null)" = "$NAME" ] || fail RUNTIME_VERIFY_FAILED
smoke "$N" || fail RUNTIME_SMOKE_FAILED
# Running seats and tmux servers are not touched here; the previous runtime stays until the next provision.
T=$(date +%s)
rm -rf "$ROOT/previous"
if [ -d "$ROOT/current" ]; then mv "$ROOT/current" "$ROOT/previous" || fail RUNTIME_ACTIVATE_FAILED; fi
if ! mv "$N" "$ROOT/current"; then
  [ -d "$ROOT/previous" ] && mv "$ROOT/previous" "$ROOT/current"
  fail RUNTIME_ACTIVATE_FAILED
fi
echo "$T $NAME" > "$ROOT/ACTIVATED"
echo "AITERM_PROVISION PROVISIONED $V $A"
retire
`;

/** The Windows bootstrap (PowerShell 5.1 and 7, ASCII only), run from stdin with V and BASE written in (both are validated before). Same result lines as PROVISION_SCRIPT.
 * `current` is a junction to `runtime\<name>`: a running aiterm-mcp keeps its files open, and repointing a junction does not touch them. */
export function windowsProvisionScript(version: string, base: string): string {
  return [
    "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'",
    `$V = '${version}'; $BASE = '${base}'`,
    "function Fail($c) { Write-Output ('AITERM_PROVISION_ERROR ' + $c); exit 3 }",
    "if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') { Fail 'PROVISION_PLATFORM_UNSUPPORTED' }",
    "$NAME = 'aiterm-runtime-' + $V + '-win32-x64'",
    "$ROOT = Join-Path $env:USERPROFILE '.aiterm\\runtime'",
    "try { New-Item -ItemType Directory -Force -Path $ROOT | Out-Null } catch { Fail 'RUNTIME_DIR_UNAVAILABLE' }",
    // Windows PowerShell 5.1 turns native stderr into a terminating error under 'Stop'. The runtime carries its own psmux.
    "function Native($exe, $arguments) { $ErrorActionPreference = 'Continue'; $o = & $exe @arguments 2>&1 | Out-String; return @{ ok = ($LASTEXITCODE -eq 0); out = $o } }",
    // Seats that still run older Aiterm code are hibernated by the new runtime; a failure never undoes the result above it.
    "function Retire { $s = ''; try { $s = ((Get-Content -LiteralPath (Join-Path $ROOT 'ACTIVATED') -Raw -ErrorAction Stop).Trim() -split '\\s+')[0] } catch { }",
    "  $a = @('retire-stale'); if ($s) { $a += @('--since', $s) }",
    "  $r = Native (Join-Path $ROOT 'current\\bin\\aiterm-remote-terminal.cmd') $a",
    "  $line = ($r.out -split '\\r?\\n' | Where-Object { $_.Trim() } | Select-Object -Last 1)",
    "  if ($r.ok -and $line -and $line.StartsWith('{\"schema\":\"aiterm.retire-stale.v1\"')) { Write-Output ('AITERM_PROVISION_RETIRE ' + $line) } else { Write-Output 'AITERM_PROVISION_RETIRE_ERROR' } }",
    "function Smoke($dir) { $r = Native (Join-Path $dir 'bin\\aiterm-remote-terminal.cmd') @('runtime-smoke', '--expect-version', $V); return $r.ok }",
    "function Target($link) { $i = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue; if ($i -and $i.LinkType -eq 'Junction') { return [string]$i.Target }; return $null }",
    "function Unlink($link) { if (Test-Path -LiteralPath $link) { [IO.Directory]::Delete($link) } }",
    "$lock = Join-Path $ROOT '.lock'",
    "try { New-Item -ItemType Directory -Path $lock | Out-Null } catch {",
    "  $p = 0; try { $p = [int](Get-Content -LiteralPath (Join-Path $lock 'pid') -ErrorAction Stop) } catch { }",
    "  if ($p -gt 0 -and (Get-Process -Id $p -ErrorAction SilentlyContinue)) { Fail 'PROVISION_BUSY' }",
    "  Remove-Item -LiteralPath $lock -Recurse -Force -ErrorAction SilentlyContinue",
    "  try { New-Item -ItemType Directory -Path $lock | Out-Null } catch { Fail 'PROVISION_BUSY' }",
    "}",
    "Set-Content -LiteralPath (Join-Path $lock 'pid') -Value $PID",
    "$stage = Join-Path $ROOT ('.stage-' + $PID)",
    "try {",
    "  $current = Join-Path $ROOT 'current'",
    "  $runtimeFile = Join-Path $current 'RUNTIME'",
    "  if ((Test-Path -LiteralPath $runtimeFile) -and ((Get-Content -LiteralPath $runtimeFile -Raw).Trim() -eq $NAME) -and (Smoke $current)) { Write-Output ('AITERM_PROVISION ALREADY_CURRENT ' + $V + ' x64'); Retire; exit 0 }",
    "  Get-ChildItem -LiteralPath $ROOT -Filter '.stage-*' -Force | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }",
    "  New-Item -ItemType Directory -Force -Path (Join-Path $stage 'x') | Out-Null",
    "  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12",
    "  function Get($file) {",
    "    try { Invoke-WebRequest -UseBasicParsing -Uri ($BASE + '/v' + $V + '/' + $file) -OutFile (Join-Path $stage $file) }",
    "    catch { if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -ge 400 -and [int]$_.Exception.Response.StatusCode -lt 500) { Fail 'RUNTIME_ARTIFACT_UNAVAILABLE' } Fail 'RUNTIME_DOWNLOAD_FAILED' }",
    "  }",
    "  $sums = 'aiterm-runtime-' + $V + '-SHA256SUMS'; $zip = $NAME + '.zip'",
    "  Get $sums; Get $zip",
    "  $want = ''",
    "  foreach ($line in (Get-Content -LiteralPath (Join-Path $stage $sums))) { $f = $line.Trim() -split '\\s+'; if ($f.Length -eq 2 -and ($f[1] -eq $zip -or $f[1] -eq ('*' + $zip))) { $want = $f[0].ToLower() } }",
    "  $got = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $stage $zip)).Hash.ToLower()",
    "  if (-not $want -or $want -ne $got) { Fail 'RUNTIME_VERIFY_FAILED' }",
    "  $x = Join-Path $stage 'x'",
    "  if (-not (Native (Join-Path $env:SystemRoot 'System32\\tar.exe') @('-xf', (Join-Path $stage $zip), '-C', $x)).ok) { Fail 'RUNTIME_EXTRACT_FAILED' }",
    "  $N = Join-Path $x $NAME",
    "  if (-not (Test-Path -LiteralPath (Join-Path $N 'RUNTIME')) -or (Get-Content -LiteralPath (Join-Path $N 'RUNTIME') -Raw).Trim() -ne $NAME) { Fail 'RUNTIME_VERIFY_FAILED' }",
    "  if (-not (Smoke $N)) { Fail 'RUNTIME_SMOKE_FAILED' }",
    // Running seats and psmux servers are not touched: the new directory is added beside the old one and only the junction moves.
    "  $T = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()",
    "  $dest = Join-Path $ROOT $NAME",
    "  $old = Target $current",
    "  if ($old -and ($old.TrimEnd('\\') -ieq $dest.TrimEnd('\\'))) { Unlink $current; $old = $null }",
    // A leftover of the same name (its smoke failed) may still be in use: move it aside, never delete files under a running process.
    "  if (Test-Path -LiteralPath $dest) { try { Move-Item -LiteralPath $dest -Destination ($dest + '.old-' + $PID) } catch { Fail 'RUNTIME_ACTIVATE_FAILED' } }",
    "  Move-Item -LiteralPath $N -Destination $dest",
    "  $previous = Join-Path $ROOT 'previous'",
    "  Unlink $previous",
    "  if ($old) { New-Item -ItemType Junction -Path $previous -Target $old | Out-Null }",
    "  Unlink $current",
    "  try { New-Item -ItemType Junction -Path $current -Target $dest | Out-Null }",
    "  catch { if ($old) { New-Item -ItemType Junction -Path $current -Target $old | Out-Null }; Fail 'RUNTIME_ACTIVATE_FAILED' }",
    // Older runtime folders go when nothing uses them; a folder a running aiterm-mcp holds stays (the delete fails and is ignored).
    "  $keep = @($dest, (Target $previous))",
    "  Get-ChildItem -LiteralPath $ROOT -Directory -Filter 'aiterm-runtime-*' -ErrorAction SilentlyContinue | Where-Object { $keep -notcontains $_.FullName } | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }",
    "  [IO.File]::WriteAllText((Join-Path $ROOT 'ACTIVATED'), ([string]$T + ' ' + $NAME))",
    "  Write-Output ('AITERM_PROVISION PROVISIONED ' + $V + ' x64')",
    "  Retire",
    "} finally {",
    "  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue",
    "  Remove-Item -LiteralPath $lock -Recurse -Force -ErrorAction SilentlyContinue",
    "}",
    "",
  ].join("\n");
}

/** The retire-stale result line the bootstrap prints after its result line; null when absent or it failed. */
export function parseRetireOutput(stdout: string): RetireResult | null {
  const line = /^AITERM_PROVISION_RETIRE (\{.*\})\s*$/m.exec(stdout)?.[1];
  try { const value = line ? JSON.parse(line) : null; return value?.schema === "aiterm.retire-stale.v1" ? value : null; } catch { return null; }
}

export function parseProvisionOutput(stdout: string): { result: "PROVISIONED" | "ALREADY_CURRENT"; version: string } | { code: string } | null {
  const ok = /^AITERM_PROVISION (PROVISIONED|ALREADY_CURRENT) (\S+) /m.exec(stdout);
  if (ok) return { result: ok[1] as "PROVISIONED" | "ALREADY_CURRENT", version: ok[2] };
  const error = /^AITERM_PROVISION_ERROR ([A-Z_]+)$/m.exec(stdout);
  return error ? { code: error[1] } : null;
}

type ProvisionResult = { result: "PROVISIONED" | "ALREADY_CURRENT"; version: string; retire: RetireResult | null };

/** R16 over any ssh route: `argsFor(command)` is the ssh argv for that remote command, `target` is what the platform probe runs against. */
async function runProvision(target: Parameters<typeof remotePlatform>[0], argsFor: (command: string) => string[], version: string): Promise<ProvisionResult> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new RemoteTerminalError("VERSION_INVALID", "the runtime version must be x.y.z");
  const windows = await remotePlatform(target) === "windows";
  const args = argsFor(windows ? WINDOWS_STDIN_SCRIPT_COMMAND : `/bin/sh -s -- ${version} ${RUNTIME_RELEASE_BASE}`);
  const run = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("ssh", args, { env: sshEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill(), 1_200_000);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-4000); });
    child.on("error", reject);
    child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.on("error", () => { /* classified by the exit */ });
    child.stdin.end(windows ? windowsProvisionScript(version, RUNTIME_RELEASE_BASE) : PROVISION_SCRIPT);
  });
  const parsed = parseProvisionOutput(run.stdout);
  if (parsed && "result" in parsed && run.code === 0) return { result: parsed.result, version: parsed.version, retire: parseRetireOutput(run.stdout) };
  if (parsed && "code" in parsed) throw new RemoteTerminalError(parsed.code, `provisioning the terminal failed (${parsed.code})`);
  if (run.code === 255) { const f = classifySshFailure(run.stderr); throw new RemoteTerminalError(f.code, f.message, f.action); }
  throw new RemoteTerminalError("PROVISION_FAILED", "the terminal returned no provisioning result");
}

export async function provision(ref: string, version = pkg.version): Promise<{ schema: string; ref: string } & ProvisionResult> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new RemoteTerminalError("VERSION_INVALID", "the runtime version must be x.y.z");
  const status = bindingStatus(ref);
  if (!status.trust.available) throw new RemoteTerminalError(status.trust.reason ?? "HOST_TRUST_MISSING", "the terminal's host key is not trusted", "confirm the new host key");
  if (status.credential.provider === "aiterm.native-ssh-key.v1" && !status.credential.available)
    throw new RemoteTerminalError("CREDENTIAL_UNAVAILABLE", status.credential.reason ?? "the key is unavailable");
  // Throws CREDENTIAL_NOT_LOADED for a keyless binding whose key is not loaded.
  return { schema: "aiterm.remote-provision.v1", ref, ...await runProvision(trustedTarget(binding(ref)), command => trustedSshArguments(ref, command, null), version) };
}

/** `aiterm-remote install-aiterm`: the same install over caller-pinned ssh options (no binding). */
export async function provisionPinned(peer: { host: string; user: string; port?: number; ssh: PinnedSsh }, version = pkg.version): Promise<{ schema: string; host: string; user: string; port: number | null } & ProvisionResult> {
  return { schema: "aiterm.remote-provision.v1", host: peer.host, user: peer.user, port: peer.port ?? null,
    ...await runProvision(peer, command => pinnedSshArguments(peer, peer.ssh, command, null), version) };
}

/** runtime-smoke on the terminal: this runtime's version, its tmux, and the setup probe through its own aiterm-mcp. */
export async function runtimeSmoke(expectVersion: string): Promise<{ schema: string; version: string; tmux: string }> {
  if (pkg.version !== expectVersion) throw new RemoteTerminalError("RUNTIME_SMOKE_FAILED", `runtime is ${pkg.version}, expected ${expectVersion}`);
  if (process.platform === "win32") {
    // The runtime's own psmux (<runtime>\bin\psmux.exe, beside <runtime>\node\node.exe); Aiterm's lookup only in a build tree.
    const ownPsmux = path.resolve(process.execPath, "../../bin/psmux.exe");
    const psmux = spawnSync(fs.existsSync(ownPsmux) ? ownPsmux : psmuxBin(), ["-V"], { encoding: "utf8", timeout: 10_000 });
    if (psmux.status !== 0 || !psmuxVersionSupported(psmux.stdout ?? "")) throw new RemoteTerminalError("RUNTIME_SMOKE_FAILED", "the runtime's psmux does not run");
    await verifySetupRuntime({ command: process.execPath, args: [fileURLToPath(new URL("./index.js", import.meta.url))] });
    return { schema: "aiterm.runtime-smoke.v1", version: pkg.version, tmux: (/^psmux .*/mu.exec(psmux.stdout ?? "")?.[0] ?? "psmux").trim() };
  }
  // The runtime's own tmux (<runtime>/bin/tmux, beside <runtime>/node/bin/node); another one on PATH is only for a build tree.
  const own = path.resolve(process.execPath, "../../../bin/tmux");
  const tmux = spawnSync(fs.existsSync(own) ? own : "tmux", ["-V"], { encoding: "utf8", timeout: 10_000 });
  if (tmux.status !== 0) throw new RemoteTerminalError("RUNTIME_SMOKE_FAILED", "tmux does not run");
  await verifySetupRuntime({ command: process.execPath, args: [fileURLToPath(new URL("./index.js", import.meta.url))] });
  return { schema: "aiterm.runtime-smoke.v1", version: pkg.version, tmux: tmux.stdout.trim() };
}
