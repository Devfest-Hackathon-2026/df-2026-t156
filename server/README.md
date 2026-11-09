# ゲームサーバーと配信

Node.js 22以上、依存はws。`npm ci` → `npm start` でルートbuild-webを同一originで配信し、WebSocket `/ws` に接続します。PORT既定8080。`GET /health` はhuman接続数・ラウンド・共有設定hashを返します。

命中・回収・売却・強化・順位をサーバーが確定し、protocol2の差分とACKで正式Unityクライアントへ配信します。`../Unity/Assets/Resources/valley.json` とSceneryRock.jsonをローカルで読み、Dockerではstageにコピーした正本を使用します。`protocol.md` の後続改訂が旧記述より優先します。

既存のCloud Run配布はルート `scripts/deploy-prototype.sh`。GCP_PROJECTで自分の既存projectを指定し、認証済みgcloudを用います。既定のservice/repository/regionはスクリプトを参照してください。認証・秘密値は含めません。`GCP_NO_TRAFFIC=1 GCP_REVISION_TAG=review` で候補を先に配備し、稼働中のプレイヤーを切らずに確認できます。明示のrevisionへトラフィックを切り替えます。

`scripts/verify-webgl.mjs URL build-web` で配信data/framework/wasmの復号SHA256・HEAD・MIMEを照合します。静的配信はgzipを事前生成し、WebSocketと同じポートで提供します。試験は `node --test`。公開44時点の弓試験には、自動売却前の袋/sellProgress期待に由来する既知の5失敗があり、近接/移動/通信の関連42件は成功しています。

投稿・投票は `feedback.js` が確定順位から権利を発行します。`GET /api/feedback` は匿名でも閲覧でき、`POST /api/feedback` の提案・投票は同originのブラウザー保存鍵をBearerで照合します。鍵をURLや公開JSONへ出しません。Unityの既存PlayerPrefsキーがあればWebのlocalStorageへ移行します。

`FEEDBACK_FILE=./.local/feedback.json` はローカルの原子的ファイル保存、`FEEDBACK_BUCKET` と `FEEDBACK_OBJECT=orbit-salvage/feedback/v1.json` はCloud Storage保存です。両方無設定ならメモリのみ。Cloud Runの既存実行SAを用い、各readのgenerationと書込のifGenerationMatchを結び付け、競合時に再読します。バケットを公開せず、サービスアカウントキーも追加しません。

`/history/` は保存したHTML、`/history-play/` は旧版のローカルWorker再生です。`HISTORY_ASSET_BUCKET` がある場合、`archive.js` が対象作品のハッシュ名assets/chunksだけを同originから読み出します。大きいdata/wasmは復元キャッシュとしてGit対象外です。ローカル復元はルートの `scripts/fetch-history-assets.mjs`。配備にはこのハッシュ資産の事前配置が必要で、現運用は既存バケットの `orbit-salvage/history/` 配下を使用します。

今回の関連試験は `node --test server/feedback.test.js server/archive.test.js server/static.test.js`。ローカルの短縮・得点を揃えた専用局面では、実Chromeで勝者の日本語投稿と共有票、履歴ページとの同一権利、ファイル再起動後の保持を確認しました。通常180秒の自然な勝利を確認した記録とは区別します。AIによる自動改修・自動再配備は実装していません。

公開46では実Cloud Runのラウンド確定後にCloud Storageへのgrant1件の書込を確認し、Unityから履歴ページに移って同じ投票権が表示されました。本番の提案/票は0件で、確認用の文は投入していません。ローカルの実投稿・共有票と、公開の権利/永続化確認を区別しています。

