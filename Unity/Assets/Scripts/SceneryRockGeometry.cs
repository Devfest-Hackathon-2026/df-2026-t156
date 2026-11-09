using System;
using System.Collections.Generic;
using UnityEngine;

// Minimum imported LOD + BVH, exported by SceneryGeometryExport. These routines
// mirror server/scenery-shape.js, including the vertical capsule and tolerances.
[Serializable] internal sealed class SceneryRockGeometry
{
    public float[] vertices, nodes;
    public int[] triangles;
    public string mesh, sourceSha256;
    internal static SceneryRockGeometry Shared;
    internal static SceneryRockGeometry Load()
    {
        if (Shared == null) Shared = JsonUtility.FromJson<SceneryRockGeometry>(Resources.Load<TextAsset>("SceneryRock").text);
        return Shared;
    }
    internal Vector3 Vertex(int i) => new Vector3(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]);
}

internal sealed class SceneryRockShape
{
    internal string Id;
    internal Vector3 Origin;
    internal float Radius, Height, Top, Cos, Sin;
    internal bool Removed;
    private readonly SceneryRockGeometry geometry;
    private readonly Stack<int> traversal = new Stack<int>(32);
    internal SceneryRockShape(ClientValleyObstacle c, int seed)
    {
        geometry = SceneryRockGeometry.Load(); Id = c.id; Radius = c.radius;
        float ground = ValleyLandscape.Height(c.x, c.z), low = ground;
        for (int i = 0; i < 8; i++) low = Mathf.Min(low, ValleyLandscape.Height(c.x + Mathf.Cos(i * Mathf.PI / 4) * c.radius * .78f,
            c.z + Mathf.Sin(i * Mathf.PI / 4) * c.radius * .78f));
        float sink = Mathf.Max(c.height * .35f, ground - low + c.height * .19f);
        Height = c.height + sink; Top = ground + c.height;
        Origin = new Vector3(c.x, ground - sink, c.z);
        Cos = Mathf.Cos(seed * 79 * Mathf.Deg2Rad); Sin = Mathf.Sin(seed * 79 * Mathf.Deg2Rad);
    }
    internal Vector3 Local(Vector3 p, bool direction = false)
    {
        if (!direction) p -= Origin;
        return new Vector3((p.x * Cos - p.z * Sin) / Radius, p.y / Height, (p.x * Sin + p.z * Cos) / Radius);
    }
    internal Vector3 World(Vector3 p) => Origin + new Vector3((p.x * Cos + p.z * Sin) * Radius, p.y * Height, (-p.x * Sin + p.z * Cos) * Radius);
    private void Triangle(int face, out Vector3 a, out Vector3 b, out Vector3 c)
    {
        a = geometry.Vertex(geometry.triangles[face * 3]); b = geometry.Vertex(geometry.triangles[face * 3 + 1]); c = geometry.Vertex(geometry.triangles[face * 3 + 2]);
    }
    private static float RayTriangle(Vector3 o, Vector3 d, Vector3 a, Vector3 b, Vector3 c)
    {
        Vector3 e = b - a, f = c - a, p = Vector3.Cross(d, f);
        float det = Vector3.Dot(e, p);
        if (Mathf.Abs(det) < 1e-10f) return float.PositiveInfinity;
        Vector3 t = o - a; float u = Vector3.Dot(t, p) / det;
        if (u < -1e-7f || u > 1 + 1e-7f) return float.PositiveInfinity;
        Vector3 q = Vector3.Cross(t, e); float v = Vector3.Dot(d, q) / det;
        if (v < -1e-7f || u + v > 1 + 1e-7f) return float.PositiveInfinity;
        float distance = Vector3.Dot(f, q) / det;
        return distance >= 0 ? distance : float.PositiveInfinity;
    }
    private bool RayBox(Vector3 o, Vector3 d, int index, float limit)
    {
        float lo = 0, hi = limit;
        for (int k = 0; k < 3; k++)
        {
            float min = geometry.nodes[index * 10 + k] - 1e-6f, max = geometry.nodes[index * 10 + 3 + k] + 1e-6f;
            if (Mathf.Abs(d[k]) < 1e-12f) { if (o[k] < min || o[k] > max) return false; }
            else { float a = (min - o[k]) / d[k], b = (max - o[k]) / d[k]; lo = Mathf.Max(lo, Mathf.Min(a, b)); hi = Mathf.Min(hi, Mathf.Max(a, b)); }
        }
        return lo <= hi;
    }
    internal bool Ray(Vector3 origin, Vector3 direction, float maxDistance, out float distance, out Vector3 point, out Vector3 normal)
    {
        distance = maxDistance; point = normal = Vector3.zero;
        if (Removed) return false;
        Vector3 o = Local(origin), d = Local(direction, true);
        var stack = traversal; stack.Clear(); stack.Push(0); int face = -1;
        while (stack.Count > 0)
        {
            int index = stack.Pop(), n = index * 10;
            if (!RayBox(o, d, index, distance)) continue;
            if (geometry.nodes[n + 9] > 0)
            {
                int end = (int)(geometry.nodes[n + 8] + geometry.nodes[n + 9]);
                for (int i = (int)geometry.nodes[n + 8]; i < end; i++)
                {
                    Triangle(i, out var a, out var b, out var c);
                    float hit = RayTriangle(o, d, a, b, c);
                    if (hit <= distance) { distance = hit; face = i; }
                }
            }
            else { stack.Push((int)geometry.nodes[n + 6]); stack.Push((int)geometry.nodes[n + 7]); }
        }
        if (face < 0) return false;
        Triangle(face, out var u, out var v, out var w);
        normal = Vector3.Cross(World(v) - World(u), World(w) - World(u)).normalized;
        if (Vector3.Dot(normal, direction) > 0) normal = -normal;
        point = origin + direction * distance;
        return true;
    }
    private static Vector3 ClosestTriangle(Vector3 p, Vector3 a, Vector3 b, Vector3 c)
    {
        Vector3 ab = b - a, ac = c - a, ap = p - a; float d1 = Vector3.Dot(ab, ap), d2 = Vector3.Dot(ac, ap);
        if (d1 <= 0 && d2 <= 0) return a;
        Vector3 bp = p - b; float d3 = Vector3.Dot(ab, bp), d4 = Vector3.Dot(ac, bp);
        if (d3 >= 0 && d4 <= d3) return b;
        float vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) return a + ab * (d1 / (d1 - d3));
        Vector3 cp = p - c; float d5 = Vector3.Dot(ab, cp), d6 = Vector3.Dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) return c;
        float vb = d5 * d2 - d1 * d6;
        if (vb <= 0 && d2 >= 0 && d6 <= 0) return a + ac * (d2 / (d2 - d6));
        float va = d3 * d6 - d5 * d4;
        if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return b + (c - b) * ((d4 - d3) / (d4 - d3 + d5 - d6));
        return a + ab * (vb / (va + vb + vc)) + ac * (vc / (va + vb + vc));
    }
    private static void ClosestSegments(Vector3 a, Vector3 b, Vector3 c, Vector3 d, out Vector3 onA, out Vector3 onB)
    {
        Vector3 u = b - a, v = d - c, w = a - c;
        float aa = Vector3.Dot(u, u), bb = Vector3.Dot(u, v), cc = Vector3.Dot(v, v), dd = Vector3.Dot(u, w), ee = Vector3.Dot(v, w);
        float denominator = aa * cc - bb * bb;
        float s = denominator > 1e-12f ? Mathf.Clamp01((bb * ee - cc * dd) / denominator) : 0;
        float t = cc > 1e-12f ? (bb * s + ee) / cc : 0;
        if (t < 0) { t = 0; s = aa > 1e-12f ? Mathf.Clamp01(-dd / aa) : 0; }
        else if (t > 1) { t = 1; s = aa > 1e-12f ? Mathf.Clamp01((bb - dd) / aa) : 0; }
        onA = a + u * s; onB = c + v * t;
    }
    private static void CapsulePair(Vector3 a, Vector3 b, Vector3 u, Vector3 v, Vector3 w, out Vector3 onBody, out Vector3 onRock)
    {
        float hit = RayTriangle(a, b - a, u, v, w);
        if (hit <= 1) { onBody = onRock = a + (b - a) * hit; return; }
        onBody = a; onRock = ClosestTriangle(a, u, v, w); float best = (onBody - onRock).sqrMagnitude;
        Vector3 nearB = ClosestTriangle(b, u, v, w);
        if ((b - nearB).sqrMagnitude < best) { onBody = b; onRock = nearB; best = (b - nearB).sqrMagnitude; }
        for (int i = 0; i < 3; i++)
        {
            ClosestSegments(a, b, i == 0 ? u : i == 1 ? v : w, i == 0 ? v : i == 1 ? w : u, out var p, out var q);
            if ((p - q).sqrMagnitude < best) { onBody = p; onRock = q; best = (p - q).sqrMagnitude; }
        }
    }
    private static float TriangleSupport(Vector3 a, Vector3 b, Vector3 c, float x, float z, float radius)
    {
        float bx = b.x - a.x, bz = b.z - a.z, cx = c.x - a.x, cz = c.z - a.z;
        float det = bx * cz - bz * cx;
        if (Mathf.Abs(det) < 1e-10f) return float.NegativeInfinity;
        float gx = ((b.y - a.y) * cz - bz * (c.y - a.y)) / det;
        float gz = (bx * (c.y - a.y) - (b.y - a.y) * cx) / det;
        if (1 / Mathf.Sqrt(1 + gx * gx + gz * gz) < .65f) return float.NegativeInfinity;
        float best = float.NegativeInfinity;
        void Candidate(float px, float pz)
        {
            if ((px - x) * (px - x) + (pz - z) * (pz - z) > radius * radius + 1e-8f) return;
            float u = ((px - a.x) * cz - (pz - a.z) * cx) / det;
            float v = (bx * (pz - a.z) - bz * (px - a.x)) / det;
            if (u >= -1e-6f && v >= -1e-6f && u + v <= 1 + 1e-6f)
                best = Mathf.Max(best, a.y + gx * (px - a.x) + gz * (pz - a.z));
        }
        Candidate(x, z);
        for (int i = 0; i < 3; i++)
        {
            Vector3 p = i == 0 ? a : i == 1 ? b : c, q = i == 0 ? b : i == 1 ? c : a;
            Candidate(p.x, p.z);
            float dx = q.x - p.x, dz = q.z - p.z, ox = p.x - x, oz = p.z - z;
            float aa = dx * dx + dz * dz, bb = ox * dx + oz * dz;
            float disc = bb * bb - aa * (ox * ox + oz * oz - radius * radius);
            if (aa <= 1e-12f || disc < 0) continue;
            for (int root = 0; root < 2; root++)
            {
                float t = (-bb + (root == 0 ? -1 : 1) * Mathf.Sqrt(disc)) / aa;
                if (t >= 0 && t <= 1) Candidate(p.x + dx * t, p.z + dz * t);
            }
        }
        float gradient = Mathf.Sqrt(gx * gx + gz * gz);
        if (gradient > 1e-10f) Candidate(x + gx / gradient * radius, z + gz / gradient * radius);
        return best;
    }
    internal float Support(float x, float z, float feet, float radius, float minimum, bool walkableOnly)
    {
        if (Removed || new Vector2(x - Origin.x, z - Origin.z).magnitude > Radius * 1.43f + radius) return minimum;
        float support = minimum;
        if (!walkableOnly && Ray(new Vector3(x, feet + .03f, z), Vector3.down, Mathf.Max(0, feet + .03f - minimum), out _, out var point, out _))
            support = Mathf.Max(support, point.y);
        Vector3 center = Local(new Vector3(x, feet, z)); float extent = radius * 1.42f / Radius;
        float low = (minimum - Origin.y) / Height, high = (feet + .03f - Origin.y) / Height;
        var stack = traversal; stack.Clear(); stack.Push(0);
        while (stack.Count > 0)
        {
            int n = stack.Pop() * 10;
            if (geometry.nodes[n] > center.x + extent || geometry.nodes[n + 3] < center.x - extent ||
                geometry.nodes[n + 1] > high || geometry.nodes[n + 4] < low ||
                geometry.nodes[n + 2] > center.z + extent || geometry.nodes[n + 5] < center.z - extent) continue;
            if (geometry.nodes[n + 9] == 0) { stack.Push((int)geometry.nodes[n + 6]); stack.Push((int)geometry.nodes[n + 7]); continue; }
            int end = (int)(geometry.nodes[n + 8] + geometry.nodes[n + 9]);
            for (int i = (int)geometry.nodes[n + 8]; i < end; i++)
            {
                Triangle(i, out var a, out var b, out var c);
                float height = TriangleSupport(World(a), World(b), World(c), x, z, radius);
                if (height <= feet + .030001f) support = Mathf.Max(support, height);
            }
        }
        return support;
    }
    internal Vector3 Push(Vector3 point, float radius, float bodyHeight)
    {
        if (Removed || new Vector2(point.x - Origin.x, point.z - Origin.z).magnitude > Radius * 1.43f + radius || point.y >= Top + .03f) return point;
        Vector3 center = Local(point + Vector3.up * bodyHeight / 2);
        float rx = radius * 1.42f / Radius, ry = bodyHeight / (2 * Height);
        var stack = traversal; stack.Clear(); stack.Push(0);
        while (stack.Count > 0)
        {
            int n = stack.Pop() * 10;
            if (geometry.nodes[n] > center.x + rx || geometry.nodes[n + 3] < center.x - rx ||
                geometry.nodes[n + 1] > center.y + ry || geometry.nodes[n + 4] < center.y - ry ||
                geometry.nodes[n + 2] > center.z + rx || geometry.nodes[n + 5] < center.z - rx) continue;
            if (geometry.nodes[n + 9] == 0) { stack.Push((int)geometry.nodes[n + 6]); stack.Push((int)geometry.nodes[n + 7]); continue; }
            int end = (int)(geometry.nodes[n + 8] + geometry.nodes[n + 9]);
            for (int i = (int)geometry.nodes[n + 8]; i < end; i++)
            {
                Triangle(i, out var a, out var b, out var c); a = World(a); b = World(b); c = World(c);
                if (Mathf.Max(a.y, Mathf.Max(b.y, c.y)) <= point.y + .025f) continue;
                CapsulePair(point + Vector3.up * radius, point + Vector3.up * Mathf.Max(radius, bodyHeight - radius), a, b, c, out var onBody, out var onRock);
                Vector3 delta = onBody - onRock;
                if (delta.sqrMagnitude >= radius * radius - 1e-8f) continue;
                float horizontal = new Vector2(delta.x, delta.z).magnitude;
                var normal = new Vector2(delta.x, delta.z);
                if (horizontal < 1e-8f)
                {
                    Vector3 face = Vector3.Cross(b - a, c - a); normal = new Vector2(face.x, face.z);
                    if (Vector2.Dot(normal, new Vector2(point.x - Origin.x, point.z - Origin.z)) < 0) normal = -normal;
                    if (normal.magnitude < 1e-8f) continue;
                    horizontal = 0;
                }
                normal.Normalize();
                float push = Mathf.Sqrt(Mathf.Max(0, radius * radius - delta.y * delta.y)) - horizontal + .0001f;
                point.x += normal.x * push; point.z += normal.y * push;
            }
        }
        return point;
    }
}
