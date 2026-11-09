using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

public partial class OrbitGame
{
    private sealed class TradeLantern
    {
        public Renderer Glass;
        public Transform Flame;
        public Light Light;
        public float Heat;
        public readonly MaterialPropertyBlock Surface = new MaterialPropertyBlock();
    }
    private readonly Dictionary<string, TradeLantern[]> tradingLights = new Dictionary<string, TradeLantern[]>();
    private Material tradingMetal, tradingGlass, tradingFlame;

    private void UpdateTradingLights()
    {
        if (state?.stations == null || !wood || !metal) return;
        foreach (var station in state.stations)
        {
            if (!tradingLights.TryGetValue(station.id, out var lamps))
            {
                if (!tradingMetal)
                {
                    tradingMetal = GearMaterial(new Color(.26f,.235f,.19f), "Oxide", .24f, .45f);
                    tradingGlass = new Material(Resources.Load<Shader>("TradingLampGlass"));
                    tradingFlame = Material(new Color(.85f,.52f,.19f));
                    tradingFlame.EnableKeyword("_EMISSION");
                    tradingFlame.SetColor("_EmissionColor",new Color(1.2f,.73f,.22f));
                }
                var fixture = GearPivot(transform,"Permanent trading lanterns " + station.id, Vector3.zero);
                Vector3 foot = new Vector3(station.x,station.y,station.z);
                Quaternion turn = Quaternion.identity;
                bool central = station.id == "central";
                if (!central)
                {
                    turn = Quaternion.Euler(0,station.id == "west" ? 40 : -35,0);
                    foot.y = ValleyLandscape.Height(foot.x,foot.z);
                }
                fixture.position = foot; fixture.rotation = turn;
                lamps = new TradeLantern[2];
                for (int side = 0; side < 2; side++)
                    lamps[side] = BuildTradeLantern(fixture, new Vector3((side*2-1)*(central ? 3.6f : .97f),central ? 2.8f : 1.72f,central ? 0 : .15f), central ? 1.57f : .73f);
                tradingLights.Add(station.id,lamps);
            }
            float target = station.hot && state.phase == "playing" ? 1 : 0;
            foreach (var lamp in lamps)
            {
                float heat = Mathf.MoveTowards(lamp.Heat,target,Time.deltaTime*3);
                if (Mathf.Abs(heat-lamp.Heat) < .001f) continue;
                lamp.Heat = heat;
                lamp.Surface.SetFloat("_Heat",heat); lamp.Glass.SetPropertyBlock(lamp.Surface);
                lamp.Flame.gameObject.SetActive(heat > .08f);
                lamp.Flame.localScale = new Vector3(1,heat,1);
                lamp.Light.enabled = heat > .01f; lamp.Light.intensity = heat*.95f;
            }
        }
    }

    private TradeLantern BuildTradeLantern(Transform parent, Vector3 position, float suspensionTop)
    {
        var root = GearPivot(parent,"Hanging fuel lantern",position);
        Rounded(root,"Fuel reservoir",tradingMetal,new Ring(-.13f,.12f,.12f),new Ring(-.10f,.15f,.15f),new Ring(-.025f,.14f,.14f),new Ring(0,.09f,.09f));
        var glass = Rounded(root,"Glass chimney",tradingGlass,new Ring(0,.095f,.095f),new Ring(.07f,.12f,.12f),new Ring(.28f,.10f,.10f),new Ring(.33f,.07f,.07f));
        Rounded(root,"Burner",tradingMetal,new Ring(.01f,.055f,.055f),new Ring(.045f,.055f,.055f));
        Rounded(root,"Vented iron hood",tradingMetal,new Ring(.32f,.14f,.14f),new Ring(.37f,.14f,.14f),new Ring(.42f,.065f,.065f),new Ring(.46f,.06f,.06f));
        for (int rib=0;rib<4;rib++)
        {
            float angle=rib*Mathf.PI*.5f;
            var guard=Rounded(root,"Chimney guard",tradingMetal,new Ring(-.01f,.007f,.007f),new Ring(.34f,.007f,.007f));
            guard.localPosition=new Vector3(Mathf.Sin(angle)*.112f,0,Mathf.Cos(angle)*.112f);
        }
        var handle=GearMesh(root,"Carrying loop",PulleyMesh(.11f,.102f,.007f),tradingMetal);
        handle.transform.localPosition=new Vector3(0,.52f,0);
        Rounded(root,"Suspension wire",tradingMetal,new Ring(.60f,.006f,.006f),new Ring(suspensionTop,.006f,.006f));
        var flame=Rounded(root,"Wick flame",tradingFlame,new Ring(0,.014f,.014f),new Ring(.045f,.023f,.023f),new Ring(.09f,.002f,.002f));
        flame.localPosition=Vector3.up*.13f; flame.gameObject.SetActive(false);
        var lightRoot=new GameObject("Warm wick light"); lightRoot.transform.SetParent(root,false); lightRoot.transform.localPosition=Vector3.up*.20f;
        var light=lightRoot.AddComponent<Light>(); light.type=LightType.Point; light.color=new Color(1,.70f,.36f); light.range=3.3f; light.shadows=LightShadows.None; light.enabled=false;
        foreach(var renderer in root.GetComponentsInChildren<MeshRenderer>()) renderer.shadowCastingMode=ShadowCastingMode.Off;
        return new TradeLantern { Glass=glass.GetComponent<Renderer>(),Flame=flame,Light=light };
    }
}
