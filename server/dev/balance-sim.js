import { World } from '../game.js';
import { pathToFileURL } from 'node:url';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function aim(world, player, point) {
  const eye = world.eyes(player);
  const x = point.x - eye.x, y = point.y - eye.y, z = point.z - eye.z;
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

export const STRATEGIES = [
  { name: 'cash', maxLevel: 1, investBefore: 0 },
  { name: 'steel', maxLevel: 2, investBefore: 75 },
  { name: 'top', maxLevel: 8, investBefore: 145 },
  { name: 'forged', maxLevel: 4, investBefore: 105 },
  { name: 'late', maxLevel: 8, investAfter: 105, investBefore: 160 },
];

export class RoutePlayer {
  constructor(world, player, { maxLevel = world.picks.length, investBefore = 145, investAfter = 0,
    precision = .5, avoid = true, preferGold = true, strikeSeconds = null, knowledge = false, initialCopper = false } = {}) {
    Object.assign(this, { world, player, maxLevel, investBefore, investAfter, precision, avoid, preferGold, knowledge, initialCopper });
    this.strikeSeconds = strikeSeconds;
    this.target = null;
    this.selling = null;
    this.nextPlan = 0;
    this.nextStrike = 0;
    this.precise = false;
  }

  input() {
    const w = this.world, p = this.player;
    if (this.knowledge) w.observeOre(p);
    const visibleRivals = this.knowledge ? w.visibleOpponents(p) : null;
    const perceived = d => this.knowledge ? w.perceivedOre(p, d) : d;
    const elapsed = w.roundSeconds - w.timeLeft;
    const pick = w.picks[p.pickLevel - 1], next = w.nextPick(p);
    const invest = next && p.pickLevel < this.maxLevel && p.score >= next.cost &&
      elapsed >= this.investAfter && elapsed < this.investBefore;
    if (invest && !p.bag.length && w.stationAt(p, 'radius')) {
      this.target = null;
      this.selling = null;
      return p.upgradeHeld ? {} : { upgrade: true };
    }

    const nearest = [...w.stations].sort((a, b) => distance(a, p) - distance(b, p))[0];
    const threshold = p.pickLevel === 1 && this.maxLevel > 1 ? 2 : 4;
    const returnNow = p.bag.length >= threshold || invest ||
      p.bag.length && (w.timeLeft < distance(nearest, p) / w.valley.data.walkSpeed + 6 ||
        !w.deposits.some(d => perceived(d).hp && perceived(d).active && d.ore.minLevel <= p.pickLevel));
    if (this.selling && !p.bag.length) this.selling = null;
    if (returnNow || this.selling) {
      this.target = null;
      if (!this.selling) {
        const choice = w.chooseBotSale(p);
        if (!choice) return {};
        this.selling = choice.station;
        p.goalKey = choice.station.id;
        p.goal = choice.station;
        p.route = choice.route;
      }
      if (distance(p, this.selling) <= this.selling.radius - .2) return { sell: true };
      return w.travel(p, aim(w, p, this.selling), false);
    }

    const occupied = d => this.knowledge ? visibleRivals.some(other =>
      distance(other, d) < w.config.range + d.radius && other.bag.length < w.config.capacity)
      : w.time - d.minedAt < 1.5 && [...w.players.values()].some(other =>
      other !== p && distance(other, d) < w.config.range + d.radius && d.work.has(other.id));
    if (this.target && (!perceived(this.target).hp || !perceived(this.target).active ||
      this.avoid && occupied(this.target) && (!this.knowledge || distance(p, this.target) > w.config.range))) this.target = null;
    if (!this.target && w.time >= this.nextPlan) {
      this.nextPlan = w.time + .4;
      const damage = pick.damage * (1 - this.precision) + pick.weakDamage * this.precision;
      const interval = this.strikeSeconds || pick.hitCooldown;
      const candidates = w.deposits.filter(d => perceived(d).hp && perceived(d).active && d.ore.minLevel <= p.pickLevel && d.approaches.length
        && (!this.initialCopper || p.grossSales > 0 || d.kind === 'copper'))
        .map(d => {
          const travel = Math.max(0, distance(p, d) - 1.8) / w.valley.data.walkSpeed;
          const work = Math.ceil(perceived(d).hp / damage) * interval;
          const home = Math.min(...w.stations.map(s => distance(s, d))) / w.valley.data.walkSpeed;
          const claimed = occupied(d);
          const penalty = claimed && this.avoid ? 5 : 1;
          const late = d.kind === 'gold' && travel + work + .8 > d.expiresAt - w.time;
          const value = d.ore.yield * d.ore.value;
          const rank = late ? -Infinity : value / (3 + travel + work + home * .55) / penalty;
          return { d, rank: rank * (d.kind === 'gold' && this.preferGold ? 1.12 : 1) };
        }).filter(c => Number.isFinite(c.rank)).sort((a, b) => b.rank - a.rank);
      for (const { d } of candidates) {
        if (this.avoid && occupied(d) && (!this.knowledge || distance(p, d) > w.config.range)) continue;
        if (!w.planRoute(p, d.id, w.miningPositions(p, d))) continue;
        this.target = d;
        this.nextStrike = w.time + .12;
        break;
      }
    }
    const d = this.target;
    if (!d) return p.bag.length ? { sell: false } : {};
    if (distance(p, p.goal) < .5 && [...w.players.values()].some(other =>
      other !== p && distance(other, p) < .85)) {
      p.goal = null;
      if (!w.planRoute(p, d.id, w.miningPositions(p, d))) { this.target = null; return {}; }
    }
    if (distance(p, p.goal) > .30) return w.travel(p, aim(w, p, d.weak), false);
    const fire = w.time + 1e-9 >= this.nextStrike;
    if (fire) {
      this.precise = w.random() < this.precision;
      this.nextStrike = w.time + (this.strikeSeconds || pick.hitCooldown);
    }
    const point = this.precise ? d.weak : { x: d.x, y: d.y + d.height * .72, z: d.z };
    const at = aim(w, p, point);
    return { ax: at.x, ay: at.y, az: at.z, fire };
  }
}

export function simulate({ seed = 77, strategies = [STRATEGIES[2]], precision = .5, bots = true,
  spawn = 0, secondCost = null } = {}) {
  let randomState = seed;
  let rareState = seed * 197 + 1;
  const world = new World({ bots,
    random: () => ((randomState = randomState * 16807 % 2147483647) - 1) / 2147483646,
    rareRandom: () => ((rareState = rareState * 16807 % 2147483647) - 1) / 2147483646 });
  if (secondCost !== null) world.picks = world.picks.map(pick => pick.level === 3 ? { ...pick, cost: secondCost } : pick);
  world.spawnCounter = spawn;
  const drivers = strategies.map((strategy, index) => {
    const player = world.addPlayer('sim-' + index, strategy.name);
    return new RoutePlayer(world, player, { ...strategy, precision });
  });
  const records = new Map(drivers.map(driver => [driver.player.id, {
    name: driver.player.name, upgrades: [], ore: {}, sales: 0, firstSale: null,
  }]));
  let lastEvent = 0;
  for (let i = 0; i < world.roundSeconds * 20; i++) {
    for (const driver of drivers) world.input(driver.player.id, driver.input());
    world.tick(.05);
    for (const event of world.events) {
      if (+event.id <= lastEvent) continue;
      lastEvent = +event.id;
      const record = records.get(event.actorId);
      if (!record) continue;
      if (event.type === 'harvest') record.ore[event.kind] = (record.ore[event.kind] || 0) + event.amount;
      if (event.type === 'sold') { record.sales++; record.firstSale ??= +world.time.toFixed(1); }
      if (event.type === 'upgraded') record.upgrades.push([event.amount, +world.time.toFixed(1)]);
    }
  }
  return {
    seed, spawn, precision,
    players: drivers.map(({ player: p }) => ({ ...records.get(p.id), level: p.pickLevel,
      score: p.score, gross: p.grossSales, spent: p.investmentSpent, unsold: world.bagValue(p) })),
    bots: [...world.players.values()].filter(p => p.bot).map(p => ({ score: p.score, level: p.pickLevel })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const precision of [.15, .7]) {
    for (const seed of [7, 77, 777]) {
      for (const strategy of STRATEGIES)
        console.log(JSON.stringify(simulate({ seed, strategies: [strategy], precision, spawn: seed % 3 })));
    }
  }
}
