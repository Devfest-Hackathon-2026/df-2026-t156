using System.Collections.Generic;
using System.Runtime.InteropServices;
using UnityEngine;

public partial class OrbitGame
{
#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")] private static extern float OrbitCanvasDensity();
#endif
    private float HudCssScale
    {
        get
        {
            float density = 1;
#if UNITY_WEBGL && !UNITY_EDITOR
            density = Mathf.Max(.1f, OrbitCanvasDensity());
#endif
            return Mathf.Min(Screen.width / 1000f, Screen.height / 680f) / density;
        }
    }

    private readonly Dictionary<GUIStyle, GUIStyle> rasterStyles = new Dictionary<GUIStyle, GUIStyle>();

    // Layout stays in the existing logical coordinates. Rasterise each dynamic
    // glyph at its displayed pixel size instead of magnifying a 14px bitmap.
    private bool RasterButton(Rect rect, string value, GUIStyle style)
    {
        // Keep the original hit region, focus and keyboard handling. Drawing the
        // caption through the same glyph path also avoids stale scaled glyphs.
        bool clicked = GUI.Button(rect, GUIContent.none, style);
        RasterLabel(rect, value, style);
        return clicked;
    }

    private void RasterLabel(Rect rect, string value, GUIStyle style)
    {
        Matrix4x4 saved = GUI.matrix;
        float scale = saved.m00;
        if (Mathf.Abs(scale - 1) < .001f || style.fontSize <= 0)
        { GUI.Label(rect, value, style); return; }
        if (!rasterStyles.TryGetValue(style, out var raster))
        { raster = new GUIStyle(style); rasterStyles.Add(style, raster); }
        raster.fontSize = Mathf.Max(1, Mathf.RoundToInt(style.fontSize * scale));
        Vector3 origin = saved.MultiplyPoint3x4(new Vector3(rect.x, rect.y, 0));
        var pixels = new Rect(Mathf.Round(origin.x), Mathf.Round(origin.y), rect.width * scale + 2, rect.height * scale);
        GUI.matrix = Matrix4x4.identity;
        GUI.Label(pixels, value, raster);
        GUI.matrix = saved;
    }
}
