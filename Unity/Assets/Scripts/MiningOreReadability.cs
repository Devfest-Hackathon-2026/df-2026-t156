using UnityEngine;

public partial class OrbitGame
{
    // Inspect one distant, visible mineral face by looking toward it. No screen
    // edge arrows, hidden HP, or labels behind terrain/other rocks are revealed.
    private string distantHudId;
    private float distantHudSince;

    private void DrawDistantOreHint(float w, float h)
    {
        if (crossbowEquipped || HasMeleeFocus || Time.unscaledTime < meleeFeedbackUntil) return;
        if (!cam || self == null || targetVein != null) return;
        Vector3 eye = cam.transform.position;
        VeinView selected = null;
        float best = .982f;
        foreach (var view in veins.Values)
        {
            var data = view.Data;
            if (data.kind == "gold" && !data.announced && (!data.active || data.hp <= 0)) continue;
            Vector3 face = view.Root.position + Vector3.up * view.Height;
            Vector3 delta = face - eye;
            float distance = delta.magnitude;
            if (distance <= 8 || distance > 40) continue;
            Vector3 direction = delta / distance;
            float alignment = Vector3.Dot(cam.transform.forward, direction);
            if (alignment <= best || SightDistance(eye, direction, distance) < distance - .12f) continue;
            bool covered = false;
            foreach (var other in veins.Values)
                if (other != view && RayCylinder(eye, direction, other.Root.position,
                    other.Radius, other.Height) < distance - .2f) { covered = true; break; }
            if (covered) continue;
            selected = view;
            best = alignment;
        }
        if (selected?.Data.id != distantHudId) { distantHudId = selected?.Data.id; distantHudSince = Time.unscaledTime; }
        if (selected == null || Time.unscaledTime - distantHudSince < .4f) return;
        Vector3 point = cam.WorldToScreenPoint(selected.Root.position + Vector3.up * (selected.Height + .35f));
        if (point.z <= 0) return;
        float x = point.x / Screen.width * w;
        float y = (1 - point.y / Screen.height) * h;
        if (y < 120 || y > h - 100) return;
        bool depleted = selected.Data.hp <= 0 && !selected.Data.announced && selected.Data.looseCount <= 0;
        if (depleted) return;
        string label = OreName(selected.Data.kind) + (selected.Data.announced ? "  まもなく出現"
            : selected.Data.looseCount > 0 ? "  残り" + selected.Data.looseCount + "個" : "");
        float labelWidth = hudSmall.CalcSize(new GUIContent(label)).x + 28;
        Rect labelArea = new Rect(x - labelWidth / 2, y, labelWidth, hudSmall.fontSize + 18);
        if (DistantOreLabelCoversPlayer(labelArea, selected.Root.position, w, h)) return;
        HudTag(x, y, label, hudSmall, depleted ? HudMuted : OreColor(selected.Data.kind));
    }

    private bool DistantOreLabelCoversPlayer(Rect labelArea, Vector3 orePosition, float w, float h)
    {
        float oreDistance = (orePosition - cam.transform.position).sqrMagnitude;
        foreach (var pair in walkers)
        {
            var person = pair.Value;
            if (pair.Key == localId || person.data == null) continue;
            Vector3 feet = person.root.position;
            if ((predicted - feet).sqrMagnitude > 21 * 21 ||
                (feet - cam.transform.position).sqrMagnitude >= oreDistance) continue;
            Vector3 head = cam.WorldToViewportPoint(feet + Vector3.up * 2.04f);
            if (head.z <= 0 || head.x < .06f || head.x > .94f || head.y < .11f || head.y > .90f) continue;
            // Match the nameplate's terrain, prop and ore occlusion checks.
            if (!CanSeeNameplate(feet + Vector3.up * 1.68f)) continue;
            Vector3 basePoint = cam.WorldToViewportPoint(feet);
            if (basePoint.z <= 0) continue;
            float bodyHeight = Mathf.Abs(basePoint.y - head.y) * h;
            float width = Mathf.Max(bodyHeight * .5f, hudSmall.CalcSize(new GUIContent(QuarryPlayerLabel(person.data))).x) + 24;
            Rect playerArea = new Rect(head.x * w - width / 2, (1 - head.y) * h - 10,
                width, Mathf.Max(bodyHeight, hudSmall.fontSize + 5) + 20);
            if (labelArea.Overlaps(playerArea)) return true;
        }
        return false;
    }
}
