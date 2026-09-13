// ユーザーのログイン時にもCodexの起動設定を適用する、Aiterm専用LaunchAgent。
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { SetupError } from "./setup-platform.js";

const label = "dev.kitepon.aiterm-codex-relay";
const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
export function relayLoginPlist(launcher: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>/bin/launchctl</string><string>setenv</string><string>CODEX_CLI_PATH</string><string>${xml(launcher)}</string></array><key>RunAtLoad</key><true/></dict></plist>\n`;
}
type Options = { directory?: string; uid?: number; run?: (args: string[]) => number };
function context(options: Options) {
  const directory = options.directory ?? path.join(process.env.HOME ?? homedir(), "Library", "LaunchAgents");
  const uid = options.uid ?? process.getuid?.();
  if (uid === undefined) throw new SetupError("codex_steer_platform_unsupported", "LaunchAgentはmacOSだけで使用します");
  const run = options.run ?? ((args: string[]) => {
    const result = spawnSync("/bin/launchctl", args, { encoding: "utf8", timeout: 10_000 });
    if (result.error) throw new SetupError("codex_steer_login_failed", "ログイン時の起動設定を実行できません");
    return result.status ?? -1;
  });
  return { directory, file: path.join(directory, `${label}.plist`), domain: `gui/${uid}`, service: `gui/${uid}/${label}`, run };
}
export function installRelayLogin(launcher: string, options: Options = {}): void {
  const { directory, file, domain, service, run } = context(options);
  const contents = relayLoginPlist(launcher);
  if (fs.existsSync(file) && (fs.lstatSync(file).isSymbolicLink() || fs.readFileSync(file, "utf8") !== contents)) {
    throw new SetupError("codex_steer_login_conflict", "同名のLaunchAgentが変更されています。所有外の設定は上書きしません");
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(file)) fs.writeFileSync(file, contents, { mode: 0o600, flag: "wx" });
  if (run(["print", service]) !== 0 && run(["bootstrap", domain, file]) !== 0) throw new SetupError("codex_steer_login_failed", "ログイン時のSteer設定を登録できません");
}
export function removeRelayLogin(launcher: string, options: Options = {}): void {
  const { file, service, run } = context(options);
  if (!fs.existsSync(file)) return;
  if (fs.lstatSync(file).isSymbolicLink() || fs.readFileSync(file, "utf8") !== relayLoginPlist(launcher)) {
    throw new SetupError("codex_steer_login_conflict", "変更されたLaunchAgentは削除しません");
  }
  if (run(["print", service]) === 0 && run(["bootout", service]) !== 0) throw new SetupError("codex_steer_login_failed", "ログイン時のSteer設定を解除できません");
  fs.unlinkSync(file);
}
