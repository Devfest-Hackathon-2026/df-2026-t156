using UnityEngine;

public partial class OrbitGame
{
    private float mouseSensitivity = -1;
    private GUIStyle mouseTrack, mouseThumb;
    private float MouseSensitivity
    {
        get
        {
            if (mouseSensitivity < 0)
            {
                mouseSensitivity = PlayerPrefs.GetFloat("mouseSensitivity", .5f);
                if (float.IsNaN(mouseSensitivity)) mouseSensitivity = .5f;
                mouseSensitivity = Mathf.Clamp01(mouseSensitivity);
            }
            return mouseSensitivity;
        }
    }

    // Java 1.8.9 EntityRenderer -> Entity.setAngles. Browser Y grows downward,
    // so Unity pitch uses the same positive-down convention without inversion.
    private float MouseLookGain
    {
        get { float f = MouseSensitivity * .6f + .2f; return f * f * f * 8 * .15f; }
    }

    private void DrawMouseSensitivity(float x, float y, float width, bool dark)
    {
        Color ink = dark ? FieldWhite : FieldInk;
        Color quiet = dark ? FieldQuiet : FieldMuted;
        if (mouseTrack == null)
        {
            mouseTrack = new GUIStyle { fixedHeight = 24, padding = new RectOffset(0, 0, 5, 5) };
            mouseThumb = new GUIStyle { fixedWidth = 10, fixedHeight = 14 };
            mouseThumb.normal.background = mouseThumb.hover.background = mouseThumb.active.background = pixel;
        }
        float value = MouseSensitivity;
        HudLabel(x, y, "感度 " + Mathf.FloorToInt(value * 200) + "%", fieldSmall, ink, 93);
        float start = x + 100, length = width - 158;
        HudLine(new Vector2(start, y + 12), new Vector2(start + length, y + 12), quiet, 2);
        GUI.color = GuiTint(ink);
        float next = GUI.HorizontalSlider(new Rect(start, y, length, 24), value, 0, 1, mouseTrack, mouseThumb);
        GUI.color = Color.white;
        GUI.color = GuiTint(ink);
        GUI.SetNextControlName("reset-mouse-sensitivity");
        if (GUI.Button(new Rect(x + width - 48, y, 48, 24), "戻す", fieldLink)) next = .5f;
        GUI.color = Color.white;
        if (Mathf.Abs(next - value) > .00001f)
        {
            mouseSensitivity = next;
            PlayerPrefs.SetFloat("mouseSensitivity", next);
        }
        // Persist at the end of a gesture, not once per drag event.
        if (Event.current.rawType == EventType.MouseUp || Event.current.rawType == EventType.KeyUp)
            PlayerPrefs.Save();
    }
}
