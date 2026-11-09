using UnityEngine;

public partial class OrbitGame
{
    private Texture2D hotbarPick, hotbarBow, hotbarBowDraw, hotbarBowFull;
    private GUIStyle hotbarKey, hotbarName, hotbarLevel;
    private float HotbarUnit => Mathf.Max(1, .8f / HudCssScale);
    private float HotbarTop(float h) => h - 90 * HotbarUnit;
    private float WeaponHudBottom(float h) => h - 94 * HotbarUnit - 28;
    private float WeaponNoticeY(float h) => Mathf.Min(h * .73f, HotbarTop(h) - 48 - 3 * HotbarUnit);
    private float WeaponFeedbackY(float h) => !string.IsNullOrEmpty(self.stationId) ? HotbarTop(h) - 30 : WeaponNoticeY(h);

    private void InitWeaponHotbar()
    {
        if (hotbarKey != null) return;
        hotbarPick = Resources.Load<Texture2D>("Hotbar/Pick");
        hotbarBow = Resources.Load<Texture2D>("Hotbar/Bow");
        hotbarBowDraw = Resources.Load<Texture2D>("Hotbar/BowDraw");
        hotbarBowFull = Resources.Load<Texture2D>("Hotbar/BowFull");
        hotbarKey = new GUIStyle(hudSmall) { fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter };
        hotbarName = new GUIStyle(hudSmall) { alignment = TextAnchor.MiddleCenter };
        hotbarLevel = new GUIStyle(hudSmall) { alignment = TextAnchor.MiddleRight };
    }

    private void HotbarQuad(Rect rect, Color color)
    {
        float scale = Mathf.Min(Screen.width / 1000f, Screen.height / 680f);
        rect = Rect.MinMaxRect(Mathf.Round(rect.xMin * scale) / scale, Mathf.Round(rect.yMin * scale) / scale,
            Mathf.Round(rect.xMax * scale) / scale, Mathf.Round(rect.yMax * scale) / scale);
        DrawTint(rect, color);
    }

    private void DrawWeaponHotbar(float w, float h)
    {
        InitWeaponHotbar();
        float u = HotbarUnit, cell = 56 * u, gap = 4 * u;
        float left = (w - cell * 3 - gap * 2) / 2, top = HotbarTop(h);
        hotbarKey.fontSize = Mathf.RoundToInt(17 * u);
        hotbarName.fontSize = Mathf.RoundToInt(14 * u);
        hotbarLevel.fontSize = Mathf.RoundToInt(12 * u);
        // One connected rail and a raised selected bezel, using our own tool art.
        HotbarQuad(new Rect(left - 3 * u, top - 3 * u, cell * 3 + gap * 2 + 6 * u, cell + 6 * u), new Color(.035f, .045f, .04f, .94f));
        for (int slot = 0; slot < 3; slot++)
        {
            bool selected = (bagEquipped ? 2 : crossbowEquipped ? 1 : 0) == slot;
            float x = left + slot * (cell + gap);
            Color rim = selected ? new Color(.94f, .94f, .87f) : new Color(.43f, .46f, .43f);
            HotbarQuad(new Rect(x, top, cell, cell), rim);
            HotbarQuad(new Rect(x + 2 * u, top + 2 * u, cell - 4 * u, cell - 4 * u), new Color(.075f, .095f, .09f, .96f));
            HotbarQuad(new Rect(x + 3 * u, top + 3 * u, cell - 6 * u, cell - 6 * u), selected ? new Color(.25f, .29f, .27f, .96f) : new Color(.15f, .18f, .17f, .95f));
            HotbarQuad(new Rect(x + 3 * u, top + 3 * u, cell - 6 * u, u), new Color(.49f, .53f, .48f, .8f));
            HotbarQuad(new Rect(x + 3 * u, top + cell - 4 * u, cell - 6 * u, u), new Color(.055f, .07f, .065f));
            Texture2D icon = slot == 2 ? null : slot == 0 ? hotbarPick : !BowDrawing ? hotbarBow : BowDrawTicks >= 20 ? hotbarBowFull : hotbarBowDraw;
            var item = new Rect(x + 7 * u, top + 6 * u, 42 * u, 42 * u);
            if (icon)
            {
                GUI.color = GuiTint(new Color(0, 0, 0, .55f));
                GUI.DrawTexture(new Rect(item.x + u, item.y + 2 * u, item.width, item.height), icon);
                GUI.color = Color.white;
                GUI.DrawTexture(item, icon);
                GUI.color = Color.white;
            }
            else if (slot == 0) HudIcon(item, "pick", HudInk);
            else if (slot == 2) HudIcon(item, "bag", HudInk);
            else DrawCrossbowGlyph(item, HudInk);
            HudFieldCentered(x + 9 * u, top + u, (slot + 1).ToString(), hotbarKey, selected ? Color.white : HudMuted);
            if (slot == 0)
                HudFieldRight(x + cell - 4 * u, top + 39 * u, "Lv." + PlayerPickLevel, hotbarLevel, HudInk);
            HudFieldCentered(x + cell / 2, top + cell + 4 * u, slot == 0 ? "ピック" : slot == 1 ? "弓" : "袋", hotbarName, selected ? HudInk : HudMuted);
        }
    }
}
