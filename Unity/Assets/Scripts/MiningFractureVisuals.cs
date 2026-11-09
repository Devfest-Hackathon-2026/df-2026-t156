using System.Collections.Generic;
using UnityEngine;

public partial class OrbitGame
{
    private readonly Dictionary<string,Vector3> lastVisibleFractures=new Dictionary<string,Vector3>();
    private int fractureRound=-1;
    private bool fractureHostBound;

    private void UpdateFractureVisuals()
    {
        if(!fractureHostBound&&veinSurface)
        {
            // Tile in world space on the cut surface, avoiding stretched scan UVs.
            veinSurface.SetTexture("_MainTex",Resources.Load<Texture2D>("Valley/Rock"));
            veinSurface.SetTexture("_BumpMap",Resources.Load<Texture2D>("Valley/RockNormal"));
            fractureHostBound=true;
        }
        if(fractureRound!=state.round)
        {
            fractureRound=state.round;lastVisibleFractures.Clear();
        }
        foreach(var view in veins.Values)
        {
            if(!view.Rock)continue;
            UpdateLooseOre(view);
            bool known=lastVisibleFractures.TryGetValue(view.Data.id,out var previous);
            bool changed=known&&(previous-view.Weak).sqrMagnitude>.0001f;
            if(known&&!changed)continue;
            lastVisibleFractures[view.Data.id]=view.Weak;
            view.Surface.SetFloat("_WeakRadius",valley.mining.weakRadius);
            view.Surface.SetFloat("_FractureTime",changed&&view.Data.hp>0?Time.time:-10);
            view.Rock.SetPropertyBlock(view.Surface);
        }
    }

    private void UpdateLooseOre(VeinView view)
    {
        bool visible = view.Data.looseCount > 0;
        if (!view.LooseOre && visible)
        {
            EnsureMiningParticleAssets();
            view.LooseOre = GearPivot(view.Root, "Ore left in the broken seam", Vector3.up * (view.Height + .075f));
            var matrix = GearMesh(view.LooseOre, "Broken rock matrix", chipMesh, stone);
            matrix.localScale = new Vector3(.24f, .20f, .25f);
            matrix.localRotation = Quaternion.Euler(13, 27, -8);
            var mineral = GearMesh(view.LooseOre, "Exposed mineral fragment", chipMesh, OreMaterial(view.Data.kind));
            mineral.localPosition = new Vector3(0, .065f, -.015f);
            mineral.localScale = new Vector3(.20f, .12f, .21f);
            mineral.localRotation = Quaternion.Euler(-7, 11, 18);
        }
        if (view.LooseOre) view.LooseOre.gameObject.SetActive(visible);
    }
}
