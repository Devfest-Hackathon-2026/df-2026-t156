import { terrain, VALLEY } from './valley.js';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const finite = n => typeof n === 'number' && Number.isFinite(n);
export const RULES = Object.freeze({ tickRate: 20, roundSeconds: 120, resultSeconds: 8,
  arena: VALLEY.boundary, speed: VALLEY.walkSpeed, pickupRadius: 2.4, gateRadius: VALLEY.gate.radius, beamLength: 24,
  beamRadius: 1.05, fireCooldown: 0.34, cargoSpacing: 2.15, maxCargo: 8, maxHumans: 8 });

export class World {
  constructor({ random = Math.random, roundSeconds = RULES.roundSeconds, bots = true, valley = terrain } = {}) {
    this.random = random;
    this.roundSeconds = roundSeconds;
    this.enableBots = bots;
    this.players = new Map();
    this.valley = valley;
    this.gate = { x: VALLEY.gate.x, y: valley.height(VALLEY.gate.x, VALLEY.gate.z), z: VALLEY.gate.z };
    this.serial = 0;
    this.round = 0;
    this.time = 0;
    this.resetRound();
  }

  randomCore() {
    let point;
    for (let tries = 0; tries < 60; tries++) {
      const angle = this.random() * Math.PI * 2, r = 12 + this.random() * 35;
      point = { x: Math.sin(angle) * r, z: Math.cos(angle) * r };
      if (!this.valley.blocked(point.x, point.z, VALLEY.coreRadius, VALLEY.coreLift * 2)) break;
    }
    point = this.valley.move(point, 0, 0, VALLEY.coreRadius, VALLEY.coreLift * 2);
    return { id: `c${++this.serial}`, ...point, y: point.y + VALLEY.coreLift, availableAt: this.time };
  }

  spawn(player, index) {
    const angle = index * 2.39996 + 0.8;
    const start = this.valley.move({ x: Math.sin(angle) * 20, z: Math.cos(angle) * 20 }, 0, 0);
    Object.assign(player, { ...start, botPath: [], pathAt: -Infinity,
      yaw: angle + Math.PI, score: 0, cargo: [], cooldown: 0, lastInputAt: -Infinity,
      input: { x: 0, y: 0, z: 0, ax: 0, ay: 0, az: 1, fire: false } });
  }

  resetRound() {
    this.round++;
    this.phase = 'playing';
    this.timeLeft = this.roundSeconds;
    this.resultTimeLeft = 0;
    this.winners = [];
    this.shots = [];
    this.cores = Array.from({ length: 32 }, () => this.randomCore());
    this.spawnCounter = 0;
    [...this.players.values()].forEach(p => this.spawn(p, this.spawnCounter++));
    this.balanceBots();
  }

  addPlayer(id, name, bot = false) {
    if (this.players.has(id)) return this.players.get(id);
    const p = { id, name, bot };
    this.spawn(p, this.spawnCounter++);
    this.players.set(id, p);
    if (!bot) this.balanceBots();
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.dropCargo(p, 0);
    this.players.delete(id);
    this.balanceBots();
    if (![...this.players.values()].some(player => !player.bot)) this.resetRound();
  }

  balanceBots() {
    if (!this.enableBots) return;
    const humans = [...this.players.values()].filter(p => !p.bot).length;
    const desired = humans ? Math.max(0, 3 - humans) : 0;
    for (let i = 0; i < 2; i++) {
      const id = `bot-${i}`, existing = this.players.get(id);
      if (i < desired && !existing) this.addPlayer(id, i ? 'RAIDER' : 'HAULER', true);
      if (i >= desired && existing) {
        this.dropCargo(existing, 0);
        this.players.delete(id);
      }
    }
  }

  input(id, packet) {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    const n = key => finite(packet[key]) ? clamp(packet[key], -1, 1) : 0;
    let x = n('x'), z = n('z');
    const horizontal = Math.hypot(x, z);
    if (horizontal > 1) { x /= horizontal; z /= horizontal; }
    let ax = n('ax'), ay = n('ay'), az = n('az');
    const aim = Math.hypot(ax, ay, az);
    if (aim > 0.01) { ax /= aim; ay /= aim; az /= aim; }
    else { ax = Math.sin(p.yaw); ay = 0; az = Math.cos(p.yaw); }
    p.input = { x, y: 0, z, ax, ay, az, fire: packet.fire === true };
    p.lastInputAt = this.time;
  }

  dropCargo(p, from) {
    const dropped = p.cargo.splice(from);
    for (const core of dropped) {
      const ground = this.valley.move(core, 0, 0, VALLEY.coreRadius, VALLEY.coreLift * 2);
      this.cores.push({ ...core, ...ground, y: ground.y + VALLEY.coreLift, availableAt: this.time + 0.35,
        formerOwner: p.id, ownerBlockedUntil: this.time + 1.5 });
    }
  }

  botInput(p) {
    // Hauler visibly carries a convoy; Raider cuts valuable convoys before collecting.
    const rivals = [...this.players.values()].filter(o => o !== p && o.cargo.length);
    let victim = rivals.sort((a, b) => distance(p, a) - distance(p, b))[0];
    const raid = p.id === 'bot-1' && victim && distance(p, victim) < 26 && p.cargo.length < 2;
    let target;
    if (raid) target = victim.cargo[Math.floor(victim.cargo.length / 2)];
    else if (p.cargo.length >= 3 || (p.cargo.length && this.timeLeft < 15)) target = this.gate;
    else target = this.cores.filter(c => this.canPickup(p, c))
      .sort((a, b) => distance(p, a) - distance(p, b))[0] || this.gate;
    const goal = this.valley.move(target, 0, 0, VALLEY.playerRadius + 0.2);
    if (this.valley.walkClear(p, goal)) p.botPath = [goal];
    else if (this.time - p.pathAt > 0.8 || !p.botTarget || Math.hypot(target.x - p.botTarget.x, target.z - p.botTarget.z) > 3) {
      p.botPath = this.valley.path(p, goal);
      p.pathAt = this.time; p.botTarget = { x: target.x, z: target.z };
    }
    while (p.botPath.length > 1 && Math.hypot(p.botPath[0].x - p.x, p.botPath[0].z - p.z) < 0.7) p.botPath.shift();
    const waypoint = p.botPath[0] || p;
    const dx = waypoint.x - p.x, dz = waypoint.z - p.z;
    const horizontal = Math.hypot(dx, dz) || 1;
    const aimTarget = raid ? target : victim?.cargo.at(-1);
    const eye = { x: p.x, y: p.y + VALLEY.eyeHeight, z: p.z };
    const aimLength = aimTarget ? distance(eye, aimTarget) || 1 : 1;
    const direction = aimTarget ? { x: (aimTarget.x - eye.x) / aimLength, y: (aimTarget.y - eye.y) / aimLength, z: (aimTarget.z - eye.z) / aimLength } : { x: dx / horizontal, y: 0, z: dz / horizontal };
    const clearShot = aimTarget && this.valley.rayDistance(eye, direction, aimLength) >= aimLength - 0.05;
    p.input = { x: dx / Math.max(horizontal, 1), z: dz / Math.max(horizontal, 1),
      y: 0, ax: direction.x, ay: direction.y, az: direction.z,
      fire: !!clearShot && aimLength < RULES.beamLength && (raid || this.random() < 0.06) };
    p.lastInputAt = this.time;
  }

  canPickup(p, core) {
    return core.availableAt <= this.time &&
      (core.formerOwner !== p.id || core.ownerBlockedUntil <= this.time);
  }

  fire(p) {
    const { ax, ay, az } = p.input;
    const origin = { x: p.x, y: p.y + VALLEY.eyeHeight, z: p.z };
    const maxLength = this.valley.rayDistance(origin, { x: ax, y: ay, z: az }, RULES.beamLength);
    const shot = { id: `s${++this.serial}`, ...origin,
      ex: origin.x + ax * maxLength, ey: origin.y + ay * maxLength,
      ez: origin.z + az * maxLength, expiresAt: this.time + 0.15, owner: p.id };
    this.shots.push(shot);
    let hit;
    for (const other of this.players.values()) {
      if (other === p) continue;
      for (let i = 0; i < other.cargo.length; i++) {
        const c = other.cargo[i], dx = c.x - origin.x, dy = c.y - origin.y, dz = c.z - origin.z;
        const along = dx * ax + dy * ay + dz * az;
        if (along < 0 || along > maxLength) continue;
        const off = Math.hypot(dx - ax * along, dy - ay * along, dz - az * along);
        if (off <= RULES.beamRadius && (!hit || along < hit.along)) hit = { other, i, along };
      }
    }
    if (hit) {
      shot.ex = origin.x + ax * hit.along; shot.ey = origin.y + ay * hit.along; shot.ez = origin.z + az * hit.along;
      this.dropCargo(hit.other, hit.i);
    }
  }

  tick(dt) {
    this.time += dt;
    this.shots = this.shots.filter(s => s.expiresAt > this.time);
    if (this.phase === 'finished') {
      this.resultTimeLeft = Math.max(0, this.resultTimeLeft - dt);
      if (this.resultTimeLeft === 0) this.resetRound();
      return;
    }
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    for (const p of this.players.values()) {
      if (p.bot) this.botInput(p);
      if (this.time - p.lastInputAt > 0.6) p.input = { ...p.input, x: 0, y: 0, z: 0, fire: false };
      const input = p.input, speed = RULES.speed;
      Object.assign(p, this.valley.move(p, input.x * speed * dt, input.z * speed * dt));
      if (Math.hypot(input.x, input.z) > 0.05) p.yaw = Math.atan2(input.x, input.z);
      p.cooldown = Math.max(0, p.cooldown - dt);
    }
    // Move the articulated trail toward the preceding link, leaving inertia in turns.
    for (const p of this.players.values()) {
      let previous = p;
      for (const c of p.cargo) {
        const dx = c.x - previous.x, dz = c.z - previous.z;
        const length = Math.hypot(dx, dz);
        if (length > RULES.cargoSpacing) {
          const correction = (length - RULES.cargoSpacing) / length * Math.min(1, dt * 14);
          const ground = this.valley.move(c, -dx * correction, -dz * correction, VALLEY.coreRadius, VALLEY.coreLift * 2);
          c.x = ground.x; c.z = ground.z;
        }
        c.y = this.valley.height(c.x, c.z) + VALLEY.coreLift;
        previous = c;
      }
      if (p.input.fire && p.cooldown <= 0) { this.fire(p); p.cooldown = RULES.fireCooldown; }
    }
    for (const p of this.players.values()) {
      for (let i = this.cores.length - 1; i >= 0 && p.cargo.length < RULES.maxCargo; i--) {
        const c = this.cores[i];
        const eye = { x: p.x, y: p.y + 0.7, z: p.z }, reach = distance(eye, c);
        const ray = reach > 0.001 ? { x: (c.x - eye.x) / reach, y: (c.y - eye.y) / reach, z: (c.z - eye.z) / reach } : { x: 0, y: 1, z: 0 };
        if (this.canPickup(p, c) && distance(p, c) <= RULES.pickupRadius &&
          this.valley.rayDistance(eye, ray, reach) >= reach - 0.05) {
          this.cores.splice(i, 1);
          p.cargo.push({ id: c.id, x: c.x, y: c.y, z: c.z });
        }
      }
      if (p.cargo.length && Math.hypot(p.x - this.gate.x, p.z - this.gate.z) <= RULES.gateRadius) {
        const delivered = p.cargo.length;
        p.score += delivered * (delivered + 1) / 2;
        p.cargo = [];
        for (let i = 0; i < delivered; i++) this.cores.push(this.randomCore());
      }
    }
    if (this.timeLeft === 0) {
      this.phase = 'finished';
      this.resultTimeLeft = RULES.resultSeconds;
      const highest = Math.max(0, ...[...this.players.values()].map(p => p.score));
      this.winners = [...this.players.values()].filter(p => p.score === highest)
        .map(p => ({ id: p.id, name: p.name, score: p.score }));
    }
  }

  snapshot() {
    const point = c => ({ id: c.id, x: c.x, y: c.y, z: c.z });
    return { type: 'state', players: [...this.players.values()].map(p => ({
      id: p.id, name: p.name, bot: p.bot, x: p.x, y: p.y, z: p.z, yaw: p.yaw,
      score: p.score, cargo: p.cargo.map(point) })), cores: this.cores.map(point),
      shots: this.shots.map(({ expiresAt, owner, ...s }) => s), gate: { ...this.gate },
      timeLeft: this.timeLeft, round: this.round, phase: this.phase, worldId: this.valley.data.id,
      resultTimeLeft: this.resultTimeLeft, winners: this.winners };
  }
}
