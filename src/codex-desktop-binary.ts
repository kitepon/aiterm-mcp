// Codex DesktopのSteerで使う同梱Codex CLIの場所。Desktopは更新のたびに同梱物の場所を変えることがある
// （Windowsは版ごとのcache directory、macOSはbundle内の配置）。setup時に保存した場所が消えていたら、
// 使う時点で公式Desktopから探し直して設定を更新する。探せなければ理由付きで失敗し、別のCodexへは切り替えない。
import * as fs from "node:fs";
import * as path from "node:path";
import { CodexDeliveryError } from "./codex-delivery-error.js";
import { codexHookDirectory, writeHookJson, type CodexHookConfig } from "./codex-hook-state.js";

export type DesktopBinaryFinder = () => string;

async function platformFinder(): Promise<DesktopBinaryFinder> {
  if (process.platform === "win32") return (await import("./windows-codex-setup.js")).findWindowsCodexBinary;
  return (await import("./setup-codex-relay.js")).findDesktopBinary;
}

export async function currentCodexDesktopBinary(
  config: CodexHookConfig,
  options: { directory?: string; find?: DesktopBinaryFinder; exists?: (file: string) => boolean } = {},
): Promise<string> {
  const exists = options.exists ?? fs.existsSync;
  if (exists(config.binary)) return config.binary;
  let binary: string;
  try {
    binary = (options.find ?? await platformFinder())();
  } catch (error) {
    throw new CodexDeliveryError("CODEX_DESKTOP_BINARY_MOVED",
      `Codex Desktopの更新で ${config.binary} が無くなり、新しい場所も特定できません（${error instanceof Error ? error.message : String(error)}）。` +
      "Codex Desktopを起動してから aiterm-setup --codex-steer enable を実行してください");
  }
  writeHookJson(path.join(options.directory ?? codexHookDirectory(), "config.json"), { ...config, binary });
  return binary;
}
