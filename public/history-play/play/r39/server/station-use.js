// The snapshot carries these actual work surfaces to the client. No separate
// shop menu or client supplied purchase position is trusted.
export function stationSurfaces(station, height) {
  const yaw = (station.id === 'west' ? 40 : station.id === 'east' ? -35 : 0) * Math.PI / 180;
  const at = (x, z) => ({ x: station.x + x * Math.cos(yaw) + z * Math.sin(yaw),
    z: station.z - x * Math.sin(yaw) + z * Math.cos(yaw) });
  const anvil = at(-2.55, -1.8), counter = at(0, -1.54), shelter = at(0, -1.68);
  return { anvilX: anvil.x, anvilY: height(anvil.x, anvil.z) + .82, anvilZ: anvil.z, anvilRadius: .65,
    counterX: counter.x, counterY: height(shelter.x, shelter.z) + 1, counterZ: counter.z, counterRadius: .95,
    useRange: 3 };
}

export function stationTarget(world, player, aim, range = 6) {
  const eye = world.eyes(player);
  let nearest = null;
  for (const station of world.stations) for (const kind of ['counter', 'anvil']) {
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
  if (!packet.use) { player.stationUse = null; return; }
  if (packet.useId <= (player.usePressId || 0)) return;
  player.usePressId = packet.useId;
  const target = stationTarget(world, player, player.input);
  player.stationUse = target ? { id: packet.useId, stationId: target.station.id, kind: target.kind,
    weapon: player.weapon, notified: false } : null;
}

export function stationAction(world, player, input) {
  if (!player.useProtocol) return input; // Previous clients retain their wire contract.
  const clean = { ...input, sell: false, upgrade: false, expand: false };
  const intent = player.stationUse;
  if (!input.use || !intent || intent.weapon !== player.weapon) return clean;
  const hit = stationTarget(world, player, input);
  if (!hit || hit.station.id !== intent.stationId || hit.kind !== intent.kind) {
    player.stationUse = null; return clean;
  }
  clean.stationHandling = true; clean.fire = false;
  if (intent.id === player.useConsumedId || hit.distance > hit.station.useRange ||
      world.stationAt(player, 'radius')?.id !== intent.stationId) return clean;
  const bag = player.weapon === 'bag';
  const item = bag ? world.nextBag(player) : world.nextPick(player);
  let reason = '';
  if (intent.kind === 'counter') {
    if (player.bag.length) clean.sell = true;
    else reason = 'empty';
  } else if (player.weapon !== 'pick' && !bag) reason = 'unsupported';
  else if (!item) reason = 'maximum';
  else if (player.score < item.cost) reason = 'funds';
  else { clean.upgrade = !bag; clean.expand = bag; }
  if (reason && !intent.notified) {
    world.event('workshop-denied', player, hit.station, { reason,
      value: reason === 'funds' ? item.cost - player.score : 0, kind: bag ? 'bag' : player.weapon });
    intent.notified = true;
  }
  return clean;
}
