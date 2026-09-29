// 親の同期hookだけが、公式キューのAiterm回答を同じターンの入力へ移す。本体はaiterm-steer-delivery。
import * as steer from "aiterm-steer-delivery";
import { AITERM_PROFILE } from "./steer-profile.js";
import type { CodexReceiverRuntime } from "./codex-parent-receiver.js";

export async function runCodexResultHook(input: unknown, emit: (value: object) => Promise<void>, options: {
  directory?: string; codex_home?: string; runtime?: CodexReceiverRuntime;
} = {}): Promise<void> {
  await steer.runCodexResultHook(AITERM_PROFILE, input, emit, options);
}
