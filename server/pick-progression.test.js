import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from './game.js';

function hold(w, p, packet, ticks) {
  for (let i = 0; i < ticks; i++) { w.input(p.id, packet); w.tick(.05); }
}

test('seven separate paid holds reach Lv8, stop at the cap and keep final accounting through a rematch', () => {
  const w = new World({ bots: false }), p = w.addPlayer('a', 'Miner'), s = w.stations[0];
  Object.assign(p, { x: s.x, y: s.y, z: s.z, score: 300, grossSales: 300 });
  for (const pick of w.picks.slice(1)) {
    hold(w, p, {}, 1);
    hold(w, p, { upgrade: true }, 36);
    assert.equal(p.pickLevel, pick.level);
    const balance = p.score;
    hold(w, p, { upgrade: true }, 40);
    assert.equal(p.pickLevel, pick.level, 'holding after payment never chains a second purchase');
    assert.equal(p.score, balance);
    assert.equal(p.grossSales - p.investmentSpent, p.score);
  }
  assert.equal(p.investmentSpent, 198); assert.equal(p.score, 102);
  assert.equal(w.nextPick(p), null);
  const row = w.snapshot(p.id).players.find(q => q.id === p.id);
  assert.equal(row.upgradeCost, 0); assert.equal(row.upgradeReady, false);
  hold(w, p, {}, 1); hold(w, p, { upgrade: true }, 36);
  assert.equal(p.score, 102); assert.equal(p.pickLevel, 8);
  w.timeLeft = .05; w.tick(.05);
  assert.equal(w.standings[0].pickLevel, 8);
  assert.equal(w.standings[0].investmentSpent, 198);
  w.resetRound();
  assert.equal(p.pickLevel, 1); assert.equal(p.investmentSpent, 0); assert.equal(p.score, 0);
});

test('every grade increases output and a Lv8 input cracks the hard crystal in two precision swings', () => {
  const w = new World({ bots: false }), p = w.addPlayer('a', 'Miner');
  for (let i = 1; i < w.picks.length; i++) {
    assert.ok(w.picks[i].damage > w.picks[i - 1].damage);
    assert.ok(w.picks[i].weakDamage > w.picks[i - 1].weakDamage);
    assert.ok(w.picks[i].hitCooldown < w.picks[i - 1].hitCooldown);
  }
  const d = w.deposits.find(d => d.kind === 'crystal');
  Object.assign(p, { ...d.approaches[0], pickLevel: 8 });
  const strike = () => {
    const eye = w.eyes(p), x = d.weak.x - eye.x, y = d.weak.y - eye.y, z = d.weak.z - eye.z;
    const length = Math.hypot(x, y, z);
    w.input(p.id, { ax: x / length, ay: y / length, az: z / length, fire: true, miningOnly: true });
    w.tick(.05);
  };
  strike(); assert.equal(d.hp, 10);
  hold(w, p, {}, 7);
  strike(); assert.equal(d.hp, 0); assert.deepEqual(p.bag, ['crystal', 'crystal']);
});
