using System.Collections.Generic;
using UnityEngine;

public partial class OrbitGame
{
    // These arrows have no gameplay collision or receipt. The server alone
    // supplies the flight's spread, accepted draw strength and eventual impact.
    private readonly Dictionary<int, BoltView> predictedArrows = new Dictionary<int, BoltView>();
    private readonly List<int> expiredPredictedArrows = new List<int>();

    private void PredictReleasedArrow(Vector3 aim, float ticks)
    {
        var view = TakeBolt();
        Vector3 side = Vector3.Cross(Vector3.up, aim);
        if (side.sqrMagnitude < .00001f) side = cam.transform.right;
        Vector3 start = cam.transform.position - side.normalized * .16f - Vector3.up * .1f;
        Vector3 velocity = aim.normalized * BowRules.projectileSpeed * BowPower(ticks);
        view.Data = new OrbitBolt { ownerId = localId, shotId = crossbowShotId,
            x = start.x, y = start.y, z = start.z, vx = velocity.x, vy = velocity.y, vz = velocity.z,
            spawnTime = Time.unscaledTime, expiresAt = Time.unscaledTime + BowRules.maxFlightSeconds };
        view.Velocity = velocity;
        PlaceFlyingArrow(view, start, false);
        view.Wake.enabled = false; view.Fresh = false;
        predictedArrows.Add(crossbowShotId, view);
    }

    private BoltView ConfirmPredictedArrow(OrbitBolt data)
    {
        if (data.ownerId != localId || !predictedArrows.TryGetValue(data.shotId, out var view)) return null;
        predictedArrows.Remove(data.shotId);
        Vector3 authoritative = BowFlightPosition(data, CrossbowServerNow, out var velocity);
        view.PresentationOffset = view.Tip - authoritative;
        view.ReconcileAt = Time.unscaledTime;
        // Correct along the moving flight rather than teleporting back towards
        // the bow. Spread and strength differences are reconciled too.
        view.ReconcileSeconds = Mathf.Max(.16f, view.PresentationOffset.magnitude / Mathf.Max(1, velocity.magnitude * .65f));
        return view;
    }

    private void PlaceFlyingArrow(BoltView view, Vector3 tip, bool clipScenery)
    {
        if (clipScenery && view.PresentationStopped) return;
        Vector3 segment = tip - view.Tip;
        if (clipScenery && !view.Fresh && segment.sqrMagnitude > .000001f)
        {
            float length = segment.magnitude;
            float cover = SightDistance(view.Tip, segment / length, length);
            if (cover < length) { tip = view.Tip + segment / length * cover; view.PresentationStopped = true; }
            // A final terrain sample can land exactly at the segment endpoint.
            float ground = ValleyLandscape.Height(tip.x, tip.z) + .015f;
            if (tip.y <= ground) { tip.y = ground; view.PresentationStopped = true; }
        }
        view.Tip = tip;
        view.Root.position = tip - view.Velocity.normalized * .695f;
        if (view.Velocity.sqrMagnitude > .01f) view.Root.rotation = Quaternion.LookRotation(view.Velocity);
        SetArrowReadability(view);
    }

    private void AnimatePredictedArrows()
    {
        expiredPredictedArrows.Clear();
        foreach (var pair in predictedArrows)
        {
            var view = pair.Value;
            if (Time.unscaledTime - view.Data.spawnTime > .6f) { expiredPredictedArrows.Add(pair.Key); continue; }
            Vector3 tip = BowFlightPosition(view.Data, Time.unscaledTime, out view.Velocity);
            PlaceFlyingArrow(view, tip, true);
            UpdateArrowWake(view, view.Data, Time.unscaledTime);
        }
        foreach (int id in expiredPredictedArrows) { PoolBolt(predictedArrows[id]); predictedArrows.Remove(id); }
    }

    private void ClearPredictedArrows()
    {
        foreach (var view in predictedArrows.Values) PoolBolt(view);
        predictedArrows.Clear();
    }

    private void RejectPredictedArrow(int shotId)
    {
        if (shotId == 0) { ClearPredictedArrows(); return; }
        if (!predictedArrows.TryGetValue(shotId, out var view)) return;
        PoolBolt(view); predictedArrows.Remove(shotId);
    }
}
