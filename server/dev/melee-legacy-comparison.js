// Compare this game's prior implementation, never a copied game implementation.
// Optional argument: an ignored local .mjs exported from an earlier repo commit.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { World } from '../game.js';
import { Valley, VALLEY } from '../valley.js';
import { hitPlayer, acceptHurt } from '../melee.js';

const flat = new Valley({ ...VALLEY, heights: VALLEY.heights.map(() => 0), colliders: [], deposits: [] });
const baseline = process.argv[2] ? await import(pathToFileURL(resolve(process.argv[2]))) : null;
function measure(hit, configure) {
  const world = new World({ bots: false, valley: flat });
  const a = world.addPlayer('a', 'A'), b = world.addPlayer('b', 'B');
  Object.assign(a, { x: 20, y: 0, z: -20, yaw: Math.PI / 2 });
  Object.assign(b, { x: 22, y: 0, z: -20, bag: ['silver'] });
  const aim = { ax: 1, ay: 0, az: 0 };
  configure(a, b, aim);
  hit(world, a, b, { x: b.x, y: b.y + 1, z: b.z }, aim);
  return { victim: [b.impulseX, b.impulseY, b.impulseZ], attacker: [a.impulseX, a.impulseY, a.impulseZ],
    transferred: a.bag.length, kind: world.events.find(e => e.type === 'hit')?.kind,
    critical: world.events.some(e => e.critical === true), grounded: a.grounded };
}
const cases = {
  stationary: () => {},
  server_actor_after_ground_drag: (_a, b) => Object.assign(b, { velocityX: 5, motionVX: 5 * .546 }),
  pose_client_ignores_stale_impulse: (_a, b) => Object.assign(b, { clientMotion: true, velocityX: 5, motionVX: 100 }),
  sprint: a => Object.assign(a, { sprinting: true, velocityX: 5, motionVX: 5 * .546 }),
  sprint_falling_critical: a => Object.assign(a, { sprinting: true, grounded: false, velocityY: -2, motionVY: -2 }),
  vertical_ray_overlapping_xz: (a, b, aim) => {
    a.sprinting = true; b.x = a.x; b.y = 2;
    Object.assign(aim, { ax: 0, ay: 1, az: 0 });
  },
};
const result = Object.fromEntries(Object.entries(cases).map(([name, configure]) => [name,
  { ...(baseline ? { before: measure(baseline.hitPlayer, configure) } : {}), after: measure(hitPlayer, configure) }]));
const victim = { hurtUntil: 0, lastHitDamage: 0 }, clock = { time: 0 };
result.hurt = [];
for (const [time, strength] of [[0, 1], [.15, 1], [.25, 1.5], [.3, 1.5], [.5, 1]]) {
  clock.time = time;
  result.hurt.push({ time, strength, accepted: acceptHurt(clock, victim, strength), deadline: victim.hurtUntil });
}
console.log(JSON.stringify(result, null, 2));
