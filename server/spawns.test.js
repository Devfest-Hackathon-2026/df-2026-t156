import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from './game.js';

test('eight consecutive human joins cannot inherit a start occupied before BOT removal', () => {
  const w = new World();
  for (let i = 0; i < 8; i++) w.addPlayer('p' + i, 'Miner' + i);
  const players = [...w.players.values()];
  assert.equal(players.length, 8);
  assert.ok(players.every(p => !p.bot));
  assert.equal(new Set(players.map(p => p.startSeamId)).size, 8);
  assert.equal(new Set(players.map(p => p.x + ':' + p.z)).size, 8);
  assert.equal(w.timeLeft, 180);
});

test('late joins keep the clock and use the free start even when that seam is depleted', () => {
  const w = new World();
  for (let i = 0; i < 7; i++) w.addPlayer('p' + i, 'Miner' + i);
  const reserved = new Set([...w.players.values()].map(p => p.startSeamId));
  const free = w.deposits.find(d => d.kind === 'copper' && !reserved.has(d.id));
  free.hp = 0; free.regenAt = 10;
  for (let i = 0; i < 100; i++) w.tick(.05);
  const remaining = w.timeLeft;
  const late = w.addPlayer('late', 'Late');
  assert.equal(w.timeLeft, remaining);
  assert.equal(late.joinedLate, true);
  assert.equal(late.startSeamId, free.id);
  assert.equal(new Set([...w.players.values()].map(p => p.startSeamId)).size, 8);
  w.removePlayer(late.id);
  const replacement = w.addPlayer('replacement', 'Replacement');
  assert.equal(replacement.startSeamId, free.id);
  assert.equal(w.timeLeft, remaining);
});

test('a stable roster cycles through all starts and market combinations on rematch', () => {
  const w = new World();
  const players = Array.from({ length: 8 }, (_, i) => w.addPlayer('p' + i, 'Miner' + i));
  const starts = players.map(() => new Set()), combinations = players.map(() => new Set());
  w.resetRound();
  for (let round = 0; round < 24; round++) {
    assert.equal(new Set(players.map(p => p.startSeamId)).size, 8);
    players.forEach((p, i) => {
      starts[i].add(p.startSeamId);
      combinations[i].add(p.startSeamId + ':' + w.orderAt(w.stations[0]).kind);
    });
    w.resetRound();
  }
  assert.ok(starts.every(s => s.size === 8));
  assert.ok(combinations.every(s => s.size === 24));
});
