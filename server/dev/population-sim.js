import { World } from '../game.js';
import { RoutePlayer } from './balance-sim.js';
import { fixedGold } from './causal-sim.js';

const rng = seed => { let state=seed;return()=>((state=state*16807%2147483647)-1)/2147483646; };
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export const roles = [
  {name:'中位',maxLevel:2},{name:'上位',maxLevel:3},
  {name:'近場',maxLevel:2,near:true},{name:'上位',maxLevel:3},
  {name:'中位',maxLevel:2},{name:'近場',maxLevel:2,near:true},
  {name:'上位',maxLevel:3},{name:'中位',maxLevel:2},
];
export function makeDriver(w,p,role){
  const driver=new RoutePlayer(w,p,{...role,knowledge:true,initialCopper:true,precision:.5});
  if(role.maxLevel===3){
    const input=driver.input.bind(driver);let signature='';
    driver.input=()=>{
      const announced=w.deposits.filter(d=>d.announced);
      const next=announced.map(d=>d.id).join(',');
      if(next&&next!==signature&&p.pickLevel===3&&p.bag.length<4){driver.target=null;driver.nextPlan=0;}
      signature=next;
      const prior=announced.map(d=>[d,d.hp,d.active,d.expiresAt]);
      for(const [d] of prior)Object.assign(d,{hp:w.goldLayers[0],active:true,expiresAt:d.opensAt+w.rare.activeSeconds});
      let packet;
      try{packet=input();}finally{for(const [d,hp,active,expiresAt] of prior)Object.assign(d,{hp,active,expiresAt});}
      if(driver.target?.announced)packet.fire=false;
      return packet;
    };
  }
  if(role.near){
    const input=driver.input.bind(driver);
    driver.input=()=>{
      const sale=w.chooseBotSale;
      w.chooseBotSale=who=>{
        const station=[...w.stations].sort((a,b)=>distance(a,who)-distance(b,who))[0];
        return {station,route:w.valley.path(who,station)};
      };
      try{return input();}finally{w.chooseBotSale=sale;}
    };
  }
  return driver;
}
function startRecord(w,p){
  const d=w.deposits.filter(d=>d.kind==='copper').sort((a,b)=>distance(a,p)-distance(b,p))[0];
  return [p.id,p.startSeamId||d.id,+p.x.toFixed(1),+p.z.toFixed(1)];
}
export function population({humans=8,seed=77,WorldClass=World,round=1,contestTop=false}={}){
  const w=new WorldClass({random:rng(seed),rareRandom:rng(seed+999)});
  while(w.round<round)w.resetRound();
  fixedGold(w);
  const drivers=Array.from({length:humans},(_,i)=>{
    const base=humans===1?roles[1]:roles[i];
    const role=contestTop&&base.maxLevel===3?{...base,avoid:false}:base;
    return makeDriver(w,w.addPlayer('p'+i,role.name+(i+1)),role);
  });
  const starts=drivers.map(d=>startRecord(w,d.player));
  const randoms=new Map([...w.players.values()].map((p,i)=>[p.id,rng(seed+997*(i+1))]));
  const native=w.botInput.bind(w);
  w.botInput=p=>{const old=w.random;w.random=randoms.get(p.id);try{return native(p);}finally{w.random=old;}};
  const records=new Map(drivers.map(d=>[d.player.id,{firstSale:null,upgrades:[],ore:{},noJob:0,emptyArrival:0,blocked:0,maxBlocked:0}]));
  const workers=new Map(),gold=[];let last=0;
  for(let frame=0;frame<3600;frame++){
    const before=new Map();
    for(const driver of drivers){
      const p=driver.player,r=records.get(p.id),old=w.random;w.random=randoms.get(p.id);
      const packet=driver.input();w.random=old;before.set(p.id,{x:p.x,z:p.z,packet});
      if(!driver.target&&!driver.selling&&!p.bag.length&&!packet.upgrade&&!packet.fire&&!packet.sell&&
        Math.hypot(packet.x||0,packet.z||0)<.1)r.noJob+=.05;
      if(driver.target&&!driver.target.hp&&distance(p,driver.target)<4&&!p.bag.length)r.emptyArrival+=.05;
      w.input(p.id,packet);
    }
    w.tick(.05);
    for(const driver of drivers){
      const p=driver.player,r=records.get(p.id),at=before.get(p.id);
      r.blocked=Math.hypot(at.packet.x||0,at.packet.z||0)>.3&&distance(at,p)<.01?r.blocked+.05:0;
      r.maxBlocked=Math.max(r.maxBlocked,r.blocked);
    }
    for(const e of w.events){
      if(+e.id<=last)continue;last=+e.id;
      if(e.kind==='gold'&&['mine','weak'].includes(e.type)){
        if(!workers.has(e.targetId))workers.set(e.targetId,new Set());workers.get(e.targetId).add(e.actorId);
      }
      if(e.kind==='gold'&&e.type==='harvest')gold.push([+w.time.toFixed(1),e.targetId,e.layer,e.actorId]);
      const r=records.get(e.actorId);if(!r)continue;
      if(e.type==='sold')r.firstSale??=+w.time.toFixed(1);
      if(e.type==='upgraded')r.upgrades.push([e.amount,+w.time.toFixed(1)]);
      if(e.type==='harvest')r.ore[e.kind]=(r.ore[e.kind]||0)+e.amount;
    }
  }
  const standings=w.standings;
  const rotation=drivers.map(d=>[d.player.id,[]]);
  for(let round=0;round<8;round++){
    w.resetRound();drivers.forEach((d,i)=>rotation[i][1].push(startRecord(w,d.player)[1]));
  }
  return {humans,seed,round,contestTop,starts,uniqueStarts:new Set(starts.map(s=>s[1])).size,
    results:[...records].map(([id,r])=>({id,...r,noJob:+r.noJob.toFixed(1),emptyArrival:+r.emptyArrival.toFixed(1),
      blocked:undefined,maxBlocked:+r.maxBlocked.toFixed(1)})),
    standings, gold, goldWorkers:[...workers].map(([id,people])=>[id,[...people]]),rotation};
}
if(process.argv[2]==='matched'){
  for(const humans of [1,4,8])console.log(JSON.stringify(population({humans})));
}
