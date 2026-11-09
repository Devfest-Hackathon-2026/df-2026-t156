using System;
using System.Collections.Generic;
using UnityEngine;

[Serializable] public class OrbitInventory { public string kind; public int count; }
[Serializable] public class OrbitPlayer
{
    public int motionSeq, correctionId, impulseId;
    public float correctionX, correctionY, correctionZ, impulseX, impulseY, impulseZ, velocityX, velocityY, velocityZ;
    public bool grounded, sprintSuppressed;
    public string id, name, stationId;
    public string weapon, upgradeKind;
    public bool bowDrawing;
    public float bowDrawStartedAt, bowAimPitch, meleeBoostUntil;
    public bool bot, sprinting, @protected, joinedLate;
    public float x, y, z, yaw, score, stamina, sellProgress, invuln, hurtUntil;
    public int inventoryCount, inventoryValue, sellValue;
    public int pickLevel, upgradeCost, grossSales, investmentSpent, goldSold;
    public int bagCapacity, bagLevel, bagUpgradeCost, bagUpgradeCapacity, bagInvestment;
    public float upgradeProgress;
    public bool upgradeReady, upgradeHeld;
    public OrbitSaleQuote[] saleQuotes;
    public OrbitInventory[] inventory;
}
[Serializable] public class OrbitDeposit
{
    public string id, kind, minerId;
    public float x, y, z, weakX, weakY, weakZ, respawnIn, availableIn;
    public bool active, announced;
    public float opensIn;
    public int minLevel;
    public int hp, maxHp, looseCount;
    public int layer, layerCount, remainingYield;
}
[Serializable] public class OrbitClaim
{
    public string depositId, leaderId, leaderName, status, resultId, resultReason;
    public int ownDamage, resultAmount, finishRequired;
    public int layer;
    public bool contested;
    public float resultAge;
}
[Serializable] public class OrbitSaleQuote
{
    public string stationId;
    public int baseValue, bonus, value;
}
[Serializable] public class OrbitStation
{
    public string id, name;
    public float x, y, z, radius, safeRadius, hotSeconds;
    public float multiplier;
    public float anvilX, anvilY, anvilZ, anvilRadius, useRange;
    public bool hot;
}
[Serializable] public class OrbitEvent
{
    public string weapon, projectileId, reason;
    public float vx, vy, vz, power;
    public int drawTicks, shotId;
    public float spawnTime, impactTime;
    public string meleeReason;
    public string id, type, actorId, targetId, kind;
    public float x, y, z;
    public int amount, value, bonus;
    public string finisherId;
    public bool pickup;
    public bool critical;
    public int looseCount;
    public int layer, layerCount;
}
[Serializable] public class OrbitWinner { public string id, name; public float score; }
[Serializable] public class OrbitStanding
{
    public bool bot;
    public string id, name;
    public int rank, pickLevel, grossSales, investmentSpent, score, goldSold, inventoryCount, inventoryValue;
    public int bagCapacity, bagLevel, bagUpgradeCost, bagUpgradeCapacity, bagInvestment;
}
[Serializable] public class OrbitState
{
    public ImprovementBoard feedback;
    public BowType bow;
    public OrbitBolt[] bolts;
    public string[] removedBolts;
    public float serverTime;
    public bool full;
    public int seq;
    public OrbitPose[] poses;
    public string[] removedPlayers;
    public string type, id, phase;
    public float timeLeft, resultTimeLeft, rareNextIn;
    public PickType[] picks;
    public int[] goldLayers;
    public int round;
    public OrbitWinner[] winners;
    public OrbitStanding[] standings;
    public OrbitPlayer[] players;
    public OrbitDeposit[] deposits;
    public OrbitStation[] stations;
    public OrbitSceneryRock[] scenery;
    public OrbitEvent[] events;
    public OrbitClaim[] localClaims;
}
[Serializable] public class OrbitInput
{
    public string weapon;
    public bool bowDrawing;
    public int shotId;
    public float shotTime, shotAx, shotAy, shotAz;
    public int attackId;
    public float attackTime, attackAx, attackAy, attackAz;
    public bool miningOnly;
    public int motionSeq, motionRound, correctionId, impulseId;
    public float motionTime, px, py, pz;
    public bool sneak;
    public string type = "input";
    public float x, z, ax, ay, az;
    public bool fire, sprint, sell, upgrade, expand, use;
    public int useId;
}
[Serializable] public class ClientValleyData
{
    public float boundary, walkSpeed, playerRadius, playerHeight;
    public ClientValleyObstacle[] colliders;
    public DepositGeometry[] deposits;
    public OreType[] ores;
    public PickType[] picks;
    public RareRules rare;
    public MiningRules mining;
    public CombatRules combat;
}
[Serializable] public class ClientValleyObstacle { public string id, kind; public float x, z, radius, height; }
[Serializable] public class DepositGeometry { public string id, kind; public float x, z, radius, height; }
[Serializable] public class OreType { public string id, name; public int value, hp, yield, minLevel; }
[Serializable] public class CombatRules { public float bodyScale, halfWidth, speedMultiplier, speedSeconds; }
[Serializable] public class MiningRules { public float range, hitCooldown, sprintSpeed, weakRadius, sellSeconds, upgradeSeconds; public int capacity; }

[Serializable] public class PickType { public int level, cost, damage, weakDamage; public string name; public float hitCooldown; }
[Serializable] public class RareRules { public float firstAt, previewSeconds; public int count; }

public partial class OrbitGame
{
    private readonly Dictionary<string, VeinView> veins = new Dictionary<string, VeinView>();
    private readonly Dictionary<string, OreType> oreTypes = new Dictionary<string, OreType>();
    private readonly Dictionary<string, Material> oreMaterials = new Dictionary<string, Material>();
    private readonly HashSet<string> eventsSeen = new HashSet<string>();
    private readonly HashSet<string> stationsBuilt = new HashSet<string>();
    private readonly List<string> departed = new List<string>();
    private Material veinSurface;
    private OrbitPlayer self;
    private int spawnRound = -1;
    private VeinView targetVein;
    private bool targetWeak;

    private class VeinView
    {
        public OrbitDeposit Data;
        public Transform Root;
        public Vector3 Weak;
        public MeshRenderer Rock;
        public MaterialPropertyBlock Surface;
        public float Radius;
        public float Height;
        public int LastHp = -1;
        public int LastLayer = -1, LastMaxHp = -1;
        public Transform LooseOre;
    }

    partial void UpdateInvestmentVisuals();

    private void InitMiningWorld()
    {
        if (valley.ores == null) return;
        for (int i = 0; i < valley.ores.Length; i++)
        {
            var kind = valley.ores[i];
            oreTypes[kind.id] = kind;
            Color tint = kind.id == "gold" ? new Color(.97f, .72f, .22f)
                : kind.id == "diamond" ? new Color(.64f, .92f, 1f)
                : kind.id == "ruby" ? new Color(.48f, .15f, .22f)
                : kind.id == "crystal" ? new Color(.66f, .41f, .88f)
                : kind.id == "silver" ? new Color(.80f, .89f, .93f) : new Color(.76f, .47f, .27f);
            var material = Material(tint);
            material.SetColor("_EmissionColor", tint * .045f);
            oreMaterials[kind.id] = material;
        }
    }

    private Color OreColor(string kind) => oreMaterials.TryGetValue(kind ?? "", out var mat) ? mat.color : ore.color;
    private Material OreMaterial(string kind) => oreMaterials.TryGetValue(kind ?? "", out var mat) ? mat : ore;
    private string OreName(string kind) => oreTypes.TryGetValue(kind ?? "", out var data) ? data.name : "鉱石";
    private int OreValue(string kind) => oreTypes.TryGetValue(kind ?? "", out var data) ? data.value : 0;

    private void Apply(OrbitState snapshot, OrbitDeposit[] changedDeposits = null, bool updateInvestment = true)
    {
        remoteServerTime = snapshot.serverTime;
        remoteReceivedAt = Time.unscaledTime;
        ApplySceneryMining(snapshot);
        bool roundChanged = spawnRound != snapshot.round;
        var alive = new HashSet<string>();
        if (snapshot.players != null)
        {
            foreach (var player in snapshot.players)
            {
                alive.Add(player.id);
                var position = new Vector3(player.x, player.y, player.z);
                if (player.id == localId)
                {
                    self = player;
                    if (!hasLocal || spawnRound != snapshot.round)
                    {
                        if (!hasLocal || spawnRound != snapshot.round)
                        {
                            yaw = player.yaw * Mathf.Rad2Deg;
                            pitch = SpawnPitch(position, snapshot.deposits);
                            spawnRound = snapshot.round;
                        }
                        predicted = position;
                        ResetLocalMotion();
                        ResetMeleeInput();
                        ResetCrossbowRound();
                        ApplyProspectorClothes(tool, player.name);
                        hasLocal = true;
                    }
                    ApplyLocalMotion(player);
                }
                if (!walkers.TryGetValue(player.id, out var walker))
                {
                    walker = Person();
                    ApplyProspectorClothes(walker.root, player.name);
                    walkers[player.id] = walker;
                    walker.root.position = walker.previous = position;
                    walker.renderTime = snapshot.serverTime;
                }
                walker.data = player;
                if (walker.poses.Add(snapshot.serverTime, position, player.yaw, roundChanged))
                    walker.root.position = walker.previous = position;
                walker.root.gameObject.SetActive(player.id != localId);
            }
        }
        departed.Clear();
        foreach (var pair in walkers)
            if (!alive.Contains(pair.Key)) departed.Add(pair.Key);
        foreach (string id in departed)
        {
            Destroy(walkers[id].root.gameObject);
            walkers.Remove(id);
        }
        var veinUpdates = changedDeposits ?? snapshot.deposits;
        if (veinUpdates != null)
            foreach (var item in veinUpdates) UpdateVein(item);
        if (snapshot.stations != null)
            foreach (var item in snapshot.stations)
            {
                if (stationsBuilt.Add(item.id)) BuildStation(item);
            }
        if (snapshot.events != null)
            foreach (var item in snapshot.events)
                if (eventsSeen.Add(item.id)) ApplyEvent(item);
        ApplyCrossbowState(snapshot);
        if (updateInvestment) UpdateInvestmentVisuals();
        UpdateClaimFeedback(snapshot);
        UpdateEntryTiming(snapshot);
        if (eventsSeen.Count > 2500) eventsSeen.Clear();
    }

    private void ApplyEvent(OrbitEvent item)
    {
        ApplyMeleeFeedback(item);
        bool own = item.actorId == localId;
        bool victim = item.targetId == localId;
        PlayMiningEventAudio(item, own, victim);
        ApplyCrossbowEvent(item);
        if (own && item.type == "workshop-denied")
        {
            if (stationFocus != null) return;
            ShowFeedback(item.reason == "funds" ? "あと" + item.value + "点" : item.reason == "empty" ? "袋は空"
                : item.reason == "maximum" ? "これ以上は強化できない" : item.reason == "range" ? "もう少し近づく" : "ピックか袋を選ぶ", HudMuted);
            return;
        }
        var point = new Vector3(item.x, item.y, item.z);
        Color tint = item.kind == "ruby" ? new Color(1, .72f, .77f) : OreColor(item.kind);
        if (item.type == "scenery-collapse")
        {
            HitFeedback(point, stone, false, true, false, "copper");
            if (own)
            {
                decisionFeedbackUntil = Time.time + 2;
                ShowFeedback("岩が崩れて道が開いた", HudGold);
            }
            return;
        }
        if (item.type == "swing")
        {
            if (walkers.TryGetValue(item.actorId, out var walker)) walker.cut = 1;
            return;
        }
        if (item.type == "mine" || item.type == "weak" || item.type == "harvest")
        {
            bool weak = item.type == "weak";
            bool broken = item.type == "harvest";
            bool ownStrike = !broken || item.pickup || string.IsNullOrEmpty(item.finisherId) ? own : item.finisherId == localId;
            HitFeedback(point, OreMaterial(item.kind), weak, broken, ownStrike, item.kind);
            if (own && broken)
            {
                hasHarvestedOre = true;
                harvestedKinds.Add(item.kind);
                decisionFeedbackUntil = Time.time + 1.8f;
                claimResults.Add(item.id);
                string receipt = item.kind == "gold" && item.layerCount > 1
                    ? GoldReceiptText(item.amount, item.layer, item.targetId)
                    : OreName(item.kind) + "  +" + item.amount + "個";
                var result = state.localClaims == null ? null : Array.Find(state.localClaims, claim => claim.resultId == item.id && claim.contested);
                if (result != null)
                    receipt += result.resultReason == "precision" ? "（亀裂で回収）"
                        : result.resultReason == "contribution" ? "（多く削った）" : "（近くで回収）";
                if (item.looseCount > 0 && veins.TryGetValue(item.targetId, out var remainder) && remainder.Data.looseCount > 0)
                    receipt += "　岩に残り" + remainder.Data.looseCount + "個";
                ShowFeedback(receipt, tint);
                if (item.kind == unlockGuideKind) unlockGuideUntil = 0;
            }
            else if (broken && item.pickup && targetVein != null && targetVein.Data.id == item.targetId)
            {
                decisionFeedbackUntil = Time.time + 1.8f;
                ShowFeedback(QuarryEventName(item.actorId) + "が残り" + item.amount + "個を回収", HudMuted);
            }
        }
        else if (own && item.type == "upgraded")
        {
            decisionFeedbackUntil = Time.time + 1.8f;
            ShowFeedback("ピック Lv." + item.amount + "  −" + item.value + "点", HudGold);
            BeginUnlockGuide(item.amount);
        }
        else if (own && item.type == "bag-expanded")
        {
            decisionFeedbackUntil = Time.time + 1.8f;
            ShowFeedback("袋 " + item.amount + "枠  −" + item.value + "点", HudGold);
        }
        else if (own && item.type == "hard")
        {
            ShowFeedback("ピック Lv." + item.amount + "が必要", HudGold);
        }
        else if (own && item.type == "sold")
        {
            decisionFeedbackUntil = Time.time + 1.8f;
            workshopHintUntil = Time.time + 7;
            string receipt = "売却 +" + item.value + "点";
            ShowFeedback(receipt, new Color(1, .83f, .40f));
        }
        else if (item.type == "steal" && (own || victim))
        {
            decisionFeedbackUntil = Time.time + 1.8f;
            ShowFeedback(QuarryTransferText(item, victim), victim ? new Color(1, .61f, .39f) : HudGold);
        }
        else if (own && item.type == "full")
        {
            ShowFeedback("袋がいっぱい", new Color(1, .83f, .40f));
        }
    }

    private void UpdateVein(OrbitDeposit data)
    {
        if (!veins.TryGetValue(data.id, out var view))
        {
            view = CreateVein(data);
            veins.Add(data.id, view);
        }
        view.Data = data;
        var weak = new Vector3(data.weakX, data.weakY, data.weakZ);
        if (view.LastHp == data.hp && view.LastLayer == data.layer && view.LastMaxHp == data.maxHp && (view.Weak - weak).sqrMagnitude < .000001f) return;
        view.LastHp = data.hp;
        view.LastLayer = data.layer;
        view.LastMaxHp = data.maxHp;
        view.Weak = weak;
        if (!view.Rock || !veinSurface) return;
        view.Surface.SetVector("_Weak", new Vector4(weak.x, weak.y, weak.z, 0));
        view.Surface.SetFloat("_Damage", 1f - data.hp / Mathf.Max(1f, data.maxHp));
        view.Surface.SetFloat("_Active", data.hp > 0 ? 1 : 0);
        view.Rock.SetPropertyBlock(view.Surface);
    }

    private VeinView CreateVein(OrbitDeposit data)
    {
        var geom = Array.Find(valley.deposits, item => item.id == data.id);
        float radius = geom?.radius ?? .75f;
        float height = geom?.height ?? 1.12f;
        var root = new GameObject(OreName(data.kind) + "の鉱脈").transform;
        root.position = new Vector3(data.x, data.y, data.z);
        int seed = Mathf.Abs(Mathf.RoundToInt(data.x * 17 + data.z * 43));
        var rock = ValleyLandscape.DepositRock(root, radius, height, seed);
        if (rock == null)
            rock = Chunk(root, Vector3.up * height * .45f,
                new Vector3(radius * 1.7f, height * .93f, radius * 1.7f), stone, seed);
        var renderer = rock.GetComponent<MeshRenderer>();
        if (!veinSurface)
        {
            var shader = Resources.Load<Shader>("ValleyOre");
            if (shader && shader.isSupported)
            {
                veinSurface = new Material(shader);
                veinSurface.SetTexture("_MainTex", Resources.Load<Texture2D>("Valley/Boulder"));
                veinSurface.SetTexture("_BumpMap", Resources.Load<Texture2D>("Valley/BoulderNormal"));
            }
        }
        var properties = new MaterialPropertyBlock();
        if (veinSurface)
        {
            renderer.sharedMaterial = veinSurface;
            properties.SetVector("_Deposit", new Vector4(data.x, data.y, data.z, seed % 13));
            properties.SetFloat("_Height", height);
            Color mineral = data.kind == "diamond" ? new Color(.59f, .90f, .96f)
                : data.kind == "ruby" ? new Color(.65f, .19f, .27f)
                : data.kind == "copper" ? new Color(.83f, .43f, .20f)
                : data.kind == "silver" ? new Color(.81f, .89f, .94f)
                : new Color(.64f, .36f, .86f);
            properties.SetColor("_Mineral", mineral);
            properties.SetFloat("_Style", data.kind == "diamond" ? 5 : data.kind == "ruby" ? 4 : data.kind == "copper" ? 0 : data.kind == "silver" ? 1 : 2);
        }
        return new VeinView { Data = data, Root = root, Rock = renderer, Surface = properties,
            Radius = radius, Height = height };
    }

    private void BuildStation(OrbitStation station)
    {
        var root = new GameObject(station.name).transform;
        root.position = new Vector3(station.x, station.y, station.z);
        BuildTradeMarkings(root, station);
        if (station.id != "central") BuildTradingShelter(root, station.id);
    }

    private void BuildTradingShelter(Transform root, string id)
    {
        bool west = id == "west";
        var shelter = new GameObject("Field workshop shelter").transform;
        shelter.SetParent(root, false);
        shelter.rotation = Quaternion.Euler(0, west ? 40 : -35, 0);
        Vector3 p = root.position;
        shelter.position = new Vector3(p.x, ValleyLandscape.Height(p.x, p.z), p.z);
        ValleyLandscape.TradingShelter(shelter, west);
    }

    private float SpawnPitch(Vector3 position, OrbitDeposit[] deposits)
    {
        if (deposits == null) return 5;
        Vector3 eye = position + Vector3.up * 1.62f;
        Vector3 facing = Quaternion.Euler(0, yaw, 0) * Vector3.forward;
        foreach (var deposit in deposits)
        {
            Vector3 delta = new Vector3(deposit.weakX, deposit.weakY, deposit.weakZ) - eye;
            Vector3 flat = new Vector3(delta.x, 0, delta.z);
            if (flat.sqrMagnitude < 49 && Vector3.Dot(facing, flat.normalized) > .98f)
                return -Mathf.Atan2(delta.y, flat.magnitude) * Mathf.Rad2Deg;
        }
        return 5;
    }

    private void MoveGround(Vector3 delta)
    {
        int steps = Mathf.Max(1, Mathf.CeilToInt(Mathf.Max(Mathf.Abs(delta.x), Mathf.Abs(delta.z)) / .25f));
        Vector3 increment = delta / steps;
        for (int step = 0; step < steps; step++)
        {
            predicted += increment;
            ClampGround();
            for (int pass = 0; pass < 3; pass++)
            {
                foreach (var obstacle in valley.colliders)
                    if (sceneryShapes.TryGetValue(obstacle.id, out var shape)) predicted = shape.Push(predicted, valley.playerRadius, valley.playerHeight);
                    else PushOut(obstacle.x, obstacle.z, obstacle.radius, obstacle.height);
                foreach (var deposit in valley.deposits)
                    PushOut(deposit.x, deposit.z, deposit.radius, deposit.height);
            }
            ClampGround();
        }
    }

    private void ClampGround()
    {
        predicted.x = Mathf.Clamp(predicted.x, -valley.boundary, valley.boundary);
        predicted.z = Mathf.Clamp(predicted.z, -valley.boundary, valley.boundary);
    }

    private void PushOut(float x, float z, float radius, float height)
    {
        float combined = radius + valley.playerRadius;
        var offset = new Vector2(predicted.x - x, predicted.z - z);
        if (offset.sqrMagnitude >= combined * combined) return;
        float ground = Mathf.Max(predicted.y, ValleyLandscape.Height(predicted.x, predicted.z));
        float bottom = ValleyLandscape.Height(x, z);
        if (ground + valley.playerHeight <= bottom || ground >= bottom + height - .001f) return;
        var direction = offset.sqrMagnitude < 1e-10f ? Vector2.right : offset.normalized;
        predicted.x = x + direction.x * combined;
        predicted.z = z + direction.y * combined;
    }

    private void FindMiningTarget(Vector3 origin, Vector3 aim)
    {
        targetVein = null;
        targetWeak = false;
        float best = SightDistance(origin, aim, 8f);
        foreach (var pair in walkers)
        {
            if (pair.Key == localId || pair.Value.data == null) continue;
            float playerDistance = RayPlayerBox(origin, aim, pair.Value.root.position);
            if (playerDistance <= 3.000001f) best = Mathf.Min(best, playerDistance);
        }
        foreach (var item in veins.Values)
        {
            var data = item.Data;
            var weak = new Vector3(data.weakX, data.weakY, data.weakZ);
            float precision = data.hp > 0
                ? RaySphere(origin, aim, weak, valley.mining.weakRadius)
                : data.looseCount > 0 ? RaySphere(origin, aim, item.Root.position + Vector3.up * (item.Height + .075f), .20f)
                : float.PositiveInfinity;
            float body = RayCylinder(origin, aim, item.Root.position, item.Radius, item.Height);
            float distance = Mathf.Min(precision, body);
            if (distance >= best) continue;
            best = targetDistance = distance;
            targetVein = item;
            targetWeak = precision <= body && distance <= valley.mining.range && data.hp > 0;
        }
    }

    private bool CanSeeNameplate(Vector3 head)
    {
        Vector3 origin = cam.transform.position;
        Vector3 offset = head - origin;
        float distance = offset.magnitude;
        if (distance < .001f) return true;
        Vector3 direction = offset / distance;
        if (SightDistance(origin, direction, distance) < distance - .04f) return false;
        foreach (var vein in veins.Values)
        {
            if (RayCylinder(origin, direction, vein.Root.position, vein.Radius, vein.Height) < distance - .04f)
                return false;
        }
        return true;
    }

    private float SightDistance(Vector3 origin, Vector3 aim, float maxDistance)
    {
        float best = maxDistance;
        foreach (var obstacle in valley.colliders)
        {
            if (sceneryShapes.TryGetValue(obstacle.id, out var shape))
            {
                if (shape.Ray(origin, aim, best, out float distance, out _, out _)) best = distance;
                continue;
            }
            var bottom = new Vector3(obstacle.x, ValleyLandscape.Height(obstacle.x, obstacle.z), obstacle.z);
            best = Mathf.Min(best, RayCylinder(origin, aim, bottom, obstacle.radius, obstacle.height));
        }
        int samples = Mathf.Max(1, Mathf.CeilToInt(best / .35f));
        for (int i = 1; i <= samples; i++)
        {
            float t = best * i / samples;
            Vector3 point = origin + aim * t;
            if (point.y > ValleyLandscape.Height(point.x, point.z) + .03f) continue;
            best = t;
            break;
        }
        return best;
    }

    private static float RaySphere(Vector3 origin, Vector3 aim, Vector3 center, float radius)
    {
        Vector3 delta = center - origin;
        float along = Vector3.Dot(delta, aim);
        float discriminant = radius * radius - (delta - aim * along).sqrMagnitude;
        if (discriminant < 0) return float.PositiveInfinity;
        float root = Mathf.Sqrt(discriminant);
        return along + root >= 0 ? Mathf.Max(0, along - root) : float.PositiveInfinity;
    }

    private static float RayCylinder(Vector3 origin, Vector3 aim, Vector3 bottom, float radius, float height)
    {
        Vector3 offset = origin - bottom;
        float horizontal = aim.x * aim.x + aim.z * aim.z;
        float enter = 0;
        float exit = float.PositiveInfinity;
        float radial = offset.x * offset.x + offset.z * offset.z - radius * radius;
        if (horizontal > 1e-10f)
        {
            float projection = offset.x * aim.x + offset.z * aim.z;
            float discriminant = projection * projection - horizontal * radial;
            if (discriminant < 0) return float.PositiveInfinity;
            float root = Mathf.Sqrt(discriminant);
            enter = Mathf.Max(enter, (-projection - root) / horizontal);
            exit = (-projection + root) / horizontal;
        }
        else if (radial > 0) return float.PositiveInfinity;

        if (Mathf.Abs(aim.y) > 1e-10f)
        {
            float lower = -offset.y / aim.y;
            float upper = (height - offset.y) / aim.y;
            enter = Mathf.Max(enter, Mathf.Min(lower, upper));
            exit = Mathf.Min(exit, Mathf.Max(lower, upper));
        }
        else if (offset.y < 0 || offset.y > height) return float.PositiveInfinity;
        return enter <= exit ? enter : float.PositiveInfinity;
    }
}
