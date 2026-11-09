using System;
using System.Collections.Generic;
using UnityEngine;

[Serializable] public class OrbitRockChip { public float x, y, z, nx, ny, nz; }
[Serializable] public class OrbitSceneryRock
{
    public string id;
    public int hp, maxHp, revision;
    public bool passage, collapsed;
    public OrbitRockChip[] chips;
}

public partial class OrbitGame
{
    private sealed class SceneryView
    {
        internal SceneryRockShape Shape;
        internal OrbitSceneryRock Data;
        internal Transform Root, Rubble;
    }
    private readonly Dictionary<string, SceneryRockShape> sceneryShapes = new Dictionary<string, SceneryRockShape>();
    private readonly Dictionary<string, SceneryView> sceneryViews = new Dictionary<string, SceneryView>();
    private SceneryView sceneryTarget;
    private float sceneryDistance;
    private int sceneryRound = -1;
    private Mesh sceneryRubbleMesh;
    private readonly List<Mesh> sceneryOwnedMeshes = new List<Mesh>();
    private sealed class FallingScenery
    {
        internal Transform Root;
        internal Vector3 Position, Scale;
        internal Quaternion Rotation;
        internal float Started;
    }
    private readonly List<FallingScenery> fallingScenery = new List<FallingScenery>();

    private void EnsureSceneryMining()
    {
        if (sceneryShapes.Count > 0) return;
        int seed = 0;
        foreach (var c in valley.colliders)
        {
            if (c.kind == "rock")
            {
                var shape = new SceneryRockShape(c, seed++);
                sceneryShapes[c.id] = shape;
                ValleyLandscape.SceneryRocks.TryGetValue(c.id, out var root);
                sceneryViews[c.id] = new SceneryView { Shape = shape, Root = root };
            }
            else if (c.kind == "tree" || c.kind == "trunk") seed++;
        }
    }

    private void ApplySceneryMining(OrbitState snapshot)
    {
        EnsureSceneryMining();
        if (snapshot.scenery == null) return;
        bool roundChanged = sceneryRound != snapshot.round;
        sceneryRound = snapshot.round;
        bool mapChanged = false;
        foreach (var data in snapshot.scenery)
        {
            if (!sceneryViews.TryGetValue(data.id, out var view)) continue;
            bool changed = roundChanged || view.Data == null || data.revision != view.Data.revision || data.collapsed != view.Data.collapsed;
            bool falling = !roundChanged && view.Data != null && !view.Data.collapsed && data.collapsed;
            if (view.Shape.Removed != data.collapsed) mapChanged = true;
            view.Shape.Removed = data.collapsed;
            view.Data = data;
            if (!changed || !view.Root) continue;
            if (falling)
            {
                BeginSceneryCollapseDust(view);
                var ghost = Instantiate(view.Root, transform, true);
                fallingScenery.Add(new FallingScenery { Root = ghost, Position = ghost.position,
                    Scale = ghost.localScale, Rotation = ghost.rotation, Started = Time.unscaledTime });
            }
            view.Root.gameObject.SetActive(!data.collapsed);
            UpdateScenerySurface(view);
            if (!view.Rubble && data.collapsed) view.Rubble = BuildSceneryRubble(view);
            if (view.Rubble) view.Rubble.gameObject.SetActive(data.collapsed);
        }
        if (mapChanged && surveyTerrain) { Destroy(surveyTerrain); surveyTerrain = null; }
    }

    private void AnimateSceneryMining()
    {
        for (int i = fallingScenery.Count - 1; i >= 0; i--)
        {
            var falling = fallingScenery[i];
            float t = (Time.unscaledTime - falling.Started) / .55f;
            if (!falling.Root || t >= 1)
            {
                if (falling.Root) Destroy(falling.Root.gameObject);
                fallingScenery.RemoveAt(i); continue;
            }
            falling.Root.position = falling.Position + new Vector3(Mathf.Sin(t * 32) * .035f * (1 - t), -t * t * 1.6f, 0);
            falling.Root.localScale = falling.Scale * (1 - t * t * .93f);
            falling.Root.rotation = falling.Rotation * Quaternion.Euler(t * 9, 0, t * -6);
        }
    }

    private bool IsSceneryCollapsed(string id)
        => sceneryShapes.TryGetValue(id, out var shape) && shape.Removed;

    private void DrawSceneryMapLandmarks(Rect map)
    {
        foreach (var view in sceneryViews.Values)
        {
            if (view.Data == null || !view.Data.passage) continue;
            var point = SurveyPoint(map, view.Shape.Origin.x, view.Shape.Origin.z);
            HudLabel(point.x + 12, point.y - 24, view.Data.collapsed ? "開通" : "割れる岩", fieldSmall, FieldInk, 80);
        }
    }
    private Transform BuildSceneryRubble(SceneryView view)
    {
        var root = GearPivot(transform, "Low rubble of opened passage " + view.Shape.Id, Vector3.zero);
        var source = view.Root.GetComponentInChildren<MeshFilter>(true);
        var surface = view.Root.GetComponentInChildren<MeshRenderer>(true).sharedMaterial;
        if (!sceneryRubbleMesh) sceneryRubbleMesh = BuildSceneryRubbleMesh(source.sharedMesh);
        // Broken slabs collect at the edges; just two low flakes remain in the
        // middle. All are below step height and add no invisible collision.
        float[,] pieces = {
            { .76f,-.32f,.83f,.22f,.47f, 28, 5 },
            {-.81f,-.21f,.62f,.18f,.46f,137,-8 },
            { .24f, .78f,.94f,.26f,.54f,249, 3 },
            {-.36f, .67f,.52f,.15f,.33f, 76,-5 },
            {-.18f, .12f,.27f,.035f,.17f,318,0 },
            { .26f,-.05f,.20f,.028f,.13f,105,0 }
        };
        var vertices = sceneryRubbleMesh.vertices;
        for (int i = 0; i < pieces.GetLength(0); i++)
        {
            float x = view.Shape.Origin.x + pieces[i,0] * view.Shape.Radius;
            float z = view.Shape.Origin.z + pieces[i,1] * view.Shape.Radius;
            var slope = new Vector3(ValleyLandscape.Height(x-.25f,z) - ValleyLandscape.Height(x+.25f,z), .5f,
                ValleyLandscape.Height(x,z-.25f) - ValleyLandscape.Height(x,z+.25f)).normalized;
            var turn = Quaternion.FromToRotation(Vector3.up, slope) * Quaternion.Euler(pieces[i,6], pieces[i,5], -pieces[i,6] * .6f);
            var size = new Vector3(pieces[i,2],pieces[i,3],pieces[i,4]);
            float bottom = float.PositiveInfinity;
            foreach (var vertex in vertices) bottom = Mathf.Min(bottom, (turn * Vector3.Scale(vertex,size)).y);
            var fragment = GearMesh(root,"Weathered granite slab",sceneryRubbleMesh,surface);
            fragment.position = new Vector3(x,ValleyLandscape.Height(x,z)-bottom-.018f,z);
            fragment.rotation = turn; fragment.localScale = size;
        }
        return root;
    }

    private Mesh BuildSceneryRubbleMesh(Mesh source)
    {
        // Cluster the existing scan for small, textured fragments, keeping its
        // irregular silhouette and UVs. One shared mesh serves every round.
        var points = source.vertices; var uv = source.uv; var bounds = source.bounds;
        var groups = new Dictionary<Vector3Int,int>(); var map = new int[points.Length];
        var sums = new List<Vector3>(); var textures = new List<Vector2>(); var counts = new List<int>();
        for (int i = 0; i < points.Length; i++)
        {
            var p = points[i] - bounds.center;
            p = new Vector3(p.x/bounds.size.x,p.y/bounds.size.y,p.z/bounds.size.z);
            var key = new Vector3Int(Mathf.RoundToInt(p.x*10),Mathf.RoundToInt(p.y*10),Mathf.RoundToInt(p.z*10));
            if (!groups.TryGetValue(key,out int index))
            { index=sums.Count;groups[key]=index;sums.Add(Vector3.zero);textures.Add(Vector2.zero);counts.Add(0); }
            map[i]=index;sums[index]+=p;textures[index]+=uv.Length>i?uv[i]:Vector2.zero;counts[index]++;
        }
        for (int i=0;i<sums.Count;i++) { sums[i]/=counts[i];textures[i]/=counts[i]; }
        var faces = new List<int>(); var sourceFaces = source.triangles;
        for (int i=0;i<sourceFaces.Length;i+=3)
        {
            int a=map[sourceFaces[i]],b=map[sourceFaces[i+1]],c=map[sourceFaces[i+2]];
            if(a==b||b==c||a==c)continue;
            faces.Add(a);faces.Add(b);faces.Add(c);
        }
        var mesh=new Mesh{name="Shared weathered granite fragments"};
        mesh.SetVertices(sums);mesh.SetUVs(0,textures);mesh.SetTriangles(faces,0);
        mesh.RecalculateNormals();mesh.RecalculateTangents();mesh.RecalculateBounds();
        sceneryOwnedMeshes.Add(mesh);return mesh;
    }

    private void OnDestroy()
    {
#if UNITY_EDITOR
        CloseEditorConnection();
#endif
        foreach (var mesh in sceneryOwnedMeshes) if (mesh) Destroy(mesh);
        ReleaseScenerySurface();
        ReleaseCrossbowAssets();
    }

    private void FindSceneryMiningTarget(Vector3 origin, Vector3 aim)
    {
        sceneryTarget = null;
        if (state?.scenery == null) return;
        float best = SightDistance(origin, aim, 8) + .0002f;
        if (targetVein != null) best = Mathf.Min(best, targetDistance);
        if (meleeTarget != null)
        {
            float person = RayPlayerBox(origin, aim, meleeTarget.root.position);
            if (person <= 3.000001f) best = Mathf.Min(best, person);
        }
        foreach (var view in sceneryViews.Values)
        {
            if (view.Data == null || view.Data.collapsed) continue;
            if (!view.Shape.Ray(origin, aim, best, out float distance, out _, out _)) continue;
            sceneryTarget = view; sceneryDistance = best = distance;
        }
    }

    private bool SceneryMiningInRange()
        => sceneryTarget != null && !sceneryTarget.Shape.Removed && sceneryDistance <= valley.mining.range + .0001f;

    private bool DrawSceneryMiningGuidance(float w, float h)
    {
        if (sceneryTarget == null || sceneryTarget.Shape.Removed) return false;
        var data = sceneryTarget.Data;
        bool inRange = SceneryMiningInRange();
        float left = w / 2 - 96, y = h / 2 + 31;
        HudIcon(new Rect(left - 25, y + 1, 18, 18), "copper", Color.white);
        HudFieldLabel(left, y, data.passage ? "割れた大岩" : "岩肌", hudSmall, HudMuted, 215);
        string action = !inRange ? "あと " + Mathf.Max(.1f, sceneryDistance - valley.mining.range).ToString("0.0") + "m近づく"
            : self.inventoryCount >= PlayerBagCapacity ? "袋がいっぱい"
            : QuarrySwingPrompt("削る");
        HudFieldCentered(w / 2, y + 26, action, hudBody, inRange ? HudInk : HudMuted);
        if (inRange && data.hp < data.maxHp)
        {
            float ratio = 1 - data.hp / (float)data.maxHp;
            DrawTint(new Rect(w / 2 - 72, y + 61, 144, 3), new Color(1,1,1,.22f));
            DrawTint(new Rect(w / 2 - 72, y + 61, ratio * 144, 3), HudGold);

        }
        return true;
    }
}
