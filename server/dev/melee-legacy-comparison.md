# 1.8.9の近接と公開21の比較

2026-11-08。Minecraft Java 1.8.9 survival、エンチャントなしを参照し、公開21の`6f3b273`と変更後の入力・速度処理を比較した。剣・HP・死亡は追加せず、成立した一打で鉱石1個、安全圏、採掘の待ち時間を保つ。

根拠は公式[1.8.9 client.jar](https://launcher.mojang.com/v1/objects/3870888a6c3d349d3771a3e9d16c9bf5e076b908/client.jar)（SHA1 `3870888a6c3d349d3771a3e9d16c9bf5e076b908`を再照合）。`javap -c -p`で確認し、[Forge配布SRG](https://maven.minecraftforge.net/de/oceanlabs/mcp/mcp/1.8.9/mcp-1.8.9-srg.zip)で名前を対応づけた。jar、bytecode、変換した参考コードはGitにも配布物にも含めない。

|根拠のメソッド|確認した規則|本作での扱い|
|---|---|---|
|`bfk.a(float)` / getMouseOver、`pk.ao()` / collisionBorderSize|目から3block、0.6×1.8のbodyにborder0.1、最前の遮蔽物|既存を維持。弓の矢用borderとは分離|
|`ave.aw()` / clickMouse|押下で振る。空振り連打は10tick待つ|実体への再照準を通す既存例外を維持。採掘の待ち時間とは別|
|`pr.n()` / getArmSwingAnimationEnd、`pr.bw()` / swingItem|通常6tick、一振りの半分から振り直せる|近接0.3秒、再始動0.15秒。採掘長押しの既存の振りは維持|
|`bfn.b(float,float)` / transformFirstPersonItem|sqrtを使う速い前振りと戻り|既存ピックの造形を保ち、近接は`sin(sqrt(phase)π)`で速く前へ出す|
|`pr.a(ow,float)` / attackEntityFrom|10tickの同等打拒否。強い一打は通すが期限を更新せず、baseKBを重ねない|`acceptHurt`を近接・矢で共有。HPは持たず、一打の移動量は常に1鉱石|
|`pr.a(pk,float,double,double)` / knockBack|motionを半分にし、水平0.4、Yを0.4加算し上限0.4|m/s換算で水平8、Yは`min(8, oldY/2+8)`。地上/空中とも同じ式|
|`wn.f(pk)` / attackTargetEntityWithCurrentItem|sprintは追加水平0.5/Y0.1、本人XZ×0.6、sprint解除。落下criticalは別に成立可能|追加水平10/Y2、本人減速。`kind=sprint`に`critical:true`を併記|
|`bew.m()` / onLivingUpdate|sprint key保持は次tickに再評価。W二度押しは7tick窓|再加速は移動担当が所有。打撃側は成功時の減速・解除だけを出す|

ノックバックの入力は`combatVelocity(player)`に統一。サーバーで動くNPCはdrag後の`motionVX/Y/Z`、poseを所有する人間は最新の妥当な観測速度を使う。古いimpulse値を現在の速度として再利用しない。

`node server/dev/melee-legacy-comparison.js <旧版melee.mjs>`は旧自作モジュールと現行を同じ静止/移動条件で比較する。旧モジュールは`git show 6f3b273:server/melee.js`からGit対象外へ出力した。これはコードを動かした比較で、Unity実画面の測定ではない。

|条件|公開21の式|変更後|
|---|---|---|
|静止した相手の通常打|水平8/Y8|同じ|
|server actor：観測X5、tick末X2.73|X10.5/Y8|X9.365/Y8。参照する速度の時点を修正|
|client actor：観測X5、古いmotionX100|X10.5/Y8|同じ。古いimpulseを使わない|
|sprint打撃：本人観測X5、tick末X2.73|本人X3|本人X1.638。本人にも同じ参照規則|
|X/Zが重なり真上へのray|水平0|yawから有限の向きを選ぶ。原典の微小ランダム分離は持ち込まない|
|sprint＋落下critical|強度は成立するが表示kindはsprintだけ|sprintとcriticalの両方を保持|
|160ms間隔の5クリックを実際のBeginSwingへ入力|手元の振り直し3回|5回。サーバーの被弾待ちは別に維持|

被弾色は0.22秒固定から権威の`hurtUntil`までへ合わせた。強い追加打でも0.5秒を延長しない。自分の被弾は手元の短い反応と音で伝え、カメラの自動roll/tilt、歩行時の画面揺れは入れない。照準を動かすカメラ演出、Minecraft固有のテクスチャ・効果音は採用していない。

射程・最前衝突・安全圏・古い表示時刻の拒否・150ms遅延の実WebSocket・短押し採掘を含む20対象試験とUnityスクリプトの統合コンパイルを確認。描画した手元の最終的な見え方と音の聴取は次の実WebGL確認へ分ける。


## 横移動と名札・消費ACK（2026-11-08、95cf668からの専用作業ツリー）

13mの実WebGL画像では、頭上座標を文字の上端に使うため「名前 袋3」が頭と照準へ重なっていた。文字一行＋10論理pxを頭より上へ置き、近距離でも身体・手・帽子を隠さない。名札同士が重なる時は、照準中の相手、奪った相手、近い荷持ち、距離の順で表示する。頭が画面外なら既存の操作欄へ名前を残す。被弾待ちの相手への照準は既存の待機文と同じ落ち着いた色にする。壁越しの判定や公開荷物情報は増やさない。

80〜160ms RTT（片道40/80/50/70msの順序付きjitter）の実WebSocket比較で、旧来の消費ACKを次の20Hz入力まで待つ方式では、最初の横切る相手への押下が275ms古くなりlate拒否した。Unityが適用した連番をmicrotaskで通知し、同一フレームの通常入力が運んだ場合は追加ACKを省く。変更後は同じ最初の押下が195msで受理され、216msで双方に命中が到着した。後続の単発は234msで到着。3m射程、250ms巻戻し、未消費3枚、8192byte送信境界、80件/秒、旧入力のpiggybackを維持する。

50〜80/60〜120/80〜160ms RTTのburst→単発を含む関連32件と、消費前/重複/同一frame入力/送信詰まりのACKを含むbridge8件が成功。80〜160msの40連打中には250msを実際に超えた11件の拒否が残り、これを命中扱いにしていない。遮蔽物・安全圏・古い押下の拒否も既存試験を維持した。

実Chromeの専用3600秒/NPCなしの準備局面で、通常のマウスクリック、横への狙い直し、Shift+Wの再押下を行った。相手は実WS入力で横移動する制御役で、独立した二人の人間ではない。初期位置と両者の袋を準備している。横切る相手への本人の命中と銀の奪取、制御役からの奪取、照準を外した追撃、その後横へマウスを動かした本人の命中と銅の奪取を記録した。W再入力での追撃は外れており、スプリント命中成功とは扱わない。前面変更や準備位置の再設定を含む試行は通常3分試合の成績に数えない。

実Chromeで一度、年齢250.003051msのクリックがlateになった。attackTime=65.19999694824219というUnity float32の3µsの丸め境界だった。送信snapshotと同じms精度で年齢を比較する補正を追加し、元の250msとこの実例は命中、251ms/275msはlate拒否を実コードで確認した。250msの設定値は維持している。その後の200/212/183msの押下と、捉え直した命中も別に記録した。Logs/tracking-label-13m.png、tracking-near-crossing.png、tracking-mouse-follow.png、tracking-wire*-summary.jsonが実画像・権威照合。最終独立WebGLはORBIT_WEB_BUILD_SUCCEEDED44326881/exit0。専用タブとlocalhostを終了し、本線は変更していない。
