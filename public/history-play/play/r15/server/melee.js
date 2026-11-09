// Minecraft Java Edition 1.8.9, unenchanted survival melee. See protocol.md for the jar/method anchors.
export const MELEE = Object.freeze({ reach: 3, halfWidth: .3, height: 1.8, border: .1,
  hurtSeconds: .5, rewindSeconds: .25 });

export function playerRayHit(eye, ray, body) {
  let enter = 0, exit = Infinity;
  for (const [axis, low, high] of [['x', body.x - .4, body.x + .4],
    ['y', body.y - .1, body.y + 1.9], ['z', body.z - .4, body.z + .4]]) {
    if (Math.abs(ray[axis]) < 1e-10) {
      if (eye[axis] < low || eye[axis] > high) return Infinity;
      continue;
    }
    const a = (low - eye[axis]) / ray[axis], b = (high - eye[axis]) / ray[axis];
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
  }
  return enter <= exit ? enter : Infinity;
}

export function recordCombatPose(world, player) {
  const history = player.combatHistory ||= [];
  const pose = { time: world.time, x: player.x, y: player.y, z: player.z };
  if (history.at(-1)?.time === world.time) history[history.length - 1] = pose;
  else history.push(pose);
  while (history.length > 1 && history[1].time < world.time - MELEE.rewindSeconds - .1) history.shift();
}

export function combatPose(player, time) {
  const history = player.combatHistory || [];
  if (!history.length || time >= history.at(-1).time) return player;
  if (time < history[0].time - .05) return null;
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1], b = history[i];
    if (b.time < time) continue;
    // A respawn/teleport cannot create a hittable path through intervening terrain.
    if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > 2) return null;
    const t = Math.max(0, (time - a.time) / (b.time - a.time));
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }
  return history[0];
}

export function receiveAttack(world, player, packet) {
  if (world.phase !== 'playing' || !Number.isSafeInteger(packet.attackId) || packet.attackId <= 0 ||
      packet.attackId <= (player.attackId || 0)) return;
  player.attackId = packet.attackId;
  const time = Number.isFinite(packet.attackTime) ? packet.attackTime : world.time;
  if (time < world.time - MELEE.rewindSeconds - 1e-9 || time > world.time + .05) return;
  const queue = player.pendingAttacks ||= [];
  if (queue.length >= 4) return;
  const aim = [packet.attackAx, packet.attackAy, packet.attackAz];
  const length = Math.hypot(...aim);
  const ray = aim.every(Number.isFinite) && length > .01
    ? { ax: aim[0] / length, ay: aim[1] / length, az: aim[2] / length } : player.input;
  queue.push({ ...player.input, ...ray, miningOnly: false,
    eye: world.eyes(player), viewTime: Math.min(time, world.time), queuedAt: world.time });
}

export function hitPlayer(world, attacker, victim, point, input) {
  if (world.stationAt(attacker, 'safeRadius') || world.stationAt(victim, 'safeRadius')) {
    world.event('protected', attacker, point, { targetId: victim.id });
    return;
  }
  const critical = attacker.grounded === false && attacker.velocityY < 0;
  // There is no health pool here. Equal pick hits use 1; a falling critical uses 1.5.
  // As in 1.8.9, a stronger hit may pass the 10-tick hurt window, but gets no second base knockback.
  const damage = critical ? 1.5 : 1;
  const fresh = world.time + 1e-9 >= (victim.hurtUntil || 0);
  if (!fresh && damage <= victim.lastHitDamage) return;
  victim.lastHitDamage = damage;
  if (fresh) victim.hurtUntil = world.time + MELEE.hurtSeconds;
  let vx = victim.velocityX || 0, vy = victim.velocityY || 0, vz = victim.velocityZ || 0;
  if (fresh) {
    let dx = victim.x - attacker.x, dz = victim.z - attacker.z;
    let length = Math.hypot(dx, dz);
    if (length < .01) { dx = input.ax; dz = input.az; length = Math.hypot(dx, dz) || 1; }
    vx = vx / 2 + dx / length * 8;
    vy = Math.min(8, vy / 2 + 8);
    vz = vz / 2 + dz / length * 8;
  }
  const sprint = attacker.sprinting && !attacker.sprintSuppressed;
  if (sprint) {
    const length = Math.hypot(input.ax, input.az) || 1;
    vx += input.ax / length * 10; vy += 2; vz += input.az / length * 10;
    world.applyKnockback(attacker, (attacker.velocityX || 0) * .6,
      attacker.velocityY || 0, (attacker.velocityZ || 0) * .6);
    attacker.sprinting = false;
    attacker.sprintSuppressed = true;
  }
  if (fresh || sprint) world.applyKnockback(victim, vx, vy, vz);
  victim.sellProgress = 0; victim.sale = null;
  world.event('hit', attacker, point, { targetId: victim.id, kind: sprint ? 'sprint' : critical ? 'critical' : 'normal' });
  world.steal(attacker, victim, point);
}
