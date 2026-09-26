// エージェント CLI（claude / codex / grok / cursor-agent）・Throughline・pane shell（Windows は Git Bash）の
// 実行ファイルをどう見つけ、どう起動するかの所有者（OS 分岐の所有者。tmux とは独立）。
import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { AitermError } from "./errors.js";
import { resolveWindowsPowerShell7 } from "./windows-powershell.js";
import { isWin, spawnInMacGuiWhenOutsideAqua } from "./tmux-runtime.js";
import type { AgentKind } from "./core.js";

export function isUsableExecutableFile(candidate: string): boolean {
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    if (isWin) return /\.(?:exe|cmd|bat|com)$/i.test(candidate);
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function isWindowsDrivePath(candidate: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(candidate);
}

export function isWindowsNativeExecutable(candidate: string): boolean {
  return isWindowsDrivePath(candidate) && /\.(?:exe|com|cmd|bat)$/i.test(candidate);
}

// Windows の bin 受入: native 実行ファイル（.exe/.cmd/.bat）に加え、pane shell
// （Git Bash）が shebang で実行できる script も実在すれば受け入れる。旧 WSL 側
// バイナリ検査への黙ったフォールバックは廃止（別 HOME・別 auth の subagent を
// 作るため）。native 実行ファイルの強制が要る harness（grok/composer の実効
// sandbox 等）は openAgent 側の専用ゲートが明示エラーで担う。
export function isUsableAgentExecutableFile(candidate: string): boolean {
  if (!isWin) return isUsableExecutableFile(candidate);
  if (isWindowsNativeExecutable(candidate)) return isUsableExecutableFile(candidate);
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function resolveWindowsCodexShim(kind: AgentKind, candidate: string): string {
  if (!isWin || kind !== "codex" || !/\.(?:cmd|bat)$/i.test(candidate)) return candidate;
  const packageRoot = path.join(path.dirname(candidate), "node_modules", "@openai", "codex", "node_modules", "@openai");
  try {
    for (const platformPackage of fs.readdirSync(packageRoot).filter((name) => name.startsWith("codex-win32-"))) {
      const vendorRoot = path.join(packageRoot, platformPackage, "vendor");
      for (const target of fs.readdirSync(vendorRoot)) {
        const executable = path.join(vendorRoot, target, "bin", "codex.exe");
        if (isUsableExecutableFile(executable)) return executable;
      }
    }
  } catch {
    /* 下の明示エラーへ */
  }
  throw new AitermError(
    `CODEX_BIN のnpm shimからWindows native codex.exeを解決できません: ${candidate}。` +
      "@openai/codexを再インストールするか、CODEX_BINへcodex.exeを指定してください",
    2,
  );
}

// pane 内の POSIX shell（Windows は Git Bash 等）へ渡す bin パス。Git Bash は
// バックスラッシュをエスケープとして解釈しうるため、ドライブパスは forward slash 形へ。
export function agentBinForPaneShell(bin: string): string {
  return isWin && isWindowsDrivePath(bin) ? bin.replace(/\\/g, "/") : bin;
}

export function spawnAgentControlCommand(
  bin: string,
  args: string[],
  _cwd: string,
  options: SpawnSyncOptionsWithStringEncoding,
): SpawnSyncReturns<string> {
  // 受入（isUsableAgentExecutableFile）が「使える」と判定した bin は、control command
  //（`claude auth status --json`／`grok models`）でも同じく実行できなければならない。
  if (isWin && !/\.(?:exe|com)$/i.test(bin)) {
    if (/\.(?:cmd|bat)$/i.test(bin)) {
      // Node は CVE-2024-27980 対処以降、.cmd/.bat の直接 spawn を EINVAL で拒否する。
      // 受入が .cmd/.bat を許す以上、control 経路は shell 経由で実行する（args は固定語彙）。
      return spawnSync(bin, args, { ...options, shell: true });
    }
    // 受入は pane shell（Git Bash）が shebang で実行できる script も許す。Windows の
    // CreateProcess は shebang を解さないため、control command も同じ Git Bash で実行する。
    // これを直接 spawn すると常に失敗し、「受入が通した bin で起動が必ず失敗する」矛盾になる。
    return spawnSync(resolveWinPaneShell("bash"), [bin, ...args], options);
  }
  return spawnInMacGuiWhenOutsideAqua(bin, args, options) ?? spawnSync(bin, args, options);
}

export function resolveWinPaneShell(shell: string): string {
  if (!isWin) return shell;
  if (["powershell", "powershell.exe", "pwsh", "pwsh.exe"].includes(path.basename(shell).toLowerCase())) {
    return resolveWindowsPowerShell7();
  }
  if (shell !== "bash") return shell;
  const fromEnv = process.env.AITERM_BASH;
  if (fromEnv) {
    if (isUsableExecutableFile(fromEnv)) return fromEnv;
    throw new AitermError(`AITERM_BASH に指定された bash が存在しません: ${fromEnv}`, 2);
  }
  const candidates = [
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe"),
    path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Git", "bin", "bash.exe"),
  ];
  const gitPath = spawnSync("where.exe", ["git.exe"], { encoding: "utf8", timeout: 5000 })
    .stdout?.split(/\r?\n/)
    .find(Boolean);
  if (gitPath) candidates.push(path.join(path.dirname(path.dirname(gitPath)), "bin", "bash.exe"));
  for (const cand of candidates) {
    if (isUsableExecutableFile(cand)) return cand;
  }
  throw new AitermError(
    "Git Bash が見つかりません。Windows ネイティブの pane shell には Git for Windows の bash.exe が必要です" +
      "（System32 の bash.exe は WSL launcher のため使いません）。Git for Windows を導入するか、" +
      "AITERM_BASH に bash.exe のパスを指定してください。",
    2,
  );
}

export function resolveAgentBin(kind: AgentKind): string | null {
  const home = process.env.HOME ?? os.homedir();
  const [envVar, rel, name] =
    kind === "claude"
      ? ["CLAUDE_BIN", [".local", "bin", "claude"], "claude"]
      : kind === "codex"
      ? ["CODEX_BIN", [".local", "bin", "codex"], "codex"]
      : kind === "cursor"
      ? ["CURSOR_AGENT_BIN", [".local", "bin", "cursor-agent"], "cursor-agent"]
      : ["GROK_BIN", [".grok", "bin", isWin ? "grok.exe" : "grok"], "grok"];
  const fromEnv = process.env[envVar as string];
  if (fromEnv) {
    // 明示指定 env は実在を検証する。存在しないパスを黙って返すと、session を作って
    // `'/typo' ...` を送信し bash が command not found を出すだけで openAgent は「起動した」と
    // 偽成功を返す（既定パス/PATH 経路は検証するのに env だけ無検証だった非対称の解消・A3）。
    if (isUsableAgentExecutableFile(fromEnv)) return resolveWindowsCodexShim(kind, fromEnv);
    throw new AitermError(`${envVar} に指定された ${name} が存在しません: ${fromEnv}`, 2);
  }
  const defaultCandidates = [path.join(home, ...(rel as string[]))];
  if (kind === "cursor" && isWin && process.env.LOCALAPPDATA) {
    // Cursor公式Windows installerは %LOCALAPPDATA%\cursor-agent をPATHへ追加し、
    // cursor-agent.exe/cmdを置く。GUI hostの古いPATHでも公式配置を直接解決する。
    defaultCandidates.unshift(
      path.join(process.env.LOCALAPPDATA, "cursor-agent", "cursor-agent.exe"),
      path.join(process.env.LOCALAPPDATA, "cursor-agent", "cursor-agent.cmd"),
    );
  }
  for (const cand of defaultCandidates) {
    if (isUsableAgentExecutableFile(cand)) return resolveWindowsCodexShim(kind, cand);
  }
  const w = spawnSync(isWin ? "where" : "which", [name as string], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (w.status === 0 && (w.stdout ?? "").trim()) {
    const found = w.stdout.trim().split(/\r?\n/).filter(Boolean);
    const ordered = isWin
      ? [...found.filter((p) => /\.(?:exe|com|cmd|bat)$/i.test(p)), ...found.filter((p) => !/\.(?:exe|com|cmd|bat)$/i.test(p))]
      : found;
    for (const resolved of ordered) {
      if (isUsableAgentExecutableFile(resolved)) return resolveWindowsCodexShim(kind, resolved);
    }
  }
  return null;
}

export function resolveThroughlineBin(): string | null {
  const fromEnv = process.env.THROUGHLINE_BIN;
  if (fromEnv) return isUsableExecutableFile(fromEnv) ? fromEnv : null;
  const resolved = spawnSync(isWin ? "where" : "which", ["throughline"], {
    encoding: "utf8",
  }).stdout?.split(/\r?\n/).find(Boolean) ?? null;
  return resolved && isUsableExecutableFile(resolved) ? resolved : null;
}

export function runThroughlineHandoffContext(
  bin: string,
  sessionId: string,
  supplementFile: string | null = null,
) {
  const args = ["handoff-context", "--session", sessionId, "--json"];
  if (supplementFile !== null) args.push("--supplement-file", supplementFile);
  if (isWin && /\.(?:cmd|bat)$/i.test(bin)) {
    const ps1 = path.join(path.dirname(bin), `${path.basename(bin, path.extname(bin))}.ps1`);
    if (fs.existsSync(ps1)) {
      return spawnSync(resolveWindowsPowerShell7(), [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        ps1,
        ...args,
      ], { encoding: "utf8" });
    }
  }
  return spawnSync(bin, args, {
    encoding: "utf8",
  });
}
