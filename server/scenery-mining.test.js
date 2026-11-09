import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { World } from './game.js';
import { Valley, VALLEY, terrain } from './valley.js';
import { rockRay } from './scenery-shape.js';
import { sceneryMiningHit, mineScenery, tickSceneryMining } from './scenery-mining.js';
import { StateStream, prepareFrame } from './stream.js';

function fixture() {
  const valley = new Valley({ ...VALLEY, heights: VALLEY.heights.map(() => 0),
    colliders: [{ id: 'rock-1', kind: 'rock', x: 0, z: 0, radius: 3, height: 4 }],
    deposits: [{ ...VALLEY.deposits[0], x: 45, z: 40 }] });
  const w = new World({ bots: false, valley }), p = w.addPlayer('a', 'A');
  return { w, p, rock: w.scenery[0] };
}
function surfacePlayer(w, p, rock, angle = 0) {
  const ray = { x: -Math.cos(angle), y: 0, z: -Math.sin(angle) };
  const far = { x: rock.shape.x - ray.x * 7, y: 1.62, z: rock.shape.z - ray.z * 7 };
  const face = rockRay(rock.shape, far, ray, 14);
  assert.ok(face, 'a side ray meets the actual imported mesh');
  Object.assign(p, { x: face.point.x - ray.x * 1.2, y: face.point.y - 1.62, z: face.point.z - ray.z * 1.2 });
  return { ax: ray.x, ay: 0, az: ray.z, miningOnly: true };
}
const length = (start, path) => path.reduce((sum, p) => {
  const d = Math.hypot(start.x - p.x, start.z - p.z); start = p; return sum + d;
}, 0);

test('canonical geometry records the imported minimum LOD and its exact FBX provenance', () => {
  const geometry = JSON.parse(readFileSync(new URL('../Unity/Assets/Resources/SceneryRock.json', import.meta.url), 'utf8'));
  assert.equal(geometry.mesh, 'boulder_01_LOD3');
  assert.equal(geometry.sourceSha256, createHash('sha256').update(readFileSync(new URL('../Unity/' + geometry.source, import.meta.url))).digest('hex'));
  assert.equal(geometry.triangles.length / 3, 8264);
  let covered = 0;
  for (let i = 0; i < geometry.nodes.length; i += 10) covered += geometry.nodes[i + 9];
  assert.equal(covered, geometry.triangles.length / 3);
});

test('all fourteen authored transforms expose their real surface from sixteen surrounding directions', () => {
  const w = new World({ bots: false });
  assert.equal(w.scenery.length, 14);
  for (const rock of w.scenery) for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI / 8, ray = { x: -Math.cos(angle), y: 0, z: -Math.sin(angle) };
    const origin = { x: rock.shape.x - ray.x * (rock.shape.radius + 3),
      y: w.valley.height(rock.shape.x, rock.shape.z) + 1.62,
      z: rock.shape.z - ray.z * (rock.shape.radius + 3) };
    const hit = rockRay(rock.shape, origin, ray, 12);
    assert.ok(hit && hit.distance > 0, rock.id + ' side ' + i);
    assert.ok(Math.abs(Math.hypot(hit.normal.x, hit.normal.y, hit.normal.z) - 1) < 1e-7);
  }
});

test('Lv1 mines every side, with an initial four-damage fragment and eight-damage deeper fragments', () => {
  const { w, p, rock } = fixture();
  for (let side = 0; side < 16; side++) {
    const aim = surfacePlayer(w, p, rock, side * Math.PI / 8);
    const before = rock.revision, count = p.bag.length;
    w.strike(p, aim);
    assert.equal(rock.revision, before + 1, `side ${side}`);
    w.strike(p, aim);
    assert.equal(rock.revision, before + 1, 'a second packet cannot bypass pick cooldown');
    assert.equal(p.bag.length, count + (side === 3 || side === 11 ? 1 : 0));
    w.time += 1;
  }
  assert.equal(p.bag.length, 2);
  const station = w.stations[0]; Object.assign(p, { x: station.x, y: 0, z: station.z });
  for (let i = 0; i < 31; i++) { w.input(p.id, { sell: true }); w.tick(.05); }
  assert.equal(p.score, 8, 'fragments use the real current copper quote');
  assert.equal(p.bag.length, 0);
  assert.ok(!rock.collapsed, 'ordinary scenery retains its body');
  assert.equal(rock.maxHp, 8);
  w.resetRound();
  assert.equal(rock.maxHp, 4); assert.equal(rock.hp, 4);
});

test('range, actual intervening cover and a full bag cannot mine scenery remotely', () => {
  const { w, p, rock } = fixture(), aim = surfacePlayer(w, p, rock);
  p.x += 3;
  w.strike(p, aim); assert.equal(rock.revision, 0);
  surfacePlayer(w, p, rock); p.bag = Array(8).fill('copper');
  w.time += 1; w.strike(p, aim); assert.equal(rock.revision, 0);
  p.bag = [];
  const eye = w.eyes(p), hit = sceneryMiningHit(w, eye, { x: aim.ax, y: 0, z: aim.az }, 2.7);
  assert.ok(hit);
  const barrier = { id: 'test-cover', kind: 'trunk', x: (eye.x + hit.point.x) / 2, z: eye.z,
    radius: .12, height: 4, base: 0 };
  w.valley.cover = [...w.valley.cover, barrier];
  w.time += 1; w.strike(p, aim); assert.equal(rock.revision, 0);
});

test('the two real passages shorten useful return routes, switch cached navigation, and reset per World', () => {
  const w = new World({ bots: false }), other = new World({ bots: false });
  const p = w.addPlayer('a', 'A');
  const cases = [['rock-0', { x: -18, z: -12.2 }, { x: 0, z: 0 }, 3.8],
    ['rock-5', { x: 12.662983, z: 14.688830 }, { x: 31, z: 2 }, 5]];
  for (const [id, from, to, saved] of cases) {
    const rock = w.scenery.find(r => r.id === id), before = length(from, w.valley.path(from, to));
    const origin = { x: rock.shape.x + rock.shape.radius + 4, y: w.valley.height(rock.shape.x, rock.shape.z) + 1.6, z: rock.shape.z };
    const hit = sceneryMiningHit(w, origin, { x: -1, y: 0, z: 0 }, 10);
    assert.equal(hit.rock.id, id);
    const roof = rockRay(rock.shape, { x: rock.shape.x + rock.shape.radius * .3,
      y: rock.shape.top + 2, z: rock.shape.z }, { x: 0, y: -1, z: 0 }, 20);
    assert.ok(roof);
    const supported = w.valley.supportHeight(roof.point.x, roof.point.z, rock.shape.top + 2);
    assert.ok(supported > w.valley.height(roof.point.x, roof.point.z) + .5);
    const graphs = w.valley.navigationCache.size;
    for (let i = 0; i < 24; i++) { mineScenery(w, p, { ...hit, distance: 1 }); if (p.bag.length === 8) p.bag = []; }
    assert.equal(rock.collapsed, true);
    assert.equal(w.valley.supportHeight(roof.point.x, roof.point.z, rock.shape.top + 2), w.valley.height(roof.point.x, roof.point.z));
    assert.ok(w.valley.rayDistance(origin, { x: -1, y: 0, z: 0 }, 10) > hit.distance + .5);
    const after = length(from, w.valley.path(from, to));
    assert.ok(before - after >= saved, `${id}: ${before.toFixed(2)} → ${after.toFixed(2)}m`);
    assert.equal(w.valley.navigationCache.size, graphs, 'no graph rebuild during collapse');
    assert.equal(other.valley.removedRocks.size, 0); assert.equal(terrain.removedRocks.size, 0);
    assert.equal(other.scenery.find(r => r.id === id).collapsed, false);
    const late = w.addPlayer('late-' + id, 'Late');
    assert.equal(w.snapshot(late.id).scenery.find(r => r.id === id).collapsed, true);
  }
  w.resetRound(); assert.equal(w.valley.removedRocks.size, 0);
  assert.ok(w.scenery.every(r => !r.collapsed && r.hp === r.maxHp));
});

test('idle scars use no recurring scenery delta; real regeneration clears them once', () => {
  const { w, p, rock } = fixture(); surfacePlayer(w, p, rock);
  const hit = sceneryMiningHit(w, w.eyes(p), { x: -1, y: 0, z: 0 }, 2.7);
  for (let i = 0; i < 4; i++) mineScenery(w, p, hit);
  assert.equal(rock.maxHp, 8);
  const stream = new StateStream();
  let frame = stream.frame(prepareFrame(w.snapshot(p.id)), p.id, []); stream.acknowledge(frame.seq);
  for (let i = 0; i < 100; i++) {
    w.time += .05; tickSceneryMining(w);
    frame = stream.frame(prepareFrame(w.snapshot(p.id)), p.id, []);
    assert.equal(frame.scenery, undefined); stream.acknowledge(frame.seq);
  }
  w.time += 36; tickSceneryMining(w);
  frame = stream.frame(prepareFrame(w.snapshot(p.id)), p.id, []);
  assert.equal(frame.scenery.length, 1); assert.equal(frame.scenery[0].chips.length, 0);
  assert.equal(rock.hp, rock.maxHp);
  assert.equal(rock.maxHp, 4, 'rest restores the initial shallow fragment');
});
