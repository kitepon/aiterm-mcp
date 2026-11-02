# 配送記録と配送進行

[全体](current-overview.svg) → [配送の詳細](parent-delivery.svg)。編集正本は同名DOT。

| 実ファイル・関数 | 所有するもの |
| --- | --- |
| `parent-delivery-record.ts`: recordSchema / DeliveryRecord | 既存strict保存形式、private source/request/origin owner一致、remote契約正本への参照 |
| 同: readRecord | JSONとschema・filename/delivery ID検証。ENOENTを元のまま返し、その他は従来のPARENT_DELIVERY_STATE_INVALIDへ包む |
| 同: answerMessage | 既存の子回答の先頭文、ID/harness/launch/turn/outcomeと本文。本文欠測・turn不明の既存投影 |
| `parent-delivery.ts`: ParentDeliveryManager | 予約、owner/heartbeat、claim、watch/capture、checkpoint、ready/sending/unknown、回収、終了とcleanup |
| 同: receipt | Codex hook stateを伴うreceipt投影。記録moduleへ移動しない |

記録moduleからcore/SSH transportへのruntime importはない。managerの公開type/クラス/exportと通常・private入口は保持する。記録読取を汎用store/queueに変えず、元schemaの検証順・例外・保存fieldと本文をそのまま維持する。

停止・取消・途中失敗・結果不明は従来のmanagerが進行を持つ。checkpoint喪失は元claimと回答を保持し、不明を再送しない。送信receiptは親の業務完了や画面反映ではない。旧形式にprivate execution情報を補完しない。
