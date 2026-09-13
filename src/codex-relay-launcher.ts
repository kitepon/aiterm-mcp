// POSIXのexecで公式CLIのPIDとDesktopからの親子関係を維持する。
const quote = (text: string) => `'${text.replace(/'/g, `'"'"'`)}'`;

export function codexRelayLauncher(options: { binary: string; node: string; relay: string; socket_root: string }): string {
  return `#!/bin/sh
binary=${quote(options.binary)}
node=${quote(options.node)}
relay=${quote(options.relay)}
root=${quote(options.socket_root)}
mode=root
value=no
for arg do
  if [ "$value" = yes ]; then value=no; continue; fi
  case "$arg" in
    -c|--config|--enable|--disable|--listen) value=yes; continue ;;
  esac
  if [ "$mode" = root ]; then
    case "$arg" in
      --config=*|--enable=*|--disable=*|-c?*) ;;
      app-server) mode=server ;;
      *) mode=other; break ;;
    esac
  else
    case "$arg" in
      proxy|start|stop|status|generate-ts|generate-json-schema|--help|-h|--version|-V) mode=other; break ;;
    esac
  fi
done
if [ "$mode" != server ]; then exec "$binary" "$@"; fi

# 引数を一巡させ、stdio指定だけを公式Unix受付へ変更する。
remaining=$#
value=no
while [ "$remaining" -gt 0 ]; do
  arg=$1
  shift
  remaining=$((remaining - 1))
  if [ "$value" = yes ]; then
    set -- "$@" "$arg"
    value=no
    continue
  fi
  case "$arg" in
    -c|--config|--enable|--disable) value=yes; set -- "$@" "$arg" ;;
    --stdio) ;;
    --listen)
      if [ "$remaining" -eq 0 ] || [ "$1" != stdio:// ]; then
        echo 'aiterm-relay: stdio以外の接続指定は変更できません' >&2
        exit 2
      fi
      shift
      remaining=$((remaining - 1)) ;;
    --listen=stdio://) ;;
    --listen=*) echo 'aiterm-relay: stdio以外の接続指定は変更できません' >&2; exit 2 ;;
    *) set -- "$@" "$arg" ;;
  esac
done
"$node" "$relay" --prepare "$root" || exit $?
socket="$root/$$.sock"
exec 3<&0
"$node" "$relay" "$socket" "$$" <&3 3<&- &
exec "$binary" "$@" --listen "unix://$socket" </dev/null >/dev/null 3<&-
`;
}
