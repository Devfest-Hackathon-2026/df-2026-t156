import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { World, RULES } from './game.js';
import { serveBuild } from './static.js';
import { StateStream, prepareFrame } from './stream.js';
import { MELEE } from './melee.js';
import { BOW } from './crossbow.js';

export function createGameServer({ staticDir, world = new World() } = {}) {
  const directory = staticDir || process.env.STATIC_DIR || fileURLToPath(new URL('../build-web', import.meta.url));
  const staticHandler = serveBuild(directory);
  const configHash = createHash('sha256').update(JSON.stringify(world.valley.data)).digest('hex');
  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://local').pathname; }
    catch { res.writeHead(400).end('Invalid URL'); return; }
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, round: world.round, phase: world.phase,
        players: [...world.players.values()].filter(p => !p.bot).length, worldId: world.valley.data.id, configHash,
        rules: { roundSeconds: world.roundSeconds, hotMultiplier: world.config.hotMultiplier ?? 1.5, pickCosts: world.picks.map(p => p.cost),
          goldLayers: world.goldLayers, goldPreviewSeconds: world.rare.previewSeconds,
          botKnowledge: world.botKnowledge, botTactics: world.botTactics, spawnPolicy: world.spawnPolicy,
          bags: world.valley.data.bags,
          bow: BOW, theft: { unitsPerHit: 1, lastItem: true, graceSeconds: 0, hurtSeconds: MELEE.hurtSeconds } },
        network: { protocol: 2, ...networkStats } }));
    } else staticHandler(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048, perMessageDeflate: false });
  const networkStats = { sentBytes: 0, sentFrames: 0, coalescedFrames: 0, maxBufferedBytes: 0, maxOutstanding: 0,
    maxPumpMs: 0, maxLatenessMs: 0, skippedSimulationSeconds: 0 };
  const send = (socket, packet) => {
    if (socket.readyState !== WebSocket.OPEN) return false;
    const text = typeof packet === 'string' ? packet : JSON.stringify(packet);
    socket.send(text); networkStats.sentBytes += Buffer.byteLength(text); networkStats.sentFrames++;
    networkStats.maxBufferedBytes = Math.max(networkStats.maxBufferedBytes, socket.bufferedAmount);
    return true;
  };
  const canSend = socket => {
    if (socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > 8192 || (socket.stream && !socket.stream.ready)) {
      networkStats.coalescedFrames++; return false;
    }
    return true;
  };
  wss.on('connection', socket => {
    let id, received = 0, windowStart = Date.now();
    const joinedBy = setTimeout(() => { if (!id) socket.close(1008, 'Join required'); }, 10000);
    socket.alive = true;
    socket.on('pong', () => { socket.alive = true; });
    socket.on('message', (bytes, binary) => {
      if (binary) { socket.close(1003, 'JSON text required'); return; }
      if (Date.now() - windowStart > 1000) { windowStart = Date.now(); received = 0; }
      if (++received > 80) { socket.close(1008, 'Input rate exceeded'); return; }
      let packet;
      try { packet = JSON.parse(bytes.toString()); } catch { socket.close(1007, 'Invalid JSON'); return; }
      if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return;
      if (packet.type === 'join' && !id) {
        if ([...world.players.values()].filter(p => !p.bot).length >= RULES.maxHumans) {
          send(socket, { type: 'error', message: 'Room full' }); socket.close(1013, 'Room full'); return;
        }
        id = randomUUID();
        world.addPlayer(id, packet.name);
        socket.playerId = id;
        if (packet.protocol === 2) socket.stream = new StateStream();
        clearTimeout(joinedBy);
        send(socket, { type: 'welcome', id, protocol: socket.stream ? 2 : 1 });
        const initial = world.snapshot(id);
        send(socket, socket.stream ? socket.stream.frame(prepareFrame(initial), id, initial.localClaims) : initial);
      } else if (packet.type === 'ack' && id && socket.stream) {
        socket.stream.acknowledge(packet.ack);
      } else if (packet.type === 'input' && id) {
        if (socket.stream) socket.stream.acknowledge(packet.ack);
        world.input(id, packet);
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => { clearTimeout(joinedBy); if (id) world.removePlayer(id); });
  });
  const tickMilliseconds = 1000 / RULES.tickRate;
  let nextTickAt = performance.now() + tickMilliseconds, timer;
  const pump = () => {
    const now = performance.now();
    networkStats.maxLatenessMs = Math.max(networkStats.maxLatenessMs, now - nextTickAt);
    const running = world.phase === 'finished' || [...world.players.values()].some(p => !p.bot);
    let steps = 0;
    if (!running) nextTickAt = now + tickMilliseconds;
    else {
      // Expire obsolete time first, then simulate at most the five most recent ticks.
      // Round clocks and motion budgets follow real elapsed time without replaying old clicks.
      const overdue = Math.max(0, Math.floor((now - nextTickAt) / tickMilliseconds) + 1);
      if (overdue > 5) {
        const skipped = overdue - 5;
        world.advanceClock(skipped / RULES.tickRate);
        networkStats.skippedSimulationSeconds += skipped / RULES.tickRate;
        nextTickAt += skipped * tickMilliseconds;
      }
      while (now + 1e-6 >= nextTickAt && steps < 5) {
        world.tick(1 / RULES.tickRate);
        nextTickAt += tickMilliseconds;
        steps++;
      }
    }
    if (steps) {
      const recipients = [...wss.clients].filter(socket => socket.playerId && canSend(socket));
      if (recipients.length) {
        // Build shared accounting/geometry once, rather than once per viewer on every tick.
        const shared = world.snapshot();
        const prepared = recipients.some(socket => socket.stream) ? prepareFrame(shared) : null;
        for (const socket of recipients) {
          const claims = world.localClaims(socket.playerId);
          send(socket, socket.stream ? socket.stream.frame(prepared, socket.playerId, claims) : { ...shared, localClaims: claims });
          if (socket.stream) networkStats.maxOutstanding = Math.max(networkStats.maxOutstanding, socket.stream.seq - socket.stream.ack);
        }
      }
    }
    networkStats.maxPumpMs = Math.max(networkStats.maxPumpMs, performance.now() - now);
    timer = setTimeout(pump, Math.max(1, nextTickAt - performance.now()));
  };
  timer = setTimeout(pump, tickMilliseconds);
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.alive) { socket.terminate(); continue; }
      socket.alive = false; socket.ping();
    }
  }, 10000);
  const stop = async () => {
    clearTimeout(timer); clearInterval(heartbeat);
    for (const socket of wss.clients) socket.terminate();
    await new Promise(resolve => wss.close(resolve));
    if (server.listening) await new Promise(resolve => server.close(resolve));
  };
  return { server, wss, world, stop, networkStats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  const app = createGameServer();
  app.server.listen(port, process.env.HOST || '0.0.0.0', () =>
    console.log(`Mining Valley listening on port ${app.server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.stop().then(() => process.exit(0)));
}
