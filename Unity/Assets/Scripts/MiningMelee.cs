using UnityEngine;

public partial class OrbitGame
{
    private int meleeAttackId;
    private float meleeAttackTime, meleeConfirmedUntil, meleeMissUntil, meleeFeedbackUntil, meleeGuardedUntil;
    private float meleeCriticalUntil, meleeVictimAt = -10;
    private Vector3 meleeAim;
    private float meleeCoverDistance;
    private Walker meleeTarget, meleeFarTarget;
    private bool HasMeleeFocus => meleeTarget != null || meleeFarTarget != null;
    private float LocalEyeHeight => sneakHeld ? 1.54f : 1.62f;
    private readonly System.Collections.Generic.List<BodyHitTint> bodyHitTints = new System.Collections.Generic.List<BodyHitTint>();
    private MaterialPropertyBlock bodyHitProperties;
    private static readonly int BodyColorId = Shader.PropertyToID("_Color");

    private class BodyHitTint
    {
        public Walker Target;
        public float Until;
        public readonly System.Collections.Generic.List<BodyHitPart> Parts = new System.Collections.Generic.List<BodyHitPart>();
    }

    private struct BodyHitPart
    {
        public MeshRenderer Renderer;
        public MaterialPropertyBlock Original;
    }

    private float MeleeBoostRemaining => Mathf.Max(0, (self?.meleeBoostUntil ?? 0) - (remoteServerTime + Mathf.Max(0, Time.unscaledTime - remoteReceivedAt)));
    private float MeleeSpeedMultiplier => MeleeBoostRemaining > 0 ? valley.combat.speedMultiplier : 1;

    private void DrawMeleeBoost(float w, float h)
    {
        float remaining = MeleeBoostRemaining;
        if (remaining <= 0) return;
        var tint = HudMuted; tint.a *= Mathf.Min(1, remaining / .25f);
        HudFieldLabel(w / 2 + 110 * HotbarUnit, HotbarTop(h) + 17 * HotbarUnit, "加速", hudSmall, tint, 60);
    }

    private void ResetMeleeInput()
    {
        foreach (var tint in bodyHitTints) RestoreBodyHitTint(tint);
        bodyHitTints.Clear();
        meleeAttackId = 0; meleeAttackTime = 0; meleeAim = Vector3.zero;
        remoteViewedTime = state?.serverTime ?? 0;
        meleeMissUntil = meleeConfirmedUntil = meleeFeedbackUntil = meleeGuardedUntil = strikePulseUntil = 0;
        meleeTarget = meleeFarTarget = null; swingStarted = miningSwingStarted = -10; swingSent = true;
        meleeCriticalUntil = 0; meleeVictimAt = -10;
    }

    private bool QueueMeleePress(Vector3 aim)
    {
        // The click's aim is sent immediately and retained through subsequent look/release packets.
        // Holding the button repeats mining, while entity attacks require another press (Java 1.8.9).
        // Update already selected the frontmost targets using this frame's
        // post-movement eyes and aim. Reuse that same selection for the press.
        bool mining = !crossbowEquipped && (targetVein != null && targetDistance <= valley.mining.range || SceneryMiningInRange());
        if (Time.unscaledTime < meleeMissUntil && meleeTarget == null && !mining) return false;
        if (meleeTarget != null || mining) meleeMissUntil = 0;
        meleeAttackId++;
        var viewed = meleeTarget ?? meleeFarTarget;
        meleeAttackTime = viewed != null ? viewed.renderTime : remoteViewedTime;
        meleeAim = aim;
        if (meleeTarget == null && !mining && meleeCoverDistance >= 3)
            meleeMissUntil = Time.unscaledTime + .5f;
        return true;
    }

    private void PressPickStrike(Vector3 aim)
    {
        if (!QueueMeleePress(aim)) return;
        BeginSwing(true);
        // The queued click already owns its eye/ray; the animation cannot add
        // a delayed mining hit at whatever happens to be under the later gaze.
        swingSent = true; strikePulseUntil = 0;
        if (!crossbowEquipped && (SceneryMiningInRange() || targetVein != null && targetDistance <= valley.mining.range))
            miningSwingStarted = Time.unscaledTime;
        nextSend = 0;
    }

    private float RayPlayerBox(Vector3 eye, Vector3 ray, Vector3 feet)
    {
        float enter = 0, exit = float.PositiveInfinity;
        float half = valley.combat.halfWidth + .1f;
        Vector3 low = feet + new Vector3(-half, -.1f, -half);
        Vector3 high = feet + new Vector3(half, 1.9f, half);
        for (int axis = 0; axis < 3; axis++)
        {
            if (Mathf.Abs(ray[axis]) < .000001f)
            {
                if (eye[axis] < low[axis] || eye[axis] > high[axis]) return float.PositiveInfinity;
                continue;
            }
            float a = (low[axis] - eye[axis]) / ray[axis], b = (high[axis] - eye[axis]) / ray[axis];
            enter = Mathf.Max(enter, Mathf.Min(a, b)); exit = Mathf.Min(exit, Mathf.Max(a, b));
        }
        return enter <= exit ? enter : float.PositiveInfinity;
    }

    private void FindMeleeTarget(Vector3 eye, Vector3 aim)
    {
        meleeTarget = meleeFarTarget = null;
        if (state == null) return;
        float limit = SightDistance(eye, aim, 4.5f);
        foreach (var vein in veins.Values)
            limit = Mathf.Min(limit, RayCylinder(eye, aim, vein.Root.position, vein.Radius, vein.Height));
        meleeCoverDistance = limit;
        Walker nearest = null;
        foreach (var pair in walkers)
        {
            if (pair.Key == localId || pair.Value.data == null) continue;
            float hit = RayPlayerBox(eye, aim, pair.Value.root.position);
            if (hit >= limit) continue;
            limit = hit;
            nearest = pair.Value;
        }
        if (limit <= 3.000001f) meleeTarget = nearest;
        else meleeFarTarget = nearest;
    }

    private void ApplyMeleeFeedback(OrbitEvent item)
    {
        if (item.type != "hit" && item.type != "protected" && item.type != "guarded") return;
        bool own = item.actorId == localId, victim = item.targetId == localId;
        if (item.type == "guarded")
        {
            if (own)
            {
                meleeGuardedUntil = Time.unscaledTime + .13f;
                if (Time.time >= feedbackUntil && Time.time >= decisionFeedbackUntil)
                    ShowFeedback(item.meleeReason == "late" ? "通信が遅れて攻撃できなかった" : "相手は被弾直後", HudMuted);
            }
            return;
        }
        if (own || victim) meleeFeedbackUntil = Time.unscaledTime + 1.8f;
        if (item.type == "protected")
        {
            if (own)
            {
                meleeGuardedUntil = Time.unscaledTime + .13f;
                bool alreadyGuided = meleeTarget != null && (meleeTarget.data.@protected || self.@protected);
                if (!alreadyGuided) ShowFeedback("売店では攻撃できない", HudMuted);
            }
            return;
        }
        BeginBodyHitTint(item.targetId);
        if (own)
        {
            hitAt = Time.unscaledTime;
            meleeConfirmedUntil = Time.unscaledTime + .18f;
            bool critical = item.critical || item.kind == "critical";
            if (critical) meleeCriticalUntil = meleeConfirmedUntil;
            PlayStrike(hurtSound, cam.transform.position, true, .56f, critical ? 1.18f : item.kind == "sprint" ? .92f : 1);
            string reason = MeleeBlockText(item.meleeReason);
            if (!string.IsNullOrEmpty(reason) && Time.time >= decisionFeedbackUntil)
                ShowFeedback("押し返した · " + reason, HudGold);
        }
        if (victim)
        {
            BeginLocalHitReaction();
            ShowFeedback(QuarryEventName(item.actorId) + "に叩かれた", new Color(1, .61f, .39f));
            audioSource.PlayOneShot(hurtSound, .72f);
        }
    }

    private static string MeleeBlockText(string reason)
    {
        switch (reason)
        {
            case "empty": return "相手の袋は空";
            case "full": return "自分の袋がいっぱい";
            default: return "";
        }
    }

    private bool DrawMeleeGuidance(float x, float y)
    {
        if (meleeTarget == null)
        {
            if (meleeFarTarget == null) return false;
            HudFieldRight(MeleeLabelEdge(meleeFarTarget, x), y + 39, "もう少し近づく", hudSmall, HudMuted);
            return true;
        }
        var other = meleeTarget.data;
        bool safe = other.@protected || self.@protected;
        float serverNow = state.serverTime + Mathf.Clamp(Time.unscaledTime - remoteReceivedAt, 0, .15f);
        float hurtRemaining = Mathf.Max(0, other.hurtUntil - serverNow);
        bool recentlyHit = hurtRemaining > 0;
        string reason = other.inventoryCount <= 0 ? "empty"
            : self.inventoryCount >= PlayerBagCapacity ? "full" : "";
        bool recovery = IsRecentThief(other.id);
        string strike = string.IsNullOrEmpty(reason) ? "1個奪う" : "押し返す";
        string action = safe ? "売店では攻撃できない"
            : QuarrySwingPrompt(recentlyHit ? "攻撃" : strike);
        float edge = MeleeLabelEdge(meleeTarget, x);
        // At close range the head can leave the screen. Keep identity in the
        // existing interaction block rather than adding an off-screen marker.
        if (!TryNameplatePosition(meleeTarget, out _))
            HudFieldRight(edge, y + 15, QuarryPlayerLabel(other), hudSmall, recovery ? HudGold : HudInk);
        HudFieldRight(edge, y + 39, action, hudBody, safe ? HudMuted : HudInk);
        string explanation = recentlyHit ? "被弾直後"
            : string.IsNullOrEmpty(reason) && recovery ? "奪った相手" : MeleeBlockText(reason);
        bool reasonInReceipt = Time.time < feedbackUntil && (feedback == "押し返した · " + explanation || feedback == explanation);
        if (!safe && !string.IsNullOrEmpty(explanation) && !reasonInReceipt)
            HudFieldRight(edge, y + 65, explanation, hudSmall, HudMuted);
        return true;
    }

    private bool TryNameplatePosition(Walker person, out Vector3 point)
    {
        point = Vector3.zero;
        if (person?.data == null || !person.root || (predicted - person.root.position).sqrMagnitude > 21 * 21) return false;
        Vector3 position = person.root.position;
        point = cam.WorldToViewportPoint(position + Vector3.up * 2.04f);
        // Text is drawn down from its anchor. Reserve its full line plus a
        // screen-space gap, even when the distant body is only a few pixels tall.
        float scale = Mathf.Min(Screen.width / 1000f, Screen.height / 680f);
        point.y += (hudSmall.fontSize + 15) * scale / Screen.height;
        if (person.data.weapon == "bow")
            point.y = Mathf.Max(point.y, cam.WorldToViewportPoint(position + Vector3.up * 2.45f).y);
        return point.z > 0 && point.x >= .06f && point.x <= .94f && point.y >= .11f && point.y <= .96f
            && CanSeeNameplate(position + Vector3.up * 1.68f);
    }

    private float MeleeLabelEdge(Walker target, float center)
    {
        // Keep the target's coat, hands and delivery stamp clear of interaction text.
        Vector3 left = cam.WorldToScreenPoint(target.root.position + Vector3.up - cam.transform.right * .5f);
        float guiScale = Mathf.Min(Screen.width / 1000f, Screen.height / 680f);
        return Mathf.Clamp(left.x / guiScale - 14, 250, center - 70);
    }

    private void BeginBodyHitTint(string targetId)
    {
        if (targetId == localId || !walkers.TryGetValue(targetId, out var target)) return;
        float until = Time.unscaledTime + HurtTintDuration(target.data);
        foreach (var active in bodyHitTints)
            if (active.Target == target) { active.Until = until; return; }
        if (bodyHitProperties == null) bodyHitProperties = new MaterialPropertyBlock();
        var tint = new BodyHitTint { Target = target, Until = until };
        foreach (var renderer in target.root.GetComponentsInChildren<MeshRenderer>(true))
        {
            var material = renderer.sharedMaterial;
            // Tint existing skin/clothing only, leaving the pick and ore equipment readable.
            if (material != skin && material != jacket && material != trousers && material != glove &&
                material != cuff && material != hat && material != scarf && material != pack) continue;
            var original = new MaterialPropertyBlock();
            renderer.GetPropertyBlock(original);
            tint.Parts.Add(new BodyHitPart { Renderer = renderer, Original = original });
            renderer.GetPropertyBlock(bodyHitProperties);
            Color baseColor = original.GetColor(BodyColorId);
            if (baseColor.a <= 0) baseColor = material.color;
            bodyHitProperties.SetColor(BodyColorId, Color.Lerp(baseColor, new Color(1, .10f, .08f), .68f));
            renderer.SetPropertyBlock(bodyHitProperties);
        }
        bodyHitTints.Add(tint);
    }

    private float HurtTintDuration(OrbitPlayer player)
    {
        float now = state.serverTime + Mathf.Clamp(Time.unscaledTime - remoteReceivedAt, 0, .15f);
        return Mathf.Clamp((player?.hurtUntil ?? now + .5f) - now, .05f, .5f);
    }

    private void BeginLocalHitReaction() => meleeVictimAt = Time.unscaledTime;

    private float MeleeHandFlinch
    {
        get
        {
            float t = (Time.unscaledTime - meleeVictimAt) / .22f;
            return t >= 0 && t < 1 ? Mathf.Sin(t * Mathf.PI) * (1 - t) : 0;
        }
    }

    private void UpdateMeleeHitTint()
    {
        for (int i = bodyHitTints.Count - 1; i >= 0; i--)
        {
            var tint = bodyHitTints[i];
            if (tint.Target.root && Time.unscaledTime < tint.Until) continue;
            RestoreBodyHitTint(tint);
            bodyHitTints.RemoveAt(i);
        }
    }

    private static void RestoreBodyHitTint(BodyHitTint tint)
    {
        foreach (var part in tint.Parts)
            if (part.Renderer) part.Renderer.SetPropertyBlock(part.Original);
    }

    private void DrawMeleeCrosshair(float x, float y)
    {
        bool confirmed = Time.unscaledTime < meleeConfirmedUntil;
        bool guarded = Time.unscaledTime < meleeGuardedUntil;
        if (!confirmed && !guarded && meleeTarget == null) return;
        bool safe = meleeTarget != null && (meleeTarget.data.@protected || self.@protected);
        float serverNow = state.serverTime + Mathf.Clamp(Time.unscaledTime - remoteReceivedAt, 0, .15f);
        bool recovering = meleeTarget != null && meleeTarget.data.hurtUntil > serverNow;
        Color tint = confirmed ? HudGold : guarded || safe || recovering ? HudMuted : HudInk;
        float offset = confirmed ? 5 : guarded ? 3 : 7;
        foreach (var sign in new[] { -1f, 1f })
        {
            DrawTint(new Rect(x + sign * offset - 1, y - 1, 2, 2), tint);
            DrawTint(new Rect(x - 1, y + sign * offset - 1, 2, 2), tint);
        }
        if (confirmed && Time.unscaledTime < meleeCriticalUntil)
            foreach (float sx in new[] { -1f, 1f })
                foreach (float sy in new[] { -1f, 1f })
                    DrawTint(new Rect(x + sx * 9 - 1, y + sy * 9 - 1, 2, 2), HudGold);
    }
}
