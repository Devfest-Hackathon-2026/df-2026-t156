// Original measurement code. No Minecraft source, bytecode or assets are bundled.
// Reference equations were checked against the official Java 1.8.9 client jar;
// see motion-comparison.md for its hash, method mappings and scope.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { integrateMotion, resetMotion, applyKnockback } from '../motion.js';

const idle = { x: 0, z: 0, sprint: false, sneak: false, jump: false, draw: false, yaw: 0 };
const flat = { valley: {
  move: (p, dx, dz) => ({ x: p.x + dx, y: 0, z: p.z + dz }),
  supportHeight: () => 0,
} };

// Independent tick reference, expressed in blocks/tick. The previous client
// differed only in pre-normalization and the missing vertical zero threshold.
function referenceStep(p, raw, previous = false) {
  const input = { ...idle, ...raw }, grounded = p.grounded;
  const drag = grounded ? .546 : .91;
  for (const axis of ['vx', 'vy', 'vz'])
    if (Math.abs(p[axis]) < .005 && (!previous || axis !== 'vy')) p[axis] = 0;
  p.cooldown = Math.max(0, p.cooldown - 1);
  if (!input.jump) p.cooldown = 0;
  const sprint = input.sprint && !input.sneak && !input.draw;
  let x = input.x, z = input.z;
  if (previous) { const n = Math.max(1, Math.hypot(x, z)); x /= n; z /= n; }
  const scale = .98 * (input.sneak ? .3 : 1) * (input.draw ? .2 : 1);
  x *= scale; z *= scale;
  const n = Math.max(1, Math.hypot(x, z)); x /= n; z /= n;
  const acceleration = (grounded ? .1 : .02) * (sprint ? 1.3 : 1);
  if (Math.hypot(x, z) >= .01) { p.vx += x * acceleration; p.vz += z * acceleration; }
  if (grounded && input.jump && (previous || p.cooldown === 0)) {
    p.vy = .42; p.cooldown = 10;
    if (sprint) { p.vx += Math.sin(input.yaw) * .2; p.vz += Math.cos(input.yaw) * .2; }
  }
  p.x += p.vx; p.y += p.vy; p.z += p.vz;
  p.grounded = p.y <= 0;
  if (p.grounded) { p.y = 0; p.vy = 0; }
  p.vx *= drag; p.vz *= drag;
  p.vy = p.grounded ? 0 : (p.vy - .08) * .98;
}

export function traceMotion(sequence, { mode = 'adopted', initialVelocity } = {}) {
  const p = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, cooldown: 0, grounded: true };
  resetMotion(p, 0, 1);
  if (initialVelocity) {
    if (mode === 'adopted') applyKnockback(p, ...initialVelocity);
    else {
      [p.vx, p.vy, p.vz] = initialVelocity.map(v => v / 20);
      p.grounded = initialVelocity[1] <= 0;
    }
  }
  return sequence.map(raw => {
    const input = { ...idle, ...raw };
    if (mode === 'adopted') {
      p.bowDrawing = input.draw; p.yaw = input.yaw;
      integrateMotion(flat, p, input, .05);
    } else referenceStep(p, input, mode === 'previous');
    return { x: p.x, y: p.y, z: p.z, grounded: p.grounded,
      vx: mode === 'adopted' ? p.motionVX : p.vx * 20,
      vy: mode === 'adopted' ? p.motionVY : p.vy * 20,
      vz: mode === 'adopted' ? p.motionVZ : p.vz * 20 };
  });
}

const held = (ticks, input) => Array.from({ length: ticks }, () => input);
const round = n => Math.round(n * 1e6) / 1e6;
export const scenarios = {
  walk: held(80, { z: 1 }), sprint: held(80, { z: 1, sprint: true }),
  sneak: held(80, { z: 1, sneak: true }), diagonalWalk: held(80, { x: 1, z: 1 }),
  diagonalSneak: held(80, { x: 1, z: 1, sneak: true }),
  repeatedSprintJump: held(240, { z: 1, sprint: true, jump: true }),
  standstillSprintJump: [...held(1, { z: 1, sprint: true, jump: true }), ...held(11, { z: 1, sprint: true })],
  runningSprintJump: [...held(80, { z: 1, sprint: true }), ...held(1, { z: 1, sprint: true, jump: true }), ...held(11, { z: 1, sprint: true })],
  release: [...held(40, { z: 1, sprint: true }), ...held(20, {})],
  reverseInAir: [...held(80, { z: 1, sprint: true }), ...held(1, { z: 1, sprint: true, jump: true }), ...held(11, { z: -1 })],
  drawFromSprint: [...held(40, { z: 1, sprint: true }), ...held(40, { z: 1, sprint: true, draw: true })],
  drawInAir: [...held(80, { z: 1, sprint: true }), ...held(1, { z: 1, sprint: true, jump: true }), ...held(11, { z: 1, sprint: true, draw: true })],
  knockbackCounterInput: held(20, { z: -1 }),
};

export function compareLegacyMotion() {
  return Object.entries(scenarios).map(([name, sequence]) => {
    const initialVelocity = name === 'knockbackCounterInput' ? [0, 8, 8] : undefined;
    const traces = Object.fromEntries(['previous', 'reference189', 'adopted'].map(mode =>
      [mode, traceMotion(sequence, { mode, initialVelocity })]));
    const maxReferenceError = Math.max(...traces.adopted.map((p, i) =>
      Math.hypot(p.x - traces.reference189[i].x, p.y - traces.reference189[i].y, p.z - traces.reference189[i].z)));
    assert.ok(maxReferenceError < 1e-9, `${name}: adopted integration differs from the independent tick reference`);
    const measure = trace => {
      const end = trace.at(-1), prior = trace.at(-2);
      const launches = trace.flatMap((p, i) => p.y > 0 && (i === 0 || trace[i - 1].grounded) ? [i] : []);
      const firstLaunch = launches[0];
      const firstLanding = firstLaunch === undefined ? -1 : trace.findIndex((p, i) => i > firstLaunch && p.grounded);
      return { distance: round(Math.hypot(end.x, end.z)), maxHeight: round(Math.max(...trace.map(p => p.y))),
        finalSpeed: round(Math.hypot(end.x - prior.x, end.z - prior.z) * 20),
        firstFlightDistance: firstLanding < 0 ? null : round(Math.hypot(
          trace[firstLanding].x - (trace[firstLaunch - 1]?.x ?? 0), trace[firstLanding].z - (trace[firstLaunch - 1]?.z ?? 0))),
        airtime: firstLanding < 0 ? null : round((firstLanding - firstLaunch + 1) / 20),
        jumpPeriod: launches.length < 2 ? null : round((launches[1] - launches[0]) / 20),
        steadyCycleSpeed: launches.length < 3 ? null : round((trace.at(-1).z - trace.at(-13).z) / .6) };
    };
    return { name, duration: sequence.length / 20, previous: measure(traces.previous),
      reference189: measure(traces.reference189), adopted: measure(traces.adopted), maxReferenceError };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(compareLegacyMotion(), null, 2));
