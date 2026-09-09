// setupのOS差と公式package managerの呼出しを所有する。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolveWindowsPowerShell7 } from "./windows-powershell.js";
import { resolveWinPaneShell } from "./agent-resolver.js";
import { ensureWinPsmux, resolveTmux } from "./tmux-runtime.js";

export class SetupError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export function powershellInvocation(command: string, args: string[]): string[] {
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const script = `& ${[command, ...args].map(literal).join(" ")}; if ($null -eq $LASTEXITCODE) { exit 1 }; exit $LASTEXITCODE`;
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}

export type SetupRun = (command: string, args: string[]) => string;
export const runSetupCommand: SetupRun = (command, args) => {
  const batch = process.platform === "win32" && /\.(?:cmd|bat)$/iu.test(command);
  const result = spawnSync(batch ? resolveWindowsPowerShell7() : command,
    batch ? powershellInvocation(command, args) : args,
    { encoding: "utf8", windowsHide: true, timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new SetupError("command_failed", `${command}: ${result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`}`);
  }
  return result.stdout;
};

export function dependencyInstallCommand(platform: NodeJS.Platform, dependency: string, linuxId = ""): [string, string[]] {
  if (platform === "win32") {
    const ids: Record<string, string> = { psmux: "marlocarlo.psmux", pwsh: "Microsoft.PowerShell", git: "Git.Git" };
    if (ids[dependency]) return ["winget.exe", ["install", "--id", ids[dependency], "--exact", "--source", "winget", "--accept-source-agreements", "--accept-package-agreements", "--disable-interactivity"]];
  }
  if (dependency === "tmux" && platform === "darwin") {
    const brew = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].find(existsSync) ?? "brew";
    return [brew, ["install", "tmux"]];
  }
  if (dependency === "tmux" && platform === "linux" && ["ubuntu", "debian"].includes(linuxId)) {
    return ["sudo", ["-n", "apt-get", "install", "--no-remove", "-y", "tmux"]];
  }
  throw new SetupError("platform_unsupported", `${platform}/${linuxId}の${dependency}自動導入には対応していません`);
}

export function prepareBackend(run: SetupRun = runSetupCommand): void {
  const platform = process.platform;
  const linuxId = platform === "linux" ? /^ID=["']?([^"'\r\n]+)/mu.exec(readFileSync("/etc/os-release", "utf8"))?.[1] ?? "" : "";
  const ensure = (name: string, probe: () => unknown) => {
    try { probe(); return; } catch (error) {
      // 失敗を隠さず、製品の正規導入で修復してから同じprobeを再実行する。
      process.stderr.write(`aiterm-setup: ${name}を準備します（${error instanceof Error ? error.message : String(error)}）\n`);
    }
    const [command, args] = dependencyInstallCommand(platform, name, linuxId);
    if (platform === "linux") run("sudo", ["-n", "apt-get", "update"]);
    run(command, args);
    probe();
  };
  if (platform === "win32") {
    ensure("pwsh", () => resolveWindowsPowerShell7());
    ensure("git", () => resolveWinPaneShell("bash"));
    if (process.env.AITERM_PSMUX) ensureWinPsmux(false);
    else ensure("psmux", () => ensureWinPsmux(false));
  } else if (platform === "darwin" || platform === "linux") {
    if (process.env.AITERM_TMUX) resolveTmux(false);
    else ensure("tmux", () => resolveTmux(false));
  } else {
    throw new SetupError("platform_unsupported", `${platform}には対応していません`);
  }
}
