using System.Collections.Generic;
using UnityEngine;

public partial class OrbitGame
{
    private sealed class ScenerySurface
    {
        internal MeshRenderer Renderer;
        internal readonly MaterialPropertyBlock Properties = new MaterialPropertyBlock();
        internal readonly Vector4[] Hits = new Vector4[8], Normals = new Vector4[8];
    }
    private readonly Dictionary<string, ScenerySurface> scenerySurfaces = new Dictionary<string, ScenerySurface>();
    private Material scenerySurfaceMaterial;

    private void UpdateScenerySurface(SceneryView view)
    {
        if (!view.Root) return;
        if (!scenerySurfaces.TryGetValue(view.Shape.Id, out var surface))
        {
            var renderer = view.Root.GetComponentInChildren<MeshRenderer>(true);
            if (!renderer) return;
            if (!scenerySurfaceMaterial)
            {
                var shader = Resources.Load<Shader>("SceneryRockSurface");
                if (!shader || !shader.isSupported) return;
                var original = renderer.sharedMaterial;
                scenerySurfaceMaterial = new Material(shader) { name = "Photographed quarry rock with worked surfaces" };
                scenerySurfaceMaterial.SetTexture("_MainTex", original.mainTexture);
                scenerySurfaceMaterial.SetTexture("_BumpMap", original.GetTexture("_BumpMap"));
                scenerySurfaceMaterial.SetFloat("_BumpScale", .75f);
            }
            surface = new ScenerySurface { Renderer = renderer };
            scenerySurfaces.Add(view.Shape.Id, surface);
            renderer.sharedMaterial = scenerySurfaceMaterial;
        }
        int count = Mathf.Min(8, view.Data.chips?.Length ?? 0);
        for (int i = 0; i < 8; i++)
        {
            surface.Hits[i] = surface.Normals[i] = Vector4.zero;
            if (i >= count) continue;
            var chip = view.Data.chips[i];
            var point = new Vector3(chip.x, chip.y, chip.z);
            int repeats = 0;
            for (int j = 0; j < count; j++)
            {
                var other = view.Data.chips[j];
                if ((point - new Vector3(other.x, other.y, other.z)).sqrMagnitude < .0036f) repeats++;
            }
            surface.Hits[i] = new Vector4(chip.x, chip.y, chip.z, 1 + repeats * .10f);
            surface.Normals[i] = new Vector4(chip.nx, chip.ny, chip.nz, 0);
        }
        var properties = surface.Properties;
        Vector3 origin = view.Shape.Origin;
        properties.SetVector("_RockOrigin", new Vector4(origin.x, origin.y, origin.z, view.Shape.Radius * 7.13f));
        properties.SetVector("_RockSize", new Vector4(view.Shape.Radius, view.Shape.Top - origin.y, 0, 0));
        properties.SetFloat("_Passage", view.Data.passage ? 1 : 0);
        properties.SetFloat("_Damage", view.Data.passage ? 1 - view.Data.hp / (float)view.Data.maxHp : 0);
        properties.SetInt("_HitCount", count);
        properties.SetVectorArray("_Hits", surface.Hits);
        properties.SetVectorArray("_HitNormals", surface.Normals);
        surface.Renderer.SetPropertyBlock(properties);
    }

    private void BeginSceneryCollapseDust(SceneryView view)
    {
        if ((view.Shape.Origin - cam.transform.position).sqrMagnitude > 28 * 28) return;
        EnsureMiningParticleAssets();
        for (int i = 0; i < 8; i++)
        {
            float angle = i * Mathf.PI * .25f;
            Vector3 spread = new Vector3(Mathf.Cos(angle), 0, Mathf.Sin(angle));
            Vector3 point = view.Shape.Origin + spread * view.Shape.Radius * .62f;
            point.y = ValleyLandscape.Height(point.x, point.z) + .12f;
            AddChip(point, spread * .32f + Vector3.up * .24f, .52f + (i % 3) * .16f, .70f,
                dustMaterial, new Color(.56f, .51f, .43f, .39f), true, false);
        }
    }

    private void ReleaseScenerySurface()
    {
        if (scenerySurfaceMaterial) Destroy(scenerySurfaceMaterial);
        scenerySurfaces.Clear();
    }
}
