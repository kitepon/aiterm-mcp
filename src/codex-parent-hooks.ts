// 親の同期hookだけが、公式キューのAiterm回答を同じターンの入力へ移す。
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { realCodexHome } from "./harnesses/codex.js";
import { withCodexReceiver, type CodexReceiverRuntime } from "./codex-parent-receiver.js";
import { CodexDeliveryError } from "./codex-delivery-error.js";
import { readRuntimeProcesses } from "./process-runtime.js";
import { currentCodexDesktopBinary } from "./codex-desktop-binary.js";
import { answerDigest, codexHookDirectory, codexInputDirectory, hookInputSchema, readCodexHookConfig, writeHookJson } from "./codex-hook-state.js";

export async function runCodexResultHook(input: unknown, emit: (value: object) => Promise<void>, options: {
  directory?: string; codex_home?: string; runtime?: CodexReceiverRuntime;
} = {}): Promise<void> {
  const event = z.object({ session_id: z.uuid(), turn_id: z.string().min(1),
    hook_event_name: z.enum(["PostToolUse", "Stop"]) }).parse(input);
  const root = options.directory ?? codexHookDirectory();
  const config = readCodexHookConfig(root);
  if (!config?.enabled) { await emit({}); return; }
  const home = options.codex_home ?? realCodexHome();
  if (fs.realpathSync(home) !== fs.realpathSync(config.codex_home)) {
    throw new CodexDeliveryError("CODEX_HOOK_HOME_MISMATCH", "hookと配送設定のCodex環境が一致しません");
  }
  const directory = codexInputDirectory(root, home, event.session_id);
  const pending = path.join(directory, "pending");
  if (!fs.existsSync(pending) || !fs.readdirSync(pending).length) { await emit({}); return; }
  const claims = path.join(directory, "claims");
  fs.mkdirSync(claims, { recursive: true, mode: 0o700 });
  const taken: { file: string; delivery_id: string; text: string }[] = [];
  const identity = readRuntimeProcesses().find(row => row.pid === process.pid);
  if (!identity) throw new CodexDeliveryError("CODEX_HOOK_PROCESS_UNAVAILABLE", "受信hookのprocessを確認できません");
  try {
    await withCodexReceiver({ thread_id: event.session_id, codex_home: home }, async request => {
      // 削除でoffsetが動くため、全ページを読んでから取り出す。
      const entries: any[] = [];
      let cursor: string | null = null;
      do {
        const page = await request("thread/queue/list", { threadId: event.session_id, cursor, limit: 100 });
        if (!Array.isArray(page?.data) || !(page.nextCursor === null || typeof page.nextCursor === "string")) {
          throw new CodexDeliveryError("CODEX_HOOK_QUEUE_INVALID", "公式キューの一覧応答を認識できません");
        }
        entries.push(...page.data); cursor = page.nextCursor;
      } while (cursor);
      const queued = new Set(entries.map(entry => entry.clientUserMessageId));
      // 送信processが終了し、キューに残っていない所有記録を消す。投入中は触らない。
      for (const name of fs.readdirSync(pending)) {
        const ack = path.join(directory, "settled", name);
        if (name.endsWith(".json") && !queued.has(name.slice(0, -5)) && fs.existsSync(ack)) {
          fs.rmSync(path.join(pending, name), { force: true }); fs.rmSync(ack, { force: true });
        }
      }
      for (const entry of entries) {
        const id = z.uuid().safeParse(entry.clientUserMessageId);
        if (!id.success) continue;
        const source = path.join(pending, `${id.data}.json`);
        let owner;
        try { owner = hookInputSchema.parse(JSON.parse(fs.readFileSync(source, "utf8"))); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        const text = entry.input?.length === 1 && entry.input[0].type === "text" ? entry.input[0].text : undefined;
        if (owner.delivery_id !== id.data || owner.thread_id !== event.session_id || typeof text !== "string" || answerDigest(text) !== owner.text_sha256) {
          throw new CodexDeliveryError("CODEX_HOOK_INPUT_CHANGED", "Aitermの配送記録とキュー本文が一致しません。取り出していません");
        }
        const file = path.join(claims, `${id.data}.json`);
        // 同時hookが同じ回答を取り出すことを防ぎ、中断したclaimは自動再送しない。
        try { fs.linkSync(source, file); fs.unlinkSync(source); }
        catch (error) { if (["ENOENT", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) continue; throw error; }
        fs.rmSync(path.join(directory, "settled", `${id.data}.json`), { force: true });
        const item = { file, delivery_id: id.data, text };
        taken.push(item);
        writeHookJson(file, { ...owner, text, state: "deleting", turn_id: event.turn_id, queued_submission_id: entry.id,
          pid: identity.pid, started_identity: identity.started_identity });
        const result = await request("thread/queue/delete", { threadId: event.session_id, queuedSubmissionId: entry.id });
        if (typeof result?.deleted !== "boolean") throw new CodexDeliveryError("CODEX_HOOK_QUEUE_INVALID", "キュー削除の結果を確認できません", true);
        if (!result.deleted) {
          writeHookJson(file, { ...owner, state: "not_in_queue", turn_id: event.turn_id });
          taken.pop();
        }
      }
    }, options.runtime ?? { executable: await currentCodexDesktopBinary(config), timeout_ms: 5_000 });
    const text = taken.map(item => item.text).join("\n\n");
    await emit(!taken.length ? {} : event.hook_event_name === "Stop"
      ? { decision: "block", reason: text }
      : { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } });
    for (const item of taken) writeHookJson(item.file, { delivery_id: item.delivery_id, state: "emitted", turn_id: event.turn_id, text: item.text });
  } catch (error) {
    for (const item of taken) writeHookJson(item.file, { delivery_id: item.delivery_id, state: "unknown", turn_id: event.turn_id, text: item.text });
    throw error;
  }
}
