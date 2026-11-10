using System;
using System.Collections;
using System.IO;
using System.Reflection;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;
using Object = UnityEngine.Object;

public static class ProspectorArtReview
{
    private const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;

    [MenuItem("Orbit/Art/Capture Prospector")]
    public static void Capture()
    {
        var game = Object.FindObjectOfType<OrbitGame>();
        if (!EditorApplication.isPlaying || !game) throw new InvalidOperationException("Use the running Orbit scene.");
        object person = typeof(OrbitGame).GetMethod("Person", Private).Invoke(game, null);
        Type type = person.GetType();
        var root = (Transform)type.GetField("root").GetValue(person);
        var cameraObject = new GameObject("Prospector art camera");
        var camera = cameraObject.AddComponent<Camera>();
        RenderTexture target = null;
        try
        {
            root.position = new Vector3(0, 1000, 0);
            typeof(OrbitGame).GetMethod("ApplyProspectorClothes", Private).Invoke(game, new object[] { root, "旅人" });
            foreach (var part in root.GetComponentsInChildren<Transform>(true)) part.gameObject.layer = 28;
            camera.cullingMask = 1 << 28;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(.12f, .17f, .18f);
            camera.fieldOfView = 32;
            camera.nearClipPlane = .05f;
            camera.farClipPlane = 20;
            target = new RenderTexture(960, 960, 24);
            camera.targetTexture = target;
            Directory.CreateDirectory("Logs/ProspectorArt");
            CaptureAngle(camera, root, target, new Vector3(1.5f, 1.10f, 3.7f), "front");
            CaptureAngle(camera, root, target, new Vector3(-1.5f, 1.20f, -3.7f), "back");
            ((Transform)type.GetField("leftLeg").GetValue(person)).localRotation = Quaternion.Euler(-22, 0, 0);
            ((Transform)type.GetField("rightLeg").GetValue(person)).localRotation = Quaternion.Euler(23, 0, 0);
            ((Transform)type.GetField("rightArm").GetValue(person)).localRotation = Quaternion.Euler(-68, 0, -6);
            ((Transform)type.GetField("rightElbow").GetValue(person)).localRotation = Quaternion.Euler(-60, 0, 0);
            CaptureAngle(camera, root, target, new Vector3(-2.2f, 1.4f, 3.4f), "swing");
            Debug.Log("PROSPECTOR_ART_CAPTURED Logs/ProspectorArt/{front,back,swing}.png");
        }
        finally
        {
            camera.targetTexture = null;
            if (target) Object.DestroyImmediate(target);
            Object.DestroyImmediate(cameraObject);
            Object.DestroyImmediate(root.gameObject);
        }
    }

    private static void CaptureAngle(Camera camera, Transform root, RenderTexture target, Vector3 offset, string name)
    {
        camera.transform.position = root.position + offset;
        camera.transform.LookAt(root.position + Vector3.up * .88f);
        camera.Render();
        var previous = RenderTexture.active;
        RenderTexture.active = target;
        var image = new Texture2D(target.width, target.height, TextureFormat.RGB24, false);
        image.ReadPixels(new Rect(0, 0, target.width, target.height), 0, 0);
        image.Apply();
        File.WriteAllBytes("Logs/ProspectorArt/" + name + ".png", image.EncodeToPNG());
        Object.DestroyImmediate(image);
        RenderTexture.active = previous;
    }

    [MenuItem("Orbit/Art/Capture Live Miners")]
    public static void CaptureLiveMiners()
    {
        var game = Object.FindObjectOfType<OrbitGame>();
        if (!EditorApplication.isPlaying || !game) throw new InvalidOperationException("Join the running local game first.");
        var walkers = (IDictionary)typeof(OrbitGame).GetField("walkers", Private).GetValue(game);
        var cameraObject = new GameObject("Live miner review camera");
        var camera = cameraObject.AddComponent<Camera>();
        var target = new RenderTexture(960, 960, 24);
        camera.targetTexture = target;
        camera.cullingMask = ~(1 << 29);
        camera.fieldOfView = 37;
        camera.farClipPlane = 250;
        camera.clearFlags = CameraClearFlags.Skybox;
        int index = 0;
        try
        {
            Directory.CreateDirectory("Logs/ProspectorArt");
            foreach (DictionaryEntry entry in walkers)
            {
                var person = entry.Value;
                var root = (Transform)person.GetType().GetField("root").GetValue(person);
                if (!root.gameObject.activeInHierarchy) continue;
                Vector3 offset = root.forward * 3.1f + root.right * 1.1f + Vector3.up * 1.25f;
                CaptureAngle(camera, root, target, offset, "live-" + index++);
            }
            Debug.Log("PROSPECTOR_LIVE_CAPTURED " + index + " network actors");
        }
        finally
        {
            camera.targetTexture = null;
            Object.DestroyImmediate(target);
            Object.DestroyImmediate(cameraObject);
        }
    }

    [MenuItem("Orbit/Art/Build Release WebGL")]
    public static void Build()
    {
        if (EditorApplication.isPlaying) throw new InvalidOperationException("Stop Play Mode before building.");
        EditorApplication.delayCall += () =>
        {
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { "Assets/Scenes/Orbit.unity" },
                locationPathName = "../build-web",
                target = BuildTarget.WebGL,
                options = BuildOptions.None
            });
            Directory.CreateDirectory("Logs/ProspectorArt");
            File.WriteAllText("Logs/ProspectorArt/build-report.json", JsonUtility.ToJson(new ReleaseReport
            {
                result = report.summary.result.ToString(),
                bytes = report.summary.totalSize,
                seconds = report.summary.totalTime.TotalSeconds,
                errors = report.summary.totalErrors
            }, true));
            if (report.summary.result != BuildResult.Succeeded)
                throw new InvalidOperationException("Prospector release build failed. Inspect the Unity console.");
            Debug.Log("PROSPECTOR_RELEASE_BUILD_SUCCEEDED " + report.summary.totalSize);
        };
    }

    [Serializable]
    private sealed class ReleaseReport
    {
        public string result;
        public ulong bytes;
        public double seconds;
        public int errors;
    }
}
