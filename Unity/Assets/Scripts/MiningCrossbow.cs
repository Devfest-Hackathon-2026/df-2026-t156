using System;
using System.Collections.Generic;
using UnityEngine;

[Serializable] public class BowType
{
    public float tickRate = 20, fullDrawTicks = 20, minDrawTicks = 3, projectileSpeed = 60;
    public float gravity = 20, dragPerTick = .99f, maxFlightSeconds = 8;
}
[Serializable] public class OrbitBolt
{
    public string id, ownerId;
    public int shotId;
    public float x, y, z, vx, vy, vz, spawnTime, expiresAt, power;
}

public partial class OrbitGame
{
    private bool crossbowEquipped;
    private bool bowDrawing, bowFromKeyboard, bowInputArmed = true, bowConsumesLeft, bowCapturePending, bowMouseWasHeld;
#if UNITY_WEBGL && !UNITY_EDITOR
    [System.Runtime.InteropServices.DllImport("__Internal")] private static extern int OrbitRightHeld();
    [System.Runtime.InteropServices.DllImport("__Internal")] private static extern int OrbitReadWheel(int enabled);
#endif
    private bool BowMouseHeld
    {
        get
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            return OrbitRightHeld() != 0 || Input.GetMouseButton(0);
#else
            return Input.GetMouseButton(1) || Input.GetMouseButton(0);
#endif
        }
    }
    private float bowDrawStarted;
    private bool BowDrawing => crossbowEquipped && bowDrawing;
    private bool BowConsumesLeft => crossbowEquipped && bowConsumesLeft;
    private float BowDrawTicks => BowDrawing ? Mathf.Min(20, Mathf.Floor((Time.unscaledTime - bowDrawStarted) * 20 + .0001f)) : 0;
    private static float BowPower(float ticks) { float t = Mathf.Clamp01(ticks / 20); return (t * t + 2 * t) / 3; }
    private int crossbowShotId;
    private float crossbowShotTime, crossbowFiredAt = -10, crossbowHitUntil, crossbowImpactUntil;
    private Vector3 crossbowShotAim;
    private AudioClip crossbowRelease, bowCreak;
    private readonly Dictionary<string, float> remoteDrawSounds = new Dictionary<string, float>();
    private readonly BowType defaultCrossbowRules = new BowType();
    private readonly Dictionary<string, BoltView> boltViews = new Dictionary<string, BoltView>();
    private readonly Dictionary<string, OrbitBolt> boltLaunches = new Dictionary<string, OrbitBolt>();
    private readonly List<BoltView> spentBolts = new List<BoltView>();
    private readonly Stack<BoltView> boltPool = new Stack<BoltView>();
    private readonly HashSet<string> activeBoltIds = new HashSet<string>();
    private readonly List<string> removeBoltIds = new List<string>();
    private readonly Dictionary<Walker, CrossbowModel> remoteCrossbows = new Dictionary<Walker, CrossbowModel>();
    private readonly List<Walker> departedCrossbows = new List<Walker>();
    private CrossbowModel heldCrossbow;
    private Transform boltPrototype, crossbowPrototype, reloadHand;
    private BowType BowRules => state?.bow ?? defaultCrossbowRules;
    private float CrossbowServerNow => remoteServerTime + Mathf.Clamp(Time.unscaledTime - remoteReceivedAt, 0, .15f);
    private bool CrossbowSafe
    {
        get
        {
            if (state?.stations == null) return self?.@protected ?? false;
            foreach (var station in state.stations)
                if ((new Vector2(predicted.x - station.x, predicted.z - station.z)).sqrMagnitude <= station.safeRadius * station.safeRadius) return true;
            return false;
        }
    }

    private sealed class BoltView
    {
        internal Transform Root, Arrow;
        internal LineRenderer Wake;
        internal readonly Vector3[] WakePoints = new Vector3[16];
        internal OrbitBolt Data;
        internal Vector3 Velocity;
        internal float Until, WakeUntil, FlightEnd;
        internal readonly MaterialPropertyBlock WakeProperties = new MaterialPropertyBlock();
        internal bool Fresh, PresentationStopped;
        internal Vector3 PresentationOffset, Tip;
        internal float ReconcileAt, ReconcileSeconds;
    }
    private sealed class CrossbowModel
    {
        internal Transform Root, Bolt, Bow, Lower;
        internal LineRenderer String;
    }

    private void ResetCrossbowRound()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        OrbitReadWheel(0);
#endif
        bagEquipped = false; stationUsePressId = 0; stationUseActive = false;
        crossbowEquipped = false; crossbowShotId = 0; crossbowShotTime = 0;
        crossbowHitUntil = crossbowImpactUntil = 0; bowDrawing = bowCapturePending = false; bowInputArmed = true; crossbowFiredAt = -10;

        ClearPredictedArrows(); remoteDrawSounds.Clear();
        boltLaunches.Clear();
        foreach (var view in boltViews.Values) PoolBolt(view);
        boltViews.Clear();
        foreach (var view in spentBolts) PoolBolt(view);
        spentBolts.Clear();
        if (heldCrossbow != null) ApplyProspectorClothes(heldCrossbow.Root, self?.name);
    }

    private void CancelBowDraw()
    {
        if (bowDrawing) nextSend = 0;
        bowDrawing = bowCapturePending = false;
        bowInputArmed = !BowMouseHeld && !Input.GetKey(KeyCode.F);
    }

    private void UpdateCrossbowSelection(bool allowed)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        int wheel = OrbitReadWheel(allowed && connected ? 1 : 0);
#else
        int wheel = allowed && connected && Mathf.Abs(Input.mouseScrollDelta.y) > .01f ? (Input.mouseScrollDelta.y > 0 ? -1 : 1) : 0;
#endif
        if (!allowed || !connected) { CancelBowDraw(); return; }
        int current = bagEquipped ? 2 : crossbowEquipped ? 1 : 0;
        int next = (current + wheel % 3 + 3) % 3;
        if (Input.GetKeyDown(KeyCode.Alpha1) || Input.GetKeyDown(KeyCode.Keypad1)) next = 0;
        if (Input.GetKeyDown(KeyCode.Alpha2) || Input.GetKeyDown(KeyCode.Keypad2)) next = 1;
        if (Input.GetKeyDown(KeyCode.Alpha3) || Input.GetKeyDown(KeyCode.Keypad3)) next = 2;
        if (Input.GetKeyDown(KeyCode.R)) next = (current + 1) % 3;
        if (next == current) return;
        CancelBowDraw(); crossbowEquipped = next == 1; bagEquipped = next == 2;
        stationUseActive = false;
        crossbowHudWasEquipped = false;
        strikePulseUntil = 0; swingSent = true; nextSend = 0;
    }

    private void UpdateCrossbowInput(bool allowed, Vector3 aim)
    {
        bool mouseHeld = BowMouseHeld;
        bool pressed = mouseHeld && !bowMouseWasHeld || Input.GetKeyDown(KeyCode.F) || bowCapturePending && (locked || pointerLockUnavailable) && mouseHeld;
        bowMouseWasHeld = mouseHeld;
        bool held = mouseHeld || Input.GetKey(KeyCode.F);
        bowConsumesLeft = bowDrawing || held;
        bool needsCapture = !locked && !pointerLockUnavailable;
        if (!allowed || !crossbowEquipped || Input.GetKeyDown(KeyCode.Escape) ||
            bowDrawing && !bowFromKeyboard && needsCapture || mouseHeld && needsCapture)
        {
            // Use this same hold after capture succeeds, or after the browser
            // explicitly declines capture and enables unlocked right-drag.
            if (bowCapturePending && allowed && crossbowEquipped && mouseHeld && !Input.GetKeyDown(KeyCode.Escape)) return;
            CancelBowDraw(); return;
        }
        if (!held)
        {
            bowCapturePending = false;
            if (bowDrawing)
            {
                float ticks = BowDrawTicks;
                bowDrawing = false; nextSend = 0;
                if (ticks >= BowRules.minDrawTicks)
                {
                    crossbowShotId++; crossbowShotTime = CrossbowServerNow; crossbowShotAim = aim;
                    crossbowFiredAt = Time.unscaledTime;
                    PredictReleasedArrow(aim, ticks);
                    PlayCrossbowRelease(cam.transform.position, true, BowPower(ticks));
                }
            }
            bowInputArmed = true;
            return;
        }
        if (pressed && bowInputArmed)
        {
            bowCapturePending = false;
            bowInputArmed = false;
            if (CrossbowSafe) { ShowFeedback("安全圏では撃てない", HudMuted); return; }
            bowDrawing = true; bowFromKeyboard = Input.GetKeyDown(KeyCode.F); bowDrawStarted = Time.unscaledTime; nextSend = 0;
        }
    }

    private void PlayCrossbowRelease(Vector3 point, bool own, float power)
    {
        if (!crossbowRelease)
        {
            const int rate = 22050;
            var samples = new float[(int)(rate * .22f)];
            var random = new System.Random(713);
            for (int i = 0; i < samples.Length; i++)
            {
                float t = i / (float)rate;
                float stringTone = Mathf.Sin(t * 1140) + .38f * Mathf.Sin(t * 2370);
                float latch = ((float)random.NextDouble() * 2 - 1) * Mathf.Exp(-t * 105);
                samples[i] = stringTone * Mathf.Exp(-t * 30) * .28f + latch * .42f;
            }
            crossbowRelease = AudioClip.Create("Quarry bowstring release", samples.Length, 1, rate, false);
            crossbowRelease.SetData(samples, 0);
        }
        PlayStrike(crossbowRelease, point, own, .50f, 1 / (UnityEngine.Random.value * .4f + 1.2f) + power * .5f);
    }

    private void PlayBowCreak(Vector3 point)
    {
        if (!bowCreak)
        {
            const int rate = 22050;
            var samples = new float[(int)(rate * .24f)];
            for (int i = 0; i < samples.Length; i++)
            {
                float t = i / (float)rate, phase = t * (340 + 700 * t);
                float grain = Mathf.Sin(phase * 6.283f) + .3f * Mathf.Sin(phase * 19.1f);
                samples[i] = grain * Mathf.Sin(t / .24f * Mathf.PI) * .18f;
            }
            bowCreak = AudioClip.Create("Bow wood under tension", samples.Length, 1, rate, false); bowCreak.SetData(samples, 0);
        }
        PlayNearbyMining(bowCreak, point, .58f, 1, 24);
    }

    private void ApplyCrossbowState(OrbitState snapshot)
    {
        if (snapshot.phase == "finished") ClearPredictedArrows();
        if (snapshot.players != null) foreach (var person in snapshot.players)
        {
            if (person.id == localId || !person.bowDrawing) continue;
            bool changed = !remoteDrawSounds.TryGetValue(person.id, out float last) || last != person.bowDrawStartedAt;
            remoteDrawSounds[person.id] = person.bowDrawStartedAt;
            if (changed && !ReferenceEquals(firstAudioSnapshot, state)) PlayBowCreak(new Vector3(person.x, person.y + 1.2f, person.z));
        }
        activeBoltIds.Clear();
        if (snapshot.bolts != null)
            foreach (var data in snapshot.bolts)
            {
                activeBoltIds.Add(data.id);
                if (!boltViews.TryGetValue(data.id, out var view))
                { view = ConfirmPredictedArrow(data) ?? TakeBolt(); boltViews.Add(data.id, view); }
                view.Data = data;
            }
        removeBoltIds.Clear();
        foreach (var pair in boltViews)
            if (!activeBoltIds.Contains(pair.Key)) removeBoltIds.Add(pair.Key);
        foreach (string id in removeBoltIds) { PoolBolt(boltViews[id]); boltViews.Remove(id); }
        removeBoltIds.Clear();
        foreach (var pair in boltLaunches)
            if (pair.Value.expiresAt < snapshot.serverTime) removeBoltIds.Add(pair.Key);
        foreach (string id in removeBoltIds) boltLaunches.Remove(id);
    }

    private void ApplyCrossbowEvent(OrbitEvent item)
    {
        if (item.weapon != "bow") return;
        bool own = item.actorId == localId, victim = item.targetId == localId;
        Vector3 point = new Vector3(item.x, item.y, item.z);
        if (item.type == "shot")
        {
            var data = new OrbitBolt { id = item.projectileId, ownerId = item.actorId, shotId = item.shotId,
                x = item.x, y = item.y, z = item.z, vx = item.vx, vy = item.vy, vz = item.vz,
                spawnTime = item.spawnTime, expiresAt = item.spawnTime + BowRules.maxFlightSeconds, power = item.power };
            boltLaunches[item.projectileId] = data;
            if (own && !boltViews.ContainsKey(item.projectileId))
            {
                var predictedView = ConfirmPredictedArrow(data);
                if (predictedView != null) { predictedView.Data = data; boltViews.Add(data.id, predictedView); }
            }
            if (ReferenceEquals(firstAudioSnapshot, state)) return;
            if (!own) PlayCrossbowRelease(point, false, item.power);
            return;
        }
        if (item.type == "shot-blocked")
        {
            if (own)
            {
                RejectPredictedArrow(item.shotId);
                if (item.shotId == crossbowShotId && !bowDrawing) crossbowFiredAt = -10;
            }
            if (own && item.reason == "safety")
            { ShowFeedback("安全圏では撃てない", HudMuted); }
            return;
        }
        if (item.type != "bolt-impact") return;
        string projectileId = item.projectileId ?? "";
        boltViews.TryGetValue(projectileId, out var bolt);
        if (bolt == null && boltLaunches.TryGetValue(projectileId, out var launch))
        { bolt = TakeBolt(); bolt.Data = launch; }
        boltLaunches.Remove(projectileId);
        if (bolt != null)
        {
            boltViews.Remove(projectileId);
            bolt.PresentationStopped = false;
            bolt.PresentationOffset = Vector3.zero;
            bolt.Tip = point;
            bolt.FlightEnd = item.impactTime > 0 ? item.impactTime : state.serverTime;
            if (bolt.Data != null) BowFlightPosition(bolt.Data, bolt.FlightEnd, out bolt.Velocity);
            bolt.Root.position = point - bolt.Velocity.normalized * .695f;
            if (bolt.Velocity.sqrMagnitude > .01f) bolt.Root.rotation = Quaternion.LookRotation(bolt.Velocity);
            bool ground = item.reason == "terrain";
            bolt.Arrow.gameObject.SetActive(ground);
            bolt.WakeUntil = ReferenceEquals(firstAudioSnapshot, state) ? Time.unscaledTime : Time.unscaledTime + .10f;
            bolt.Until = ground ? Time.unscaledTime + 2.5f : bolt.WakeUntil;
            spentBolts.Add(bolt);
        }
        if (ReferenceEquals(firstAudioSnapshot, state)) return;
        if (item.reason == "hit" || item.reason == "empty" || item.reason == "full")
        {
            BeginBodyHitTint(item.targetId);
            if (own) crossbowHitUntil = Time.unscaledTime + .22f;
            if (own || victim) meleeFeedbackUntil = Time.unscaledTime + 1.8f;
            if (victim)
            {
                BeginLocalHitReaction();
                crossbowImpactUntil = Time.unscaledTime + .18f;
                // A successful transfer already supplied the one receipt with
                // the shooter's name and the actual mineral. Do not replace it.
                if (item.reason != "hit") ShowFeedback(QuarryEventName(item.actorId) + "の矢が当たった", new Color(1, .61f, .39f));
                PlayStrike(hurtSound, point, true, .45f, 1.1f);
            }
        }
        if (own && item.reason != "hit" && item.reason != "terrain" && item.reason != "range" && Time.time >= decisionFeedbackUntil)
        {
            string reason = item.reason == "empty" ? "矢が命中・相手は空袋"
                : item.reason == "full" ? "矢が命中・自分の袋がいっぱい"
                : item.reason == "hurt" ? "相手は被弾直後"
                : item.reason == "safety" ? "安全圏で矢が止まった" : "";
            if (reason.Length > 0) ShowFeedback(reason, HudMuted);
        }
        if (item.reason == "terrain") PlayStrike(stoneSound, point, own, .18f, 1.35f);
    }

    private BoltView TakeBolt()
    {
        EnsureCrossbowModels();
        var view = boltPool.Count > 0 ? boltPool.Pop() : new BoltView();
        if (!view.Root)
        {
            view.Root = GearPivot(transform, "Flying arrow", Vector3.zero);
            view.Arrow = Instantiate(boltPrototype, view.Root, false);
            view.Arrow.gameObject.SetActive(true);
            view.Wake = CreateArrowWake(view.Root);
        }
        view.Root.gameObject.SetActive(true); view.Root.SetParent(transform, true);
        view.Arrow.gameObject.SetActive(true); view.Arrow.localScale = Vector3.one;
        SetWakeOpacity(view, 1);
        view.Wake.enabled = false; view.Wake.positionCount = 0; view.Fresh = true;
        view.PresentationStopped = false;
        view.PresentationOffset = Vector3.zero; view.ReconcileAt = view.ReconcileSeconds = 0;
        return view;
    }

    private void PoolBolt(BoltView view)
    {
        if (!view.Root) return;
        view.Wake.enabled = false; view.Wake.positionCount = 0; view.Root.gameObject.SetActive(false); view.Data = null;
        boltPool.Push(view);
    }

    private void AnimateCrossbows(float pace)
    {
        EnsureCrossbowModels();
        bool active = joined && self != null && state != null && state.phase != "finished";
        tool.gameObject.SetActive(active && !crossbowEquipped && !bagEquipped);
        heldCrossbow.Root.gameObject.SetActive(active && crossbowEquipped);
        departedCrossbows.Clear();
        foreach (var pair in remoteCrossbows)
            if (!pair.Key.root || !pair.Value.Root) departedCrossbows.Add(pair.Key);
        foreach (var person in departedCrossbows) remoteCrossbows.Remove(person);
        float draw = Mathf.Clamp01(BowDrawTicks / 20);
        float age = Time.unscaledTime - crossbowFiredAt;
        float kick = age >= 0 && age < .18f ? Mathf.Sin(age / .18f * Mathf.PI) * Mathf.Exp(-age * 10) : 0;
        float jabAge = Time.unscaledTime - swingStarted;
        float jab = jabAge >= 0 && jabAge < .28f ? Mathf.Sin(jabAge / .28f * Mathf.PI) : 0;
        heldCrossbow.Root.localPosition = new Vector3(.27f - draw * .085f, -.10f + draw * .035f - MeleeHandFlinch * .025f, .68f - kick * .07f + jab * .08f)
            + new Vector3(Mathf.Sin(footPhase * .5f) * .006f, -Mathf.Abs(Mathf.Sin(footPhase)) * .006f, 0) * pace;
        heldCrossbow.Root.localRotation = Quaternion.Euler(-kick * 4 - jab * 24, -draw * 4 - jab * 14, -8 + draw * 6 + MeleeHandFlinch * 2);
        PoseCrossbow(heldCrossbow, draw);
        if (reloadHand) reloadHand.localPosition = new Vector3(0, -.035f, Mathf.Lerp(.07f, -.30f, draw));
        foreach (var person in walkers.Values)
        {
            if (person.data == null || person.data.id == localId) continue;
            if (!remoteCrossbows.TryGetValue(person, out var model))
            {
                model = CopyCrossbow(person.body, new Vector3(.12f, .55f, .68f));
                model.Root.localScale = Vector3.one;
                remoteCrossbows.Add(person, model);
            }
            bool equipped = person.data.weapon == "bow";
            model.Root.gameObject.SetActive(equipped);
            var pick = person.rightElbow.Find("Held miner's pick");
            if (pick) pick.gameObject.SetActive(!equipped);
            if (!equipped) continue;
            float remoteDraw = person.data.bowDrawing ? Mathf.Clamp01((CrossbowServerNow - person.data.bowDrawStartedAt) * 20 / BowRules.fullDrawTicks) : 0;
            PoseCrossbow(model, remoteDraw);
            float raise = person.data.bowDrawing ? Mathf.Clamp01((CrossbowServerNow - person.data.bowDrawStartedAt) / .18f) : 0;
            model.Root.localPosition = new Vector3(.12f, Mathf.Lerp(.40f, .55f, raise), .68f);
            model.Root.localRotation = Quaternion.Euler(-person.data.bowAimPitch * Mathf.Rad2Deg, 0, -8);
        }
        foreach (var view in boltViews.Values)
        {
            var data = view.Data;
            if (data == null) continue;
            Vector3 tip = BowFlightPosition(data, CrossbowServerNow, out view.Velocity);
            if (view.ReconcileSeconds > 0)
                tip += view.PresentationOffset * (1 - Mathf.Clamp01((Time.unscaledTime - view.ReconcileAt) / view.ReconcileSeconds));
            PlaceFlyingArrow(view, tip, data.ownerId == localId);
            UpdateArrowWake(view, data, CrossbowServerNow);
            view.Fresh = false;
        }
        AnimatePredictedArrows();
        for (int i = spentBolts.Count - 1; i >= 0; i--)
        {
            var view = spentBolts[i];
            if (Time.unscaledTime >= view.Until) { PoolBolt(view); spentBolts.RemoveAt(i); continue; }
            SetArrowReadability(view);
            bool fading = Time.unscaledTime < view.WakeUntil && view.Data != null;
            if (fading)
            {
                UpdateArrowWake(view, view.Data, view.FlightEnd);
                SetWakeOpacity(view, Mathf.Clamp01((view.WakeUntil - Time.unscaledTime) / .10f));
            }
            else view.Wake.enabled = false;
        }
    }

    private void PoseRemoteCrossbows()
    {
        foreach (var person in walkers.Values)
        {
            if (person.data == null || person.data.id == localId || person.data.weapon != "bow") continue;
            float raise = person.data.bowDrawing ? Mathf.Clamp01((CrossbowServerNow - person.data.bowDrawStartedAt) / .18f) : 0;
            float pitch = person.data.bowAimPitch * Mathf.Rad2Deg;
            person.rightArm.localRotation = Quaternion.Euler(Mathf.Lerp(-38, -62, raise) - pitch, -8, -8);
            person.leftArm.localRotation = Quaternion.Euler(Mathf.Lerp(-40, -65, raise) - pitch, 12, 16);
            person.rightElbow.localRotation = Quaternion.Euler(-38, 0, 0);
            person.leftElbow.localRotation = Quaternion.Euler(-45, 0, 0);
        }
    }

    private Vector3 BowFlightPosition(OrbitBolt data, float serverTime, out Vector3 velocity)
    {
        float ticks = Mathf.Clamp(serverTime - data.spawnTime, 0, data.expiresAt - data.spawnTime) * BowRules.tickRate;
        int n = Mathf.FloorToInt(ticks + .00001f); float part = Mathf.Max(0, ticks - n);
        float decay = Mathf.Pow(BowRules.dragPerTick, n), sum = (1 - decay) / (1 - BowRules.dragPerTick);
        float duration = (sum + part * decay) / BowRules.tickRate;
        float fall = BowRules.gravity / (BowRules.tickRate * BowRules.tickRate) / (1 - BowRules.dragPerTick);
        velocity = new Vector3(data.vx * decay, data.vy * decay - fall * BowRules.tickRate * (1 - decay), data.vz * decay);
        return new Vector3(data.x + data.vx * duration,
            data.y + data.vy * duration - fall * (n - sum + part * (1 - decay)), data.z + data.vz * duration);
    }

    private bool hasDrawnBow, crossbowHudWasEquipped;
    private float bowHelpUntil;

    private void DrawCrossbowGuidance(float w, float h)
    {
        float x = w / 2, y = h / 2, draw = Mathf.Clamp01(BowDrawTicks / BowRules.fullDrawTicks);
        Color tint = Time.unscaledTime < crossbowImpactUntil ? new Color(1,.61f,.39f)
            : Time.unscaledTime < crossbowHitUntil || draw >= 1 ? HudGold : CrossbowSafe ? HudMuted : HudInk;
        float spread = Mathf.Lerp(9, 4, draw);
        foreach (float side in new[] { -1f, 1f })
        {
            DrawTint(new Rect(x + side * spread - 1, y - 1, 3, 2), tint);
            DrawTint(new Rect(x - 1, y + side * spread - 1, 2, 3), tint);
        }
        if (BowDrawing) hasDrawnBow = true;
        if (!crossbowHudWasEquipped) bowHelpUntil = Time.unscaledTime + 4;
        crossbowHudWasEquipped = true;
        string action = BowDrawing ? (CrossbowSafe ? "安全圏では撃てない" : BowDrawTicks >= BowRules.fullDrawTicks ? "満引き" : "")
            : !hasDrawnBow && Time.unscaledTime < bowHelpUntil && !CrossbowSafe ? locked ? "長押しで引く" : "F長押しで引く" : "";
        if (action.Length > 0 && Time.time >= feedbackUntil) HudFieldCentered(x, y + 31, action, hudSmall, tint);
        if (BowDrawing)
        {
            DrawTint(new Rect(x - 33, y + 57, 66, 2), HudRule);
            DrawTint(new Rect(x - 33, y + 57, 66 * draw, 2), tint);
        }

    }

    private void DrawWeaponSwitchHint(float w, float h)
    {
        DrawWeaponHotbar(w, h);
    }
}
