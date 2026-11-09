import { combatVelocity } from './motion.js';

// Minecraft Java Edition 1.8.9, unenchanted survival melee. See protocol.md for the jar/method anchors.
export const MELEE = Object.freeze({ reach: 3, halfWidth: .3, height: 1.8, border: .1,
  hurtSeconds: .5, rewindSeconds: .25 });

export function playerRayHit(eye, ray, body, border = MELEE.border) {
  let enter = 0, exit = Infinity;
  for (const [axis, low, high] of [['x', body.x - MELEE.halfWidth - border, body.x + MELEE.halfWidth + border],
    ['y', body.y - border, body.y + MELEE.height + border],
    ['z', body.z - MELEE.halfWidth - border, body.z + MELEE.halfWidth + border]]) {
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
  if (player.weapon === 'bow' && player.bowConsumesAttack) return;
  const time = Number.isFinite(packet.attackTime) ? packet.attackTime : world.time;
  // Snapshot clocks are sent in whole milliseconds; Unity holds viewed time
  // in float32. Compare age at that wire precision, so 250.003ms is 250ms.
  if (Math.round((world.time - time) * 1000) > MELEE.rewindSeconds * 1000) {
    if (world.time >= (player.nextLateHint || 0)) {
      world.event('guarded', player, world.eyes(player), { meleeReason: 'late' });
      player.nextLateHint = world.time + .75;
    }
    return;
  }
  if (time > world.time + .05) return;
  const queue = player.pendingAttacks ||= [];
  if (queue.length >= 4) return;
  const aim = [packet.attackAx, packet.attackAy, packet.attackAz];
  const length = Math.hypot(...aim);
  const ray = aim.every(Number.isFinite) && length > .01
    ? { ax: aim[0] / length, ay: aim[1] / length, az: aim[2] / length } : player.input;
  queue.push({ ...player.input, ...ray, weapon: player.weapon, miningOnly: false,
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
  const accepted = acceptHurt(world, victim, damage);
  if (!accepted) {
    // Explain a real rejected press, without turning rapid clicks into event spam.
    if (world.time >= (attacker.nextHurtHint || 0)) {
      world.event('guarded', attacker, point, { targetId: victim.id, meleeReason: 'hurt' });
      attacker.nextHurtHint = world.time + .35;
    }
    return;
  }
  const { fresh } = accepted;
  const velocity = combatVelocity(victim);
  let vx = velocity.x, vy = velocity.y, vz = velocity.z;
  if (fresh) ({ vx, vy, vz } = baseKnockback(attacker, victim, input));
  const sprint = attacker.sprinting && !attacker.sprintSuppressed;
  if (sprint) {
    const facing = horizontalFacing(attacker, input);
    vx += facing.x * 10; vy += 2; vz += facing.z * 10;
    const ownVelocity = combatVelocity(attacker);
    world.applyKnockback(attacker, ownVelocity.x * .6, ownVelocity.y, ownVelocity.z * .6);
    attacker.sprinting = false;
    attacker.sprintSuppressed = true;
  }
  if (fresh || sprint) world.applyKnockback(victim, vx, vy, vz);
  victim.sellProgress = 0; victim.sale = null;
  const meleeReason = !victim.bag.length ? 'empty'
    : attacker.bag.length >= world.capacity(attacker) ? 'full' : '';
  world.event('hit', attacker, point, { targetId: victim.id,
    kind: sprint ? 'sprint' : critical ? 'critical' : 'normal', meleeReason, critical });
  world.steal(attacker, victim, point);
}

// Both arrows and melee use the ten-tick hurt window. A stronger hit may
// pass it, but does not restart the deadline or earn a second base knockback.
export function acceptHurt(world, victim, strength) {
  if (!Number.isFinite(strength) || strength <= 0) return null;
  const fresh = world.time + 1e-9 >= (victim.hurtUntil || 0);
  if (!fresh && strength <= (victim.lastHitDamage || 0)) return null;
  victim.lastHitDamage = strength;
  if (fresh) victim.hurtUntil = world.time + MELEE.hurtSeconds;
  return { fresh };
}

function horizontalFacing(attacker, input) {
  const length = Math.hypot(input.ax || 0, input.az || 0);
  return length > 1e-6 ? { x: input.ax / length, z: input.az / length }
    : { x: Math.sin(attacker.yaw || 0), z: Math.cos(attacker.yaw || 0) };
}

export function baseKnockback(attacker, victim, input = {}) {
  let dx = victim.x - attacker.x, dz = victim.z - attacker.z;
  let length = Math.hypot(dx, dz);
  if (length < .01) { const facing = horizontalFacing(attacker, input); dx = facing.x; dz = facing.z; length = 1; }
  const velocity = combatVelocity(victim);
  return { vx: velocity.x / 2 + dx / length * 8,
    vy: Math.min(8, velocity.y / 2 + 8), vz: velocity.z / 2 + dz / length * 8 };
}
