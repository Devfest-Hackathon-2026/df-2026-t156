using System.Collections.Generic;
using UnityEngine;

public partial class OrbitGame
{
    private Material minerSkin, minerShadow, minerHair, minerEyes, minerIvory, minerCanvas, minerSeam, minerLamp;

    private void InitMinerAppearance()
    {
        if (minerSkin) return;
        minerSkin = skin;
        minerShadow = GearMaterial(new Color(.42f, .23f, .15f), null);
        minerHair = GearMaterial(new Color(.12f, .075f, .047f), null, .12f);
        minerEyes = GearMaterial(new Color(.055f, .075f, .067f), null, .32f);
        minerIvory = GearMaterial(new Color(.84f, .82f, .69f), null, .12f);
        minerCanvas = GearMaterial(new Color(.28f, .34f, .31f), "Denim", .12f);
        minerSeam = GearMaterial(new Color(.56f, .48f, .32f), null, .12f);
        minerLamp = GearMaterial(new Color(.98f, .84f, .49f), null, .47f);
        minerLamp.SetColor("_EmissionColor", new Color(.30f, .19f, .055f));
    }

    // Squared cloth panels retain rounded corners and a shaped shoulder line.
    // The joints and the network-controlled roots stay in their original positions.
    private Transform Tailored(Transform parent, string name, Material material, params Ring[] rings)
    {
        const int sides = 20, columns = sides + 1;
        Mesh mesh = Profile(sides, rings);
        Vector3[] vertices = mesh.vertices;
        for (int row = 0; row < rings.Length; row++)
        {
            Ring ring = rings[row];
            for (int i = 0; i <= sides; i++)
            {
                float angle = i * Mathf.PI * 2 / sides;
                float x = Mathf.Cos(angle), z = Mathf.Sin(angle);
                vertices[row * columns + i] = new Vector3(
                    ring.X + Mathf.Sign(x) * Mathf.Pow(Mathf.Abs(x), .76f) * ring.Width,
                    ring.Y,
                    ring.Z + Mathf.Sign(z) * Mathf.Pow(Mathf.Abs(z), .76f) * ring.Depth);
            }
        }
        mesh.vertices = vertices;
        mesh.RecalculateNormals();
        mesh.RecalculateBounds();
        return GearMesh(parent, name, mesh, material);
    }

    private void BuildProspectorHead(Transform body)
    {
        InitMinerAppearance();
        var head = GearPivot(body, "Sculpted miner head", new Vector3(0, .616f, .008f));
        Rounded(head, "Neck", minerSkin, new Ring(-.045f,.062f,.057f), new Ring(.055f,.064f,.061f));
        // Cheek, jaw, brow and forehead are part of one continuous surface.
        var rows = new[] {
            new Ring(.012f,.043f,.052f,0,.019f), new Ring(.035f,.067f,.073f,0,.014f),
            new Ring(.065f,.087f,.088f,0,.003f), new Ring(.103f,.108f,.101f,0,0),
            new Ring(.140f,.112f,.105f,0,-.004f), new Ring(.171f,.105f,.106f,0,-.009f),
            new Ring(.202f,.101f,.111f,0,-.009f), new Ring(.241f,.096f,.101f,0,-.014f),
            new Ring(.275f,.070f,.074f,0,-.018f), new Ring(.288f,.027f,.039f,0,-.017f)
        };
        const int faceColumns = 25;
        Mesh face = Profile(faceColumns - 1, rows);
        Vector3[] vertices = face.vertices;
        for (int i = 0; i < rows.Length * faceColumns; i++)
        {
            Vector3 v = vertices[i];
            if (v.z > 0)
            {
                float cheeks = Mathf.Exp(-Mathf.Pow((Mathf.Abs(v.x) - .064f) / .037f, 2)) *
                    Mathf.Exp(-Mathf.Pow((v.y - .119f) / .036f, 2));
                v.z += cheeks * .015f;
                vertices[i] = v;
            }
        }
        face.vertices = vertices;
        face.RecalculateNormals();
        GearMesh(head, "Jaw and cheek planes", face, minerSkin);
        Rounded(head, "Angular nose", minerSkin,
            new Ring(.100f,.016f,.010f,0,.111f), new Ring(.111f,.029f,.021f,0,.119f),
            new Ring(.133f,.022f,.027f,0,.125f), new Ring(.172f,.012f,.010f,0,.106f),
            new Ring(.184f,.007f,.004f,0,.101f));
        Patch(head, "Mouth line", minerShadow, new[] {
            new Vector3(-.032f,.073f,.094f), new Vector3(-.014f,.077f,.102f),
            new Vector3(.014f,.077f,.102f), new Vector3(.033f,.080f,.093f),
            new Vector3(.021f,.071f,.101f), new Vector3(-.018f,.068f,.103f)
        });
        for (int side = -1; side <= 1; side += 2)
        {
            float x = side * .050f;
            Rounded(head, "Inset eye white", minerIvory,
                new Ring(.148f,.008f,.005f,x,.105f), new Ring(.152f,.018f,.007f,x,.108f),
                new Ring(.162f,.018f,.007f,x,.107f), new Ring(.168f,.008f,.004f,x,.103f));
            Rounded(head, "Dark iris", minerEyes, new Ring(.151f,.006f,.002f,x,.116f),
                new Ring(.163f,.007f,.003f,x,.116f));
            Patch(head, "Upper eyelid and brow", minerHair, new[] {
                new Vector3(x-side*.022f,.178f,.106f), new Vector3(x+side*.021f,.187f,.089f),
                new Vector3(x+side*.023f,.176f,.091f), new Vector3(x-side*.022f,.170f,.109f)
            });
            Rounded(head, "Ear", minerSkin, new Ring(.100f,.008f,.016f,side*.106f,-.001f),
                new Ring(.122f,.018f,.022f,side*.111f,-.001f),
                new Ring(.157f,.019f,.020f,side*.109f,-.005f), new Ring(.174f,.008f,.013f,side*.106f,-.008f));
            Rounded(head, "Ear hollow", minerShadow, new Ring(.119f,.006f,.009f,side*.121f,.012f),
                new Ring(.151f,.007f,.009f,side*.122f,.010f));
            Patch(head, "Temple hair", minerHair, new[] {
                new Vector3(side*.095f,.244f,.035f), new Vector3(side*.110f,.213f,.025f),
                new Vector3(side*.108f,.166f,.037f), new Vector3(side*.095f,.173f,.055f)
            });
        }
        // A short, shaped beard follows the jaw instead of a second floating head.
        for (int side = -1; side <= 1; side += 2)
            Patch(head, "Jaw stubble", minerShadow, new[] {
                new Vector3(side*.090f,.108f,.071f), new Vector3(side*.081f,.067f,.077f),
                new Vector3(side*.045f,.026f,.073f), new Vector3(0,.017f,.078f),
                new Vector3(0,.038f,.091f), new Vector3(side*.057f,.052f,.088f)
            });
        Rounded(head, "Back hair", minerHair, new Ring(.10f,.083f,.029f,0,-.084f),
            new Ring(.18f,.103f,.045f,0,-.078f), new Ring(.247f,.097f,.061f,0,-.055f));
        var cap = GearPivot(head, "Miner's leather helmet", Vector3.zero);
        Tailored(cap, "Helmet brim", hat, new Ring(.232f,.135f,.145f,0,.012f),
            new Ring(.241f,.143f,.151f,0,.015f), new Ring(.250f,.124f,.133f,0,.010f));
        Rounded(cap, "Pressed leather crown", hat, new Ring(.242f,.120f,.121f,0,-.005f),
            new Ring(.291f,.119f,.118f,0,-.012f), new Ring(.338f,.100f,.100f,0,-.016f),
            new Ring(.369f,.073f,.073f,0,-.014f), new Ring(.386f,.027f,.030f,0,-.012f));
        Rounded(cap, "Helmet band", cuff, new Ring(.252f,.122f,.124f,0,-.005f),
            new Ring(.271f,.121f,.122f,0,-.007f));
        var lamp = GearPivot(cap, "Headlamp brass housing", new Vector3(0,.286f,.124f));
        var housing = Rounded(lamp, "Headlamp rim", iron, new Ring(-.024f,.041f,.041f),
            new Ring(.006f,.044f,.044f), new Ring(.018f,.037f,.037f));
        housing.localRotation = Quaternion.Euler(90,0,0);
        var lens = Rounded(lamp, "Warm glass lens", minerLamp, new Ring(.017f,.031f,.031f), new Ring(.023f,.027f,.027f));
        lens.localRotation = housing.localRotation;
        MergeMinerPanels(head);
        MergeMinerPanels(cap);
        MergeMinerPanels(lamp);
    }

    private void DressProspector(Walker person, Transform sack, Transform flap)
    {
        InitMinerAppearance();
        var body = person.body;
        Tailored(body, "Scarf folds", scarf, new Ring(.558f,.095f,.079f),
            new Ring(.588f,.110f,.088f,0,.004f), new Ring(.627f,.086f,.076f,0,.009f));
        Patch(body, "Scarf knot and tail", scarf, new[] {
            new Vector3(-.035f,.60f,.095f), new Vector3(.038f,.59f,.095f),
            new Vector3(.054f,.45f,.145f), new Vector3(.014f,.47f,.150f), new Vector3(-.004f,.54f,.119f)
        });
        Tailored(body, "Leather waist belt", glove, new Ring(.027f,.207f,.135f), new Ring(.063f,.204f,.137f));
        Patch(body, "Belt buckle", iron, new[] {new Vector3(-.031f,.068f,.143f),new Vector3(.031f,.068f,.143f),
            new Vector3(.031f,.022f,.143f),new Vector3(-.031f,.022f,.143f)});
        Patch(body, "Buckle inset", glove, new[] {new Vector3(-.020f,.058f,.147f),new Vector3(.020f,.058f,.147f),
            new Vector3(.020f,.032f,.147f),new Vector3(-.020f,.032f,.147f)});
        Patch(body, "Coat front placket", cuff, new[] {
            new Vector3(-.014f,.49f,.151f), new Vector3(.014f,.49f,.151f),
            new Vector3(.014f,.07f,.141f), new Vector3(-.014f,.07f,.141f)
        });
        for (int i=0;i<4;i++)
            Rounded(body,"Horn coat button",minerSeam,new Ring(.13f+i*.095f,.006f,.005f,.001f,.151f),
                new Ring(.142f+i*.095f,.006f,.005f,.001f,.151f));
        for (int side = -1; side <= 1; side += 2)
        {
            float x = side * .107f;
            Tailored(body, "Bellows chest pocket", jacket,
                new Ring(.274f,.062f,.013f,x,.151f), new Ring(.294f,.067f,.022f,x,.151f),
                new Ring(.398f,.064f,.020f,x,.149f), new Ring(.417f,.057f,.012f,x,.148f));
            Patch(body, "Pocket flap", cuff, new[] {
                new Vector3(x-.063f,.422f,.174f),new Vector3(x+.063f,.422f,.174f),
                new Vector3(x+.060f,.395f,.177f),new Vector3(x,.383f,.182f),new Vector3(x-.060f,.395f,.177f)
            });
            // Rear straps attach to the animated bag so load changes stay visible.
            Tailored(sack, "Rucksack binding", glove, new Ring(.045f,.016f,.006f,side*.095f,-.140f),
                new Ring(.31f,.016f,.006f,side*.095f,-.149f),new Ring(.39f,.016f,.006f,side*.087f,-.117f));
            Tailored(flap, "Flap keeper", glove, new Ring(-.126f,.013f,.005f,side*.083f,-.109f),
                new Ring(-.012f,.013f,.005f,side*.083f,-.070f));
            Tailored(sack, "Rear buckle", iron, new Ring(.20f,.022f,.005f,side*.095f,-.149f),
                new Ring(.232f,.022f,.005f,side*.095f,-.149f));
        }
        MergeMinerPanels(sack);
        MergeMinerPanels(flap);
        MergeMinerPanels(body);
    }

    private void AddSleeveDetails(Transform shoulder, Transform elbow)
    {
        InitMinerAppearance();
        Rounded(elbow, "Turned canvas cuff", cuff, new Ring(-.236f,.046f,.051f),
            new Ring(-.205f,.050f,.054f),new Ring(-.191f,.047f,.051f));
        Patch(elbow, "Reinforced elbow panel", minerCanvas, new[] {
            new Vector3(-.043f,.006f,-.056f),new Vector3(.043f,.006f,-.056f),
            new Vector3(.041f,-.091f,-.072f),new Vector3(0,-.118f,-.075f),new Vector3(-.041f,-.091f,-.072f)
        });
        Rounded(elbow,"Glove thumb",glove,new Ring(-.291f,.013f,.019f,-.037f,.031f),
            new Ring(-.258f,.017f,.023f,-.037f,.032f),new Ring(-.243f,.009f,.011f,-.032f,.027f));
        MergeMinerPanels(shoulder);
        MergeMinerPanels(elbow);
    }

    private void AddWorkwearLeg(Transform hip, Transform knee, Transform boot)
    {
        InitMinerAppearance();
        Patch(hip, "Reinforced trouser knee", minerCanvas, new[] {
            new Vector3(-.057f,-.259f,.081f),new Vector3(.057f,-.259f,.081f),
            new Vector3(.052f,-.363f,.070f),new Vector3(0,-.383f,.067f),new Vector3(-.052f,-.363f,.070f)
        });
        Tailored(boot,"Layered boot sole",minerHair,new Ring(-.080f,.077f,.137f,0,.048f),
            new Ring(-.061f,.080f,.139f,0,.048f));
        for (int i=0;i<3;i++)
            Patch(boot,"Boot lace",minerSeam,new[] {
                new Vector3(-.030f,.014f+i*.017f,.077f-i*.005f),new Vector3(.029f,.014f+i*.017f,.077f-i*.005f),
                new Vector3(.029f,.019f+i*.017f,.077f-i*.005f),new Vector3(-.030f,.019f+i*.017f,.077f-i*.005f)
            });
        MergeMinerPanels(hip);
        MergeMinerPanels(knee);
        MergeMinerPanels(boot);
    }

    private Transform Patch(Transform parent, string name, Material material, Vector3[] outline)
    {
        int faceSize = outline.Length + 1;
        var vertices = new Vector3[faceSize * 2];
        var uv = new Vector2[vertices.Length];
        Vector3 center = Vector3.zero;
        foreach (Vector3 point in outline) center += point;
        vertices[0] = center / outline.Length;
        for (int i = 0; i < outline.Length; i++) vertices[i + 1] = outline[i];
        System.Array.Copy(vertices, 0, vertices, faceSize, faceSize);
        // Both sides are explicit because garment panels also appear from behind during motion.
        var triangles = new int[outline.Length * 6];
        for (int i = 0; i < outline.Length; i++)
        {
            int next = (i + 1) % outline.Length + 1;
            int index = i * 6;
            triangles[index] = 0;
            triangles[index + 1] = i + 1;
            triangles[index + 2] = next;
            triangles[index + 3] = faceSize;
            triangles[index + 4] = faceSize + next;
            triangles[index + 5] = faceSize + i + 1;
        }
        for (int i = 0; i < vertices.Length; i++) uv[i] = new Vector2(vertices[i].x * 3, vertices[i].y * 3);
        var mesh = new Mesh { name = name, vertices = vertices, triangles = triangles, uv = uv };
        mesh.RecalculateNormals();
        return GearMesh(parent,name,mesh,material);
    }

    // Consolidate static details per articulation and material. Arms, bag, flap and tools
    // retain their individual pivots for the existing locomotion and inventory animation.
    private void MergeMinerPanels(Transform parent)
    {
        var groups = new Dictionary<Material, List<MeshFilter>>();
        for (int i = 0; i < parent.childCount; i++)
        {
            var child = parent.GetChild(i);
            var filter = child.GetComponent<MeshFilter>();
            var renderer = child.GetComponent<MeshRenderer>();
            if (!filter || !renderer || child.childCount > 0) continue;
            if (!groups.TryGetValue(renderer.sharedMaterial, out var group))
            {
                group = new List<MeshFilter>();
                groups[renderer.sharedMaterial] = group;
            }
            group.Add(filter);
        }
        foreach (var group in groups)
        {
            if (group.Value.Count < 2) continue;
            var combines = new CombineInstance[group.Value.Count];
            for (int i = 0; i < combines.Length; i++)
            {
                MeshFilter filter = group.Value[i];
                combines[i] = new CombineInstance
                {
                    mesh = filter.sharedMesh,
                    transform = parent.worldToLocalMatrix * filter.transform.localToWorldMatrix
                };
                filter.gameObject.SetActive(false);
                Destroy(filter.gameObject);
            }
            var mesh = new Mesh { name = "Tailored miner panels" };
            mesh.CombineMeshes(combines, true, true);
            foreach (var combine in combines) Destroy(combine.mesh);
            GearMesh(parent, "Joined workwear panels", mesh, group.Key);
        }
    }
}
