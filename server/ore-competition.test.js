import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from './game.js';
import { Valley, VALLEY } from './valley.js';

function setup(kind = 'gold') {
  const gold = VALLEY.deposits.find(d => d.kind === kind);
  const valley = new Valley({ ...VALLEY, heights: VALLEY.heights.map(() => 0), colliders: [],
    deposits: [{ ...VALLEY.deposits[0], x: -15, z: 0 }, { ...gold, x: 15, z: 0 }] });
  const w = new World({ valley, bots: false });
  const strong = w.addPlayer('strong', 'Strong'), low = w.addPlayer('low', 'Low');
  Object.assign(strong, { x: 13, y: 0, z: 0, pickLevel: 3 });
  Object.assign(low, { x: 17, y: 0, z: 0, pickLevel: 1 });
  const d = w.deposits.find(d => d.kind === kind);
  Object.assign(d, { active: true, layer: kind === 'gold' ? 2 : 0,
    hp: kind === 'gold' ? w.goldLayers[1] : d.ore.hp, expiresAt: 1000 });
  return { w, strong, low, d };
}
function hit(w, p, d, weak = true) {
  const eye = w.eyes(p), point = weak ? d.weak : { x: d.x, y: .6, z: d.z };
  const dx = point.x - eye.x, dy = point.y - eye.y, dz = point.z - eye.z;
  const length = Math.hypot(dx, dy, dz);
  w.input(p.id, { ax: dx / length, ay: dy / length, az: dz / length, fire: true });
  w.tick(.05);
  w.input(p.id, { fire: false });
  for (let i = 0; i < 14; i++) w.tick(.05);
}

test('a level-one participant can precision-finish a core against the larger contributor', () => {
  const { w, strong, low, d } = setup();
  for (let i = 0; i < 4; i++) { hit(w, strong, d); hit(w, low, d); }
  assert.equal(d.hp, 4);
  hit(w, low, d);
  const claim = w.localClaims(low.id).find(c => c.layer === 2 && !c.resultId);
  assert.equal(claim.ownDamage, 10);
  assert.equal(claim.finishRequired, 9);
  assert.equal(claim.status, 'trailing');
  hit(w, low, d);
  assert.equal(d.hp, 0);
  assert.deepEqual(low.bag, ['gold']);
  assert.deepEqual(strong.bag, []);
  const receipt = w.localClaims(low.id).find(c => c.status === 'received');
  assert.equal(receipt.resultAmount, 1);
  assert.equal(receipt.ownDamage, 12);
});

test('a single late weak hit cannot take a core from its main contributor', () => {
  const { w, strong, low, d } = setup();
  for (let i = 0; i < 5; i++) hit(w, strong, d);
  hit(w, strong, d, false);
  hit(w, low, d);
  hit(w, low, d);
  assert.equal(d.hp, 0);
  assert.deepEqual(strong.bag, ['gold']);
  assert.deepEqual(low.bag, []);
});

test('body finishing still awards contribution, and three-times tool output wins a direct race', () => {
  const { w, strong, low, d } = setup();
  for (let i = 0; i < 4; i++) { hit(w, strong, d); hit(w, low, d); }
  hit(w, low, d, false); hit(w, low, d, false); hit(w, low, d, false); hit(w, low, d, false);
  assert.deepEqual(strong.bag, ['gold']);
  const direct = setup();
  for (let i = 0; i < 8 && direct.d.hp; i++) {
    hit(direct.w, direct.strong, direct.d);
    if (direct.d.hp) hit(direct.w, direct.low, direct.d);
  }
  assert.deepEqual(direct.strong.bag, ['gold']);
  assert.deepEqual(direct.low.bag, []);
  assert.equal(VALLEY.picks[2].weakDamage, VALLEY.picks[0].weakDamage * 3);
  assert.ok(VALLEY.picks[2].hitCooldown < VALLEY.picks[0].hitCooldown);
});

test('normal ore regrows in the authored shorter window and all ore accepts level one', () => {
  assert.ok(VALLEY.ores.every(ore => ore.minLevel === 1));
  assert.deepEqual(VALLEY.ores.slice(0, 3).map(ore => ore.respawnSeconds), [6, 9, 20]);
  const { w, low } = setup();
  const copper = w.deposits[0];
  Object.assign(low, { x: copper.x - 2, z: copper.z });
  hit(w, low, copper); hit(w, low, copper);
  assert.equal(copper.hp, 0);
  for (let i = 0; i < 120; i++) w.tick(.05);
  assert.equal(copper.hp, copper.ore.hp);
});

test('the ordinary hard seam lets a low pick earn a finish while retaining the investment advantage', () => {
  const { w, strong, low, d } = setup('crystal');
  for (let i = 0; i < 3; i++) { hit(w, strong, d); hit(w, low, d); }
  assert.equal(d.hp, 6);
  hit(w, low, d);
  assert.equal(w.localClaims(low.id).find(c => !c.resultId).finishRequired, 8);
  hit(w, low, d); hit(w, low, d);
  assert.deepEqual(low.bag, ['crystal', 'crystal']);
  assert.deepEqual(strong.bag, []);
  assert.ok(d.regenAt > w.time + 19);
  // The first strike is immediate. Count intervals between swings, as the real input does.
  const weakSeconds = w.picks.map(p => (Math.ceil(d.ore.hp / p.weakDamage) - 1) * p.hitCooldown);
  assert.deepEqual(weakSeconds.map(t => +t.toFixed(2)), [9.52, 4.2, 2.16, 1.47, .9, .82, .37, .34]);
});

test('ordinary hard seams share two reachable sightlines instead of six isolated safe farms', () => {
  const w = new World({ bots: false });
  const hard = w.deposits.filter(d => d.kind === 'crystal');
  assert.equal(hard.length, 6);
  for (const side of [-1, 1]) {
    const group = hard.filter(d => Math.sign(d.z) === side);
    assert.equal(group.length, 3);
    const middle = group.find(d => d.x === -2);
    for (const d of group.filter(d => d !== middle)) {
      const from = d.approaches[0], to = middle.approaches[0];
      const route = w.valley.path(from, to);
      assert.ok(route.length, d.id);
      let length = 0, previous = from;
      for (const step of route) { length += Math.hypot(step.x - previous.x, step.z - previous.z); previous = step; }
      assert.ok(length / VALLEY.walkSpeed < 5, d.id + ' can join the neighboring contest');
      const eye = w.eyes(from), point = middle.weak;
      const length3 = Math.hypot(point.x - eye.x, point.y - eye.y, point.z - eye.z);
      const direction = { x: (point.x - eye.x) / length3, y: (point.y - eye.y) / length3, z: (point.z - eye.z) / length3 };
      assert.ok(w.valley.rayDistance(eye, direction, length3) >= length3 - .01, d.id + ' sees the next seam');
    }
    for (const d of group) {
      assert.ok(d.approaches.length >= 6, d.id);
      assert.ok(w.stations.every(s => Math.hypot(s.x-d.x,s.z-d.z) > s.safeRadius + 3), d.id);
      assert.ok(w.stations.every(s => w.valley.path(d.approaches[0], s).length), d.id + ' can sell by another route');
    }
  }
});
