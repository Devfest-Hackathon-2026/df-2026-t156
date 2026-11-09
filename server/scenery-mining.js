import { rockRay } from './scenery-shape.js';

export const PASSAGE_ROCKS = Object.freeze(['rock-0', 'rock-5']);
export function initSceneryMining(world) {
  // Geometry/nav baselines may be shared. Round destruction never mutates them.
  world.valley = world.valley.fork();
  world.scenery = world.valley.cover.filter(c => c.shape).map(c => ({
    id: c.id, shape: c.shape, passage: PASSAGE_ROCKS.includes(c.id),
    maxHp: PASSAGE_ROCKS.includes(c.id) ? 24 : 4, hp: 0, oreProgress: 0,
    chips: [], collapsed: false, regenAt: 0, revision: 0,
  }));
  world.valley.prepareSceneryNavigation(PASSAGE_ROCKS.filter(id => world.scenery.some(r => r.id === id)));
}
export function resetSceneryMining(world) {
  if (!world.scenery) return;
  const changed = world.valley.removedRocks.size > 0;
  world.valley.removedRocks.clear();
  for (const rock of world.scenery) Object.assign(rock, { maxHp: rock.passage ? 24 : 4, hp: rock.passage ? 24 : 4, oreProgress: 0,
    chips: [], collapsed: false, regenAt: 0, revision: 0 });
  if (changed) world.valley.rebuildNavigation();
}
export function sceneryMiningHit(world, eye, ray, maxDistance) {
  let best = null, limit = maxDistance;
  for (const rock of world.scenery || []) {
    if (rock.collapsed) continue;
    const hit = rockRay(rock.shape, eye, ray, limit);
    if (!hit) continue;
    best = { ...hit, rock }; limit = hit.distance;
  }
  return best;
}
export function mineScenery(world, player, hit) {
  const rock = hit.rock;
  if (world.phase !== 'playing' || !world.scenery.includes(rock) || rock.collapsed ||
    !Number.isFinite(hit.distance) || hit.distance > world.config.range + 1e-6) return;
  if (player.bag.length >= world.capacity(player)) {
    world.event('full', player, hit.point, { targetId: rock.id, kind: 'copper' }); return;
  }
  const damage = Math.min(rock.hp, world.picks[player.pickLevel - 1].damage);
  rock.hp -= damage; rock.oreProgress += damage; rock.revision++;
  rock.regenAt = world.time + 35;
  rock.chips.push({ x: hit.point.x, y: hit.point.y, z: hit.point.z,
    nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z });
  if (rock.chips.length > 8) rock.chips.shift();
  world.event('mine', player, hit.point, { targetId: rock.id, kind: 'copper', amount: damage });
  const fragmentDamage = rock.passage ? 4 : rock.maxHp;
  if (rock.oreProgress >= fragmentDamage) {
    rock.oreProgress -= fragmentDamage;
    player.bag.push('copper');
    world.event('harvest', player, hit.point, { targetId: rock.id, kind: 'copper', amount: 1,
      value: world.ores.get('copper').value });
  }
  if (rock.hp > 0) return;
  if (!rock.passage) { rock.maxHp = rock.hp = 8; return; }
  rock.collapsed = true;
  world.valley.removedRocks.add(rock.id);
  world.valley.rebuildNavigation();
  for (const p of world.players.values()) if (p.bot) { p.route = []; p.botPlanAt = 0; p.botPickAt = 0; }
  world.event('scenery-collapse', player, hit.point, { targetId: rock.id, kind: 'copper' });
}
export function tickSceneryMining(world) {
  for (const rock of world.scenery || []) {
    if (rock.passage || !rock.regenAt || rock.regenAt > world.time) continue;
    Object.assign(rock, { maxHp: 4, hp: 4, oreProgress: 0, chips: [], regenAt: 0, revision: rock.revision + 1 });
  }
}
export function sceneryMiningSnapshot(world) {
  return (world.scenery || []).map(r => ({ id: r.id, hp: r.hp, maxHp: r.maxHp,
    passage: r.passage, collapsed: r.collapsed, revision: r.revision, chips: r.chips }));
}
