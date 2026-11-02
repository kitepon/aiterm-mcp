> 候補の機能説明。基準初読の記述に、A1–S1の所有者変更を反映した。全fixture/実OSの網羅確認を意味しない。

# 接点の契約照合

基準はAiterm ce575ce8/0.63.2、Steer6734ee86/0.5.1。Bridgeはリターのmain0a91d53/0.4.5。相手の原本は `/srv/bellteam/bots/bot-df96182b/docs/bridge-refactor-20261102/external-contracts.md`。Bridgeの内部改修はしない。

## SteerとBridge

Bridgeはlocal.sqlite、配送予約・排他・通話DB/receiptを所有する。Steerはprofileで与えられたstate_root下のchannelとhook、inbox/claim/emitted/closed、出力状態を所有する。Bridgeから渡るprofile/channel ID/delivery ID/textと公式の返却が接点であり、双方のDB/fileを一つの共有状態へ変えない。

リターが挙げたBridgeの6個mjsの呼ぶSteer exportは基準 `src/index.ts` の再exportで提供される。名前ごとのcompiler照合は `integrations/refactor-20261102/bridge-export-check.json` に保存する。S1で既存channel14件、settle失敗1件、Bridge公開surface6件を確認した。変更境界の型・保存値・例外は維持したが、Bridge内部の全field/実fixtureを独立に再検証したものではない。

| 接点 | Steerの現在の実装 | 維持する意味 |
| --- | --- | --- |
| `--profile ... codex verify/state/submit/setup` | `src/cli.ts` `runCli` / `loadProfile` | stdout1行JSON、ok/code/message/outcome_unknown、失敗exit1。verifyはthread、submitはqueued_submission_id、stateはhookのsending/unknown/null等。threadの受付を作業完了へ変換しない |
| Bridge所有channel adapter | SteerはSDK exportを提供、Bridgeのmjsがopen/open-wait/wait/own/owner/owners/send/state/withdraw/close/setup/cursor-setupを実装 | Steer `cli.ts` はCodexだけ。channel adapterのCLIをSteer自身の公開CLIへ誤記しない |
| `sendToChannel` | `src/channel.ts` | Codexはsubmitted＋queue受付ID、他はqueued＋null。queuedは出力済みを意味しない |
| `channelDeliveryState` | 同file | non-Codexでqueued/sending/emitted/unknown/withdrawn/null。Codexはこの関数ではnull。null単独は未出力の証明ではない |
| `withdrawFromChannel` | 同file | 受信者のclaimと同じhard-linkで競合し、trueだけが当該本文の未出力を証明する。別本文や他経路へ拡張しない |
| 出力と異常 | `emitClaimed` / `settle` | emitの成功後にemitted、例外ならunknownを保持。自動再送しない。emittedはhook/receiverへの出力の証拠で、vendor作業開始/完了/画面表示そのものではない |
| `closeChannel` | 同file | closed markを残し、未取得本文を保持。待機者が次の確認で終わる事と、即時に全processが停止した事は異なる |
| `ProductProfile.delivery_admission` | `src/delivery-effect.ts` `withDeliveryEffect` | product-owned callback。無指定は従来動作、requiredでresolver欠測は拒否。二重作用/途中終了/結果不明の区別を保持する |

[channel描画SVG](../../../steer-refactor-20261102/docs/architecture/channel.svg) / [PNG](../../../steer-refactor-20261102/docs/architecture/channel.png)。上表はリターの所有境界と一致する。`emitted → Bridge started receipt` はBridgeの意味付けであり、Steerがagent開始を証明するという記述にはしない。

## AitermとBridge / BellTeam

2026-11-02の本体機能分担後の正本リンク・公開口・連絡先は[本体担当との接点](bellteam-boundary.md)。AI実行/適用/再開はキロ、席実行基盤/登録はエピネル、認証案内はミカ、会話/履歴はN102、全体統合/本番はトロニー。Aiterm/Steer内部はエレグが維持する。

Bridgeは公開MCP `pty_list` / `agent_launch` / `pty_send(require_agent=true)` / `pty_close` を使う。`initial_prompt`、`startup`、送信失敗の未送信/不明を保持する。Aitermの`AgentResumeError`と既存`sendFailure`は別契約で、どちらも単一の成功へ丸めない。

BellTeamはBot/session-slotと配送ジョブ・設定要求を所有する。Aitermはnative席・process本人性・入力・観測・公開receiptを所有する。現在の接点はMCP request/result、`aiterm/caller` metadata、steer/seat-turns/interim metadata、親完了返却。BellTeam内部の全caller/failure境界は本製品の調査対象外。本表の公開契約と本体担当の正本を接続し、今回変更した製品内callerを各段階で照合した。

公開0.63.2のlaunch receiptにはlaunch_idがなく、現在の`pty_observe`にstring|nullとして提供する。型付きresume未送信拒否はsession/launch/input/recoveryを持つ。この区別と既consumerが依存する文面・metadataを維持する。

## Bridge回復処理の保存形式への読取依存（追加照合）

リターの精読で、Bridge `recover._queue_absent` はCodex inputsのclaims/pending/settledを前後照合し、`codex_delivery.hook_delivery_state` はinputs有無を前判定し、`channel_recover.channels` はsteer-channelsのUUID directory集合を前後照合すると判明した。これらは直接編集ではないが、SDK内部保存形式への読取依存であり、exportだけの接続と記述しない。`transcriptAge`のvendor会話file mtimeは別の読取依存である。

Steer6734ee86の公開面で確認できた既存の口は次のとおり。

| 必要な情報 | 既存公開面 | 同じ安全確認を代替できるか |
| --- | --- | --- |
| Codexの既知delivery単位の状態 | `codexHookDeliveryState(home,thread,id,root)`、CLI `codex state` | 第4引数rootは必須。sending/unknown/null等の射影を返す。claims/pending/settledの個別内容と前後集合snapshotをすべて返す口ではない |
| Codex inputsの保存path | `codexHookDirectory(profile)`、`codexInputDirectory(root,home,thread)` | path算出は公開されているが、directory存在や全記録を原子的に列挙するAPIではない |
| Aiterm配送の既知delivery詳細 | `codexDeliveryDetailViaAiterm` | Aiterm providerへの照会で、Bridge profileのSteer stateを包括して列挙する代替ではない |
| channelの既知IDの内容/状態 | `channelRoot(profile)`、`readChannel`、`channelClosed`、`channelDeliveryState` | rootと単一ID読取は提供。全channel ID集合とowner集合の前後一致を返す公開export/CLIはない |

既存APIで同じ包括的な安全確認を置換できるとは確認できなかった。今回は保存形式依存を図と保持契約へ明記し、変更前に相手と調整する。Astra設計では新しい包括列挙APIを作らず、保存形式依存を保持する案を採用した。相手内部の改修は不要。状態射影のnullを保存recordの不在や過去の未作用の証拠へ置換しない。

path算出の前提も保持する。Steerは `sha256(fs.realpathSync(home))`、Bridge recover.py:26は `Path(subscription['codex_home']).resolve()` 後に `sha256(os.fsencode(home))`。双方にpath正規化があることは読取確認済み。OSごとのencoding/表記まで全同値と証明したものではなく、Symlink/Windows表記を含めた既存契約の照合項目として残す。

## 06:53 UTC Bridge設計の接点保持

リターからAstra設計の結果を受領し、Bridge側design.mdの接点方針を読取照合した。公開export/CLI引数/返却とclaims/pending/settled前後確認・全UUID/owner集合は変更しない。今回は新しい包括列挙APIを要求しない。Bridge側LinuxのASCII/日本語/direct/symlink4例一致は相手側の検証結果として記録し、当席の独立試験やmacOS/Windowsの一致へ拡張しない。Bridge内部の全field/例外fixtureの独立再検証は未実施。S1の直接境界と公開surfaceの確認を全consumer受入へ拡張しない。相手内部の変更依頼・操作は0。
