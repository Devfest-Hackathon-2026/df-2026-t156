using UnityEngine;

public partial class OrbitGame
{
    private float strikePulseUntil;
    private float targetDistance;
    private bool shiftHeld;
    private bool upgradeIntent, upgradeIntentIsBag;
    private int upgradeIntentLevel;
    private string unlockGuideKind = "";
    private float unlockGuideUntil;
    private bool hasHarvestedOre, hasOpenedSurvey;
    private float decisionFeedbackUntil;
    private float remoteServerTime, remoteReceivedAt, remoteViewedTime;
    private const float RemoteInterpolationSeconds = .075f;
    private readonly System.Collections.Generic.HashSet<string> harvestedKinds = new System.Collections.Generic.HashSet<string>();

    private void Update()
    {
        PollNetwork();
        UpdateImprovements();
        UpdateChips();
        UpdateMeleeHitTint();
        if (!started) return;
        bool surveying = improvementOpen || Input.GetKey(KeyCode.Tab);
        UpdateSurveyInteraction(surveying);
        if (Input.GetKeyDown(KeyCode.Escape)) Unlock();
        if (Input.GetKeyDown(KeyCode.R) && !connected)
        {
            status = "再接続中…";
            Connect();
        }
        if (Input.GetMouseButtonDown(0) && !locked && !pointerLockUnavailable && joined && !surveying && !surveyResumeBlock)
        {
            Lock();
            surveyResumeBlock = true;
        }
        if (!surveying) UpdateLook();

        Quaternion looking = Quaternion.Euler(pitch, yaw, 0);
        Vector3 aim = looking * Vector3.forward;
        var localMove = new Vector3(KeyAxis(KeyCode.D, KeyCode.A), 0, KeyAxis(KeyCode.W, KeyCode.S));
        Vector3 move = surveying ? Vector3.zero : Quaternion.Euler(0, yaw, 0) * localMove;
        bool playing = !improvementOpen && focused && joined && self != null && state != null && state.phase != "finished" && valley.mining != null;
        bool actionsAllowed = playing && !surveying && !surveyResumeBlock;
        UpdateCrossbowSelection(actionsAllowed);
        bool fireHeld = Input.GetKey(KeyCode.F) || Input.GetMouseButton(0);
        FindStationUseTarget(predicted + Vector3.up * LocalEyeHeight, aim);
        UpdateStationUse(actionsAllowed, fireHeld);
        bool selling = stationUseActive;
        bool upgrade = stationUseActive;
        UpdateCrossbowInput(actionsAllowed && !stationUseActive, aim);
        UpdateLocalMotion(move, playing, !surveying);
        // Input, mining guidance and the camera use this frame's feet/look.
        Vector3 eye = predicted + Vector3.up * LocalEyeHeight;
        if (valley.mining != null) FindMiningTarget(eye, aim);
        FindMeleeTarget(eye, aim);
        FindSceneryMiningTarget(eye, aim);
        if (!actionsAllowed)
        {
            if (!playing) move = Vector3.zero;
            strikePulseUntil = 0;
            swingSent = true;
        }
        else if (crossbowEquipped || bagEquipped)
        {
            strikePulseUntil = 0;
            swingSent = true;

        }
        else
        {
            if (!selling && !upgrade && (Input.GetKeyDown(KeyCode.F) || Input.GetMouseButtonDown(0)))
            {
                PressPickStrike(aim);
            }
            if (ConsumeSwingImpact() && !selling && !upgrade)
            {
                strikePulseUntil = Time.time + .11f;
                nextSend = 0;
            }
            if (!selling && !upgrade && fireHeld && (targetVein != null && targetDistance <= valley.mining.range || SceneryMiningInRange()) &&
                MiningSwingReady())
            {
                BeginSwing();
            }
        }

        if (connected && joined && hasLocal && Time.time >= nextSend)
        {
            nextSend = Time.time + .05f;
            Send(JsonUtility.ToJson(new OrbitInput
            {
                motionSeq = ++motionSequence, motionRound = spawnRound, motionTime = motionTime,
                correctionId = correctionSeen, impulseId = impulseSeen,
                px = predicted.x, py = predicted.y, pz = predicted.z, sneak = sneakHeld,
                x = move.x, z = move.z, ax = aim.x, ay = aim.y, az = aim.z,
                fire = actionsAllowed && !crossbowEquipped && !selling && !upgrade && Time.time < strikePulseUntil,
                weapon = HeldTool, bowDrawing = BowDrawing,
                shotId = crossbowShotId, shotTime = crossbowShotTime,
                shotAx = crossbowShotAim.x, shotAy = crossbowShotAim.y, shotAz = crossbowShotAim.z,
                miningOnly = true, attackId = meleeAttackId, attackTime = meleeAttackTime,
                attackAx = meleeAim.x, attackAy = meleeAim.y, attackAz = meleeAim.z,
                sprint = shiftHeld,
                use = actionsAllowed && (fireHeld || stationPressPending), useId = stationUsePressId,
                sell = false, upgrade = false, expand = false
            }));
            stationPressPending = false;
        }

        float pace = motionFrameSeconds > 0 ? motionGroundDistance / motionFrameSeconds / 4.317f : 0;
        pace = Mathf.Min(pace, 1.5f);
        float previousPhase = footPhase;
        // Vanilla distanceWalkedModified uses .6 * horizontal ground distance.
        footPhase += motionGroundDistance * .6f * Mathf.PI;
        if (Mathf.FloorToInt(previousPhase / Mathf.PI) != Mathf.FloorToInt(footPhase / Mathf.PI))
            audioSource.PlayOneShot(stepSound, .42f);
        cam.transform.position = eye;
        cam.transform.rotation = looking;
        // Player preference: wide, fixed view; no sprint/aim FOV effects or camera bob.
        cam.fieldOfView = 110;
        AnimatePick(pace);
        AnimateSceneryMining();
        AnimateWalkers();
        AnimateCrossbows(pace);
        AnimateHeldBag();
        AnimateOreSignals();
    }

    private void UpdateLook()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        float lookX = OrbitReadLookX(), lookY = OrbitReadLookY();
        if (focused) { yaw += lookX * MouseLookGain; pitch += lookY * MouseLookGain; }
#else
        if (locked || Input.GetMouseButton(1))
        {
            yaw += Input.GetAxis("Mouse X") * 2;
            pitch -= Input.GetAxis("Mouse Y") * 1.7f;
        }
#endif
        float lookDelta = Mathf.Min(Time.unscaledDeltaTime, .045f);
        yaw += KeyAxis(KeyCode.RightArrow, KeyCode.LeftArrow) * 95 * lookDelta;
        pitch = Mathf.Clamp(pitch + KeyAxis(KeyCode.DownArrow, KeyCode.UpArrow) * 60 * lookDelta, -90, 90);
    }

    private static float KeyAxis(KeyCode positive, KeyCode negative)
        => (Input.GetKey(positive) ? 1f : 0f) - (Input.GetKey(negative) ? 1f : 0f);

    private void AnimateWalkers()
    {
        float viewedTime = remoteServerTime + Mathf.Min(Time.unscaledTime - remoteReceivedAt, RemoteInterpolationSeconds) - RemoteInterpolationSeconds;
        remoteViewedTime = viewedTime;
        foreach (var walker in walkers.Values)
        {
            var player = walker.data;
            if (player == null) continue;
            var pose = walker.poses.Sample(viewedTime);
            walker.root.position = pose.Position;
            walker.renderTime = pose.Time;
            float distance = Vector3.Distance(walker.previous, walker.root.position);
            walker.previous = walker.root.position;
            walker.step += distance * 4;
            float pace = Mathf.Min(distance / Mathf.Max(Time.deltaTime, .001f), 5);
            float swingAngle = Mathf.Sin(walker.step) * pace * 8;
            walker.leftLeg.localRotation = Quaternion.Euler(swingAngle, 0, 0);
            walker.rightLeg.localRotation = Quaternion.Euler(-swingAngle, 0, 0);
            walker.leftArm.localRotation = Quaternion.Euler(-swingAngle * .8f, 0, 0);
            walker.cut = Mathf.Max(0, walker.cut - Time.deltaTime * 3.8f);
            walker.rightArm.localRotation = Quaternion.Euler(swingAngle * .8f - Mathf.Sin(walker.cut * Mathf.PI) * 65, 0, 0);
            walker.root.rotation = Quaternion.Euler(0, pose.Yaw * Mathf.Rad2Deg, 0);
        }
    }

    private static readonly Color HudInk = new Color(.965f, .95f, .89f);
    private static readonly Color HudMuted = new Color(.73f, .82f, .78f);
    private static readonly Color HudGold = new Color(1f, .80f, .43f);
    private static readonly Color HudRule = new Color(.50f, .68f, .64f, .30f);
    private const float ResultCountdown = 8f;
    private static readonly string[] MarketOrder = { "west", "central", "east" };

    private GUIStyle hudBody, hudSmall, hudNumber, hudTitle, hudName, hudInput, hudButton;
    private float hudLookHintUntil;
    private bool joinedHud, hudWasLocked;

    private void OnGUI()
    {
        InitHudStyles();
        float scale = Mathf.Min(Screen.width / 1000f, Screen.height / 680f);
        GUI.matrix = Matrix4x4.Scale(Vector3.one * scale);
        float w = Screen.width / scale;
        float h = Screen.height / scale;
        if (improvementOpen) { DrawImprovementBoard(w, h); return; }
        if (!started)
        {
            DrawMiningIntro(w, h);
            return;
        }

        if (!connected || !joined || self == null || state == null)
        {
            joinedHud = false;
            HudFieldCentered(w / 2, h / 2 - 12, status, hudBody, HudInk);
            return;
        }
        if (!joinedHud)
        {
            joinedHud = true;
            hudLookHintUntil = Time.unscaledTime + 16;
        }
        if (state.phase == "finished")
        {
            DrawMiningResult(w, h);
            if (DrawFieldLink(new Rect(w / 2 - 125, h - 46, 250, 30), "改善案を送る・投票する", "result-improvements")) OpenImprovements(false);
            return;
        }
        bool surveyOpen = Input.GetKey(KeyCode.Tab);
        if (surveyOpen) hasOpenedSurvey = true;
        if (Event.current.type == EventType.Repaint && !surveyOpen) DrawMatchHud(w, h, false);
        if (surveyOpen) DrawSurvey(w, h);
        if (!locked && !surveyOpen && DrawFieldLink(new Rect(w - 170, h - 108, 150, 28), "提案と変更の記録", "play-improvements")) OpenImprovements(false);
    }

    private void InitHudStyles()
    {
        if (hudBody != null) return;
        hudBody = new GUIStyle { font = font, fontSize = 17, alignment = TextAnchor.MiddleLeft, clipping = TextClipping.Clip };
        hudBody.normal.textColor = Color.white;
        hudSmall = new GUIStyle(hudBody) { fontSize = 14 };
        hudAction = new GUIStyle(hudBody) { fontSize = 21, fontStyle = FontStyle.Bold };
        hudClock = new GUIStyle(hudBody) { fontSize = 21, alignment = TextAnchor.MiddleCenter };
        hudSale = new GUIStyle(hudNumber ?? hudBody) { fontSize = 32, fontStyle = FontStyle.Bold };
        hudNumber = new GUIStyle(hudBody) { fontSize = 25, fontStyle = FontStyle.Bold };
        hudTitle = new GUIStyle(hudNumber) { fontSize = 38 };
        hudName = new GUIStyle(hudSmall) { alignment = TextAnchor.MiddleCenter };
        hudInput = new GUIStyle(GUI.skin.textField) { font = font, fontSize = 17, alignment = TextAnchor.MiddleLeft, clipping = TextClipping.Clip };
        hudButton = new GUIStyle(hudBody) { fontSize = 18, alignment = TextAnchor.MiddleCenter, fontStyle = FontStyle.Bold };
    }





    private bool HudActionBusy => BowDrawing || HasMeleeFocus || SceneryMiningInRange() ||
        targetVein != null && targetDistance <= valley.mining.range || !string.IsNullOrEmpty(self.stationId) || Time.time < feedbackUntil;

    private void DrawMatchHud(float w, float h, bool surveyOpen)
    {
        if (hudWasLocked && !locked) hudLookHintUntil = Time.unscaledTime + 5;
        hudWasLocked = locked;
        if (surveyOpen) return;
        DrawRoundStatus();
        DrawBag(h);
        DrawWeaponSwitchHint(w, h);
        DrawMeleeBoost(w, h);
        DrawInvestmentStatus(w, h);
        DrawStationGuidance(w, h);
        DrawNameplates(w, h);
        bool tradingFocus = !string.IsNullOrEmpty(self.stationId) && (self.inventoryCount > 0 ||
            self.upgradeProgress > 0 || stationUseActive);
        if (!tradingFocus) DrawTargetGuidance(w, h);
        if (!tradingFocus && Time.time >= feedbackUntil) DrawDistantOreHint(w, h);
        if (Time.time < feedbackUntil)
            HudTag(w / 2, WeaponFeedbackY(h), feedback, hudBody, feedbackColor);
        else if (!locked && !crossbowEquipped && string.IsNullOrEmpty(self.stationId) && meleeTarget == null && !SceneryMiningInRange() && (targetVein == null || targetDistance > valley.mining.range) && Time.unscaledTime < hudLookHintUntil)
            HudTag(w / 2, HotbarTop(h) - 30, surveyResumeBlock ? "ボタン・キーを離す"
                : pointerLockUnavailable ? "右ドラッグで見回す"
                : Time.unscaledTime < surveyLookHintUntil ? "クリックで照準に戻る" : "クリックで照準に入る", hudSmall, HudMuted);
    }

    private void DrawRoundStatus()
    {
        float scale = Mathf.Min(Screen.width / 1000f, Screen.height / 680f);
        float w = Screen.width / scale;
        int seconds = Mathf.CeilToInt(Mathf.Max(0, state.timeLeft));
        int rank = PlayerRank(out float bestScore, out bool tied);
        bool urgent = seconds <= 15;
        hudClock.fontSize = urgent ? 28 : 21;
        if (urgent) HudSurface(w / 2 - 48, 15, 96, 43, .95f);
        else HudRounded(new Rect(w / 2 - 36, 20, 72, 29), new Color(.025f, .09f, .085f, .72f), 5);
        HudFieldLabel(w / 2 - 48, urgent ? 17 : 20, (seconds / 60) + ":" + (seconds % 60).ToString("00"), hudClock, urgent ? HudGold : HudInk, 96);
        if (balanceRound != state.round)
        {
            balanceRound = state.round; lastBalance = self.score; balanceChangedAt = -10;
        }
        if (lastBalance != self.score)
        {
            balanceDelta = self.score - lastBalance; balanceChangedAt = Time.unscaledTime; lastBalance = self.score;
        }
        float receipt = Mathf.Clamp01(1 - (Time.unscaledTime - balanceChangedAt) / 1.4f);
        HudFieldLabel(24, 24, "残高", hudSmall, HudMuted, 52);
        Color balanceTint = Color.Lerp(HudInk, balanceDelta >= 0 ? HudGold : new Color(1, .66f, .44f), receipt);
        HudFieldLabel(78, 18, self.score + "点", hudNumber, balanceTint, 140);
        if (urgent)
            HudFieldLabel(24, 53, (tied ? "同率" : "") + rank + "位" + (rank > 1 ? "　首位まで " + (bestScore - self.score) + "点" : ""), hudSmall, HudGold, 230);
    }

    private void DrawBag(float h)
    {
        int capacity = PlayerBagCapacity;
        bool loaded = self.inventoryCount > 0;
        if (bagRound != state.round)
        { bagRound = state.round; previousBagCount = self.inventoryCount; bagAdded = 0; }
        if (previousBagCount != self.inventoryCount)
        {
            bagAdded = Mathf.Max(0, self.inventoryCount - previousBagCount);
            bagChangedAt = Time.unscaledTime; previousBagCount = self.inventoryCount;
        }
        bool visible = loaded || !string.IsNullOrEmpty(self.stationId) || Time.unscaledTime - bagChangedAt < 2;
        if (visible)
        {
            float y = h - (loaded ? 89 : 55);
            float arrival = Mathf.Clamp01((Time.unscaledTime - bagChangedAt) / .42f);
            float bounce = bagAdded > 0 ? Mathf.Sin(arrival * Mathf.PI) * 5 : 0;
            HudIcon(new Rect(20, y - bounce, 29, 29), "bag", Color.white);
            HudFieldLabel(56, y + 2, self.inventoryCount + "/" + capacity, hudBody, self.inventoryCount >= capacity ? HudGold : HudInk, 95);
            if (self.inventory != null)
            {
                int i = 0;
                foreach (var ore in self.inventory)
                {
                    if (ore.count <= 0) continue;
                    float x = 22 + i++ * 57;
                    HudIcon(new Rect(x, y + 34 - bounce, 26, 26), ore.kind, Color.white);
                    HudFieldLabel(x + 27, y + 38, ore.count.ToString(), hudSmall, HudInk, 28);
                }
            }
        }
        if (self.stamina < .98f)
        {
            HudRounded(new Rect(23, h - 18, 119, 3), new Color(.02f, .08f, .06f, .66f), 2);
            HudRounded(new Rect(23, h - 18, 119 * Mathf.Clamp01(self.stamina), 3), HudGold, 2);
        }
    }
    private readonly System.Collections.Generic.List<Walker> nameplatePeople = new System.Collections.Generic.List<Walker>();
    private readonly System.Collections.Generic.List<Rect> nameplateAreas = new System.Collections.Generic.List<Rect>();

    private int NameplatePriority(Walker person)
    {
        if (person == meleeTarget) return 0;
        if (person == meleeFarTarget) return 1;
        if (IsRecentThief(person.data.id)) return 2;
        return person.data.inventoryCount > 0 && (predicted - person.root.position).sqrMagnitude < 64 ? 3 : 4;
    }

    private int CompareNameplates(Walker a, Walker b)
    {
        int priority = NameplatePriority(a).CompareTo(NameplatePriority(b));
        return priority != 0 ? priority : (predicted - a.root.position).sqrMagnitude.CompareTo((predicted - b.root.position).sqrMagnitude);
    }

    private void DrawNameplates(float w, float h)
    {
        nameplatePeople.Clear(); nameplateAreas.Clear();
        foreach (var pair in walkers)
            if (pair.Key != localId && pair.Value.data != null) nameplatePeople.Add(pair.Value);
        nameplatePeople.Sort(CompareNameplates);
        foreach (var person in nameplatePeople)
        {
            float distanceSquared = (predicted - person.root.position).sqrMagnitude;
            bool relevant = NameplatePriority(person) <= 2 || distanceSquared < 64;
            if (!relevant && Vector3.Dot(cam.transform.forward, (person.root.position + Vector3.up - cam.transform.position).normalized) < .96f) continue;
            if (!TryNameplatePosition(person, out Vector3 point)) continue;
            Vector3 position = person.root.position;
            var player = person.data;
            string label = QuarryPlayerLabel(player);
            float labelWidth = hudSmall.CalcSize(new GUIContent(label)).x;
            float px = point.x * w;
            float py = (1 - point.y) * h;
            var area = new Rect(px - labelWidth / 2 - 0 - 6, py - 4,
                labelWidth + 12, hudSmall.fontSize + 13);
            bool covered = false;
            foreach (var drawn in nameplateAreas) if (drawn.Overlaps(area)) { covered = true; break; }
            if (covered) continue;
            nameplateAreas.Add(area);
            HudFieldCentered(px, py, label, hudSmall, IsRecentThief(player.id) ? HudGold : player.inventoryCount > 0 ? HudInk : HudMuted);
        }
    }

    private void DrawStationGuidance(float w, float h, bool quiet = false)
    {
        if (quiet || state.stations == null) return;
        OrbitStation current = System.Array.Find(state.stations, station => station.id == self.stationId);
        if (current != null)
        {
            if (surveyDestinationId == current.id) surveyDestinationId = "";
            DrawStationActions(w, WeaponHudBottom(h), current);
        }
        else
        {
            shopHudStation = ""; shopPreviewUntil = 0;
            DrawJourneyMarker(w);
            if (Time.time >= feedbackUntil)
                DrawStationApproach(w, WeaponHudBottom(h));
        }
        if (current == null && !crossbowEquipped && self.inventoryCount == 0 && targetVein == null && meleeTarget == null &&
            !SurveyDestinationPosition(out _, out _) && Time.unscaledTime < unlockGuideUntil)
            DrawUnlockGuide(w, 120);
    }
    private OrbitSaleQuote QuoteFor(string id)
    {
        if (self?.saleQuotes == null) return null;
        foreach (var quote in self.saleQuotes)
            if (quote.stationId == id) return quote;
        return null;
    }

    private void DrawTargetGuidance(float w, float h)
    {
        if (stationFocus != null || bagEquipped)
        {
            HudRounded(new Rect(w / 2 - 2, h / 2 - 2, 4, 4), HudInk, 2);
            return;
        }
        if (crossbowEquipped) { DrawCrossbowGuidance(w, h); return; }
        float x = w / 2, y = h / 2;
        Color tint = targetWeak && targetVein != null ? HudGold : HudInk;
        HudRounded(new Rect(x - 3, y - 3, 6, 6), new Color(.02f, .08f, .08f, .85f), 3);
        HudRounded(new Rect(x - 1.5f, y - 1.5f, 3, 3), tint, 2);
        DrawMeleeCrosshair(x, y);
        if (DrawMeleeGuidance(x, y)) return;
        if (!string.IsNullOrEmpty(self.stationId)) return;
        var activeClaim = targetVein == null ? null : ClaimFor(targetVein.Data.id);
        bool liveContest = activeClaim != null && activeClaim.contested && string.IsNullOrEmpty(activeClaim.resultId);
        if (Time.time < decisionFeedbackUntil && !liveContest) return;
        if (DrawSceneryMiningGuidance(w, h)) return;
        if (targetVein == null) { DrawNearbyVeinHint(x, y); return; }
        var deposit = targetVein.Data;
        var claim = ClaimFor(deposit.id);
        bool contested = claim != null && claim.contested;
        bool inRange = targetDistance <= valley.mining.range;
        bool alive = deposit.hp > 0 && (deposit.kind != "gold" || deposit.active);
        bool full = self.inventoryCount >= PlayerBagCapacity;
        float left = x + 35, top = y + 20;
        string oreName = deposit.layerCount > 1 ? deposit.layer == 2 ? "金鉱の芯" : "金鉱の表面" : OreName(deposit.kind);
        if (deposit.kind == "diamond" && alive) oreName += "  6個";
        HudIcon(new Rect(left - 24, top, 19, 19), deposit.kind, Color.white);
        HudFieldLabel(left, top, oreName + (!inRange ? "  " + Mathf.CeilToInt(targetDistance) + "m" : ""), hudSmall, HudInk, 190);
        string action = "";
        if (deposit.looseCount > 0) action = full ? "袋がいっぱい" : inRange ? QuarrySwingPrompt("残り" + deposit.looseCount + "個を取る") : "残り" + deposit.looseCount + "個";
        else if (!alive) action = deposit.announced ? "出現まで " + Mathf.CeilToInt(deposit.opensIn) + "秒"
            : deposit.kind == "gold" ? "採掘済み" : "再生まで " + Mathf.CeilToInt(deposit.respawnIn) + "秒";
        else if (RequiredPick(deposit) > PlayerPickLevel) action = "Lv." + RequiredPick(deposit) + "のピックが必要";
        else if (full) action = "袋がいっぱい";
        else if (!inRange) action = "";
        else action = QuarrySwingPrompt(targetWeak ? "亀裂を掘る ×2" : "掘る");
        if (action.Length > 0) HudFieldLabel(left, top + 23, action, inRange && alive ? hudBody : hudSmall, targetWeak && alive && !full ? HudGold : HudMuted, 270);
        string claimHint = contested && alive ? ClaimDescription(claim) : "";
        if (claimHint.Length > 0 && claimHint != action) HudTag(x, y + 83, claimHint, hudSmall, HudGold);
        if (alive && inRange && deposit.hp < deposit.maxHp)
        {
            HudRounded(new Rect(left, top + 47, 118, 3), new Color(.02f, .08f, .06f, .67f), 2);
            HudRounded(new Rect(left, top + 47, 118 * deposit.hp / Mathf.Max(1f, deposit.maxHp), 3), OreColor(deposit.kind), 2);

        }
    }
    private void DrawNearbyVeinHint(float x, float y)
    {
        if (hasHarvestedOre || self.inventoryCount > 0 || Time.time < decisionFeedbackUntil) return;
        if (self.inventoryCount >= PlayerBagCapacity) return;
        VeinView nearest = null;
        float best = 35;
        Vector3 facing = Quaternion.Euler(0, yaw, 0) * Vector3.forward;
        foreach (var view in veins.Values)
        {
            if (view.Data.hp <= 0 || RequiredPick(view.Data) > PlayerPickLevel) continue;
            Vector3 delta = view.Root.position - predicted;
            Vector3 toward = new Vector3(delta.x, 0, delta.z).normalized;
            if (Vector3.Dot(toward, facing) < .75f || delta.sqrMagnitude >= best) continue;
            nearest = view;
            best = delta.sqrMagnitude;
        }
        if (nearest == null) return;
        var weak = new Vector3(nearest.Data.weakX, nearest.Data.weakY, nearest.Data.weakZ);
        Vector3 point = cam.WorldToViewportPoint(weak);
        if (point.z <= 0 || point.x < .12f || point.x > .88f) return;
        string hint = point.y < .46f ? "下の亀裂を狙う"
            : point.y > .54f ? "上の亀裂を狙う" : "亀裂を狙う";
        HudFieldCentered(x, y + 39, hint, hudSmall, HudMuted);
    }

    private void DrawMiningResult(float w, float h) { DrawFieldSettlement(w, h); }

    private int PlayerRank(out float bestScore, out bool tied)
    {
        int rank = 1;
        bestScore = self.score;
        tied = false;
        if (state.players != null)
            foreach (var player in state.players)
            {
                if (player.score > self.score) rank++;
                else if (player.id != localId && player.score == self.score) tied = true;
                bestScore = Mathf.Max(bestScore, player.score);
            }
        return rank;
    }
    private void HudSurface(float x, float y, float width, float height, float alpha = .9f)
        => HudRounded(new Rect(x, y, width, height), new Color(QuarryDeep.r, QuarryDeep.g, QuarryDeep.b, alpha), 12);

    private void HudLabel(float x, float y, string value, GUIStyle style, Color tint, float width = 400)
    {
        GUI.color = GuiTint(tint);
        RasterLabel(new Rect(x, y, width, style.fontSize + 5), value, style);
        GUI.color = Color.white;
    }

    private void HudRight(float right, float y, string value, GUIStyle style, Color tint)
    {
        float width = style.CalcSize(new GUIContent(value)).x;
        HudLabel(right - width, y, value, style, tint, width + 1);
    }

    private void HudTag(float center, float y, string value, GUIStyle style, Color tint)
    {
        float scale = Mathf.Min(Screen.width / 1000f, Screen.height / 680f);
        float w = Screen.width / scale;
        float width = Mathf.Min(w - 40, style.CalcSize(new GUIContent(value)).x + 2);
        float x = Mathf.Clamp(center - width / 2, 20, w - width - 20);
        HudFieldLabel(x, y + 4, value, style, tint, width);
    }

    private void DrawTint(Rect rect, Color color)
    {
        GUI.color = GuiTint(color);
        GUI.DrawTexture(rect, pixel);
        GUI.color = Color.white;
    }
}
