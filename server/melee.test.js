import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { World } from './game.js';
import { Valley, VALLEY } from './valley.js';
import { MELEE, playerRayHit, hitPlayer, acceptHurt, baseKnockback } from './melee.js';
import { createGameServer } from './index.js';
import { StateStream, prepareFrame } from './stream.js';

const flat = new Valley({ ...VALLEY, heights: VALLEY.heights.map(() => 0), colliders: [] });
const point = { x: 21, y: 1, z: -10 };
function pair(valley = flat) {
  const world = new World({ bots: false, valley });
  const a = world.addPlayer('a', 'A'), b = world.addPlayer('b', 'B');
  Object.assign(a, { x: 20, y: 0, z: -10 });
  Object.assign(b, { x: 22, y: 0, z: -10 });
  return { world, a, b };
}

test('wider character selection uses a 0.72x1.8 AABB with 0.1 border and three metre ray reach', () => {
  const eye = { x: 0, y: 1.62, z: 0 }, ray = { x: 1, y: 0, z: 0 };
  assert.ok(Math.abs(playerRayHit(eye, ray, { x: 3.46, y: 0, z: 0 }) - 3) < 1e-9);
  assert.ok(playerRayHit(eye, ray, { x: 3.461, y: 0, z: 0 }) > MELEE.reach);
  assert.ok(Number.isFinite(playerRayHit(eye, ray, { x: 2, y: 0, z: .459 })));
  assert.equal(playerRayHit(eye, ray, { x: 2, y: 0, z: .461 }), Infinity);
  const { world, a, b } = pair();
  b.x = 23.461;
  world.strike(a, { ax: 1, ay: 0, az: 0 });
  assert.equal(b.impulseId, 0, 'the actual server rejects just outside the ray reach');
  b.x = 23.46;
  world.strike(a, { ax: 1, ay: 0, az: 0 });
  assert.equal(b.impulseId, 1, 'the exact three metre ray boundary is accepted');
});

test('base and sprint knockback match 1.8.9 composition, including airborne Y and sprint reset', () => {
  const { world, a, b } = pair();
  Object.assign(b, { velocityX: 4, velocityY: -4, velocityZ: 2, motionVX: 4, motionVY: -4, motionVZ: 2, grounded: false });
  hitPlayer(world, a, b, point, { ax: 1, az: 0 });
  assert.deepEqual([b.impulseX, b.impulseY, b.impulseZ], [10, 6, 1]);
  assert.equal(b.bag.length, 0, 'an empty bag still receives a real hit and impulse');
  world.time = .5;
  Object.assign(a, { sprinting: true, velocityX: 5, velocityY: 0, velocityZ: 0, motionVX: 5, motionVY: 0, motionVZ: 0 });
  Object.assign(b, { velocityX: 0, velocityY: 0, velocityZ: 0, motionVX: 0, motionVY: 0, motionVZ: 0 });
  hitPlayer(world, a, b, point, { ax: 1, az: 0 });
  assert.deepEqual([b.impulseX, b.impulseY, b.impulseZ], [18, 10, 0]);
  assert.equal(a.impulseX, 3);
  assert.equal(a.sprinting, false);
  assert.equal(a.sprintSuppressed, true);
});

test('knockback halves current physics momentum while pose-owned clients ignore old impulse state', () => {
  const { a, b } = pair();
  Object.assign(b, { velocityX: 5, motionVX: 2.73, motionVY: -4, motionVZ: 2 });
  assert.deepEqual(baseKnockback(a, b), { vx: 9.365, vy: 6, vz: 1 });
  Object.assign(b, { clientMotion: true, velocityY: -2, velocityZ: 0, motionVX: 100 });
  assert.deepEqual(baseKnockback(a, b), { vx: 10.5, vy: 7, vz: 0 });
});

test('a vertical three-block body ray retains finite yaw-directed knockback', () => {
  const { world, a, b } = pair();
  Object.assign(a, { sprinting: true, yaw: Math.PI / 2 });
  Object.assign(b, { x: a.x, y: 2, z: a.z, bag: ['gold'] });
  world.strike(a, { ax: 0, ay: 1, az: 0 });
  assert.ok(Math.abs(b.impulseX - 18) < 1e-9);
  assert.ok(Math.abs(b.impulseZ) < 1e-9);
  assert.equal(b.impulseY, 10);
  assert.equal(a.bag.length, 1);
});

test('stronger hurt does not extend its deadline and sprint plus falling critical retains both facts', () => {
  const victim = { hurtUntil: 0, lastHitDamage: 0 }, clock = { time: 0 };
  assert.deepEqual(acceptHurt(clock, victim, 1), { fresh: true });
  clock.time = .25;
  assert.equal(acceptHurt(clock, victim, 1), null);
  assert.deepEqual(acceptHurt(clock, victim, 1.5), { fresh: false });
  assert.equal(victim.hurtUntil, .5);
  assert.equal(acceptHurt(clock, victim, 1.5), null);
  const { world, a, b } = pair();
  Object.assign(a, { sprinting: true, grounded: false, velocityY: -1, motionVY: -1 });
  b.bag = ['gold'];
  hitPlayer(world, a, b, point, { ax: 1, az: 0 });
  const event = world.events.find(e => e.type === 'hit');
  assert.equal(event.kind, 'sprint'); assert.equal(event.critical, true);
  assert.equal(a.bag.length, 1);
});

test('rapid presses preserve click aim, deduplicate IDs, and use hurt immunity rather than mining cooldown', () => {
  const { world, a, b } = pair();
  a.nextStrike = 100;
  b.bag = ['gold', 'gold', 'gold'];
  const press = id => world.input(a.id, { attackId: id, attackTime: world.time,
    attackAx: 1, attackAy: 0, attackAz: 0, ax: 1, az: 0, miningOnly: true });
  press(1);
  world.input(a.id, { ax: -1, az: 0, miningOnly: true });
  world.tick(.05);
  assert.equal(world.events.filter(e => e.type === 'hit').length, 1);
  assert.equal(b.bag.length, 2);
  const impulse = b.impulseId;
  press(1); press(2); world.tick(.05);
  assert.equal(b.impulseId, impulse, 'equal hits inside ten ticks do not reapply knockback');
  assert.equal(world.events.filter(e => e.type === 'guarded').length, 1);
  world.time = .55;
  // Keep this isolated timing check at the original distance; integration below moves real clients.
  Object.assign(b, { x: 22, y: 0, z: -10, externalX: 0, externalY: 0, externalZ: 0 });
  press(3); world.tick(.05);
  assert.equal(b.impulseId, impulse + 1, 'another press after ten ticks works despite the pick cooldown');
  assert.equal(b.bag.length, 1, 'another accepted hit transfers another unit after the hurt window');
  assert.equal(world.events.filter(e => e.type === 'hit').at(-1).meleeReason, undefined);
});

test('confirmed hit explains why ore cannot transfer without removing its knockback', () => {
  for (const [bag, held, reason] of [
    [[], [], 'empty'], [['gold'], Array(8).fill('copper'), 'full']
  ]) {
    const { world, a, b } = pair();
    a.bag = held; b.bag = bag;
    hitPlayer(world, a, b, point, { ax: 1, az: 0 });
    assert.equal(world.events.find(e => e.type === 'hit').meleeReason, reason);
    assert.equal(b.impulseId, 1);
    assert.equal(world.events.filter(e => e.type === 'steal').length, 0);
  }
});

test('guard feedback does not reject a stronger falling critical during the hurt window', () => {
  const { world, a, b } = pair();
  b.bag = ['gold', 'gold', 'gold'];
  hitPlayer(world, a, b, point, { ax: 1, az: 0 });
  const impulse = b.impulseId;
  world.time = .1;
  hitPlayer(world, a, b, point, { ax: 1, az: 0 });
  hitPlayer(world, a, b, point, { ax: 1, az: 0 });
  assert.equal(world.events.filter(e => e.type === 'guarded').length, 1, 'rejected bursts are rate limited');
  Object.assign(a, { grounded: false, velocityY: -1 });
  hitPlayer(world, a, b, point, { ax: 1, az: 0 });
  assert.equal(world.events.filter(e => e.type === 'hit').at(-1).kind, 'critical');
  assert.equal(b.impulseId, impulse, 'a stronger critical adds no second base impulse');
});

test('protected or obstructed players cannot be knocked back, stale rewind is rejected', () => {
  const { world, a, b } = pair();
  const station = world.stations[0];
  Object.assign(a, { x: station.x, z: station.z });
  Object.assign(b, { x: station.x + 1, z: station.z });
  hitPlayer(world, a, b, point, { ax: 1, az: 0 });
  assert.equal(b.impulseId, 0);
  assert.equal(world.events.at(-1).type, 'protected');
  const cover = new Valley({ ...flat.data, colliders: [{ x: 21, z: -10, radius: .2, height: 3 }] });
  const blocked = pair(cover);
  blocked.world.strike(blocked.a, { ax: 1, ay: 0, az: 0 });
  assert.equal(blocked.b.impulseId, 0);
  world.time = 1;
  world.input(a.id, { attackId: 4, attackTime: .7, ax: 1, az: 0 });
  assert.equal(a.pendingAttacks.length, 0);
});

test('a selected exposed head does not fail a second ray aimed at its covered torso', () => {
  const cover = new Valley({ ...flat.data, colliders: [{ id:'low-cover',kind:'trunk',x:21,z:-10,radius:.25,height:1.45 }] });
  const {world,a,b}=pair(cover);
  assert.ok(world.valley.rayDistance(world.eyes(a),{x:1,y:0,z:0},3)>=3);
  world.strike(a,{ax:1,ay:0,az:0});
  assert.equal(b.impulseId,1,'the visible upper body remains a real three-metre selection');
});

test('rewind cannot attack from an old eye after the attacker has moved behind current cover', () => {
  const cover=new Valley({...flat.data,colliders:[{id:'corner',kind:'trunk',x:20.8,z:-10.5,radius:.2,height:3}]});
  const {world,a,b}=pair(cover),eye=world.eyes(a);
  a.z=-11;
  world.strike(a,{eye,ax:1,ay:0,az:0,viewTime:world.time});
  assert.equal(b.impulseId,0);
});

test('an empty miss does not swallow the next correctly aimed entity press', () => {
  const {world,a,b}=pair();
  world.input(a.id,{attackId:1,attackTime:world.time,attackAx:-1,attackAy:0,attackAz:0,miningOnly:true});
  world.tick(.05);
  assert.ok(a.missAttackUntil>world.time);
  world.input(a.id,{attackId:2,attackTime:world.time,attackAx:-1,attackAy:0,attackAz:0,miningOnly:true});
  world.tick(.05);
  assert.equal(world.events.filter(e=>e.type==='swing').length,1,'an unaccepted repeated miss emits no remote swing');
  world.input(a.id,{attackId:3,attackTime:world.time,attackAx:1,attackAy:0,attackAz:0,miningOnly:true});
  world.tick(.05);
  assert.equal(b.impulseId,1);
  assert.equal(world.events.filter(e=>e.type==='swing').length,2);
});

test('hurt rejection and expired viewed-time feedback remain distinct without a theft timer', () => {
  const {world,a,b}=pair(); b.bag=['gold','gold','gold'];
  hitPlayer(world,a,b,point,{ax:1,az:0});
  let row=world.snapshot(a.id).players.find(p=>p.id===b.id);
  assert.equal(row.hurtUntil,.5);assert.equal(row.invuln,0);
  world.time=.1;hitPlayer(world,a,b,point,{ax:1,az:0});
  assert.equal(world.events.at(-1).type,'guarded');assert.equal(world.events.at(-1).meleeReason,'hurt');
  world.time=.6;row=world.snapshot(a.id).players.find(p=>p.id===b.id);
  assert.ok(row.hurtUntil<=world.time);assert.equal(row.invuln,0);
  world.time=1;
  for(let attackId=1;attackId<=3;attackId++)world.input(a.id,{attackId,attackTime:.7,attackAx:1,attackAy:0,attackAz:0});
  assert.equal(a.pendingAttacks.length,0);
  assert.equal(world.events.filter(e=>e.type==='guarded'&&e.meleeReason==='late').length,1);
});

test('the hurt deadline changes once per hit rather than resending player metadata every tick', () => {
  const {world,a,b}=pair();world.time=1;
  hitPlayer(world,a,b,point,{ax:1,az:0});
  const stream=new StateStream();
  let frame=stream.frame(prepareFrame(world.snapshot(a.id)),a.id,[]);stream.acknowledge(frame.seq);
  assert.equal(frame.players.find(p=>p.id===b.id).hurtUntil,1.5);
  for(let i=0;i<8;i++){
    world.time+=.05;
    frame=stream.frame(prepareFrame(world.snapshot(a.id)),a.id,[]);
    assert.equal(frame.players,undefined);stream.acknowledge(frame.seq);
  }
});

test('a valid near-limit viewed hit survives the next tick, while an old queued click cannot replay before a new press', () => {
  const { world, a, b } = pair();
  world.time = 1;
  b.combatHistory = [.75, 1].map(time => ({ time, x: b.x, y: b.y, z: b.z }));
  const press = (attackId, attackTime = world.time) => world.input(a.id, {
    attackId, attackTime, attackAx: 1, attackAy: 0, attackAz: 0, miningOnly: true, ax: 1, az: 0 });
  press(1, .76); // Valid when received, but its viewed pose is older than 250ms at the next simulation tick.
  assert.equal(a.pendingAttacks.length, 1);
  world.tick(.05);
  assert.equal(world.events.filter(e => e.type === 'hit').length, 1);
  press(2);
  world.advanceClock(.4);
  world.tick(.05);
  assert.equal(world.events.filter(e => e.type === 'swing').length, 1, 'an obsolete queued click is not replayed');
  press(3);
  world.tick(.05);
  assert.equal(world.events.filter(e => e.type === 'swing').length, 2);
  assert.equal(world.events.filter(e => e.type === 'hit').length, 2, 'the fresh single press is not lost behind the obsolete click');
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = performance.now() + 2000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for ordinary socket state');
    await sleep(5);
  }
}

test('two ordinary sockets hit a moving opponent at the viewed pose after 150ms delay, once on both views', async () => {
  const world = new World({ bots: false, valley: flat });
  const app = createGameServer({ world });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const peers = [];
  try {
    for (const name of ['Attacker', 'Moving rival']) {
      const socket = new WebSocket(`ws://127.0.0.1:${app.server.address().port}/ws`);
      const peer = { socket, id: '', state: null };
      peers.push(peer);
      socket.on('message', data => {
        const packet = JSON.parse(data);
        if (packet.type === 'welcome') peer.id = packet.id;
        if (packet.type === 'state') peer.state = packet;
      });
      await once(socket, 'open');
      socket.send(JSON.stringify({ type: 'join', name }));
      await until(() => peer.id && peer.state);
    }
    const [a, b] = peers;
    Object.assign(world.players.get(a.id), { x: 20, y: 0, z: -10 });
    Object.assign(world.players.get(b.id), { x: 23.2, y: 0, z: -10 });
    await sleep(350); // Discard the spawn-to-fixture discontinuity from the bounded pose history.
    const viewed = a.state;
    const target = viewed.players.find(p => p.id === b.id);
    let seq = 0, motionTime = 0;
    for (let i = 1; i <= 3; i++) {
      motionTime += .05;
      b.socket.send(JSON.stringify({ type: 'input', x: 0, z: 1, ax: 1, az: 0,
        motionSeq: ++seq, motionRound: world.round, motionTime, correctionId: 0, impulseId: 0,
        px: target.x, py: 0, pz: target.z + i * .21 }));
      await sleep(50);
    }
    assert.ok(world.players.get(b.id).z - target.z > .4, 'the opponent has moved outside the original ray');
    const attack = { type: 'input', miningOnly: true, attackId: 1, attackTime: viewed.serverTime,
      attackAx: 1, attackAy: 0, attackAz: 0, ax: 1, az: 0 };
    a.socket.send(JSON.stringify(attack));
    await until(() => peers.every(p => p.state.events.some(e => e.type === 'hit' && e.actorId === a.id)));
    const eventA = a.state.events.find(e => e.type === 'hit' && e.actorId === a.id);
    const eventB = b.state.events.find(e => e.type === 'hit' && e.actorId === a.id);
    assert.equal(eventA.id, eventB.id);
    assert.equal(eventA.targetId, b.id);
    assert.equal(world.players.get(b.id).impulseId, 1);
    a.socket.send(JSON.stringify(attack));
    await sleep(80);
    assert.equal(world.players.get(b.id).impulseId, 1, 'retransmission cannot duplicate the attack');
    assert.equal(world.players.get(a.id).bag.length, 0);
  } finally {
    for (const peer of peers) peer.socket.terminate();
    await app.stop();
  }
});


test('the 250ms rewind boundary uses snapshot millisecond precision, including the real Unity float32 timestamp', () => {
  assert.equal(MELEE.rewindSeconds,.25);
  for(const [time,accepted] of [[65.2,true],[65.19999694824219,true],[65.199,false],[65.175,false]]) {
    const {world,a,b}=pair();world.time=65.45;b.bag=['copper'];
    b.combatHistory=[{time:65.15,x:b.x,y:b.y,z:b.z},{time:65.45,x:b.x,y:b.y,z:b.z}];
    world.input(a.id,{attackId:1,attackTime:time,attackAx:1,attackAy:0,attackAz:0,ax:1,ay:0,az:0});
    assert.equal(a.pendingAttacks.length,accepted?1:0,`age ${(world.time-time)*1000}ms`);
    if(accepted) {world.tick(.05);assert.equal(world.events.filter(e=>e.type==='hit').length,1);assert.equal(a.bag.length,1);}
    else {assert.equal(world.events.at(-1).meleeReason,'late');assert.equal(b.impulseId,0);}
  }
});

test('valid empty-bag melee grants one timed speed effect, rejected hits do not refresh it', () => {
  const { world, a, b } = pair();
  hitPlayer(world, a, b, point, { ax: 1, az: 0 });
  assert.equal(a.meleeBoostUntil, 2);
  world.time = .2;
  hitPlayer(world, a, b, point, { ax: 1, az: 0 });
  assert.equal(a.meleeBoostUntil, 2, 'equal hit during hurt immunity is not a new hit');
  world.time = .6;
  hitPlayer(world, a, b, point, { ax: 1, az: 0 });
  assert.equal(a.meleeBoostUntil, 2.6, 'a new hit refreshes, never adds two seconds');
  const station = world.stations[0];
  Object.assign(b, { x: station.x, z: station.z });
  world.time = 1.2;
  hitPlayer(world, a, b, point, { ax: 1, az: 0 });
  assert.equal(a.meleeBoostUntil, 2.6, 'protected hit gives no speed');
  assert.equal(world.snapshot(a.id).players.find(p => p.id === a.id).meleeBoostUntil, 2.6);
});
