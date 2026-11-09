// Offline comparison adapter. Production startup/deployment never imports this module.
export function installForecast(world, { mode = 'six', hintRandom = Math.random,
  goldPreviewSeconds = mode === 'ten' ? 10 : 6, rareHintSeconds = mode === 'pair' ? 18 : 0 } = {}) {
  world.rare = { ...world.rare, previewSeconds: goldPreviewSeconds };
  world.rareHintSeconds = rareHintSeconds;
  world.hintRandom = hintRandom;
  world.possibleRare = [];
  const candidates = world.rareCandidates.bind(world), update = world.updateRareSites.bind(world);
  const reset = world.resetRound.bind(world), rank = world.botMiningRank.bind(world);
  const input = world.botInput.bind(world), snapshot = world.snapshot.bind(world);
  world.rareSelectionPool = () => world.possibleRare.length ? [...world.possibleRare] : candidates();
  world.rareCandidates = world.rareSelectionPool;
  world.possibleGold = deposit => !world.announcedRare.length && world.possibleRare.includes(deposit);
  world.knownGold = () => world.deposits.filter(d => d.kind === 'gold' &&
    (d.announced || d.active && d.hp || world.possibleGold(d)));
  world.rareForecast = () => {
    const sites = world.announcedRare.length ? world.announcedRare : world.possibleRare;
    return { phase: world.announcedRare.length ? 'confirmed' : sites.length ? 'possible' : 'none',
      opensIn: Math.max(0, world.nextRareAt - world.time),
      sites: sites.map(d => ({ id: d.id, x: d.x, z: d.z })) };
  };
  world.updateRareSites = () => {
    if (rareHintSeconds && !world.possibleRare.length && !world.announcedRare.length &&
      world.time >= world.nextRareAt - rareHintSeconds && world.nextRareAt < world.time + world.timeLeft) {
      const pool = candidates();
      for (let i = 0, count = Math.min(2, pool.length); i < count; i++) {
        const index = Math.min(pool.length - 1, Math.floor(world.hintRandom() * pool.length));
        world.possibleRare.push(pool.splice(index, 1)[0]);
      }
    }
    const previous = world.nextRareAt;
    update();
    if (world.nextRareAt !== previous) world.possibleRare = [];
  };
  world.resetRound = () => { reset(); world.possibleRare = []; };
  world.botMiningRank = (player, deposit) => rank(player, deposit) * (world.possibleGold(deposit) ? .5 : 1);
  world.botInput = player => {
    // Synchronous forecast-only view for the existing policy; restore before strikes/snapshots.
    const possible = world.announcedRare.length ? [] : world.possibleRare;
    const prior = possible.map(d => [d, d.announced, d.opensAt]);
    for (const [d] of prior) { d.announced = true; d.opensAt = world.nextRareAt; }
    try { return input(player); }
    finally { for (const [d, announced, opensAt] of prior) Object.assign(d, { announced, opensAt }); }
  };
  world.snapshot = viewerId => ({ ...snapshot(viewerId),
    ...(mode !== 'six' ? { rareForecast: world.rareForecast() } : {}) });
  return world;
}
