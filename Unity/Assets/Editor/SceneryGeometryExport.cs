using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using UnityEditor;
using UnityEngine;

// Run with Unity -batchmode -executeMethod SceneryGeometryExport.Export.
// Uses the very same imported minimum LOD and normalisation as ValleyLandscape.
public static class SceneryGeometryExport
{
    [Serializable] private class Geometry
    {
        public int version = 1;
        public string source, sourceSha256, mesh;
        public float[] vertices, nodes;
        public int[] triangles;
    }
    private class Node { public Bounds bounds; public int left = -1, right = -1, start, count; }
    public static void Export()
    {
        const string asset = "Assets/Resources/Valley/Boulder.fbx";
        var mesh = AssetDatabase.LoadAllAssetsAtPath(asset).OfType<Mesh>().OrderBy(m => m.vertexCount).First();
        var bounds = mesh.bounds;
        float radius = Mathf.Max(bounds.extents.x, bounds.extents.z);
        Vector3[] points = mesh.vertices.Select(v => new Vector3((v.x - bounds.center.x) / radius,
            (v.y - bounds.min.y) / bounds.size.y, (v.z - bounds.center.z) / radius)).ToArray();
        int[] source = mesh.triangles;
        var ordered = new List<int>(); var nodes = new List<Node>();
        int Build(int[] faces)
        {
            var box = new Bounds(points[source[faces[0] * 3]], Vector3.zero);
            foreach (int face in faces) for (int k = 0; k < 3; k++) box.Encapsulate(points[source[face * 3 + k]]);
            int index = nodes.Count; var node = new Node { bounds = box }; nodes.Add(node);
            if (faces.Length <= 12)
            {
                node.start = ordered.Count / 3; node.count = faces.Length;
                foreach (int face in faces) for (int k = 0; k < 3; k++) ordered.Add(source[face * 3 + k]);
            }
            else
            {
                int axis = box.size.x > box.size.z ? 0 : 2;
                if (box.size.y > box.size[axis]) axis = 1;
                var sorted = faces.OrderBy(face => (points[source[face * 3]][axis] +
                    points[source[face * 3 + 1]][axis] + points[source[face * 3 + 2]][axis]) / 3).ToArray();
                node.left = Build(sorted.Take(sorted.Length / 2).ToArray());
                node.right = Build(sorted.Skip(sorted.Length / 2).ToArray());
            }
            return index;
        }
        Build(Enumerable.Range(0, source.Length / 3).ToArray());
        var geometry = new Geometry { source = asset, mesh = mesh.name,
            sourceSha256 = BitConverter.ToString(SHA256.Create().ComputeHash(File.ReadAllBytes(asset))).Replace("-", "").ToLowerInvariant(),
            vertices = points.SelectMany(p => new[] { p.x, p.y, p.z }).ToArray(), triangles = ordered.ToArray(),
            nodes = nodes.SelectMany(n => new[] { n.bounds.min.x, n.bounds.min.y, n.bounds.min.z,
                n.bounds.max.x, n.bounds.max.y, n.bounds.max.z, n.left, n.right, n.start, n.count }).ToArray() };
        var args = Environment.GetCommandLineArgs(); int option = Array.IndexOf(args, "-sceneryOutput");
        string output = option >= 0 ? args[option + 1] : "Assets/Resources/SceneryRock.json";
        File.WriteAllText(output, JsonUtility.ToJson(geometry));
        Debug.Log("Scenery geometry: " + mesh.name + " / " + mesh.vertexCount + " vertices / " + source.Length / 3 + " triangles / " + nodes.Count + " BVH nodes → " + output);
    }
}
