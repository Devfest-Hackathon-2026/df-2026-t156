import test from 'node:test';
import assert from 'node:assert/strict';
import { World, RULES } from './game.js';

function advance(world, seconds, player = null, input = {}) {
  for (let i = 0; i < Math.round(seconds * 20); i++) {
    if (player) world.input(player.id, input);
    world.tick(.05);
  }
}

test('normal World uses all adopted rules without experimental environment switches', () => {
  const w = new World();
  assert.deepEqual(w.picks.map(p => p.cost), [0, 8, 12, 18, 24, 32, 44, 60]);
  assert.deepEqual(w.goldLayers, [12, 36]);
  assert.equal(w.botKnowledge, true);
  assert.equal(w.botTactics, true);
  assert.equal(w.rare.previewSeconds, 6);
  assert.equal(w.rareHintSeconds, undefined);
  assert.equal(w.snapshot().rareForecast, undefined);
  assert.deepEqual(w.snapshot().standings, []);
});

test('completed sales count actual gold and final standings freeze accounting, ties and identity', () => {
  const w = new World({ bots: false, roundSeconds: 3 });
  const a = w.addPlayer('a', ''), b = w.addPlayer('b', '旅人'), c = w.addPlayer('c', 'C');
  const station = w.stations[0];
  Object.assign(a, { x: station.x, y: station.y, z: station.z,
    pickLevel: 3, score: 6, grossSales: 44, investmentSpent: 38, bag: ['gold', 'crystal'] });
  Object.assign(b, { score: 46, grossSales: 54, investmentSpent: 8, pickLevel: 2 });
  c.score = 5;
  assert.equal(a.name, '旅人'); assert.equal(b.name, '旅人 2');
  advance(w, .25, a, { sell: true });
  assert.equal(a.goldSold, 0);
  advance(w, .05, a);
  assert.equal(a.sellProgress, 0);
  advance(w, 1.6, a, { sell: true });
  assert.equal(a.goldSold, 1); assert.equal(a.score, 46);
  a.bag = ['gold'];
  advance(w, 1.1);
  assert.equal(w.phase, 'finished');
  const fixed = structuredClone(w.snapshot(a.id).standings);
  assert.deepEqual(fixed.map(p => p.rank), [1, 1, 3]);
  assert.deepEqual(fixed[0], { rank: 1, id: 'a', name: '旅人', bot: false, pickLevel: 3,
    grossSales: 84, investmentSpent: 38, score: 46, goldSold: 1, ordersCompleted: 0, orderEarnings: 0,
    inventoryCount: 1, inventoryValue: 28 });
  assert.ok(Object.isFrozen(w.standings) && Object.isFrozen(w.standings[0]));
  a.score = 999; a.name = 'Changed';
  assert.deepEqual(w.snapshot().standings, fixed);
  assert.deepEqual(w.winners.map(p => p.name), ['旅人', '旅人 2']);
  const late = w.addPlayer('late', '旅人');
  assert.equal(w.phase, 'finished');
  assert.equal(late.goldSold, 0);
  assert.ok(!w.standings.some(p => p.id === late.id));
  for (const id of [...w.players.keys()]) w.removePlayer(id);
  assert.equal(w.phase, 'finished');
  assert.deepEqual(w.standings, fixed);
  advance(w, RULES.resultSeconds);
  assert.equal(w.phase, 'playing'); assert.equal(w.timeLeft, 3);
  assert.deepEqual(w.standings, []);
  const next = w.addPlayer('next', '旅人');
  assert.equal(next.name, '旅人'); assert.equal(next.joinedLate, false);
  assert.equal(next.goldSold, 0); assert.equal(next.pickLevel, 1);
});

test('frozen rows retain BOT identity after live participants leave', () => {
  const w = new World();
  w.addPlayer('human', '旅人');
  w.timeLeft = .05; w.tick(.05);
  const fixed = structuredClone(w.standings);
  assert.equal(fixed.find(p => p.id === 'human').bot, false);
  assert.equal(fixed.filter(p => p.bot).length, 2);
  w.removePlayer('human');
  assert.equal(w.players.size, 0);
  assert.deepEqual(w.standings, fixed);
});

test('display names stay stable and reserved through a round; late play and rematch are distinguished', () => {
  const w = new World({ bots: false });
  const a = w.addPlayer('a', 'A'), b = w.addPlayer('b', 'A');
  assert.equal(a.name, 'A'); assert.equal(b.name, 'A 2');
  const literal = w.addPlayer('literal', 'A 2');
  assert.notEqual(literal.name, b.name);
  w.removePlayer(a.id);
  const again = w.addPlayer('again', 'A');
  assert.equal(again.name, 'A 3'); assert.equal(b.name, 'A 2');
  advance(w, 5);
  const late = w.addPlayer('late', '<LATE>');
  assert.equal(late.name, 'LATE'); assert.equal(late.joinedLate, true);
  assert.equal(late.score, 0); assert.equal(late.pickLevel, 1);
  assert.ok(Math.abs(w.timeLeft - 175) < 1e-6);
  const names = [...w.players.values()].map(p => p.name);
  w.resetRound();
  assert.deepEqual([...w.players.values()].map(p => p.name), names);
  assert.equal(late.joinedLate, false);
  assert.equal(w.timeLeft, 180);
});
