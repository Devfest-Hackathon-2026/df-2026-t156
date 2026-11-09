const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const finite = n => typeof n === 'number' && Number.isFinite(n);
export const RULES = Object.freeze({ tickRate: 20, roundSeconds: 120, resultSeconds: 8,
  arena: 38, speed: 10, pickupRadius: 2.4, gateRadius: 4.3, beamLength: 24,
  beamRadius: 1.05, fireCooldown: 0.34, cargoSpacing: 2.15, maxCargo: 8, maxHumans: 8 });

export class World {
  constructor({ random = Math.random, roundSeconds = RULES.roundSeconds, bots = true } = {}) {
    this.random = random;
    this.roundSeconds = roundSeconds;
    this.enableBots = bots;
    this.players = new Map();
    this.gate = { x: 0, y: 6, z: 0 };
    this.serial = 0;
    this.round = 0;
    this.time = 0;
    this.resetRound();
  }

  randomCore() {
    const angle = this.random() * Math.PI * 2, r = 12 + this.random() * 21;
    return { id: `c${++this.serial}`, x: Math.sin(angle) * r, y: 4 + this.random() * 5,
      z: Math.cos(angle) * r, availableAt: this.time };
  }

  spawn(player, index) {
    const angle = index * 2.39996 + 0.8;
    Object.assign(player, { x: Math.sin(angle) * 20, y: 6, z: Math.cos(angle) * 20,
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
    [...this.players.values()].forEach((p, i) => this.spawn(p, i));
    this.balanceBots();
  }

  addPlayer(id, name, bot = false) {
    if (this.players.has(id)) return this.players.get(id);
    const p = { id, name, bot };
    this.spawn(p, this.players.size);
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
    p.input = { x, y: n('y'), z, ax, ay, az, fire: packet.fire === true };
    p.lastInputAt = this.time;
  }

  dropCargo(p, from) {
    const dropped = p.cargo.splice(from);
    for (const core of dropped) {
      this.cores.push({ ...core, availableAt: this.time + 0.35,
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
    const dx = target.x - p.x, dy = target.y - p.y, dz = target.z - p.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const horizontal = Math.hypot(dx, dz) || 1;
    const aimTarget = raid ? target : victim?.cargo.at(-1);
    const aimLength = aimTarget ? distance(p, aimTarget) || 1 : 1;
    p.input = { x: dx / Math.max(horizontal, 1), z: dz / Math.max(horizontal, 1),
      y: clamp(dy / 3, -1, 1), ax: aimTarget ? (aimTarget.x - p.x) / aimLength : dx / len,
      ay: aimTarget ? (aimTarget.y - p.y) / aimLength : dy / len,
      az: aimTarget ? (aimTarget.z - p.z) / aimLength : dz / len,
      fire: !!aimTarget && aimLength < RULES.beamLength && (raid || this.random() < 0.06) };
    p.lastInputAt = this.time;
  }

  canPickup(p, core) {
    return core.availableAt <= this.time &&
      (core.formerOwner !== p.id || core.ownerBlockedUntil <= this.time);
  }

  fire(p) {
    const { ax, ay, az } = p.input;
    const shot = { id: `s${++this.serial}`, x: p.x, y: p.y, z: p.z,
      ex: p.x + ax * RULES.beamLength, ey: p.y + ay * RULES.beamLength,
      ez: p.z + az * RULES.beamLength, expiresAt: this.time + 0.15, owner: p.id };
    this.shots.push(shot);
    let hit;
    for (const other of this.players.values()) {
      if (other === p) continue;
      for (let i = 0; i < other.cargo.length; i++) {
        const c = other.cargo[i], dx = c.x - p.x, dy = c.y - p.y, dz = c.z - p.z;
        const along = dx * ax + dy * ay + dz * az;
        if (along < 0 || along > RULES.beamLength) continue;
        const off = Math.hypot(dx - ax * along, dy - ay * along, dz - az * along);
        if (off <= RULES.beamRadius && (!hit || along < hit.along)) hit = { other, i, along };
      }
    }
    if (hit) {
      shot.ex = p.x + ax * hit.along; shot.ey = p.y + ay * hit.along; shot.ez = p.z + az * hit.along;
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
      const input = p.input, speed = RULES.speed / (1 + p.cargo.length * 0.055);
      p.x = clamp(p.x + input.x * speed * dt, -RULES.arena, RULES.arena);
      p.y = clamp(p.y + input.y * speed * 0.7 * dt, 2, 12);
      p.z = clamp(p.z + input.z * speed * dt, -RULES.arena, RULES.arena);
      if (Math.hypot(input.x, input.z) > 0.05) p.yaw = Math.atan2(input.x, input.z);
      p.cooldown = Math.max(0, p.cooldown - dt);
    }
    // Move the articulated trail toward the preceding link, leaving inertia in turns.
    for (const p of this.players.values()) {
      let previous = p;
      for (const c of p.cargo) {
        const dx = c.x - previous.x, dy = c.y - previous.y, dz = c.z - previous.z;
        const length = Math.hypot(dx, dy, dz);
        if (length > RULES.cargoSpacing) {
          const correction = (length - RULES.cargoSpacing) / length * Math.min(1, dt * 14);
          c.x -= dx * correction; c.y -= dy * correction; c.z -= dz * correction;
        }
        previous = c;
      }
      if (p.input.fire && p.cooldown <= 0) { this.fire(p); p.cooldown = RULES.fireCooldown; }
    }
    for (const p of this.players.values()) {
      for (let i = this.cores.length - 1; i >= 0 && p.cargo.length < RULES.maxCargo; i--) {
        const c = this.cores[i];
        if (this.canPickup(p, c) && distance(p, c) <= RULES.pickupRadius) {
          this.cores.splice(i, 1);
          p.cargo.push({ id: c.id, x: c.x, y: c.y, z: c.z });
        }
      }
      if (p.cargo.length && distance(p, this.gate) <= RULES.gateRadius) {
        p.score += p.cargo.length;
        const delivered = p.cargo.length;
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
      timeLeft: this.timeLeft, round: this.round, phase: this.phase,
      resultTimeLeft: this.resultTimeLeft, winners: this.winners };
  }
}
