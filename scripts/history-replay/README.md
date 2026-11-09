# 当時の版の単独再生

保存された当時のUnity WebGLと、同じ配布物のWorld・設定を使います。ゲーム処理はWorker内で動き、Nodeのファイル読込と乱数APIだけを互換処理へ接続します。現行オンラインへの接続、提案送信、投票、旧版の対人マッチングは行いません。

配布44までで回収できた39個の配布物を対象に確認しました。最初の配布1もUnity WebGLの宇宙試作です。番号30/33/35/38/42の実物は現在の一覧で未確認で、別版を代用しません。

このフォルダーは再生処理と生成元だけです。配信用の生成物とデータの正本は、制作担当の `Presentation/` にあります。`generations.json` と画像は履歴ページへ、`history-distribution/` は `/history-play/` へコピーします。履歴ページのUIとオンラインの配備は各担当が所有します。

## 生成

このフォルダーの内容を専用の出力フォルダーへ置きます。Unity Editorや本線のbuild-webを使いません。

1. `export-history.py` はWSLの既存gcloud認証で既存imageを読み、当時の `/app` だけを `history-source/rXX/` へ回収します。書込み・配備・権限変更は行いません。
2. `build-history.py` は回収した各WebGLのバイナリを改変せず、版固有のWorldモジュールと互換import、同一バイナリを共有する静的ファイルを作ります。
3. WSLの `pack-history.py` はg++で小さな分割用helperをコンパイルし、大きなdata/wasmの共通部分をcontent hashで再利用します。生成時には当時の元index.htmlを毎回使います。
4. `node serve-history.mjs` で127.0.0.1:18460へローカル表示します。`PORT` で変更できます。ゲームのためのNode依存追加は不要です。

生成物はGitへ入れません。Web配布では同じoriginからJS module・JSON・圧縮片を返し、gzip片には正しいContent-Encodingを付けます。ブラウザは選んだ版の片だけを取得・検算してBlobへ再構成します。素材は同じwindowの `historyAssetUrls` へ保存するため、履歴ページのiframe内でも親ページへ依存しません。

`verify-historical-worlds.mjs` は生成後の各Worldを40tick進めて確認します。公開44までの72個のdata/wasmは、片から再構成したSHA-256が元ファイルと一致しました。実Chromeでは39個の元WebGLの参加画面を確認。代表的な時期の通常参加とNPC状態も確認しましたが、全版の通し試合を再実施したという意味ではありません。

HTTP/WSサーバーや回線遅延は再現しません。ブラウザ内の独立したNPC対戦で、当時の操作・景観・採掘・得点ルールを試すための履歴です。
