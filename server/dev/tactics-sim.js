import { World } from '../game.js';
import { fixedGold } from './causal-sim.js';
import { RoutePlayer } from './balance-sim.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const place = (world, p, at) => Object.assign(p, { x: at.x, z: at.z, y: world.valley.height(at.x, at.z) });
function pointInput(world, p, point) {
  const eye = world.eyes(p), x = point.x - eye.x, y = point.y - eye.y, z = point.z - eye.z;
  const len = Math.hypot(x, y, z);
  return { ax: x / len, ay: y / len, az: z / len };
}
function tick(world, seconds) {
  for (let i = 0; i < Math.round(seconds * 20); i++) world.tick(.05);
}
function hit(world, player, deposit) {
  world.input(player.id, { ...pointInput(world, player, deposit.weak), fire: true });
  world.tick(.05);
  world.input(player.id, {});
}

export function returnEncounter({ tactics = true, carrierMode = 'walk', blocked = false,
  safe = false, ownCargo = false } = {}) {
  const world = new World({ goldLayers: null, botKnowledge: false, secondPickCost: 36, bots: false, botTactics: tactics, random: () => .5, rareRandom: () => .5 });
  const carrier = world.addPlayer('carrier', 'Carrier');
  const rival = world.addPlayer('bot-1', 'Empty rival');
  carrier.pickLevel = rival.pickLevel = 3;
  carrier.score = 60; carrier.grossSales = 104; carrier.investmentSpent = 44;
  rival.score = 80; rival.grossSales = 124; rival.investmentSpent = 44;
  world.time = 80; world.timeLeft = 100; world.nextRareAt = 500;
  const gold = world.deposits.find(d => d.id === 'gold-4');
  Object.assign(gold, { active: true, hp: gold.ore.hp, expiresAt: 105 });
  place(world, carrier, gold.approaches[0]);
  place(world, rival, gold.approaches[2]);
  hit(world, carrier, gold);
  hit(world, rival, gold);
  tick(world, .55);
  hit(world, carrier, gold);
  tick(world, .55);
  hit(world, carrier, gold);
  if (carrier.bag.length !== 2) throw new Error('Controlled gold harvest failed');
  if (ownCargo) rival.bag = ['crystal'];
  if (safe) {
    place(world, carrier, { x: 31, z: 7.8 });
    place(world, rival, { x: 31, z: 10.5 });
  }
  if (blocked) {
    const cover = world.valley.cover.find(c => c.id === 'tree-10');
    place(world, carrier, { x: cover.x - 1.4, z: cover.z });
    place(world, rival, { x: cover.x + 1.4, z: cover.z });
  }
  const start = world.time;
  rival.bot = true;
  const station = world.stations.find(s => s.id === (carrierMode === 'detour' ? 'central' : 'east'));
  world.planRoute(carrier, station.id, [station]);
  const events = [], pursuits = [], goldPaid = new Map();
  let last = world.serial, chase = false;
  for (let frame = 0; frame < 900; frame++) {
    const before = new Map([...world.players.values()].map(p => [p.id, [...p.bag]]));
    let input = {};
    if (carrierMode !== 'stand' && carrier.bag.length) {
      if (distance(carrier, station) <= station.radius - .2) input = { sell: true };
      else input = world.travel(carrier, pointInput(world, carrier, station), carrierMode === 'sprint');
    }
    world.input(carrier.id, input);
    world.tick(.05);
    if (Boolean(rival.botChase) !== chase) {
      chase = Boolean(rival.botChase);
      pursuits.push([+(world.time - start).toFixed(2), chase]);
    }
    for (const event of world.events) {
      if (+event.id <= last) continue;
      last = +event.id;
      if (['steal', 'sold'].includes(event.type)) {
        events.push([+(world.time - start).toFixed(2), event.type, event.actorId, event.kind, event.value]);
        if (event.type === 'sold') {
          const gold = before.get(event.actorId).filter(k => k === 'gold').length;
          if (gold) goldPaid.set(event.actorId, (goldPaid.get(event.actorId) || 0) + gold * 22);
        }
      }
    }
  }
  return { tactics, carrierMode, blocked, safe, ownCargo, events, pursuits,
    attempts: [...rival.botAttempted.entries()].map(([id,time]) => [id, +(time-start).toFixed(2)]),
    goldPaid: Object.fromEntries(goldPaid), score: [carrier.score, rival.score],
    goldLeft: [carrier.bag.filter(k => k === 'gold').length, rival.bag.filter(k => k === 'gold').length] };
}

export function naturalTactics({ seed = 77, tactics = true, idle = true } = {}) {
  let state = seed;
  const world = new World({ goldLayers: null, botKnowledge: false, secondPickCost: 36, botTactics: tactics, random: () => ((state = state * 16807 % 2147483647) - 1) / 2147483646,
    rareRandom: () => .5 });
  fixedGold(world);
  const human = world.addPlayer('human', idle ? 'Idle' : 'Route miner');
  const driver = idle ? null : new RoutePlayer(world, human, { precision: .7, maxLevel: 3 });
  let humanState = seed * 197 + 1;
  const native = world.botInput.bind(world);
  const rngs = new Map();
  world.botInput = p => {
    if (!rngs.has(p.id)) rngs.set(p.id, seed + (p.id === 'bot-0' ? 997 : 1999));
    const previous = world.random;
    world.random = () => {
      const next = rngs.get(p.id) * 16807 % 2147483647;
      rngs.set(p.id, next);
      return (next - 1) / 2147483646;
    };
    try { return native(p); }
    finally { world.random = previous; }
  };
  let last = 0;
  const steals = [], gold = [], attempts = [], starts = new Map(), durations = [], seenAttempts = new Map();
  for (let frame = 0; frame < 3600; frame++) {
    if (driver) {
      const previous = world.random;
      world.random = () => ((humanState = humanState * 16807 % 2147483647) - 1) / 2147483646;
      world.input(human.id, driver.input());
      world.random = previous;
    }
    world.tick(.05);
    for (const p of world.players.values()) {
      if (!p.bot) continue;
      for (const [id, time] of p.botAttempted) {
        const key = p.id + ':' + id;
        if (time === seenAttempts.get(key)) continue;
        seenAttempts.set(key, time);
        starts.set(p.id, time);
        attempts.push([+time.toFixed(1), p.id, id]);
      }
      if (!p.botChase && starts.has(p.id)) {
        durations.push(+(world.time - starts.get(p.id)).toFixed(2));
        starts.delete(p.id);
      }
    }
    for (const event of world.events) {
      if (+event.id <= last) continue;
      last = +event.id;
      if (event.type === 'steal') steals.push([+world.time.toFixed(1), event.actorId,event.targetId,event.kind]);
      if (event.type === 'harvest' && event.kind === 'gold') gold.push([+world.time.toFixed(1),event.actorId]);
    }
  }
  return { seed, tactics, idle, attempts, durations, steals, gold,
    scores: [...world.players.values()].map(p => [p.id,p.pickLevel,p.score]) };
}

export function threatenedReturn({ evade = true } = {}) {
  const world = new World({ goldLayers: null, botKnowledge: false, secondPickCost: 36, bots: false, botTactics: true, random: () => .5, rareRandom: () => .5 });
  const carrier = world.addPlayer('carrier', 'Carrier', true), rival = world.addPlayer('bot-1', 'Rival', true);
  for (const p of [carrier,rival]) p.pickLevel = 3;
  place(world, carrier, { x: 15,z: 5 });
  place(world, rival, { x: 12,z: 5 });
  carrier.bag = ['gold','gold'];
  carrier.score = 60; rival.score = 80;
  rival.botVisibleRivals = [{ id: carrier.id, x: carrier.x,z: carrier.z,
    pickLevel: 3,inventoryCount: 0,yaw: carrier.yaw }];
  const original = world.botTacticalInput.bind(world);
  world.botTacticalInput = p => p === carrier && !evade ? null : original(p);
  const choice = world.chooseBotSale(carrier);
  carrier.botSale = choice.station;
  carrier.goal = choice.station; carrier.goalKey = choice.station.id; carrier.route = choice.route;
  let firstDestination, last=0;
  const events=[];
  for(let i=0;i<200 && carrier.bag.length;i++) {
    world.tick(.05);
    firstDestination ??= carrier.botSale?.id;
    for(const e of world.events) {
      if(+e.id<=last)continue;last=+e.id;
      if(['steal','sold'].includes(e.type))events.push([+world.time.toFixed(2),e.type,e.actorId,e.kind,e.value]);
    }
  }
  return {evade,firstDestination,events,carrierScore:carrier.score,
    rivalGold:rival.bag.filter(k=>k==='gold').length};
}

if (process.argv[2] === 'retreat') {
  for(const evade of [false,true]) console.log(JSON.stringify(threatenedReturn({evade})));
} else if (process.argv[2] === 'encounters') {
  for (const carrierMode of ['stand', 'walk', 'sprint', 'detour'])
    for (const tactics of [false, true])
      console.log(JSON.stringify(returnEncounter({ carrierMode, tactics })));
  for (const condition of ['safe','blocked','ownCargo'])
    console.log(JSON.stringify(returnEncounter({ carrierMode:'stand', [condition]:true })));
} else if (process.argv[2] === 'normal') {
  for (const seed of [7,77,777]) for(const idle of [true,false]) for(const tactics of [false,true])
    console.log(JSON.stringify(naturalTactics({seed,idle,tactics})));
}
