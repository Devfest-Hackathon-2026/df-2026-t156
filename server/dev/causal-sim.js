import { World } from '../game.js';
import { RoutePlayer } from './balance-sim.js';
import { pathToFileURL } from 'node:url';

function historicalWorld(options) { return new World({ botTactics: false, botKnowledge: false, goldLayers: null, secondPickCost: 36, ...options }); }

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function random(seed) {
  let state = seed;
  return () => ((state = state * 16807 % 2147483647) - 1) / 2147483646;
}
function at(world, player, x, z) {
  Object.assign(player, { x, z, y: world.valley.height(x, z) });
}
function isolatedInput(world, driver, rng) {
  const previous = world.random;
  world.random = rng;
  try { return driver.input(); }
  finally { world.random = previous; }
}

export function fixedGold(world, ids = ['gold-1', 'gold-3', 'gold-2', 'gold-4'], hintPairs = null) {
  const original = world.updateRareSites.bind(world);
  let wave = 0;
  world.updateRareSites = () => {
    const previous = world.rareRandom;
    const previousHint = world.hintRandom;
    if (world.rareHintSeconds && !world.possibleRare.length && !world.announcedRare.length &&
      world.time >= world.nextRareAt - world.rareHintSeconds) {
      const pool = world.rareCandidates();
      const target = ids[wave % ids.length];
      const decoy = pool.filter(d => d.id !== target)[wave % Math.max(1, pool.length - 1)]?.id;
      const order = hintPairs?.[wave % hintPairs.length] || (wave % 2 ? [decoy, target] : [target, decoy]);
      let draw = 0;
      world.hintRandom = () => {
        const desired = order[draw++];
        const index = Math.max(0, pool.findIndex(d => d.id === desired));
        const value = (index + .1) / pool.length;
        pool.splice(index, 1);
        return value;
      };
    }
    if (!world.announcedRare.length && world.time >= world.nextRareAt - world.rare.previewSeconds) {
      const pool = world.rareSelectionPool ? world.rareSelectionPool() : world.rareCandidates();
      const target = ids[wave++ % ids.length];
      const index = Math.max(0, pool.findIndex(d => d.id === target));
      world.rareRandom = () => (index + .1) / pool.length;
    }
    try { original(); }
    finally { world.rareRandom = previous; world.hintRandom = previousHint; }
  };
}

// Only this offline world is changed. Runtime code/data are not mutated.
function progressiveExposure(world, seconds = 1.5) {
  const original = world.mine.bind(world), started = new Map();
  world.mine = (p, d, weak, point) => {
    if (d.kind !== 'gold') return original(p, d, weak, point);
    if (!started.has(d.id)) started.set(d.id, world.time);
    const opened = Math.min(d.ore.hp, 6 + Math.floor((world.time - started.get(d.id)) / seconds) * 6);
    const remaining = opened - (d.ore.hp - d.hp);
    if (remaining <= 0) return;
    const previous = world.picks;
    world.picks = previous.map(pick => ({ ...pick,
      damage: Math.min(pick.damage, remaining), weakDamage: Math.min(pick.weakDamage, remaining) }));
    try { original(p, d, weak, point); }
    finally { world.picks = previous; }
  };
}

export function middleFork({ buy, rivals = 1, rivalLevel = 3, rivalPrecision = .7, rivalStart = 'near',
  seed = 77, progressive = false, remaining = 90, secondCost = null, knowledge = false, preview = 0 } = {}) {
  const world = historicalWorld({ bots: false, random: random(991), secondPickCost: secondCost ?? 36, botKnowledge: knowledge });
  world.rare = { ...world.rare, previewSeconds: preview };
  fixedGold(world);
  world.time = 180 - remaining;
  world.timeLeft = remaining;
  const waveStart = world.rare.firstAt + Math.floor((world.time - world.rare.firstAt) / world.rare.interval) * world.rare.interval;
  world.nextRareAt = waveStart + world.rare.interval;
  const target = world.deposits.find(d => d.id === 'gold-4');
  Object.assign(target, { active: true, hp: target.ore.hp, expiresAt: waveStart + world.rare.activeSeconds });
  if (progressive) progressiveExposure(world);
  const actor = world.addPlayer('actor', buy ? 'buy' : 'cash');
  Object.assign(actor, { pickLevel: 2, score: 44, grossSales: 52, investmentSpent: 8 });
  at(world, actor, 31, 2);
  const drivers = [new RoutePlayer(world, actor, {
    maxLevel: buy ? 3 : 2, investBefore: 170, precision: .7, avoid: true, knowledge,
  })];
  for (let i = 0; i < rivals; i++) {
    const player = world.addPlayer('rival-' + i, 'Rival ' + i);
    Object.assign(player, { pickLevel: rivalLevel, score: 40, grossSales: rivalLevel === 3 ? 84 : 48,
      investmentSpent: rivalLevel === 3 ? 44 : 8 });
    const start = rivalStart === 'near' ? target.approaches[(i * 3 + 2) % target.approaches.length] :
      rivalStart === 'west' ? { x: -31, z: 1 } : { x: 20 + i * 3, z: 12 };
    at(world, player, start.x, start.z);
    drivers.push(new RoutePlayer(world, player, {
      maxLevel: rivalLevel, investBefore: 0, precision: rivalPrecision, avoid: true, knowledge,
    }));
  }
  const rngs = drivers.map((_, index) => random(seed + index * 197));
  const record = { buy, rivals, rivalLevel, rivalStart, seed, progressive, remaining,
    goldHits: [], goldCarriers: new Set(), sales: [], goldViews: [] };
  let last = 0, lastView = -Infinity;
  while (world.phase === 'playing') {
    for (const [i, driver] of drivers.entries()) world.input(driver.player.id, isolatedInput(world, driver, rngs[i]));
    world.tick(.05);
    for (const e of world.events) {
      if (+e.id <= last) continue;
      last = +e.id;
      const time = +(world.time - (180 - remaining)).toFixed(2);
      if (e.kind === 'gold' && ['mine', 'weak'].includes(e.type)) record.goldHits.push([time, e.actorId, e.amount, e.targetId]);
      if (e.kind === 'gold' && ['harvest', 'steal'].includes(e.type)) record.goldCarriers.add(e.actorId);
      if (e.type === 'sold' && e.actorId === actor.id) record.sales.push([time, e.value]);
    }
    if (world.time - lastView >= 1) {
      lastView = world.time;
      for (const driver of drivers) {
        const p = driver.player;
        const active = world.deposits.filter(d => d.kind === 'gold' && d.hp);
        if (active.some(d => distance(p, d) < 18)) record.goldViews.push([+(world.time - (180 - remaining)).toFixed(1), p.id]);
      }
    }
  }
  return { ...record, goldCarriers: [...record.goldCarriers], nearGoldSamples: record.goldViews.length,
    goldViews: undefined, score: actor.score,
    opponents: drivers.slice(1).map(d => d.player.score) };
}

export function arrivalRace({ delay = 1, firstPrecision = 1, latePrecision = 1,
  progressive = false, count = 2, seed = 77 } = {}) {
  const world = historicalWorld({ bots: false, random: random(991) });
  const deposit = world.deposits.find(d => d.id === 'gold-1');
  Object.assign(deposit, { active: true, hp: deposit.ore.hp, expiresAt: 25 });
  world.nextRareAt = 500;
  if (progressive) progressiveExposure(world);
  const players = Array.from({ length: count }, (_, i) => {
    const p = world.addPlayer('p' + i, 'P' + i);
    p.pickLevel = 3;
    const spot = deposit.approaches[(i * 3) % deposit.approaches.length];
    at(world, p, spot.x, spot.z);
    return p;
  });
  const rngs = players.map((_, index) => random(seed + index * 197));
  const ready = players.map(() => 0);
  const hits = [];
  let last = 0, harvested;
  for (let tick = 0; tick < 300 && !harvested; tick++) {
    for (const [i, p] of players.entries()) {
      if (world.time < (i ? delay + (i - 1) * .4 : 0) || world.time < ready[i]) continue;
      const precision = i ? latePrecision : firstPrecision;
      const point = rngs[i]() < precision ? deposit.weak : { x: deposit.x, y: deposit.y + deposit.height * .72, z: deposit.z };
      const eye = world.eyes(p), x = point.x - eye.x, y = point.y - eye.y, z = point.z - eye.z;
      const length = Math.hypot(x, y, z);
      world.input(p.id, { ax: x / length, ay: y / length, az: z / length, fire: true });
      ready[i] = world.time + world.picks[2].hitCooldown;
    }
    world.tick(.05);
    // A tap per strike rather than held fire while the later player waits.
    for (const p of players) world.input(p.id, {});
    for (const e of world.events) {
      if (+e.id <= last) continue;
      last = +e.id;
      if (e.targetId !== deposit.id) continue;
      if (['mine', 'weak'].includes(e.type)) hits.push([+world.time.toFixed(2), e.actorId, e.amount]);
      if (e.type === 'harvest') harvested = { time: +world.time.toFixed(2), recipient: e.actorId };
    }
  }
  return { delay, firstPrecision, latePrecision, progressive, count, hits, harvested };
}

export function previewComparison({ count = 2, preview = 0, seed = 77 } = {}) {
  const world = historicalWorld({ bots: false, random: random(991) });
  world.rare = { ...world.rare, previewSeconds: preview };
  const sequence = ['gold-1', 'gold-3', 'gold-2', 'gold-4'];
  fixedGold(world, sequence);
  const drivers = Array.from({ length: count }, (_, i) =>
    new RoutePlayer(world, world.addPlayer('p' + i, 'P' + i), { precision: .7, maxLevel: 3, avoid: false }));
  const rngs = drivers.map((_, i) => random(seed + i * 197));
  const waves = new Map(), waiting = new Map(drivers.map(d => [d.player.id, 0]));
  let last = 0, index = -1;
  for (let tick = 0; tick < 3600; tick++) {
    for (const [i, driver] of drivers.entries()) {
      const wave = Math.max(0, Math.round((world.nextRareAt - 50) / 35));
      const ahead = world.nextRareAt - world.time;
      const announced = world.deposits.find(d => d.id === sequence[wave % sequence.length]);
      let packet;
      if (preview && ahead <= preview && ahead > 0 && driver.player.pickLevel === 3) {
        const previous = { hp: announced.hp, active: announced.active, expiresAt: announced.expiresAt };
        Object.assign(announced, { hp: announced.ore.hp, active: true, expiresAt: world.nextRareAt + 25 });
        packet = isolatedInput(world, driver, rngs[i]);
        Object.assign(announced, previous);
        if (driver.target === announced && driver.player.goal && distance(driver.player, driver.player.goal) < .35)
          waiting.set(driver.player.id, waiting.get(driver.player.id) + .05);
      } else packet = isolatedInput(world, driver, rngs[i]);
      world.input(driver.player.id, packet);
    }
    world.tick(.05);
    const wave = Math.floor((world.time - 50) / 35);
    if (wave >= 0 && wave !== index) {
      index = wave;
      waves.set(index, { id: sequence[index % sequence.length], miners: new Set(), firstHit: null, harvest: null });
    }
    for (const event of world.events) {
      if (+event.id <= last) continue;
      last = +event.id;
      const record = waves.get(index);
      if (!record || event.kind !== 'gold') continue;
      if (['mine', 'weak'].includes(event.type)) {
        record.miners.add(event.actorId);
        record.firstHit ??= +world.time.toFixed(2);
      }
      if (event.type === 'harvest') record.harvest = [+world.time.toFixed(2), event.actorId];
    }
  }
  return { count, preview, seed, score: drivers.map(d => d.player.score),
    waitingSeconds: Object.fromEntries([...waiting].map(([id, t]) => [id, +t.toFixed(1)])),
    waves: [...waves.values()].map(w => ({ ...w, miners: [...w.miners] })) };
}

export function nativeBots({ seed = 77, preview = 6 } = {}) {
  const world = historicalWorld({ random: random(seed), rareRandom: random(seed * 197 + 1) });
  world.rare = { ...world.rare, previewSeconds: preview };
  fixedGold(world);
  world.addPlayer('human', 'Idle observer');
  const upgrades = [], waves = new Map(), changes = [];
  let last = 0, waveIndex = -1;
  const decision = new Map();
  for (let tick = 0; tick < 3600; tick++) {
    world.tick(.05);
    const index = Math.floor((world.time - 50) / 35);
    if (index >= 0 && index !== waveIndex) {
      waveIndex = index;
      waves.set(index, { miners: new Set(), carriers: new Set(), firstHit: null, harvest: null });
    }
    for (const p of world.players.values()) {
      if (!p.bot) continue;
      const signature = p.pickLevel + ':' + p.botInvest;
      if (signature !== decision.get(p.id)) {
        decision.set(p.id, signature);
        changes.push([+world.time.toFixed(1), p.id, p.pickLevel, Boolean(p.botInvest),
          p.botVisibleRivals.filter(q => q.pickLevel === 3).length]);
      }
    }
    for (const event of world.events) {
      if (+event.id <= last) continue;
      last = +event.id;
      if (event.type === 'upgraded') upgrades.push([+world.time.toFixed(1), event.actorId, event.amount]);
      const wave = waves.get(waveIndex);
      if (!wave || event.kind !== 'gold') continue;
      if (['mine', 'weak'].includes(event.type)) {
        wave.miners.add(event.actorId);
        wave.firstHit ??= +world.time.toFixed(2);
      }
      if (['harvest', 'steal'].includes(event.type)) wave.carriers.add(event.actorId);
      if (event.type === 'harvest') wave.harvest = [+world.time.toFixed(2), event.actorId];
    }
  }
  return { seed, preview, upgrades, changes,
    players: [...world.players.values()].filter(p => p.bot).map(p => ({
      id: p.id, level: p.pickLevel, score: p.score,
    })),
    waves: [...waves.values()].map(wave => ({ ...wave, miners: [...wave.miners], carriers: [...wave.carriers] })) };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv[2] === 'bots') {
  for (const seed of [7, 77, 777]) for (const preview of [0, 6])
    console.log(JSON.stringify(nativeBots({ seed, preview })));
} else if (isMain && process.argv[2] === 'preview') {
  for (const count of [2, 3]) for (const seed of [7, 77, 777]) for (const preview of [0, 6])
    console.log(JSON.stringify(previewComparison({ count, seed, preview })));
} else if (isMain && process.argv[2] === 'race') {
  for (const progressive of [false, true]) for (const delay of [.4, 1, 1.7, 2.4])
    for (const firstPrecision of [0, 1])
      console.log(JSON.stringify(arrivalRace({ progressive, delay, firstPrecision })));
} else if (isMain && process.argv[2] === 'fork') {
  for (const rivals of [1, 2]) for (const rivalLevel of [2, 3]) for (const rivalStart of ['near', 'west'])
    for (const buy of [false, true])
      console.log(JSON.stringify(middleFork({ buy, rivals, rivalLevel, rivalStart })));
}
