import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from './game.js';
import { Valley, VALLEY } from './valley.js';
import { MOTION, resetMotion } from './motion.js';

const flat = new Valley({ ...VALLEY, heights: VALLEY.heights.map(() => 0), colliders: [],
  deposits: [{ ...VALLEY.deposits[0], x: 45, z: 40 }] });
const place = (p, station, offset = 0) => Object.assign(p, { x: station.x + offset, y: 0, z: station.z });
function hold(w, p, packet, ticks) {
  for (let i = 0; i < ticks; i++) { w.input(p.id, packet); w.tick(.05); }
}

test('the protection annulus does not trade; a held action begins after entering the painted trade line', () => {
  for (const id of ['central', 'west', 'east']) {
    const w = new World({ bots: false, valley: flat });
    const p = w.addPlayer('a', 'A'), s = w.stations.find(s => s.id === id);
    p.bag = ['copper', 'copper']; p.score = 80;
    place(p, s, s.radius + .1);
    hold(w, p, { sell: true }, 32);
    const outside = w.snapshot(p.id).players.find(row => row.id === p.id);
    assert.equal(outside.protected, true);
    assert.equal(outside.stationId, '');
    assert.equal(p.sellProgress, 0); assert.equal(p.bag.length, 2);
    hold(w, p, { upgrade: true }, 37);
    assert.equal(p.pickLevel, 1); assert.equal(p.upgradeProgress, 0);
    place(p, s, s.radius - .1);
    hold(w, p, { upgrade: true, x: -.5 }, 1);
    assert.ok(p.upgradeProgress > 0, 'an in-range hold starts while moving');
    hold(w, p, { upgrade: true }, 34);
    assert.equal(p.pickLevel, 1);
    hold(w, p, { upgrade: true }, 1);
    assert.equal(p.pickLevel, 2);
    hold(w, p, { sell: true }, 20);
    assert.equal(p.bag.length, 0);
    assert.equal(w.events.at(-1).targetId, s.id);
  }
});

test('a Q release between simulation ticks permits exactly one further complete hold', () => {
  const w = new World({ bots: false, valley: flat });
  const p = w.addPlayer('a', 'A'); place(p, w.stations[0]); p.score = 80;
  hold(w, p, { upgrade: true }, 36);
  assert.equal(p.pickLevel, 2); assert.equal(p.upgradeHeld, true);
  w.input(p.id, { upgrade: false, motionRound: w.round - 1 });
  assert.equal(p.upgradeHeld, true, 'a stale previous-round release is rejected');
  hold(w, p, { upgrade: true }, 40);
  assert.equal(p.pickLevel, 2);
  w.input(p.id, { upgrade: false });
  w.input(p.id, { upgrade: true });
  w.tick(.05);
  hold(w, p, { upgrade: true }, 34);
  assert.equal(p.pickLevel, 2, 'a release never waives hold duration');
  hold(w, p, { upgrade: true }, 1);
  assert.equal(p.pickLevel, 3);
});

test('a pending receipt distinguishes its locked buying price from the unreserved first-order reward', () => {
  const w = new World({ bots: false, valley: flat });
  const p = w.addPlayer('a', 'A');
  w.time = 79.4; w.timeLeft = 100.6;
  const s = w.stations.find(s => w.orderAt(s).id), kind = w.orderAt(s).kind;
  place(p, s); p.bag = [kind, kind];
  hold(w, p, { sell: true }, 10);
  let row = w.snapshot(p.id).players.find(row => row.id === p.id);
  const locked = row.sellNormalValue;
  assert.ok(locked > 0); assert.equal(row.sellOrderBonus, 12);
  assert.equal(row.sellValue, locked + 12); assert.equal(row.sellOrderLost, false);
  hold(w, p, { sell: true }, 3);
  row = w.snapshot(p.id).players.find(row => row.id === p.id);
  assert.equal(row.sellNormalValue, locked);
  assert.equal(row.sellOrderBonus, 0); assert.equal(row.sellOrderLost, true);
  assert.equal(row.sellValue, locked);
  hold(w, p, { sell: true }, 7);
  assert.equal(p.score, locked); assert.equal(p.orderEarnings, 0);
  row = w.snapshot(p.id).players.find(row => row.id === p.id);
  assert.equal(row.sellNormalValue, 0); assert.equal(row.sellOrderLost, false);
  w.resetRound();
  row = w.snapshot(p.id).players.find(row => row.id === p.id);
  assert.equal(row.sellValue, 0); assert.equal(row.sellOrderBonus, 0);
});

test('buffered E sells once during an ordinary validated sprint across each real trade circle', () => {
  for (const id of ['central', 'west', 'east']) {
    const w = new World({ bots: false, valley: flat });
    const p = w.addPlayer('a', 'A'), s = w.stations.find(s => s.id === id);
    place(p, s, -s.radius - .5); resetMotion(p, w.time, w.round);
    p.bag = ['copper', 'copper'];
    const expected = w.quote(p, s).value, start = p.x;
    let paid = 0, lastScore = 0;
    for (let seq = 1; seq <= 34; seq++) {
      const packet = { x: 1, sprint: true, sell: true, motionSeq: seq, motionRound: w.round,
        motionTime: seq * .05, correctionId: p.correctionId, impulseId: p.impulseId,
        px: start + seq * MOTION.sprint * .05, py: 0, pz: s.z };
      for (let repeat = 0; repeat < 4; repeat++) w.input(p.id, packet);
      w.tick(.05);
      if (p.score !== lastScore) {
        paid++; assert.ok(Math.abs(p.x - s.x) <= s.radius, 'completion stays inside the painted circle');
        assert.equal(p.score, expected); lastScore = p.score;
      }
    }
    assert.equal(paid, 1); assert.equal(p.grossSales, expected);
    assert.equal(p.correctionId, 0); assert.equal(p.bag.length, 0);
    assert.ok(p.x > s.x + s.radius);
  }
});

test('a held E waits outside, cancels at the boundary and automatically retries on re-entry', () => {
  const w = new World({ bots: false, valley: flat }), p = w.addPlayer('a', 'A'), s = w.stations[0];
  p.bag = ['copper']; const expected = w.quote(p, s).value;
  place(p, s, s.radius + .01); hold(w, p, { sell: true }, 30);
  assert.equal(p.sellProgress, 0); assert.equal(p.score, 0);
  place(p, s, s.radius - .05); hold(w, p, { sell: true }, 8);
  assert.ok(p.sellProgress > .35);
  place(p, s, s.radius + .01); hold(w, p, { sell: true }, 1);
  assert.equal(p.sellProgress, 0); assert.equal(p.sale, null); assert.equal(p.score, 0);
  place(p, s); hold(w, p, { sell: true }, 19);
  assert.equal(p.score, 0);
  hold(w, p, { sell: true }, 1);
  assert.equal(p.score, expected); assert.equal(p.bag.length, 0);
});

test('a quoted batch leaves later ore and gold accounting for the next held-E sale', () => {
  const w = new World({ bots: false, valley: flat }), p = w.addPlayer('a', 'A'), s = w.stations[0];
  place(p, s); p.bag = ['copper']; const first = w.quote(p, s).value;
  hold(w, p, { sell: true }, 10);
  p.bag.push('gold', 'copper');
  hold(w, p, { sell: true }, 10);
  assert.equal(p.score, first); assert.deepEqual(p.bag, ['gold', 'copper']); assert.equal(p.goldSold, 0);
  assert.equal(w.events.at(-1).amount, 1);
  const second = w.quote(p, s).value;
  hold(w, p, { sell: true }, 20);
  assert.equal(p.score, first + second); assert.equal(p.goldSold, 1); assert.equal(p.bag.length, 0);
  hold(w, p, { sell: true }, 40);
  assert.equal(p.score, first + second, 'empty/repeated input never sells the old batch again');
});

test('first-order eligibility belongs to the batch being sold, not its later arrivals', () => {
  const w = new World({ bots: false, valley: flat }), p = w.addPlayer('a', 'A');
  w.time = 45; w.timeLeft = 135;
  const s = w.stations.find(s => w.orderAt(s).id), order = w.orderAt(s);
  place(p, s); p.bag = [order.kind]; const first = w.quote(p, s).normalValue;
  hold(w, p, { sell: true }, 5); p.bag.push(order.kind, order.kind);
  hold(w, p, { sell: true }, 15);
  assert.equal(p.score, first); assert.equal(p.ordersCompleted, 0);
  assert.equal(p.bag.length, 2); assert.equal(w.orderAt(s).available, true);
  const second = w.quote(p, s).value;
  hold(w, p, { sell: true }, 20);
  assert.equal(p.score, first + second); assert.equal(p.orderEarnings, 12); assert.equal(p.ordersCompleted, 1);
});

test('a changed batch cannot pay for absent ore or discard its replacements', () => {
  const w = new World({ bots: false, valley: flat }), p = w.addPlayer('a', 'A'), s = w.stations[0];
  place(p, s); p.bag = ['copper'];
  hold(w, p, { sell: true }, 5); p.bag = ['gold'];
  hold(w, p, { sell: true }, 15);
  assert.equal(p.score, 0); assert.deepEqual(p.bag, ['gold']);
  const expected = w.quote(p, s).value;
  hold(w, p, { sell: true }, 20);
  assert.equal(p.score, expected); assert.equal(p.goldSold, 1);
});

test('held E leaves mining available outside and gives a loaded delivery priority inside', () => {
  const w = new World({ bots: false, valley: flat }), p = w.addPlayer('a', 'A'), d = w.deposits[0];
  Object.assign(p, { x: d.x - 1.5, y: 0, z: d.z }); d.hp = 1;
  const eye = w.eyes(p), delta = { x: d.weak.x - eye.x, y: d.weak.y - eye.y, z: d.weak.z - eye.z };
  const length = Math.hypot(delta.x, delta.y, delta.z);
  w.input(p.id, { fire: true, sell: true, miningOnly: true, ax: delta.x / length, ay: delta.y / length, az: delta.z / length });
  w.tick(.05);
  assert.equal(d.hp, 0); assert.equal(p.bag.length, 2, 'buffered E does not consume an outside mining press');
  const s = w.stations[0]; place(p, s); const expected = w.quote(p, s).value;
  p.pendingAttacks.push({ queuedAt: w.time, eye: w.eyes(p), ax: 1, ay: 0, az: 0 });
  const serial = w.serial;
  hold(w, p, { sell: true, fire: true }, 1);
  assert.ok(p.sellProgress > 0);
  assert.ok(!w.events.some(e => Number(e.id) > serial && e.type === 'swing'), 'shop priority also consumes an old queued press');
  assert.equal(p.pendingAttacks.length, 0);
  hold(w, p, { sell: true, fire: true }, 19);
  assert.equal(p.score, expected); assert.equal(p.bag.length, 0);
});

test('Q can progress while moving within a shop and still buys only one level per hold', () => {
  const w = new World({ bots: false, valley: flat }), p = w.addPlayer('a', 'A'); place(p, w.stations[0]);
  p.score = 80;
  for (let i = 0; i < 106; i++) hold(w, p, { upgrade: true, x: i % 2 ? .5 : -.5 }, 1);
  assert.equal(p.pickLevel, 2); assert.equal(p.score, 72);
  hold(w, p, {}, 1);
  for (let i = 0; i < 36; i++) hold(w, p, { upgrade: true, x: i % 2 ? .5 : -.5 }, 1);
  assert.equal(p.pickLevel, 3); assert.equal(p.score, 60);
});

test('buffered E expires on stale input and cannot replay across the result or round boundary', () => {
  const w = new World({ bots: false, valley: flat }), p = w.addPlayer('a', 'A'); place(p, w.stations[0]);
  p.bag = ['copper'];
  w.input(p.id, { sell: true });
  for (let i = 0; i < 20; i++) w.tick(.05);
  assert.equal(p.score, 0); assert.equal(p.sellProgress, 0);
  w.timeLeft = .05; w.tick(.05);
  hold(w, p, { sell: true }, 20);
  assert.equal(p.score, 0); assert.equal(p.bag.length, 1);
  w.resetRound(); place(p, w.stations[0]); p.bag = ['copper'];
  hold(w, p, { sell: true, motionRound: w.round - 1 }, 20);
  assert.equal(p.score, 0); assert.equal(p.bag.length, 1);
});
