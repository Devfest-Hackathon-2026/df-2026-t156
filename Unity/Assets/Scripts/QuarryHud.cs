using UnityEngine;

public partial class OrbitGame
{
    // Field equipment, not a dashboard: mineral specimens, a cloth bag and a
    // pale weigh ticket each have their own silhouette and information role.
    private static readonly Color QuarryDeep = new Color(.086f, .239f, .259f);
    private static readonly Color QuarryPaper = new Color(.965f, .933f, .859f);
    private static readonly Color QuarryPaperMuted = new Color(.30f, .43f, .42f);
    private Texture2D quarryIcons, quarryReceipt;
    private GUIStyle hudAction, hudClock, hudSale;
    private int balanceRound = -1;
    private float lastBalance, balanceChangedAt = -10, balanceDelta;
    private int bagRound = -1, previousBagCount, bagAdded;
    private float bagChangedAt = -10;
    private string recentThiefId, recentStolenKind;
    private int recentTheftRound = -1;
    private float recentTheftUntil;

    // IMGUI applies the project's linear-to-display conversion to vertex tint.
    // Keep authored UI colours in display sRGB; textures retain their own import setting.
    private static Color GuiTint(Color color)
        => QualitySettings.activeColorSpace == ColorSpace.Linear ? color.linear : color;

    private void HudRounded(Rect rect, Color color, float radius = 12)
    {
        GUI.DrawTexture(rect, Texture2D.whiteTexture, ScaleMode.StretchToFill, true, 0, GuiTint(color), 0, radius);
    }

    private void HudPaper(Rect rect)
    {
        HudRounded(new Rect(rect.x, rect.y + 3, rect.width, rect.height), new Color(.015f, .07f, .07f, .22f), 14);
        HudRounded(rect, QuarryPaper, 14);
    }

    private void HudReceipt(Rect rect)
    {
        if (!quarryReceipt) quarryReceipt = Resources.Load<Texture2D>("QuarryReceipt");
        if (!quarryReceipt) { HudPaper(rect); return; }
        GUI.color = GuiTint(new Color(.01f, .04f, .04f, .27f));
        GUI.DrawTexture(new Rect(rect.x, rect.y + 4, rect.width, rect.height), quarryReceipt);
        GUI.color = GuiTint(QuarryPaper);
        GUI.DrawTexture(rect, quarryReceipt);
        GUI.color = Color.white;
    }

    private void HudFieldLabel(float x, float y, string text, GUIStyle style, Color tint, float width = 400)
    {
        // Keep a real display-pixel outline when the logical HUD is scaled down.
        // A bottom-only shadow disappears against the bright sky at small sizes.
        float scale = Mathf.Min(Screen.width / 1000f, Screen.height / 680f);
        float edge = 1.15f / scale;
        Color shadow = new Color(.005f, .018f, .015f, .96f * tint.a);
        HudLabel(x - edge, y, text, style, shadow, width);
        HudLabel(x + edge, y, text, style, shadow, width);
        HudLabel(x, y - edge, text, style, shadow, width);
        HudLabel(x, y + edge, text, style, shadow, width);
        HudLabel(x + edge * .6f, y + edge * 1.6f, text, style, shadow, width);
        HudLabel(x, y, text, style, tint, width);
    }

    private void HudFieldCentered(float x, float y, string text, GUIStyle style, Color tint)
    {
        float width = style.CalcSize(new GUIContent(text)).x + 2;
        HudFieldLabel(x - width / 2, y, text, style, tint, width);
    }

    private void HudFieldRight(float right, float y, string text, GUIStyle style, Color tint)
    {
        float width = style.CalcSize(new GUIContent(text)).x + 2;
        HudFieldLabel(right - width, y, text, style, tint, width);
    }



    private string QuarryEventName(string id)
    {
        var player = state?.players == null ? null : System.Array.Find(state.players, person => person.id == id);
        return string.IsNullOrEmpty(player?.name) ? "相手" : player.name;
    }

    private string QuarryTransferText(OrbitEvent item, bool victim)
    {
        string other = QuarryEventName(victim ? item.actorId : item.targetId);
        if (victim)
        {
            recentThiefId = item.actorId;
            recentStolenKind = item.kind;
            recentTheftRound = state.round;
            recentTheftUntil = Time.unscaledTime + 8;
            return other + "に" + OreName(item.kind) + "を1個奪われた";
        }
        bool recovered = IsRecentThief(item.targetId) && item.kind == recentStolenKind;
        if (recovered) recentThiefId = "";
        return other + "から" + OreName(item.kind) + "を1個" + (recovered ? "取り返した" : "奪った");
    }

    private bool IsRecentThief(string id)
        => recentTheftRound == state?.round && Time.unscaledTime < recentTheftUntil && id == recentThiefId;

    private string QuarryPlayerLabel(OrbitPlayer player)
    {
        string name = string.IsNullOrEmpty(player.name) ? "採掘者" : player.name;
        // Preserve the server's distinguishing suffix on long duplicate names.
        if (name.Length > 12) name = name.Substring(0, 8) + "…" + name.Substring(name.Length - 3);
        bool focusedPlayer = meleeTarget?.data.id == player.id || meleeFarTarget?.data.id == player.id ||
            IsRecentThief(player.id) || crossbowEquipped;
        bool nearby = (predicted - new Vector3(player.x, player.y, player.z)).sqrMagnitude < 64;
        return name + (focusedPlayer || nearby ? player.inventoryCount > 0 ? "  袋 " + player.inventoryCount : "  空袋" : "");
    }

    private string QuarrySwingPrompt(string action)
    {
        if (!focused) return "クリックで操作に戻る";
        if (surveyResumeBlock) return "左クリックを離す";
        return (locked ? hasHarvestedOre ? "" : "クリック / F　" : "F　") + action;
    }

    private void HudKey(float x, float y, string key, bool primary = false)
    {
        Color face = primary ? HudGold : new Color(.91f, .93f, .85f);
        float width = Mathf.Max(28, hudSmall.CalcSize(new GUIContent(key)).x + 14);
        HudRounded(new Rect(x, y + 3, width, 28), new Color(.02f, .10f, .11f, .55f), 6);
        HudRounded(new Rect(x, y, width, 27), face, 6);
        GUI.color = GuiTint(QuarryDeep);
        GUI.Label(new Rect(x, y + 3, width, 23), key, hudName);
        GUI.color = Color.white;
    }

    private void HudIcon(Rect rect, string icon, Color tint)
    {
        if (icon == "diamond") { DrawDiamondIcon(rect, tint); return; }
        if (!quarryIcons) quarryIcons = Resources.Load<Texture2D>("QuarryHudIcons");
        if (!quarryIcons) return;
        int index;
        switch (icon)
        {
            case "copper": index = 0; break;
            case "silver": index = 1; break;
            case "crystal": index = 2; break;
            case "diamond": index = 2; if (tint == Color.white) tint = new Color(.68f, 1, 1); break;
            case "ruby":
                index = 2;
                if (tint == Color.white) tint = new Color(1, .35f, .26f);
                break;
            case "gold": index = 3; break;
            case "bag": index = 4; break;
            case "pick": index = 5; break;
            case "shop": index = 6; break;
            default: index = 7; break;
        }
        GUI.color = GuiTint(tint);
        GUI.DrawTextureWithTexCoords(rect, quarryIcons, new Rect(index / 8f, 0, 1 / 8f, 1));
        GUI.color = Color.white;
    }

    private void HudLine(Vector2 a, Vector2 b, Color color, float width = 1)
    {
        Matrix4x4 saved = GUI.matrix;
        GUI.matrix = saved * Matrix4x4.Translate(a) *
            Matrix4x4.Rotate(Quaternion.Euler(0, 0, Mathf.Atan2(b.y - a.y, b.x - a.x) * Mathf.Rad2Deg)) * Matrix4x4.Translate(-a);
        DrawTint(new Rect(a.x, a.y - width / 2, Vector2.Distance(a, b), width), color);
        GUI.matrix = saved;
    }

    private string QuarryDirection(Vector3 destination)
    {
        Vector3 relative = Quaternion.Euler(0, -yaw, 0) * (destination - predicted);
        return relative.z < -Mathf.Abs(relative.x) ? "↓" : relative.x < -Mathf.Abs(relative.z) * .6f ? "◀"
            : relative.x > Mathf.Abs(relative.z) * .6f ? "▶" : "↑";
    }

    private string QuarryStationName(OrbitStation station)
        => station.id == "west" ? "西の売店" : station.id == "east" ? "東の売店" : "中央売店";

    private void DrawJourneyMarker(float w)
    {
        if (HudActionBusy || targetVein != null) return;
        Vector3 destination;
        string label;
        bool selected = SurveyDestinationPosition(out destination, out label);
        if (!selected)
        {
            if (self.inventoryCount == 0 || state.stations == null || hasOpenedSurvey || Time.unscaledTime - bagChangedAt > 7) return;
            OrbitStation nearest = null;
            float best = float.PositiveInfinity;
            if (nearest == null) foreach (var station in state.stations)
            {
                float distance = new Vector2(station.x - predicted.x, station.z - predicted.z).sqrMagnitude;
                if (distance >= best) continue;
                nearest = station;
                best = distance;
            }
            if (nearest == null) return;
            destination = new Vector3(nearest.x, predicted.y, nearest.z);
            label = QuarryStationName(nearest);
        }
        int meters = Mathf.RoundToInt(new Vector2(destination.x - predicted.x, destination.z - predicted.z).magnitude);
        HudFieldCentered(w / 2, 65, QuarryDirection(destination) + "  " + label + "  " + meters + "m", hudSmall, HudInk);
    }

}
