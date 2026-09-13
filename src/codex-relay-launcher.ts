// POSIXのexecで公式CLIとDesktopの直接の親子関係を維持する。
import { codexServerArguments } from "./codex-relay-arguments.js";
import { prepareRelayDirectory } from "./codex-relay-config.js";

const quote = (text: string) => "'" + text.replace(/'/g, "'\"'\"'") + "'";

export function codexRelayLauncher(options: { binary: string; node: string; relay: string; socket_root: string }): string {
  return [
    "#!/bin/sh",
    "command=$(" + [options.node, options.relay, "--prepare", options.socket_root, options.binary, options.node, options.relay].map(quote).join(" ") + ' "$$" "$@") || exit $?',
    'exec /bin/sh -c "$command"',
    "",
  ].join("\n");
}

export function preparePosixRelayLaunch(root: string, binary: string, node: string, relay: string, pid: string, args: string[]): string {
  const serverArgs = codexServerArguments(args);
  if (!serverArgs) return ["exec", binary, ...args].map((arg, i) => i === 0 ? arg : quote(arg)).join(" ");
  if (!/^[1-9][0-9]*$/.test(pid) || Buffer.byteLength(root + "/9999999999.sock") >= 104) throw new Error("socketのpathまたは親processの指定が不正です");
  prepareRelayDirectory(root);
  const socket = root + "/" + pid + ".sock";
  return [
    "exec 3<&0",
    [node, relay, socket, pid].map(quote).join(" ") + " <&3 3<&- &",
    "exec " + [binary, ...serverArgs, "--listen", "unix://" + socket].map(quote).join(" ") + " </dev/null >/dev/null 3<&-",
  ].join("\n");
}
