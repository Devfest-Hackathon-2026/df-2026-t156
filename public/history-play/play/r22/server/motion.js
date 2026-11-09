// Java 1.8.9 scale: blocks are metres; client movement is validated, never chased by a second simulation.
export const MOTION = Object.freeze({ walk: 4.3171806, sprint: 5.6123348, sneak: 1.2951542,
  jump: 8.4, tick: .05, groundDrag: .546, airDrag: .91, jumpTicks: 10 });

export function resetMotion(player, time, round) {
  Object.assign(player, { clientMotion: false, motionRound: round, motionSeq: 0, motionTime: 0,
    motionBudget: .25, motionBudgetAt: time, correctionId: 0, correctionX: 0, correctionY: 0, correctionZ: 0,
    impulseId: 0, impulseAckId: 0, impulseX: 0, impulseY: 0, impulseZ: 0, velocityX: 0, velocityY: 0, velocityZ: 0,
    grounded: true, airTime: 0, sprintSuppressed: false, impulseAllowance: 0,
    externalX: 0, externalY: 0, externalZ: 0, jumpAllowance: 0, landingAllowance: 0, airOrigin: player.y,
    motionVX: 0, motionVY: 0, motionVZ: 0, motionTick: 0, motionJumpTicks: 0,
    motionWasDrawing: false, drawAllowance: 0 });
}

export function applyKnockback(player, vx, vy, vz) {
  if (![vx, vy, vz].every(Number.isFinite)) return;
  player.impulseId++;
  player.impulseX = player.velocityX = vx;
  player.impulseY = player.velocityY = vy;
  player.impulseZ = player.velocityZ = vz;
  // Acknowledgement gates old in-flight poses. The client integrates this velocity exactly once.
  player.impulseAllowance = Math.hypot(vx, vz);
  player.airTime = 0;
  player.airOrigin = player.y;
  // Both server-driven actors and the client replace carried velocity, then ADD
  // input acceleration. A held movement key can never overwrite a hit impulse.
  player.motionVX = vx; player.motionVY = vy; player.motionVZ = vz; player.motionTick = 0;
  if (vy > 0) player.grounded = false;
}

export function combatVelocity(player) {
  // Pose-owned clients expose their newest accepted live movement; an old
  // impulse is never reused after it has decayed. Server actors retain the
  // integrator's post-drag motion, just as Java's motionX/Y/Z do.
  return player.clientMotion
    ? { x: player.velocityX, y: player.velocityY, z: player.velocityZ }
    : { x: player.motionVX, y: player.motionVY, z: player.motionVZ };
}

// Server-driven actors share the client's 20Hz rules. Geometry remains the
// valley's continuous terrain/capsule model, rather than imported voxel code.
export function integrateMotion(world, player, input, dt) {
  if (!input.sprint || player.bot) player.sprintSuppressed = false;
  const beforeFrame = { x: player.x, y: player.y, z: player.z };
  let remaining = dt;
  while (remaining > 1e-8) {
    if (player.motionTick <= 1e-8) {
      for (const key of ['motionVX', 'motionVY', 'motionVZ'])
        if (Math.abs(player[key]) < .1) player[key] = 0;
      if (player.motionJumpTicks > 0) player.motionJumpTicks--;
      if (!input.jump) player.motionJumpTicks = 0;
      const sprint = input.sprint && !input.sneak && !player.bowDrawing && !player.sprintSuppressed;
      player.motionDrag = player.grounded ? MOTION.groundDrag : MOTION.airDrag;
      const acceleration = player.grounded ? (sprint ? 2.6 : 2) : (sprint ? .52 : .4);
      const scale = .98 * (input.sneak ? .3 : 1) * (player.bowDrawing ? .2 : 1);
      let hx = input.x * scale, hz = input.z * scale;
      if (hx * hx + hz * hz < .0001) { hx = 0; hz = 0; }
      const length = Math.max(1, Math.hypot(hx, hz)); hx /= length; hz /= length;
      player.motionVX += hx * acceleration; player.motionVZ += hz * acceleration;
      if (player.grounded && input.jump && player.motionJumpTicks === 0) {
        player.motionJumpTicks = MOTION.jumpTicks; player.motionVY = MOTION.jump;
        player.grounded = false;
        if (sprint) { player.motionVX += Math.sin(player.yaw) * 4; player.motionVZ += Math.cos(player.yaw) * 4; }
      }
      player.sprinting = sprint && Math.hypot(input.x, input.z) > .02;
    }
    const step = Math.min(remaining, MOTION.tick - player.motionTick, 1 / 120);
    const before = { x: player.x, y: player.y, z: player.z };
    const dx = player.motionVX * step, dz = player.motionVZ * step;
    const moved = world.valley.move(player, dx, dz);
    if (input.sneak && player.grounded && before.y - moved.y > .5) {
      moved.x = before.x; moved.z = before.z;
    }
    if (Math.abs(moved.x - before.x - dx) > .001) player.motionVX = 0;
    if (Math.abs(moved.z - before.z - dz) > .001) player.motionVZ = 0;
    player.x = moved.x; player.z = moved.z;
    const ground = world.valley.supportHeight(player.x, player.z, before.y);
    if (player.grounded && player.y >= ground && player.y - ground <= .6) player.y = ground;
    if (!player.grounded || player.y > ground + .03) {
      player.y += player.motionVY * step; player.grounded = false;
    }
    if (player.y <= ground) { player.y = ground; player.motionVY = 0; player.grounded = true; }
    remaining -= step; player.motionTick += step;
    if (player.motionTick >= MOTION.tick - 1e-8) {
      player.motionVX *= player.motionDrag; player.motionVZ *= player.motionDrag;
      player.motionVY = player.grounded ? 0 : (player.motionVY - 1.6) * .98;
      player.motionTick = 0;
    }
  }
  player.velocityX = (player.x - beforeFrame.x) / dt;
  player.velocityY = (player.y - beforeFrame.y) / dt;
  player.velocityZ = (player.z - beforeFrame.z) / dt;
  player.stamina = 1; player.exhausted = false;
  return Math.hypot(input.x, input.z) > .02 || Math.hypot(player.velocityX, player.velocityZ) > .05 || !player.grounded;
}

export function receiveMotion(world, player, packet) {
  if (!Number.isSafeInteger(packet.motionSeq) || packet.motionSeq <= player.motionSeq ||
      packet.motionRound !== world.round || world.phase !== 'playing') return;
  player.clientMotion = true;
  if (![packet.px, packet.py, packet.pz, packet.motionTime].every(Number.isFinite)) return;
  if (packet.impulseId !== player.impulseId || packet.correctionId !== player.correctionId) {
    player.motionSeq = packet.motionSeq;
    return;
  }
  const dt = packet.motionTime - player.motionTime;
  // The first acknowledged pose spans time before the client received this impulse.
  // That span is valid movement time, but is not the age of the newly applied velocity.
  const firstImpulseAck = player.impulseId !== player.impulseAckId;
  const impulseDt = firstImpulseAck ? 0 : Math.max(0, dt);
  player.motionBudget = Math.min(2, player.motionBudget + Math.max(0, world.time - player.motionBudgetAt));
  player.motionBudgetAt = world.time;
  const dx = packet.px - player.x, dz = packet.pz - player.z;
  const targetGround = world.valley.supportHeight(packet.px, packet.pz, Math.max(player.y, packet.py));
  // Sprint-jump launch adds .2 blocks/tick. Keep that momentum while airborne.
  if (player.grounded && packet.py > targetGround + .03) {
    // A repeated jump can carry the previous airborne tick's momentum into ground acceleration.
    player.jumpAllowance = player.input.sprint && !player.bowDrawing ? 7.5 : 0;
    player.airOrigin = player.y;
  }
  // Drawing slows acceleration, not carried velocity. Allow the entry momentum
  // to decay rather than snapping a running or airborne archer back to .2 speed.
  if (player.bowDrawing && !player.motionWasDrawing)
    player.drawAllowance = Math.max(MOTION.sprint / .98, Math.hypot(player.velocityX, player.velocityZ));
  if (!player.bowDrawing) player.drawAllowance = 0;
  // Diagonal input is normalized AFTER .98 in 1.8.9: 2.04% faster than straight walking.
  const inputSpeed = player.bowDrawing ? MOTION.walk / .98 * .2 * (player.input.sneak ? .3 : 1) : MOTION.sprint / .98;
  const speed = inputSpeed + player.drawAllowance + player.jumpAllowance + player.landingAllowance + (player.grounded ? 0 : 2.55);
  const maxDistance = (speed + player.impulseAllowance) * Math.max(0, dt) * 1.01 + .002;
  // Reject cheap numeric/rate bounds before geometry substeps; a finite 1e300 must not freeze the room.
  if (dt === 0 && Math.hypot(dx, packet.py - player.y, dz) < .001) {
    player.motionSeq = packet.motionSeq;
    return;
  }
  const bounded = dt > 0 && dt <= 2 && dt <= player.motionBudget + .08 &&
    Math.abs(packet.px) <= world.valley.data.boundary + .001 && Math.abs(packet.pz) <= world.valley.data.boundary + .001 &&
    Math.hypot(dx, dz) <= maxDistance;
  // A network frame can straddle takeoff/landing. Sweep at the higher endpoint rather than
  // inventing a ground-height pillar when the client's feet have already cleared a low prop.
  const moved = bounded ? world.valley.move({ ...player, y: Math.max(player.y, packet.py) }, dx, dz) : player;
  const ground = moved.y;
  const airTime = packet.py > ground + .08 && packet.py >= player.y - .01 ? player.airTime + impulseDt : 0;
  const maxHeight = Math.max(1.3, player.impulseY * player.impulseY / 32 + .2);
  const valid = bounded && Math.hypot(moved.x - packet.px, moved.z - packet.pz) < .03 &&
    packet.py >= ground - .08 && packet.py <= Math.max(ground, player.airOrigin) + maxHeight &&
    packet.py - player.y <= Math.max(MOTION.jump, player.impulseY) * Math.max(0, dt) + .08 &&
    airTime <= Math.max(.9, player.impulseY / 12 + .4);
  player.motionSeq = packet.motionSeq;
  player.motionTime = packet.motionTime;
  if (!valid) {
    player.correctionId++;
    player.correctionX = player.x - packet.px;
    player.correctionY = player.y - packet.py;
    player.correctionZ = player.z - packet.pz;
    return;
  }
  player.motionBudget -= dt; // Preserve timing debt; tolerance is jitter credit, not free credit per packet.
  const wasGrounded = player.grounded;
  player.velocityX = dx / dt; player.velocityY = (packet.py - player.y) / dt; player.velocityZ = dz / dt;
  Object.assign(player, { x: moved.x, y: Math.max(ground, packet.py), z: moved.z, airTime,
    grounded: packet.py <= ground + .03, stamina: 1,
    sprinting: player.input.sprint && !player.input.sneak && !player.bowDrawing && !player.sprintSuppressed && Math.hypot(dx, dz) > .001 });
  player.impulseAckId = player.impulseId;
  player.motionWasDrawing = player.bowDrawing;
  player.drawAllowance *= Math.exp((player.grounded ? -12 : -1.8) * dt);
  player.impulseAllowance *= Math.exp(-1.8 * impulseDt);
  player.jumpAllowance *= Math.exp(-1.8 * dt);
  player.landingAllowance *= Math.exp(-12 * dt);
  if (!wasGrounded && player.grounded) player.landingAllowance = 2.55;
  if (player.grounded) { player.airOrigin = player.y; player.jumpAllowance = 0; }
}
