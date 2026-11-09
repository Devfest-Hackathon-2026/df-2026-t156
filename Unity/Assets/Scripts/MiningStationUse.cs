using UnityEngine;

public partial class OrbitGame
{
    private bool bagEquipped, stationUseActive, primaryWasHeld, stationPressPending;
    private int stationUsePressId;
    private OrbitStation stationFocus;
    private string capturedStation;
    private float stationFocusDistance, workshopHintUntil;
    private Transform heldBag;
    private string HeldTool => bagEquipped ? "bag" : crossbowEquipped ? "bow" : "pick";

    private void FindStationUseTarget(Vector3 eye, Vector3 aim)
    {
        stationFocus = null; stationFocusDistance = 6;
        if (state?.stations == null) return;
        float cover = SightDistance(eye, aim, 6);
        foreach (var station in state.stations)
        {
            Vector3 center = new Vector3(station.anvilX, station.anvilY, station.anvilZ);
            float radius = station.anvilRadius;
            Vector3 delta = center - eye;
            float along = Vector3.Dot(delta, aim), square = radius * radius - (delta.sqrMagnitude - along * along);
            if (along < 0 || square < 0) continue;
            float hit = Mathf.Max(0, along - Mathf.Sqrt(square));
            if (hit > stationFocusDistance || hit > cover + .08f) continue;
            stationFocus = station; stationFocusDistance = hit;
        }
    }

    private void UpdateStationUse(bool allowed, bool held)
    {
        bool pressed = held && !primaryWasHeld || Input.GetMouseButtonDown(0) || Input.GetKeyDown(KeyCode.F);
        if (pressed && allowed)
        {
            stationUsePressId++; stationPressPending = true; nextSend = 0;
            capturedStation = stationFocus?.id;
            stationUseActive = stationFocus != null;
        }
        if (!held && !pressed || !allowed) { stationUseActive = false; if (primaryWasHeld && !held) nextSend = 0; }
        if (stationUseActive && stationFocus?.id != capturedStation) stationUseActive = false;
        primaryWasHeld = held;
    }

    private void DrawWorkshopAction(float w, float h, OrbitStation nearby)
    {
        if (stationFocus == null)
        {
            if (nearby != null && self.inventoryCount > 0)
                HudFieldCentered(w / 2, h - 34, "円内で自動売却", hudSmall, HudMuted);
            else if (nearby != null && Time.time < workshopHintUntil)
                HudFieldCentered(w / 2, h - 34, QuarryDirection(new Vector3(nearby.anvilX, nearby.anvilY, nearby.anvilZ)) + "  アンビルで道具を強化", hudSmall, HudMuted);
            return;
        }
        float y = h - 60;
        if (stationFocusDistance > stationFocus.useRange || self.stationId != stationFocus.id)
        { HudFieldCentered(w / 2, y, "もう少し近づく", hudSmall, HudMuted); return; }
        string title, detail;
        float progress;
        PickType next = PickAt(PlayerPickLevel + 1);
        bool available = bagEquipped ? self.bagUpgradeCapacity > 0 : next != null;
        int cost = bagEquipped ? self.bagUpgradeCost : next?.cost ?? 0;
        title = crossbowEquipped ? "アンビル" : !available ? "これ以上は強化できない"
            : bagEquipped ? "袋 " + PlayerBagCapacity + " → " + self.bagUpgradeCapacity + "枠   " + cost + "点"
            : "採掘力 " + PickAt(PlayerPickLevel).damage + " → " + next.damage + "   " + cost + "点";
        detail = crossbowEquipped ? "ピックか袋を選ぶ" : !available ? ""
            : self.score < cost ? "あと" + (cost - self.score) + "点"
            : "クリックで強化  ／  残高 " + (self.score - cost) + "点";
        progress = self.upgradeProgress;
        HudFieldCentered(w / 2, y, title, hudBody, HudInk);
        if (detail.Length > 0) HudFieldCentered(w / 2, y + 29, detail, hudSmall, HudMuted);
        if (progress > 0) DrawTradeProgress(w / 2 - 100, w / 2 + 100, y + 52, progress);
    }

    private void AnimateHeldBag()
    {
        if (!heldBag && bagEquipped)
        {
            heldBag = GearPivot(cam.transform, "Held canvas bag", new Vector3(.29f, -.25f, .70f));
            Rounded(heldBag, "Canvas body", pack, new Ring(-.14f,.12f,.075f), new Ring(-.10f,.145f,.09f), new Ring(.10f,.13f,.08f), new Ring(.15f,.095f,.065f));
            Rounded(heldBag, "Folded leather mouth", leather, new Ring(.14f,.10f,.07f), new Ring(.17f,.10f,.07f));
            Part(heldBag, "Strap buckle", new Vector3(0,.08f,-.083f), new Vector3(.042f,.055f,.014f), metal, 4);
            Rounded(heldBag, "Supporting glove", glove, new Ring(-.17f,.047f,.04f),new Ring(-.10f,.052f,.045f));
            heldBag.localScale = Vector3.one * .65f;
            foreach (var child in heldBag.GetComponentsInChildren<Transform>()) child.gameObject.layer = GearLayer;
        }
        if (heldBag) heldBag.gameObject.SetActive(started && joined && state?.phase != "finished" && bagEquipped);
    }
}
