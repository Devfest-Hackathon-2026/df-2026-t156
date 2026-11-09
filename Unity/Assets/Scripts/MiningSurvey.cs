using UnityEngine;

public partial class OrbitGame
{
    private Texture2D surveyTerrain;
    private Texture2D[] surveySymbols;
    private int unlockGuideRound = -1;
    private string surveyDestinationId = "";
    private int surveyDestinationRound = -1;
    private bool surveyInteraction, surveyDetails;
    private bool surveyResumeBlock;
    private float surveyLookHintUntil;
    private bool pointerLockUnavailable, pointerAcquireBlocked;
    public void PointerAcquirePressed(string button)
    {
        bowCapturePending = button == "right" && crossbowEquipped;
        pointerAcquireBlocked = !bowCapturePending && !pointerLockUnavailable;
        surveyResumeBlock = pointerAcquireBlocked;
    }
    public void PointerUnavailable(string unused)
    {
        pointerLockUnavailable = true;
        locked = false;
        if (pointerAcquireBlocked) surveyResumeBlock = false;
        pointerAcquireBlocked = false;
    }
    public void PointerGestureCancelled(string unused)
    {
        CancelBowDraw();
        pointerAcquireBlocked = false;
        strikePulseUntil = 0;
        surveyResumeBlock = true;
    }
#if UNITY_WEBGL && !UNITY_EDITOR
    [System.Runtime.InteropServices.DllImport("__Internal")] private static extern void OrbitSurveyMode(int open);
#endif

    private void UpdateSurveyInteraction(bool open)
    {
        if (open)
        {
            pointerAcquireBlocked = false;
            surveyResumeBlock = true;
            if (focused && joined && self != null && state != null && state.phase != "finished" && state.stations != null)
                for (int i = 0; i < MarketOrder.Length; i++)
                {
                    if (!Input.GetKeyDown((KeyCode)((int)KeyCode.Alpha1 + i)) &&
                        !Input.GetKeyDown((KeyCode)((int)KeyCode.Keypad1 + i))) continue;
                    var station = System.Array.Find(state.stations, item => item.id == MarketOrder[i]);
                    if (station != null) SurveyChoose(station.id);
                    break;
                }
        }
        // Map clicks must not become attacks. Keyboard holds are separately
        // paused while the map is open and can resume as soon as it closes.
        else if (!Input.GetMouseButton(0) && !BowMouseHeld)
            surveyResumeBlock = false;
        if (open == surveyInteraction) return;
        surveyInteraction = open;
        if (!open) hudLookHintUntil = surveyLookHintUntil = Time.unscaledTime + 5;
#if UNITY_WEBGL && !UNITY_EDITOR
        OrbitSurveyMode(open ? 1 : 0);
#endif
        if (open) Unlock();
    }

    private void BeginUnlockGuide(int level)
    {
        unlockGuideKind = "";
        unlockGuideUntil = 0;
        unlockGuideRound = state?.round ?? -1;
        foreach (var type in valley.ores)
        {
            if (level != 2 || type.id != "crystal") continue;
            if (harvestedKinds.Contains(type.id)) continue;
            unlockGuideKind = type.id;
            unlockGuideUntil = Time.unscaledTime + 8;
            break;
        }
    }

    private void DrawUnlockGuide(float w, float y)
    {
        if (unlockGuideRound != state.round || string.IsNullOrEmpty(unlockGuideKind)) return;
        VeinView nearest = null;
        float best = float.MaxValue;
        foreach (var view in veins.Values)
        {
            if (view.Data.kind != unlockGuideKind) continue;
            // This short introduction points to a known site, without exposing remote depletion.
            float distance = (view.Root.position - predicted).sqrMagnitude;
            if (distance >= best) continue;
            nearest = view;
            best = distance;
        }
        if (nearest == null) return;
        Vector3 offset = nearest.Root.position - predicted;
        Vector3 relative = Quaternion.Euler(0, -yaw, 0) * new Vector3(offset.x, 0, offset.z);
        string arrow = relative.z < -Mathf.Abs(relative.x) ? "↓"
            : relative.x < -Mathf.Abs(relative.z) * .6f ? "◀"
            : relative.x > Mathf.Abs(relative.z) * .6f ? "▶" : "↑";
        HudTag(w / 2, y, OreName(unlockGuideKind) + " " + arrow + " " + Mathf.RoundToInt(Mathf.Sqrt(best)) + "m", hudSmall, HudGold);
    }

    private void DrawSurvey(float w, float h)
    {
        InitFieldbook();
        EnsureSurveyTerrain();
        float size = Mathf.Min(h - 116, w - 398);
        float left = (w - size - 358) / 2;
        const float top = 66;
        DrawTint(new Rect(0, 0, w, h), new Color(.89f, .91f, .88f));
        HudLabel(left, 20, "地図", fieldHeading, FieldInk, 250);
        HudRight(left + size + 344, 27, "Tabを離して戻る", fieldSmall, FieldMuted);
        var map = new Rect(left, top, size, size);
        GUI.color = Color.white;
        GUI.DrawTexture(map, surveyTerrain);
        DrawSurveyLandmarks(map);
        DrawSceneryMapLandmarks(map);
        DrawSurveyOres(map);
        DrawSurveyStations(map);
        DrawSurveyPlayer(map);
        HudLabel(map.x + 11, map.y + 8, "北 ↑", hudSmall, FieldInk);
        HudLabel(map.x + 11, map.yMax - 27, "0", fieldSmall, FieldMuted, 16);
        HudLine(new Vector2(map.x + 29, map.yMax - 13), new Vector2(map.x + 111, map.yMax - 13), FieldInk, 2);
        HudLabel(map.x + 115, map.yMax - 27, "20m", fieldSmall, FieldMuted, 45);
        float sx = map.xMax + 34;
        const float sw = 310;
        DrawSurveyDestination(sx, top, sw);
        if (surveyDetails)
        {
            HudLabel(sx, top + 88, "鉱石", hudBody, FieldInk, sw);
            HudRight(sx + sw, top + 91, "1個の価格 / 硬さ", fieldSmall, FieldMuted);
            int i = 0;
            foreach (var type in valley.ores)
            {
                float yy = top + 127 + i++ * 28;
                HudIcon(new Rect(sx, yy, 20, 20), type.id, SurveyOreInk(type.id));
                HudLabel(sx + 30, yy, type.name, hudSmall, FieldInk, 105);
                string hardness = type.id == "gold" ? "12 / 36" : type.hp.ToString();
                HudRight(sx + sw, yy, type.value + "点 / " + hardness, hudSmall, FieldMuted);
            }
            var current = PickAt(PlayerPickLevel);
            var next = PickAt(PlayerPickLevel + 1);
            HudLabel(sx, top + 326, "ピック Lv." + PlayerPickLevel + "　採掘 " + current.damage + " / 亀裂 " + current.weakDamage, hudBody, FieldInk, sw);
            HudLabel(sx, top + 360, next != null ? "次 Lv." + next.level + "　" + next.cost + "点" : "最終強化", fieldSmall, FieldMuted, sw);
            HudLabel(sx, top + 387, PickBenefit(next ?? current), fieldSmall, FieldMuted, sw);
            HudLabel(sx, top + 427, "袋 " + PlayerBagCapacity + "枠" + (self.bagUpgradeCapacity > 0 ? " → " + self.bagUpgradeCapacity + "枠　" + self.bagUpgradeCost + "点" : "・最大"), hudBody, FieldInk, sw);
            DrawMouseSensitivity(sx, h - 32, sw, false);
        }
        else
        {
            DrawSurveyMarkets(sx, top + 88, sw);
            HudLabel(sx, top + 335, "袋 " + self.inventoryCount + "/" + PlayerBagCapacity, hudBody, FieldInk, sw);
            int i = 0;
            if (self.inventory != null) foreach (var ore in self.inventory)
            {
                if (ore.count <= 0) continue;
                float xx = sx + (i % 4) * 77, yy = top + 373 + (i++ / 4) * 30;
                HudIcon(new Rect(xx, yy, 22, 22), ore.kind, SurveyOreInk(ore.kind));
                HudLabel(xx + 26, yy, ore.count.ToString(), hudSmall, FieldInk, 43);
            }
            HudLabel(sx, top + 458, "残高", hudSmall, FieldMuted, sw);
            HudRight(sx + sw, top + 451, self.score + "点", hudNumber, FieldInk);
            int rank = PlayerRank(out float best, out bool tied);
            HudLabel(sx, top + 489, (tied ? "同率" : "") + rank + "位" + (rank > 1 ? "　首位まで " + (best - self.score) + "点" : ""), fieldSmall, FieldMuted, sw);
        }
        var details = new Rect(sx, h - 89, sw, 28);
        GUI.color = GuiTint(FieldInk);
        if (GUI.Button(details, surveyDetails ? "売店に戻る" : "道具・鉱石", hudBody)) surveyDetails = !surveyDetails;
        GUI.color = Color.white;
        HudLine(new Vector2(sx, details.yMax + 1), new Vector2(sx + 105, details.yMax + 1), FieldRule);
        HudLabel(map.x, map.yMax + 16, "円の内側で売買・保護", fieldSmall, FieldMuted, map.width);
        if (!surveyDetails) HudRight(sx + sw, h - 32, "売店を選ぶ 1・2・3", fieldSmall, FieldMuted);
    }

    private Color SurveyOreInk(string kind)
    {
        switch (kind)
        {
            case "silver": return new Color(.32f, .44f, .49f);
            case "crystal": return new Color(.46f, .30f, .59f);
            case "ruby": return new Color(.66f, .18f, .27f);
            case "diamond": return new Color(.12f, .48f, .60f);
            case "gold": return FieldGold;
            default: return new Color(.63f, .34f, .17f);
        }
    }

    private bool SurveyDestinationPosition(out Vector3 position, out string label)
    {
        position = Vector3.zero;
        label = "";
        if (state == null || surveyDestinationRound != state.round || string.IsNullOrEmpty(surveyDestinationId)) return false;
        var station = state.stations == null ? null : System.Array.Find(state.stations, s => s.id == surveyDestinationId);
        if (station != null)
        {
            position = new Vector3(station.x, 0, station.z);
            label = station.name;
            return true;
        }
        var deposit = System.Array.Find(valley.deposits, d => d.id == surveyDestinationId);
        if (deposit == null) return false;
        if (deposit.kind == "gold" && !SurveyGoldPublic(deposit.id)) return false;
        position = new Vector3(deposit.x, 0, deposit.z);
        label = deposit.kind == "gold" ? GoldSiteName(deposit.id) : OreName(deposit.kind) + "の鉱区";
        return true;
    }

    private bool SurveyGoldPublic(string id)
    {
        var site = state?.deposits == null ? null : System.Array.Find(state.deposits, d => d.id == id);
        return site != null && (site.announced || site.active);
    }

    private void SurveyChoose(string id)
    {
        surveyDestinationId = id;
        surveyDestinationRound = state.round;
    }

    private void DrawSurveyDestination(float x, float y, float width)
    {
        bool chosen = SurveyDestinationPosition(out var position, out var label);
        if (!chosen) { HudLabel(x, y + 12, "行先を選ぶ", hudBody, FieldMuted, width); return; }
        HudLabel(x, y, "行先", hudSmall, FieldMuted, width);
        HudLabel(x, y + 25, label, hudBody, FieldInk, width - 58);
        HudRight(x + width, y + 23, Mathf.RoundToInt(Vector2.Distance(new Vector2(predicted.x, predicted.z), new Vector2(position.x, position.z))) + "m", hudBody, FieldInk);
        GUI.color = GuiTint(FieldInk);
        if (GUI.Button(new Rect(x, y + 49, width, 22), "解除", fieldSmall)) surveyDestinationId = "";
        GUI.color = Color.white;
    }

    private void DrawSurveyMarkets(float x, float y, float width)
    {
        HudLabel(x, y, self.inventoryCount > 0 ? "袋の売値" : "売店", hudBody, FieldInk, width);
        int bestValue = 0;
        if (self.saleQuotes != null) foreach (var q in self.saleQuotes) bestValue = Mathf.Max(bestValue, q.value);
        for (int i = 0; i < MarketOrder.Length; i++)
        {
            var station = state.stations == null ? null : System.Array.Find(state.stations, s => s.id == MarketOrder[i]);
            if (station == null) continue;
            float yy = y + 37 + i * 61;
            var rowRect = new Rect(x - 6, yy - 2, width + 12, 55);
            bool selected = surveyDestinationRound == state.round && surveyDestinationId == station.id;
            bool hover = rowRect.Contains(Event.current.mousePosition);
            var quote = QuoteFor(station.id);
            bool best = self.inventoryCount > 0 && quote != null && quote.value == bestValue &&
                self.saleQuotes != null && System.Array.Exists(self.saleQuotes, other => other.value < bestValue);
            if (hover) DrawTint(rowRect, new Color(FieldInk.r, FieldInk.g, FieldInk.b, .055f));
            if (selected) DrawTint(new Rect(x - 7, yy - 1, 3, 53), FieldInk);
            HudLabel(x, yy, (i + 1).ToString(), hudName, FieldMuted, 24);
            var check = new Rect(x + 29, yy + 4, 14, 14);
            if (selected)
            {
                DrawTint(check, FieldInk);
                HudLine(new Vector2(check.x + 3, check.y + 7), new Vector2(check.x + 6, check.y + 10), FieldWhite, 1.5f);
                HudLine(new Vector2(check.x + 6, check.y + 10), new Vector2(check.x + 11, check.y + 4), FieldWhite, 1.5f);
            }
            else
            {
                HudLine(new Vector2(check.x, check.y), new Vector2(check.xMax, check.y), FieldMuted);
                HudLine(new Vector2(check.xMax, check.y), new Vector2(check.xMax, check.yMax), FieldMuted);
                HudLine(new Vector2(check.xMax, check.yMax), new Vector2(check.x, check.yMax), FieldMuted);
                HudLine(new Vector2(check.x, check.yMax), new Vector2(check.x, check.y), FieldMuted);
            }
            HudLabel(x + 52, yy, station.id == "west" ? "西の売店" : station.id == "east" ? "東の売店" : "中央売店",
                selected ? hudBody : hudSmall, FieldInk, 106);
            float distance = Vector2.Distance(new Vector2(station.x, station.z), new Vector2(predicted.x, predicted.z));
            HudLabel(x + 163, yy + 1, Mathf.RoundToInt(distance) + "m", fieldSmall, FieldMuted, 55);
            if (self.inventoryCount > 0) HudRight(x + width, yy - 3, (quote?.value ?? self.inventoryValue) + "点",
                best ? hudNumber : hudBody, best ? FieldGold : FieldInk);
            string price = station.hot ? "高値で買取" : "通常の買取価格";
            HudLabel(x + 52, yy + 26, price, fieldSmall, FieldMuted, width - 52);
            HudLine(new Vector2(x, yy + 57), new Vector2(x + width, yy + 57), FieldRule);
            if (GUI.Button(rowRect, "", GUIStyle.none)) SurveyChoose(station.id);
        }
    }

    private void DrawSurveyLandmarks(Rect map)
    {
        // Real fixed obstacles form the illustrated landmarks. No runtime actors are drawn.
        foreach (var obstacle in valley.colliders)
        {
            if (!obstacle.id.StartsWith("tree-")) continue;
            var p = SurveyPoint(map, obstacle.x, obstacle.z);
            HudLine(p + new Vector2(0, -6), p + new Vector2(0, 6), new Color(.31f, .43f, .36f), 1.4f);
            HudLine(p + new Vector2(-4, 1), p + new Vector2(0, -4), new Color(.31f, .43f, .36f), 1.4f);
            HudLine(p + new Vector2(4, 1), p + new Vector2(0, -4), new Color(.31f, .43f, .36f), 1.4f);
        }
        HudLabel(map.x + 20, map.y + 74, "西の斜面", fieldSmall, FieldMuted, 100);
        HudRight(map.xMax - 20, map.y + 74, "東の斜面", fieldSmall, FieldMuted);
        HudLabel(map.x + 175, map.y + 47, "北の鉱区", fieldSmall, FieldMuted, 120);
        HudLabel(map.x + 175, map.yMax - 39, "南の鉱区", fieldSmall, FieldMuted, 120);
    }

    private void EnsureSurveyTerrain()
    {
        if (surveyTerrain) return;
        const int resolution = 384;
        surveyTerrain = new Texture2D(resolution, resolution, TextureFormat.RGB24, false)
        {
            name = "Known valley survey",
            filterMode = FilterMode.Bilinear
        };
        var pixels = new Color[resolution * resolution];
        float extent = valley.boundary;
        for (int y = 0; y < resolution; y++)
        {
            for (int x = 0; x < resolution; x++)
            {
                float worldX = Mathf.Lerp(-extent, extent, x / (resolution - 1f));
                float worldZ = Mathf.Lerp(-extent, extent, y / (resolution - 1f));
                float height = ValleyLandscape.Height(worldX, worldZ);
                float shade = Mathf.Clamp01(height / 13f);
                Color color = Color.Lerp(new Color(.83f, .86f, .81f), new Color(.60f, .66f, .61f), shade);
                float slope = ValleyLandscape.Height(worldX + .8f, worldZ + .8f) - ValleyLandscape.Height(worldX - .8f, worldZ - .8f);
                color *= Mathf.Clamp(1 + slope * .055f, .82f, 1.08f);
                // One-metre contours and the same worn tracks as the landscape.
                if (Mathf.Repeat(height, 1f) < .055f)
                    color = Color.Lerp(color, new Color(.31f, .44f, .37f), .30f);
                float path = ValleyLandscape.SurveyTrailDistance(worldX, worldZ);
                if (path < 1.1f) color = Color.Lerp(color, new Color(.94f, .93f, .86f), Mathf.Clamp01((1.1f - path) * 1.8f));
                if (Mathf.Abs(worldX) > extent - .8f || Mathf.Abs(worldZ) > extent - .8f)
                    color = new Color(.31f, .44f, .37f);
                pixels[y * resolution + x] = color;
            }
        }
        foreach (var obstacle in valley.colliders)
        {
            if (obstacle.kind != "rock") continue;
            if (IsSceneryCollapsed(obstacle.id)) continue;
            float cx = (obstacle.x + extent) / (2 * extent) * (resolution - 1);
            float cy = (obstacle.z + extent) / (2 * extent) * (resolution - 1);
            float radius = Mathf.Max(1, obstacle.radius / (2 * extent) * (resolution - 1));
            int minX = Mathf.Max(0, Mathf.FloorToInt(cx - radius - 1));
            int maxX = Mathf.Min(resolution - 1, Mathf.CeilToInt(cx + radius + 1));
            int minY = Mathf.Max(0, Mathf.FloorToInt(cy - radius - 1));
            int maxY = Mathf.Min(resolution - 1, Mathf.CeilToInt(cy + radius + 1));
            for (int y = minY; y <= maxY; y++)
                for (int x = minX; x <= maxX; x++)
                {
                    float dx = x - cx, dy = y - cy;
                    float distance = Mathf.Sqrt(dx * dx + dy * dy);
                    float angle = Mathf.Atan2(dy, dx);
                    float outline = radius * (.88f + .10f * Mathf.Sin(angle * 3 + cx) + .06f * Mathf.Sin(angle * 5 + cy));
                    if (distance > outline + .5f) continue;
                    float weight = Mathf.Clamp01(outline + .5f - distance);
                    // A broken outcrop contour and sparse hatch, never a solid radar-like disk.
                    bool edge = distance > outline - .7f;
                    bool hatch = (x + y) % 7 <= 1;
                    Color rock = edge || hatch ? new Color(.33f, .43f, .37f) : new Color(.65f, .71f, .60f);
                    pixels[y * resolution + x] = Color.Lerp(pixels[y * resolution + x], rock, weight * (edge ? .65f : hatch ? .40f : .20f));
                }
        }
        surveyTerrain.SetPixels(pixels);
        surveyTerrain.Apply(false, true);
    }

    private Vector2 SurveyPoint(Rect map, float x, float z)
    {
        float diameter = valley.boundary * 2;
        return new Vector2(map.x + (x + valley.boundary) / diameter * map.width,
            map.yMax - (z + valley.boundary) / diameter * map.height);
    }

    private void DrawSurveyOres(Rect map)
    {
        foreach (var deposit in valley.deposits)
        {
            Vector2 point = SurveyPoint(map, deposit.x, deposit.z);
            if (deposit.kind != "gold")
            {
                HudIcon(new Rect(point.x - 11, point.y - 11, 22, 22), deposit.kind, new Color(.965f, .933f, .859f));
                HudIcon(new Rect(point.x - 8, point.y - 8, 16, 16), deposit.kind, SurveyOreInk(deposit.kind));
                if (GUI.Button(new Rect(point.x - 13, point.y - 13, 26, 26), "", GUIStyle.none)) SurveyChoose(deposit.id);
                DrawSurveySelection(point, deposit.id);
                continue;
            }
            // Gold locations are shown only once publicly announced or exposed.
            if (!SurveyGoldPublic(deposit.id)) continue;
            Color tint = FieldGold;
            SurveySymbol(point, 3, 22, FieldInk);
            SurveySymbol(point, 3, 18, tint);
            string name = GoldSiteName(deposit.id);
            float width = hudSmall.CalcSize(new GUIContent(name)).x;
            float labelY = deposit.z > 25 ? point.y - 30 : point.y + 12;
            HudLabel(point.x - width / 2, labelY, name, hudSmall, FieldInk, width + 1);
            if (GUI.Button(new Rect(point.x - 16, point.y - 16, 32, 32), "", GUIStyle.none)) SurveyChoose(deposit.id);
            DrawSurveySelection(point, deposit.id);
        }
    }

    private void DrawSurveySelection(Vector2 p, string id)
    {
        if (surveyDestinationRound != state.round || surveyDestinationId != id) return;
        SurveySymbol(p, 3, 32, FieldInk);
        HudLine(p + new Vector2(-23, 0), p + new Vector2(-15, 0), FieldInk, 2);
        HudLine(p + new Vector2(15, 0), p + new Vector2(23, 0), FieldInk, 2);
        HudLine(p + new Vector2(0, -23), p + new Vector2(0, -15), FieldInk, 2);
    }
    private void DrawSurveyStations(Rect map)
    {
        if (state.stations == null) return;
        foreach (var station in state.stations)
        {
            Vector2 point = SurveyPoint(map, station.x, station.z);
            float scale = map.width / (valley.boundary * 2);
            DrawSurveyTradeBoundary(point, station.radius * scale, FieldGold);
            HudIcon(new Rect(point.x - 10, point.y - 11, 20, 20), "shop", FieldInk);
            string name = station.id == "west" ? "西売店" : station.id == "east" ? "東売店" : "中央";
            HudLabel(point.x - 22, point.y + 14, name, hudSmall, FieldInk, 80);
            if (GUI.Button(new Rect(point.x - 19, point.y - 19, 38, 48), "", GUIStyle.none)) SurveyChoose(station.id);
            DrawSurveySelection(point, station.id);
        }
    }

    private void DrawSurveyTradeBoundary(Vector2 center, float radius, Color color)
    {
        for (int i = 0; i < 32; i++)
        {
            float a = i * Mathf.PI / 16, b = (i + 1) * Mathf.PI / 16;
            HudLine(center + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * radius,
                center + new Vector2(Mathf.Cos(b), Mathf.Sin(b)) * radius, color, 1);
        }
    }

    private void DrawSurveyPlayer(Rect map)
    {
        Vector2 point = SurveyPoint(map, predicted.x, predicted.z);
        Matrix4x4 previous = GUI.matrix;
        GUI.matrix = previous * Matrix4x4.Translate(point) *
            Matrix4x4.Rotate(Quaternion.Euler(0, 0, yaw)) * Matrix4x4.Translate(-point);
        SurveySymbol(point + Vector2.one, 4, 26, new Color(.965f, .933f, .859f));
        SurveySymbol(point, 4, 21, FieldInk);
        GUI.matrix = previous;
        HudLabel(Mathf.Min(point.x + 15, map.xMax - 45), Mathf.Clamp(point.y - 12, map.y, map.yMax - 22), "自分", hudSmall, FieldInk, 45);
    }

    private static int SurveyOreShape(string kind)
    {
        switch (kind)
        {
            case "silver": return 1;
            case "crystal": return 2;
            case "diamond": return 2;
            case "gold": return 3;
            default: return 0;
        }
    }

    private void SurveySymbol(Vector2 point, int shape, float size, Color tint)
    {
        EnsureSurveySymbols();
        GUI.color = GuiTint(tint);
        GUI.DrawTexture(new Rect(point.x - size / 2, point.y - size / 2, size, size), surveySymbols[shape]);
        GUI.color = Color.white;
    }

    private void EnsureSurveySymbols()
    {
        if (surveySymbols != null) return;
        const int size = 32;
        surveySymbols = new Texture2D[5];
        for (int shape = 0; shape < surveySymbols.Length; shape++)
        {
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false)
            {
                name = "Survey symbol " + shape,
                filterMode = FilterMode.Bilinear
            };
            var pixels = new Color[size * size];
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float px = (x + .5f) / size * 2 - 1;
                    float py = (y + .5f) / size * 2 - 1;
                    float radius = Mathf.Sqrt(px * px + py * py);
                    bool visible;
                    switch (shape)
                    {
                        case 1: visible = Mathf.Abs(px) + Mathf.Abs(py) < .9f; break;
                        case 2: visible = py > -.8f && Mathf.Abs(px) < (.85f - py) * .55f; break;
                        case 3: visible = radius < .9f && radius > .55f; break;
                        case 4:
                            visible = py > -.85f && Mathf.Abs(px) < (.95f - py) * .45f &&
                                (py > -.1f || Mathf.Abs(px) > -py * .36f);
                            break;
                        default: visible = radius < .8f; break;
                    }
                    pixels[y * size + x] = visible ? Color.white : Color.clear;
                }
            texture.SetPixels(pixels);
            texture.Apply(false, true);
            surveySymbols[shape] = texture;
        }
    }
}
