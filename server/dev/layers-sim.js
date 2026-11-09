import { World } from '../game.js';
import { onboarding } from './onboarding-sim.js';

const distance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
const place = (w,p,at) => Object.assign(p,{x:at.x,z:at.z,y:w.valley.height(at.x,at.z)});
function aim(w,p,point) {
  const eye=w.eyes(p),x=point.x-eye.x,y=point.y-eye.y,z=point.z-eye.z;
  const length=Math.hypot(x,y,z)||1;
  return {ax:x/length,ay:y/length,az:z/length};
}
function fixture(layers,remaining=30) {
  const w=new World({bots:false,botTactics:true,botKnowledge:true,secondPickCost:30,
    goldLayers:layers,random:()=>.5,rareRandom:()=>.5});
  w.time=180-remaining;w.timeLeft=remaining;w.nextRareAt=500;
  const d=w.deposits.find(d=>d.id==='gold-4');
  Object.assign(d,{hp:layers?layers[0]:d.ore.hp,layer:layers?1:0,active:true,expiresAt:180});
  return {w,d};
}
export function race({layers=null,delay=0,firstPrecision=1,secondPrecision=1,count=2,walk=false}={}) {
  const {w,d}=fixture(layers),start=w.time;
  const ps=Array.from({length:count},(_,i)=>{
    const p=w.addPlayer('p'+i,'Miner'+i);p.pickLevel=3;place(w,p,d.approaches[i*3]);return p;
  });
  const ready=ps.map(()=>start), shots=ps.map(()=>0);
  const arrivals=ps.map((_,i)=>i?null:0);
  if(walk)ps.slice(1).forEach((p,i)=>{
    const at=d.approaches[(i+1)*3],length=Math.hypot(at.x-d.x,at.z-d.z);
    const extra=delay*w.valley.data.walkSpeed;
    const from={x:at.x+(at.x-d.x)/length*extra,z:at.z+(at.z-d.z)/length*extra};
    place(w,p,w.valley.move(from,0,0));w.planRoute(p,d.id,[at]);
  });
  const harvests=[],hits=[];let last=w.serial;
  for(let frame=0;frame<300&&d.hp;frame++){
    ps.forEach((p,i)=>{
      if(walk&&i&&distance(p,p.goal)>.3){w.input(p.id,w.travel(p,aim(w,p,d.weak),false));return;}
      if(walk&&i&&arrivals[i]===null){arrivals[i]=+(w.time-start).toFixed(2);ready[i]=w.time+.25;}
      if((!walk&&w.time-start<(i?delay+(i-1)*.4:0))||w.time<ready[i]){w.input(p.id,{});return;}
      const precision=i?secondPrecision:firstPrecision;
      const point=(++shots[i]*.61803398875%1)<precision?d.weak:{x:d.x,y:d.y+d.height*.72,z:d.z};
      w.input(p.id,{...aim(w,p,point),fire:true});ready[i]=w.time+.54;
    });
    w.tick(.05);
    for(const e of w.events){
      if(+e.id<=last)continue;last=+e.id;
      if(e.targetId!==d.id)continue;
      if(e.type==='harvest')harvests.push([+(w.time-start).toFixed(2),e.layer||0,e.actorId,e.amount]);
      if(['mine','weak'].includes(e.type))hits.push([+(w.time-start).toFixed(2),e.actorId,e.amount]);
    }
  }
  return {layers,delay,firstPrecision,secondPrecision,count,walk,arrivals,harvests,hits,bags:ps.map(p=>p.bag.length)};
}
export function cutOrContinue({layers=[6,24],cut=true,remaining=6}={}) {
  const {w,d}=fixture(layers,remaining),start=w.time;
  const p=w.addPlayer('miner','Miner');p.pickLevel=3;place(w,p,d.approaches[0]);
  const station=w.stations.find(s=>s.id==='east');let ready=start,last=w.serial;
  const harvests=[],sales=[];
  for(let frame=0;frame<Math.ceil(remaining*20)&&w.phase==='playing';frame++){
    let input={};
    const returning=cut&&p.bag.length||!d.hp;
    if(returning){
      if(distance(p,station)<=station.radius-.2)input={sell:true};
      else {w.planRoute(p,station.id,[station]);input=w.travel(p,aim(w,p,station),true);}
    }else if(w.time>=ready){input={...aim(w,p,d.weak),fire:true};ready=w.time+.54;}
    w.input(p.id,input);w.tick(.05);
    for(const e of w.events){
      if(+e.id<=last)continue;last=+e.id;
      if(e.type==='harvest')harvests.push([+(w.time-start).toFixed(2),e.layer||0,e.amount]);
      if(e.type==='sold')sales.push([+(w.time-start).toFixed(2),e.value]);
    }
  }
  return {layers,cut,remaining,score:p.score,unsold:p.bag.length,harvests,sales};
}
if(process.argv[2]==='races'){
  for(const layers of [null,[6,24],[12,30]])for(const delay of [0,.6,1.2,2.4])
    console.log(JSON.stringify(race({layers,delay,firstPrecision:.35,secondPrecision:1})));
}else if(process.argv[2]==='return'){
  for(const remaining of [5,6,10])for(const cut of [true,false])
    console.log(JSON.stringify(cutOrContinue({cut,remaining})));
}else if(process.argv[2]==='walk'){
  for(const layers of [null,[6,24],[12,24]])for(const delay of [.6,1.2])
    console.log(JSON.stringify(race({layers,delay,firstPrecision:.35,secondPrecision:1,walk:true})));
  for(const layers of [null,[6,24]])
    console.log(JSON.stringify(race({layers,delay:.6,count:3,firstPrecision:.35,secondPrecision:1})));
}else if(process.argv[2]==='rounds'){
  for(const profile of ['fast','looking'])for(const goldLayers of [null,[6,24],[12,30]]){
    const r=onboarding({cost:30,profile,goldLayers});
    console.log(JSON.stringify({profile,goldLayers,score:r.score,upgrades:r.upgrades,bots:r.bots,allGold:r.allGold,
      goldParticipation:r.goldParticipation,missed:r.missed}));
  }
}
