using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

public partial class OrbitGame
{
    private sealed class RareSiteView
    {
        public bool Announced, Exposed;
        public bool LastRumble;
    }

    private readonly Dictionary<string,RareSiteView> rareSites = new Dictionary<string,RareSiteView>();

    // Shared by the world landmarks and any HUD reference to a gold site.
    internal static string GoldSiteName(string id)
    {
        switch(id)
        {
            case "gold-1": return "北の旧切羽";
            case "gold-2": return "南の滑車場";
            case "gold-3": return "西の割れ岩";
            case "gold-4": return "東の測量場";
            default: return "金鉱";
        }
    }

    private void UpdateRareSites()
    {
        foreach(var vein in veins.Values)
        {
            if(vein.Data.kind != "gold") continue;
            if(!rareSites.TryGetValue(vein.Data.id,out var site))
            {
                site = new RareSiteView();
                rareSites[vein.Data.id] = site;
                BuildRareLandmark(vein);
            }
            var data=vein.Data;
            bool forecast=data.announced && data.opensIn > 0;
            bool exposed=data.active && data.hp > 0;
            if(forecast && !site.Announced)
            {
                site.LastRumble=false;
                SiteRumble(vein,.17f);
            }
            if(forecast && data.opensIn <= 1.8f && !site.LastRumble)
            {
                site.LastRumble=true;
                SiteRumble(vein,.23f);
            }
            if(site.Exposed && !exposed)
                SiteRumble(vein,.14f);
            site.Announced=forecast;
            site.Exposed=exposed;
            if(vein.Rock)
            {
                vein.Surface.SetFloat("_Preview",forecast ? Mathf.Clamp01(1 - data.opensIn / 6f) : 0);
                vein.Rock.SetPropertyBlock(vein.Surface);
            }
        }
    }

    private void SiteRumble(VeinView vein,float volume)
    {
        Vector3 point=vein.Root.position + Vector3.up * vein.Height*.82f;
        if((point-cam.transform.position).sqrMagnitude > 28*28) return;
        if(breakSound) AudioSource.PlayClipAtPoint(breakSound,point,volume);
        // Existing impact particles share their mesh and lifetime budget.
        EnsureMiningParticleAssets();
        for(int i=0;i<3;i++)
            AddChip(point + new Vector3((i-1)*.15f,.08f,.025f),
                new Vector3((i-1)*.24f,-.22f,.16f),.045f+i*.012f,.58f,
                stone,Color.white,false,false);
    }

    private void BuildRareLandmark(VeinView vein)
    {
        var root=GearPivot(vein.Root,GoldSiteName(vein.Data.id),Vector3.zero);
        switch(vein.Data.id)
        {
            case "gold-1":
                BuildOldCutProps(root);
                break;
            case "gold-2":
                var rig=SharedSiteRoot(root,"south-hoist-mast","hoist","Grounded quarry hand winch");
                if(!rig) break;
                Rounded(rig,"Weathered hoist mast",wood,
                    new Ring(.02f,.09f,.075f),new Ring(1.7f,.077f,.068f),
                    new Ring(2.75f,.064f,.061f,-.04f),new Ring(2.92f,.061f,.057f,-.05f));
                var boom=Rounded(rig,"Hoist boom",wood,new Ring(-1.18f,.068f,.06f),new Ring(.43f,.065f,.057f));
                boom.localPosition=new Vector3(-.30f,2.76f,0);
                boom.localRotation=Quaternion.Euler(0,0,-90);
                Rounded(rig,"Hoist diagonal brace",wood,new Ring(1.58f,.045f,.037f,-.02f),
                    new Ring(2.61f,.045f,.037f,-.86f));
                Rounded(rig,"Pulley suspension cheek",iron,new Ring(2.52f,.040f,.026f,-1.35f),
                    new Ring(2.78f,.040f,.026f,-1.35f));
                var wheel=GearMesh(rig,"Iron pulley rim",PulleyMesh(.19f,.135f,.034f),iron);
                wheel.localPosition=new Vector3(-1.35f,2.55f,0);
                var axle=Rounded(rig,"Hoist axle",iron,new Ring(-.11f,.028f,.028f),new Ring(.11f,.028f,.028f));
                axle.localPosition=wheel.localPosition;
                axle.localRotation=Quaternion.Euler(90,0,0);
                var winch=GearMesh(rig,"Winding drum",PulleyMesh(.14f,.055f,.13f),wood);
                winch.localPosition=new Vector3(0,1.12f,.15f);
                var cable=new GameObject("Tensioned hoist cable").AddComponent<LineRenderer>();
                cable.transform.SetParent(rig,false);cable.useWorldSpace=false;
                cable.sharedMaterial=ropeMat;cable.startColor=cable.endColor=new Color(.29f,.23f,.15f);
                cable.startWidth=cable.endWidth=.014f;cable.positionCount=4;
                cable.SetPositions(new[]{new Vector3(0,1.26f,.16f),new Vector3(-1.30f,2.72f,.02f),
                    new Vector3(-1.50f,2.56f,.02f),new Vector3(-1.50f,2.12f,.02f)});
                var hook=Rounded(rig,"Forged lifting hook above striking height",iron,
                    new Ring(1.98f,.016f,.017f,-1.48f,.02f),
                    new Ring(1.99f,.022f,.023f,-1.54f,.02f),
                    new Ring(2.02f,.020f,.020f,-1.57f,.02f),
                    new Ring(2.07f,.016f,.016f,-1.54f,.02f),
                    new Ring(2.13f,.014f,.014f,-1.50f,.02f));
                var crank=Rounded(rig,"Winch crank arm",iron,new Ring(-.13f,.018f,.017f),new Ring(.13f,.018f,.017f));
                crank.localPosition=new Vector3(0,1.12f,.32f);crank.localRotation=Quaternion.Euler(0,0,40);
                Rounded(rig,"Winch hand grip",wrapping,new Ring(1.18f,.023f,.023f,.083f,.40f),
                    new Ring(1.27f,.023f,.023f,.083f,.40f));
                break;
            case "gold-3":
                // Wedges and a laid-down sledge identify the old split without
                // occupying the upper striking face or inventing a pointed stone pillar.
                var wedges=GearPivot(root,"Grounded splitting tools",new Vector3(.54f,.045f,.08f));
                for(int side=-1;side<=1;side+=2)
                {
                    var wedge=Rounded(wedges,"Quarry feather",iron,
                        new Ring(0,.025f,.018f,side*.055f),new Ring(.18f,.044f,.029f,side*.06f),
                        new Ring(.30f,.036f,.027f,side*.065f));
                    wedge.localRotation=Quaternion.Euler(0,0,side*13);
                }
                var hammer=GearPivot(root,"Laid quarry sledge",new Vector3(.22f,.12f,.48f));
                hammer.localRotation=Quaternion.Euler(0,24,-88);
                Rounded(hammer,"Ash sledge handle",wood,new Ring(-.42f,.022f,.020f),new Ring(.31f,.026f,.023f));
                var head=Rounded(hammer,"Forged sledge head",iron,new Ring(-.11f,.070f,.067f),
                    new Ring(-.08f,.078f,.074f),new Ring(.08f,.078f,.074f),new Ring(.11f,.070f,.067f));
                head.localPosition=new Vector3(0,.30f,0);head.localRotation=Quaternion.Euler(0,0,90);
                break;
            case "gold-4":
                var survey=SharedSiteRoot(root,"east-survey-table","survey","Survey plane table beside the seam");
                if(!survey) break;
                survey.rotation=Quaternion.LookRotation(vein.Root.position-survey.position,Vector3.up);
                survey.rotation=Quaternion.Euler(0,survey.eulerAngles.y,0);
                survey.localScale=Vector3.one*.78f;
                for(int leg=0;leg<3;leg++)
                {
                    float angle=leg*Mathf.PI*2/3;
                    var foot=survey.TransformPoint(new Vector3(Mathf.Cos(angle)*.58f,0,Mathf.Sin(angle)*.52f));
                    float footY=(ValleyLandscape.Height(foot.x,foot.z)-survey.position.y)/.78f+.015f;
                    Rounded(survey,"Survey tripod",wood,
                        new Ring(footY,.033f,.028f,Mathf.Cos(angle)*.58f,Mathf.Sin(angle)*.52f),
                        new Ring(.76f,.030f,.025f,Mathf.Cos(angle)*.33f,Mathf.Sin(angle)*.30f),
                        new Ring(1.58f,.026f,.023f,Mathf.Cos(angle)*.14f,Mathf.Sin(angle)*.13f));
                }
                Rounded(survey,"Survey plane table",wood,new Ring(1.57f,.31f,.27f),new Ring(1.62f,.31f,.27f));
                Rounded(survey,"Brass alidade",brass,new Ring(1.62f,.026f,.20f),new Ring(1.68f,.025f,.20f));
                Rounded(survey,"Survey sight",iron,new Ring(1.68f,.018f,.017f,0,.16f),new Ring(1.84f,.018f,.017f,0,.16f));
                break;
        }
        foreach(var renderer in root.GetComponentsInChildren<MeshRenderer>())
        {
            renderer.shadowCastingMode=ShadowCastingMode.On;
            renderer.receiveShadows=true;
        }
    }

    private Mesh PulleyMesh(float outer,float inner,float halfDepth)
    {
        const int sides=20;
        var vertices=new Vector3[(sides+1)*4];
        var uv=new Vector2[vertices.Length];
        var faces=new List<int>();
        for(int i=0;i<=sides;i++)
        {
            float angle=i*Mathf.PI*2/sides;
            for(int ring=0;ring<4;ring++)
            {
                float radius=ring%2==0 ? outer : inner;
                vertices[i*4+ring]=new Vector3(Mathf.Cos(angle)*radius,Mathf.Sin(angle)*radius,ring<2 ? -halfDepth : halfDepth);
                uv[i*4+ring]=new Vector2(i/(float)sides,ring*.33f);
            }
            if(i==sides) continue;
            int a=i*4,b=a+4;
            faces.AddRange(new[]{a,a+1,b,a+1,b+1,b,a+2,b+2,a+3,a+3,b+2,b+3,
                a,b,a+2,a+2,b,b+2,a+1,a+3,b+1,a+3,b+3,b+1});
        }
        var mesh=new Mesh {name="Forged pulley wheel",vertices=vertices,uv=uv,triangles=faces.ToArray()};
        mesh.RecalculateNormals();
        return mesh;
    }
}
