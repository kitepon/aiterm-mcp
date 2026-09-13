// transportを切り替える条件と引数の扱いは全OSで共通にする。
export function codexServerArguments(args: string[]): string[] | null {
  let server = false;
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (["-c", "--config", "--enable", "--disable"].includes(arg)) { result.push(arg, args[++i]!); continue; }
    if (/^(?:--config=|--enable=|--disable=|-c.)/.test(arg)) { result.push(arg); continue; }
    if (!server) {
      if (arg !== "app-server") return null;
      server = true; result.push(arg); continue;
    }
    if (["proxy", "daemon", "start", "stop", "status", "generate-ts", "generate-json-schema", "--help", "-h", "--version", "-V"].includes(arg)) return null;
    if (arg === "--stdio" || arg === "--listen=stdio://") continue;
    if (arg === "--listen") {
      if (args[++i] !== "stdio://") throw new Error("stdio以外の接続指定は変更できません");
      continue;
    }
    if (arg.startsWith("--listen=") || arg.startsWith("--ws-")) throw new Error("既存の接続・認証指定は変更できません");
    result.push(arg);
  }
  return server ? result : null;
}
