# 0001. Core terminal model

## Context

aiterm-mcp は、AI がローカル/SSH/コンテナを問わず端末を継続操作するための stdio MCP サーバである。
1コマンドごとの実行では SSH の再認証、短命セッションの増加、出力の重複が発生する。一方で、AI は出力を観測してから次の入力を決めるため、観測ループそのものは消せない。

## Decision

- バックエンドは tmux を採用する。tmux の永続セッション、`capture-pane`、再接続性を使う。
- プリミティブは「ローカル PTY を 1個握る」ことに限定する。SSH、docker、REPL、wsl は専用ツールではなく、その PTY に送る通常のテキスト入力として扱う。
- POSIX shellとPowerShell前面へのsanitize済み複数行は、改行なしの単一入力へ可逆変換し、script全体を現在のshellへ取り込んでから実行する。POSIXは`eval`、PowerShellはUTF-8のBase64を復元したscriptblockのdot-sourceで同じ動作を実現する。単一行、raw送信、非shell前面は直接PTY入力のまま扱う。
- 完了検出は quiescence を中核にする。画面出力の静止とシェル復帰を観測し、`until`、`mark`、プロセス終了、timeout と組み合わせる。`until`／`mark`指定時はその明示証拠を優先し、quiescenceは完了にしない。
- PTYへの長文入力は全OSでUTF-8境界を守る256byte chunkに分け、chunk間に10msのdrain境界を置く。tmuxの成功codeはPTY入力の無欠落を保証しない。

## Consequences

- セッションは MCP サーバプロセスをまたいで生存し、人間も tmux attach で同じ端末を確認できる。
- セッション種別ごとのツール分岐を避け、ローカル、SSH、コンテナ、REPL を同じ操作モデルで扱える。
- ネスト中は外側から内側プロンプトを確実に知れないため、`until` や `mark` が完了確定の補助になる。
- shell script型の複数行は途中で起動したpager／REPLに後続行を奪われない。一方、REPLへ複数行を直接流す用途は、前面がREPLになってから別の`pty_send`で送る。
- tmux が実行時依存になる。Windows ネイティブでは WSL 側 tmux への橋渡しが必要になる。
