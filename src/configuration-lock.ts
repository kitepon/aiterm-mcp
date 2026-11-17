// 席のmodel／effortの固定。持ち主（launcher）だけが知る鍵のSHA-256を席ごとに保存し、鍵を示さない呼びを断る。
// 保護するもの: 指揮官氏が決めた席の設定を、席の中のAIがAitermのtoolで書き替えること。鍵はlauncherの手元にだけあり、AIには渡らない。
// 抜け道（self-exit）: launcherの`unlock`、または席を閉じる事（pty_closeの片付けがこのfileを消す）。人が端末へ打つ文字はAitermを通らない。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { agentsDir, writeJson0600 } from "./agent-shared.js";
import { tryLoadAgentMetadata } from "./agent-metadata-reader.js";
import { AitermError } from "./errors.js";

export const CONFIGURATION_LOCKED = "AGENT_CONFIGURATION_LOCKED";
const KEY_RE = /^[\x21-\x7e]{16,128}$/;
const hash = (key: string) => crypto.createHash("sha256").update(key).digest();

/** 席の今の起動世代に結び付く。再起動・閉じた席の固定は引き継がない。 */
function lockPath(name: string): string | null {
  const meta = tryLoadAgentMetadata(name);
  return meta ? path.join(agentsDir(), `${name}.${meta.launch_id}.configuration-lock.json`) : null;
}

function readLock(file: string): Buffer | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return v?.schema === "aiterm.configuration-lock.v1" && typeof v.key_sha256 === "string" ? Buffer.from(v.key_sha256, "hex") : null;
  } catch (e) {
    // 書込みはtemp→renameの原子置換なので、読めない記録は「固定していない」と読む。
    if ((e as NodeJS.ErrnoException).code === "ENOENT" || e instanceof SyntaxError) return null;
    throw e;
  }
}

const refusal = (reason: string) => {
  const error = new AitermError(`${CONFIGURATION_LOCKED}: ${reason} 設定は変えていません。`, 2);
  error.configureRefusal = { code: CONFIGURATION_LOCKED, relaunch: false, selection_excluded: false };
  return error;
};

/** 固定中なら、鍵が合う時だけ通す。固定していない席・agentでない席は常に通す。 */
export function assertConfigurationKey(name: string, key: string | undefined): void {
  const file = lockPath(name), stored = file ? readLock(file) : null;
  if (!stored) return;
  const given = key === undefined ? null : hash(key);
  if (!given || !crypto.timingSafeEqual(stored, given)) throw refusal("この席のmodel／effortは固定されています。持ち主の鍵なしには変えられません。");
}

/** launcherの固定・解除。固定中の鍵違いは断る。同じ鍵の固定と、固定していない席の解除は何もしない。 */
export function applyConfigurationLock(name: string, action: "lock" | "unlock", key: string | undefined): "locked" | "unlocked" {
  if (key === undefined || !KEY_RE.test(key)) throw new AitermError("CONFIGURATION_LOCK_KEY_INVALID: configuration_lock_keyは記号を含む印字可能なASCII 16〜128文字で指定してください。", 2);
  const file = lockPath(name);
  if (!file) throw new AitermError(`session '${name}' は agent session ではありません。`, 2);
  assertConfigurationKey(name, key);
  if (action === "unlock") { fs.rmSync(file, { force: true }); return "unlocked"; }
  writeJson0600(file, { schema: "aiterm.configuration-lock.v1", key_sha256: hash(key).toString("hex") });
  return "locked";
}

// 席のCLIの入力欄の先頭に置くとmodel／effortを替える命令。fastは対象外。
const MODEL_COMMAND = /^\s*\/(?:model|models|effort|reasoning)(?![\w-])/i;
// Claude Codeでmodelの選ぶ画面を開くキー（Alt+P）。
const MODEL_PICKER_KEY = /^(?:m|a|alt|meta)p$/;

/** pty_send／pty_keyの入口で、固定中の席へmodel／effortを替える入力を断る。launcherはagent_configureを使う。 */
export function assertNoModelInput(name: string, input: { text?: string; key?: string }): void {
  const model = (input.text !== undefined && MODEL_COMMAND.test(input.text))
    || (input.key !== undefined && MODEL_PICKER_KEY.test(input.key.toLowerCase().replace(/[-+\s]/g, "")));
  if (!model) return;
  const file = lockPath(name);
  if (file && readLock(file)) throw refusal("この席のmodel／effortは固定されています。席への入力では変えられません。");
}
