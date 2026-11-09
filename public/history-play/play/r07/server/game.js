import { terrain } from './valley.js';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const idle = { x: 0, z: 0, ax: 0, ay: 0, az: 1, fire: false, sprint: false, sell: false };
export const RULES = Object.freeze({ tickRate: 20, roundSeconds: 180, resultSeconds: 8, maxHumans: 8 });
const theftGrace = 2.5;
const orderSeconds = 40;
const orderPreviewSeconds = 8;
const premiumOres = ['copper', 'silver', 'crystal'];
const premiums = { copper: 2, silver: 3, crystal: 3 };
const approachAngles = Array.from({ length: 8 }, (_, i) => i * Math.PI / 4);

function aimAt(eye, point) {
  const x = point.x - eye.x, y = point.y - eye.y, z = point.z - eye.z;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

function sphereHit(eye, ray, point, radius) {
  const x = point.x - eye.x, y = point.y - eye.y, z = point.z - eye.z;
  const along = x * ray.x + y * ray.y + z * ray.z;
  const remaining = radius ** 2 - (x * x + y * y + z * z - along * along);
  if (remaining < 0 || along + Math.sqrt(remaining) < 0) return Infinity;
  return Math.max(0, along - Math.sqrt(remaining));
}

function cylinderHit(eye, ray, body) {
  const x = eye.x - body.x, z = eye.z - body.z;
  const a = ray.x ** 2 + ray.z ** 2;
  let enter = 0, exit = Infinity;
  if (a > 1e-10) {
    const b = x * ray.x + z * ray.z;
    const discriminant = b * b - a * (x * x + z * z - body.radius ** 2);
    if (discriminant < 0) return Infinity;
    const halfChord = Math.sqrt(discriminant);
    enter = Math.max(enter, (-b - halfChord) / a);
    exit = (-b + halfChord) / a;
  } else if (Math.hypot(x, z) > body.radius) return Infinity;

  if (Math.abs(ray.y) > 1e-10) {
    const base = (body.y - eye.y) / ray.y;
    const top = (body.y + body.height - eye.y) / ray.y;
    enter = Math.max(enter, Math.min(base, top));
    exit = Math.min(exit, Math.max(base, top));
  } else if (eye.y < body.y || eye.y > body.y + body.height) return Infinity;
  return enter <= exit ? enter : Infinity;
}

export class World {
  constructor({ random = Math.random, roundSeconds = RULES.roundSeconds, bots = true, valley = terrain } = {}) {
    this.random = random;
    this.roundSeconds = roundSeconds;
    this.enableBots = bots;
    this.players = new Map();
    this.valley = valley;
    this.config = valley.data.mining;
    this.ores = new Map(valley.data.ores.map(ore => [ore.id, ore]));
    this.stations = valley.data.stations.map((s, index) => ({ ...s, index, y: valley.height(s.x, s.z) }));
    this.seams = valley.data.deposits.map(d => {
      const y = valley.height(d.x, d.z);
      const weak = { x: d.x + d.weakX, y: y + d.weakY, z: d.z + d.weakZ };
      return { ...d, y, weak, startingWeak: weak, ore: this.ores.get(d.kind), approaches: this.miningApproaches(d, weak) };
    });
    this.serial = 0;
    this.round = 0;
    this.time = 0;
    this.resetRound();
  }

  miningApproaches(deposit, weak) {
    return approachAngles.flatMap(angle => {
      const x = deposit.x + Math.sin(angle) * 1.8, z = deposit.z + Math.cos(angle) * 1.8;
      if (this.valley.blocked(x, z)) return [];
      const point = { x, y: this.valley.height(x, z), z };
      const eye = this.eyes(point);
      const ray = aimAt(eye, weak);
      const hit = sphereHit(eye, ray, weak, this.config.weakRadius);
      return hit < this.valley.rayDistance(eye, ray, this.config.range) ? [point] : [];
    });
  }

  eyes(player) {
    return { x: player.x, y: player.y + this.valley.data.eyeHeight, z: player.z };
  }

  spawn(player, index) {
    const common = this.seams.filter(seam => seam.ore.value === 2 && seam.approaches.length);
    const ordered = common.slice(index % common.length).concat(common.slice(0, index % common.length));
    const seam = ordered.find(d => this.deposits.some(current => current.id === d.id && current.hp)) || ordered[0];
    // Put the first exposed seam in the direction of the starting view.
    const open = seam?.approaches.map(at => {
      const x = seam.x + (at.x - seam.x) * 3, z = seam.z + (at.z - seam.z) * 3;
      return { x, y: this.valley.height(x, z), z, at };
    }).find(point => {
      if (!this.valley.walkClear(point, point.at)) return false;
      const eye = this.eyes(point), ray = aimAt(eye, seam.weak);
      return this.valley.rayDistance(eye, ray, 6) > 5.3;
    });
    const start = open || seam?.approaches[0] || this.valley.move({ x: 0, z: -12 }, 0, 0);
    const yaw = seam ? Math.atan2(seam.x - start.x, seam.z - start.z) : 0;
    Object.assign(player, {
      x: start.x, y: start.y, z: start.z, yaw, score: 0, bag: [], stamina: 1, exhausted: false,
      sprinting: false, sellProgress: 0, sale: null, nextStrike: 0, invulnUntil: 0,
      input: idle, lastInputAt: -Infinity, pendingFire: false, route: [], goalKey: '', goal: null,
      botPickAt: 0, botStrikeAt: 0, botTarget: null, botSale: null,
    });
    if (!player.bot && seam) this.starterUntil.set(seam.id, this.time + 15);
  }

  resetRound() {
    this.round++;
    this.phase = 'playing';
    this.timeLeft = this.roundSeconds;
    this.resultTimeLeft = 0;
    this.winners = [];
    this.events = [];
    this.deposits = this.seams.map(seam => ({
      ...seam, hp: seam.ore.hp, regenAt: 0, minerId: '', minedAt: -Infinity, work: new Map(),
    }));
    this.spawnCounter = 0;
    this.starterUntil = new Map();
    for (const p of this.players.values()) this.spawn(p, this.spawnCounter++);
    this.balanceBots();
  }

  addPlayer(id, name, bot = false) {
    if (this.players.has(id)) return this.players.get(id);
    const player = { id, name, bot };
    this.spawn(player, this.spawnCounter++);
    this.players.set(id, player);
    if (!bot) this.balanceBots();
    return player;
  }

  removePlayer(id) {
    if (!this.players.delete(id)) return;
    for (const deposit of this.deposits) {
      deposit.work.delete(id);
      if (deposit.minerId === id) deposit.minerId = '';
    }
    this.balanceBots();
    if (![...this.players.values()].some(p => !p.bot)) this.resetRound();
  }

  balanceBots() {
    if (!this.enableBots) return;
    const humans = [...this.players.values()].filter(p => !p.bot).length;
    const desired = humans ? Math.max(0, 3 - humans) : 0;
    for (let i = 0; i < 2; i++) {
      const id = `bot-${i}`;
      if (i < desired && !this.players.has(id)) this.addPlayer(id, i ? 'VEIN' : 'PICK', true);
      if (i >= desired && this.players.delete(id)) {
        for (const d of this.deposits) {
          d.work.delete(id);
          if (d.minerId === id) d.minerId = '';
        }
      }
    }
  }

  input(id, packet) {
    const player = this.players.get(id);
    if (!player || player.bot) return;
    const n = key => Number.isFinite(packet[key]) ? clamp(packet[key], -1, 1) : 0;
    const x = n('x'), z = n('z'), movement = Math.max(1, Math.hypot(x, z));
    let ax = n('ax'), ay = n('ay'), az = n('az');
    const aim = Math.hypot(ax, ay, az);
    if (aim > .01) { ax /= aim; ay /= aim; az /= aim; }
    else { ax = Math.sin(player.yaw); ay = 0; az = Math.cos(player.yaw); }
    const fire = packet.fire === true;
    if (fire && !player.input.fire) player.pendingFire = true;
    player.input = { x: x / movement, z: z / movement, ax, ay, az,
      fire, sprint: packet.sprint === true, sell: packet.sell === true };
    player.lastInputAt = this.time;
  }

  stationAt(point, radius) {
    return this.stations.find(s => distance(s, point) <= s[radius]);
  }

  event(type, actor, point, { targetId = '', kind = '', amount = 0, value = 0, bonus = 0 } = {}) {
    const { x, y, z } = point;
    this.events.push({ id: String(++this.serial), type, actorId: actor.id, targetId, kind,
      x, y, z, amount, value, bonus, expires: this.time + .55 });
  }

  strike(player, input) {
    const eye = this.eyes(player);
    const ray = { x: input.ax, y: input.ay, z: input.az };
    let limit = this.valley.rayDistance(eye, ray, this.config.range);
    let target, weak = false;
    this.event('swing', player, eye);
    for (const deposit of this.deposits) {

      const precise = deposit.hp ? sphereHit(eye, ray, deposit.weak, this.config.weakRadius) : Infinity;
      const body = cylinderHit(eye, ray, deposit);
      const hit = Math.min(body, precise);
      if (hit >= limit) continue;
      limit = hit;
      target = deposit;
      weak = precise <= body;
    }
    const protectedAttacker = this.stationAt(player, 'safeRadius');
    for (const other of this.players.values()) {
      if (other === player) continue;
      const hit = cylinderHit(eye, ray, { ...other, radius: this.valley.data.playerRadius,
        height: this.valley.data.playerHeight });
      if (hit >= limit) continue;
      limit = hit;
      target = other;
    }
    if (!target) return;
    const point = { x: eye.x + ray.x * limit, y: eye.y + ray.y * limit, z: eye.z + ray.z * limit };
    if (target.ore) {
      if (target.hp) this.mine(player, target, weak, point);
      return;
    }
    if (!protectedAttacker && !this.stationAt(target, 'safeRadius')) this.steal(player, target, point);
  }

  mine(player, deposit, weak, point) {
    const targetId = deposit.id, kind = deposit.kind;
    if (player.bag.length >= this.config.capacity) {
      this.event('full', player, point, { targetId, kind });
      return;
    }
    const damage = Math.min(deposit.hp, weak ? 2 : 1);
    deposit.hp -= damage;
    deposit.minerId = player.id;
    deposit.minedAt = this.time;
    deposit.work.set(player.id, (deposit.work.get(player.id) || 0) + damage);
    this.event(weak ? 'weak' : 'mine', player, point, { targetId, kind, amount: damage });
    if (deposit.hp > 0) {
      this.shiftWeakPoint(deposit, player);
      return;
    }

    let recipient = player, best = 0;
    for (const [id, contribution] of deposit.work) {
      const miner = this.players.get(id);
      if (contribution <= best || !miner || miner.bag.length >= this.config.capacity) continue;
      if (distance(miner, deposit) > this.config.range + deposit.radius) continue;
      recipient = miner;
      best = contribution;
    }
    const amount = Math.min(deposit.ore.yield, this.config.capacity - recipient.bag.length);
    for (let i = 0; i < amount; i++) recipient.bag.push(kind);
    deposit.regenAt = this.time + deposit.ore.respawnSeconds;
    deposit.minerId = '';
    deposit.work.clear();
    this.event('harvest', recipient, point, { targetId, kind, amount, value: amount * deposit.ore.value });
  }

  shiftWeakPoint(deposit, player) {
    const eye = this.eyes(player);
    const previousAim = aimAt(eye, deposit.weak);
    const offset = deposit.radius * .56;
    const positions = approachAngles.map(angle => ({
      x: deposit.startingWeak.x + Math.sin(angle) * offset,
      y: deposit.startingWeak.y,
      z: deposit.startingWeak.z + Math.cos(angle) * offset,
    }));
    positions.push(deposit.startingWeak);
    positions.sort((a, b) => distance(a, player) - distance(b, player));
    const next = positions.find(point => {
      if (sphereHit(eye, previousAim, point, this.config.weakRadius) < this.config.range) return false;
      const aim = aimAt(eye, point);
      const hit = sphereHit(eye, aim, point, this.config.weakRadius);
      return hit < this.valley.rayDistance(eye, aim, this.config.range) && hit < cylinderHit(eye, aim, deposit);
    });
    if (next) deposit.weak = next;
  }

  steal(attacker, victim, point) {
    if (victim.bag.length < 2 || attacker.bag.length >= this.config.capacity ||
      this.time < victim.invulnUntil) return;
    const kind = victim.bag.pop();
    attacker.bag.push(kind);
    victim.invulnUntil = this.time + theftGrace;
    victim.sellProgress = 0;
    victim.sale = null;
    this.event('steal', attacker, point, { targetId: victim.id, kind, amount: 1, value: this.ores.get(kind).value });
  }

  bagValue(player) {
    return player.bag.reduce((value, kind) => value + this.ores.get(kind).value, 0);
  }

  move(player, input, dt) {
    const moving = Math.hypot(input.x, input.z) > .02;
    if (!input.sprint && player.stamina >= .25) player.exhausted = false;
    const dash = moving && input.sprint && !player.exhausted && player.stamina > 0;
    const { walkSpeed } = this.valley.data;
    const boostTime = dash ? Math.min(dt, player.stamina * this.config.staminaSeconds) : 0;
    const step = walkSpeed * (dt - boostTime) + this.config.sprintSpeed * boostTime;
    player.sprinting = dash;
    if (dash) {
      player.stamina = Math.max(0, player.stamina - boostTime / this.config.staminaSeconds);
      if (player.stamina <= 1e-9) { player.stamina = 0; player.exhausted = true; }
    } else player.stamina = Math.min(1, player.stamina + dt / this.config.recoverSeconds);
    Object.assign(player, this.valley.move(player, input.x * step, input.z * step));
    if (Math.hypot(input.ax, input.az) > .001) player.yaw = Math.atan2(input.ax, input.az);
    return moving;
  }

  orderAt(station, ahead = 0) {
    const elapsed = this.roundSeconds - this.timeLeft;
    const phase = Math.floor((Math.min(elapsed + ahead, this.roundSeconds - 1e-7) + 1e-9) / orderSeconds);
    const kind = premiumOres[(station.index + phase + this.round - 1) % premiumOres.length];
    return { kind, bonus: premiums[kind], until: Math.min((phase + 1) * orderSeconds, this.roundSeconds) };
  }

  quote(player, station, order = this.orderAt(station), baseValue = this.bagValue(player)) {
    const bonus = player.bag.filter(kind => kind === order.kind).length * order.bonus;
    return { stationId: station.id, baseValue, bonus, value: baseValue + bonus };
  }

  sell(player, input, moving, dt) {
    const station = this.stationAt(player, 'radius');
    if (!station || !input.sell || input.fire || moving || !player.bag.length) {
      player.sellProgress = 0;
      player.sale = null;
      return;
    }
    if (player.sale?.stationId !== station.id) {
      player.sellProgress = 0;
      player.sale = this.quote(player, station);
    }
    player.sellProgress += dt / this.config.sellSeconds;
    if (player.sellProgress < 1 - 1e-9) return;
    const { value, bonus } = player.sale;
    const amount = player.bag.length;
    player.score += value;
    player.bag = [];
    player.sellProgress = 0;
    player.sale = null;
    this.event('sold', player, station, { targetId: station.id, amount, value, bonus });
  }

  planRoute(player, key, points) {
    if (player.goalKey === key && player.goal) return true;
    player.goalKey = key;
    player.goal = null;
    player.route = [];
    const nearest = [...points].sort((a, b) => distance(a, player) - distance(b, player));
    for (const point of nearest) {
      const route = this.valley.path(player, point);
      if (!route.length) continue;
      player.goal = point;
      player.route = route;
      return true;
    }
    return false;
  }

  travel(player, aim, sprint) {
    while (player.route.length > 1 && distance(player, player.route[0]) < .45) player.route.shift();
    const next = player.route[0];
    if (!next) return { ...idle, ax: aim.x, ay: aim.y, az: aim.z };
    const gap = distance(player, next), len = Math.max(gap, .3);
    return { ...idle, x: (next.x - player.x) / len, z: (next.z - player.z) / len,
      ax: aim.x, ay: aim.y, az: aim.z, sprint };
  }

  chooseBotSale(player) {
    const { walkSpeed } = this.valley.data;
    let choice = null;
    for (const station of this.stations) {
      const route = this.valley.path(player, station);
      if (!route.length) continue;
      let metres = 0, previous = player;
      for (const point of route) {
        metres += distance(previous, point);
        previous = point;
      }
      const toCircle = Math.max(0, metres - station.radius + .25);
      const dashDistance = player.stamina > .35 ? this.config.sprintSpeed *
        (player.stamina - .35) * this.config.staminaSeconds : 0;
      const dash = Math.min(toCircle, dashDistance);
      const travelTime = dash / this.config.sprintSpeed + (toCircle - dash) / walkSpeed;
      if (travelTime + this.config.sellSeconds > this.timeLeft) continue;
      const { bonus } = this.quote(player, station, this.orderAt(station, travelTime));
      const rank = bonus - travelTime * 1.65;
      if (!choice || rank > choice.rank) choice = { station, route, rank };
    }
    return choice;
  }

  botInput(player) {
    const nearest = Math.min(...this.stations.map(s => distance(s, player)));
    if (!player.bag.length) player.botSale = null;
    const returnNow = player.botSale || player.bag.length >= 4 ||
      (player.bag.length > 0 && this.timeLeft < nearest / this.valley.data.walkSpeed + 5);
    if (returnNow) {
      player.botTarget = null;
      if (!player.botSale && this.time >= player.botPickAt) {
        player.botPickAt = this.time + .5;
        const choice = this.chooseBotSale(player);
        if (choice) {
          player.botSale = choice.station;
          player.goalKey = choice.station.id;
          player.goal = choice.station;
          player.route = choice.route;
        }
      }
      const station = player.botSale;
      if (!station) return idle;
      if (distance(station, player) <= station.radius - .25)
        return { ...idle, ax: Math.sin(player.yaw), az: Math.cos(player.yaw), sell: true };
      return this.travel(player, aimAt(this.eyes(player), station), player.stamina > .35);
    }

    const availableToBot = d => d?.hp && (this.starterUntil.get(d.id) || 0) <= this.time;
    if (!availableToBot(player.botTarget)) {
      player.botTarget = null;
      if (this.time < player.botPickAt) return idle;
      player.botPickAt = this.time + .5;
      const others = [...this.players.values()].filter(p => p.bot && p !== player);
      const desirability = d => d.ore.value * .9 - distance(player, d) -
        (others.some(p => p.botTarget === d) ? 40 : 0) + this.random() * 3;
      const candidates = this.deposits.filter(d => availableToBot(d) && d.approaches.length)
        .map(d => ({ d, rank: desirability(d) })).sort((a, b) => b.rank - a.rank);
      for (const { d } of candidates) {
        if (!this.planRoute(player, d.id, d.approaches)) continue;
        player.botTarget = d;
        break;
      }
    }
    const target = player.botTarget;
    if (!target) return idle;
    const eye = this.eyes(player);
    const body = { x: target.x, y: target.y + target.height * .4, z: target.z };
    if (distance(player, player.goal) > .35) {
      player.botStrikeAt = this.time + .28;
      return this.travel(player, aimAt(eye, body), false);
    }
    const fire = this.time >= player.botStrikeAt;
    const point = fire && this.random() < .19 ? target.weak : body;
    if (fire) player.botStrikeAt = this.time + 1.3 + this.random() * .4;
    const aim = aimAt(eye, point);
    return { ...idle, ax: aim.x, ay: aim.y, az: aim.z, fire };
  }

  tick(dt) {
    this.time += dt;
    if (this.phase === 'finished') {
      this.resultTimeLeft = Math.max(0, this.resultTimeLeft - dt);
      if (!this.resultTimeLeft) this.resetRound();
      return;
    }
    this.events = this.events.filter(event => event.expires > this.time);
    for (const deposit of this.deposits) {
      if (!deposit.hp && deposit.regenAt <= this.time) {
        deposit.hp = deposit.ore.hp;
        deposit.weak = deposit.startingWeak;
      }
      if (this.time - deposit.minedAt > 1.5) deposit.minerId = '';
    }

    const actions = [];
    for (const player of this.players.values()) {
      const fresh = this.time - player.lastInputAt <= .6;
      let input = player.bot ? this.botInput(player) : fresh ? player.input : { ...idle,
        ax: Math.sin(player.yaw), az: Math.cos(player.yaw) };
      if (fresh && player.pendingFire) input = { ...input, fire: true };
      player.pendingFire = false;
      actions.push({ player, input, moving: this.move(player, input, dt) });
    }
    // Resolve action ranges using everyone's movement for this tick.
    for (const { player, input, moving } of actions) {
      if (input.fire && this.time + 1e-9 >= player.nextStrike) {
        player.nextStrike = this.time + this.config.hitCooldown;
        this.strike(player, input);
      }
      this.sell(player, input, moving, dt);
    }
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 1e-9) {
      this.timeLeft = 0;
      this.phase = 'finished';
      this.resultTimeLeft = RULES.resultSeconds;
      const highest = Math.max(...[...this.players.values()].map(p => p.score));
      this.winners = [...this.players.values()].filter(p => p.score === highest)
        .map(({ id, name, score }) => ({ id, name, score }));
    }
  }

  snapshot() {
    const elapsed = this.roundSeconds - this.timeLeft;
    const stations = this.stations.map(({ index, ...station }) => {
      const current = this.orderAt(this.stations[index]);
      const remaining = Math.max(0, current.until - elapsed);
      const next = remaining <= orderPreviewSeconds && current.until < this.roundSeconds
        ? this.orderAt(this.stations[index], remaining + .01) : null;
      return { ...station, orderKind: current.kind, orderBonus: current.bonus, orderSeconds: remaining,
        nextOrderKind: next?.kind || '', nextOrderBonus: next?.bonus || 0 };
    });
    const players = [...this.players.values()].map(p => {
      const { id, name, bot, x, y, z, yaw, score, stamina, sprinting, sellProgress } = p;
      const inventory = [...this.ores.keys()].flatMap(kind => {
        const count = p.bag.filter(item => item === kind).length;
        return count ? [{ kind, count }] : [];
      });
      const inventoryValue = this.bagValue(p);
      const saleQuotes = stations.map((station, index) => this.quote(p, this.stations[index],
        { kind: station.orderKind, bonus: station.orderBonus }, inventoryValue));
      return { id, name, bot, x, y, z, yaw, score, inventory, inventoryCount: p.bag.length,
        inventoryValue, stamina, sprinting, sellProgress, sellValue: p.sale?.value || 0, saleQuotes,
        stationId: this.stationAt(p, 'radius')?.id || '', protected: Boolean(this.stationAt(p, 'safeRadius')),
        invuln: Math.max(0, p.invulnUntil - this.time) };
    });
    const deposits = this.deposits.map(({ id, kind, x, y, z, hp, ore, weak, regenAt, minerId }) => ({
      id, kind, x, y, z, weakX: weak.x, weakY: weak.y, weakZ: weak.z, hp, maxHp: ore.hp,
      respawnIn: hp ? 0 : Math.max(0, regenAt - this.time), minerId,
    }));
    return { type: 'state', players, deposits, stations,
      events: this.events.filter(e => e.expires > this.time).map(({ expires, ...event }) => event),
      timeLeft: this.timeLeft, round: this.round, phase: this.phase, worldId: this.valley.data.id,
      resultTimeLeft: this.resultTimeLeft, winners: this.winners };
  }
}
