import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from './game.js';
import { Valley, VALLEY } from './valley.js';
import { runRecovery } from './dev/motion-comparison.js';
import { compareLegacyMotion } from './dev/legacy-motion-comparison.js';
import { resetMotion, integrateMotion, combatVelocity, receiveMotion } from './motion.js';

function fixture(colliders = []) {
  const valley = new Valley({ ...VALLEY, heights: VALLEY.heights.map(() => 0), colliders, deposits: [] });
  const world = new World({ bots: false, valley });
  const player = world.addPlayer('p', 'P');
  Object.assign(player, { x: 0, y: 0, z: 0, airOrigin: 0 });
  let seq = 0, time = 0;
  const send = (x, y = 0, z = 0, extra = {}) => world.input('p', {
    motionSeq: ++seq, motionTime: time += .05, motionRound: world.round,
    correctionId: player.correctionId, impulseId: player.impulseId, px: x, py: y, pz: z, ...extra });
  return { world, player, send };
}

test('accepted client pose remains stationary even with held input and stale snapshots', () => {
  const { world, player, send } = fixture();
  send(.2, 0, 0, { x: 1 });
  for (let i = 0; i < 40; i++) world.tick(.05);
  assert.equal(player.x, .2);
  assert.equal(world.snapshot('p').players[0].x, .2);
  assert.equal(player.correctionId, 0);
});

test('buffered network frames consume elapsed budget, not a second server movement', () => {
  const { world, player, send } = fixture();
  for (let i = 0; i < 20; i++) world.tick(.05);
  for (let i = 1; i <= 20; i++) send(i * .2);
  assert.equal(player.x, 4);
  assert.equal(player.correctionId, 0);
  for (let i = 0; i < 60; i++) send(4);
  assert.ok(player.correctionId > 0, 'packet-count cannot manufacture simulated time');
});

test('enormous finite coordinates and collision crossings reject before unbounded geometry work', () => {
  const { world, player, send } = fixture([{ x: 1, z: 0, radius: .4, height: 3 }]);
  send(1e300);
  assert.equal(player.x, 0);
  assert.equal(player.correctionId, 1);
  for (let i = 0; i < 10; i++) world.tick(.05);
  send(2, 0, 0, { motionTime: .55 });
  assert.equal(player.x, 0);
  assert.equal(player.correctionId, 2);
});

test('knockback replaces velocity and gates stale poses until the exact impulse is acknowledged', () => {
  const { world, player, send } = fixture();
  send(.1);
  world.applyKnockback(player, 8, 8, 0);
  const impulse = player.impulseId;
  send(.2, 0, 0, { impulseId: impulse - 1 });
  assert.equal(player.x, .1);
  world.tick(.05);
  send(.7, .4);
  assert.equal(player.x, .7);
  assert.equal(player.correctionId, 0);
  assert.equal(player.impulseId, impulse);
});

test('flying and previous-round poses reject, late join and rematch reset motion', () => {
  const { world, player, send } = fixture();
  send(0, 50);
  assert.equal(player.y, 0);
  assert.equal(player.correctionId, 1);
  const previousRound = world.round;
  world.resetRound();
  const spawn = { x: player.x, y: player.y, z: player.z };
  send(10, 0, 0, { motionRound: previousRound });
  assert.deepEqual({ x: player.x, y: player.y, z: player.z }, spawn);
  assert.equal(player.motionSeq, 0);
  const late = world.addPlayer('late', 'Late');
  assert.equal(late.motionSeq, 0);
  assert.equal(late.impulseId, 0);
});

test('Java 1.8.9 repeated sprint-jump trace remains valid through takeoff, air momentum, landing and release', () => {
  const { world, player, send } = fixture();
  let x = 0, y = 0, vx = 0, vy = 0, grounded = true;
  for (let tick = 0; tick < 120; tick++) {
    const sprint = tick < 80, friction = grounded ? .546 : .91;
    if (sprint) vx += grounded ? 2.548 : .5096;
    if (grounded && sprint) { vy = 8.4; vx += 4; }
    x += vx * .05; y += vy * .05;
    grounded = y <= 0;
    if (grounded) { y = 0; vy = 0; }
    vx *= friction; vy = grounded ? 0 : (vy - 1.6) * .98;
    if (Math.abs(vx) < .1) vx = 0;
    send(x, y, 0, { x: sprint ? 1 : 0, sprint });
    world.tick(.05);
    assert.equal(player.correctionId, 0, `normal movement rejected on tick ${tick}`);
  }
  assert.equal(vx, 0);
  assert.ok(x > 25 && x < 32, 'sprint jumping carries further than the flat sprint limit');
});

test('low cylinder tops support landed feet, tall bodies block, and walking off becomes a fall', () => {
  const { world, player, send } = fixture([{ x: 0, z: 0, radius: .65, height: .95 }]);
  assert.equal(world.valley.supportHeight(0, 0, 1.1), .95);
  assert.equal(world.valley.supportHeight(0, 0, .3), 0, 'a body cannot snap up from below');
  assert.equal(world.valley.move({ x: -2, y: 1.1, z: 0 }, 2, 0).x, 0, 'feet clear the low top');
  const tall = new Valley({ ...world.valley.data, colliders: [{ x: 0, z: 0, radius: .65, height: 3 }] });
  assert.ok(tall.move({ x: -2, y: 1.1, z: 0 }, 2, 0).x <= -1.099);
  Object.assign(player, { x: 0, y: .95, airOrigin: .95 });
  for (let i = 0; i < 40; i++) { send(0, .95); world.tick(.05); }
  assert.equal(player.grounded, true);
  assert.equal(player.correctionId, 0, 'standing on a prop is not flying');
  player.x = 1.05;
  for (const [x, y] of [[1.25, .95], [1.45, .9], [1.65, .7], [1.85, .4], [2.05, 0]]) {
    send(x, y); world.tick(.05);
    assert.equal(player.correctionId, 0, 'normal descent stays valid');
  }
  assert.equal(player.grounded, true);
});

test('late first impulse acknowledgement does not age the impulse by pre-ack movement time', () => {
  const { world, player } = fixture();
  world.applyKnockback(player, 12, 8, 0);
  world.time = 1.5;
  const packet = (seq, time, x, y) => world.input('p', { motionSeq: seq, motionRound: world.round,
    motionTime: time, impulseId: player.impulseId, correctionId: 0, px: x, py: y, pz: 0 });
  packet(1, 1.5, 4.5, .0666667);
  assert.equal(player.correctionId, 0);
  assert.equal(player.impulseAllowance, 12, 'client has only just applied the impulse');
  world.time += .05;
  packet(2, 1.55, 5.12, .452267);
  assert.equal(player.correctionId, 0, 'the next physical knockback step remains valid');
  assert.ok(player.impulseAllowance < 12, 'decay resumes on subsequent acknowledged steps');
});

test('independent client recovers from communication and render pauses while running and clicking', () => {
  for (const mode of ['network', 'up', 'down', 'client']) for (const pause of [.25, 1, 3])
    for (const knockback of [false, true]) {
      const result = runRecovery({ mode, pause, knockback });
      const label = `${mode} pause=${pause} KB=${knockback}`;
      assert.equal(result.finalError, 0, label);
      assert.ok(result.movedAfterRecovery > 10, `client remains playable: ${label}`);
      assert.ok(result.rejections <= (pause > 2 ? 2 : 0), `bounded recovery: ${label}`);
      assert.ok(result.lastRejection === null || result.lastRejection < 2 + pause + 1, label);
    }
});

test('flat movement agrees with independent 1.8.9 tick equations, including diagonal sneak and held jumps', () => {
  const rows = compareLegacyMotion();
  const value = name => rows.find(row => row.name === name).adopted;
  assert.equal(value('walk').finalSpeed, 4.317181);
  assert.equal(value('sprint').finalSpeed, 5.612335);
  assert.equal(value('diagonalSneak').finalSpeed, 1.831625);
  assert.equal(value('repeatedSprintJump').maxHeight, 1.249187);
  assert.equal(value('repeatedSprintJump').jumpPeriod, .6);
  assert.equal(value('repeatedSprintJump').steadyCycleSpeed, 7.126765);
  assert.equal(value('drawFromSprint').finalSpeed, .863436);
});

test('server actors retain knockback against held counter-input and expose current carried combat velocity', () => {
  const { world, player } = fixture();
  world.applyKnockback(player, 0, 8, 8);
  world.input(player.id, { z: -1 });
  world.tick(.05);
  assert.ok(player.z > .35, 'backward input adds a small air acceleration, rather than deleting the hit');
  assert.equal(player.grounded, false);
  assert.equal(combatVelocity(player).z, player.motionVZ);
  assert.ok(combatVelocity(player).z > 6);
  player.clientMotion = true;
  player.velocityZ = 1.25;
  assert.equal(combatVelocity(player).z, 1.25, 'a pose-owned client never reuses its original eight-metre impulse');
});

test('drawing pose validation preserves entry inertia then enforces the slowed ground speed', () => {
  const { world, player } = fixture();
  const simulated = { x: 0, y: 0, z: 0, yaw: 0 };
  resetMotion(simulated, 0, world.round);
  let sequence = 0;
  for (let tick = 0; tick < 80; tick++) {
    const drawing = tick >= 40;
    simulated.bowDrawing = player.bowDrawing = drawing;
    const input = { x: 0, z: 1, sprint: !drawing };
    integrateMotion(world, simulated, input, .05);
    player.input = input; world.time += .05;
    receiveMotion(world, player, { motionSeq: ++sequence, motionRound: world.round,
      motionTime: sequence * .05, px: simulated.x, py: simulated.y, pz: simulated.z,
      correctionId: player.correctionId, impulseId: player.impulseId });
    assert.equal(player.correctionId, 0, `normal drawing trajectory rejected on tick ${tick}`);
  }
  world.time += .05;
  receiveMotion(world, player, { motionSeq: ++sequence, motionRound: world.round,
    motionTime: sequence * .05, px: player.x, py: 0, pz: player.z + .2,
    correctionId: 0, impulseId: 0 });
  assert.equal(player.correctionId, 1, 'sustained four-metre-per-second drawing is rejected');
});

test('a real downhill landing and held-space takeoff hidden between poses renews only that jump allowance', () => {
  const world = new World({ bots: false }), p = world.addPlayer('p', 'P');
  Object.assign(p, { x: -2.7953522205352783, y: .6419023871421814, z: -16.675737380981445,
    motionSeq: 1455, motionTime: 82.84435272216797, grounded: false, velocityY: -8.015569722877359,
    jumpAllowance: .6976107980159301, airOrigin: 2.133422374725342,
    impulseId: 3, impulseAckId: 3, impulseY: 8, motionBudgetAt: 82.85 });
  const poses = [
    [1456, 82.89994812011719, -2.4391424655914307, .7196633219718933, -16.34084129333496],
    [1457, 82.9554443359375, -2.0560309886932373, 1.1341310739517212, -15.980656623840332],
  ];
  for (const [seq, time, x, y, z] of poses) {
    world.time = time + .005;
    world.input(p.id, { motionSeq: seq, motionRound: world.round, motionTime: time,
      px: x, py: y, pz: z, impulseId: 3, correctionId: 0,
      x: .7285727858543396, z: .6849684119224548, sprint: true });
    assert.equal(p.correctionId, 0, `captured normal pose ${seq}`);
    assert.equal(p.motionTime, time);
  }
  assert.ok(p.airOrigin < .53 && p.jumpAllowance > 6, 'renewal belongs to the real low support, not the previous high launch');
});

test('hidden landing cannot excuse excessive ground speed or a reversal too high to contact support', () => {
  for (const airborne of [false, true]) {
    const { world, player, send } = fixture();
    Object.assign(player, { y: airborne ? 1 : 0, grounded: !airborne, velocityY: airborne ? -2 : 0,
      jumpAllowance: 0, airOrigin: airborne ? 1 : 0 });
    send(.55, airborne ? 1.2 : 0, 0, { x: 1, sprint: true });
    assert.equal(player.correctionId, 1);
    assert.equal(player.jumpAllowance, 0, 'rejected positions cannot renew movement credit');
    assert.equal(player.airOrigin, airborne ? 1 : 0);
  }
});

test('uneven pose intervals preserve repeated sprint jumps without renewing a ground-speed allowance', () => {
  for (const interval of [.033, .0555, .1, .15]) {
    const { world, player } = fixture(), simulated = { x: 0, y: 0, z: 0, yaw: 0 };
    resetMotion(simulated, 0, world.round);
    let next = interval, seq = 0;
    for (let frame = 1; frame <= 600; frame++) {
      const time = frame / 120;
      integrateMotion(world, simulated, { x: 0, z: 1, sprint: true, jump: true }, 1 / 120);
      world.time = time;
      if (time + 1e-9 < next) continue;
      next += interval; player.input = { sprint: true };
      receiveMotion(world, player, { motionSeq: ++seq, motionRound: world.round, motionTime: time,
        px: simulated.x, py: simulated.y, pz: simulated.z, correctionId: 0, impulseId: 0 });
      assert.equal(player.correctionId, 0, `interval ${interval}, frame ${frame}`);
    }
  }
});

test('a low ledge steps at 0.6m, while a higher body still blocks and an endpoint inside it is rejected', () => {
  for (const height of [.6, .61]) {
    const { world, player } = fixture([{ x: 0, z: 0, radius: .5, height }]);
    Object.assign(player, { x: -2, y: 0, z: 0 });
    for (let frame = 0; frame < 240; frame++) integrateMotion(world, player, { x: 1, z: 0, sprint: true }, 1 / 120);
    if (height === .6) assert.ok(player.x > 7, 'a valid shallow top is crossed without jumping');
    else assert.ok(player.x <= -.949, 'one extra centimetre does not become a wall climb');
  }
  const { world, player, send } = fixture([{ x: 0, z: 0, radius: .5, height: 3 }]);
  Object.assign(player, { x: -2, y: 3.2, grounded: false, airOrigin: 3.2 });
  world.time = .5;
  send(0, 0, 0, { motionTime: .5 });
  assert.equal(player.correctionId, 1, 'a high sweep cannot hide an endpoint inside a solid body');
});

test('real rock-side motion retains its tangent and a steep front cannot become a staircase', () => {
  const world = new World({ bots: false }), p = world.addPlayer('p', 'P');
  Object.assign(p, { x: 25, z: -28.7, y: world.valley.height(25, -28.7) });
  resetMotion(p, 0, world.round);
  let distance = 0;
  for (let frame = 0; frame < 240; frame++) {
    const before = { ...p };
    integrateMotion(world, p, { x: .8384436163, z: .5449883506, sprint: true }, 1 / 120);
    distance += Math.hypot(p.x - before.x, p.z - before.z);
    const clear = world.valley.move(p, 0, 0);
    assert.ok(Math.hypot(clear.x - p.x, clear.z - p.z) < .03, 'retained tangent does not pass through the boulder');
  }
  assert.ok(distance > 10, 'the two-second strafe continues around the authored rock');
  Object.assign(p, { x: -15, z: -8.81, y: world.valley.height(-15, -8.81) });
  resetMotion(p, 0, world.round);
  let highest = p.y;
  for (let frame = 0; frame < 720; frame++) {
    integrateMotion(world, p, { x: 0, z: -1, sprint: true }, 1 / 120);
    highest = Math.max(highest, p.y);
  }
  assert.ok(highest < 2.6, 'holding forward does not walk to the 4.77m rock top');
});

test('captured rising jumps beside rock zero sweep at changing feet without phantom overhang collisions', () => {
  const cases = [
    { seq: 1856, time: 102.82634735107422, dt: .05560302734375,
      from: [-14.63715648651123, 1.2003827095031738, -12.8079252243042],
      to: [-14.889310836791992, 1.6186470985412598, -12.909186363220215], vy: 3.4873031417118896, origin: 1.0068239757083588 },
    { seq: 1865, time: 103.32647705078125, dt: .0554046630859375,
      from: [-16.15781021118164, 1.365633487701416, -13.093389511108398],
      to: [-16.522504806518555, 1.7823915481567383, -13.059223175048828], vy: 1.6301454445664105, origin: 1.191262765797439 },
  ];
  for (const c of cases) {
    const world = new World({ bots: false }), p = world.addPlayer('p', 'P');
    Object.assign(p, { x: c.from[0], y: c.from[1], z: c.from[2], grounded: false,
      velocityY: c.vy, airOrigin: c.origin, motionTime: c.time, motionSeq: c.seq - 1 });
    const oldSweep = world.valley.move({ ...p, y: c.to[1] }, c.to[0] - p.x, c.to[2] - p.z);
    assert.ok(Math.hypot(oldSweep.x - c.to[0], oldSweep.z - c.to[2]) > .03, 'saved old failure reproduces on the real mesh');
    world.time = c.time + c.dt; p.motionBudgetAt = c.time;
    p.input = { x: -.7001514434814453, z: .7139943838119507, sprint: true };
    receiveMotion(world, p, { motionSeq: c.seq, motionRound: world.round, motionTime: c.time + c.dt,
      px: c.to[0], py: c.to[1], pz: c.to[2], correctionId: 0, impulseId: 0 });
    assert.equal(p.correctionId, 0, `captured normal rising pose ${c.seq}`);
  }
});

test('changing-height sweep still rejects rising through a high wall or ending inside it', () => {
  for (const x of [0, 2]) {
    const { world, player, send } = fixture([{ x: 0, z: 0, radius: .5, height: 3 }]);
    Object.assign(player, { x: -2, y: .2, grounded: false, airOrigin: .2, velocityY: 8.4 });
    world.time = .5;
    send(x, .9, 0, { motionTime: .5, x: 1, sprint: true });
    assert.equal(player.correctionId, 1, 'a valid rising endpoint cannot excuse a solid wall crossing');
  }
});

test('melee acceleration is 1.4x, expires without stacking, and resets for the next round', () => {
  const { world, player } = fixture();
  const normal = world.addPlayer('normal', 'Normal');
  Object.assign(normal, { x: 0, y: 0, z: 10 });
  player.meleeBoostUntil = 2;
  for (let i = 0; i < 20; i++) {
    world.time = i * .05;
    integrateMotion(world, player, { x: 1, z: 0 }, .05);
    integrateMotion(world, normal, { x: 1, z: 0 }, .05);
  }
  assert.ok(Math.abs(player.x / normal.x - 1.4) < .00001);
  const boosted = player.motionVX;
  world.time = 2;
  for (let i = 0; i < 20; i++) integrateMotion(world, player, { x: 1, z: 0 }, .05);
  assert.ok(player.motionVX < boosted);
  assert.ok(Math.abs(player.motionVX - normal.motionVX) < .0001);
  resetMotion(player, 0, world.round + 1);
  assert.equal(player.meleeBoostUntil, 0);
});
