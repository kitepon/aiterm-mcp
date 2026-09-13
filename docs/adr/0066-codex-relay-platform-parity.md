# ADR 0066: Codex中継の仕組みをOS間で共通にする

日付: 2026-09-14。状態: 採択。

## 判断

引数の解釈、JSONL中継、設定の有効化・競合・復元は共通処理にする。
OS固有の処理は、同じ仕組みをshell、process API、接続transport、権限、設定保存へ適合させる部分だけとする。
両OSで起動元→公式Codex→Node中継の直接の親子関係を維持する。
Aitermの導入・起動・配送・診断はこのrepositoryと公開packageだけで成立し、他製品の導入や修理を必要条件にしない。

POSIXはshellのexecを使う。Windowsは標準の`CreateProcessW`で親processと継承handleを指定する。
公式CLIのstdioは中継Nodeへ引き継ぎ、公式CLI自身のstdinとstdoutはNULへ接続する。
Windowsのlauncherは終了監視だけを担い、JSON-RPCを通さない。Job Objectの対象は自分が起動したprocessだけとし、
公式serverの終了を確認してからlauncherも終了する。Windowsではlauncherと公式CLIのPIDは異なる。

Windowsの認証付きloopback WebSocketとACL、POSIXの本人専用Unix socketは、それぞれのOSの接続適合として維持する。
送信済みRPCの再送、公式binaryの改造・コピー、processへのコード注入は行わない。

設定は両OSで、起動検証→元の設定保存→Aitermの起動先の適用→読戻し→実効確認の順にする。
解除は保存した元の値へ戻す。選択後に第三者が変更した値は上書きしない。
旧Windows版の共有設定は次のenableでAiterm自身のlauncherへ移行し、元の復元値を保つ。

## 根拠

旧Windows版は起動元→launcher→Node中継→公式Codexとなり、Throughlineの公式CLI検出が使う直接の親子関係を変更した。
旧試験もWindowsだけ祖先関係を許していた。直接の親を同じ受入条件にすると修正前に失敗した。

Windows標準APIの隔離実証で、通常の環境、stdio、直接の親子関係を維持できることを確認した。
公式CLIをローカルResponses fixtureへ接続し、Steer、終了後再開、承認応答、接続分離とEOF終了を検証する。
単独launcherの日本語・空白・引用符・末尾backslash、接続前の入力とEOF、不正な応答もfocused testで確認する。
実利用者の認証や外部モデルは試験に使わない。

一次資料は[親processと継承handleの指定](../../rag/sources/codex-relay/windows-process-parent-and-handles.md)と
[Windows native processの作成](../../rag/sources/codex-relay/windows-create-process.md)に保存した。
ADR 0065の起動構成とWindows固有の共有設定の判断は、本ADRで置き換える。

## 2026-09-14のWindowsパス適合修理

MSIX仮想AppDataの論理パスは、起動準備processでは読めてもnative子で読めない場合があった。
中継を開始する準備processが自身の実体パスを`LaunchPlan.relay`へ返し、native子へ渡す。
起動時に読み込んだ同じ中継を使い、直接親、stdio、終了、設定管理の共通契約は維持する。

公式のMSIX試験入口で旧版の`MODULE_NOT_FOUND`を再現し、同じ条件で修正版のinitializeとEOFを確認する。
[MSIXの仮想化仕様](../../rag/sources/codex-relay/windows-msix-filesystem-virtualization.md)と
[公式の試験入口](../../rag/sources/codex-relay/windows-msix-package-process-test.md)を保存した。

## 受入判断

2026-09-14、公開0.37.3の完全再起動後に、通常MCPから同じ子の初手・追加回答を自動受信し、
公式Codexの直接親とThroughlineの既存Desktop検出が一致することを確認した。
公開・導入・再起動後の受入を完了とする。
試験と公開の記録は[検証記録](../evidence/codex-relay-platform-parity-20260914.md)を参照する。
