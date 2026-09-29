// state root（`aiterm-mcp-<uid>`）の位置決めの唯一の置き場。node builtin 以外へ依存しない最下層で、
// 単体実行される stop hook 2本と agent-shared がここだけを共有する（campaign 32 の maintenance queue
// に積んだ uid()/runtimeStateBase() の三重実装を解消。stop hook の「内部 module へ依存しない」設計は、
// 本 module が builtin 依存だけであることで保たれる）。
import * as fs from "node:fs";
import * as os from "node:os";

export function currentUid(): number {
  // Windows(native)は process.getuid を持たない。以前はここで throw していたが、
  // agent metadata の存在確認経由で素の pty_send まで巻き込んで全 send を殺していた。
  // Windows の fs.Stats.uid は常に 0 なので、ここも 0 を返せば owner 比較
  // (st.uid !== currentUid()) は自然に通過する。Windows は POSIX owner 検証を
  // 持たない（NTFS ACL は別体系）という既知の制約の明示的受容であり、POSIX 側は
  // getuid をそのまま返すため挙動不変。
  if (typeof process.getuid !== "function") return 0;
  return process.getuid();
}

export function runtimeStateBase(): string {
  // 子のagentとそのhookは、起動したAitermと同じ置き場を使う。起動元（例: Codexが起動したMCP）と子のpaneとで
  // XDG_RUNTIME_DIR の有無が違うと置き場が割れ、子の完了記録が親に見えなくなる（rabbitで再現）。
  // 起動時に AITERM_STATE_BASE を子の環境へ渡し、それがあれば最優先で使う。
  const inherited = process.env.AITERM_STATE_BASE;
  if (inherited) {
    try {
      if (fs.statSync(inherited).isDirectory()) return inherited;
    } catch {
      /* 渡された置き場が無ければ通常の決め方へ戻す */
    }
  }
  // Windows Node の os.tmpdir() は TMPDIR を参照せず TEMP を返す。一方、psmux namespace は
  // tmux-runtime.ts で TMPDIR を最優先する。test／隔離processがTMPDIRだけを変えた時に
  // PTYは隔離されてもmanaged metadataが本番TEMPへ残ると、隔離側killAllが本番相関だけを
  // 消してしまう。Windowsだけ同じTMPDIR境界へ揃える。通常serverはTMPDIR未設定なので
  // 従来どおりos.tmpdir()（%TEMP%）を使う。
  if (process.platform === "win32" && process.env.TMPDIR) return process.env.TMPDIR;
  const xdg = process.env.XDG_RUNTIME_DIR;
  if (xdg) {
    try {
      if (fs.statSync(xdg).isDirectory()) return xdg;
    } catch {
      /* XDG_RUNTIME_DIR が壊れている CI/非 login 環境では os.tmpdir() に戻す */
    }
  }
  return os.tmpdir();
}
