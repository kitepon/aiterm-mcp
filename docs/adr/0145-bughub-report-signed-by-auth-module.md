# ADR 0145: BugHubへの報告は、認証仲介が署名する（BugHub-ES256）

状態: 採用。ADR 0079の「合鍵のHMAC署名」を置き換える。

## 原因

BugHubの製品合鍵（HMACの秘密）は、報告する各端末のファイル（`product-credentials/aiterm-mcp.json`）に置かれていた。
端末にある秘密は、端末が侵されると漏れる。BugHubはこの合鍵をやめ、非対称署名（ES256）を受ける（2026-11-28 18:31 JST、サクラ氏の依頼）。

## 判断

- 署名の鍵は認証仲介の中だけにある。Aitermは`auth sign bughub-product-aiterm-mcp-<端末>`へ「ts + LF + 本文SHA-256のhex」を渡し、base64の生r‖s（64バイト）を受ける。
- 端末の設定（`runtime-error-signing.json`、秘密なし）: url・key_id・品目名・呼び出しの形。
  - 直接: `auth`のpathと`cwd`（認証仲介はこのfolderを呼び出し元として見る）。bellteam-containerとmain-server。
  - ssh: `ssh`のtarget・`auth`のpath・`cwd`。main-server側のfolderへ入って署名する。rabbit・Mac・fox。
- 報告は`Authorization: BugHub-ES256 key_id=…, ts=…, sig=…`。応答の`sig`（ES256、base64の生r‖s）は、BugHubの応答用公開鍵で `report_id + LF + received_at` に対して確かめる。確かめられない200は受領にしない（ADR 0079のとおり）。
- 署名設定があればES256、無ければ従来の合鍵（HMAC）を使う。全端末が切り替わり、BugHubがHMACの鍵を失効したら、HMACの経路を消す。
- 署名できない（認証仲介が止まっている・断られた・sshが通らない）時は`signing_unavailable`。ackを進めず、次の機会にその時点の累計を新しいreport_idで送る。

## 受け入れること

- 認証仲介かmain-serverへのsshが止まっている間は報告できない。記録は端末に残り、戻れば累計が届く。
- 署名の度に、認証仲介への呼び出し（またはssh）が1回起きる。報告の頻度は既存どおり（自動は最大1時間に1回）。
- BugHubの応答用公開鍵はコードに持つ。鍵が替わる時は新版を出す。
