using UnityEngine;

public partial class OrbitGame
{
    private static readonly Color FieldInk = new Color(.13f, .18f, .17f);
    private static readonly Color FieldMuted = new Color(.33f, .38f, .35f);
    private static readonly Color FieldRule = new Color(.13f, .18f, .17f, .19f);
    private static readonly Color FieldGold = new Color(.70f, .49f, .16f);
    private static readonly Color FieldWhite = new Color(.95f, .96f, .94f);
    private static readonly Color FieldQuiet = new Color(.73f, .77f, .74f);
    private GUIStyle fieldDisplay, fieldHeading, fieldSmall, fieldAction, fieldInput, fieldLink, fieldOwnName;
    private bool introControls, introViewReady, introToolVisible;
    private Vector3 introRestorePosition;
    private Quaternion introRestoreRotation;
    private float introRestoreFov;
    private Texture2D introShade, introTitle;
    private Transform introQuarryProps;

    private void InitFieldbook()
    {
        if (fieldDisplay != null) return;
        fieldDisplay = new GUIStyle(hudTitle) { fontSize = 48 };
        fieldHeading = new GUIStyle(hudNumber) { fontSize = 28 };
        fieldOwnName = new GUIStyle(hudBody) { fontStyle = FontStyle.Bold };
        fieldSmall = new GUIStyle(hudSmall) { fontSize = 14 };
        fieldAction = new GUIStyle(hudButton) { fontSize = 20 };
        fieldLink = new GUIStyle(hudSmall) { fontSize = 15 };
        fieldLink.normal.textColor = fieldLink.hover.textColor = fieldLink.focused.textColor = Color.white;
        fieldInput = new GUIStyle(hudBody) { padding = new RectOffset(12, 12, 2, 2), fontSize = 20 };
        fieldInput.normal.textColor = fieldInput.focused.textColor = GuiTint(FieldWhite);
    }

    private void BeginIntroView()
    {
        if (introViewReady || !cam) return;
        introViewReady = true;
        introRestorePosition = cam.transform.position;
        introRestoreRotation = cam.transform.rotation;
        introRestoreFov = cam.fieldOfView;
        introToolVisible = tool && tool.gameObject.activeSelf;
        if (tool) tool.gameObject.SetActive(false);
        // Preview the existing northern cart and cut at their shared world position.
        // The live network scene builds the same props after joining.
        introQuarryProps = GearPivot(transform, "Intro northern quarry", new Vector3(-10, ValleyLandscape.Height(-10, 31), 31));
        BuildOldCutProps(introQuarryProps);
        var position = new Vector3(-7.5f, ValleyLandscape.Height(-7.5f, 38.5f) + 1.8f, 38.5f);
        var target = new Vector3(-13, ValleyLandscape.Height(-13, 0) + 2.0f, 0);
        cam.transform.SetPositionAndRotation(position, Quaternion.LookRotation(target - position));
        cam.fieldOfView = 48;
    }

    private void RestoreIntroView()
    {
        if (!introViewReady) return;
        cam.transform.SetPositionAndRotation(introRestorePosition, introRestoreRotation);
        cam.fieldOfView = introRestoreFov;
        if (tool) tool.gameObject.SetActive(introToolVisible);
        if (introQuarryProps)
        {
            introQuarryProps.gameObject.SetActive(false);
            Destroy(introQuarryProps.gameObject);
            introQuarryProps = null;
        }
        introViewReady = false;
    }

    private void DrawMiningIntro(float w, float h)
    {
        InitFieldbook();
        BeginIntroView();
        if (introControls)
        {
            DrawFieldControls(w, h);
            return;
        }
        if (!introShade)
        {
            introShade = new Texture2D(64, 1, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            for (int i = 0; i < 64; i++)
                introShade.SetPixel(i, 0, new Color(0, 0, 0, .72f * (1 - Mathf.SmoothStep(0, 1, i / 63f))));
            introShade.Apply(false, true);
        }
        GUI.color = Color.white;
        GUI.DrawTexture(new Rect(0, 0, Mathf.Min(w * .62f, 690), h), introShade);
        const float x = 48;
        if (!introTitle) introTitle = Resources.Load<Texture2D>("ValleyTitle");
        if (introTitle)
        {
            var titleRect = new Rect(x - 3, 32, 355, 355f * introTitle.height / introTitle.width);
            float edge = 1.1f / Mathf.Min(Screen.width / 1000f, Screen.height / 680f);
            GUI.color = GuiTint(new Color(.015f, .025f, .02f, .56f));
            GUI.DrawTexture(new Rect(titleRect.x - edge, titleRect.y, titleRect.width, titleRect.height), introTitle);
            GUI.DrawTexture(new Rect(titleRect.x + edge, titleRect.y, titleRect.width, titleRect.height), introTitle);
            GUI.DrawTexture(new Rect(titleRect.x, titleRect.y - edge, titleRect.width, titleRect.height), introTitle);
            GUI.DrawTexture(new Rect(titleRect.x, titleRect.y + edge * 1.5f, titleRect.width, titleRect.height), introTitle);
            GUI.color = GuiTint(FieldWhite);
            GUI.DrawTexture(titleRect, introTitle);
        }
        else HudLabel(x, 54, "谷の採鉱競争", fieldDisplay, FieldWhite, 620);
        GUI.color = Color.white;
        HudLabel(x + 1, 146, "鉱石を売って稼ぐ。", hudBody, FieldWhite, 550);
        HudLabel(x + 1, 175, "3分後に残高が多い人の勝ち。", hudBody, FieldQuiet, 550);

        float y = h - 258;
        HudLabel(x, y, "名前", fieldSmall, FieldWhite, 320);
        var input = new Rect(x, y + 29, 320, 43);
        DrawTint(input, new Color(.025f, .045f, .04f, .67f));
        GUI.SetNextControlName("prospector-name");
        nameInput = GUI.TextField(input, nameInput, 12, fieldInput);
        HudLine(new Vector2(input.x, input.yMax), new Vector2(input.xMax, input.yMax),
            GUI.GetNameOfFocusedControl() == "prospector-name" ? FieldWhite : FieldQuiet,
            GUI.GetNameOfFocusedControl() == "prospector-name" ? 2 : 1);

        var enter = new Rect(x, y + 94, 320, 48);
        DrawTint(enter, enter.Contains(Event.current.mousePosition) ? Color.white : FieldWhite);
        GUI.SetNextControlName("join-valley");
        GUI.color = GuiTint(FieldInk);
        bool start = RasterButton(enter, "参加する", fieldAction);
        GUI.color = Color.white;
        if (GUI.GetNameOfFocusedControl() == "join-valley")
            HudLine(new Vector2(enter.x, enter.yMax + 5), new Vector2(enter.xMax, enter.yMax + 5), FieldWhite, 2);
        if (start)
        {
            nameInput = string.IsNullOrWhiteSpace(nameInput) ? "旅人" : nameInput.Trim();
            RestoreIntroView();
            StartGame();
        }
        if (DrawFieldLink(new Rect(x, y + 160, 120, 27), "操作方法", "intro-controls")) introControls = true;
        if (DrawFieldLink(new Rect(x, y + 194, 305, 38), "▶  プレイヤーが変えたゲームの履歴", "intro-improvements")) OpenImprovements(true);

    }

    private bool DrawFieldLink(Rect rect, string label, string name)
    {
        GUI.SetNextControlName(name);
        GUI.color = GuiTint(FieldWhite);
        bool clicked = RasterButton(rect, label, fieldLink);
        GUI.color = Color.white;
        if (rect.Contains(Event.current.mousePosition) || GUI.GetNameOfFocusedControl() == name)
            HudLine(new Vector2(rect.x, rect.yMax - 2),
                new Vector2(rect.x + fieldLink.CalcSize(new GUIContent(label)).x, rect.yMax - 2), FieldWhite);
        return clicked;
    }

    private void DrawFieldControls(float w, float h)
    {
        if (Event.current.type == EventType.KeyDown && Event.current.keyCode == KeyCode.Escape)
        {
            introControls = false;
            Event.current.Use();
            return;
        }
        DrawTint(new Rect(0, 0, w, h), new Color(.025f, .04f, .035f, .94f));
        float x = (w - 830) / 2;
        float y = (h - 529) / 2;
        HudLabel(x, y, "操作方法", fieldHeading, FieldWhite, 600);
        if (DrawFieldLink(new Rect(x + 770, y, 60, 29), "戻る", "close-controls")) introControls = false;
        HudLabel(x, y + 78, "移動", hudBody, FieldWhite, 320);
        FieldControlRow(x, y + 119, "WASD", "移動");
        FieldControlRow(x, y + 154, "Shift / Wを2回", "ダッシュ");
        FieldControlRow(x, y + 189, "Space", "ジャンプ");
        FieldControlRow(x, y + 224, "C", "忍び足");
        HudLabel(x, y + 271, "ダッシュ中にSpace長押しで、跳び続けて速く進む", fieldSmall, FieldQuiet, 365);
        float right = x + 445;
        HudLabel(right, y + 78, "採掘・弓・売店", hudBody, FieldWhite, 365);
        FieldControlRow(right, y + 119, "左クリック", "選んだ道具を使う");
        FieldControlRow(right, y + 154, "売店", "円内で自動売却");
        FieldControlRow(right, y + 189, "アンビル", "クリックで強化");
        FieldControlRow(right, y + 224, "3：袋", "アンビルをクリックで拡張");
        HudLabel(right, y + 257, "売店の円内は保護される", fieldSmall, FieldQuiet, 385);
        HudLabel(right, y + 281, "Fでも選んだ道具を使える", fieldSmall, FieldQuiet, 385);
        HudLabel(right, y + 305, "弓は長押しで引き、離すと射る", fieldSmall, FieldQuiet, 385);
        HudLine(new Vector2(x, y + 326), new Vector2(x + 830, y + 326), new Color(1, 1, 1, .12f));
        FieldControlRow(x, y + 350, "マウス・矢印", "見回す（右ドラッグも可）", 600);
        FieldControlRow(x, y + 392, "Tab / Esc", "地図 / カーソル", 600);
        FieldControlRow(x, y + 427, "1 / 2 / 3", "ピック / 弓 / 袋（ホイール・Rでも）", 760);
        DrawMouseSensitivity(x, y + 490, 385, true);
        HudLabel(x + 445, y + 490, "地図でも変更可・この端末に保存", fieldSmall, FieldQuiet, 385);
    }

    private void FieldControlRow(float x, float y, string key, string action, float width = 385)
    {
        HudLabel(x, y, key, hudBody, FieldWhite, 152);
        HudLabel(x + 165, y + 2, action, fieldSmall, FieldQuiet, width - 165);
    }
}
