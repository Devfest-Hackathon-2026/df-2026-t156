// Reads local browser capture without copying names, events or raw state into Git.
import fs from 'node:fs';
import { World } from '../game.js';
import { resetMotion, receiveMotion, MOTION } from '../motion.js';

const path = process.argv[2];
if (!path) throw new Error('Usage: node server/dev/replay-motion.js capture.jsonl [fromSeconds] [untilSeconds]');
const from = Number(process.argv[3] ?? 81.5), until = Number(process.argv[4] ?? 83.2);
const raw = fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim();
const rows = raw.startsWith('[') ? JSON.parse(raw) : raw.split(/\r?\n/).map(line => JSON.parse(line));
const start = rows.findIndex(row => row.state?.serverTime >= from && row.state?.players.some(p => !p.bot));
if (start < 0) throw new Error('No human state in selected interval');
const state = rows[start].state, pose = state.players.find(p => !p.bot);
const input = rows.slice(0, start).findLast(row => row.input?.motionSeq === pose.motionSeq)?.input;
if (!input) throw new Error('Missing acknowledged input for initial clock');
const world = new World({ bots: false }), p = world.addPlayer('replay', 'Replay');
world.round = state.round; world.time = state.serverTime;
Object.assign(p, { x: pose.x, y: pose.y, z: pose.z }); resetMotion(p, world.time, world.round);
Object.assign(p, pose, { id: 'replay', motionTime: input.motionTime, impulseAckId: pose.impulseId,
  motionSeq: pose.motionSeq, airOrigin: pose.y });
let count = 0;
for (const row of rows.slice(start + 1)) {
  if (!row.input) continue;
  if (row.serverTime > until) break;
  const packet = row.input;
  if (packet.correctionId !== p.correctionId) {
    console.log(JSON.stringify({ captureForkAt: packet.motionSeq, reason: 'captured client already applied a different correction' }));
    break;
  }
  world.time = row.serverTime;
  p.input = packet; p.bowDrawing = packet.bowDrawing === true;
  const dt = packet.motionTime - p.motionTime, ground = world.valley.supportHeight(packet.px, packet.pz, Math.max(p.y, packet.py));
  const actualDistance = Math.hypot(packet.px - p.x, packet.pz - p.z);
  const before = { grounded: p.grounded, y: p.y, floor: world.valley.supportHeight(p.x, p.z, p.y),
    velocityY: p.velocityY, airOrigin: p.airOrigin, jumpAllowance: p.jumpAllowance,
    landingAllowance: p.landingAllowance, impulseAllowance: p.impulseAllowance, motionBudget: p.motionBudget };
  const oldCorrection = p.correctionId;
  receiveMotion(world, p, packet); count++;
  if (p.correctionId > oldCorrection || packet.motionSeq >= 1454 && packet.motionSeq <= 1457) {
    console.log(JSON.stringify({ seq: packet.motionSeq, serverTime: row.serverTime, dt, actualDistance,
      speed: actualDistance / dt, rise: packet.py - before.y, ground, before,
      nominalDistanceLimit: (MOTION.sprint / .98 + before.jumpAllowance + before.landingAllowance +
        (before.grounded ? 0 : 2.55) + before.impulseAllowance) * dt * 1.01 + .002,
      correction: p.correctionId - oldCorrection, after: { grounded: p.grounded, jumpAllowance: p.jumpAllowance, airOrigin: p.airOrigin } }));
  }
}
console.log(JSON.stringify({ poses: count, finalCorrection: p.correctionId, seq: p.motionSeq }));
