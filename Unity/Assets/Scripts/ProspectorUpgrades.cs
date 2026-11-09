using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

public partial class OrbitGame
{
    private sealed class PickAssembly
    {
        public Transform Root;
        public GameObject BasicHead, BasicTip;
        public GameObject[] Stages;
        public Transform ForgedHead, WorkingTip;
        public GameObject[] GradeBands;
        public MeshRenderer[] ForgedRenderers;
        public MaterialPropertyBlock Finish = new MaterialPropertyBlock();
        public int Level = 1;
    }

    private sealed class ForgeView
    {
        public string StationId;
        public Transform Root, Hammer;
        public MeshRenderer Heat;
        public MaterialPropertyBlock Properties = new MaterialPropertyBlock();
        public float Working;
    }

    private readonly Dictionary<Transform, PickAssembly> pickAssemblies = new Dictionary<Transform, PickAssembly>();
    private readonly Dictionary<Transform,GameObject[]> toolKits = new Dictionary<Transform,GameObject[]>();
    private readonly Dictionary<string, ForgeView> forges = new Dictionary<string, ForgeView>();
    private Material temperedSteel, dressedSteel, brass, wrapping, coal, forgeHeat;
    private Mesh reinforcedHead, heavyHead, cheekMesh;
    private int renderedPickLevel = 1;
    private float pickChangedAt = -10;
    private string investmentPlayerId = "";
    private AudioSource forgeAudio;
    private AudioClip forgeStroke;
    private int lastForgeBeat = -1;
    private readonly List<Transform> departedPicks = new List<Transform>();

    private void InitInvestmentMaterials()
    {
        if (temperedSteel) return;
        temperedSteel = GearMaterial(new Color(.34f,.39f,.42f), "Oxide", .54f, .72f);
        dressedSteel = GearMaterial(new Color(.62f,.66f,.64f), null, .61f, .72f);
        brass = GearMaterial(new Color(.52f,.37f,.15f), null, .39f, .62f);
        wrapping = GearMaterial(new Color(.26f,.14f,.08f), "Denim", .19f);
        coal = GearMaterial(new Color(.085f,.073f,.062f), "Oxide", .09f);
        forgeHeat = Material(new Color(.21f,.055f,.012f));
        forgeHeat.SetColor("_EmissionColor", new Color(.62f,.11f,.009f));
        reinforcedHead = Profile(
            new Ring(-.219f,.006f,.009f,-.193f), new Ring(-.174f,.014f,.018f,-.211f),
            new Ring(-.102f,.023f,.026f,-.237f), new Ring(-.036f,.033f,.033f,-.250f),
            new Ring(.026f,.032f,.031f,-.250f), new Ring(.086f,.021f,.028f,-.234f),
            new Ring(.132f,.009f,.050f,-.215f));
        heavyHead = Profile(
            new Ring(-.219f,.007f,.010f,-.193f), new Ring(-.161f,.017f,.022f,-.215f),
            new Ring(-.085f,.030f,.035f,-.242f), new Ring(-.034f,.038f,.041f,-.250f),
            new Ring(.032f,.038f,.038f,-.250f), new Ring(.085f,.027f,.031f,-.232f),
            new Ring(.139f,.013f,.057f,-.202f));
        cheekMesh = Profile(new Ring(.209f,.019f,.0045f,0,.024f),
            new Ring(.224f,.025f,.0055f,0,.026f), new Ring(.248f,.034f,.006f,0,.031f),
            new Ring(.265f,.037f,.0065f,0,.032f), new Ring(.274f,.024f,.005f,0,.026f));
    }

    private void RegisterPickAssembly(Transform root, Transform basicHead, Transform basicTip)
    {
        InitInvestmentMaterials();
        var assembly = new PickAssembly
        {
            Root = root, BasicHead = basicHead.gameObject, BasicTip = basicTip.gameObject,
            Stages = new GameObject[2]
        };
        for (int stage = 0; stage < 2; stage++)
        {
            var group = GearPivot(root, stage == 0 ? "Tempered steel reinforcement" : "Heavy forged assembly", Vector3.zero);
            var head = GearMesh(group, "Tempered point and broad adze", stage == 0 ? reinforcedHead : heavyHead, temperedSteel);
            head.localRotation = Quaternion.Euler(0,0,-90);
            var tip = GearMesh(group, "Hardened working point", edgeMesh, dressedSteel);
            tip.localRotation = head.localRotation;
            for (int side = -1; side <= 1; side += 2)
            {
                var cheek = GearMesh(group, "Forged socket cheek", cheekMesh, stage == 0 ? iron : temperedSteel);
                cheek.localScale = new Vector3(stage == 0 ? .81f : 1.12f,1,side);
                // Mirror by rotation to preserve outward-facing triangles.
                if (side < 0)
                {
                    cheek.localScale = new Vector3(stage == 0 ? .81f : 1.12f,1,1);
                    cheek.localRotation = Quaternion.Euler(0,180,0);
                }
            }
            float bandTop = stage == 0 ? .167f : .215f;
            Rounded(group, "Leather shock grip", wrapping, new Ring(.047f,.021f,.019f,-.004f),
                new Ring(.069f,.024f,.021f,-.005f), new Ring(bandTop,.023f,.021f,-.004f),
                new Ring(bandTop + .010f,.020f,.018f,-.003f));
            if (stage == 1)
            {
                assembly.ForgedHead = head;
                assembly.WorkingTip = tip;
                Rounded(group, "Pinned collar", brass, new Ring(.192f,.027f,.024f),
                    new Ring(.207f,.028f,.025f), new Ring(.218f,.026f,.024f));
                var pin = Rounded(group, "Socket cross pin", brass, new Ring(-.039f,.008f,.008f),
                    new Ring(.039f,.008f,.008f));
                pin.localPosition = new Vector3(0,.244f,0);
                pin.localRotation = Quaternion.Euler(90,0,0);
            }
            assembly.Stages[stage] = group.gameObject;
            group.gameObject.SetActive(false);
        }
        // One existing forged assembly serves every higher grade. Its profile,
        // finish and five permanent haft bands change without duplicating tools.
        assembly.ForgedRenderers = new[] { assembly.ForgedHead.GetComponent<MeshRenderer>(), assembly.WorkingTip.GetComponent<MeshRenderer>() };
        assembly.GradeBands = new GameObject[5];
        for (int grade = 0; grade < assembly.GradeBands.Length; grade++)
        {
            float y = .077f + grade * .026f;
            var band = Rounded(root, "Grade " + (grade + 4) + " haft inlay", brass,
                new Ring(y,.0255f,.023f,-.004f), new Ring(y + .007f,.0255f,.023f,-.004f));
            assembly.GradeBands[grade] = band.gameObject;
            band.gameObject.SetActive(false);
        }
        if (root == tool) SetHandsLayer(root);
        pickAssemblies[root] = assembly;
    }

    private void SetHandsLayer(Transform root)
    {
        foreach (var renderer in root.GetComponentsInChildren<MeshRenderer>(true))
        {
            renderer.gameObject.layer = GearLayer;
            renderer.receiveShadows = false;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
        }
    }

    partial void UpdateInvestmentVisuals()
    {
        if (state == null || valley == null) return;
        PrepareMiningAudioSnapshot();
        UpdateFractureVisuals();
        InitInvestmentMaterials();
        departedPicks.Clear();
        foreach (var root in pickAssemblies.Keys) if (!root) departedPicks.Add(root);
        foreach (var root in departedPicks)
        {
            pickAssemblies.Remove(root);
            toolKits.Remove(root);
        }
        foreach (var pair in walkers)
        {
            var player = pair.Value.data;
            if (player == null) continue;
            var assemblyRoot = pair.Value.rightElbow.Find("Held miner's pick");
            SetPickLevel(assemblyRoot, player.pickLevel);
        }
        int nextLevel = self != null ? Mathf.Max(1,self.pickLevel) : 1;
        SetPickLevel(tool, nextLevel);
        if (self != null && investmentPlayerId != self.id)
        {
            investmentPlayerId = self.id;
            renderedPickLevel = nextLevel;
        }
        if (nextLevel != renderedPickLevel)
        {
            if (nextLevel > renderedPickLevel)
            {
                pickChangedAt = Time.unscaledTime;
            }
            renderedPickLevel = nextLevel;
        }
        if (state.stations != null)
            foreach (var station in state.stations)
            {
                if (!forges.TryGetValue(station.id, out var forge))
                    forges[station.id] = forge = CreateForge(station);
                forge.Working = 0;
                foreach (var player in state.players)
                    if (player.stationId == station.id)
                        forge.Working = Mathf.Max(forge.Working, player.upgradeProgress);
            }
        foreach (var view in veins.Values)
        {
            if (view.Data.kind != "gold" || !view.Rock) continue;
            view.Surface.SetColor("_Mineral", new Color(.91f,.62f,.17f));
            view.Surface.SetFloat("_Style",3);
            view.Surface.SetFloat("_GoldLayer",view.Data.layer);
            view.Surface.SetFloat("_GoldLayers",Mathf.Max(1,view.Data.layerCount));
            view.Surface.SetFloat("_Active", view.Data.active && view.Data.hp > 0 ? 1 : 0);
            view.Rock.SetPropertyBlock(view.Surface);
        }
        UpdateRareSites();
        UpdateCargoVisuals();
        if (oreMaterials.TryGetValue("gold",out var gold))
        {
            gold.color = new Color(.83f,.57f,.13f);
            gold.SetFloat("_Metallic",.72f);
            gold.SetFloat("_Smoothness",.51f);
            gold.SetColor("_EmissionColor",new Color(.018f,.009f,0));
        }
    }

    private void SetPickLevel(Transform root, int level)
    {
        if (!root || !pickAssemblies.TryGetValue(root,out var assembly)) return;
        level = Mathf.Clamp(level,1,MaxPickLevel);
        if (assembly.Level == level) return;
        assembly.BasicHead.SetActive(level == 1);
        assembly.BasicTip.SetActive(level == 1);
        assembly.Stages[0].SetActive(level == 2);
        assembly.Stages[1].SetActive(level >= 3);
        for (int i = 0; i < assembly.GradeBands.Length; i++) assembly.GradeBands[i].SetActive(level >= i + 4);
        float grade = Mathf.Max(0, level - 3);
        assembly.ForgedHead.localScale = new Vector3(1 + grade * .025f, 1 + grade * .04f, 1 + grade * .02f);
        assembly.WorkingTip.localScale = new Vector3(1 + grade * .045f, 1, 1);
        Color finish = Color.Lerp(new Color(.34f,.39f,.42f), new Color(.72f,.82f,.84f), grade / 5);
        assembly.Finish.SetColor("_Color", finish);
        assembly.Finish.SetFloat("_Smoothness", .54f + grade * .05f);
        foreach (var renderer in assembly.ForgedRenderers) renderer.SetPropertyBlock(assembly.Finish);
        assembly.Level = level;
        if (toolKits.TryGetValue(root,out var kits))
        {
            kits[0].SetActive(level >= 2);
            kits[1].SetActive(level >= 3);
        }
    }

    private void RegisterProspectorToolkit(Walker person, Transform held)
    {
        var roll=GearPivot(person.body,"Steelworker's tool roll",new Vector3(0,.10f,-.25f));
        var canvas=Rounded(roll,"Rolled leather tools",wrapping,new Ring(-.24f,.071f,.070f),
            new Ring(-.18f,.083f,.077f),new Ring(.18f,.083f,.077f),new Ring(.24f,.071f,.070f));
        canvas.localRotation=Quaternion.Euler(0,0,-90);
        for(int side=-1;side<=1;side+=2)
        {
            var strap=Rounded(roll,"Tool roll strap",cuff,new Ring(-.018f,.087f,.082f),new Ring(.018f,.087f,.082f));
            strap.localPosition=new Vector3(side*.13f,0,0);
            strap.localRotation=Quaternion.Euler(0,0,-90);
        }
        var wedgeKit=GearPivot(person.body,"Heavy quarry wedge kit",new Vector3(.18f,.16f,-.24f));
        wedgeKit.localRotation=Quaternion.Euler(0,0,-16);
        Rounded(wedgeKit,"Forged quarry wedge",temperedSteel,new Ring(.06f,.010f,.006f),
            new Ring(.18f,.028f,.017f),new Ring(.45f,.044f,.027f),new Ring(.70f,.044f,.027f));
        Rounded(wedgeKit,"Dressed striking face",dressedSteel,new Ring(.69f,.044f,.027f),
            new Ring(.715f,.049f,.031f),new Ring(.73f,.043f,.025f));
        for(int i=0;i<2;i++)
            Rounded(wedgeKit,"Wedge keeper",wrapping,new Ring(.19f+i*.23f,.057f,.038f),
                new Ring(.23f+i*.23f,.058f,.039f));
        toolKits[held]=new[]{roll.gameObject,wedgeKit.gameObject};
        RegisterBackpackEquipment(person,roll,wedgeKit);
        roll.gameObject.SetActive(false);
        wedgeKit.gameObject.SetActive(false);
    }

    private ForgeView CreateForge(OrbitStation station)
    {
        var root = GearPivot(transform,"Field forge at " + station.name,Vector3.zero);
        float facing = station.id == "west" ? 40 : station.id == "east" ? -35 : 0;
        root.position = new Vector3(station.anvilX, station.anvilY - .82f, station.anvilZ);
        root.rotation = Quaternion.Euler(0,facing,0);
        Rounded(root,"Oak anvil stump",wood,new Ring(0,.28f,.24f),
            new Ring(.10f,.29f,.25f,.015f),new Ring(.46f,.245f,.225f),
            new Ring(.54f,.27f,.23f,-.012f));
        var anvil = GearMesh(root,"Forged horn anvil",AnvilMesh(),temperedSteel);
        anvil.localPosition = Vector3.up * .54f;
        Rounded(root,"Portable coal hearth",iron,new Ring(.39f,.29f,.25f,.64f),
            new Ring(.46f,.35f,.29f,.64f),new Ring(.51f,.34f,.28f,.64f));
        Rounded(root,"Coal bed",coal,new Ring(.48f,.30f,.23f,.64f),new Ring(.505f,.29f,.22f,.64f));
        var ember = Rounded(root,"Banked embers",forgeHeat,new Ring(.507f,.18f,.13f,.64f),
            new Ring(.519f,.17f,.12f,.64f));
        for (int side = -1; side <= 1; side += 2)
        {
            Rounded(root,"Timber hammer upright",wood,
                new Ring(.02f,.055f,.049f,-.47f,side*.15f),
                new Ring(.97f,.049f,.045f,-.47f,side*.15f),
                new Ring(1.18f,.050f,.045f,-.47f,side*.15f));
        }
        var axle = Rounded(root,"Hammer pivot axle",iron,
            new Ring(-.21f,.025f,.025f),new Ring(.21f,.025f,.025f));
        axle.localPosition = new Vector3(-.47f,1.12f,0);
        axle.localRotation = Quaternion.Euler(90,0,0);
        var hammer = GearPivot(root,"Hinged forging hammer",new Vector3(-.47f,1.12f,0));
        var shaft = Rounded(hammer,"Ash hammer lever",wood,new Ring(-.14f,.028f,.022f),
            new Ring(.48f,.028f,.022f),new Ring(.55f,.034f,.026f));
        shaft.localRotation = Quaternion.Euler(0,0,-90);
        var hammerhead = Rounded(hammer,"Forging head",iron,new Ring(-.065f,.055f,.049f),
            new Ring(.065f,.055f,.049f));
        hammerhead.localPosition = new Vector3(.51f,-.17f,0);
        var neck = Rounded(hammer,"Hammer neck",iron,new Ring(-.142f,.028f,.026f),
            new Ring(.012f,.030f,.027f));
        neck.localPosition = new Vector3(.51f,0,0);
        for(int leg=0;leg<3;leg++)
        {
            float angle=leg*Mathf.PI*2/3;
            float x=.64f+Mathf.Cos(angle)*.22f,z=Mathf.Sin(angle)*.19f;
            Rounded(root,"Hearth iron leg",iron,new Ring(.015f,.022f,.021f,x,z),
                new Ring(.25f,.020f,.018f,Mathf.Lerp(x,.64f,.12f),z*.88f),
                new Ring(.46f,.021f,.019f,Mathf.Lerp(x,.64f,.25f),z*.75f));
        }
        return new ForgeView {StationId=station.id,Root=root,Hammer=hammer,Heat=ember.GetComponent<MeshRenderer>()};
    }

    private Mesh AnvilMesh()
    {
        // One continuous forged silhouette: heel, waist, foot and drawn-out horn.
        var profile = new[]
        {
            new Vector2(-.36f,0), new Vector2(.29f,0), new Vector2(.24f,.065f),
            new Vector2(.14f,.10f), new Vector2(.10f,.19f), new Vector2(.18f,.25f),
            new Vector2(.36f,.265f), new Vector2(.55f,.31f), new Vector2(.32f,.345f),
            new Vector2(-.34f,.345f), new Vector2(-.34f,.258f), new Vector2(-.16f,.24f),
            new Vector2(-.12f,.16f), new Vector2(-.16f,.085f), new Vector2(-.31f,.06f)
        };
        var vertices = new List<Vector3>();
        var triangles = new List<int>();
        int count = profile.Length;
        for (int side=0;side<2;side++)
            for(int i=0;i<count;i++)
                vertices.Add(new Vector3(profile[i].x,profile[i].y,(side == 0 ? -1 : 1) * (i == 7 ? .006f : .10f)));
        int[] faces = { 1, 0, 14, 2, 1, 14, 3, 2, 14, 7, 6, 5, 8, 7, 5, 9, 8, 5, 9, 5, 4, 9, 4, 3, 11, 10, 9, 11, 9, 3, 12, 11, 3, 13, 12, 3, 13, 3, 14 };
        for(int i=0;i<faces.Length;i+=3)
            triangles.AddRange(new[]{faces[i],faces[i+1],faces[i+2],faces[i+2]+count,faces[i+1]+count,faces[i]+count});
        for(int i=0;i<count;i++)
        {
            int j=(i+1)%count;
            triangles.AddRange(new[]{i,j,j+count,i,j+count,i+count});
        }
        var uv = new List<Vector2>();
        foreach(var vertex in vertices) uv.Add(new Vector2(vertex.x * 2,vertex.y * 2 + vertex.z));
        var mesh = new Mesh {name="Forged horn and waist"};
        mesh.SetVertices(vertices);
        mesh.SetUVs(0,uv);
        mesh.SetTriangles(triangles,0);
        mesh.RecalculateNormals();
        return mesh;
    }

    private void AnimateInvestmentVisuals()
    {
        AnimateCargoVisuals();
        ForgeView nearestWorking = null;
        float nearestDistance = 100;
        foreach(var forge in forges.Values)
        {
            bool working=forge.Working > 0;
            float phase = Mathf.Repeat(Time.unscaledTime * 3.4f,1);
            float lift = working ? Mathf.Sin(Mathf.PI * phase) : 0;
                        forge.Hammer.localRotation = Quaternion.Euler(0,0,lift * 23);

            forge.Heat.GetPropertyBlock(forge.Properties);
            forge.Properties.SetColor("_EmissionColor",new Color(.62f,.11f,.009f)*(working ? 2.1f : .7f));
            forge.Heat.SetPropertyBlock(forge.Properties);
            float distance = (cam.transform.position - forge.Root.position).sqrMagnitude;
            if (working && distance < nearestDistance)
            {
                nearestDistance = distance;
                nearestWorking = forge;
            }
        }
        int beat = Mathf.FloorToInt(Time.unscaledTime * 3.4f);
        if (nearestWorking != null && beat != lastForgeBeat)
        {
            if (!forgeAudio)
            {
                forgeAudio = GearPivot(transform,"Forge impact audio",Vector3.zero).gameObject.AddComponent<AudioSource>();
                forgeAudio.spatialBlend = 1;
                forgeAudio.rolloffMode = AudioRolloffMode.Linear;
                forgeAudio.minDistance = 1.5f;
                forgeAudio.maxDistance = 13;
                forgeStroke = forgeStrikeSound;
            }
            forgeAudio.transform.position = nearestWorking.Root.position + Vector3.up * .9f;
            forgeAudio.pitch = .78f + (beat % 3) * .045f;
            forgeAudio.PlayOneShot(forgeStroke,.16f);
        }
        lastForgeBeat = beat;
    }
}
