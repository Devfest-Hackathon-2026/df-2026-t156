# Unityプロジェクト

Unity 2022.3.22f1、Built-in Render Pipeline、WebGL Build Supportを使用します。`Assets/Scenes/Orbit.unity` の `OrbitClient` が入口で、Play時にC#から谷・人物・鉱脈・売店を生成します。実ゲームの配置・硬さ・価格は `Assets/Resources/valley.json`、大岩の表面形状は `Assets/Resources/SceneryRock.json` が正本です。

1. Unity Hubからこの `Unity/` ディレクトリを開きます。
2. Package Managerの復元を待ちます。正規UnitySkillsはv2.8.3を固定しています。パッケージ本体や個別Editorのregistryは収録しません。
3. `Assets/Scenes/Orbit.unity` をPlay。Editorではローカルサーバー18087へ接続します。Game表示はScale=1xを推奨します。
4. WebGLのバッチビルドは、このプロジェクトのEditorを閉じて `./Unity/Build-Web.ps1`。任意のUnity実行ファイルは `-EditorPath`、別ドライブのcacheは任意の `-WorkRoot` で指定できます。既存Libraryを移動・削除しません。出力はルート `build-web/`。

開いている同一Editorの正規UnitySkills `build_player` からビルドする場合は、WebGL、Scene `Assets/Scenes/Orbit.unity`、プロジェクト内 `Builds/build-web` を指定し、完了後に生成物をルート `build-web/` へコピーします。ローカルRESTのport/instanceId/projectを必ず照合し、別プロジェクトには操作しません。Library/Temp/Builds/Logsは再生成物です。

素材の出典とライセンスは各Resources下のLICENSES.md、およびNoto Sans JP/題字のOFLを参照してください。Unity自体は各自の正規インストールが必要です。

改善案の入口は入坑前と精算画面です。実行時の履歴リンクは同originの /history/ を開きます。WebGLの自由記述は日本語IMEに対応するブラウザーtextareaを使用し、開いている間はゲーム入力を止めます。EditorはGUI.TextAreaとPlayerPrefsを使います。UnitySkillsで本プロジェクトを照合し、コンパイル・WebGL実ビルド・Play反映を行っています。
