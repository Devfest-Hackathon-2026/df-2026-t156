using System.Collections.Generic;
using UnityEngine;

// Position and viewed time must come from the same authoritative segment.
// An exponential position blend cuts corners and has no matching rewind pose.
internal sealed class RemotePlayerTrack
{
    internal struct Pose
    {
        internal float Time, Yaw;
        internal Vector3 Position;
    }
    private readonly List<Pose> samples = new List<Pose>(12);
    internal bool Add(float time, Vector3 position, float yaw, bool reset)
    {
        if (samples.Count > 0)
        {
            var last = samples[samples.Count - 1];
            reset |= time < last.Time || (position - last.Position).sqrMagnitude > 4;
        }
        if (reset) samples.Clear();
        var pose = new Pose { Time = time, Position = position, Yaw = yaw };
        if (samples.Count > 0 && samples[samples.Count - 1].Time == time) samples[samples.Count - 1] = pose;
        else samples.Add(pose);
        while (samples.Count > 2 && samples[1].Time < time - .4f) samples.RemoveAt(0);
        return samples.Count == 1;
    }
    internal Pose Sample(float time)
    {
        if (time <= samples[0].Time) return samples[0];
        for (int i = 1; i < samples.Count; i++)
        {
            var b = samples[i]; if (time > b.Time) continue;
            var a = samples[i - 1];
            float blend = Mathf.Clamp01((time - a.Time) / (b.Time - a.Time));
            return new Pose { Time = Mathf.Lerp(a.Time, b.Time, blend),
                Position = Vector3.Lerp(a.Position, b.Position, blend),
                Yaw = Mathf.LerpAngle(a.Yaw * Mathf.Rad2Deg, b.Yaw * Mathf.Rad2Deg, blend) * Mathf.Deg2Rad };
        }
        // A missing packet freezes at the newest real pose, without inventing
        // either a future position or a more recent timestamp for an old body.
        return samples[samples.Count - 1];
    }
}
