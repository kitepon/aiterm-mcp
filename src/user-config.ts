// 利用者の設定file（harnessが既定を保存するfile）を、席の切り替えの前後で元の値へ戻すための部品（ADR 0114）。
// harnessの切り替えの命令は、席だけでなく利用者の既定も書き換える（Claude Codeの /fast、Codexの /fast、Grokの --model と /model）。
// 席の切り替えを席だけに留めるため、「読む → 切り替える → 戻す」を、processをまたぐ鍵で1つずつにする。
import * as fs from "node:fs";
import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AitermError } from "./errors.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// 鍵を握ったままprocessが落ちた時に、後の人が引き取るまでの時間。1回の切り替え（画面の待ちと公式の口の呼び出し）より十分長く取る。
const LOCK_STALE_MS = 120_000;
const LOCK_WAIT_MS = 150_000;
const LOCK_POLL_MS = 120;

/**
 * 設定fileを触る切り替えを、同じ端末の全てのAitermの間で1つずつにする。鍵は設定fileの隣に作る
 * （Aitermの置き場はprocessごとに変えられるが、設定fileの場所は全員が同じに見る）。
 * 設定fileの置き場が無い・書けない時は、harnessも書けないので鍵なしで通す。
 */
export async function withUserConfigLock<T>(configPath: string, action: () => Promise<T>): Promise<T> {
  const lock = `${configPath}.aiterm-lock`;
  if (!fs.existsSync(path.dirname(configPath))) return action();
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") return action();
    }
    let age = 0;
    try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch { continue; }
    if (age > LOCK_STALE_MS) {
      try { fs.rmSync(lock, { recursive: true, force: true }); } catch { /* 先に誰かが片付けた */ }
      continue;
    }
    if (Date.now() > deadline) {
      throw new AitermError(`USER_CONFIG_LOCK_TIMEOUT: ${configPath} を触る切り替えが、ほかの席で続いています。何も変えていません。`, 2);
    }
    await sleep(LOCK_POLL_MS + Math.floor(Math.random() * LOCK_POLL_MS));
  }
  try {
    try { fs.writeFileSync(path.join(lock, "owner"), `${process.pid}\n`); } catch { /* 持ち主の控えは調べる時のため。無くても動く */ }
    return await action();
  } finally {
    try { fs.rmSync(lock, { recursive: true, force: true }); } catch { /* 残っても、古くなれば次の人が引き取る */ }
  }
}

/** fileの今の中身。無い・読めない時はnull。 */
export function readFileOrNull(file: string): Buffer | null {
  try { return fs.readFileSync(file); } catch { return null; }
}

function writeInPlace(file: string, body: Buffer | string): void {
  let mode = 0o600;
  try { mode = fs.statSync(file).mode & 0o777; } catch { /* 無ければ0600で作る */ }
  const temp = `${file}.aiterm-restore-${process.pid}`;
  fs.writeFileSync(temp, body, { mode });
  fs.renameSync(temp, file);
}

/**
 * JSONの設定fileの、最上位の1項目を、切り替えの前の値へ戻す。
 * - 項目が前と同じで、ほかの項目の値も同じ（harnessが書き直して並びが変わっただけ）なら、前の中身をそのまま書き戻す。
 * - ほかの項目が変わっていたら（ほかの人の書き込み）、その項目だけを直して、ほかは今のまま残す。
 * - 今のfileが無い・JSONとして読めない時、前の中身が読めない時は触らない。
 * 戻り値は、書き戻したかどうか。
 */
export function restoreJsonSetting(file: string, before: Buffer | null, key: string): boolean {
  const now = readFileOrNull(file);
  if (now === null) return false;
  if (before !== null && now.equals(before)) return false;
  let current: Record<string, unknown>;
  let previous: Record<string, unknown> | null = null;
  try {
    current = JSON.parse(now.toString("utf8"));
    if (before !== null) previous = JSON.parse(before.toString("utf8"));
  } catch {
    return false;
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) return false;
  if (previous !== null && (typeof previous !== "object" || Array.isArray(previous))) return false;
  const had = previous !== null && Object.hasOwn(previous, key);
  const edited: Record<string, unknown> = { ...current };
  if (had) edited[key] = (previous as Record<string, unknown>)[key];
  else delete edited[key];
  if (before !== null && isDeepStrictEqual(edited, previous)) {
    writeInPlace(file, before);
    return true;
  }
  if (isDeepStrictEqual(edited, current)) return false;
  writeInPlace(file, `${JSON.stringify(edited, null, 2)}\n`);
  return true;
}
