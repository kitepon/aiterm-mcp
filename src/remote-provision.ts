// provision (remote-terminal.md R16): install this Aiterm version as a product-owned runtime on a macOS terminal,
// before any terminal MCP exists. Runs over the binding's trusted key SSH; the terminal fetches the release assets.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { RemoteTerminalError, bindingStatus, classifySshFailure, sshEnvironment, trustedSshArguments } from "./remote-terminal.js";
import { verifySetupRuntime } from "./setup.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

export const RUNTIME_RELEASE_BASE = "https://github.com/kitepon/aiterm-mcp/releases/download";

/** The terminal-side bootstrap, run as `/bin/sh -s -- VERSION BASE`. Prints one result line. */
export const PROVISION_SCRIPT = String.raw`set -u
V="$1"; BASE="$2"
fail() { echo "AITERM_PROVISION_ERROR $1"; exit 3; }
[ "$(uname -s)" = Darwin ] || fail PROVISION_PLATFORM_UNSUPPORTED
case "$(uname -m)" in
  arm64) A=arm64 ;;
  x86_64) if [ "$(sysctl -in hw.optional.arm64 2>/dev/null)" = 1 ]; then A=arm64; else A=x64; fi ;;
  *) fail PROVISION_PLATFORM_UNSUPPORTED ;;
esac
NAME="aiterm-runtime-$V-darwin-$A"
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
if [ "$(cat "$ROOT/current/RUNTIME" 2>/dev/null)" = "$NAME" ] && smoke "$ROOT/current"; then
  echo "AITERM_PROVISION ALREADY_CURRENT $V $A"; exit 0
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
# Running seats and tmux servers are not touched; the previous runtime stays until the next provision.
rm -rf "$ROOT/previous"
if [ -d "$ROOT/current" ]; then mv "$ROOT/current" "$ROOT/previous" || fail RUNTIME_ACTIVATE_FAILED; fi
if ! mv "$N" "$ROOT/current"; then
  [ -d "$ROOT/previous" ] && mv "$ROOT/previous" "$ROOT/current"
  fail RUNTIME_ACTIVATE_FAILED
fi
echo "AITERM_PROVISION PROVISIONED $V $A"
`;

export function parseProvisionOutput(stdout: string): { result: "PROVISIONED" | "ALREADY_CURRENT"; version: string } | { code: string } | null {
  const ok = /^AITERM_PROVISION (PROVISIONED|ALREADY_CURRENT) (\S+) /m.exec(stdout);
  if (ok) return { result: ok[1] as "PROVISIONED" | "ALREADY_CURRENT", version: ok[2] };
  const error = /^AITERM_PROVISION_ERROR ([A-Z_]+)$/m.exec(stdout);
  return error ? { code: error[1] } : null;
}

export async function provision(ref: string, version = pkg.version): Promise<{ schema: string; ref: string; result: "PROVISIONED" | "ALREADY_CURRENT"; version: string }> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new RemoteTerminalError("VERSION_INVALID", "the runtime version must be x.y.z");
  const status = bindingStatus(ref);
  if (!status.trust.available) throw new RemoteTerminalError(status.trust.reason ?? "HOST_TRUST_MISSING", "the terminal's host key is not trusted", "confirm the new host key");
  if (status.credential.provider === "aiterm.native-ssh-key.v1" && !status.credential.available)
    throw new RemoteTerminalError("CREDENTIAL_UNAVAILABLE", status.credential.reason ?? "the key is unavailable");
  // Throws CREDENTIAL_NOT_LOADED for a keyless binding whose key is not loaded.
  const args = trustedSshArguments(ref, `/bin/sh -s -- ${version} ${RUNTIME_RELEASE_BASE}`, null);
  const run = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("ssh", args, { env: sshEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill(), 1_200_000);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-4000); });
    child.on("error", reject);
    child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.on("error", () => { /* classified by the exit */ });
    child.stdin.end(PROVISION_SCRIPT);
  });
  const parsed = parseProvisionOutput(run.stdout);
  if (parsed && "result" in parsed && run.code === 0) return { schema: "aiterm.remote-provision.v1", ref, result: parsed.result, version: parsed.version };
  if (parsed && "code" in parsed) throw new RemoteTerminalError(parsed.code, `provisioning the terminal failed (${parsed.code})`);
  if (run.code === 255) { const f = classifySshFailure(run.stderr); throw new RemoteTerminalError(f.code, f.message, f.action); }
  throw new RemoteTerminalError("PROVISION_FAILED", "the terminal returned no provisioning result");
}

/** runtime-smoke on the terminal: this runtime's version, its tmux, and the setup probe through its own aiterm-mcp. */
export async function runtimeSmoke(expectVersion: string): Promise<{ schema: string; version: string; tmux: string }> {
  if (pkg.version !== expectVersion) throw new RemoteTerminalError("RUNTIME_SMOKE_FAILED", `runtime is ${pkg.version}, expected ${expectVersion}`);
  const tmux = spawnSync("tmux", ["-V"], { encoding: "utf8", timeout: 10_000 });
  if (tmux.status !== 0) throw new RemoteTerminalError("RUNTIME_SMOKE_FAILED", "tmux does not run");
  await verifySetupRuntime({ command: process.execPath, args: [fileURLToPath(new URL("./index.js", import.meta.url))] });
  return { schema: "aiterm.runtime-smoke.v1", version: pkg.version, tmux: tmux.stdout.trim() };
}
