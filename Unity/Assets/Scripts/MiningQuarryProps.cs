using UnityEngine;
using UnityEngine.Rendering;

public partial class OrbitGame
{
    private Material mineCartSurface, mineRailSurface;

    private Material MinePropSurface(string maps)
    {
        var shader=Resources.Load<Shader>("MineProps");
        var material=new Material(shader?shader:Resources.Load<Shader>("OrbitLit"));
        material.name="CC0 authored "+maps+" mining surface";
        material.color=maps=="Cart"?new Color(.69f,.59f,.46f):new Color(.46f,.46f,.39f);
        material.SetFloat("_Desaturate",maps=="Cart"?.52f:.60f);
        material.SetTexture("_MainTex",Resources.Load<Texture2D>("MiningProps/"+maps+"Albedo"));
        material.SetTexture("_BumpMap",Resources.Load<Texture2D>("MiningProps/"+maps+"Normal"));
        material.SetTexture("_MetalMap",Resources.Load<Texture2D>("MiningProps/"+maps+"Metallic"));
        material.SetTexture("_RoughMap",Resources.Load<Texture2D>("MiningProps/"+maps+"Roughness"));
        return material;
    }

    private Transform MiningProp(Transform parent,string name,Material surface,Vector3 position,Vector3 angle,Vector3 scale)
    {
        var prefab=Resources.Load<GameObject>("MiningProps/"+name);
        if(!prefab) return null;
        var root=Instantiate(prefab,parent,false).transform;
        root.name="Abandoned "+name;
        root.localPosition=position;root.localRotation=Quaternion.Euler(angle);root.localScale=scale;
        foreach(var renderer in root.GetComponentsInChildren<MeshRenderer>())
        {
            var materials=new Material[Mathf.Max(1,renderer.sharedMaterials.Length)];
            for(int i=0;i<materials.Length;i++) materials[i]=surface;
            renderer.sharedMaterials=materials;
            renderer.shadowCastingMode=ShadowCastingMode.On;renderer.receiveShadows=true;
        }
        return root;
    }

    private Transform SharedSiteRoot(Transform parent,string id,string kind,string title)
    {
        foreach(var obstacle in valley.colliders)
        {
            if(obstacle.id!=id||obstacle.kind!=kind) continue;
            var site=GearPivot(parent,title,Vector3.zero);
            site.position=new Vector3(obstacle.x,ValleyLandscape.Height(obstacle.x,obstacle.z),obstacle.z);
            site.rotation=Quaternion.identity;
            return site;
        }
        return null;
    }

    private void BuildOldCutProps(Transform root)
    {
        if(!mineCartSurface) mineCartSurface=MinePropSurface("Cart");
        if(!mineRailSurface) mineRailSurface=MinePropSurface("Rails");
        // A cart is created only when the same shared collision data contains it.
        // Its ground position is authoritative, rather than embedded in the ore.
        foreach(var obstacle in valley.colliders)
        {
            if(obstacle.id!="north-ore-cart"||obstacle.kind!="cart") continue;
            float scale=Mathf.Min(obstacle.radius/.94f,obstacle.height/1.02f);
            var position=new Vector3(obstacle.x,ValleyLandscape.Height(obstacle.x,obstacle.z)+.012f,obstacle.z);
            var cart=MiningProp(root,"OreCart",mineCartSurface,Vector3.zero,
                new Vector3(0,-75,0),Vector3.one*scale);
            if(cart) cart.position=position;
            var rail=MiningProp(root,"QuarryRail",mineRailSurface,Vector3.zero,
                new Vector3(0,15,0),Vector3.one*.78f);
            if(rail) rail.position=position-Vector3.up*.016f;
        }
        // A single braced timber with its beam pointing into the rear of the cut,
        // rather than the former thin two-legged gate across the mining target.
        MiningProp(root,"PitShoring",mineRailSurface,new Vector3(-.60f,.025f,.40f),
            new Vector3(0,-9,-5),new Vector3(.72f,.72f,.65f));
    }
}
