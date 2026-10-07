#!/usr/bin/env node
// aiterm-parent-delivery — ほかの製品が、確定した回答をAitermの親配送へ頼む入口（ADR 0098）。
// Aitermが登録したhookと公式キューで渡す。頼む製品は自分のhookを登録せず、Aitermの中のfileも書かない。
// 結果はstdoutへ1行のJSONで返す。成功は {ok:true, schema, …}、失敗は {ok:false, schema, code, message, outcome_unknown} と exit 1。
// outcome_unknown:true は「受け付けたかどうか確定できない」。その時は送り直さない。
//
//   aiterm-parent-delivery provider
//   aiterm-parent-delivery codex verify --thread <uuid> [--codex-home <dir>]
//   aiterm-parent-delivery codex submit --thread <uuid> --delivery <uuid> --text-file <file|-> [--codex-home <dir>]
//   aiterm-parent-delivery codex state  --thread <uuid> --delivery <uuid> [--codex-home <dir>]
//
// 「設定が整っている」「受け付けた」「実際に届いた」は別の事として返す。
//   verify の steer:"enabled" は設定の話（hookが登録・承認済みで、親がhookの導入後に起きている）。届いた事は言わない。
//   submit の queued_submission_id は、公式キューが受け付けた事。
//   state は届き方の事実を返す。hook:"emitted" と turn_id は、Aitermのhookがその番へ本文を入れた事。queued は、今も公式キューに残っているか。
//
// 対象はCodexの親だけ。親の指定は、CodexがMCP要求へ付けるthreadIdと、そのCodexのCODEX_HOME。
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { realCodexHome } from "aiterm-steer-delivery";
import { checkCodexParent, submitCodexParentAnswer, withCodexReceiver, type CodexParent } from "./codex-parent-receiver.js";
import { codexHookDeliveryState, codexHookDirectory, codexInputDirectory } from "./codex-hook-state.js";

export const PARENT_DELIVERY_SCHEMA = "aiterm.parent-delivery.v1";
const pkg = createRequire(import.meta.url)("../package.json") as { version: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USAGE = "usage: aiterm-parent-delivery provider | codex <verify|submit|state> --thread <uuid> [--delivery <uuid>] [--text-file <file|->] [--codex-home <dir>]";

class UsageError extends Error {}
/** 同じ配送idの本文が、もう配送の記録にある。送り直しで同じ回答が2回届く事を止める。 */
class DuplicateError extends Error {}

/** この配送idの所有記録（送る途中・hookが取り出した後）が、Aitermのhookの置き場に残っているか。hookを入れていない環境には記録が無い。 */
function deliveryRecorded(target: CodexParent, delivery: string): boolean {
  const root = codexHookDirectory();
  if (!fs.existsSync(path.join(root, "inputs")) || !fs.existsSync(target.codex_home)) return false;
  const directory = codexInputDirectory(root, target.codex_home, target.thread_id);
  return ["pending", "claims"].some(kind => fs.existsSync(path.join(directory, kind, `${delivery}.json`)));
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined) throw new UsageError(`${name} に値がありません。${USAGE}`);
  return value;
}

function uuid(args: string[], name: string): string {
  const value = option(args, name);
  if (value === undefined) throw new UsageError(`${name} は必須です。${USAGE}`);
  if (!UUID_RE.test(value)) throw new UsageError(`${name} はUUIDで指定してください。${USAGE}`);
  return value;
}

function parent(args: string[]): CodexParent {
  const home = option(args, "--codex-home");
  if (home !== undefined && !path.isAbsolute(home)) throw new UsageError(`--codex-home は絶対pathで指定してください。${USAGE}`);
  return { thread_id: uuid(args, "--thread"), codex_home: path.resolve(home ?? realCodexHome()) };
}

async function readText(source: string): Promise<string> {
  if (source !== "-") return fs.readFileSync(source, "utf8");
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

export interface ParentDeliveryState {
  /** 送る途中の状態（今までの形）。sending＝hookが取り出している最中、unknown＝取り出しの結果が分からない、null＝どちらでもない。 */
  state: "sending" | "unknown" | null;
  /**
   * Aitermのhookの置き場にある、この配送の記録。pending＝受け付けて、まだどの番にも入れていない。emitted＝hookがturn_idの番へ本文を入れた。
   * not_in_queue＝hookが取り出そうとした時、公式キューにもう無かった（キューが先に会話へ渡した）。null＝記録なし（hookを入れていない環境、または片付け済み）。
   */
  hook: "pending" | "sending" | "emitted" | "not_in_queue" | "unknown" | null;
  /** hookが本文を入れた番。hookがemittedの時だけ。 */
  turn_id: string | null;
  /** 今も公式キューに残っているか。確かめられなかった時はnull（queue_errorに理由）。 */
  queued: boolean | null;
  queue_error?: string;
}

/** 届き方の事実を読む。何も書き換えない。 */
async function deliveryState(target: CodexParent, delivery: string): Promise<ParentDeliveryState> {
  const state = codexHookDeliveryState(target.codex_home, target.thread_id, delivery);
  let hook: ParentDeliveryState["hook"] = null;
  let turn: string | null = null;
  const root = codexHookDirectory();
  if (fs.existsSync(path.join(root, "inputs")) && fs.existsSync(target.codex_home)) {
    const directory = codexInputDirectory(root, target.codex_home, target.thread_id);
    let claim: any = null;
    try { claim = JSON.parse(fs.readFileSync(path.join(directory, "claims", `${delivery}.json`), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (claim?.state === "emitted") { hook = "emitted"; turn = typeof claim.turn_id === "string" ? claim.turn_id : null; }
    else if (claim?.state === "not_in_queue") hook = "not_in_queue";
    else if (state) hook = state;
    // 所有権のlinkだけを作った段階（まだ公式キューから取り出していない）は、受け付けた後と同じ。
    else if (claim !== null || fs.existsSync(path.join(directory, "pending", `${delivery}.json`))) hook = "pending";
  }
  try {
    const queued = await withCodexReceiver(target, async request => {
      let cursor: string | null = null;
      do {
        const page = await request("thread/queue/list", { threadId: target.thread_id, cursor, limit: 100 });
        if (!Array.isArray(page?.data)) throw new Error("queue list invalid");
        if (page.data.some((entry: any) => entry?.clientUserMessageId === delivery)) return true;
        cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
      } while (cursor);
      return false;
    });
    return { state, hook, turn_id: turn, queued };
  } catch (error) {
    const code = (error as { delivery_code?: unknown })?.delivery_code;
    return { state, hook, turn_id: turn, queued: null, queue_error: typeof code === "string" ? code : "CODEX_QUEUE_UNREADABLE" };
  }
}

/** この命令の場所と版。製品側の入口（aiterm-steer-delivery）が、呼べる相手かどうかを確かめるのに使う。 */
export function providerDescription(): { version: string; node: string; cli: string } {
  return { version: pkg.version, node: process.execPath, cli: fileURLToPath(import.meta.url) };
}

export async function runParentDelivery(argv: string[]): Promise<object> {
  const [kind, command, ...args] = argv;
  if (kind === "provider" && command === undefined) return providerDescription();
  if (kind !== "codex") throw new UsageError(`対応する親は codex だけです。${USAGE}`);
  switch (command) {
    case "verify": {
      const checked = await checkCodexParent(parent(args));
      return { verified: true, thread: checked.thread, steer: checked.steer };
    }
    case "submit": {
      const target = parent(args);
      const delivery = uuid(args, "--delivery");
      const source = option(args, "--text-file");
      if (source === undefined) throw new UsageError(`--text-file は必須です。${USAGE}`);
      const text = await readText(source);
      if (text.length === 0) throw new UsageError("本文が空です。文字列は送っていません。");
      // 配送idは本文ごとに新しいUUID。同じidをもう一度受けると、同じ回答が2回届く。
      if (deliveryRecorded(target, delivery)) throw new DuplicateError("同じ配送idの本文は、もう受け付けています。文字列は送っていません。");
      return await submitCodexParentAnswer(target, delivery, text);
    }
    case "state": {
      const target = parent(args);
      return await deliveryState(target, uuid(args, "--delivery"));
    }
    default: throw new UsageError(`未対応のcommandです: ${String(command)}。${USAGE}`);
  }
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const a = fs.realpathSync(entry);
    const b = fs.realpathSync(fileURLToPath(import.meta.url));
    return a === b || (process.platform === "win32" && a.toLowerCase() === b.toLowerCase());
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  try {
    process.stdout.write(JSON.stringify({ ok: true, schema: PARENT_DELIVERY_SCHEMA, ...(await runParentDelivery(process.argv.slice(2))) }) + "\n");
  } catch (error) {
    // 配送の誤り（delivery_code）と使い方の誤りは、文面が呼び出し元向けに決めてあるのでそのまま返す。
    // それ以外の例外は、中身（path・本文）を出さずに固定の文面へ落とす。
    const value = error as { delivery_code?: unknown; outcome_unknown?: unknown; message?: unknown };
    const delivery = typeof value?.delivery_code === "string" ? value.delivery_code : null;
    const usage = error instanceof UsageError;
    const duplicate = error instanceof DuplicateError;
    process.stdout.write(JSON.stringify({
      ok: false, schema: PARENT_DELIVERY_SCHEMA,
      code: delivery ?? (usage ? "PARENT_DELIVERY_USAGE" : duplicate ? "PARENT_DELIVERY_DUPLICATE" : "PARENT_DELIVERY_FAILED"),
      message: delivery || usage || duplicate ? String(value.message) : "aiterm-parent-delivery: operation failed",
      outcome_unknown: value?.outcome_unknown === true,
    }) + "\n");
    process.exitCode = 1;
  }
}
