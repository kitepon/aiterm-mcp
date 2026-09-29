// Codex DesktopのSteerで使う同梱Codex CLIの場所。消えていたら使う時点で探し直す。本体はaiterm-steer-delivery。
import * as steer from "aiterm-steer-delivery";
import { AITERM_PROFILE } from "./steer-profile.js";
import type { CodexHookConfig } from "./codex-hook-state.js";

export type DesktopBinaryFinder = steer.DesktopBinaryFinder;

export async function currentCodexDesktopBinary(
  config: CodexHookConfig,
  options: { directory?: string; find?: DesktopBinaryFinder; exists?: (file: string) => boolean } = {},
): Promise<string> {
  return steer.currentCodexDesktopBinary(AITERM_PROFILE, config, options);
}
