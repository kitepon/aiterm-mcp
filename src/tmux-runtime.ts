// 端末多重化 runtime の所有者。tmux（POSIX）/ psmux（Windows native）をどう見つけ、
// どの socket / namespace で、どの locale で叩くかはこのモジュールだけが知る。
// OS 分岐（isWin）と観測・起動規約の正本。
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AitermError, ptyDependencyError } from "./errors.js";

// Windows ネイティブには tmux が無いため、tmux CLI 互換の native psmux を叩く
// （POSIX = Linux/WSL2/macOS は従来どおり tmux を直接叩く。WSL 橋は e3f5fc8 で全廃）。
export const isWin = process.platform === "win32";

// .log/.offset/.lastcmd を置くディレクトリ（Node が直接読み書きする）。
// POSIX は従来どおり。Windows は TMPDIR→TEMP→os.tmpdir() の順で Windows 側の一時領域に置く。
export const SOCKDIR = path.join(
  process.env.TMPDIR ?? (isWin ? process.env.TEMP ?? os.tmpdir() : "/tmp"),
  "claude-tmux-sockets",
);
// tmux -S に渡すソケットパス（POSIX はログと同じツリーに置く）。
// Windows は native psmux を使い、-S でなく -L server namespace で隔離する
// （psmux の -S は黙って既定 namespace へ落ちるため使わない・実測 2026-08-16）。
// SOCKDIR から短い安定名を導出し、TMPDIR ごとの隔離（テスト）と再起動跨ぎ再接続を両立する。
export const SOCK = path.join(SOCKDIR, "claude.sock");
export const WIN_NS = `aiterm-${createHash("sha1").update(SOCKDIR).digest("hex").slice(0, 12)}`;

// Windows で最初の呼び出し前に一度だけ native psmux の可用性を確かめ、失敗は原因別に投げる。
// psmux は tmux CLI 互換の Windows ネイティブ実装（ConPTY・WSL 不要）。AITERM_PSMUX で
// バイナリを明示上書きできる（POSIX の AITERM_TMUX に対応）。
function psmuxBin(): string {
  if (process.env.AITERM_PSMUX) return process.env.AITERM_PSMUX;
  const wingetLink = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "psmux.exe");
  return wingetLink && fs.existsSync(wingetLink) ? wingetLink : "psmux";
}
export function psmuxVersionSupported(output: string): boolean {
  const match = /^psmux (\d+)\.(\d+)\.(\d+)(?:\s|$)/mu.exec(output);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return major > 3 || (major === 3 && (minor > 3 || (minor === 3 && patch >= 8)));
}
let winPsmuxOk = false;
export function ensureWinPsmux(observe = true): void {
  if (winPsmuxOk) return;
  const r = spawnSync(psmuxBin(), ["-V"], { encoding: "utf8", timeout: 10000 });
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT")
      ptyDependencyError(
        "psmux が見つかりません。Windows ネイティブでは psmux が必要です（導入例: winget install marlocarlo.psmux）。既存の psmux を使う場合は AITERM_PSMUX でパスを指定してください。",
        observe,
      );
    ptyDependencyError(`psmux を起動できませんでした（${code ?? "unknown"}）。`, observe);
  }
  if (r.status !== 0)
    ptyDependencyError("psmux -V が失敗しました。`psmux -V` が通るか確認してください。", observe);
  if (!psmuxVersionSupported(r.stdout ?? ""))
    ptyDependencyError("psmux 3.3.8以上が必要です。winget upgrade --id marlocarlo.psmux --source winget で更新してください。", observe);
  winPsmuxOk = true;
}

// tmux が見つからないときの説明。macOS は tmux を同梱せず、Homebrew の bin は GUI 起動時の PATH に
// 入らないため、原因と対処（導入・自動探索・AITERM_TMUX 上書き）を正直に提示する。
function tmuxMissingMessage(): string {
  const head = "tmux が見つかりません（PATH 上に存在しません）。aiterm は実行時に tmux を必要とします。";
  const hint =
    process.platform === "darwin"
      ? "macOS では `brew install tmux` で導入してください。GUI から起動された場合、Homebrew の bin " +
        "（Apple Silicon: /opt/homebrew/bin、Intel: /usr/local/bin）が PATH に含まれないことがあります" +
        "（その場合 aiterm が自動で探索します）。"
      : "（例: Debian/Ubuntu は `sudo apt install tmux`）。";
  const override = "別の場所にある tmux を使うには AITERM_TMUX=/path/to/tmux を指定してください。";
  return `${head}${hint}${override}`;
}

// POSIX(Linux/WSL2/macOS) 用の tmux バイナリ解決。Windows の ensureWinBridge() に対応する事前確認。
// 解決順: AITERM_TMUX（明示指定）→ PATH 上の tmux → Homebrew 既定パス。一度だけ実行しキャッシュする。
// 見つからなければ tmuxMissingMessage で投げる（黙ってフォールバックせず、原因が見えるようにする）。
let tmuxBin: string | null = null;
export function resolveTmux(observe = true): string {
  if (tmuxBin) return tmuxBin;
  const override = process.env.AITERM_TMUX;
  if (override) {
    const r = spawnSync(override, ["-V"], { encoding: "utf8", timeout: 5000 });
    if (!r.error && r.status === 0) return (tmuxBin = override);
    ptyDependencyError(
      `AITERM_TMUX に指定された tmux を起動できません: ${override}（\`${override} -V\` が通りません）`,
      observe,
    );
  }
  // CLI/開発時は PATH 上の tmux をそのまま使う（最優先）。
  const onPath = spawnSync("tmux", ["-V"], { encoding: "utf8", timeout: 5000 });
  if (!onPath.error && onPath.status === 0) return (tmuxBin = "tmux");
  // GUI 起動などで PATH に Homebrew の bin が無い場合、既定の場所を探す。
  // 使う場合は黙らず stderr へ告知する（stdout は JSON-RPC 専用＝index.ts の制約）。
  for (const cand of ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux"]) {
    try {
      fs.accessSync(cand, fs.constants.X_OK);
      console.error(`aiterm: tmux が PATH 上に無いため ${cand} を使用します`);
      return (tmuxBin = cand);
    } catch {
      /* 次の候補へ */
    }
  }
  ptyDependencyError(tmuxMissingMessage(), observe);
}

// tmux は locale が C/POSIX/未設定だと UTF-8 を扱えない: server は send-keys/paste のマルチバイト
// 入力を破壊し（文字消失・周辺バイトの並べ替えを実測）、client は format 出力のタブ等を "_" へ
// サニタイズする。GUI 起動の MCP client は LANG を持たないことが多く、その環境で立った tmux server は
// 以後すべての入力を壊すため、UTF-8 locale が確定しない場合だけ LC_CTYPE を明示注入する。
// 利用者が C/POSIX 以外を明示設定している場合はその選択を尊重して触らない。
export function tmuxSpawnEnv(): NodeJS.ProcessEnv | undefined {
  const effective = process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || "";
  // 素の "C"/"POSIX" だけを壊れた既定とみなす。"C.UTF-8" を含む charset 付きの明示設定は尊重する。
  if (effective && !/^(C|POSIX)$/i.test(effective)) return undefined;
  const env: NodeJS.ProcessEnv = { ...process.env, LC_CTYPE: process.platform === "darwin" ? "UTF-8" : "C.UTF-8" };
  // LC_ALL は LC_CTYPE より優先されるため、C/POSIX の LC_ALL が残ると注入が無効になる
  delete env.LC_ALL;
  return env;
}

export function tmuxCommandWithInput(
  observe: boolean,
  input: string | undefined,
  ...args: string[]
): { code: number; stdout: string; stderr: string } {
  // maxBuffer は既定 1MiB。capture-pane（大きなスクロールバック）や多セッションの list-sessions で
  // 頭打ちになり stdout が切れる/空になる。Python の subprocess.run は無制限だったので 64MiB へ広げる。
  // Windows は tmux CLI 互換の native psmux を -L namespace 隔離で叩く（WSL 非依存）。
  let r;
  const spawnOpts = { encoding: "utf8" as const, maxBuffer: 64 * 1024 * 1024, input, env: tmuxSpawnEnv() };
  if (isWin) {
    ensureWinPsmux(observe);
    r = spawnSync(psmuxBin(), ["-L", WIN_NS, ...args], spawnOpts);
  } else {
    // resolveTmux() は tmux を解決できなければ明確な AitermError を投げる（POSIX 版の事前確認）。
    r = spawnSync(resolveTmux(observe), ["-S", SOCK, ...args], spawnOpts);
  }
  // ENOBUFS（出力が 64MiB 超）を「code=1 の失敗」へ握り潰すと部分/空 stdout を正常扱いしてしまう。区別して投げる。
  // EXPECTED-FAILURE: 外部システム境界（tmux 出力過大）
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOBUFS") {
    throw new AitermError(`tmux 出力が 64MiB を超えました（${args[0]}）。範囲を絞って読んでください。`, 2);
  }
  // 解決済み tmux が実行時に消えた（アンインストール等）場合の ENOENT を、空 stderr の code=1 へ握り潰さない。
  // 通常は resolveTmux() が事前に弾くため発火しないが、mid-run 消滅に対する正直な防御。
  if (!isWin && r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
    tmuxBin = null; // 次回 resolveTmux で再解決を許す
    ptyDependencyError(tmuxMissingMessage(), observe);
  }
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function tmuxCommand(observe: boolean, ...args: string[]): { code: number; stdout: string; stderr: string } {
  return tmuxCommandWithInput(observe, undefined, ...args);
}

export function sendPsmuxPayload(
  observe: boolean,
  sessionName: string,
  text: string,
  bracketedPaste: boolean,
): { code: number; stdout: string; stderr: string } {
  if (!isWin) return { code: 1, stdout: "", stderr: "psmux direct send is Windows-only" };
  ensureWinPsmux(observe);
  const worker = fileURLToPath(new URL("./psmux-send-worker.js", import.meta.url));
  const body = bracketedPaste ? `\x1b[200~${text}\x1b[201~` : text;
  const result = spawnSync(process.execPath, [worker, `${WIN_NS}__${sessionName}`], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    input: Buffer.from(body, "utf8"),
    env: tmuxSpawnEnv(),
    timeout: 120_000,
  });
  if (result.error) {
    return {
      code: 1,
      stdout: result.stdout ?? "",
      stderr: `${(result.error as NodeJS.ErrnoException).code ?? "worker error"}: ${result.error.message}`,
    };
  }
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// psmux の load-buffer は stdin (`-`) 非対応で path 位置引数だけを取る。
// Windows は owner-only の SOCKDIR 内へ一時ファイル経由で渡し、POSIX は stdin で渡す。
export function loadPtyBufferChunk(
  observe: boolean,
  bufferName: string,
  chunk: string,
): { code: number; stdout: string; stderr: string } {
  if (!isWin) return tmuxCommandWithInput(observe, chunk, "load-buffer", "-b", bufferName, "-");
  const chunkFile = path.join(SOCKDIR, `${bufferName}.chunk`);
  try {
    fs.writeFileSync(chunkFile, chunk, { encoding: "utf8" });
    return tmuxCommand(observe, "load-buffer", "-b", bufferName, chunkFile);
  } finally {
    try { fs.unlinkSync(chunkFile); } catch { /* noop */ }
  }
}

// -r: LF→CR 置換を無効化。psmux は -r 非対応（受理フラグは d/p/b/t のみ）のため Windows では付けない。
export function pasteBufferBaseArgs(): string[] {
  return isWin ? ["paste-buffer", "-d"] : ["paste-buffer", "-d", "-r"];
}

// new-session -f 用の空 config（端末個人の設定ファイルを読まない）。Windows は NUL デバイス。
export const TMUX_EMPTY_CONFIG = isWin ? "NUL" : "/dev/null";

export function sessionEnvironmentLaunch(shell: string, environment: string[], version?: string): {
  shell: string; args: string[]; register_after_start: boolean;
} {
  let modern = isWin;
  if (!isWin) {
    const observed = version ?? spawnSync(resolveTmux(), ["-V"], { encoding: "utf8", timeout: 5000 }).stdout;
    const match = /^tmux (\d+)\.(\d+)/.exec(observed ?? "");
    if (!match) throw new AitermError("tmuxの環境変数機能を判定できません", 2);
    modern = Number(match[1]) > 3 || (Number(match[1]) === 3 && Number(match[2]) >= 2);
  }
  if (modern) return { shell, args: environment.flatMap(entry => ["-e", entry]), register_after_start: false };
  // tmux <3.2はnew-session -eを持たない。子への継承とsession台帳への登録を製品内で完結する。
  const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;
  return { shell: `exec /usr/bin/env ${environment.map(quote).join(" ")} ${quote(shell)}`, args: [], register_after_start: true };
}

// 人が同じ session を覗く/介入するための attach コマンド。
// Windows は native psmux（tmux CLI 互換）を -L namespace で叩く。
export function attachCommand(name: string): string {
  return isWin ? `psmux -L ${WIN_NS} attach -t ${name}` : `tmux -S ${SOCK} attach -t ${name}`;
}

// Windows（psmux）の #{pane_current_command} は "bash.exe" やフルパス形で報告しうる。
// SHELLS 等の POSIX 名集合と突合できるよう、basename・.exe 除去・小文字化へ正規化する
// （Windows の実行ファイル名は case-insensitive）。POSIX は従来どおり無加工。
export function normalizePaneCommand(cmd: string): string {
  if (!isWin) return cmd;
  return path.basename(cmd).replace(/\.exe$/i, "").toLowerCase();
}

// 完了マーカーの方言は実効shellで決める。SSH先のshellはhost OSやsshのprocess名と異なる。
const POWERSHELL_COMMANDS = new Set(["powershell", "pwsh"]);
export function markShellCommand(foreground: string, screen: string): string {
  if (POWERSHELL_COMMANDS.has(foreground)) return foreground;
  if (!isWin && foreground !== "ssh") return foreground;
  // psmux起動直後の古いprocess名も、SSH先も、現在の末尾promptだけを実効shellの証拠にする。
  const current = screen.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").trimEnd();
  return /(?:^|\n)PS [^\r\n]*>$/.test(current) ? "pwsh" : foreground;
}

export function appendMarkSentinel(text: string, foreground: string): string {
  // 複数行入力の末尾はheredoc／here-string終端になり得るため、独立した次行へ置く。
  const separator = text.includes("\n") ? "\n" : "; ";
  if (POWERSHELL_COMMANDS.has(foreground)) {
    // command echoに完成済みrc=<数字>を含めない。{0}を実行時formatして早期誤完了を防ぐ。
    return text + separator +
      "if ($?) { [Console]::WriteLine([Environment]::NewLine + ('<<<AITERM_DONE rc={0}>>>' -f 0)) }" +
      " else { [Console]::WriteLine([Environment]::NewLine + ('<<<AITERM_DONE rc={0}>>>' -f 1)) }";
  }
  return text + separator + `printf '\\n<<<AITERM_DONE rc=%d>>>\\n' "$?"`;
}

// Windows の fs.Stats.mode は POSIX permission bit を持たず、常に 666/777 相当を報告する
// （NTFS ACL は別体系）。既知制約の明示的受容として、Windows では group/other bit 検証を
// 常に「問題なし」とする。isFile・nlink・owner・size 等の共通検証は呼び手が維持する。
export function modeBitsWorldAccessible(mode: number): boolean {
  return !isWin && (mode & 0o077) !== 0;
}

// pane 内で使う cwd 引数。Windows の起動コマンドは native psmux pane の Git Bash で走るため、
// Windows パスを forward slash 形へ変換して渡す（POSIX は無加工）。
export function paneCwdArgument(cwd: string): string {
  return isWin ? cwd.replace(/\\/g, "/") : cwd;
}

// Windows 専用: pipe-pane のログは psmux server 側の in-process sink が書く＝完了検知と
// 書き手が別 process のため、完了/セッション消滅の報告後も末尾数百バイトが遅れて現れうる。
// 完了と判定する直前にログサイズが伸びなくなるまで待ち、末尾欠けの出力を返さないようにする
// （POSIX の tmux は /bin/sh sink・同一 fs で実測上不要のため即返る）。
export async function settlePaneLog(logPath: string, pollSeconds: number): Promise<void> {
  if (!isWin) return;
  let prev = -1;
  for (let i = 0; i < 8; i++) {
    let sz = 0;
    try {
      sz = fs.statSync(logPath).size;
    } catch {
      sz = 0;
    }
    if (sz === prev) return;
    prev = sz;
    await new Promise<void>((res) => setTimeout(res, pollSeconds * 1000));
  }
}
