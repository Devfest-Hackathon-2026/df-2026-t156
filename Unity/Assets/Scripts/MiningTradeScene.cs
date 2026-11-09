using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

public partial class OrbitGame
{
    private void BuildTradeMarkings(Transform root, OrbitStation station)
    {
        // One weathered limewash line follows the authoritative radius.
        const int segments = 192;
        var vertices = new List<Vector3>();
        var uv = new List<Vector2>();
        var triangles = new List<int>();
        for (int i = 0; i <= segments; i++)
        {
            float angle = i * Mathf.PI * 2 / segments;
            for (int edge = 0; edge < 2; edge++)
            {
                float radius = station.radius + (edge == 0 ? -.055f : .055f);
                float x = station.x + Mathf.Cos(angle) * radius;
                float z = station.z + Mathf.Sin(angle) * radius;
                vertices.Add(new Vector3(x, ValleyLandscape.Height(x, z) + .018f, z) - root.position);
                uv.Add(new Vector2(angle * station.radius, edge));
            }
            if (i == segments) continue;
            int v = i * 2;
            triangles.AddRange(new[] { v, v + 3, v + 1, v, v + 2, v + 3 });
        }
        var paint = new GameObject("Limewashed trade boundary");
        paint.transform.SetParent(root, false);
        var mesh = new Mesh { name = "Authoritative shop boundary" };
        mesh.SetVertices(vertices); mesh.SetUVs(0, uv); mesh.SetTriangles(triangles, 0);
        mesh.RecalculateNormals(); mesh.RecalculateBounds();
        paint.AddComponent<MeshFilter>().sharedMesh = mesh;
        var renderer = paint.AddComponent<MeshRenderer>();
        renderer.sharedMaterial = new Material(Resources.Load<Shader>("TradeChalk"));
        renderer.shadowCastingMode = ShadowCastingMode.Off;
        renderer.receiveShadows = true;
    }
}
