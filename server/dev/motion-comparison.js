// Reproducible network ownership comparison, not a rendered Unity playtest.
// Both versions use the same flat 4.317m/s input path to isolate correction from the speed redesign.
import { World } from '../game.js';
import { Valley, VALLEY } from '../valley.js';
import { pathToFileURL } from 'node:url';
const dt = 1 / 120, speed = 4.317;
const valley = new Valley({ ...VALLEY, heights: VALLEY.heights.map(() => 0), colliders: [], deposits: [] });

function run(modern, delay, stall) {
  const world = new World({ bots: false, valley }), p = world.addPlayer('p', 'P');
  Object.assign(p, { x: 0, y: 0, z: 0 });
  let local = 0, seq = 0, move = 0, lastInput = -100, previousDelivery = 0;
  const inputs = [], snapshots = [];
  let corrections = 0, correctionDistance = 0, postStopCorrection = 0, maxError = 0;
  for (let frame = 0; frame <= 5 * 120; frame++) {
    const t = frame * dt, moving = t < 2;
    local += moving ? speed * dt : 0;
    if (frame % 6 === 0) {
      const arrives = Math.max(previousDelivery, t + delay + (t >= .9 && t < 1.5 ? stall : 0));
      previousDelivery = arrives;
      inputs.push({ arrives, motionSeq: ++seq, motionTime: t + dt, motionRound: world.round,
        correctionId: 0, impulseId: 0, px: local, py: 0, pz: 0, x: moving ? 1 : 0 });
    }
    while (inputs.length && inputs[0].arrives <= t + 1e-8) {
      const packet = inputs.shift();
      if (modern) world.input('p', packet);
      else { move = packet.x; lastInput = t; }
    }
    if (frame % 6 === 0) {
      if (modern) world.tick(.05);
      else p.x += t - lastInput <= .6 ? move * speed * .05 : 0;
      snapshots.push({ arrives: t + delay, x: p.x, correctionId: p.correctionId });
    }
    while (snapshots.length && snapshots[0].arrives <= t + 1e-8) {
      const snapshot = snapshots.shift();
      if (modern) { if (snapshot.correctionId) throw new Error('Valid path rejected'); }
      else {
        const shift = .22 * (snapshot.x - local);
        local += shift;
        if (Math.abs(shift) > .00001) corrections++;
        correctionDistance += Math.abs(shift);
        if (t >= 2.5) postStopCorrection += Math.abs(shift);
      }
    }
    maxError = Math.max(maxError, Math.abs(local - p.x));
  }
  const round = n => Math.round(n * 1000000) / 1000000;
  return { corrections, correctionDistance: round(correctionDistance),
    postStopCorrection: round(postStopCorrection), finalLocalX: round(local), finalServerX: round(p.x),
    finalError: round(Math.abs(local - p.x)), maxNetworkSeparation: round(maxError) };
}
// The client owns both time and pose. Authoritative positions are only ever consumed through
// the same explicit correction/impulse fields as Unity, never copied back each input frame.
export function runRecovery({ pause = 0, mode = 'network', knockback = false, clicks = 10 } = {}) {
  const world = new World({ bots: false, valley }), p = world.addPlayer('p', 'P');
  Object.assign(p, { x: 0, y: 0, z: 0, airOrigin: 0 });
  const client = { x: 0, y: 0, vx: 0, vy: 0, time: 0, tick: 0, grounded: true,
    correction: 0, impulse: 0, seq: 0, attack: 0, serverTime: 0 };
  const inputs = [], states = [], rejections = [], corrections = [], rejectionDetails = [];
  let nextSend = 0, nextClick = 0, nextState = 0, lastUp = 0, lastDown = 0, appliedKb = false;
  let movedAfterRecovery = 0, priorCorrection = 0;
  const end = 13, delay = .15, start = 2;
  const arrival = (t, direction) => {
    let target = t + delay;
    if (pause && t >= start && t < start + pause && (mode === 'network' || mode === direction))
      target = start + pause + delay;
    return target;
  };
  for (let frame = 0; frame <= end * 120; frame++) {
    const t = frame / 120, suspended = mode === 'client' && t >= start && t < start + pause;
    if (knockback && !appliedKb && t >= 2.1) { world.applyKnockback(p, 12, 8, 0); appliedKb = true; }
    while (inputs.length && inputs[0].arrives <= t + 1e-8) {
      const packet = inputs.shift().packet;
      const before = { x: p.x, y: p.y, motionTime: p.motionTime, airTime: p.airTime, budget: p.motionBudget };
      world.input('p', packet);
      if (p.correctionId > priorCorrection) {
        rejections.push(t); priorCorrection = p.correctionId;
        rejectionDetails.push({ t, ...before, px: packet.px, py: packet.py, clientTime: packet.motionTime });
      }
    }
    if (frame % 6 === 0) world.tick(.05);
    if (t + 1e-8 >= nextState) {
      nextState = t + .05;
      const arrives = Math.max(lastDown, arrival(t, 'down')); lastDown = arrives;
      states.push({ arrives, pose: { ...world.snapshot('p').players[0] }, serverTime: world.time });
    }
    if (!suspended) {
      // A browser main-thread stop coalesces queued state to the latest frame at resume.
      let newest;
      while (states.length && states[0].arrives <= t + 1e-8) newest = states.shift();
      if (newest) {
        const pose = newest.pose; client.serverTime = newest.serverTime;
        if (pose.correctionId > client.correction) {
          client.x += pose.correctionX; client.y += pose.correctionY;
          client.correction = pose.correctionId; corrections.push(t);
        }
        if (pose.impulseId > client.impulse) {
          client.vx = pose.impulseX; client.vy = pose.impulseY; client.tick = 0;
          client.grounded = false; client.impulse = pose.impulseId;
        }
      }
      const moving = t < 10;
      if (client.tick < 1e-8) {
        client.friction = client.grounded ? .546 : .91;
        if (moving) client.vx += client.grounded ? 1.96 : .392;
      }
      const before = client.x;
      client.x += client.vx / 120; client.y += client.vy / 120;
      if (client.y <= 0) { client.y = 0; client.vy = 0; client.grounded = true; }
      client.tick += 1 / 120; client.time += 1 / 120;
      if (client.tick >= .05 - 1e-8) {
        client.vx *= client.friction; if (Math.abs(client.vx) < .1) client.vx = 0;
        client.vy = client.grounded ? 0 : (client.vy - 1.6) * .98; client.tick = 0;
      }
      if (t > start + pause + 2 && moving) movedAfterRecovery += client.x - before;
      const click = t + 1e-8 >= nextClick;
      if (click) { nextClick = t + 1 / clicks; client.attack++; }
      if (click || t + 1e-8 >= nextSend) {
        nextSend = t + .05;
        const packet = { motionSeq: ++client.seq, motionRound: world.round, motionTime: client.time,
          correctionId: client.correction, impulseId: client.impulse, px: client.x, py: client.y, pz: 0,
          x: moving ? 1 : 0, z: 0, ax: 1, ay: 0, az: 0, miningOnly: true,
          attackId: client.attack, attackTime: client.serverTime, attackAx: 1, attackAy: 0, attackAz: 0 };
        const arrives = Math.max(lastUp, arrival(t, 'up')); lastUp = arrives;
        inputs.push({ arrives, packet });
        // A second attack send in the same rendered frame has zero pose/time delta.
        if (click) inputs.push({ arrives, packet: { ...packet, motionSeq: ++client.seq } });
      }
    }
  }
  return { mode, pause, knockback, clicks, rejections: rejections.length,
    lastRejection: rejections.at(-1) ?? null, corrections: corrections.length,
    lastCorrection: corrections.at(-1) ?? null, movedAfterRecovery,
    finalError: Math.abs(client.x - p.x), finalClient: client.x, finalServer: p.x, rejectionDetails };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const comparisons = [.15, .3].map(delay => ({ oneWayDelayMs: delay * 1000, inputStallMs: 600,
    before: run(false, delay, .6), after: run(true, delay, .6) }));
  const recovery = ['network', 'client', 'up', 'down'].flatMap(mode => [.25, 1, 3].flatMap(pause =>
    [false, true].map(knockback => runRecovery({ mode, pause, knockback }))));
  console.log(JSON.stringify({ condition: '120Hz independent client; 20Hz state; 10 clicks/s, same-frame duplicate sends; stop at 10s', comparisons, recovery }, null, 2));
}
