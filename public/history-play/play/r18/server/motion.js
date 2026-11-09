// Java 1.8.9 scale: blocks are metres; client movement is validated, never chased by a second simulation.
export const MOTION = Object.freeze({ walk: 4.317, sprint: 5.612, sneak: 1.295, jump: 8.4 });

export function resetMotion(player, time, round) {
  Object.assign(player, { clientMotion: false, motionRound: round, motionSeq: 0, motionTime: 0,
    motionBudget: .25, motionBudgetAt: time, correctionId: 0, correctionX: 0, correctionY: 0, correctionZ: 0,
    impulseId: 0, impulseAckId: 0, impulseX: 0, impulseY: 0, impulseZ: 0, velocityX: 0, velocityY: 0, velocityZ: 0,
    grounded: true, airTime: 0, sprintSuppressed: false, impulseAllowance: 0,
    externalX: 0, externalY: 0, externalZ: 0, jumpAllowance: 0, landingAllowance: 0, airOrigin: player.y });
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
  if (player.bot || !player.clientMotion) {
    const speed = player.input.sprint ? MOTION.sprint : MOTION.walk;
    player.externalX = vx - player.input.x * speed;
    player.externalY = vy;
    player.externalZ = vz - player.input.z * speed;
  }
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
    player.jumpAllowance = player.input.sprint ? 7.5 : 0;
    player.airOrigin = player.y;
  }
  const speed = MOTION.sprint + player.jumpAllowance + player.landingAllowance + (player.grounded ? 0 : 2.55);
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
    sprinting: player.input.sprint && !player.sprintSuppressed && Math.hypot(dx, dz) > .001 });
  player.impulseAckId = player.impulseId;
  player.impulseAllowance *= Math.exp(-1.8 * impulseDt);
  player.jumpAllowance *= Math.exp(-1.8 * dt);
  player.landingAllowance *= Math.exp(-12 * dt);
  if (!wasGrounded && player.grounded) player.landingAllowance = 2.55;
  if (player.grounded) { player.airOrigin = player.y; player.jumpAllowance = 0; }
}
