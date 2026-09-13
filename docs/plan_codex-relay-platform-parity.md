# Codex中継のMac・Windows仕様統一

2026-09-13。依頼: 「Macと同じ仕様にしろ。違いはOS依存部分だけだ」。

## 受入条件

- 公式Codexの直接の親をDesktopとして保ち、Throughlineの既存Desktop検出がそのまま成功する。
- 公式binary、通常の環境・認証・設定、stdio、Steer／終了後再開、承認、終了と片付けを共通契約で検証する。
- 設定の有効化・確認・共存・解除を共通の状態遷移にし、OS差はnative起動、接続transport、権限、設定保存のadapterへ閉じ込める。
- Aiterm単独で提供する。Throughlineの検出条件変更で中継の挙動差を吸収させない。
- 公開・導入・Desktop再起動後に、通常MCPの配送とThroughlineの正規入口を確認する。

## 実測した欠陥

Macはlauncherを公式Codexへexecし、Desktopとの直接の親子関係を保つ。
WindowsはDesktop→launcher→Node中継→公式Codexとなり、Throughlineの直接親による公式binary検出を外す。
既存試験の`parent_preserved`はWindowsだけ中間processを含む祖先関係を確認しており、Macと同じ条件ではなかった。
この端末はgpt-connectorの中継をAitermが共有している。現在の共有接続も同じ問題を持つ。
起動設定はまだ変更していない。

## 工程

1. F: 直接親の最小再現、Macの契約確認、Windows native起動の隔離実証。
2. F: 共通の設定・中継契約とOS adapterの修理、focused test、Throughlineの変更なしでの検証。
3. F: 契約変更の独立反証、関連gate、3環境CI、main統合、公開・導入。
4. H: Desktopを完全終了して再起動する。
5. F: 通常接続とThroughlineを実測し、結果を記録する。

実装は親が直接担当し、契約の独立反証だけを読取専用で委譲する。共有起動契約が密結合のためwriterを並列化しない。
Windows Control v1は`PLATFORM_UNVERIFIED`のため利用せず、判断と証拠はこのrepositoryへ残す。Latticeは使わない。
稼働中のDesktop停止や起動設定切替は隔離検証を完了してから扱う。公式binaryの改造やプロセスへのコード注入は行わない。

## 現在地

直接親の旧実装での失敗を再現し、Windows標準APIで起動元→公式Codex→Node中継を作る実装へ変更した。
引数、JSONL中継、設定の有効化・競合・復元は共通処理へ移した。公式CLIの配送試験、終了確認のfocused test、
日本語・引用符・末尾backslash、接続前の入力とEOF、不正応答の試験は成功した。
2026-09-14の関連試験は24件中20成功、Mac専用4件skip、失敗0。
最初のCIではMac・Windowsが成功、Linuxで接続通知と応答の同時到着による取りこぼしを検出した。
同じ順序をWindowsでも最小再現し、受信handlerの登録順を修理した。focused testの3件と公式CLI試験の2件が成功した。
修正後の3環境CI（34764959849）は成功し、Codexによる全体レビューと受信順修正の追加レビューでも新たな欠陥は見つからなかった。
Grokの追加レビューは結論を得られず終了し、成功したレビューには数えない。現在は公開・導入の工程へ進む。
工場の共通正典へのOS適合原則の追記はdotagentsの`70f0fb7`でpush済み。

2026-09-13の追加確認: 完了条件はAiterm単独での成立であり、gpt-connectorの導入・更新を必須にしない。
gpt-connectorはオーナーが別途修理するため、この作業の変更・調査・レビュー・公開対象から除外する。
範囲外に作った差分はAitermの`.git/aiterm-experiments/windows-parity-20260913/`へ退避して取り消し、追加生成物も撤去した。
現在のDesktopは従来のgpt-connector中継で動いている。起動設定の切替と再起動後の他アプリへの影響は未確認。
