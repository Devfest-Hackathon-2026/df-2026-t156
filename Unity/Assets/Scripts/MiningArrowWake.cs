using UnityEngine;

public partial class OrbitGame
{
    private Material arrowWakeMaterial;
    private static readonly int WakeOpacity = Shader.PropertyToID("_Opacity");

    private void SetWakeOpacity(BoltView view, float opacity)
    {
        view.WakeProperties.SetFloat(WakeOpacity, opacity);
        view.Wake.SetPropertyBlock(view.WakeProperties);
    }

    private LineRenderer CreateArrowWake(Transform parent)
    {
        if (!arrowWakeMaterial) arrowWakeMaterial = new Material(Resources.Load<Shader>("OrbitArrowWake"));
        var line = parent.gameObject.AddComponent<LineRenderer>();
        line.sharedMaterial = arrowWakeMaterial;
        line.useWorldSpace = true;
        line.alignment = LineAlignment.View;
        line.textureMode = LineTextureMode.Stretch;
        line.widthCurve = new AnimationCurve(new Keyframe(0, 0), new Keyframe(.35f, .55f), new Keyframe(1, 1));
        var fade = new Gradient();
        fade.SetKeys(new[] { new GradientColorKey(Color.white, 0), new GradientColorKey(Color.white, 1) },
            new[] { new GradientAlphaKey(0, 0), new GradientAlphaKey(.60f, .35f), new GradientAlphaKey(.9f, 1) });
        line.colorGradient = fade;
        line.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        line.receiveShadows = false;
        line.enabled = false;
        return line;
    }

    private void SetArrowReadability(BoltView view)
    {
        // Keep the real shaft length/tip; only feathers and cross-section gain
        // enough coverage to remain a recognisable arrow at field distances.
        float scale = Mathf.Clamp(1 + Vector3.Distance(cam.transform.position, view.Tip) / 24, 1, 2.2f);
        view.Arrow.localScale = new Vector3(scale, scale, 1);
    }

    private void UpdateArrowWake(BoltView view, OrbitBolt data, float time)
    {
        if (view.PresentationStopped) { view.Wake.enabled = false; return; }
        Vector3 actual = BowFlightPosition(data, time, out var velocity);
        Vector3 offset = view.Tip - actual;
        // The wake ends at the feathers, then follows the same sampled 20Hz
        // ballistic curve. It never bridges frame positions or old predictions.
        float end = time - .695f / Mathf.Max(1, velocity.magnitude);
        float start = Mathf.Max(data.spawnTime, end - .11f);
        if (end <= start) { view.Wake.enabled = false; return; }
        int count = 0;
        bool own = data.ownerId == localId;
        float guard = own ? 1.8f : .6f;
        for (int i = 0; i < view.WakePoints.Length; i++)
        {
            Vector3 point = BowFlightPosition(data, Mathf.Lerp(start, end, i / (view.WakePoints.Length - 1f)), out _) + offset;
            if (Vector3.Dot(point - cam.transform.position, cam.transform.forward) < guard) continue;
            view.WakePoints[count++] = point;
        }
        view.Wake.enabled = count > 1;
        if (count < 2) return;
        float depth = Mathf.Max(1, Vector3.Distance(cam.transform.position, view.Tip));
        float pixel = 2 * depth * Mathf.Tan(cam.fieldOfView * Mathf.Deg2Rad / 2) / Mathf.Max(1, Screen.height);
        view.Wake.widthMultiplier = Mathf.Clamp(pixel * 2, .03f, .14f);
        view.Wake.positionCount = count;
        view.Wake.SetPositions(view.WakePoints);
    }
}
