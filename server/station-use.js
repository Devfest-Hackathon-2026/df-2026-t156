// The snapshot carries these actual work surfaces to the client. No separate
// shop menu or client supplied purchase position is trusted.
export function stationSurfaces(station, height) {
  return { anvilX: station.x, anvilY: height(station.x, station.z) + .82,
    anvilZ: station.z, anvilRadius: .65, useRange: 3 };
}

export function stationTarget(world, player, aim, range = 6) {
  const eye = world.eyes(player);
  let nearest = null;
  for (const station of world.stations) for (const kind of ['anvil']) {
    const x = station[kind + 'X'] - eye.x, y = station[kind + 'Y'] - eye.y, z = station[kind + 'Z'] - eye.z;
    const along = x * aim.ax + y * aim.ay + z * aim.az;
    const radius = station[kind + 'Radius'];
    const square = radius * radius - (x * x + y * y + z * z - along * along);
    if (along < 0 || square < 0) continue;
    const distance = Math.max(0, along - Math.sqrt(square));
    if (distance > range || nearest && nearest.distance <= distance) continue;
    if (world.valley.rayDistance(eye, { x: aim.ax, y: aim.ay, z: aim.az }, distance) < distance - .08) continue;
    nearest = { station, kind, distance };
  }
  return nearest;
}

export function receiveStationUse(world, player, packet) {
  if (!Number.isSafeInteger(packet.useId) || packet.useId < 0) return;
  player.useProtocol = true;
  if (!packet.use) { if (!player.stationUse?.pending) player.stationUse = null; return; }
  if (packet.useId <= (player.usePressId || 0)) return;
  player.usePressId = packet.useId;
  player.upgradeHeld = false;
  const target = stationTarget(world, player, player.input);
  if (!target || target.kind !== 'anvil') { player.stationUse = null; return; }
  const item = player.weapon === 'bag' ? world.nextBag(player) : world.nextPick(player);
  const reason = target.distance > target.station.useRange || world.stationAt(player, 'radius')?.id !== target.station.id ? 'range'
    : player.weapon !== 'pick' && player.weapon !== 'bag' ? 'unsupported'
    : !item ? 'maximum' : player.score < item.cost ? 'funds' : '';
  player.stationUse = { id: packet.useId, stationId: target.station.id, weapon: player.weapon,
    pending: true, reason, missing: reason === 'funds' ? item.cost - player.score : 0 };
}

export function stationAction(world, player, input) {
  if (!player.useProtocol) return input;
  const clean = { ...input, sell: false, upgrade: false, expand: false };
  const intent = player.stationUse;
  if (!intent?.pending) return clean;
  intent.pending = false;
  player.useConsumedId = intent.id;
  clean.stationHandling = true; clean.fire = false;
  const station = world.stations.find(s => s.id === intent.stationId);
  if (intent.weapon !== player.weapon) return clean;
  if (intent.reason) {
    world.event('workshop-denied', player, station, { reason: intent.reason,
      value: intent.missing, kind: player.weapon });
    return clean;
  }
  const hit = stationTarget(world, player, input);
  if (!hit || hit.kind !== 'anvil' || hit.station.id !== intent.stationId || hit.distance > station.useRange ||
      world.stationAt(player, 'radius')?.id !== intent.stationId) return clean;
  clean.upgrade = player.weapon === 'pick'; clean.expand = player.weapon === 'bag';
  clean.instantUpgrade = true;
  return clean;
}
