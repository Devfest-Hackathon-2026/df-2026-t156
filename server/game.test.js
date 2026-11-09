import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { World, RULES } from './game.js';
import { createGameServer } from './index.js';
import { Valley, VALLEY, terrain } from './valley.js';
const fixtureDeposit = { ...VALLEY.deposits[0], x: 15, z: 0 };
const flat = new Valley({
  ...VALLEY, heights: VALLEY.heights.map(() => 0), colliders: [], deposits: [fixtureDeposit],
});

function place(world, player, x, z) {
  Object.assign(player, { x, z, y: world.valley.height(x, z) });
}

function aim(world, player, target, flags = {}) {
  const eye = world.eyes(player);
  const x = target.x - eye.x, y = target.y - eye.y, z = target.z - eye.z;
  const length = Math.hypot(x, y, z);
  world.input(player.id, { ax: x / length, ay: y / length, az: z / length, ...flags });
}

function advance(world, seconds) {
  for (let i = 0; i < Math.round(seconds * 20); i++) world.tick(.05);
}

test('candidate ore knowledge observes nearby exposed seams and remembers rather than reads hidden state', () => {
  const w = new World({ bots: false, valley: flat, botKnowledge: true, secondPickCost: 32 });
  const p = w.addPlayer('observer', 'Observer'), d = w.deposits[0];
  place(w, p, -30, 0);
  d.hp = 0; d.regenAt = 10;
  w.observeOre(p);
  assert.equal(p.botOreMemory.size, 0);
  assert.equal(w.perceivedOre(p, d).hp, d.ore.hp);
  place(w, p, 10, 0);
  w.observeOre(p);
  assert.equal(w.perceivedOre(p, d).hp, 0);
  place(w, p, -30, 0);
  d.hp = d.ore.hp; d.regenAt = 50;
  w.observeOre(p);
  assert.equal(w.perceivedOre(p, d).hp, 0);
  w.time = 11;
  assert.equal(w.perceivedOre(p, d).hp, d.ore.hp);
  d.hp = 1;
  place(w, p, 10, 0);
  w.observeOre(p);
  assert.equal(w.perceivedOre(p, d).hp, 1);
  place(w, p, -30, 0);
  d.hp = 0;
  assert.equal(w.perceivedOre(p, d).hp, 1);
  p.pickLevel = 2;
  assert.equal(w.snapshot(p.id).players[0].upgradeCost, 32);
  assert.equal(w.snapshot(p.id).picks[2].cost, 32);
  assert.equal(VALLEY.picks[2].cost, 12);
  w.resetRound();
  assert.equal(p.botOreMemory.size, 0);
});

test('candidate ore observation cannot read through cover', () => {
  const valley = new Valley({ ...flat.data, colliders: [
    { id: 'wall', kind: 'rock', x: 10, z: 0, radius: 2, height: 4 },
  ] });
  const w = new World({ bots: false, valley, botKnowledge: true });
  const p = w.addPlayer('observer', 'Observer'), d = w.deposits[0];
  place(w, p, 5, 0); d.hp = 0; d.regenAt = 10;
  w.observeOre(p);
  assert.equal(p.botOreMemory.size, 0);
  assert.equal(w.perceivedOre(p, d).hp, d.ore.hp);
});

function tap(world, player, target) {
  aim(world, player, target, { fire: true });
  world.tick(.05);
  aim(world, player, target);
}

test('ordinary and precise pick hits, short taps, capacity, depletion and regeneration', () => {
  const w = new World({ bots: false, valley: flat });
  const a = w.addPlayer('a', 'A');
  const d = w.deposits[0];
  place(w, a, 13, 0);
  const body = { x: d.x, y: .5, z: d.z };
  const fire = { fire: true };
  aim(w, a, body, fire);
  aim(w, a, body);
  w.tick(.05);
  assert.equal(d.hp, 2, 'ordinary hit works even when press and release arrive before the tick');
  assert.equal(w.snapshot().deposits[0].minerId, a.id);
  tap(w, a, d.weak);
  assert.equal(d.hp, 2, 'strike cadence is server-enforced');
  advance(w, .7);
  a.bag = Array(w.config.capacity).fill('copper');
  tap(w, a, d.weak);
  assert.equal(d.hp, 2);
  assert.equal(w.snapshot().events.at(-1).type, 'full');
  advance(w, .7);
  a.bag = ['copper'];
  tap(w, a, d.weak);
  assert.equal(d.hp, 0);
  assert.deepEqual(w.snapshot().events.slice(-2).map(e => e.type), ['weak', 'harvest']);
  assert.deepEqual(w.snapshot().players[0].inventory, [{ kind: 'copper', count: 3 }]);
  assert.ok(w.snapshot().deposits[0].respawnIn > d.ore.respawnSeconds - .1);
  assert.equal(flat.blocked(d.x, d.z), true, 'stripped deposit is still solid');
  advance(w, 10.05);
  assert.equal(d.hp, d.ore.hp);
});

test('a visible fracture moves after a hit, and following it keeps the precision bonus', () => {
  const valley = new Valley({ ...flat.data, ores: flat.data.ores.map(ore => ore.id === 'crystal' ? { ...ore, hp: 5, minLevel: 1 } : ore), deposits: [{ ...fixtureDeposit, kind: 'crystal' }] });
  const w = new World({ bots: false, valley });
  const a = w.addPlayer('a', 'A'), d = w.deposits[0];
  place(w, a, 13, 0);
  const startingWeak = d.weak;
  tap(w, a, startingWeak);
  assert.equal(d.hp, 3);
  assert.notDeepEqual(d.weak, startingWeak);
  assert.equal(d.weak.y, startingWeak.y);
  assert.ok(Math.hypot(d.weak.x - d.x, d.weak.z - d.z) < d.radius);
  advance(w, .7);
  tap(w, a, startingWeak);
  assert.equal(d.hp, 2, 'holding the original aim now hits the rock only');
  advance(w, .7);
  tap(w, a, d.weak);
  assert.equal(d.hp, 0, 'following the fracture deals two damage again');
});

test('the strongest contributing miner keeps the ore when someone else lands the last hit', () => {
  const w = new World({ bots: false, valley: flat });
  const a = w.addPlayer('a', 'A'), b = w.addPlayer('b', 'B'), d = w.deposits[0];
  place(w, a, 13, 0);
  place(w, b, 17, 0);
  tap(w, a, d.weak);
  assert.equal(d.hp, 1);
  tap(w, b, d.weak);
  assert.equal(d.hp, 0);
  assert.equal(a.bag.length, 2);
  assert.equal(b.bag.length, 0);
  assert.equal(w.snapshot().events.at(-1).actorId, a.id);
});

test('pick misses outside reach and cannot strike a seam or another player through a rock', () => {
  const w = new World({ bots: false, valley: flat });
  const a = w.addPlayer('a', 'A');
  const d = w.deposits[0];
  place(w, a, 10, 0);
  tap(w, a, d.weak);
  assert.equal(d.hp, 3);
  const rock = { x: 13.8, z: 0, radius: .25, height: 3 };
  const cover = new Valley({ ...flat.data, colliders: [rock, { ...rock, z: 5 }] });
  const blocked = new World({ bots: false, valley: cover });
  const miner = blocked.addPlayer('a', 'A'), rival = blocked.addPlayer('b', 'B');
  place(blocked, miner, 13, 0);
  tap(blocked, miner, blocked.deposits[0].weak);
  assert.equal(blocked.deposits[0].hp, 3);
  advance(blocked, .7);
  place(blocked, miner, 13, 5);
  place(blocked, rival, 14.6, 5);
  rival.bag = ['copper', 'silver'];
  tap(blocked, miner, blocked.eyes(rival));
  assert.equal(rival.bag.length, 2);
});

test('all three sell circles protect both sides of the boundary, and a hit outside only steals one', () => {
  const w = new World({ bots: false, valley: flat });
  const a = w.addPlayer('a', 'A'), b = w.addPlayer('b', 'B');
  b.bag = ['copper', 'silver', 'crystal'];
  for (const s of w.stations) {
    for (const attackerInside of [false, true]) {
      place(w, a, s.x, s.z + s.safeRadius + (attackerInside ? -.1 : .9));
      place(w, b, s.x, s.z + s.safeRadius + (attackerInside ? .9 : -.1));
      tap(w, a, w.eyes(b));
      assert.equal(b.bag.length, 3, s.id);
      advance(w, .7);
    }
  }

  place(w, a, 20, -5);
  place(w, b, 21, -5);
  tap(w, a, w.eyes(b));
  assert.deepEqual(a.bag, ['crystal']);
  assert.equal(b.bag.length, 2);
  advance(w, .7);
  // Full legacy knockback carries the victim out of reach; isolate the theft
  // window by returning both actors to the same one-metre fixture distance.
  place(w, a, 20, -5); place(w, b, 21, -5);
  Object.assign(b, { motionVX: 0, motionVY: 0, motionVZ: 0, grounded: true });
  tap(w, a, w.eyes(b));
  assert.equal(b.bag.length, 1, 'the next accepted hit transfers one unit');
  advance(w, 1.85);
  place(w, a, 20, -5); place(w, b, 21, -5);
  Object.assign(b, { motionVX: 0, motionVY: 0, motionVZ: 0, grounded: true });
  tap(w, a, w.eyes(b));
  assert.equal(b.bag.length, 0, 'the last unit can also be taken');
  advance(w, 2.6);
  tap(w, a, w.eyes(b));
  assert.equal(b.bag.length, 0, 'an empty bag creates no extra ore');
});

test('one shop boundary accepts sales exactly where it protects players and stops bot pursuit', () => {
  const w = new World({ bots: false, valley: flat });
  const p = w.addPlayer('boundary', 'Boundary');
  for (const station of w.stations) {
    assert.equal(station.radius, 4.5);
    assert.equal(station.safeRadius, station.radius, 'wire compatibility alias cannot define a second zone');
    for (const offset of [-.01, 0, .01]) {
      const inside = offset <= 0;
      place(w, p, station.x + station.radius + offset, station.z);
      p.bag = ['copper']; p.score = 0;
      w.input(p.id, { sell: true });
      const view = w.snapshot(p.id).players.find(row => row.id === p.id);
      assert.equal(view.protected, inside);
      assert.equal(view.stationId, inside ? station.id : '');
      assert.equal(w.awayFromTrade(p), !inside);
      for (let i = 0; i < 22; i++) { w.input(p.id, { sell: true }); w.tick(.05); }
      assert.equal(p.bag.length, inside ? 0 : 1);
      assert.equal(p.score > 0, inside);
      w.input(p.id, { sell: false });
    }
  }
});

test('every station pays the same base; moving continues and releasing interrupts a quoted sale', () => {
  const w = new World({ bots: false, valley: flat });
  const player = w.addPlayer('a', 'A');
  const hold = (ticks, packet) => {
    for (let i = 0; i < ticks; i++) {
      w.input(player.id, packet);
      w.tick(.05);
    }
  };
  let total = 0;
  for (const station of w.stations) {
    place(w, player, station.x, station.z);
    player.bag = ['copper', 'silver'];
    const quote = w.snapshot().players[0].saleQuotes.find(q => q.stationId === station.id);
    assert.equal(quote.baseValue, 7);
    hold(10, { sell: true });
    assert.ok(player.sellProgress >= .49);
    assert.equal(player.score, total);
    assert.equal(player.sale.value, quote.value);
    hold(1, { sell: true, x: 1 });
    assert.ok(player.sellProgress > .5);
    hold(3, { sell: true });
    hold(1, {});
    assert.equal(player.sellProgress, 0);
    hold(20, { sell: true });
    total += quote.value;
    assert.equal(player.score, total);
    assert.equal(w.snapshot().events.at(-1).bonus, quote.bonus);
    assert.equal(player.bag.length, 0);
    assert.equal(w.snapshot().events.at(-1).targetId, station.id);
  }
});

test('a shop-wide hot price is locked for the one-second sale across its light switching', () => {
 const w=new World({bots:false,valley:flat}),a=w.addPlayer('a','A'),b=w.addPlayer('b','B'),station=w.stations[0];
 advance(w,29.4);
 for(const p of [a,b]){place(w,p,station.x,station.z);p.bag=['copper','copper'];}
 for(let i=0;i<13;i++){w.input(a.id,{sell:true});w.tick(.05);}
 assert.equal(w.marketAt(station).hot,false);
 assert.equal(w.snapshot(a.id).players[0].sellValue,8);
 assert.equal(w.quote(a,station).value,4);
 for(let i=0;i<31;i++){for(const p of [a,b])w.input(p.id,{sell:true});w.tick(.05);}
 assert.equal(a.score,8);assert.equal(b.score,4);
 w.resetRound();assert.equal(w.snapshot().stations.find(s=>s.hot).id,'west');
});

test('bots compare the visible whole-bag price with the actual return route',()=>{
 const w=new World({bots:false,valley:flat}),p=w.addPlayer('a','A');place(w,p,15.25,2);
 p.bag=['crystal','crystal'];assert.equal(w.chooseBotSale(p).station.id,'central');
 p.bag=['copper','copper'];assert.equal(w.chooseBotSale(p).station.id,'central');
 advance(w,39.5);p.bag=['crystal','crystal'];assert.equal(w.chooseBotSale(p).station.id,'west');
 w.timeLeft=1;assert.equal(w.chooseBotSale(p),null);
});

test('upgrade payments are atomic, require release and reset with the round', () => {
  const w = new World({ bots: false, valley: flat });
  const p = w.addPlayer('a', 'A'), station = w.stations[0];
  place(w, p, station.x, station.z);
  p.score = 80;
  p.grossSales = 80;
  const hold = (ticks, packet) => {
    for (let i = 0; i < ticks; i++) { w.input(p.id, packet); w.tick(.05); }
  };
  hold(20, { upgrade: true });
  assert.ok(p.upgradeProgress > .5);
  hold(1, { upgrade: true, sell: true });
  assert.equal(p.upgradeProgress, 0);
  assert.equal(p.score, 80);
  hold(36, { upgrade: true });
  assert.equal(p.pickLevel, 2);
  assert.equal(p.score, 72);
  hold(50, { upgrade: true });
  assert.equal(p.pickLevel, 2, 'holding Q never buys the next stage too');
  hold(1, {});
  hold(36, { upgrade: true });
  assert.equal(p.pickLevel, 3);
  assert.equal(p.score, 60);
  assert.equal(p.investmentSpent, 20);
  assert.equal(p.grossSales, 80);
  w.resetRound();
  assert.equal(p.pickLevel, 1);
  assert.equal(p.investmentSpent, 0);
  assert.equal(p.grossSales, 0);
  assert.equal(p.upgradeHeld, false);
});

test('upgrade rejects funds, attacks, stale input, leaving station and finished play', () => {
  const w = new World({ bots: false, valley: flat, roundSeconds: 20 });
  const p = w.addPlayer('a', 'A'), station = w.stations[0];
  place(w, p, station.x, station.z);
  for (let i = 0; i < 40; i++) { w.input(p.id, { upgrade: true }); w.tick(.05); }
  assert.equal(p.pickLevel, 1);
  p.score = 8;
  w.input(p.id, { upgrade: true });
  advance(w, .8);
  assert.equal(p.upgradeProgress, 0, 'stale holds cancel');
  assert.equal(p.score, 8);
  place(w, p, station.x + station.radius + .1, station.z);
  for (let i = 0; i < 40; i++) { w.input(p.id, { upgrade: true }); w.tick(.05); }
  assert.equal(p.upgradeProgress, 0);
  place(w, p, station.x, station.z);
  w.input(p.id, { upgrade: true, fire: true });
  w.tick(.05);
  assert.equal(p.upgradeProgress, 0);
  w.timeLeft = .05;
  w.tick(.05);
  for (let i = 0; i < 40; i++) { w.input(p.id, { upgrade: true }); w.tick(.05); }
  assert.equal(p.score, 8);
  assert.equal(p.pickLevel, 1);
});

test('hard ores accept a weak pick and tool investment improves the actual strike', () => {
  let seed = 0;
  const w = new World({ bots: false, random: () => (seed++ % 4) / 4 });
  const p = w.addPlayer('a', 'A');
  const d = w.deposits.find(d => d.kind === 'crystal');
  place(w, p, d.approaches[0].x, d.approaches[0].z);
  tap(w, p, d.weak);
  assert.equal(d.hp, d.ore.hp - 2);
  assert.equal(w.snapshot().events.at(-1).type, 'weak');
  p.pickLevel = 2;
  advance(w, .7);
  tap(w, p, d.weak);
  assert.equal(d.hp, d.ore.hp - 6);

});

test('the gold site is hidden until six seconds before a common opening, using independent randomness', () => {
  const a = new World({ bots: false, random: () => .1, rareRandom: () => .4 });
  const b = new World({ bots: false, random: () => .9, rareRandom: () => .4 });
  for (let i = 0; i < 100; i++) b.random();
  const announced = w => w.snapshot().deposits.filter(d => d.announced);
  advance(a, a.rare.firstAt - a.rare.previewSeconds - .05);
  assert.equal(announced(a).length, 0);
  advance(a, .1);
  advance(b, b.rare.firstAt - b.rare.previewSeconds + .05);
  assert.equal(announced(a).length, 1);
  assert.equal(announced(a)[0].id, announced(b)[0].id);
  assert.equal(announced(a)[0].active, false);
  assert.equal(announced(a)[0].hp, 0);
  assert.ok(Math.abs(announced(a)[0].opensIn - 5.95) < 1e-6);
  const id = announced(a)[0].id;
  advance(a, 6);
  const open = a.snapshot().deposits.find(d => d.id === id);
  assert.equal(open.announced, false);
  assert.equal(open.active, true);
  assert.equal(open.hp, open.maxHp);
  assert.equal('expiresIn' in open,false);
});

test('nearby contributors see eligible leadership and the actual recipient; spectators do not', () => {
  const valley = new Valley({ ...flat.data, ores: flat.data.ores.map(ore =>
    ore.id === 'copper' ? { ...ore, hp: 6 } : ore) });
  const w = new World({ bots: false, valley });
  const a = w.addPlayer('a', 'A'), b = w.addPlayer('b', 'B'), spectator = w.addPlayer('c', 'C');
  const d = w.deposits[0];
  place(w, a, 13, 0); place(w, b, 17, 0); place(w, spectator, 15, 5);
  tap(w, a, d.weak);
  assert.deepEqual(w.snapshot(a.id).localClaims, []);
  assert.deepEqual(w.snapshot(spectator.id).localClaims, []);
  tap(w, b, d.weak);
  assert.equal(w.snapshot(a.id).localClaims[0].contested, true);
  assert.equal(w.snapshot(a.id).localClaims[0].status, 'leading');
  assert.equal(w.snapshot(b.id).localClaims[0].leaderId, a.id, 'earlier contribution wins ties');
  assert.equal(w.snapshot(b.id).localClaims[0].status, 'trailing');
  a.bag = Array(w.config.capacity).fill('copper');
  assert.equal(w.snapshot(a.id).localClaims[0].status, 'bag-full');
  assert.equal(w.snapshot(b.id).localClaims[0].leaderId, b.id);
  a.bag = [];
  place(w, a, 10, 0);
  assert.equal(w.snapshot(a.id).localClaims[0].status, 'too-far');
  place(w, a, 13, 0);
  advance(w, .7);
  tap(w, b, d.weak);
  const own = w.snapshot(b.id).localClaims[0], other = w.snapshot(a.id).localClaims[0];
  assert.equal(own.status, 'received');
  assert.equal(other.status, 'other-received');
  assert.equal(other.leaderId, b.id);
  assert.equal(other.ownDamage, 2);
  assert.equal(other.resultAmount, 2);
  assert.equal(own.resultId, other.resultId);
  place(w, a, 1, 0);
  assert.deepEqual(w.snapshot(a.id).localClaims, []);
  advance(w, 4.1);
  assert.deepEqual(w.snapshot(b.id).localClaims, []);
});

test('a partially mined gold site retains contribution after its former expiry', () => {
  const w = new World({ bots: false });
  const p = w.addPlayer('a', 'A'), other = w.addPlayer('b', 'B'), d = w.deposits.find(d => d.kind === 'gold');
  p.pickLevel = 3;
  Object.assign(d, { active: true, hp: d.ore.hp, expiresAt: 1 });
  place(w, p, d.approaches[0].x, d.approaches[0].z);
  tap(w, p, d.weak);
  other.pickLevel = 3;
  place(w, other, d.approaches[4].x, d.approaches[4].z);
  tap(w, other, d.weak);
  assert.equal(w.snapshot(p.id).localClaims[0].status, 'leading');
  advance(w, 1);
  const claim = w.snapshot(p.id).localClaims[0];
  assert.equal(claim.status, 'leading');
  assert.equal(claim.leaderId,p.id);
  assert.ok(d.hp>0);
});

test('investment can be refused when a visible top-level rival already controls the known gold', () => {
  const valley = new Valley({ ...flat.data, deposits: [
    fixtureDeposit, { ...VALLEY.deposits.find(d => d.kind === 'gold'), id: 'test-gold', x: 12, z: 0 },
  ] });
  const w = new World({ bots: false, valley });
  const p = w.addPlayer('bot-0', 'PICK'), rival = w.addPlayer('human', 'Human');
  Object.assign(p, { pickLevel: 2, score: 44 });
  place(w, p, 0, 0); place(w, rival, 13.8, 0);
  const gold = w.deposits.find(d => d.kind === 'gold');
  Object.assign(gold, { announced: true, opensAt: 50 });
  w.time = 44; w.timeLeft = 136;
  p.botVisibleRivals = [{ id: rival.id, pickLevel: 2, x: rival.x, z: rival.z }];
  assert.equal(w.botShouldInvest(p), true);
  p.botVisibleRivals[0].pickLevel = 3;
  assert.equal(w.botShouldInvest(p), false, 'the closer top-tier rival makes the purchase unattractive');
  gold.announced = false;
  p.botVisibleRivals = [];
  assert.equal(w.botShouldInvest(p), false, 'a cautious miner waits for a public site');
  p.id = 'bot-1';
  assert.equal(w.botShouldInvest(p), false, 'no undisclosed future waves are assumed without an actual target');
  w.timeLeft = 30;
  assert.equal(w.botShouldInvest(p), false);
});

test('a tactical empty bot takes one short-range swing and then breaks off', () => {
  const w = new World({ bots: false, valley: flat, botTactics: true, random: () => .5 });
  const attacker = w.addPlayer('bot-1', 'Bot', true), victim = w.addPlayer('victim', 'V');
  attacker.pickLevel = 3;
  place(w, attacker, 20, -10); place(w, victim, 23, -10);
  victim.bag = ['gold', 'gold'];
  w.considerBotChase(attacker, [{ id: victim.id, inventoryCount: 0 }]);
  assert.equal(attacker.botChase.id, victim.id);
  advance(w, .3);
  assert.deepEqual(attacker.bag, ['gold']);
  assert.deepEqual(victim.bag, ['gold']);
  assert.equal(attacker.botChase, null);
  const steals = w.events.filter(e => e.type === 'steal');
  assert.equal(steals.length, 1);
  assert.equal(steals[0].value, w.ores.get('gold').value);
  attacker.bag = [];
  victim.bag = ['gold', 'gold'];
  w.considerBotChase(attacker, [{ id: victim.id, inventoryCount: 0 }]);
  assert.equal(attacker.botChase, null, 'one encounter has a cooldown');
});

test('tactical pursuit aborts on a sprint escape and rejects valuable own cargo and shop edges', () => {
  const w = new World({ bots: false, valley: flat, botTactics: true, random: () => .5 });
  const attacker = w.addPlayer('bot-1', 'Bot', true), victim = w.addPlayer('victim', 'V');
  attacker.pickLevel = 3;
  place(w, attacker, 20, -10); place(w, victim, 24, -10);
  victim.bag = ['gold', 'gold'];
  w.considerBotChase(attacker, [{ id: victim.id, inventoryCount: 0 }]);
  for (let i = 0; i < 50; i++) {
    w.input(victim.id, { x: 1, sprint: true });
    w.tick(.05);
  }
  assert.equal(victim.bag.length, 2);
  assert.equal(attacker.botChase, null);
  assert.ok(attacker.botChaseCooldown > w.time);
  attacker.botChaseCooldown = 0;
  attacker.botAttempted.clear();
  attacker.bag = ['crystal'];
  attacker.route = [{ x: attacker.x - 5, z: attacker.z }];
  w.considerBotChase(attacker, [{ id: victim.id, inventoryCount: 0 }]);
  assert.equal(attacker.botChase, null);
  attacker.bag = [];
  const shop = w.stations[0];
  place(w, attacker, shop.x, shop.z + shop.radius + 2.9);
  place(w, victim, shop.x, shop.z + shop.radius - .1);
  w.considerBotChase(attacker, [{ id: victim.id, inventoryCount: 0 }]);
  assert.equal(attacker.botChase, null, 'does not initiate attacks at the safe perimeter');
});

test('1.8 sprint has no stamina limit and stale legacy input stops movement', () => {
  const w = new World({ bots: false, valley: flat });
  const player = w.addPlayer('a', 'A');
  place(w, player, -45, -40);
  const hold = (ticks, packet) => {
    for (let i = 0; i < ticks; i++) {
      w.input(player.id, packet);
      w.tick(.05);
    }
  };
  hold(80, { x: 1, sprint: true });
  const acceleration = 2.548, drag = .546;
  const travelled = acceleration / (1 - drag) * (4 - .05 * drag * (1 - drag ** 80) / (1 - drag));
  assert.ok(Math.abs(player.x - (-45 + travelled)) < 1e-6, 'ground acceleration settles into the legacy sprint speed');
  assert.equal(player.stamina, 1);
  hold(40, { x: 1, sprint: true });
  assert.equal(player.sprinting, true);
  hold(1, {});
  hold(1, { x: 1, sprint: true });
  assert.equal(player.sprinting, true);
  advance(w, 1.05); // stale input expires at .6s, then the carried ground motion settles
  const x = player.x;
  advance(w, 1);
  assert.equal(player.x, x);
  assert.equal(player.y, 0);
});

test('every authored seam has reachable weak points, no stations overlap and mining starts in view', () => {
  const w = new World({ bots: false });
  assert.equal(w.deposits.length, 27);
  for (const deposit of w.deposits) {
    assert.ok(deposit.approaches.length >= 6, deposit.id);
    assert.ok(terrain.blocked(deposit.x, deposit.z), deposit.id);
    for (const station of w.stations)
      assert.ok(Math.hypot(deposit.x - station.x, deposit.z - station.z) > station.safeRadius + 3, deposit.id);
  }
  for (let i = 0; i < 8; i++) {
    const p = w.addPlayer(String(i), 'Test');
    const d = w.deposits[i];
    const gap = Math.hypot(p.x - d.x, p.z - d.z);
    assert.ok(gap >= 1.8 && gap <= 5.5, d.id);
    const dir = { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
    assert.ok((d.x - p.x) * dir.x + (d.z - p.z) * dir.z > 1, 'facing first copper');
  }
});

test('bots leave the human starting vein intact for the initial fifteen seconds', () => {
  const w = new World();
  w.addPlayer('human', 'H');
  const starter = w.deposits[0];
  advance(w, 14.95);
  assert.equal(starter.hp, starter.ore.hp);
  assert.ok([...w.players.values()].filter(p => p.bot).every(p => p.botTarget !== starter));
  assert.ok(w.starterUntil.get(starter.id) > w.time);
  advance(w, .1);
  assert.ok(w.starterUntil.get(starter.id) <= w.time);
});

test('bots mine and sell in three real terrain rounds; the result resets on rematch', () => {
  for (let seed of [7, 77, 777]) {
    const random = () => ((seed = seed * 16807 % 2147483647) - 1) / 2147483646;
    const w = new World({ random, rareRandom: () => .6 });
    w.addPlayer('human', 'H');
    const visited = new Set();
    for (let i = 0; i < 3600; i++) {
      w.tick(.05);
      for (const event of w.events) if (event.type === 'sold') visited.add(event.targetId);
    }
    const bots = [...w.players.values()].filter(p => p.bot);
    assert.ok(bots.every(p => p.grossSales > 0), JSON.stringify(bots.map(p => p.score)));
    assert.ok(visited.size >= 2, JSON.stringify([...visited]));
    assert.equal(w.phase, 'finished');
    assert.equal(w.winners[0].score, Math.max(...bots.map(p => p.score)));
    const round = w.round;
    w.tick(RULES.resultSeconds);
    assert.equal(w.round, round + 1);
    assert.equal(w.phase, 'playing');
    assert.ok(bots.every(p => p.score === 0 && p.bag.length === 0));
    w.addPlayer('human2', 'P2');
    assert.equal([...w.players.values()].filter(p => p.bot).length, 1);
    w.addPlayer('human3', 'P3');
    assert.equal([...w.players.values()].filter(p => p.bot).length, 0);
  }
});

test('shared valley bilinear height, cylinder movement, cover height and bot detour', () => {
  const x = VALLEY.originX + VALLEY.cellSize * 3.5, z = VALLEY.originZ + VALLEY.cellSize * 4.5;
  const index = 4 * VALLEY.columns + 3;
  const expected = (VALLEY.heights[index] + VALLEY.heights[index + 1] +
    VALLEY.heights[index + VALLEY.columns] + VALLEY.heights[index + VALLEY.columns + 1]) / 4;
  assert.ok(Math.abs(terrain.height(x, z) - expected) < 1e-9);
  const cover = new Valley({ ...flat.data,
    colliders: [{ id: 'cover', kind: 'trunk', x: 0, z: 0, radius: 2, height: 3 }] });
  assert.ok(cover.move({ x: -4, z: 0 }, 10, 0).x <= -2 - VALLEY.playerRadius + 1e-6);
  assert.equal(cover.rayDistance({ x: -4, y: 1.65, z: 0 }, { x: 1, y: 0, z: 0 }, 10), 2);
  assert.equal(cover.rayDistance({ x: -4, y: 5, z: 0 }, { x: 1, y: 0, z: 0 }, 10), 10);
  const route = cover.path({ x: -5, z: 0 }, { x: 5, z: 0 });
  assert.ok(route.length > 1);
  let at = { x: -5, z: 0 };
  for (const waypoint of route) { assert.ok(cover.walkClear(at, waypoint)); at = waypoint; }
});

function receive(socket, predicate, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', onMessage); reject(new Error('Expected packet timed out')); }, timeout);
    const onMessage = data => {
      const message = JSON.parse(data.toString());
      if (predicate(message)) { clearTimeout(timer); socket.off('message', onMessage); resolve(message); }
    };
    socket.on('message', onMessage);
  });
}

test('two browser-compatible sockets share movement, departures and static Unity MIME types', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'orbit-salvage-'));
  await writeFile(path.join(dir, 'index.html'), '<h1>Unity build fixture</h1>');
  await writeFile(path.join(dir, 'test.wasm.gz'), Buffer.from([1, 2, 3]));
  const app = createGameServer({ staticDir: dir, world: new World({ bots: false }) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.stop(); await rm(dir, { recursive: true, force: true }); });
  const port = app.server.address().port;
  const a = new WebSocket(`ws://127.0.0.1:${port}/ws`), b = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await Promise.all([once(a, 'open'), once(b, 'open')]);
  const wa = receive(a, p => p.type === 'welcome'), wb = receive(b, p => p.type === 'welcome');
  a.send(JSON.stringify({ type: 'join', name: 'Alpha' }));
  b.send(JSON.stringify({ type: 'join', name: 'Beta' }));
  const [{ id: aid }, { id: bid }] = await Promise.all([wa, wb]);
  const before = await receive(b, p => p.type === 'state' && p.players.length === 2);
  const start = before.players.find(p => p.id === aid).x;
  const moved = receive(b, p => p.type === 'state' && p.players.find(p => p.id === aid)?.x > start + 0.1);
  a.send(JSON.stringify({ type: 'input', x: 1, z: 0, y: 0, ax: 0, ay: 0, az: 1, fire: false }));
  await moved;
  const deposit = app.world.deposits[0];
  const pa = app.world.players.get(aid), pb = app.world.players.get(bid);
  place(app.world, pa, deposit.approaches[0].x, deposit.approaches[0].z);
  place(app.world, pb, deposit.approaches[4].x, deposit.approaches[4].z);
  const packet = player => {
    const eye = app.world.eyes(player), point = deposit.weak;
    const x = point.x - eye.x, y = point.y - eye.y, z = point.z - eye.z;
    const len = Math.hypot(x, y, z);
    return JSON.stringify({ type: 'input', ax: x / len, ay: y / len, az: z / len, fire: true });
  };
  const firstHit = receive(b, s => s.type === 'state' && s.deposits[0].hp === 1);
  a.send(packet(pa));
  await firstHit;
  a.send(JSON.stringify({ type: 'input' }));
  const claimA = receive(a, s => s.type === 'state' && s.localClaims[0]?.status === 'received');
  const claimB = receive(b, s => s.type === 'state' && s.localClaims[0]?.status === 'other-received');
  b.send(packet(pb));
  const [stateA, stateB] = await Promise.all([claimA, claimB]);
  assert.equal(stateA.localClaims[0].leaderId, aid);
  assert.equal(stateB.localClaims[0].leaderId, aid);
  assert.equal(stateA.localClaims[0].resultId, stateB.localClaims[0].resultId);
  b.send(JSON.stringify({ type: 'input' }));
  const left = receive(b, p => p.type === 'state' && p.players.length === 1);
  a.close();
  await left;
  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Unity build fixture/);
  // HEAD avoids decompression of the deliberately small fixture.
  const wasm = await fetch(`http://127.0.0.1:${port}/test.wasm.gz`, { method: 'HEAD' });
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.equal(wasm.headers.get('content-encoding'), 'gzip');
  const health = await fetch(`http://127.0.0.1:${port}/health`).then(r => r.json());
  assert.equal(health.players, 1);
  b.close();
});
