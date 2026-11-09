using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

public partial class OrbitGame
{
    private sealed class OreSignal
    {
        internal Transform Root, Dust;
        internal MeshRenderer Renderer;
        internal float Visibility;
        internal readonly MaterialPropertyBlock Properties = new MaterialPropertyBlock();
    }

    private readonly Dictionary<string, OreSignal> oreSignals = new Dictionary<string, OreSignal>();
    private Material mineralDustMaterial;
    private Mesh mineralDustQuad;

    private void AnimateOreSignals()
    {
        if (state == null || !cam) return;
        foreach (var view in veins.Values)
        {
            if (view.Data.kind != "gold") continue;
            if (!oreSignals.TryGetValue(view.Data.id, out var signal))
            {
                var shader = Resources.Load<Shader>("OreSignal");
                if (!shader || !shader.isSupported) continue;
                if (!mineralDustMaterial) mineralDustMaterial = new Material(shader);
                var root = GearPivot(view.Root, "Sunlit gold dust", Vector3.up * view.Height);
                var dust = new GameObject("Rising mineral dust");
                dust.transform.SetParent(root, false);
                if (!mineralDustQuad)
                {
                    mineralDustQuad = new Mesh { name = "Mineral dust quad" };
                    mineralDustQuad.vertices = new[] { new Vector3(-.5f,-.5f,0), new Vector3(.5f,-.5f,0), new Vector3(-.5f,.5f,0), new Vector3(.5f,.5f,0) };
                    mineralDustQuad.uv = new[] { Vector2.zero, Vector2.right, Vector2.up, Vector2.one };
                    mineralDustQuad.triangles = new[] { 0,2,1,2,3,1 };
                    mineralDustQuad.RecalculateBounds();
                }
                dust.AddComponent<MeshFilter>().sharedMesh = mineralDustQuad;
                var renderer = dust.AddComponent<MeshRenderer>();
                renderer.sharedMaterial = mineralDustMaterial;
                renderer.shadowCastingMode = ShadowCastingMode.Off;
                renderer.receiveShadows = false;
                signal = new OreSignal { Root = root, Dust = dust.transform, Renderer = renderer };
                oreSignals.Add(view.Data.id, signal);
            }
            bool exposed = view.Data.active && view.Data.hp > 0;
            bool preview = view.Data.announced && view.Data.opensIn > 0;
            float target = exposed ? 1 : preview ? .52f : 0;
            signal.Visibility = Mathf.MoveTowards(signal.Visibility, target, Time.unscaledDeltaTime * 2.2f);
            signal.Root.gameObject.SetActive(signal.Visibility > .001f);
            if (signal.Visibility <= .001f) continue;
            Vector3 toCamera = cam.transform.position - signal.Root.position;
            toCamera.y = 0;
            if (toCamera.sqrMagnitude > .01f) signal.Root.rotation = Quaternion.LookRotation(toCamera);
            float height = exposed ? 9.5f : 3.5f;
            signal.Dust.localPosition = Vector3.up * height * .5f;
            signal.Dust.localScale = new Vector3(2.7f, height, 1);
            // Near the face the mineral and its actual fracture take over.
            float distance = Vector3.Distance(cam.transform.position, signal.Root.position);
            float closeFade = Mathf.SmoothStep(0, 1, Mathf.InverseLerp(4, 14, distance));
            signal.Properties.SetColor("_Tint", new Color(1, .70f, .22f, .55f * signal.Visibility * closeFade));
            signal.Renderer.SetPropertyBlock(signal.Properties);
        }
    }
}
