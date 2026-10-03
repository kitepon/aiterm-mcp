// tmux バイナリ解決の負経路（Windows の ensureWinBridge に対応する POSIX 側の対称性）。
// tmux を解決できないとき、空 stderr の握り潰し（旧: "tmux new-session 失敗: "）でなく、
// 原因と対処を含む明確な AitermError(code2) を投げることを固定する。
// AITERM_TMUX=<存在しないパス> で tmux の有無に関係なく失敗経路を強制するため、CI/全OSで決定的に走る。
// core.ts は tmuxBin をモジュール内にキャッシュするので、環境を変えて確かめるには子プロセスで隔離する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_URL = pathToFileURL(path.join(HERE, "..", "dist", "core.js")).href;

// 子プロセスで core.openSession を呼び、投げられた AitermError を {message,code} で回収する。
function openInChild(env) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aiterm-resolve-"));
  const script =
    `import(${JSON.stringify(CORE_URL)}).then(async (core) => {\n` +
    `  try { core.openSession("rtest", "bash"); console.log(JSON.stringify({ ok: true })); }\n` +
    `  catch (e) { console.log(JSON.stringify({ message: e.message, code: e.code })); }\n` +
    `}).catch((e) => console.log(JSON.stringify({ importErr: String(e) })));\n`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    // わざと起こす失敗を、利用者の実行時エラー記録（工場が集める対象）へ書かない。
    // 記録先はHOMEとXDGから決まるので、収集設定の無い場所を指す（実被弾: CIを走らせる端末の記録が試験のたびに1件増えていた）。
    env: {
      ...process.env, TMPDIR: tmp, HOME: tmp,
      XDG_CONFIG_HOME: path.join(tmp, ".config"), XDG_STATE_HOME: path.join(tmp, ".local", "state"), ...env,
    },
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  const line = (r.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? "";
  try { return JSON.parse(line); } catch { return { raw: r.stdout, stderr: r.stderr }; }
}

// resolveTmux は POSIX(Linux/WSL2/macOS)専用。Windows ネイティブは AITERM_PSMUX の native psmux を
// 解決し AITERM_TMUX を経由しないため、この負経路は skip する。
const skip = process.platform === "win32" ? "POSIX 専用（Windows は AITERM_PSMUX の native psmux を解決する）" : undefined;

test("resolveTmux: AITERM_TMUX が解決不能なら明確な code2 エラー（空 stderr 握り潰しでない）", { skip }, () => {
  const res = openInChild({ AITERM_TMUX: "/nonexistent/definitely/no/tmux" });
  assert.equal(res.code, 2, `code2 を期待: ${JSON.stringify(res)}`);
  assert.match(res.message ?? "", /AITERM_TMUX/, `メッセージに AITERM_TMUX を含む: ${JSON.stringify(res)}`);
  assert.ok((res.message ?? "").trim().length > 10, `空でない明確なメッセージ: ${JSON.stringify(res)}`);
});
