#!/usr/bin/env python3
"""公式App Serverの起動とstdio中継を検証するPOSIX専用の試作。"""

import argparse
import os
from pathlib import Path
import stat
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    parser.add_argument('--node', required=True)
    parser.add_argument('--socket-root', required=True)
    parser.add_argument('codex_args', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.codex_args
    if command[:1] == ['--']:
        command = command[1:]
    if os.name != 'posix':
        raise RuntimeError('この試作はPOSIX専用です')
    if command[:1] != ['app-server']:
        os.execv(args.binary, [args.binary, *command])

    # 初回試作は通常のapp-server起動だけを扱う。別サブコマンドは変更しない。
    if any(arg in ('proxy', 'start', 'stop', 'status', 'generate-ts', 'generate-json-schema') for arg in command[1:]):
        os.execv(args.binary, [args.binary, *command])
    forwarded = ['app-server']
    index = 1
    while index < len(command):
        arg = command[index]
        if arg == '--stdio':
            index += 1
            continue
        if arg == '--listen':
            if command[index + 1] != 'stdio://':
                raise RuntimeError('stdio以外の接続指定は変更しません')
            index += 2
            continue
        if arg.startswith('--listen='):
            if arg != '--listen=stdio://':
                raise RuntimeError('stdio以外の接続指定は変更しません')
            index += 1
            continue
        forwarded.append(arg)
        index += 1

    directory = Path(args.socket_root).absolute()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise RuntimeError('接続先は本人所有・0700のディレクトリが必要です')
    socket_path = str(directory / f'{os.getpid()}.sock')
    if len(os.fsencode(socket_path)) >= 104:
        raise RuntimeError('Unix socketのパスが長すぎます')
    relay = str(Path(__file__).with_name('codex-stdio-relay.mjs'))
    server_pid = os.getpid()
    if os.fork() == 0:
        os.execv(args.node, [args.node, relay, socket_path, str(server_pid)])

    # 親PIDと環境を保って公式実行ファイルへ移る。認証・署名の処理には触れない。
    null_fd = os.open(os.devnull, os.O_RDWR)
    os.dup2(null_fd, 0)
    os.dup2(null_fd, 1)
    if null_fd > 2:
        os.close(null_fd)
    os.execv(args.binary, [args.binary, *forwarded, '--listen', f'unix://{socket_path}'])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'aiterm-relay: 起動失敗: {type(error).__name__}: {error}', file=sys.stderr)
        sys.exit(1)
