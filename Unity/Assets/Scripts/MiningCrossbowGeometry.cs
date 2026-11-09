using System.Collections.Generic;
using UnityEngine;

public partial class OrbitGame
{
    private readonly List<Mesh> crossbowMeshes = new List<Mesh>();
    private Material crossbowAsh, crossbowCord, arrowFeather, arrowInk;

    private void EnsureCrossbowModels()
    {
        if (heldCrossbow != null) return;
        crossbowAsh = GearMaterial(new Color(.57f, .39f, .23f), "Oxide", .16f);
        crossbowAsh.mainTexture = wood.mainTexture;
        crossbowCord = GearMaterial(new Color(.42f, .34f, .23f), "Denim", .08f);
        arrowFeather = Material(new Color(.92f, .90f, .80f));
        arrowFeather.SetColor("_EmissionColor", new Color(.15f, .15f, .12f));
        arrowInk = Material(new Color(.12f, .16f, .18f));
        boltPrototype = BuildQuarrel();
        crossbowPrototype = BuildCrossbow();
        heldCrossbow = CopyCrossbow(cam.transform, new Vector3(.18f, -.31f, .67f));
        BuildCrossbowHands(heldCrossbow.Root);
        heldCrossbow.Root.localScale = Vector3.one * .62f;
        ApplyProspectorClothes(heldCrossbow.Root, self?.name ?? nameInput);
        foreach (var renderer in heldCrossbow.Root.GetComponentsInChildren<Renderer>(true))
        {
            renderer.gameObject.layer = GearLayer;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
        }
        heldCrossbow.Root.gameObject.SetActive(false);
    }

    private Transform BowProfile(Transform parent, string name, Material material, params Ring[] rings)
    {
        if (rings.Length > 1 && rings[0].Y > rings[rings.Length - 1].Y) System.Array.Reverse(rings);
        Mesh mesh = Profile(rings); crossbowMeshes.Add(mesh);
        return GearMesh(parent, name, mesh, material);
    }

    private Transform BuildCrossbow()
    {
        var root = GearPivot(transform, "Ash bow shared geometry", Vector3.zero);
        var limbs = GearPivot(root, "Limbs", Vector3.zero);
        foreach (int side in new[] { -1, 1 })
        {
            var limb = GearPivot(limbs, side > 0 ? "Upper limb" : "Lower limb", Vector3.zero);
            BowProfile(limb, "Shaped ash stave", crossbowAsh,
                new Ring(0,.026f,.020f,0,.25f),new Ring(side*.10f,.024f,.018f,0,.24f),
                new Ring(side*.23f,.021f,.015f,0,.19f),new Ring(side*.37f,.016f,.012f,0,.10f),
                new Ring(side*.47f,.010f,.009f,0,.065f),new Ring(side*.535f,.005f,.006f,0,.08f));
            for (int i = 0; i < 3; i++)
            {
                var loop = BowProfile(limb, "Waxed tip binding", crossbowCord,
                    new Ring(-.003f,.008f,.008f),new Ring(.003f,.008f,.008f));
                loop.localPosition = new Vector3(0, side * (.505f + i * .008f), .075f);
            }
            CombineBowShell(limb, null, null);
        }
        for (int i = 0; i < 9; i++)
        {
            var wrap = BowProfile(root, "Worn leather grip wrapping", glove,
                new Ring(-.004f,.028f,.022f),new Ring(.004f,.028f,.022f));
            wrap.localPosition = new Vector3(0, -.045f + i * .011f, .25f);
        }
        var line = GearPivot(root, "Bowstring", Vector3.zero).gameObject.AddComponent<LineRenderer>();
        line.useWorldSpace = false; line.positionCount = 3;
        line.sharedMaterial = ropeMat; line.startWidth = line.endWidth = .003f;
        line.startColor = line.endColor = new Color(.77f, .70f, .52f);
        line.SetPositions(new[] { new Vector3(0,-.535f,.08f),new Vector3(0,0,.08f),new Vector3(0,.535f,.08f) });
        var arrow = Instantiate(boltPrototype, root, false); arrow.name = "Nocked arrow";
        arrow.localPosition = new Vector3(0, 0, .08f); arrow.gameObject.SetActive(false);
        CombineBowShell(root, limbs, arrow);
        root.gameObject.SetActive(false);
        return root;
    }

    private Transform BuildQuarrel()
    {
        var root = GearPivot(transform, "Shared arrow geometry", Vector3.zero);
        var shaft = BowProfile(root, "Ash arrow shaft", crossbowAsh,
            new Ring(0,.0035f,.0035f),new Ring(.63f,.0035f,.0035f));
        shaft.localRotation = Quaternion.Euler(90, 0, 0);
        var head = BowProfile(root, "Forged leaf point", arrowInk,
            new Ring(.62f,.007f,.003f),new Ring(.65f,.015f,.0035f),new Ring(.695f,.0005f,.0005f));
        head.localRotation = Quaternion.Euler(90, 0, 0);
        for (int i = 0; i < 3; i++)
        {
            var vane = BowProfile(root, "Cut feather vane", arrowFeather,
                new Ring(.015f,.004f,.001f,.005f),new Ring(.03f,.024f,.0015f,.017f),
                new Ring(.105f,.019f,.0015f,.014f),new Ring(.12f,.004f,.001f,.005f));
            vane.localRotation = Quaternion.Euler(0, 0, i * 120) * Quaternion.Euler(90, 0, 0);
        }
        CombineBowShell(root, null, null);
        root.gameObject.SetActive(false);
        return root;
    }

    private void CombineBowShell(Transform root, Transform movingBow, Transform loadedBolt)
    {
        var groups = new Dictionary<Material, List<CombineInstance>>();
        foreach (var filter in root.GetComponentsInChildren<MeshFilter>(true))
        {
            if (movingBow && filter.transform.IsChildOf(movingBow) || loadedBolt && filter.transform.IsChildOf(loadedBolt)) continue;
            var renderer = filter.GetComponent<MeshRenderer>();
            if (!renderer || !renderer.enabled) continue;
            var material = renderer.sharedMaterial;
            if (!groups.TryGetValue(material, out var group)) groups.Add(material, group = new List<CombineInstance>());
            group.Add(new CombineInstance { mesh = filter.sharedMesh, transform = root.worldToLocalMatrix * filter.transform.localToWorldMatrix });
            renderer.enabled = false;
        }
        foreach (var group in groups)
        {
            var mesh = new Mesh { name = "Shared ash bow surfaces" };
            mesh.CombineMeshes(group.Value.ToArray(), true, true);
            crossbowMeshes.Add(mesh);
            GearMesh(root, "Joined crafted surfaces", mesh, group.Key);
        }
    }

    private CrossbowModel CopyCrossbow(Transform parent, Vector3 position)
    {
        var root = Instantiate(crossbowPrototype, parent, false);
        root.name = "Quarry ash bow"; root.localPosition = position;
        return new CrossbowModel { Root = root, Bolt = root.Find("Nocked arrow"), Bow = root.Find("Limbs/Upper limb"),
            Lower = root.Find("Limbs/Lower limb"), String = root.Find("Bowstring").GetComponent<LineRenderer>() };
    }

    private void BuildCrossbowHands(Transform root)
    {
        var grip = GearPivot(root, "Bow grip hand", new Vector3(0,-.045f,.25f));
        BowProfile(grip, "Left grip glove", glove,
            new Ring(-.045f,.032f,.029f),new Ring(0,.041f,.035f),new Ring(.045f,.032f,.028f));
        BowProfile(grip, "Left canvas sleeve", jacket,
            new Ring(-1.15f,.105f,.095f,-.42f,-.25f),new Ring(-.60f,.078f,.071f,-.25f,-.18f),
            new Ring(-.31f,.065f,.058f,-.17f,-.12f),new Ring(-.20f,.053f,.049f,-.11f,-.08f),
            new Ring(-.10f,.039f,.037f,-.04f,-.04f),new Ring(-.04f,.032f,.030f));
        reloadHand = GearPivot(root, "String draw hand", new Vector3(0,-.035f,.08f));
        BowProfile(reloadHand, "Right string glove", glove,
            new Ring(-.06f,.024f,.028f),new Ring(-.015f,.033f,.032f),new Ring(.025f,.026f,.026f));
        for (int i = 0; i < 3; i++)
            BowProfile(reloadHand, "Curled string finger", glove,
                new Ring(-.014f,.008f,.010f,-.025f+i*.014f,.003f),new Ring(.005f,.008f,.010f,-.025f+i*.014f,.008f),
                new Ring(.019f,.007f,.008f,-.025f+i*.014f,.018f),new Ring(.023f,.004f,.005f,-.025f+i*.014f,.026f));
        BowProfile(reloadHand, "Right canvas sleeve", jacket,
            new Ring(-1.15f,.10f,.09f,.40f,-.25f),new Ring(-.60f,.075f,.069f,.25f,-.16f),
            new Ring(-.29f,.061f,.055f,.18f,-.08f),new Ring(-.19f,.050f,.046f,.12f,-.05f),
            new Ring(-.10f,.037f,.035f,.045f,-.02f),new Ring(-.055f,.027f,.029f));
    }

    private void PoseCrossbow(CrossbowModel model, float draw)
    {
        model.Bow.localRotation = Quaternion.Euler(-draw * 11, 0, 0);
        model.Lower.localRotation = Quaternion.Euler(draw * 11, 0, 0);
        model.String.SetPosition(0, model.Lower.localRotation * new Vector3(0,-.535f,.08f));
        model.String.SetPosition(1, new Vector3(0,0,Mathf.Lerp(.08f,-.30f,draw)));
        model.String.SetPosition(2, model.Bow.localRotation * new Vector3(0,.535f,.08f));
        model.Bolt.gameObject.SetActive(draw > 0);
        model.Bolt.localPosition = new Vector3(0,0,Mathf.Lerp(.08f,-.30f,draw));
    }

    private void DrawCrossbowGlyph(Rect rect, Color color)
    {
        Vector2 center = rect.center;
        HudLine(center + new Vector2(-3,-12),center + new Vector2(5,-6),color,2);
        HudLine(center + new Vector2(5,-6),center + new Vector2(7,0),color,2);
        HudLine(center + new Vector2(7,0),center + new Vector2(5,6),color,2);
        HudLine(center + new Vector2(5,6),center + new Vector2(-3,12),color,2);
        HudLine(center + new Vector2(-3,-12),center + new Vector2(-7,0),color,1);
        HudLine(center + new Vector2(-7,0),center + new Vector2(-3,12),color,1);
    }

    private void ReleaseCrossbowAssets()
    {
        foreach (var mesh in crossbowMeshes) if (mesh) Destroy(mesh);
        if (crossbowAsh) Destroy(crossbowAsh);
        if (crossbowCord) Destroy(crossbowCord);
        if (arrowFeather) Destroy(arrowFeather);
        if (arrowInk) Destroy(arrowInk);
        if (arrowWakeMaterial) Destroy(arrowWakeMaterial);
        if (crossbowRelease) Destroy(crossbowRelease);
    }
}
