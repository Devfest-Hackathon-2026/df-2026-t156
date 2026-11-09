# ゲームサーバーと配信

Node.js 22以上、依存はws。`npm ci` → `npm start` でルートbuild-webを同一originで配信し、WebSocket `/ws` に接続します。PORT既定8080。`GET /health` はhuman接続数・ラウンド・共有設定hashを返します。

命中・回収・売却・強化・順位をサーバーが確定し、protocol2の差分とACKで正式Unityクライアントへ配信します。`../Unity/Assets/Resources/valley.json` とSceneryRock.jsonをローカルで読み、Dockerではstageにコピーした正本を使用します。`protocol.md` の後続改訂が旧記述より優先します。

既存のCloud Run配布はルート `scripts/deploy-prototype.sh`。GCP_PROJECTで自分の既存projectを指定し、認証済みgcloudを用います。既定のservice/repository/regionはスクリプトを参照してください。認証・秘密値は含めません。`GCP_NO_TRAFFIC=1 GCP_REVISION_TAG=review` で候補を先に配備し、稼働中のプレイヤーを切らずに確認できます。明示のrevisionへトラフィックを切り替えます。

`scripts/verify-webgl.mjs URL build-web` で配信data/framework/wasmの復号SHA256・HEAD・MIMEを照合します。静的配信はgzipを事前生成し、WebSocketと同じポートで提供します。試験は `node --test`。公開44時点の弓試験には、自動売却前の袋/sellProgress期待に由来する既知の5失敗があり、近接/移動/通信の関連42件は成功しています。

この時点では投票の保存機能やAIの自動実装はありません。後続の機能実装と、その確認範囲は別のcommitで追加します。
