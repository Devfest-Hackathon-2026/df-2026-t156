using UnityEngine;

public partial class OrbitGame
{
    private int PlayerBagCapacity => self?.bagCapacity > 0 ? self.bagCapacity : valley.mining.capacity;

    private int PlayerPickLevel => Mathf.Max(1, self?.pickLevel ?? 1);

    private PickType PickAt(int level)
    {
        var picks = state?.picks ?? valley.picks;
        return picks == null ? null : System.Array.Find(picks, pick => pick.level == level);
    }

    private float CurrentPickCooldown() => PickAt(PlayerPickLevel)?.hitCooldown ?? valley.mining.hitCooldown;

    private int MaxPickLevel => (state?.picks ?? valley.picks)?.Length ?? 1;

    private string PickBenefit(PickType pick)
    {
        if (pick == null) return "";
        int hardness = oreTypes.TryGetValue("crystal", out var ore) ? ore.hp : 30;
        string target = "晶の亀裂";
        if (pick.level >= 3 && oreTypes.TryGetValue("ruby", out var hardOre))
        { target = "紅晶の亀裂"; hardness = hardOre.hp; }
        if (pick.level >= 6 && state?.goldLayers != null && state.goldLayers.Length > 1)
        { target = "金の芯・亀裂"; hardness = state.goldLayers[1]; }
        return target + " " + Mathf.CeilToInt(hardness / (float)pick.weakDamage) + "打・" + pick.hitCooldown.ToString("0.00") + "秒間隔";
    }

    private int RequiredPick(OrbitDeposit deposit)
    {
        if (deposit.minLevel > 0) return deposit.minLevel;
        return oreTypes.TryGetValue(deposit.kind, out var type) ? Mathf.Max(1, type.minLevel) : 1;
    }



    private string shopHudStation, shopPreviewKind;
    private float shopPreviewUntil;
    private int shopHudPickLevel, shopHudBagLevel;

    private void DrawStationActions(float w, float h, OrbitStation current)
    {
        DrawWorkshopAction(w, h, current);
    }

    private void DrawShopOffer(float center, float y, string title, int cost)
    {
        string text = title + "   " + cost + "点";
        HudFieldCentered(center, y, text, hudSmall, HudMuted);
    }

    private Rect DrawShopHeading(float center, float y, string key, string title, string amount, bool primary, bool sale)
    {
        GUIStyle label = sale ? hudAction : hudBody;
        float titleWidth = label.CalcSize(new GUIContent(title)).x;
        float amountWidth = hudSale.CalcSize(new GUIContent(amount)).x;
        float width = 41 + titleWidth + 14 + amountWidth, x = center - width / 2;
        HudKey(x, y + 3, key, primary);
        HudFieldLabel(x + 41, y + (sale ? 6 : 8), title, label, HudInk, titleWidth + 2);
        HudFieldLabel(x + 41 + titleWidth + 14, y - 5, amount, hudSale, primary ? HudInk : HudMuted, amountWidth + 2);
        return new Rect(x, y, width, 38);
    }

    private void DrawTradeProgress(float left, float right, float y, float progress)
    {
        DrawTint(new Rect(left, y, right - left, 4), new Color(1, 1, 1, .24f));
        DrawTint(new Rect(left, y, (right - left) * Mathf.Clamp01(progress), 4), HudGold);
    }

    private void DrawStationApproach(float w, float h)
    {
        if (stationFocus != null) DrawWorkshopAction(w, h, stationFocus);
        else if (self.inventoryCount > 0 && state?.stations != null)
            foreach (var station in state.stations)
                if (Vector2.Distance(new Vector2(predicted.x, predicted.z), new Vector2(station.x, station.z)) < station.radius + 3)
                { HudFieldCentered(w / 2, h - 34, "円内で自動売却", hudSmall, HudMuted); break; }
    }

    private void DrawInvestmentStatus(float w, float h)
    {
        DrawLateEntryHint();
        if (!hasOpenedSurvey) HudFieldLabel(w - 117, h - 39, "Tab  地図", hudSmall, HudMuted, 102);
        DrawRareGuidance(w);
    }

    private string rareNoticeKey;
    private float rareNoticeUntil;

    private void DrawRareGuidance(float w)
    {
        // A ready delivery remains the useful decision even while distant gold is exposed.
        OrbitDeposit site = null;
        foreach (var view in veins.Values)
        {
            var deposit = view.Data;
            if (deposit.kind != "gold") continue;
            if (deposit.active && deposit.hp > 0) { site = deposit; break; }
            if (site == null && deposit.announced) site = deposit;
        }
        string phaseKey = site == null ? "" : site.id + ":" + site.announced + ":" + state.round;
        if (phaseKey != rareNoticeKey) { rareNoticeKey = phaseKey; rareNoticeUntil = Time.unscaledTime + 5; }
        if (site == null || Time.unscaledTime > rareNoticeUntil || HudActionBusy || Time.unscaledTime < unlockGuideUntil || SurveyDestinationPosition(out _, out _)) return;
        if (targetVein != null && targetVein.Data.id == site.id) return;
        Vector3 point = new Vector3(site.x, predicted.y, site.z);
        float left = w - 252;
        HudIcon(new Rect(left, 20, 31, 31), "gold", Color.white);
        HudFieldLabel(left + 40, 20, GoldSiteName(site.id), hudBody, HudGold, 201);
        string phase = site.announced ? "まもなく出現" : "金が出現";
        HudFieldLabel(left + 40, 45, phase + "  " + QuarryDirection(point) + " " + Mathf.RoundToInt(Vector3.Distance(point, predicted)) + "m", hudSmall, HudInk, 211);
    }

    private void UpdateClaimFeedback(OrbitState snapshot)
    {
        if (snapshot.round != claimRound)
        {
            claimResults.Clear();
            claimRound = snapshot.round;
        }
        if (snapshot.localClaims == null) return;
        foreach (var claim in snapshot.localClaims)
        {
            if (string.IsNullOrEmpty(claim.resultId) || !claimResults.Add(claim.resultId)) continue;
            if (claim.status == "received" && claim.layer > 0)
            {
                decisionFeedbackUntil = Time.time + 1.8f;
                ShowFeedback(GoldReceiptText(claim.resultAmount, claim.layer, claim.depositId), HudGold);
            }
            else if (claim.status == "other-received")
            {
                decisionFeedbackUntil = Time.time + 2.6f;
                ShowFeedback(ClaimOutcomeText(claim), HudGold);
                feedbackUntil = Time.time + 2.6f;
            }
        }
    }

    private readonly System.Collections.Generic.HashSet<string> claimResults = new System.Collections.Generic.HashSet<string>();
    private int claimRound = -1;

    private OrbitClaim ClaimFor(string depositId)
    {
        if (state.localClaims == null) return null;
        int layer = veins.TryGetValue(depositId, out var view) ? view.Data.layer : 0;
        return System.Array.Find(state.localClaims, claim => claim.depositId == depositId && claim.layer == layer);
    }

    private string GoldReceiptText(int amount, int layer, string depositId)
    {
        bool coreRemains = layer == 1 && veins.TryGetValue(depositId, out var view) && view.Data.remainingYield > 0;
        return "金鉱 +" + amount + "個" + (coreRemains ? "　芯に残り1個" : "");
    }

    private static string ClaimName(string name)
        => string.IsNullOrEmpty(name) ? "相手" : name.Length > 8 ? name.Substring(0, 8) + "…" : name;

    private string ClaimOutcomeText(OrbitClaim claim)
    {
        string oreName = veins.TryGetValue(claim.depositId, out var vein) ? OreName(vein.Data.kind) : "鉱石";
        string result = oreName + "は" + ClaimName(claim.leaderName) + "へ";
        switch (claim.resultReason)
        {
            case "precision": return result + "（亀裂で割り切った）";
            case "bag-full": return result + "（あなたの袋が満杯）";
            case "too-far": return result + "（岩から離れていた）";
            case "not-enough": return result + "（あと" + Mathf.Max(0, claim.finishRequired - claim.ownDamage) + "削れば亀裂で取れた）";
            case "not-weak": return result + "（最後は亀裂を狙う）";
            case "nearby": return result + "（近くに残った人）";
            case "contribution": return result + "（多く削った人）";
            default: return result;
        }
    }
    private string ClaimDescription(OrbitClaim claim)
    {
        switch (claim.status)
        {
            case "leading": return "このままならあなたが取れる";
            case "trailing": return claim.ownDamage >= claim.finishRequired
                ? "亀裂で割れば取れる"
                : "あと" + (claim.finishRequired - claim.ownDamage) + "削って、亀裂で割る";
            case "bag-full": return "袋がいっぱい";
            case "too-far": return "鉱石に近づく";
            case "received": return "+" + claim.resultAmount + "個";
            case "other-received": return ClaimName(claim.leaderName) + "が" + claim.resultAmount + "個取った";
            default: return "";
        }
    }
}
