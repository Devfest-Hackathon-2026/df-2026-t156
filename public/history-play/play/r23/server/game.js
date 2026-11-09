import { randomInt } from '../../../runtime/node-shim.js';
import { BOW, cylinderHit, receiveBowInput, cancelBowDraw, receiveShot, launchBolt, tickBolts, boltSnapshot, botCrossbowInput } from './crossbow.js';
import { terrain } from './valley.js';
import { MELEE, playerRayHit, recordCombatPose, combatPose, receiveAttack, hitPlayer } from './melee.js';
import { MOTION, resetMotion, receiveMotion, applyKnockback, integrateMotion } from './motion.js';
import { sceneryMiningHit, mineScenery, initSceneryMining, resetSceneryMining, tickSceneryMining, sceneryMiningSnapshot } from './scenery-mining.js';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const idle = { x: 0, z: 0, ax: 0, ay: 0, az: 1, fire: false, sprint: false, sell: false, upgrade: false };
export const RULES = Object.freeze({ tickRate: 20, roundSeconds: 180, resultSeconds: 8, maxHumans: 8 });
const orderSeconds = 40;
const orderPreviewSeconds = 8;
const premiumOres = ['copper', 'silver', 'crystal'];
const premiums = { copper: 2, silver: 3, crystal: 3 };
export const FIRST_ORDER = Object.freeze({ quantity: 2, reward: 12, startsAt: 40 });
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


export class World {
  constructor({ random = Math.random, roundSeconds = RULES.roundSeconds, bots = true, valley = terrain,
    rareRandom = () => randomInt(0, 0x100000000) / 0x100000000, botTactics = true, botKnowledge = true,
    secondPickCost = null, goldLayers = valley.data.rare.layerHp } = {}) {
    this.random = random;
    this.rareRandom = rareRandom;
    this.roundSeconds = roundSeconds;
    this.enableBots = bots;
    this.botTactics = botTactics;
    this.botKnowledge = botKnowledge;
    this.spawnPolicy = 'reserved-rotating';
    if (goldLayers !== null && (!Array.isArray(goldLayers) || goldLayers.length !== 2 ||
      !goldLayers.every(hp => Number.isInteger(hp) && hp > 0))) throw new Error('Invalid gold layers');
    this.goldLayers = goldLayers ? [...goldLayers] : null;
    this.players = new Map();
    this.participantSerial = 0;
    this.usedNames = new Set();
    this.valley = valley;
    initSceneryMining(this);
    this.config = valley.data.mining;
    if (secondPickCost !== null && (!Number.isInteger(secondPickCost) || secondPickCost <= 0))
      throw new Error('Invalid second pick cost');
    this.picks = valley.data.picks.map(pick => pick.level === 3 && secondPickCost !== null
      ? { ...pick, cost: secondPickCost } : { ...pick });
    this.rare = valley.data.rare;
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
    return { x: player.x, y: player.y + this.valley.data.eyeHeight - (player.input?.sneak ? .08 : 0), z: player.z };
  }

  spawnIndex(index) {
    const count = this.seams.filter(s => s.ore.value === 2 && s.approaches.length).length || 1;
    const rotation = this.round - 1;
    // Odd strides visit all eight starts while changing neighbours between rematches.
    const stride = 1 + 2 * (rotation % 4);
    return (rotation + index * stride) % count;
  }

  spawn(player, index) {
    const common = this.seams.filter(seam => seam.ore.value === 2 && seam.approaches.length);
    const ordered = common.slice(index % common.length).concat(common.slice(0, index % common.length));
    const reserved = new Set([...this.players.values()].filter(p => p !== player).map(p => p.startSeamId));
    const free = ordered.filter(d => !reserved.has(d.id));
    const seam = free.find(d => this.deposits.some(current => current.id === d.id && current.hp)) || free[0] || ordered[0];
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
      startSeamId: seam?.id || '',
      x: start.x, y: start.y, z: start.z, yaw, score: 0, grossSales: 0, investmentSpent: 0, goldSold: 0,
      ordersCompleted: 0, orderEarnings: 0,
      joinedLate: false, bag: [], stamina: 1, exhausted: false,
      sprinting: false, sellProgress: 0, sale: null, pickLevel: 1, upgradeProgress: 0, upgradeHeld: false, upgradeStation: '', nextStrike: 0, invulnUntil: 0,
      input: idle, lastInputAt: -Infinity, pendingFire: false, route: [], goalKey: '', goal: null,
      attackId: 0, pendingAttacks: [], combatHistory: [], hurtUntil: 0, lastHitDamage: 0, missAttackUntil: 0,
      botPickAt: 0, botStrikeAt: 0, botTarget: null, botSale: null, botObserveAt: 0, botPlanAt: 0, botKnownWave: -1,
      botInvest: false, botVisibleRivals: [], botChase: null, botTacticAt: 0, botChaseCooldown: 0,
      botAttempted: new Map(), botFleeUntil: 0, botEscapeAt: 0, botOreMemory: new Map(),
      lastTheft: null, botMeleeAt: 0, botDisengageUntil: 0,
      weapon: 'pick', shotId: 0, bowDrawing: false, bowDrawStartedAt: 0, bowConsumesAttack: false, pendingShots: [], nextShotHint: 0, botBow: null, botBowAt: 0,
    });
    resetMotion(player, this.time, this.round);
    if (!player.bot && seam) this.starterUntil.set(seam.id, this.time + 15);
  }

  resetRound() {
    resetSceneryMining(this);
    this.round++;
    this.phase = 'playing';
    this.timeLeft = this.roundSeconds;
    this.resultTimeLeft = 0;
    this.winners = [];
    this.standings = [];
    this.usedNames = new Set([...this.players.values()].map(p => p.name));
    this.events = [];
    this.bolts = []; this.boltSerial = 0;
    this.filledOrders = new Map();
    this.nextRareAt = this.time + this.rare.firstAt;
    this.lastRareIds = new Set();
    this.announcedRare = [];
    this.deposits = this.seams.map(seam => ({
      ...seam,
      hp: seam.kind === 'gold' ? 0 : seam.ore.hp,
      active: seam.kind !== 'gold',
      expiresAt: 0, regenAt: 0, announced: false, opensAt: 0,
      result: null, contested: false, minerId: '', minedAt: -Infinity, work: new Map(),
      layer: 0, layerResults: [], looseCount: 0,
    }));
    this.spawnCounter = 0;
    this.starterUntil = new Map();
    for (const p of this.players.values()) p.startSeamId = '';
    for (const p of this.players.values()) this.spawn(p, this.spawnIndex(this.spawnCounter++));
    this.balanceBots();
  }

  addPlayer(id, name, bot = false) {
    if (this.players.has(id)) return this.players.get(id);
    const supplied = typeof name === 'string' ? name.replace(/[\x00-\x1f\x7f<>]/g, '').trim().slice(0, 18) : '';
    const baseName = supplied || '旅人';
    let displayName = baseName, suffix = 2;
    while (this.usedNames.has(displayName)) displayName = baseName + ' ' + suffix++;
    this.usedNames.add(displayName);
    const player = { id, name: displayName, bot, joinOrder: ++this.participantSerial };
    this.spawn(player, this.spawnIndex(this.spawnCounter++));
    player.joinedLate = !bot && this.phase === 'playing' && this.timeLeft < this.roundSeconds - 1;
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
    if (this.phase !== 'finished' && ![...this.players.values()].some(p => !p.bot)) this.resetRound();
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
    // An in-flight hold/click from the preceding round cannot act after respawn.
    if (packet.motionRound !== undefined && packet.motionRound !== this.round) return;
    const n = key => Number.isFinite(packet[key]) ? clamp(packet[key], -1, 1) : 0;
    // Keep raw keyboard diagonal length until sneak/use-item/.98 scaling in travel.
    const movementAxis = key => Number.isFinite(packet[key]) ? clamp(packet[key], -Math.SQRT2, Math.SQRT2) : 0;
    const moveX = movementAxis('x'), moveZ = movementAxis('z');
    const movement = Math.max(1, Math.hypot(moveX, moveZ) / Math.SQRT2);
    const x = moveX / movement, z = moveZ / movement;
    let ax = n('ax'), ay = n('ay'), az = n('az');
    const aim = Math.hypot(ax, ay, az);
    if (aim > .01) { ax /= aim; ay /= aim; az /= aim; }
    else { ax = Math.sin(player.yaw); ay = 0; az = Math.cos(player.yaw); }
    if (packet.weapon === 'pick' || packet.weapon === 'bow') player.weapon = packet.weapon;
    const fire = packet.fire === true && player.weapon === 'pick';
    if (player.weapon === 'bow') player.pendingFire = false;
    if (fire && !player.input.fire) player.pendingFire = { ax, ay, az, miningOnly: packet.miningOnly === true };
    player.input = { x, z, ax, ay, az,
      fire, miningOnly: packet.miningOnly === true,
      sprint: packet.sprint === true, sell: packet.sell === true, upgrade: packet.upgrade === true };
    // Preserve a real release even when release and repress both arrive between
    // ticks. The next purchase still needs a complete, stationary hold.
    if (!player.input.upgrade) player.upgradeHeld = false;
    player.lastInputAt = this.time;
    player.input.sneak = packet.sneak === true;
    player.input.jump = packet.jump === true;
    if (packet.sprint !== true || !player.clientMotion || packet.impulseId === player.impulseId)
      player.sprintSuppressed = false;
    const drawRelease = receiveBowInput(this, player, packet);
    player.input.bowDrawing = player.bowDrawing;
    receiveMotion(this, player, packet);
    receiveAttack(this, player, packet);
    receiveShot(this, player, packet, drawRelease);
  }

  stationAt(point, radius) {
    return this.stations.find(s => distance(s, point) <= s[radius]);
  }

  event(type, actor, point, { targetId = '', kind = '', amount = 0, value = 0, bonus = 0,
    layer = null, layerCount = 0, orderId = '', orderBonus = 0, orderMissed = '', orderClaimantName = '', pickup = false, looseCount = 0, finisherId = '', meleeReason = '', weapon = '', projectileId = '', shotId = 0, spawnTime = 0, reason = '', vx = 0, vy = 0, vz = 0, power = 0, drawTicks = 0, critical = false } = {}) {
    const { x, y, z } = point;
    const event = { id: String(++this.serial), type, actorId: actor.id, targetId, kind,
      x, y, z, amount, value, bonus, ...(orderId ? { orderId, orderBonus } : {}),
      ...(orderMissed ? { orderMissed, ...(orderClaimantName ? { orderClaimantName } : {}) } : {}),
      ...(pickup || looseCount ? { pickup, looseCount } : {}),
      ...(finisherId ? { finisherId } : {}),
      ...(meleeReason ? { meleeReason } : {}),
      ...(critical ? { critical: true } : {}),
      ...(weapon ? { weapon } : {}), ...(reason ? { reason } : {}),
      ...(projectileId ? { projectileId } : {}), ...(shotId ? { shotId } : {}), ...(type === 'shot' ? { vx, vy, vz, power, drawTicks, spawnTime } : {}),
      ...(type === 'bolt-impact' ? { power } : {}),
      ...(layer !== null ? { layer, layerCount } : {}), expires: this.time + .55 };
    this.events.push(event);
    return event;
  }

  strike(player, input) {
    const eye = input.eye || this.eyes(player);
    const ray = { x: input.ax, y: input.ay, z: input.az };
    let limit = this.valley.rayDistance(eye, ray, Math.max(this.config.range, MELEE.reach) + 1e-7);
    let target, targetPose, weak = false;
    const scenery = sceneryMiningHit(this, eye, ray, Math.max(this.config.range, MELEE.reach) + 1e-7);
    if (scenery && scenery.distance <= limit + 1e-6) {
      limit = scenery.distance;
      target = { scenery };
    }
    for (const deposit of this.deposits) {

      const loose = { x: deposit.x, y: deposit.y + deposit.height + .075, z: deposit.z };
      const precise = deposit.hp ? sphereHit(eye, ray, deposit.weak, this.config.weakRadius)
        : deposit.looseCount ? sphereHit(eye, ray, loose, .20) : Infinity;
      const body = cylinderHit(eye, ray, deposit);
      const hit = Math.min(body, precise);
      if (hit >= limit) continue;
      limit = hit;
      target = deposit;
      weak = deposit.hp > 0 && precise <= body;
    }
    for (const other of this.players.values()) {
      if (other === player) continue;
      const pose = combatPose(other, input.viewTime ?? this.time);
      if (!pose) continue;
      const hit = playerRayHit(eye, ray, pose);
      if (hit > MELEE.reach + 1e-7 || hit >= limit) continue;
      limit = hit;
      target = other;
      targetPose = pose;
    }
    if (!target && input.eye && this.time + 1e-9 < player.missAttackUntil) return;
    this.event('swing', player, eye);
    if (!target) {
      if (input.eye && limit >= Math.max(this.config.range, MELEE.reach)) player.missAttackUntil = this.time + .5;
      return;
    }
    const point = { x: eye.x + ray.x * limit, y: eye.y + ray.y * limit, z: eye.z + ray.z * limit };
    if (target.ore) {
      if (input.weapon === 'bow') return;
      if (limit <= this.config.range && (target.hp > 0 || target.looseCount > 0) && this.time + 1e-9 >= player.nextStrike) {
        player.nextStrike = this.time + this.picks[player.pickLevel - 1].hitCooldown;
        this.mine(player, target, weak, point);
      }
      return;
    }
    if (target.scenery) {
      if (input.weapon === 'bow') return;
      if (limit <= this.config.range && this.time + 1e-9 >= player.nextStrike) {
        player.nextStrike = this.time + this.picks[player.pickLevel - 1].hitCooldown;
        mineScenery(this, player, target.scenery);
      }
      return;
    }
    if (input.miningOnly) return;
    // Rewinding an exposed target must not hit somebody who has already gone behind cover.
    // Check the same selected body point at the current positions. A head or
    // shoulder exposed above cover must not fail a second ray to the hidden torso.
    const currentEye = this.eyes(player);
    const currentPoint = { x: target.x + point.x - targetPose.x,
      y: target.y + point.y - targetPose.y, z: target.z + point.z - targetPose.z };
    const currentAim = aimAt(currentEye, currentPoint);
    const currentDistance = Math.hypot(currentPoint.x - currentEye.x, currentPoint.y - currentEye.y, currentPoint.z - currentEye.z);
    if (this.valley.rayDistance(currentEye, currentAim, currentDistance + .01) < currentDistance - .01) return;
    for (const deposit of this.deposits)
      if (cylinderHit(currentEye, currentAim, deposit) < currentDistance - .01) return;
    hitPlayer(this, player, target, point, input);
  }

  mine(player, deposit, weak, point) {
    const targetId = deposit.id, kind = deposit.kind;
    if (!deposit.active || (!deposit.hp && !deposit.looseCount)) return;
    if (player.bag.length >= this.config.capacity) {
      this.event('full', player, point, { targetId, kind });
      return;
    }
    if (!deposit.hp) {
      const amount = Math.min(deposit.looseCount, this.config.capacity - player.bag.length);
      for (let i = 0; i < amount; i++) player.bag.push(kind);
      deposit.looseCount -= amount;
      this.event('harvest', player, point, { targetId, kind, amount, value: amount * deposit.ore.value,
        pickup: true, looseCount: deposit.looseCount });
      return;
    }
    if (player.pickLevel < deposit.ore.minLevel) {
      this.event('hard', player, point, { targetId, kind, amount: deposit.ore.minLevel });
      return;
    }
    const pick = this.picks[player.pickLevel - 1];
    const damage = Math.min(deposit.hp, weak ? pick.weakDamage : pick.damage);
    deposit.hp -= damage;
    deposit.minerId = player.id;
    deposit.minedAt = this.time;
    deposit.work.set(player.id, (deposit.work.get(player.id) || 0) + damage);
    deposit.contested ||= deposit.work.size > 1;
    this.event(weak ? 'weak' : 'mine', player, point, { targetId, kind, amount: damage });
    if (deposit.hp > 0) {
      this.shiftWeakPoint(deposit, player);
      return;
    }

    // A rival must do a real share of the work, then land the precision finish.
    // A one-tap bystander cannot steal the whole reward from the main miner.
    const finishRequired = this.finishRequired(deposit);
    const precisionFinish = weak && (deposit.work.get(player.id) || 0) >= finishRequired;
    const recipient = precisionFinish ? player : this.claimant(deposit) || player;
    const layered = kind === 'gold' && this.goldLayers;
    const yieldCount = layered ? 1 : deposit.ore.yield;
    const amount = Math.min(yieldCount, this.config.capacity - recipient.bag.length);
    deposit.looseCount = yieldCount - amount;
    const eligibility = new Map();
    let largestId = '', largestDamage = 0;
    for (const [id, contribution] of deposit.work) {
      if (contribution > largestDamage) { largestId = id; largestDamage = contribution; }
      const miner = this.players.get(id);
      eligibility.set(id, !miner ? 'left' : miner.bag.length >= this.config.capacity ? 'bag-full'
        : distance(miner, deposit) > this.config.range + deposit.radius ? 'too-far' : '');
    }
    for (let i = 0; i < amount; i++) recipient.bag.push(kind);
    deposit.regenAt = this.time + deposit.ore.respawnSeconds;
    deposit.minerId = '';
    const harvest = this.event('harvest', recipient, point, { targetId, kind, amount, value: amount * deposit.ore.value,
      looseCount: deposit.looseCount, finisherId: player.id,
      ...(layered ? { layer: deposit.layer, layerCount: 2 } : {}) });
    deposit.result = { id: harvest.id, at: this.time, recipientId: recipient.id,
      recipientName: recipient.name, amount, work: new Map(deposit.work),
      layer: deposit.layer, contested: deposit.contested, eligibility, finishRequired,
      finisherId: player.id, finishWeak: weak,
      reason: precisionFinish ? 'precision' : recipient.id === largestId ? 'contribution' : 'nearby' };
    deposit.work.clear();
    if (layered) {
      deposit.layerResults.push(deposit.result);
      deposit.result = null;
      deposit.contested = false;
      if (deposit.layer < 2) {
        deposit.layer++;
        deposit.hp = this.goldLayers[deposit.layer - 1];
        deposit.regenAt = 0;
        this.shiftWeakPoint(deposit, player);
      }
    }
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

  steal(attacker, victim, point, weapon = '') {
    if (!victim.bag.length || attacker.bag.length >= this.config.capacity) return;
    const kind = victim.bag.pop();
    attacker.bag.push(kind);
    victim.sellProgress = 0;
    victim.sale = null;
    this.noteTheft(attacker, victim);
    this.event('steal', attacker, point, { targetId: victim.id, kind, amount: 1, value: this.ores.get(kind).value, weapon });
  }

  noteTheft(attacker, victim) {
    if (attacker.lastTheft?.id === victim.id && this.time < attacker.lastTheft.until) {
      attacker.lastTheft = null;
      // Having recovered one ore, prefer getting it home to renewing the same
      // duel indefinitely. This is an AI choice, not protection from another hit.
      attacker.botDisengageUntil = this.time + 2;
      attacker.botFleeUntil = this.time + 2;
      attacker.botSale = null;
      attacker.botPickAt = 0;
    }
    // Only a theft personally experienced by this player creates the memory.
    // Pursuit still requires current visibility, space and a reachable target.
    victim.lastTheft = { id: attacker.id, until: this.time + 3, readyAt: this.time + .12 };
    if (victim.botChase && victim.botChase.id !== attacker.id) this.endBotChase(victim);
  }

  bagValue(player) {
    return player.bag.reduce((value, kind) => value + this.ores.get(kind).value, 0);
  }

  move(player, input, dt) {
    if (Math.hypot(input.ax, input.az) > .001) player.yaw = Math.atan2(input.ax, input.az);
    // Modern clients own pose. No held-input movement while they stop or a packet is delayed.
    if (player.clientMotion) return Math.hypot(input.x, input.z) > .02 ||
      Math.hypot(player.velocityX, player.velocityZ) > .05 || !player.grounded;
    return integrateMotion(this, player, input, dt);
  }

  applyKnockback(player, vx, vy, vz) { applyKnockback(player, vx, vy, vz); }

  orderAt(station, ahead = 0) {
    const elapsed = this.roundSeconds - this.timeLeft;
    const phase = Math.floor((Math.min(elapsed + ahead, this.roundSeconds - 1e-7) + 1e-9) / orderSeconds);
    const kind = premiumOres[(station.index + phase + this.round - 1) % premiumOres.length];
    const first = phase * orderSeconds >= FIRST_ORDER.startsAt &&
      station.index === (phase + this.round - 2) % this.stations.length;
    const id = first ? `${this.round}:${phase}:${station.id}` : '';
    const claimant = this.filledOrders.get(id);
    const until = Math.min((phase + 1) * orderSeconds, this.roundSeconds);
    return { kind, bonus: premiums[kind], until,
      id, quantity: first ? FIRST_ORDER.quantity : 0, reward: first ? FIRST_ORDER.reward : 0,
      available: this.phase === 'playing' && first && !claimant && elapsed + ahead < until,
      claimantId: claimant?.id || '', claimantName: claimant?.name || '' };
  }

  quote(player, station, order = this.orderAt(station), baseValue = this.bagValue(player)) {
    const bonus = player.bag.filter(kind => kind === order.kind).length * order.bonus;
    const orderBonus = order.available && player.bag.filter(kind => kind === order.kind).length >= order.quantity
      ? order.reward : 0;
    return { stationId: station.id, baseValue, bonus, normalValue: baseValue + bonus,
      orderId: order.id || '', orderBonus, value: baseValue + bonus + orderBonus };
  }

  saleOrderBonus(player, station) {
    const order = this.orderAt(station);
    return this.phase === 'playing' && player.sale?.orderId === order.id && order.available &&
      (player.sale.items || player.bag).filter(kind => kind === order.kind).length >= order.quantity &&
      player.bag.filter(kind => kind === order.kind).length >= order.quantity ? order.reward : 0;
  }

  sell(player, input, _moving, dt) {
    const station = this.stationAt(player, 'radius');
    if (!station || !input.sell || input.upgrade || input.fire || !player.bag.length) {
      player.sellProgress = 0;
      player.sale = null;
      return;
    }
    if (player.sale?.stationId !== station.id) {
      player.sellProgress = 0;
      player.sale = { ...this.quote(player, station), items: [...player.bag] };
    }
    player.sellProgress += dt / this.config.sellSeconds;
    if (player.sellProgress < 1 - 1e-9) return;
    // Sell only the quoted batch. Later receipts remain in the bag and a held E
    // starts the next batch without requiring release. Never pay for missing ore.
    const items = player.sale.items || player.bag, remaining = [...player.bag];
    for (const kind of items) {
      const index = remaining.indexOf(kind);
      if (index < 0) { player.sale = null; player.sellProgress = 0; return; }
      remaining.splice(index, 1);
    }
    // The unit price is locked when the batch starts. A first order is never reserved: it must
    // still be open, in time, and present in the actual bag when the hold completes.
    const orderBonus = this.saleOrderBonus(player, station);
    const { bonus, orderId } = player.sale;
    let orderMissed = '', orderClaimantName = '';
    if (player.sale.orderBonus > 0 && !orderBonus) {
      const claimant = this.filledOrders.get(orderId);
      if (claimant && claimant.id !== player.id) {
        orderMissed = 'claimed';
        orderClaimantName = claimant.name;
      } else {
        const currentOrder = this.orderAt(station);
        if (currentOrder.id !== orderId || !currentOrder.available) orderMissed = 'expired';
      }
    }
    const value = player.sale.normalValue + orderBonus;
    const amount = items.length;
    if (orderBonus) {
      this.filledOrders.set(orderId, { id: player.id, name: player.name });
      player.ordersCompleted++;
      player.orderEarnings += orderBonus;
    }
    player.score += value;
    player.grossSales += value;
    player.goldSold += items.filter(kind => kind === 'gold').length;
    player.bag = remaining;
    player.sellProgress = 0;
    player.sale = null;
    this.event('sold', player, station, { targetId: station.id, amount, value, bonus, orderId, orderBonus,
      orderMissed, orderClaimantName });
  }

  nextPick(player) {
    return this.picks[player.pickLevel] || null;
  }

  upgrade(player, input, _moving, dt) {
    if (!input.upgrade) player.upgradeHeld = false;
    const station = this.stationAt(player, 'radius');
    const pick = this.nextPick(player);
    if (!station || !pick || !input.upgrade || input.sell || input.fire ||
      player.upgradeHeld || player.score < pick.cost) {
      player.upgradeProgress = 0;
      player.upgradeStation = '';
      return;
    }
    if (player.upgradeStation !== station.id) player.upgradeProgress = 0;
    player.upgradeStation = station.id;
    player.upgradeProgress += dt / this.config.upgradeSeconds;
    if (player.upgradeProgress < 1 - 1e-9) return;
    player.score -= pick.cost;
    player.investmentSpent += pick.cost;
    player.pickLevel = pick.level;
    player.upgradeProgress = 0;
    player.upgradeHeld = true;
    player.upgradeStation = '';
    this.event('upgraded', player, station, { targetId: station.id, amount: pick.level, value: pick.cost });
  }

  finishRequired(deposit) {
    const maxHp = this.goldLayers && deposit.kind === 'gold'
      ? this.goldLayers[Math.max(0, deposit.layer - 1)] : deposit.ore.hp;
    return Math.max(2, Math.ceil(maxHp / 4));
  }

  claimant(deposit) {
    let claimant = null, best = 0;
    for (const [id, contribution] of deposit.work) {
      const player = this.players.get(id);
      if (!player || contribution <= best || player.bag.length >= this.config.capacity ||
        distance(player, deposit) > this.config.range + deposit.radius) continue;
      claimant = player;
      best = contribution;
    }
    return claimant;
  }

  localClaims(viewerId) {
    const viewer = this.players.get(viewerId);
    if (!viewer) return [];
    const claims = [];
    for (const deposit of this.deposits) {
      if (this.goldLayers && deposit.kind === 'gold' && distance(viewer, deposit) <= 8) {
        for (const result of deposit.layerResults) {
          if (this.time - result.at > 4 || !result.work.has(viewerId)) continue;
          claims.push(this.resultClaim(viewerId, deposit, result));
        }
      }
      if (!deposit.contested || distance(viewer, deposit) > 8) continue;
      const result = deposit.result;
      if (result && this.time - result.at <= 4 && result.work.has(viewerId)) {
        claims.push(this.resultClaim(viewerId, deposit, result));
        continue;
      }
      if (!deposit.hp || !deposit.work.has(viewerId)) continue;
      const leader = this.claimant(deposit);
      const status = viewer.bag.length >= this.config.capacity ? 'bag-full'
        : distance(viewer, deposit) > this.config.range + deposit.radius ? 'too-far'
          : leader?.id === viewerId ? 'leading' : 'trailing';
      claims.push({ depositId: deposit.id, contested: true, leaderId: leader?.id || '', leaderName: leader?.name || '',
        ...(this.goldLayers && deposit.kind === 'gold' ? { layer: deposit.layer } : {}),
        ownDamage: deposit.work.get(viewerId), finishRequired: this.finishRequired(deposit), status, resultId: '', resultAmount: 0, resultAge: 0 });
    }
    return claims;
  }

  resultClaim(viewerId, deposit, result) {
    let resultReason = result.reason || 'expired';
    if (result.recipientId && result.recipientId !== viewerId) {
      const eligibility = result.eligibility?.get(viewerId);
      if (eligibility) resultReason = eligibility;
      else if (result.reason !== 'precision' && result.finisherId === viewerId)
        resultReason = result.work.get(viewerId) < result.finishRequired ? 'not-enough' : 'not-weak';
    }
    return { depositId: deposit.id, ...(result.layer ? { layer: result.layer } : {}), contested: result.contested,
      leaderId: result.recipientId, leaderName: result.recipientName, ownDamage: result.work.get(viewerId),
      finishRequired: result.finishRequired || 0, resultReason,
      status: result.recipientId ? result.recipientId === viewerId ? 'received' : 'other-received' : 'expired',
      resultId: result.id, resultAmount: result.amount, resultAge: this.time - result.at };
  }

  updateRareSites() {
    const gold = this.deposits.filter(d => d.kind === 'gold');
    for (const deposit of gold) {
      if (deposit.active && this.time >= deposit.expiresAt) {
        if (deposit.work.size) {
          const result = { id: 'expiry-' + (++this.serial), at: this.time,
            recipientId: '', recipientName: '', amount: 0, work: new Map(deposit.work),
            layer: deposit.layer, contested: deposit.contested };
          if (this.goldLayers) deposit.layerResults.push(result);
          else deposit.result = result;
        }
        deposit.active = false;
        deposit.looseCount = 0;
        deposit.hp = 0;
        deposit.minerId = '';
        deposit.work.clear();
      }
    }
    if (!gold.length || this.nextRareAt >= this.time + this.timeLeft) return;
    if (!this.announcedRare.length && this.time >= this.nextRareAt - this.rare.previewSeconds) {
      const pool = this.rareCandidates();
      const count = Math.min(this.rare.count, pool.length);
      for (let i = 0; i < count; i++) {
        const index = Math.min(pool.length - 1, Math.floor(this.rareRandom() * pool.length));
        const deposit = pool.splice(index, 1)[0];
        deposit.announced = true;
        deposit.opensAt = this.nextRareAt;
        this.announcedRare.push(deposit);
      }
    }
    if (this.time < this.nextRareAt) return;
    this.lastRareIds = new Set(this.announcedRare.map(d => d.id));
    for (const deposit of this.announcedRare) {
      Object.assign(deposit, { active: true, announced: false, hp: deposit.ore.hp, weak: deposit.startingWeak,
        expiresAt: this.nextRareAt + this.rare.activeSeconds, regenAt: 0, minerId: '', result: null, contested: false, looseCount: 0 });
      if (this.goldLayers) Object.assign(deposit, { hp: this.goldLayers[0], layer: 1, layerResults: [] });
      deposit.work.clear();
    }
    this.announcedRare = [];
    this.nextRareAt += this.rare.interval;
  }

  rareCandidates() {
    const gold = this.deposits.filter(d => d.kind === 'gold');
    const eligible = gold.filter(d => !this.lastRareIds.has(d.id));
    return eligible.length >= this.rare.count ? eligible : gold;
  }

  knownGold() {
    return this.deposits.filter(d => d.kind === 'gold' && (d.announced || d.active && d.hp));
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

  miningPositions(player, deposit) {
    const others = this.botKnowledge ? this.visibleOpponents(player) : [...this.players.values()];
    return deposit.approaches.filter(at => !others.some(other =>
      other !== player && distance(other, at) < 1.05));
  }

  observeOre(player) {
    for (const deposit of this.deposits) {
      if (deposit.kind === 'gold') continue;
      const gap = distance(player, deposit);
      if (gap > 40) continue;
      const target = { x: deposit.x, y: deposit.y + deposit.height + .02, z: deposit.z };
      const eye = this.eyes(player), ray = aimAt(eye, target);
      const length = Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z);
      if (this.valley.rayDistance(eye, ray, length) < length - .12 ||
        this.deposits.some(other => other !== deposit && cylinderHit(eye, ray, other) < length - .2)) continue;
      // Outside the 8m target label, the rock reveals depletion but not an exact hit count or timer.
      const hp = deposit.hp === 0 ? 0 : gap <= 8 ? deposit.hp : deposit.ore.hp;
      const previous = player.botOreMemory.get(deposit.id);
      let readyAt = 0;
      if (!hp) readyAt = gap <= 8 ? deposit.regenAt
        : previous?.hp === 0 && previous.readyAt > this.time ? previous.readyAt
          : this.time + deposit.ore.respawnSeconds;
      player.botOreMemory.set(deposit.id, { hp, readyAt, observedAt: this.time });
    }
  }

  perceivedOre(player, deposit) {
    if (!this.botKnowledge || deposit.kind === 'gold') return deposit;
    const memory = player.botOreMemory.get(deposit.id);
    if (!memory) return { hp: deposit.ore.hp, active: true };
    const hp = !memory.hp && this.time >= memory.readyAt ? deposit.ore.hp : memory.hp;
    return { hp, active: true };
  }

  chooseBotSale(player, avoidThreats = false) {
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
      // Sprint has no stamina limit. Include only its short ground acceleration,
      // rather than forecasting a slowdown that can never happen in this game.
      const travelTime = toCircle / MOTION.sprint + .06;
      if (travelTime + this.config.sellSeconds > this.timeLeft) continue;
      const order = this.botArrivalOrder(station, travelTime);
      const quote = this.quote(player, station, order);
      // Arrival locks the unit premium, but the race must allow the entire sell hold.
      const orderBonus = order.until - (this.roundSeconds - this.timeLeft) >= travelTime + this.config.sellSeconds
        ? quote.orderBonus : 0;
      const risk = avoidThreats ? this.routeThreat(player, route) : 0;
      const rank = quote.bonus + orderBonus - travelTime * 1.65 - risk;
      if (!choice || rank > choice.rank) choice = { station, route, rank };
    }
    return choice;
  }

  botArrivalOrder(station, ahead) {
    const current = this.orderAt(station);
    const remaining = current.until - (this.roundSeconds - this.timeLeft);
    if (ahead < remaining) return current;
    // Only the eight-second public preview is known, not arbitrary future schedules.
    if (remaining <= orderPreviewSeconds && ahead < remaining + orderSeconds)
      return this.orderAt(station, remaining + .01);
    return { kind: '', bonus: 0, available: false, until: current.until };
  }

  botOrderChase(player) {
    if (player.bag.length !== 1) return false;
    return this.stations.some(station => {
      const order = this.orderAt(station);
      const home = Math.max(0, distance(player, station) - station.radius) / MOTION.sprint;
      return order.available && player.bag[0] === order.kind &&
        order.until - (this.roundSeconds - this.timeLeft) > 2.4 + home + this.config.sellSeconds;
    });
  }

  orderReady(player) {
    return this.phase === 'playing' && this.stations.some(station => {
      const order = this.orderAt(station);
      return order.available && player.bag.filter(kind => kind === order.kind).length >= order.quantity;
    });
  }

  botOrderInterception(player, other) {
    // The physical cargo tag is readable only nearby, on the normal observation
    // interval. Do not infer an opponent's ore mix from its server inventory.
    const seen = player.botVisibleRivals.find(p => p.id === other.id);
    if (!seen?.orderReady || distance(player, other) > 4.8 || player.bag.length > 1 ||
      player.bag.length === 1 && !this.botOrderChase(player)) return false;
    const station = this.stations.find(s => this.orderAt(s).available);
    if (!station) return false;
    const order = this.orderAt(station);
    const home = Math.max(0, distance(player, station) - station.radius) / MOTION.sprint;
    if (order.until - (this.roundSeconds - this.timeLeft) < home + this.config.sellSeconds + 2.4) return false;
    const catchTime = .5 + Math.max(0, distance(player, other) - 2.4) / MOTION.sprint;
    const mining = player.botTarget ? this.botMiningRank(player, player.botTarget) : 1.5;
    const opportunity = Math.max(1.5, Number.isFinite(mining) ? mining : 1.5) * (catchTime + 1);
    // A two-item tagged bag has exactly the requested pair. Bigger bags disclose
    // no mix: discount both the denied delivery and the possible matching ore.
    const matchChance = Math.min(1, 2 / Math.max(2, seen.inventoryCount));
    const gain = (order.reward * .5 + this.ores.get(order.kind).value +
      (player.bag.length ? order.reward : 0)) * matchChance;
    return gain > opportunity;
  }

  routeThreat(player, route) {
    const threats = this.visibleOpponents(player).filter(other =>
      (!other.bag.length || player.lastTheft?.id === other.id && this.time < player.lastTheft.until) && distance(other, player) < 7);
    let risk = 0, start = player;
    for (const point of route) {
      const dx = point.x - start.x, dz = point.z - start.z, square = dx * dx + dz * dz;
      for (const threat of threats) {
        const t = square ? clamp(((threat.x - start.x) * dx + (threat.z - start.z) * dz) / square, 0, 1) : 0;
        const gap = Math.hypot(threat.x - start.x - dx * t, threat.z - start.z - dz * t);
        risk = Math.max(risk, Math.max(0, 4.5 - gap) * 4.5);
      }
      if (distance(player, point) > 24) break;
      start = point;
    }
    return risk;
  }

  awayFromTrade(point, margin = 0) {
    return this.stations.every(station => distance(point, station) > station.safeRadius + margin);
  }

  endBotChase(player) {
    player.botChase = null;
    player.botChaseCooldown = this.time + 4;
    player.botPlanAt = this.time;
  }

  botQueueMelee(player, other, aim) {
    if (this.time < player.botMeleeAt || this.time < (other.hurtUntil || 0) ||
      playerRayHit(this.eyes(player), aim, other) > MELEE.reach) return false;
    const viewed = player.combatHistory.at(-1)?.time;
    player.pendingAttacks.push({ ...idle, ax: aim.x, ay: aim.y, az: aim.z,
      eye: this.eyes(player), viewTime: viewed >= this.time - .1 ? viewed : this.time, queuedAt: this.time });
    player.botMeleeAt = this.time + .5;
    return true;
  }

  botChaseInput(player) {
    const chase = player.botChase;
    if (!chase) return null;
    const other = this.visibleOpponents(player).find(p => p.id === chase.id);
    const gap = other ? distance(player, other) : Infinity;
    const eye = this.eyes(player);
    const point = other && { x: other.x, y: other.y + this.valley.data.playerHeight * .72, z: other.z };
    const aim = point && aimAt(eye, point);
    const contact = other && playerRayHit(eye, aim, other) <= MELEE.reach;
    const retaliation = chase.retaliation;
    if (!other || player.bag.length > chase.startCount || !other.bag.length ||
      chase.forOrder && !this.stations.some(s => this.orderAt(s).available) ||
      !retaliation && !chase.crossing && player.bag.length && !this.botOrderChase(player) ||
      retaliation && (player.lastTheft?.id !== chase.id || this.time >= player.lastTheft.until || player.bag.length >= this.config.capacity) ||
      this.time >= chase.until ||
      this.timeLeft < 4 || !this.awayFromTrade(player, retaliation ? 0 : 1) || !this.awayFromTrade(other, retaliation ? 0 : 1) ||
      gap > 6.5 || this.time - chase.started > .7 && gap > chase.gap + .5 ||
      !contact && !this.valley.walkClear(player, other)) {
      this.endBotChase(player);
      return null;
    }
    if (contact) {
      const ready = !retaliation || this.time >= player.lastTheft.readyAt;
      if (ready && this.botQueueMelee(player, other, aim)) {
        // An entity press uses the same queue as a human click, independently
        // of the mining pick's cooldown. It is not a held mining pulse.
        if (!retaliation) this.endBotChase(player);
      }
      return { ...idle, ax: aim.x, ay: aim.y, az: aim.z };
    }
    return { ...idle, x: (other.x - player.x) / Math.max(1, gap),
      z: (other.z - player.z) / Math.max(1, gap), ax: aim.x, ay: aim.y, az: aim.z,
      sprint: true };
  }

  considerBotRetaliation(player) {
    const memory = player.lastTheft;
    if (!memory || this.time >= memory.until) { player.lastTheft = null; return; }
    if (player.botChase?.retaliation || player.bag.length >= this.config.capacity ||
      this.timeLeft < 4 || !this.awayFromTrade(player)) return;
    const other = this.visibleOpponents(player, 4.8).find(p => p.id === memory.id);
    if (!other) return;
    if (!other.bag.length) { player.lastTheft = null; return; }
    const gap = distance(player, other);
    const contact = playerRayHit(this.eyes(player), aimAt(this.eyes(player), { ...other, y: other.y + 1.2 }), other) <= MELEE.reach;
    if (gap > 4.8 || !this.awayFromTrade(other) || !contact && !this.valley.walkClear(player, other)) return;
    player.botChase = { id: other.id, started: this.time, until: Math.min(memory.until, this.time + 1.8),
      gap, startCount: player.bag.length, retaliation: true };
    player.botTarget = null;
  }

  considerBotChase(player, previous = []) {
    const orderChase = this.botOrderChase(player);
    if (player.bag.length >= this.config.capacity || player.botChase || player.botInvest || this.time < player.botChaseCooldown ||
      this.timeLeft < 8 || !this.awayFromTrade(player, 1)) return;
    const pick = this.picks[player.pickLevel - 1];
    const current = player.botTarget;
    const currentHP = current ? this.perceivedOre(player, current).hp : 0;
    if (current?.ore.value >= 10 && currentHP > 0 && currentHP <= pick.weakDamage &&
      (!this.botKnowledge || distance(player, current) <= this.config.range + current.radius)) return;
    const lost = this.localClaims(player.id).find(claim =>
      claim.status === 'other-received' && claim.resultAge >= .35 && claim.resultAge < 1.6);
    const crossing = other => {
      if (!player.bag.length || distance(player, other) > 6.2) return false;
      const next = player.route[0] || player.goal;
      const direction = next ? { x: next.x - player.x, z: next.z - player.z }
        : { x: Math.sin(player.yaw), z: Math.cos(player.yaw) };
      const length = Math.hypot(direction.x, direction.z);
      return length > .01 && ((other.x-player.x)*direction.x+(other.z-player.z)*direction.z)/
        (Math.max(.1,distance(player,other))*length) > .2;
    };
    const candidates = this.visibleOpponents(player, 6.2).filter(other => {
      const gap = distance(player, other);
      const interception = this.botOrderInterception(player, other);
      const cross = crossing(other);
      if (player.bag.length && !orderChase && !cross) return false;
      if (gap > (interception ? 4.8 : 6.2)) return false;
      if (!other.bag.length || !this.awayFromTrade(other, 1) ||
        this.time - (player.botAttempted.get(other.id) ?? -Infinity) < 7) return false;
      const before = previous.find(p => p.id === other.id);
      const newLoad = before && (before.inventoryCount < 2 && other.bag.length > before.inventoryCount ||
        before.inventoryCount < 4 && other.bag.length >= 4);
      const firstLargeLoad = !before && other.bag.length >= 4;
      const closeOpportunity = !player.bag.length && gap <= 2.8;
      const contact = playerRayHit(this.eyes(player), aimAt(this.eyes(player), { ...other, y: other.y + 1.2 }), other) <= MELEE.reach;
      return (interception || cross || closeOpportunity || !player.bag.length && (newLoad || firstLargeLoad || lost?.leaderId === other.id)) &&
        (contact || this.valley.walkClear(player, other));
    }).sort((a, b) => distance(player, a) - distance(player, b));
    const victim = candidates[0];
    if (!victim) return;
    player.botAttempted.set(victim.id, this.time);
    player.botChase = { id: victim.id, started: this.time, until: this.time + (crossing(victim) ? 1.6 : 2.4),
      gap: distance(player, victim), startCount: player.bag.length,
      forOrder: this.botOrderInterception(player, victim), crossing: crossing(victim) };
    player.botTarget = null;
  }

  botTacticalInput(player) {
    if (!this.botTactics) return null;
    if (this.time < player.botDisengageUntil) {
      if (player.botChase) this.endBotChase(player);
      if (player.bag.length && !player.botSale) {
        const choice = this.chooseBotSale(player, true);
        if (choice) {
          player.botSale = choice.station; player.goalKey = choice.station.id;
          player.goal = choice.station; player.route = choice.route;
        }
      }
      const memory = player.lastTheft;
      if (memory && this.time >= memory.readyAt && this.time < memory.until &&
        player.bag.length < this.config.capacity && this.awayFromTrade(player)) {
        const other = this.visibleOpponents(player, 3.8).find(p => p.id === memory.id && p.bag.length && this.awayFromTrade(p));
        if (other) {
          const aim = aimAt(this.eyes(player), { x: other.x, y: other.y + 1.2, z: other.z });
          if (this.botQueueMelee(player, other, aim)) return this.travel(player, aim, true);
        }
      }
      return null;
    }
    this.considerBotRetaliation(player);
    if (this.time >= player.botTacticAt) {
      player.botTacticAt = this.time + .25;
      this.considerBotChase(player);
      if (player.bag.length > 0 && (this.bagValue(player) >= 8 || player.bag.length >= 4 ||
        this.stations.some(station => this.quote(player, station).orderBonus > 0))) {
        const threats = this.visibleOpponents(player).filter(other =>
          (!other.bag.length || player.lastTheft?.id === other.id && this.time < player.lastTheft.until) &&
          distance(other, player) < 6.5 && this.awayFromTrade(other, 1));
        if (threats.length && this.awayFromTrade(player, 1)) {
          player.botFleeUntil = this.time + 1.8;
          if (this.time >= player.botEscapeAt) {
            player.botEscapeAt = this.time + 1.5;
            const choice = this.chooseBotSale(player, true);
            if (choice) {
              player.botSale = choice.station;
              player.goalKey = choice.station.id;
              player.goal = choice.station;
              player.route = choice.route;
              player.botTarget = null;
            }
          }
        }
      }
    }
    return this.botChaseInput(player);
  }

  visibleOpponents(player, radius = 28) {
    const eye = this.eyes(player);
    return [...this.players.values()].filter(other => {
      if (other === player || distance(other, player) > radius) return false;
      const target = this.eyes(other), direction = aimAt(eye, target);
      const length = Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z);
      if (this.valley.rayDistance(eye, direction, length) < length - .3) return false;
      return !this.deposits.some(d => cylinderHit(eye, direction, d) < length - .3);
    });
  }

  botShouldInvest(player) {
    const next = this.nextPick(player);
    if (!next || player.score < next.cost) return false;
    const conservative = player.id.endsWith('0');
    if (player.pickLevel === 1) return this.timeLeft > 55;
    const known = this.knownGold();
    if (conservative && !known.length) return false;
    if (this.timeLeft < this.config.upgradeSeconds + 32) return false;
    const threats = player.botVisibleRivals.filter(other => other.pickLevel >= next.level);
    const delay = known.length ? Math.min(...known.map(d => d.announced ? d.opensAt - this.time : 0))
      : Math.max(0, this.nextRareAt - this.time);
    const waves = Math.max(0, 1 + Math.floor((this.timeLeft - delay - 22) / this.rare.interval));
    const current = this.picks[player.pickLevel - 1];
    const gain = 1 - current.damage * next.hitCooldown / (next.damage * current.hitCooldown);
    const expected = waves * this.ores.get('gold').value * this.ores.get('gold').yield /
      (1 + threats.length) * Math.min(1, gain * 2);
    if (expected < next.cost + (conservative ? 20 : 8)) return false;
    if (!known.length) return !conservative && this.timeLeft > 96 && !threats.length;
    return known.some(d => {
      const travel = distance(player, d) / this.valley.data.walkSpeed + this.config.upgradeSeconds;
      const limit = d.announced ? d.opensAt - this.time + this.rare.activeSeconds : d.expiresAt - this.time;
      if (travel + 10 > limit) return false;
      const beaten = threats.some(other => distance(other, d) / this.valley.data.walkSpeed + 3 < travel);
      return !beaten || !conservative && waves >= 3;
    });
  }

  observeBot(player) {
    if (this.time < player.botObserveAt) return;
    player.botObserveAt = this.time + .8 + this.random() * .7;
    if (this.botKnowledge) this.observeOre(player);
    const previous = player.botVisibleRivals;
    player.botVisibleRivals = this.visibleOpponents(player).map(other => ({
      id: other.id, x: other.x, z: other.z, pickLevel: other.pickLevel,
      inventoryCount: other.bag.length, yaw: other.yaw,
      orderReady: distance(player, other) <= 12 && this.orderReady(other),
    }));
    player.botInvest = this.botShouldInvest(player);
    player.botInvestLevel = this.nextPick(player)?.level || 0;
    if (this.botTactics) this.considerBotChase(player, previous);
    const known = this.knownGold();
    const signature = known.map(d => d.id + ':' + (d.announced ? 'soon' : 'open')).join(',');
    if (signature !== player.botKnownWave) {
      player.botKnownWave = signature;
      player.botPlanAt = Math.min(player.botPlanAt || Infinity, this.time + .45 + this.random() * .65);
    }
  }

  botMiningRank(player, deposit) {
    const pick = this.picks[player.pickLevel - 1];
    const travel = Math.max(0, distance(player, deposit) - 1.8) / this.valley.data.walkSpeed;
    const layered = this.goldLayers && deposit.kind === 'gold';
    const forecast = deposit.announced;
    const hp = forecast ? layered ? this.goldLayers[0] : deposit.ore.hp : this.perceivedOre(player, deposit).hp;
    const remainingHP = hp + (layered && (forecast || deposit.layer < 2) ? this.goldLayers[1] : 0);
    const mining = Math.ceil(remainingHP / (pick.damage * 1.35)) * (pick.hitCooldown + .85);
    const home = Math.max(0, Math.min(...this.stations.map(s => distance(s, deposit))) - 3) /
      this.valley.data.walkSpeed;
    const wait = forecast ? Math.max(0, this.nextRareAt - this.time - travel) : 0;
    if (deposit.kind === 'gold') {
      const lifetime = forecast ? this.nextRareAt - this.time + this.rare.activeSeconds
        : deposit.expiresAt - this.time;
      if (travel + mining + 1 > lifetime) return -Infinity;
    }
    const nearby = player.botVisibleRivals.filter(other => other.inventoryCount < this.config.capacity &&
      other.pickLevel >= deposit.ore.minLevel && distance(other, deposit) < 8);
    let competition = 1;
    if (nearby.length) {
      const first = Math.min(...nearby.map(other => Math.max(0, distance(other, deposit) - 2) /
        this.valley.data.walkSpeed));
      const enemyTime = Math.min(...nearby.map(other => {
        const enemy = this.picks[other.pickLevel - 1];
        return Math.ceil(hp / enemy.weakDamage) * enemy.hitCooldown;
      }));
      if (first + enemyTime < travel) competition = .18;
      else competition = player.id.endsWith('0') ? .58 : .84;
      const work = deposit.work.get(player.id) || 0;
      if (distance(player, deposit) <= 8 && work + hp >= this.finishRequired(deposit) &&
        hp <= pick.weakDamage * 3 && travel < 1.2) competition = 1.12;
    }
    let orderValue = 0;
    if (deposit.kind !== 'gold') for (const station of this.stations) {
      const delivery = Math.max(0, distance(deposit, station) - station.radius) / MOTION.walk;
      const eta = travel + mining + wait + delivery + this.config.sellSeconds;
      const order = this.botArrivalOrder(station, eta);
      if (order.available && order.kind === deposit.kind &&
        player.bag.filter(kind => kind === order.kind).length + deposit.ore.yield >= order.quantity &&
        eta < order.until - (this.roundSeconds - this.timeLeft)) orderValue = Math.max(orderValue, order.reward);
    }
    const value = deposit.ore.value * (layered && !forecast && deposit.layer === 2 ? 1 : deposit.ore.yield) + orderValue;
    return value * competition / (2.5 + travel + mining + wait + home + this.config.sellSeconds);
  }

  botShouldBankLayer(player) {
    if (!this.goldLayers || player.bag.length !== 1 || player.bag[0] !== 'gold') return false;
    const deposit = player.botTarget;
    if (!deposit || deposit.kind !== 'gold' || !deposit.hp) return true;
    const pick = this.picks[player.pickLevel - 1];
    const mineSeconds = Math.ceil(deposit.hp / (pick.damage * 1.35)) * (pick.hitCooldown + .85);
    const homeSeconds = Math.min(...this.stations.map(s => distance(player, s))) / this.valley.data.walkSpeed;
    if (this.timeLeft < mineSeconds + homeSeconds + this.config.sellSeconds + 1) return true;
    if (!player.id.endsWith('0')) return false;
    // A cautious miner can bank its cargo instead of entering a poor second mining contest.
    return player.botVisibleRivals.some(other => other.pickLevel >= player.pickLevel &&
      distance(other, deposit) < 6 && (deposit.work.get(player.id) || 0) < deposit.hp / 2);
  }

  botInput(player) {
    this.observeBot(player);
    const ranged = botCrossbowInput(this, player);
    if (ranged) return ranged;
    const tactic = this.botTacticalInput(player);
    if (tactic) return tactic;
    const nearest = Math.min(...this.stations.map(s => distance(s, player)));
    if (player.botSale && !player.sale && this.time >= player.botPickAt) {
      player.botPickAt = this.time + 1;
      const choice = this.chooseBotSale(player, this.time < player.botFleeUntil);
      if (choice && choice.station !== player.botSale) {
        player.botSale = choice.station; player.goalKey = choice.station.id;
        player.goal = choice.station; player.route = choice.route;
      }
    }
    const nextPick = this.nextPick(player);
    const invest = nextPick && player.botInvest && player.botInvestLevel === nextPick.level &&
      player.score >= nextPick.cost;
    if (invest && !player.bag.length && this.stationAt(player, 'radius')) {
      if (player.upgradeHeld) return idle;
      return { ...idle, upgrade: true };
    }
    if (!player.bag.length && !invest) player.botSale = null;
    const fulfillOrder = player.bag.length > 0 && this.stations.some(station => this.quote(player, station).orderBonus > 0);
    const returnNow = player.botSale || invest || fulfillOrder || player.bag.length >= 4 || this.botShouldBankLayer(player) ||
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
      return this.travel(player, aimAt(this.eyes(player), station), true);
    }

    const availableToBot = d => d && (this.perceivedOre(player, d).hp || d.announced) && d.ore.minLevel <= player.pickLevel &&
      (this.starterUntil.get(d.id) || 0) <= this.time;
    const reconsider = this.time >= player.botPlanAt;
    if (!availableToBot(player.botTarget) || reconsider) {
      if (this.time < player.botPickAt) return idle;
      player.botPickAt = this.time + .4;
      player.botPlanAt = this.time + 2 + this.random() * 1.2;
      const candidates = this.deposits.filter(d => availableToBot(d) && d.approaches.length)
        .map(d => ({ d, rank: this.botMiningRank(player, d) + this.random() * .07 }))
        .filter(item => Number.isFinite(item.rank)).sort((a, b) => b.rank - a.rank);
      const current = player.botTarget;
      const currentRank = availableToBot(current) ? this.botMiningRank(player, current) : -Infinity;
      // Finish a promising current seam; change course only for a meaningful improvement.
      const best = candidates[0];
      if (!best || !current || best.rank > currentRank * 1.18) {
        player.botTarget = null;
        for (const { d } of candidates) {
          if (!this.planRoute(player, d.id, this.miningPositions(player, d))) continue;
          player.botTarget = d;
          break;
        }
      }
    }
    const target = player.botTarget;
    if (!target) return idle;
    if (player.goal && distance(player, player.goal) < .5 &&
      [...this.players.values()].some(other => other !== player && distance(other, player) < .85)) {
      player.goal = null;
      if (!this.planRoute(player, target.id, this.miningPositions(player, target))) {
        player.botTarget = null;
        return idle;
      }
    }
    const eye = this.eyes(player);
    const body = { x: target.x, y: target.y + target.height * .66, z: target.z };
    if (distance(player, player.goal) > .35) {
      player.botStrikeAt = this.time + .28;
      return this.travel(player, aimAt(eye, body), false);
    }
    if (target.announced && !target.active)
      return { ...idle, ax: Math.sin(player.yaw), az: Math.cos(player.yaw) };
    const fire = this.time >= player.botStrikeAt;
    const point = fire && this.random() < .35 ? target.weak : body;
    if (fire) player.botStrikeAt = this.time + this.picks[player.pickLevel - 1].hitCooldown + .65 + this.random() * .4;
    const aim = aimAt(eye, point);
    return { ...idle, ax: aim.x, ay: aim.y, az: aim.z, fire };
  }

  tick(dt) {
    this.time += dt;
    if (this.phase === 'finished') {
      this.resultTimeLeft = Math.max(0, this.resultTimeLeft - dt);
      if (this.resultTimeLeft <= 1e-9) this.resetRound();
      return;
    }
    this.events = this.events.filter(event => event.expires > this.time);
    this.updateRareSites();
    tickSceneryMining(this);
    for (const deposit of this.deposits) {
      if (deposit.kind !== 'gold' && !deposit.hp && deposit.regenAt <= this.time) {
        deposit.hp = deposit.ore.hp;
        deposit.looseCount = 0;
        deposit.weak = deposit.startingWeak;
        deposit.result = null;
        deposit.contested = false;
      }
      if (this.time - deposit.minedAt > 1.5) deposit.minerId = '';
    }

    const actions = [];
    for (const player of this.players.values()) {
      const fresh = this.time - player.lastInputAt <= .6;
      if (!fresh && !player.bot) cancelBowDraw(player);
      let input = player.bot ? this.botInput(player) : fresh ? player.input : { ...idle,
        ax: Math.sin(player.yaw), az: Math.cos(player.yaw) };
      if (fresh && player.pendingFire) input = { ...input, ...player.pendingFire, fire: true };
      player.pendingFire = false;
      actions.push({ player, input, moving: this.move(player, input, dt) });
    }
    for (const { player } of actions) recordCombatPose(this, player);
    // Resolve action ranges using everyone's movement for this tick.
    for (const { player, input, moving } of actions) {
      // Buffered E leaves mining available on the route. A loaded, in-range
      // delivery owns this tick, including clicks queued just before entry.
      const trading = input.sell && !input.upgrade && player.bag.length > 0 && this.stationAt(player, 'radius');
      const attacks = player.pendingAttacks.splice(0).filter(attack =>
        attack.queuedAt === undefined || attack.queuedAt >= this.time - MELEE.rewindSeconds - 1e-9);
      const shots = player.pendingShots.splice(0);
      if (!trading) for (const shot of shots) launchBolt(this, player, shot);
      const pressed = attacks.length > 0 || shots.length > 0;
      if (!trading) for (const attack of attacks) {
        // A queued press retains its own aim and eyes, even if release/look input followed before the tick.
        this.strike(player, attack);
      }
      if (!trading && player.weapon === 'pick' && input.fire && this.time + 1e-9 >= player.nextStrike) {
        this.strike(player, input);
        // Real mining branches spend the pick cooldown. A mining-only pulse
        // into empty air must not delay a newly acquired rock on the next tick.
        if (!input.miningOnly)
          player.nextStrike = Math.max(player.nextStrike, this.time + this.picks[player.pickLevel - 1].hitCooldown);
      }
      const actionInput = trading ? { ...input, fire: false } : pressed ? { ...input, fire: true } : input;
      this.sell(player, actionInput, moving, dt);
      this.upgrade(player, actionInput, moving, dt);
    }
    tickBolts(this, dt);
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 1e-9) {
      this.timeLeft = 0;
      this.phase = 'finished'; this.bolts = [];
      for (const p of this.players.values()) cancelBowDraw(p);
      this.resultTimeLeft = RULES.resultSeconds;
      this.freezeStandings();
    }
  }

  // A suspended/overloaded process cannot replay seconds of old inputs. Expire wall-clock
  // timers without granting movement, strikes or hold progress for ticks never simulated.
  advanceClock(seconds) {
    // Do not replay projectile flight/damage through an unobserved overload gap.
    this.bolts = [];
    for (const p of this.players.values()) { p.pendingShots = []; cancelBowDraw(p); }
    while (seconds > 1e-9) {
      const remaining = this.phase === 'playing' ? this.timeLeft : this.resultTimeLeft;
      const elapsed = Math.min(seconds, remaining);
      this.time += elapsed;
      seconds -= elapsed;
      if (this.phase === 'playing') {
        this.timeLeft = Math.max(0, this.timeLeft - elapsed);
        if (this.timeLeft <= 1e-9) {
          this.timeLeft = 0; this.phase = 'finished'; this.resultTimeLeft = RULES.resultSeconds;
          this.freezeStandings();
        }
      } else {
        this.resultTimeLeft = Math.max(0, this.resultTimeLeft - elapsed);
        if (this.resultTimeLeft <= 1e-9) this.resetRound();
      }
    }
    this.events = this.events.filter(event => event.expires > this.time);
  }

  freezeStandings() {
    const ordered = [...this.players.values()].sort((a, b) => b.score - a.score || a.joinOrder - b.joinOrder);
    let rank = 0, previousScore = null;
    this.standings = Object.freeze(ordered.map((p, index) => {
      if (p.score !== previousScore) rank = index + 1;
      previousScore = p.score;
      return Object.freeze({ rank, id: p.id, name: p.name, bot: p.bot, pickLevel: p.pickLevel,
        grossSales: p.grossSales, investmentSpent: p.investmentSpent, score: p.score,
        goldSold: p.goldSold, ordersCompleted: p.ordersCompleted, orderEarnings: p.orderEarnings,
        inventoryCount: p.bag.length, inventoryValue: this.bagValue(p) });
    }));
    this.winners = Object.freeze(this.standings.filter(p => p.rank === 1)
      .map(({ id, name, score }) => Object.freeze({ id, name, score })));
  }

  snapshot(viewerId) {
    const elapsed = this.roundSeconds - this.timeLeft;
    const stations = this.stations.map(({ index, ...station }) => {
      const current = this.orderAt(this.stations[index]);
      const remaining = Math.max(0, current.until - elapsed);
      const next = remaining <= orderPreviewSeconds && current.until < this.roundSeconds
        ? this.orderAt(this.stations[index], remaining + .01) : null;
      return { ...station, orderKind: current.kind, orderBonus: current.bonus, orderSeconds: remaining,
        orderId: current.id, orderQuantity: current.quantity, orderReward: current.reward,
        orderAvailable: current.available, orderClaimantId: current.claimantId, orderClaimantName: current.claimantName,
        nextOrderKind: next?.kind || '', nextOrderBonus: next?.bonus || 0,
        nextOrderId: next?.id || '', nextOrderQuantity: next?.quantity || 0, nextOrderReward: next?.reward || 0 };
    });
    const players = [...this.players.values()].map(p => {
      const { id, name, bot, x, y, z, yaw, score, stamina, sprinting, sellProgress } = p;
      const inventory = [...this.ores.keys()].flatMap(kind => {
        const count = p.bag.filter(item => item === kind).length;
        return count ? [{ kind, count }] : [];
      });
      const inventoryValue = this.bagValue(p);
      const saleQuotes = this.stations.map(station => this.quote(p, station, this.orderAt(station), inventoryValue));
      const saleStation = p.sale && this.stations.find(s => s.id === p.sale.stationId);
      return { id, name, bot, x, y, z, yaw, score, inventory, inventoryCount: p.bag.length,
        weapon: p.weapon, bowDrawing: p.bowDrawing, bowDrawStartedAt: p.bowDrawStartedAt,
        motionSeq: p.motionSeq, correctionId: p.correctionId,
        correctionX: p.correctionX, correctionY: p.correctionY, correctionZ: p.correctionZ,
        impulseId: p.impulseId, impulseX: p.impulseX, impulseY: p.impulseY, impulseZ: p.impulseZ,
        velocityX: p.velocityX, velocityY: p.velocityY, velocityZ: p.velocityZ, grounded: p.grounded,
        sprintSuppressed: p.sprintSuppressed,
        inventoryValue, stamina, sprinting, sellProgress,
        sellValue: saleStation ? p.sale.normalValue + this.saleOrderBonus(p, saleStation) : 0,
        sellNormalValue: saleStation ? p.sale.normalValue : 0,
        sellOrderBonus: saleStation ? this.saleOrderBonus(p, saleStation) : 0,
        sellOrderLost: Boolean(saleStation && p.sale.orderBonus > 0 && !this.saleOrderBonus(p, saleStation)), saleQuotes,
        pickLevel: p.pickLevel, grossSales: p.grossSales, investmentSpent: p.investmentSpent,
        goldSold: p.goldSold, ordersCompleted: p.ordersCompleted, orderEarnings: p.orderEarnings,
        orderReady: this.orderReady(p), joinedLate: p.joinedLate, upgradeProgress: p.upgradeProgress, upgradeHeld: p.upgradeHeld,
        upgradeCost: this.nextPick(p)?.cost || 0,
        upgradeReady: this.phase === 'playing' && Boolean(this.stationAt(p, 'radius')) && Boolean(this.nextPick(p)) && p.score >= this.nextPick(p).cost,
        stationId: this.stationAt(p, 'radius')?.id || '', protected: Boolean(this.stationAt(p, 'safeRadius')),
        invuln: 0, hurtUntil: p.hurtUntil || 0 };
    });
    const deposits = this.deposits.map(({ id, kind, x, y, z, hp, ore, weak, regenAt, minerId, active, expiresAt, announced, opensAt, layer, looseCount }) => ({
      id, kind, x, y, z, weakX: weak.x, weakY: weak.y, weakZ: weak.z, hp, looseCount,
      maxHp: this.goldLayers && kind === 'gold' ? this.goldLayers[announced ? 0 : Math.max(0, layer - 1)] : ore.hp,
      ...(this.goldLayers && kind === 'gold' ? { layer: announced ? 1 : layer, layerCount: 2,
        remainingYield: announced ? 2 : hp ? 3 - layer : 0 } : {}),
      respawnIn: kind === 'gold' || hp ? 0 : Math.max(0, regenAt - this.time), minerId,
      active, announced, opensIn: announced ? Math.max(0, opensAt - this.time) : 0, minLevel: ore.minLevel, availableIn: active ? 0 : Math.max(0, this.nextRareAt - this.time),
      expiresIn: active && kind === 'gold' ? Math.max(0, expiresAt - this.time) : 0,
    }));
    return { type: 'state', serverTime: this.time, players, deposits, stations, bow: BOW, bolts: boltSnapshot(this), scenery: sceneryMiningSnapshot(this), picks: this.picks,
      ...(this.goldLayers ? { goldLayers: this.goldLayers } : {}), localClaims: this.localClaims(viewerId),
      rareNextIn: Math.max(0, Math.min(this.timeLeft, this.nextRareAt - this.time)),
      events: this.events.filter(e => e.expires > this.time).map(({ expires, ...event }) => event),
      timeLeft: this.timeLeft, round: this.round, phase: this.phase, worldId: this.valley.data.id,
      resultTimeLeft: this.resultTimeLeft, winners: this.winners, standings: this.standings };
  }
}
