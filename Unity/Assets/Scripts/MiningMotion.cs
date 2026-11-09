using UnityEngine;

public partial class OrbitGame
{
    private float motionTime, motionTick, verticalSpeed, motionFriction = .546f, previousForwardTap = -1;
    private int motionSequence, correctionSeen, impulseSeen;
    private bool sprintLatched, motionGrounded = true, sneakHeld;
    private Vector3 motionVelocity;
    private float jumpBufferedUntil;
    private int motionJumpTicks;
    private float motionGroundDistance, motionFrameSeconds;
    private Vector3? motionStepAnchor;

    private void ResetLocalMotion()
    {
        motionTime = motionTick = verticalSpeed = 0; motionSequence = correctionSeen = impulseSeen = 0;
        motionVelocity = Vector3.zero; motionGrounded = true; sprintLatched = false;
        previousForwardTap = -1; jumpBufferedUntil = 0; motionJumpTicks = 0;
        motionGroundDistance = motionFrameSeconds = 0;
        motionStepAnchor = null;
    }

    private void ApplyLocalMotion(OrbitPlayer player)
    {
        // Ordinary snapshots acknowledge pose, and never drag the local camera behind its own inputs.
        if (player.correctionId > correctionSeen)
        {
            predicted += new Vector3(player.correctionX, player.correctionY, player.correctionZ);
            correctionSeen = player.correctionId;
        }
        if (player.impulseId > impulseSeen)
        {
            motionVelocity = new Vector3(player.impulseX, 0, player.impulseZ);
            verticalSpeed = player.impulseY; motionTick = 0;
            impulseSeen = player.impulseId;
            // Sprint-hit self slowdown has no upward impulse: it must keep ground friction.
            motionGrounded = verticalSpeed <= 0 && predicted.y <= MotionSupportHeight(predicted.x, predicted.z, predicted.y) + .03f;
            if (!motionGrounded) motionStepAnchor = null;
            if (player.sprintSuppressed) sprintLatched = false;
        }
        player.stamina = 1; player.sprinting = shiftHeld;
    }

    private void UpdateLocalMotion(Vector3 move, bool playing, bool controls = true)
    {
        // Slow rendering still consumes real frame time. A suspended tab does not replay its gap.
        float remaining = Time.deltaTime <= .25f ? Time.deltaTime : 0;
        motionGroundDistance = 0; motionFrameSeconds = remaining;
        // Capture taps between the 50ms movement ticks, including just before landing.
        // Real time also expires the press while rendering is suspended.
        if (!hasLocal || !playing || !controls || remaining <= 0) jumpBufferedUntil = 0;
        else if (Input.GetKeyDown(KeyCode.Space)) jumpBufferedUntil = Time.unscaledTime + .15f;
        bool jumpHeld = controls && Input.GetKey(KeyCode.Space);
        sneakHeld = playing && controls && Input.GetKey(KeyCode.C);
        bool forward = playing && controls && Input.GetKey(KeyCode.W);
        // Ctrl+W closes the browser tab. Keep sprint entirely on game-safe inputs.
        bool sprintKey = controls && (Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift));
        if (!playing || !controls) previousForwardTap = -1;
        if (playing && controls && Input.GetKeyDown(KeyCode.W))
        {
            if (Time.unscaledTime - previousForwardTap < .3f && previousForwardTap >= 0) sprintLatched = true;
            previousForwardTap = Time.unscaledTime;
        }
        if (!forward || sneakHeld || BowDrawing) sprintLatched = false;
        // The sprint key may start sprint again on the next input after a hit,
        // as in 1.8.9. Double-W sprint still needs another forward tap.
        if (forward && !sneakHeld && !BowDrawing && sprintKey) sprintLatched = true;
        shiftHeld = forward && sprintLatched && !sneakHeld && !BowDrawing;
        if (!hasLocal || !playing) return;
        motionTime += remaining;
        while (remaining > .000001f)
        {
            if (motionTick <= .000001f)
            {
                // 1.8.9 clears all three components below .005 blocks/tick BEFORE travel.
                // The Y threshold is why its jump peaks at 1.24919m rather than 1.25220m.
                if (Mathf.Abs(motionVelocity.x) < .1f) motionVelocity.x = 0;
                if (Mathf.Abs(motionVelocity.z) < .1f) motionVelocity.z = 0;
                if (Mathf.Abs(verticalSpeed) < .1f) verticalSpeed = 0;
                if (motionJumpTicks > 0) motionJumpTicks--;
                bool jump = controls && (jumpHeld || Time.unscaledTime < jumpBufferedUntil);
                if (!jump) motionJumpTicks = 0;
                motionFriction = motionGrounded ? .546f : .91f;
                // Java 1.8.9: moveFlying adds acceleration, rather than replacing airborne momentum.
                float acceleration = motionGrounded ? (shiftHeld ? .13f : .1f) : (shiftHeld ? .026f : .02f);
                // Sneak/use-item and .98 apply BEFORE moveFlying normalizes diagonals.
                Vector3 heading = Vector3.ClampMagnitude(move * (.98f * (sneakHeld ? .3f : 1) * (BowDrawing ? .2f : 1)), 1);
                if (heading.sqrMagnitude < .0001f) heading = Vector3.zero;
                motionVelocity += heading * (acceleration * 20 * MeleeSpeedMultiplier);
                if (motionGrounded && jump && motionJumpTicks == 0)
                {
                    jumpBufferedUntil = 0; motionJumpTicks = 10;
                    verticalSpeed = 8.4f; motionGrounded = false; motionStepAnchor = null;
                    if (shiftHeld) motionVelocity += Quaternion.Euler(0, yaw, 0) * Vector3.forward * 4;
                }
            }
            float step = Mathf.Min(remaining, .05f - motionTick, 1f / 120);
            Vector3 before = predicted;
            if (!motionGrounded || before.y <= ValleyLandscape.Height(before.x, before.z) + .03f) motionStepAnchor = null;
            MoveGround(motionVelocity * step);
            bool stepped = false;
            Vector3 desired = before + motionVelocity * step;
            if (motionGrounded && new Vector2(desired.x - predicted.x, desired.z - predicted.z).sqrMagnitude > .000001f)
            {
                Vector3 anchor = motionStepAnchor ?? before;
                float lift = Mathf.Min(.6f, anchor.y + .6f + new Vector2(desired.x - anchor.x, desired.z - anchor.z).magnitude - before.y);
                float height = lift > .025f ? MotionSupportHeight(desired.x, desired.z, before.y + lift - .03f, true) : before.y;
                if (height > before.y + .025f && height <= before.y + lift + .001f)
                {
                    Vector3 blockedPosition = predicted;
                    predicted = new Vector3(before.x, height, before.z);
                    MoveGround(motionVelocity * step);
                    if (new Vector2(desired.x - predicted.x, desired.z - predicted.z).sqrMagnitude <= .000001f)
                    { stepped = true; motionStepAnchor = anchor; }
                    else predicted = blockedPosition;
                }
            }
            float support = MotionSupportHeight(predicted.x, predicted.z, before.y);
            if (sneakHeld && motionGrounded && before.y - support > .5f)
                predicted = before;
            // Curved surfaces can displace BOTH world axes. Remove only velocity
            // into the resolved contact, preserving the tangent used to strafe around it.
            Vector3 actual = predicted - before;
            if (motionGrounded) motionGroundDistance += new Vector2(actual.x, actual.z).magnitude;
            Vector2 blocked = new Vector2(motionVelocity.x * step - actual.x, motionVelocity.z * step - actual.z);
            float inward = Vector2.Dot(new Vector2(motionVelocity.x, motionVelocity.z), blocked);
            if (blocked.sqrMagnitude > .000001f && inward > 0)
            {
                motionVelocity.x -= blocked.x * inward / blocked.sqrMagnitude;
                motionVelocity.z -= blocked.y * inward / blocked.sqrMagnitude;
            }
            float ground = MotionSupportHeight(predicted.x, predicted.z, stepped ? predicted.y : before.y);
            // Follow ordinary downhill terrain while grounded. Tiny gaps must not alternate
            // air friction and ground acceleration into false sprint-speed violations.
            // Explicit jumps/impulses already clear motionGrounded; ledges over step height fall.
            if (motionGrounded && predicted.y >= ground && predicted.y - ground <= .6f)
                predicted.y = ground;
            if (!motionGrounded || predicted.y > ground + .03f)
            {
                predicted.y += verticalSpeed * step; motionGrounded = false;
            }
            if (predicted.y <= ground)
            {
                predicted.y = ground; verticalSpeed = 0; motionGrounded = true;
            }
            remaining -= step; motionTick += step;
            if (motionTick >= .05f - .000001f)
            {
                motionVelocity *= motionFriction;
                verticalSpeed = motionGrounded ? 0 : (verticalSpeed - 1.6f) * .98f;
                motionTick = 0;
            }
        }
        self.sprinting = shiftHeld; self.stamina = 1;
    }

    private float MotionSupportHeight(float x, float z, float feet, bool walkableOnly = false)
    {
        float support = ValleyLandscape.Height(x, z);
        foreach (var obstacle in valley.colliders)
            if (sceneryShapes.TryGetValue(obstacle.id, out var shape))
            {
                support = shape.Support(x, z, feet, valley.playerRadius, support, walkableOnly);
            }
            else support = CylinderSupport(support, x, z, feet, obstacle.x, obstacle.z, obstacle.radius, obstacle.height);
        foreach (var deposit in valley.deposits)
            support = CylinderSupport(support, x, z, feet, deposit.x, deposit.z, deposit.radius, deposit.height);
        return support;
    }

    private float CylinderSupport(float support, float x, float z, float feet, float cx, float cz, float radius, float height)
    {
        float top = ValleyLandscape.Height(cx, cz) + height;
        float combined = radius + valley.playerRadius - .001f;
        if (top <= feet + .03f && top > support && (new Vector2(x - cx, z - cz)).sqrMagnitude < combined * combined)
            return top;
        return support;
    }
}
