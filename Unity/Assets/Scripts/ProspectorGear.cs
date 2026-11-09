using UnityEngine;

public partial class OrbitGame
{
    private const int GearLayer = 29;
    private static readonly Vector3 PickPoint = new Vector3(-.238f, .182f, 0);
    private static readonly Vector3 GearRest = new Vector3(.355f, -.357f, .80f);
    private static readonly Vector3 GearRestAngle = new Vector3(-12, -31, -22);
    private Material jacket, trousers, glove, cuff, iron, edge, hat, scarf, pack;
    private Mesh ashMesh, ironMesh, edgeMesh, ferruleMesh;
    private AudioClip soilStep, gravelStep;

    private void BuildProspectorGear()
    {
        jacket = GearMaterial(new Color(.64f, .74f, .59f), "Denim");
        trousers = GearMaterial(new Color(.52f, .60f, .67f), "Denim");
        cuff = GearMaterial(new Color(.65f, .48f, .29f), "Denim");
        glove = GearMaterial(new Color(.25f, .155f, .10f), null, .22f);
        hat = GearMaterial(new Color(.33f, .25f, .15f), null);
        scarf = GearMaterial(new Color(.59f, .24f, .12f), null);
        pack = GearMaterial(new Color(.59f, .47f, .29f), "Denim");
        iron = GearMaterial(new Color(.58f, .62f, .63f), "Oxide", .44f, .67f);
        edge = GearMaterial(new Color(.40f, .43f, .44f), null, .64f, .62f);
        var leatherPanel = GearMaterial(new Color(.51f, .335f, .21f), "Denim", .2f);
        var ash = Material(new Color(.74f, .56f, .33f));
        ash.mainTexture = wood.mainTexture;

        tool = GearPivot(cam.transform, "Hand-held miner's pick", GearRest);
        tool.localRotation = Quaternion.Euler(GearRestAngle);
        MountPick(tool, ash);
        Rounded(tool, "Glove palm", glove,
            new Ring(-.060f,.024f,.020f,0,-.025f), new Ring(-.032f,.034f,.027f,0,-.027f),
            new Ring(.014f,.034f,.026f,.003f,-.029f), new Ring(.040f,.026f,.019f,.006f,-.023f));
        Rounded(tool, "Glove knuckle reinforcement", leatherPanel,
            new Ring(-.043f,.016f,.005f,.009f,-.048f), new Ring(-.019f,.026f,.008f,.010f,-.050f),
            new Ring(.012f,.028f,.008f,.010f,-.049f), new Ring(.034f,.020f,.005f,.008f,-.042f));
        for (int i = 0; i < 5; i++)
        {
            float y = -.033f + i * .013f;
            Rounded(tool, "Glove saddle stitch", cuff, new Ring(y,.0028f,.0016f,.026f,-.054f),
                new Ring(y + .006f,.0028f,.0016f,.028f,-.054f));
        }
        for (int i = 0; i < 4; i++)
        {
            float y = .041f - i * .022f;
            float length = 1 - i * .055f;
            var finger = Rounded(tool, "Wrapped glove finger", glove,
                new Ring(-.024f,.007f,.009f,0,.012f), new Ring(-.013f,.011f,.012f,0,.023f),
                new Ring(.014f,.011f,.013f,0,.026f), new Ring(.029f,.009f,.012f,0,.016f),
                new Ring(.034f,.007f,.008f,0,.001f));
            finger.localPosition = new Vector3(0,y,0);
            finger.localRotation = Quaternion.Euler(0, 0, -90);
            finger.localScale = new Vector3(1,length,1);
        }
        var thumb = Rounded(tool, "Opposed thumb", glove,
            new Ring(-.035f,.012f,.011f,0,-.015f), new Ring(-.012f,.015f,.013f,-.003f,.004f),
            new Ring(.018f,.012f,.010f,.006f,.008f), new Ring(.027f,.008f,.007f,.009f,.005f));
        thumb.localPosition = new Vector3(-.029f,.005f,.002f);
        thumb.localRotation = Quaternion.Euler(7, 0, -41);
        Rounded(tool, "Heavy canvas forearm", jacket,
            new Ring(-.282f,.081f,.079f,.136f,-.081f), new Ring(-.224f,.071f,.074f,.103f,-.062f),
            new Ring(-.131f,.058f,.063f,.039f,-.036f), new Ring(-.078f,.046f,.049f,.014f,-.031f),
            new Ring(-.063f,.043f,.043f,.009f,-.026f));
        Rounded(tool, "Canvas cuff", cuff, new Ring(-.101f,.049f,.051f,.024f,-.034f),
            new Ring(-.074f,.047f,.048f,.013f,-.030f), new Ring(-.061f,.042f,.043f,.009f,-.026f));
        // Render the hands over the scene depth so a rock at arm's reach cannot cut through the grip.
        cam.cullingMask &= ~(1 << GearLayer);
        var view = GearPivot(cam.transform, "Hands camera", Vector3.zero).gameObject.AddComponent<Camera>();
        view.clearFlags = CameraClearFlags.Depth;
        view.depth = cam.depth + 1;
        view.cullingMask = 1 << GearLayer;
        view.fieldOfView = 64;
        view.nearClipPlane = .025f;
        view.farClipPlane = 2.5f;
        view.useOcclusionCulling = false;
        view.allowHDR = cam.allowHDR;
        view.allowMSAA = cam.allowMSAA;
        foreach (var renderer in tool.GetComponentsInChildren<MeshRenderer>())
        {
            renderer.gameObject.layer = GearLayer;
            renderer.receiveShadows = false;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        }
        soilStep = Resources.Load<AudioClip>("MiningAudio/footstep-dirt");
        gravelStep = Resources.Load<AudioClip>("MiningAudio/footstep-gravel-short")??Resources.Load<AudioClip>("MiningAudio/footstep-gravel");
    }

    private Material GearMaterial(Color color, string texture, float smoothness = .16f, float metallic = 0)
    {
        var result = Material(color);
        result.SetFloat("_Smoothness", smoothness);
        result.SetFloat("_Metallic", metallic);
        if (texture != null)
        {
            result.mainTexture = Resources.Load<Texture2D>("ProspectorGear/" + texture);
            result.SetFloat("_NeutralTexture", 1);
        }
        return result;
    }

    private void MountPick(Transform parent, Material ash)
    {
        if (ashMesh == null)
        {
            ashMesh = Profile(new Ring(-.260f,.019f,.015f,.026f), new Ring(-.237f,.024f,.018f,.024f),
                new Ring(-.187f,.020f,.016f,.019f), new Ring(-.046f,.018f,.017f,.004f),
                new Ring(.071f,.015f,.014f,-.005f), new Ring(.194f,.016f,.015f,-.005f),
                new Ring(.268f,.018f,.017f), new Ring(.286f,.014f,.013f));
            ironMesh = Profile(new Ring(-.219f,.006f,.007f,-.193f), new Ring(-.175f,.012f,.015f,-.211f),
                new Ring(-.100f,.020f,.023f,-.237f), new Ring(-.036f,.026f,.029f,-.250f),
                new Ring(.018f,.028f,.027f,-.249f), new Ring(.070f,.021f,.024f,-.237f),
                new Ring(.109f,.014f,.037f,-.219f));
            edgeMesh = Profile(new Ring(PickPoint.x,.002f,.002f,-PickPoint.y),
                new Ring(-.219f,.006f,.007f,-.193f));
            ferruleMesh = Profile(new Ring(.218f,.022f,.022f), new Ring(.228f,.028f,.026f),
                new Ring(.262f,.031f,.028f), new Ring(.272f,.025f,.023f));
        }
        GearMesh(parent, "Contoured ash haft", ashMesh, ash);
        GearMesh(parent, "Forged steel eye", ferruleMesh, iron);
        var head = GearMesh(parent, "Forged point and adze", ironMesh, iron);
        head.localRotation = Quaternion.Euler(0, 0, -90);
        var tip = GearMesh(parent, "Dressed point", edgeMesh, edge);
        tip.localRotation = head.localRotation;
        RegisterPickAssembly(parent, head, tip);
    }

    private Walker Person()
    {
        var person = new Walker { root = new GameObject("Walking prospector").transform };
        person.root.localScale = new Vector3(valley.combat.bodyScale, 1, valley.combat.bodyScale);
        person.body = GearPivot(person.root, "Upper body", new Vector3(0,.79f,0));
        Rounded(person.body, "Field jacket", jacket,
            new Ring(-.05f,.19f,.119f), new Ring(.05f,.203f,.135f), new Ring(.19f,.182f,.134f),
            new Ring(.39f,.220f,.151f), new Ring(.53f,.228f,.136f), new Ring(.64f,.101f,.086f));
        Rounded(person.body, "Work collar", scarf, new Ring(.565f,.126f,.103f), new Ring(.62f,.115f,.098f),
            new Ring(.70f,.096f,.086f));
        Rounded(person.body, "Face", skin, new Ring(.65f,.064f,.061f,0,.029f),
            new Ring(.69f,.085f,.088f,0,.012f), new Ring(.76f,.108f,.106f,0,.002f),
            new Ring(.84f,.101f,.110f,0,-.003f), new Ring(.90f,.078f,.085f));
        Rounded(person.body, "Nose bridge", skin, new Ring(.734f,.014f,.014f,0,.101f),
            new Ring(.751f,.021f,.021f,0,.109f), new Ring(.793f,.013f,.012f,0,.104f));
        Rounded(person.body, "Felt hatband", cuff, new Ring(.881f,.121f,.13f),
            new Ring(.900f,.117f,.126f));
        Rounded(person.body, "Felt brim", hat, new Ring(.854f,.166f,.192f,0,.023f),
            new Ring(.865f,.174f,.198f,0,.022f), new Ring(.883f,.152f,.181f,0,.018f));
        Rounded(person.body, "Creased hat", hat, new Ring(.871f,.115f,.124f),
            new Ring(.914f,.110f,.119f), new Ring(.986f,.095f,.103f), new Ring(1.001f,.068f,.083f,0,-.014f));
        var sack=GearPivot(person.body,"Canvas rucksack volume",new Vector3(0,.09f,-.14f));
        Rounded(sack, "Canvas rucksack", pack, new Ring(0,.13f,.075f,0,-.034f),
            new Ring(.07f,.164f,.091f,0,-.045f), new Ring(.31f,.16f,.095f,0,-.047f),
            new Ring(.40f,.137f,.079f,0,-.031f), new Ring(.44f,.11f,.064f,0,-.015f));
        var flap=GearPivot(person.body,"Rucksack flap hinge",new Vector3(0,.50f,-.19f));
        Rounded(flap, "Rucksack flap", cuff, new Ring(-.134f,.14f,.018f,0,-.082f),
            new Ring(-.08f,.152f,.026f,0,-.075f), new Ring(-.007f,.135f,.028f,0,-.039f),
            new Ring(.018f,.113f,.017f,0,-.001f));
        RegisterLoadBackpack(person,sack,flap);
        for (int side = -1; side <= 1; side += 2)
        {
            float x = side * .14f;
            Rounded(person.body, "Shoulder webbing", cuff, new Ring(.11f,.022f,.019f,x,.113f),
                new Ring(.29f,.022f,.018f,x,.148f), new Ring(.45f,.024f,.021f,x,.127f),
                new Ring(.56f,.024f,.025f,x,.083f));
        }
        person.leftArm = MakeArm(person.body, -.229f, out person.leftElbow);
        person.rightArm = MakeArm(person.body, .229f, out person.rightElbow);
        person.leftLeg = MakeLeg(person.root, -.104f, out person.leftKnee, out person.leftBoot);
        person.rightLeg = MakeLeg(person.root, .104f, out person.rightKnee, out person.rightBoot);
        var held = GearPivot(person.rightElbow, "Held miner's pick", new Vector3(0,-.276f,.025f));
        held.localRotation = Quaternion.Euler(-30, 25, 12);
        held.localScale = Vector3.one * .86f;
        MountPick(held, wood);
        RegisterProspectorToolkit(person, held);
        return person;
    }

    private Transform MakeArm(Transform body, float x, out Transform elbow)
    {
        var shoulder = GearPivot(body, "Shoulder", new Vector3(x,.504f,0));
        Rounded(shoulder, "Jacket upper sleeve", jacket, new Ring(-.296f,.045f,.048f), new Ring(-.245f,.065f,.071f),
            new Ring(-.205f,.073f,.076f), new Ring(-.10f,.084f,.083f),
            new Ring(.007f,.083f,.080f), new Ring(.061f,.056f,.061f));
        elbow = GearPivot(shoulder, "Elbow", new Vector3(0,-.244f,0));
        Rounded(elbow, "Jacket lower sleeve", jacket, new Ring(-.235f,.044f,.049f),
            new Ring(-.177f,.052f,.058f), new Ring(-.065f,.064f,.071f), new Ring(-.009f,.066f,.070f), new Ring(.044f,.047f,.052f));
        Rounded(elbow, "Work glove", glove, new Ring(-.321f,.027f,.029f,0,.010f),
            new Ring(-.302f,.041f,.040f,0,.014f), new Ring(-.252f,.045f,.043f,0,.007f),
            new Ring(-.221f,.039f,.040f));
        return shoulder;
    }

    private Transform MakeLeg(Transform root, float x, out Transform knee, out Transform boot)
    {
        var hip = GearPivot(root, "Hip", new Vector3(x,.78f,0));
        Rounded(hip, "Trouser thigh", trousers, new Ring(-.409f,.052f,.059f), new Ring(-.352f,.076f,.080f),
            new Ring(-.277f,.086f,.092f), new Ring(-.109f,.101f,.119f),
            new Ring(.035f,.108f,.114f), new Ring(.077f,.091f,.087f));
        knee = GearPivot(hip, "Knee", new Vector3(0,-.352f,0));
        Rounded(knee, "Trouser calf", trousers, new Ring(-.298f,.059f,.061f),
            new Ring(-.192f,.074f,.079f,0,-.012f), new Ring(-.086f,.079f,.078f),
            new Ring(-.012f,.075f,.079f), new Ring(.049f,.055f,.061f));
        boot = GearPivot(knee, "Ankle", new Vector3(0,-.342f,0));
        Rounded(boot, "Laced leather boot", glove, new Ring(-.080f,.073f,.134f,0,.047f),
            new Ring(-.056f,.077f,.135f,0,.046f), new Ring(-.021f,.071f,.122f,0,.036f),
            new Ring(.027f,.060f,.073f,0,.002f), new Ring(.076f,.061f,.068f,0,-.004f));
        return hip;
    }

    private void LateUpdate()
    {
        AnimateInvestmentVisuals();
        foreach (var person in walkers.Values)
        {
            if (person.data == null) continue;
            float leftStride = Mathf.DeltaAngle(0, person.leftLeg.localEulerAngles.x);
            float rightStride = Mathf.DeltaAngle(0, person.rightLeg.localEulerAngles.x);
            float stride = Mathf.Max(Mathf.Abs(leftStride), Mathf.Abs(rightStride));
            person.body.localPosition = new Vector3(0,.79f + stride * .0014f,0);
            person.body.localRotation = Quaternion.Euler(person.data.sprinting ? 8 : stride * .22f, leftStride * .45f, rightStride * .24f);
            float speed = (person.step - person.lastGearStep) / (4 * Mathf.Max(Time.deltaTime, .001f));
            person.lastGearStep = person.step;
            person.gearPace = Mathf.MoveTowards(person.gearPace, Mathf.Clamp01(speed / 2.5f), Time.deltaTime * 6);
            PlaceBoot(person.leftLeg, person.leftKnee, person.leftBoot, person.step, person.gearPace);
            PlaceBoot(person.rightLeg, person.rightKnee, person.rightBoot, person.step + Mathf.PI, person.gearPace);
            person.leftElbow.localRotation = Quaternion.Euler(-14 - Mathf.Max(0, rightStride) * 1.5f,0,0);
            float striking = Mathf.Sin(Mathf.Clamp01(person.cut) * Mathf.PI);
            person.rightElbow.localRotation = Quaternion.Euler(-23 - striking * 32 - Mathf.Max(0, leftStride),0,0);
        }
        AnimateLoadBackpacks();
        PoseRemoteCrossbows();
    }

    private void PlaceBoot(Transform hip, Transform knee, Transform boot, float phase, float pace)
    {
        const float thigh = .352f, shin = .342f;
        // In stance the heel travels backwards at a nearly constant rate in body space.
        float turn = Mathf.Repeat(phase / (2 * Mathf.PI), 1);
        const float stance = .55f;
        float swing = Mathf.Clamp01((turn - stance) / (1 - stance));
        float travel = turn < stance ? Mathf.Lerp(1, -1, turn / stance) : Mathf.SmoothStep(-1, 1, swing);
        float lift = Mathf.Sin(Mathf.PI * swing) * .112f * pace;
        hip.localPosition = new Vector3(hip.localPosition.x, .755f - .055f * pace, 0);
        Vector3 target = hip.position + hip.parent.forward * (travel * .31f * pace);
        target.y = ValleyLandscape.Height(target.x, target.z) + .080f + lift;
        Vector3 offset = hip.parent.InverseTransformDirection(target - hip.position);
        float distance = Mathf.Clamp(offset.magnitude, .16f, thigh + shin - .001f);
        float along = (thigh * thigh + distance * distance - shin * shin) / (2 * distance);
        Vector3 direction = offset.normalized;
        Vector3 forward = Vector3.ProjectOnPlane(Vector3.forward, direction).normalized;
        Vector3 joint = direction * along + forward * Mathf.Sqrt(Mathf.Max(0, thigh * thigh - along * along));
        hip.localRotation = Quaternion.FromToRotation(Vector3.down, joint);
        Vector3 lower = Quaternion.Inverse(hip.localRotation) * (direction * distance - joint);
        knee.localRotation = Quaternion.FromToRotation(Vector3.down, lower);
        boot.localRotation = Quaternion.Inverse(hip.localRotation * knee.localRotation) * Quaternion.Euler(lift * 95, 0, 0);
    }

    private readonly struct Ring
    {
        public readonly float Y, Width, Depth, X, Z;
        public Ring(float y, float width, float depth, float x = 0, float z = 0)
        {
            Y = y; Width = width; Depth = depth; X = x; Z = z;
        }
    }

    private Mesh Profile(params Ring[] rings)
    {
        const int sides = 12, columns = sides + 1;
        var vertices = new Vector3[rings.Length * columns + 2];
        var uv = new Vector2[vertices.Length];
        var indices = new int[((rings.Length - 1) * sides * 2 + sides * 2) * 3];
        int next = 0;
        for (int r = 0; r < rings.Length; r++)
        {
            Ring ring = rings[r];
            for (int i = 0; i <= sides; i++)
            {
                int a = r * columns + i;
                float u = i / (float)sides;
                float angle = u * Mathf.PI * 2;
                vertices[a] = new Vector3(ring.X + Mathf.Cos(angle) * ring.Width, ring.Y, ring.Z + Mathf.Sin(angle) * ring.Depth);
                uv[a] = new Vector2(u, (ring.Y - rings[0].Y) * 2.6f);
                if (i == sides) continue;
                if (r + 1 < rings.Length)
                {
                    indices[next++] = a; indices[next++] = a + columns; indices[next++] = a + columns + 1;
                    indices[next++] = a; indices[next++] = a + columns + 1; indices[next++] = a + 1;
                }
                if (r == 0) { indices[next++] = vertices.Length - 2; indices[next++] = a; indices[next++] = a + 1; }
                if (r == rings.Length - 1) { indices[next++] = vertices.Length - 1; indices[next++] = a + 1; indices[next++] = a; }
            }
        }
        Ring top = rings[rings.Length - 1];
        vertices[vertices.Length - 2] = new Vector3(rings[0].X,rings[0].Y,rings[0].Z);
        vertices[vertices.Length - 1] = new Vector3(top.X,top.Y,top.Z);
        var mesh = new Mesh { vertices = vertices, uv = uv, triangles = indices };
        mesh.RecalculateNormals();
        var normals = mesh.normals;
        for (int r = 0; r < rings.Length; r++)
        {
            int a = r * columns;
            normals[a] = normals[a + sides] = (normals[a] + normals[a + sides]).normalized;
        }
        mesh.normals = normals;
        return mesh;
    }

    private Transform Rounded(Transform parent, string name, Material material, params Ring[] rings)
    {
        return GearMesh(parent, name, Profile(rings), material);
    }

    private Transform GearMesh(Transform parent, string name, Mesh mesh, Material material)
    {
        var piece = GearPivot(parent, name, Vector3.zero);
        piece.gameObject.AddComponent<MeshFilter>().sharedMesh = mesh;
        piece.gameObject.AddComponent<MeshRenderer>().sharedMaterial = material;
        return piece;
    }

    private static Transform GearPivot(Transform parent, string name, Vector3 position)
    {
        var pivot = new GameObject(name).transform;
        pivot.SetParent(parent, false);
        pivot.localPosition = position;
        return pivot;
    }
}
