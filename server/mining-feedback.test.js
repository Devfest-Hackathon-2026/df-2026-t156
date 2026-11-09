import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from './game.js';
import { Valley, VALLEY } from './valley.js';

function fixture(kind = 'copper') {
  const source = VALLEY.deposits.find(d => d.kind === kind);
  const valley = new Valley({ ...VALLEY, heights: VALLEY.heights.map(() => 0), colliders: [],
    deposits: [{ ...VALLEY.deposits[0], id: 'start', x: -15, z: 0 }, { ...source, id: 'target', x: 15, z: 0 }] });
  const w = new World({ valley, bots: false });
  const a = w.addPlayer('a', 'A'), b = w.addPlayer('b', 'B'), d = w.deposits.find(d => d.id === 'target');
  Object.assign(a, { x: 13, y: 0, z: 0, pickLevel: 3 });
  Object.assign(b, { x: 17, y: 0, z: 0, pickLevel: 1 });
  return { w, a, b, d };
}
function swingAtFragment(w, p, d) {
  const eye = w.eyes(p), point = { x: d.x, y: d.y + d.height + .075, z: d.z };
  const delta = { ax: point.x - eye.x, ay: point.y - eye.y, az: point.z - eye.z };
  const length = Math.hypot(delta.ax, delta.ay, delta.az);
  w.strike(p, { ax: delta.ax / length, ay: delta.ay / length, az: delta.az / length, miningOnly: true });
}

test('one free slot leaves the second broken unit on its seam; a real next swing recovers it exactly once', () => {
  const { w, a, b, d } = fixture();
  a.bag = Array(7).fill('silver');
  w.mine(a, d, true, d.weak);
  const deadline = d.regenAt;
  assert.equal(a.bag.length, 8); assert.equal(d.hp, 0); assert.equal(d.looseCount, 1);
  assert.equal(w.snapshot().deposits.find(s => s.id === d.id).looseCount, 1);
  swingAtFragment(w, b, d);
  assert.deepEqual(b.bag, ['copper']); assert.equal(d.looseCount, 0);
  assert.equal(d.regenAt, deadline, 'recovering a fragment never delays normal regrowth');
  const receipt = w.events.find(e => e.type === 'harvest' && e.actorId === b.id);
  assert.equal(receipt.pickup, true); assert.equal(receipt.amount, 1);
  b.nextStrike = 0; swingAtFragment(w, b, d);
  assert.deepEqual(b.bag, ['copper']);
  assert.equal(w.events.filter(e => e.type === 'harvest').reduce((sum, e) => sum + e.amount, 0), 2);
});

test('full bags cannot consume or mint fragments, and regrowth clears any uncollected unit', () => {
  const { w, a, b, d } = fixture();
  a.bag = Array(8).fill('silver'); w.mine(a, d, true, d.weak);
  assert.equal(d.hp, d.ore.hp); assert.equal(d.looseCount, 0);
  a.bag.pop(); w.mine(a, d, true, d.weak);
  b.bag = Array(8).fill('silver'); swingAtFragment(w, b, d);
  assert.equal(d.looseCount, 1); assert.equal(b.bag.length, 8);
  assert.equal(w.events.filter(e => e.type === 'harvest').length, 1);
  w.time = d.regenAt; w.tick(.05);
  assert.equal(d.hp, d.ore.hp); assert.equal(d.looseCount, 0);
  w.resetRound(); assert.ok(w.deposits.every(seam => seam.looseCount === 0));
});

test('a remaining fragment cannot be recovered outside reach or through a solid foreground object', () => {
  const { w, a, b, d } = fixture();
  a.bag = Array(7).fill('silver'); w.mine(a, d, true, d.weak);
  b.x = d.x + 10; swingAtFragment(w, b, d);
  assert.equal(b.bag.length, 0); assert.equal(d.looseCount, 1);
  b.x = 17;
  w.valley.cover.push({ id: 'test-trunk', kind: 'trunk', x: 16, z: 0, base: 0, radius: .24, height: 3 });
  swingAtFragment(w, b, d);
  assert.equal(b.bag.length, 0); assert.equal(d.looseCount, 1);
});

test('the surface and core each grant their real one unit, while a full surface winner cannot mine the core', () => {
  const { w, a, b, d } = fixture('gold');
  Object.assign(d, { active: true, layer: 1, hp: w.goldLayers[0], expiresAt: 100 });
  a.bag = Array(7).fill('silver');
  while (d.layer === 1) w.mine(a, d, true, d.weak);
  assert.equal(a.bag.length, 8); assert.equal(d.layer, 2); assert.equal(d.hp, w.goldLayers[1]);
  assert.equal(d.looseCount, 0);
  w.mine(a, d, true, d.weak); assert.equal(d.hp, w.goldLayers[1]);
  while (d.hp) w.mine(b, d, true, d.weak);
  w.mine(b, d, true, d.weak);
  const harvests = w.events.filter(e => e.type === 'harvest');
  assert.deepEqual(harvests.map(e => [e.layer, e.amount]), [[1, 1], [2, 1]]);
  assert.deepEqual(b.bag, ['gold']); assert.equal(d.looseCount, 0);
  assert.equal(w.localClaims(a.id).find(c => c.layer === 1).resultReason, 'precision');
  assert.equal(w.localClaims(b.id).find(c => c.layer === 2).resultReason, 'precision');
});

test('a small last weak hit reports the missing contribution instead of implying a precision win', () => {
  const { w, a, b, d } = fixture();
  a.pickLevel = 1; w.mine(a, d, true, d.weak); w.mine(b, d, true, d.weak);
  const lost = w.localClaims(b.id).find(c => c.resultId);
  assert.deepEqual(a.bag, ['copper', 'copper']); assert.equal(b.bag.length, 0);
  assert.equal(lost.resultReason, 'not-enough'); assert.equal(lost.ownDamage, 1); assert.equal(lost.finishRequired, 2);
  assert.equal(w.events.find(e => e.type === 'harvest').finisherId, b.id);
});

test('a qualified precision finish and a body finish give distinct frozen reasons', () => {
  for (const weakFinish of [true, false]) {
    const { w, a, b, d } = fixture('crystal');
    for (let i = 0; i < 7; i++) w.mine(a, d, false, d.weak);
    for (let i = 0; i < 4; i++) w.mine(b, d, true, d.weak);
    assert.equal(d.hp, 1);
    w.mine(b, d, weakFinish, d.weak);
    const loser = w.localClaims(weakFinish ? a.id : b.id).find(c => c.resultId);
    assert.equal(loser.resultReason, weakFinish ? 'precision' : 'not-weak');
    assert.equal((weakFinish ? b : a).bag.length, 2);
  }
});

test('a full or distant main contributor sees the actual eligibility at the time of the break', () => {
  for (const unavailable of ['bag-full', 'too-far']) {
    const { w, a, b, d } = fixture('crystal');
    for (let i = 0; i < 4; i++) w.mine(a, d, true, d.weak);
    w.mine(a, d, false, d.weak);
    if (unavailable === 'bag-full') a.bag = Array(8).fill('silver');
    else a.x = d.x + 6;
    w.mine(b, d, true, d.weak); w.mine(b, d, false, d.weak);
    assert.equal(w.localClaims(a.id).find(c => c.resultId).resultReason, unavailable);
    a.bag = []; a.x = 13;
    assert.equal(w.localClaims(a.id).find(c => c.resultId).resultReason, unavailable, 'later movement or sale does not rewrite the cause');
    assert.equal(w.localClaims(b.id).find(c => c.resultId).resultReason, 'nearby');
  }
});
