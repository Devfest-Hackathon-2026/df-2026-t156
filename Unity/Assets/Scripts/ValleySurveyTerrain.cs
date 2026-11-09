using UnityEngine;

public static partial class ValleyLandscape
{
    // The printed survey follows the same worn routes as the rendered valley.
    public static float SurveyTrailDistance(float x, float z)
    {
        var p = new Vector2(x, z);
        return Mathf.Min(TrailDistance(x, z), Mathf.Min(HaulDistance(p, eastCartTrack), HaulDistance(p, eastFootTrack)));
    }
}
