# ゲームサーバーと配信

Node.js 22以上、依存はws。`npm ci` → `npm start` でルートbuild-webを同一originで配信し、WebSocket `/ws` に接続します。PORT既定8080。`GET /health` はhuman接続数・ラウンド・共有設定hashを返します。

命中・回収・売却・強化・順位をサーバーが確定し、protocol2の差分とACKで正式Unityクライアントへ配信します。`../Unity/Assets/Resources/valley.json` とSceneryRock.jsonをローカルで読み、Dockerではstageにコピーした正本を使用します。`protocol.md` の後続改訂が旧記述より優先します。

既存のCloud Run配布はルート `scripts/deploy-prototype.sh`。GCP_PROJECTで自分の既存projectを指定し、認証済みgcloudを用います。既定のservice/repository/regionはスクリプトを参照してください。認証・秘密値は含めません。`GCP_NO_TRAFFIC=1 GCP_REVISION_TAG=review` で候補を先に配備し、稼働中のプレイヤーを切らずに確認できます。明示のrevisionへトラフィックを切り替えます。

`scripts/verify-webgl.mjs URL build-web` で配信data/framework/wasmの復号SHA256・HEAD・MIMEを照合します。静的配信はgzipを事前生成し、WebSocketと同じポートで提供します。試験は `node --test`。弓の旧5期待は自動売却後の実入金・袋・引きとの独立へ更新し、28件成功。近接/移動/通信の既存確認は42件成功です。

投稿・投票は `feedback.js` が確定順位から権利を発行します。`GET /api/feedback` は匿名でも閲覧でき、`POST /api/feedback` の提案・投票は同originのブラウザー保存鍵をBearerで照合します。鍵をURLや公開JSONへ出しません。Unityの既存PlayerPrefsキーがあればWebのlocalStorageへ移行します。

`FEEDBACK_FILE=./.local/feedback.json` はローカルの原子的ファイル保存、`FEEDBACK_BUCKET` と `FEEDBACK_OBJECT=orbit-salvage/feedback/v1.json` はCloud Storage保存です。両方無設定ならメモリのみ。Cloud Runの既存実行SAを用い、各readのgenerationと書込のifGenerationMatchを結び付け、競合時に再読します。バケットを公開せず、サービスアカウントキーも追加しません。

`/history/` は保存したHTML、`/history-play/` は旧版のローカルWorker再生です。`HISTORY_ASSET_BUCKET` がある場合、`archive.js` が対象作品のハッシュ名assets/chunksだけを同originから読み出します。大きいdata/wasmは復元キャッシュとしてGit対象外です。ローカル復元はルートの `scripts/fetch-history-assets.mjs`。配備にはこのハッシュ資産の事前配置が必要で、現運用は既存バケットの `orbit-salvage/history/` 配下を使用します。

今回の関連試験は `node --test server/feedback.test.js server/archive.test.js server/static.test.js`。ローカルの短縮・得点を揃えた専用局面では、実Chromeで勝者の日本語投稿と共有票、履歴ページとの同一権利、ファイル再起動後の保持を確認しました。通常180秒の自然な勝利を確認した記録とは区別します。AIによる自動改修・自動再配備は実装していません。

公開46では実Cloud Runのラウンド確定後にCloud Storageへのgrant1件の書込を確認し、Unityから履歴ページに移って同じ投票権が表示されました。本番の提案/票は0件で、確認用の文は投入していません。ローカルの実投稿・共有票と、公開の権利/永続化確認を区別しています。


### ゲーム内の提案を、実際の次版へ結ぶ

投稿APIの `id`（UUID）と `basedOnVersion`（実Cloud Run revisionから付くr番号）をそのまま対応に使います。投稿本文と作者・得票は `GET /api/feedback` の公開項目から取得でき、保存鍵/owner hashは移しません。採用前に履歴の「反映済み」へ入れません。

実際に改修・公開できた時だけ、`public/history/generations.json` の `proposals[]` へ同じidと本文を追加します。本文は `originalText`、`originalWording: "ゲーム内の投稿"` とし、要約は別の `text` に置きます。直前の実版の `feedbackUntilNextVersionIds` と、反映された実版の `inputProposalIds` がそのidを参照し、反映版の `examples[].proposalId` にも同じid、`idea` に要約、`change` に実際に変わったことを書きます。`basedOnVersion` は意見が書かれた版として保持し、改修版へ書き換えません。

版のid/playUrl/対応する画面と、公開された公式commitの証拠を揃えてから取り込みます。公開番号の飛びを新しい章番号で埋めません。新しい試合の投稿は動的な掲示板に残り、静的履歴には確認済みの実例だけを置きます。AIの自動実装・本番再配備をつなぐ仕組みは追加していません。

意見の `basedOnVersion` がまだ保存版一覧にない場合は、その実版のランタイムと画面を先に回収して版の記録を追加します。既存の最終r44などへ便宜的に付け替えません。ライブ掲示板の採用状態を変えるのは、実際の改修と公開を確認した後の作業です。今回、未実装の案や確認用の文を反映済みにしていません。

仮の章はJSONに保持しますが、`groupingStatus: "draft"` の間、通常の選択欄は39の実版のみです。`?generation=g01` のように直接開いた場合だけ「仮のまとまり（確認用）」としてレビューでき、確定した章として一般の選択へ並べません。


### 結果の保存が一時的に遅れた場合

試合終了時の確定順位・当時のブラウザー対応・版・終了時刻を保持し、結果画面から再戦へ進んでも既存pumpで5秒ごとに保存を再試行します。保持は直近4試合、待機表示は最大64ブラウザーで、ゲームの進行は待ちません。保存中は前の試合の投稿・投票権を表示・使用せず、短い保存待ちを返します。roundとownerの既存冪等性で重複発行を防ぎ、権利は保存時刻ではなく試合終了時刻で並べるため、遅れた古い結果が新しい権利を上書きしません。

`node --test server/feedback.test.js` の6件が成功。正式なWS joinと実際の8秒の結果時間を使い、保存境界だけを9.3秒以上故意に失敗させた局面で、再戦後に勝者/投票者各1件へ復旧、HTTP/WSとも保存中の案内、重複なし・遅い旧結果の非上書きを確認しました。実GCS障害を発生させた検査ではありません。保持中のプロセスが終了した場合や4試合を越える長期障害は保証せず、永続化済みの案・票は従来どおりGCSへ残ります。