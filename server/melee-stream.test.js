import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import WebSocket from 'ws';
import { World } from './game.js';
import { Valley, VALLEY } from './valley.js';
import { createGameServer } from './index.js';
import { combatPose, playerRayHit } from './melee.js';

// Mirrors RemotePlayerTrack and AnimateWalkers, using the very same snapshot
// pair for the displayed body and its transmitted viewed timestamp.
function sampleRemote(samples, time) {
  if (time <= samples[0].time) return { ...samples[0] };
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i]; if (time > b.time) continue;
    const blend = Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time)));
    return { time: a.time + (b.time - a.time) * blend,
      x: a.x + (b.x - a.x) * blend, y: a.y + (b.y - a.y) * blend, z: a.z + (b.z - a.z) * blend };
  }
  return { ...samples.at(-1) };
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 2500) {
  const deadline = performance.now() + timeout;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for delayed melee state');
    await pause(5);
  }
}
const bridgeSource = readFileSync(new URL('../Unity/Assets/Plugins/WebGL/OrbitSocket.jslib', import.meta.url), 'utf8');

// Use the real browser bridge and real ordered WebSockets. Only delivery time and the Unity
// receive/render callbacks are controlled; this is not a WebGL frame-rate or audio measurement.
function delayedPeer(port, delays, name) {
  const timers = new Set(), sockets = [], players = new Map(), poses = new Map(), seen = new Set();
  const peer = { id: '', time: 0, events: [], views: new Map(), attack: 0, incoming: 0, outgoing: 0, consumed: 0 };
  const later = (fn, ms) => {
    const timer = setTimeout(() => { timers.delete(timer); fn(); }, Math.max(0, ms)); timers.add(timer);
  };
  const ordered = (key, deliver) => {
    const queue = []; let scheduled = false, lastDue = 0;
    const pump = () => {
      if (scheduled || !queue.length) return;
      scheduled = true;
      later(() => { deliver(queue.shift().value); scheduled = false; pump(); }, queue[0].due - performance.now());
    };
    return value => {
      lastDue = Math.max(lastDue, performance.now() + delays[peer[key]++ % delays.length]);
      queue.push({ value, due: lastDue }); pump();
    };
  };
  class DelayedSocket {
    constructor(url) {
      this.socket = new WebSocket(url); sockets.push(this.socket);
      this.send = ordered('outgoing', text => { if (this.socket.readyState === 1) this.socket.send(text); });
      const receive = ordered('incoming', data => this.onmessage?.({ data }));
      this.socket.on('open', () => this.onopen?.());
      this.socket.on('message', bytes => receive(bytes.toString()));
      this.socket.on('close', () => this.onclose?.());
      this.socket.on('error', () => this.onerror?.());
    }
    get readyState() { return this.socket.readyState; }
    get bufferedAmount() { return this.socket.bufferedAmount; }
    close() { this.socket.close(); }
  }
  let library;
  const noop = () => {};
  const send = packet => library.OrbitSend(JSON.stringify({ type: 'input', miningOnly: true, ...packet }));
  const receive = (_, method, json) => {
    if (method === 'SocketOpened') { library.OrbitSend(JSON.stringify({ type: 'join', protocol: 2, name })); return; }
    if (method !== 'SocketMessage') return;
    const frame = JSON.parse(json);
    if (frame.type === 'welcome') { peer.id = frame.id; return; }
    if (frame.type !== 'frame') return;
    peer.consumed++;
    if (frame.full) { players.clear(); poses.clear(); peer.views.clear(); }
    for (const id of frame.removedPlayers || []) { players.delete(id); poses.delete(id); peer.views.delete(id); }
    for (const row of frame.players || []) players.set(row.id, row);
    for (const row of frame.poses || []) poses.set(row.id, row);
    for (const [id, pose] of poses) {
      const player = players.get(id);
      if (!player) continue;
      Object.assign(player, pose);
      let view = peer.views.get(id);
      if (!view) { view = { x: pose.x, y: pose.y, z: pose.z, time: frame.serverTime, samples: [] }; peer.views.set(id, view); }
      const sample = { x: player.x, y: player.y, z: player.z, time: frame.serverTime }, last = view.samples.at(-1);
      if (last && (sample.time < last.time || Math.hypot(sample.x-last.x,sample.y-last.y,sample.z-last.z)>2)) view.samples=[];
      if (view.samples.at(-1)?.time === sample.time) view.samples[view.samples.length-1]=sample;
      else view.samples.push(sample);
      while(view.samples.length>2&&view.samples[1].time<sample.time-.4)view.samples.shift();
    }
    peer.time = frame.serverTime;
    peer.receivedAt = performance.now();
    for (const event of frame.events || []) {
      assert.ok(!seen.has(event.id), 'the ordered stream must not replay an event');
      seen.add(event.id); peer.events.push({ ...event, received: performance.now() });
    }
  };
  const context = { LibraryManager: { library: {} }, mergeInto: (_, x) => library = x, UTF8ToString: x => x,
    Module: { canvas: { addEventListener: noop, removeEventListener: noop } },
    window: { addEventListener: noop, removeEventListener: noop },
    document: { addEventListener: noop, removeEventListener: noop, hasFocus: () => true },
    location: { protocol: 'http:', host: `127.0.0.1:${port}` }, WebSocket: DelayedSocket, SendMessage: receive, console };
  vm.runInNewContext(bridgeSource, context);
  library.OrbitConnect('OrbitClient');
  const render = setInterval(() => {
    library.OrbitPoll();
    const viewed = peer.time + Math.min((performance.now() - peer.receivedAt) / 1000, .075) - .075;
    for (const view of peer.views.values()) {
      Object.assign(view,sampleRemote(view.samples,viewed));
    }
  }, 16);
  const acknowledge = setInterval(() => { if (peer.id) send({}); }, 50);
  peer.send = send;
  peer.press = targetId => {
    const eye = peer.views.get(peer.id), target = peer.views.get(targetId);
    const dx = target.x - eye.x, dz = target.z - eye.z, length = Math.hypot(dx, dz);
    const attackId = ++peer.attack, sent = performance.now();
    send({ attackId, attackTime: target.time, attackAx: dx / length, attackAy: 0,
      attackAz: dz / length, ax: dx / length, az: dz / length });
    return { attackId, sent, viewTime: target.time, z: target.z };
  };
  peer.stop = () => {
    clearInterval(render); clearInterval(acknowledge);
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.terminate();
  };
  return peer;
}

test('a knockback-speed turn has an exact server pose for every displayed body, without enlarging reach', () => {
  const samples = [], eye = { x:0,y:1.62,z:0 };
  let goal = { x:2.6,y:0,z:-5.4 }, shown = { ...goal }, shownTime = 0, latest = 0;
  let oldMisses = 0, checked = 0;
  for (let frame = 1; frame <= 180; frame++) {
    const now = frame / 60;
    if (frame % 3 === 0) {
      const phase=now%.6;
      goal={x:2.6,y:0,z:((phase<.3?phase:.6-phase)-.3)*18}; latest=now;
      samples.push({time:now,...goal});
    }
    const blend=1-Math.exp(-.25);
    for(const axis of ['x','y','z'])shown[axis]+=(goal[axis]-shown[axis])*blend;
    shownTime+=(latest-shownTime)*blend;
    if(now<.7)continue;
    const body={...goal,combatHistory:samples};
    const oldPose=combatPose(body,shownTime), oldLength=Math.hypot(shown.x,shown.z);
    const oldRay={x:shown.x/oldLength,y:0,z:shown.z/oldLength};
    if(playerRayHit(eye,oldRay,shown)<=3&&playerRayHit(eye,oldRay,oldPose)>3)oldMisses++;
    const visible=sampleRemote(samples,latest+Math.min(now-latest,.075)-.075);
    const authoritative=combatPose(body,visible.time);
    assert.ok(Math.hypot(visible.x-authoritative.x,visible.y-authoritative.y,visible.z-authoritative.z)<1e-8);
    const length=Math.hypot(visible.x,visible.z), ray={x:visible.x/length,y:0,z:visible.z/length};
    if(playerRayHit(eye,ray,visible)<=3){checked++;assert.ok(playerRayHit(eye,ray,authoritative)<=3+1e-8);}
  }
  assert.ok(oldMisses>0,'the former exponential body/time blend reproduces visible hits rejected at a turn');
  assert.ok(checked>40);
});

for (const [profile, delays] of [['50–80ms RTT with jitter', [25, 40, 30, 35]],
  ['60–120ms RTT with jitter', [30, 60, 40, 50]],
  ['80–160ms RTT with jitter', [40, 80, 50, 70]]]) {
  test(`delta stream melee: crossing target and burst-to-single under ${profile}`, async t => {
    const valley = new Valley({ ...VALLEY, heights: VALLEY.heights.map(() => 0), colliders: [],
      deposits: [{ ...VALLEY.deposits[0], x: 15, z: 0 }] });
    const world = new World({ bots: false, valley });
    const app = createGameServer({ world });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const peers = [delayedPeer(app.server.address().port, delays, 'Clicker'),
      delayedPeer(app.server.address().port, [...delays].reverse(), 'Crossing rival')];
    t.after(async () => { for (const peer of peers) peer.stop(); await app.stop(); });
    const arrivals = [];
    const input = world.input.bind(world);
    world.input = (id, packet) => {
      const player = world.players.get(id), before = player?.pendingAttacks.length;
      input(id, packet);
      if (packet.attackId) arrivals.push({ id: packet.attackId, age: world.time - packet.attackTime,
        accepted: player.pendingAttacks.length > before });
    };
    await until(() => peers.every(p => p.id && p.views.size === 2));
    const [a, b] = peers, actor = world.players.get(a.id), victim = world.players.get(b.id);
    Object.assign(actor, { x: 20, y: 0, z: -10 });
    Object.assign(victim, { x: 22.6, y: 0, z: -11.2 });
    await pause(650);
    let seq = 0, motionTime = 0, z = victim.z;
    const movement = setInterval(() => {
      motionTime += .05; z += .21;
      b.send({ x: 0, z: 1, ax: 1, az: 0, motionSeq: ++seq, motionRound: world.round,
        motionTime, correctionId: victim.correctionId, impulseId: victim.impulseId, px: 22.6, py: 0, pz: z });
    }, 50);
    t.after(() => clearInterval(movement));
    await until(() => a.views.get(b.id).z > -10.15);
    const crossing = a.press(b.id);
    try { await until(() => peers.every(p => p.events.some(e => e.type === 'hit' && e.actorId === a.id))); }
    catch (error) {
      error.message += ' ' + JSON.stringify({ arrivals, crossing, victim: { x: victim.x, y: victim.y, z: victim.z }, events: a.events });
      throw error;
    }
    clearInterval(movement);
    const first = a.events.find(e => e.type === 'hit' && e.actorId === a.id);
    assert.equal(first.id, b.events.find(e => e.type === 'hit' && e.actorId === a.id).id);
    assert.ok(first.received - crossing.sent < 400);
    assert.ok(app.networkStats.maxOutstanding <= 3);
    // Fixture alignment for repeated timing checks; all attack traffic still uses the real delayed bridge.
    Object.assign(victim, { x: 22.6, y: 0, z: -10 });
    await pause(700);
    const burstStarted = performance.now(), beforeFrames = a.consumed;
    for (let i = 0; i < 40; i++) { a.press(b.id); await pause(50); }
    const burstConsumedHz = (a.consumed - beforeFrames) / ((performance.now() - burstStarted) / 1000);
    await pause(650);
    const before = a.events.filter(e => e.type === 'swing' && e.actorId === a.id).length;
    const single = a.press(b.id);
    await until(() => a.events.filter(e => e.type === 'swing' && e.actorId === a.id).length === before + 1);
    const singleEvent = a.events.filter(e => e.type === 'swing' && e.actorId === a.id).at(-1);
    assert.ok(singleEvent.received - single.sent < 400, 'a fresh press must not wait behind the preceding burst');
    await pause(450);
    assert.equal(a.events.filter(e => e.type === 'swing' && e.actorId === a.id).length, before + 1,
      'no old swings may arrive after the fresh single press');
    t.diagnostic(JSON.stringify({ profile, crossingMs: Math.round(first.received - crossing.sent),
      singleMs: Math.round(singleEvent.received - single.sent), attackViewAgesMs: arrivals.map(x => Math.round(x.age * 1000)),
      rejected: arrivals.filter(x => !x.accepted).length,
      burstConsumedHz: +burstConsumedHz.toFixed(2),
      maxOutstanding: app.networkStats.maxOutstanding, coalescedFrames: app.networkStats.coalescedFrames }));
  });
}
