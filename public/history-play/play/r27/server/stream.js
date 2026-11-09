// Reliable ordered deltas. Baselines advance only for frames actually sent; simulation never waits for clients.
const motionKeys = ['x','y','z','yaw','motionSeq','correctionId','correctionX','correctionY','correctionZ',
  'impulseId','impulseX','impulseY','impulseZ','velocityX','velocityY','velocityZ','grounded','sprintSuppressed'];
const localMotionKeys = motionKeys.slice(4);
const rounded = (n, scale = 1000) => Math.round(n * scale) / scale;
const clean = value => {
  if (typeof value === 'number') return rounded(value);
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,clean(v)]));
  return value;
};
function changes(rows, previous, key = 'id') {
  const changed = [], current = new Map();
  for (const row of rows) {
    const signature = JSON.stringify(row); current.set(row[key], signature);
    if (previous.get(row[key]) !== signature) changed.push(row);
  }
  const removed = [...previous.keys()].filter(id => !current.has(id));
  return { changed, current, removed };
}
export function prepareFrame(snapshot) {
  const players = [], poses = [];
  for (const player of snapshot.players) {
    const meta = {}, pose = { id: player.id };
    for (const [key,value] of Object.entries(player)) {
      if (motionKeys.includes(key)) pose[key] = clean(value);
      else meta[key] = clean(value);
    }
    players.push(meta); poses.push(pose);
  }
  // Timers are display hints; absolute authoritative serverTime still advances at 20Hz.
  const deposits = snapshot.deposits.map(row => {
    const result = clean(row);
    for (const key of ['respawnIn','availableIn','opensIn','expiresIn']) result[key] = rounded(result[key], 5);
    return result;
  });
  const stations = snapshot.stations.map(row => ({ ...clean(row), orderSeconds: rounded(row.orderSeconds, 5) }));
  return { snapshot, players, poses, deposits, stations, scenery: clean(snapshot.scenery || []), bolts: clean(snapshot.bolts || []) };
}
export class StateStream {
  constructor() { this.seq = 0; this.ack = 0; this.round = -1; this.lastEvent = 0; this.maps = {}; this.lastAckAt = performance.now(); }
  acknowledge(seq) {
    if (Number.isSafeInteger(seq) && seq > this.ack && seq <= this.seq) { this.ack = seq; this.lastAckAt = performance.now(); }
  }
  // Three bounded frames cover consumed ACK + ordinary RTT without aging the aim behind two full slots.
  get ready() { return this.seq - this.ack < 3; }
  frame(prepared, viewerId, localClaims) {
    const { snapshot: s } = prepared;
    const full = this.round !== s.round;
    if (full) this.maps = {};
    const packet = { type: 'frame', seq: ++this.seq, full, serverTime: rounded(s.serverTime), round: s.round,
      phase: s.phase, timeLeft: rounded(s.timeLeft), resultTimeLeft: rounded(s.resultTimeLeft), rareNextIn: rounded(s.rareNextIn),
      localClaims: clean(localClaims), events: s.events.filter(e => Number(e.id) > this.lastEvent).map(clean) };
    if (packet.events.length) this.lastEvent = Math.max(...packet.events.map(e => Number(e.id)));
    for (const key of ['players','poses','deposits','stations','scenery','bolts']) {
      let rows = prepared[key];
      if (key === 'poses') rows = rows.map(p => {
        if (p.id === viewerId) return p;
        const remote = { ...p }; for (const k of localMotionKeys) delete remote[k]; return remote;
      });
      const diff = changes(rows, this.maps[key] || new Map());
      this.maps[key] = diff.current;
      if (full || diff.changed.length) packet[key] = diff.changed;
      if (key === 'players' && diff.removed.length) packet.removedPlayers = diff.removed;
      if (key === 'bolts' && diff.removed.length) packet.removedBolts = diff.removed;
    }
    const result = JSON.stringify([s.winners,s.standings]);
    if (full || result !== this.result) { packet.winners = s.winners; packet.standings = s.standings; this.result = result; }
    if (full) { packet.picks = s.picks; packet.goldLayers = s.goldLayers; packet.worldId = s.worldId; packet.bow = s.bow; }
    this.round = s.round;
    return packet;
  }
}
