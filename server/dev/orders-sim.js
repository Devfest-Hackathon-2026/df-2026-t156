// Offline counterfactuals: same map, seeds, starting positions and ordinary prices.
// These policies test incentives; they do not model human aiming or prove balance.
import { World } from '../game.js';
import { Valley, VALLEY } from '../valley.js';
import { pathToFileURL } from 'node:url';
const distance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
function rng(seed) { return () => ((seed = seed * 16807 % 2147483647)-1)/2147483646; }
function aim(w,p,to) {
  const eye=w.eyes(p),dx=to.x-eye.x,dy=(to.y??0)+1-eye.y,dz=to.z-eye.z,len=Math.hypot(dx,dy,dz)||1;
  return {ax:dx/len,ay:dy/len,az:dz/len};
}
export function economy(w, mode) {
  const orderAt=w.orderAt.bind(w);
  if(mode==='market') w.orderAt=(...args)=>({...orderAt(...args),available:false});
  if(mode==='personal') {
    const paid=new Set(),quote=w.quote.bind(w),saleBonus=w.saleOrderBonus.bind(w),sell=w.sell.bind(w);
    w.orderAt=(...args)=>{const o=orderAt(...args);return {...o,available:Boolean(o.id)};};
    w.quote=(p,s,o=w.orderAt(s),base)=>quote(p,s,{...o,available:o.available&&!paid.has(p.id+':'+o.id)},base);
    w.saleOrderBonus=(p,s)=>paid.has(p.id+':'+w.orderAt(s).id)?0:saleBonus(p,s);
    w.sell=(p,...args)=>{const before=p.orderEarnings,id=p.sale?.orderId;sell(p,...args);
      if(p.orderEarnings>before)paid.add(p.id+':'+(id||w.orderAt(w.stationAt(p,'radius')).id));};
  }
  return w;
}

export function round({mode='first',seed=77,policy='opportunistic',count=3}={}) {
  const w=economy(new World({bots:false,random:rng(seed),rareRandom:rng(seed*197)}),mode);
  const ps=Array.from({length:count},(_,i)=>w.addPlayer('bot-'+i,'Miner'+i,true));
  const native=w.botInput.bind(w),seen=new Set(),record={mode,seed,policy,count,steals:0,chases:0,
    totalChases:0,taggedChases:0,taggedDecisions:[],orders:[],sales:0};
  let wasChasing=false;
  const chasing=new Map(),consider=w.considerBotChase.bind(w);
  w.considerBotChase=(p,...args)=>{
    const tag=p.botVisibleRivals.find(q=>q.orderReady&&distance(p,q)<4.8);
    consider(p,...args);
    if(tag)record.taggedDecisions.push([+w.time.toFixed(2),p.id,tag.id,Boolean(p.botChase),p.bag.length]);
  };
  const streams=new Map(ps.map((p,i)=>[p.id,rng(seed+i*997)]));
  const policyInput=p=>{
    if(p!==ps[0])return native(p);
    if(policy==='mine') {const previous=w.botTactics;w.botTactics=false;try{return native(p);}finally{w.botTactics=previous;}}
    if(policy==='hunt'&&p.bag.length<2){
      const prey=w.visibleOpponents(p).filter(q=>q.bag.length>1&&w.awayFromTrade(q)&&w.awayFromTrade(p))
        .sort((a,b)=>distance(p,a)-distance(p,b))[0];
      if(prey){const gap=distance(p,prey);return {...aim(w,p,prey),x:(prey.x-p.x)/Math.max(1,gap),
        z:(prey.z-p.z)/Math.max(1,gap),sprint:true,fire:gap<2.6&&w.time>=p.nextStrike};}
    }
    return native(p);
  };
  w.botInput=p=>{const previous=w.random;w.random=streams.get(p.id);
    try{return policyInput(p);}finally{w.random=previous;}};
  for(let i=0;i<3600;i++){
    w.tick(.05);
    if(ps[0].botChase&&!wasChasing)record.chases++;
    wasChasing=Boolean(ps[0].botChase);
    for(const p of ps){if(p.botChase&&!chasing.get(p.id)){record.totalChases++;if(p.botChase.forOrder)record.taggedChases++;}
      chasing.set(p.id,Boolean(p.botChase));}
    for(const e of w.events){if(seen.has(e.id))continue;seen.add(e.id);
      if(e.type==='steal')record.steals++;
      if(e.type==='sold'){record.sales++;if(e.orderBonus)record.orders.push([+w.time.toFixed(2),e.actorId,e.orderBonus]);}
    }
  }
  return {...record,scores:ps.map(p=>p.score),levels:ps.map(p=>p.pickLevel),orderPoints:ps.map(p=>p.orderEarnings),
    unsold:ps.map(p=>p.bag.length)};
}

// A controlled encounter near a live silver order. All moves, strikes and sell
// holds enter the normal input/tick path. The fixture inventory is the starting state.
export function encounter({mode='first',choice='intercept',escape=false,delay=0,remaining=135,carry=1}={}) {
  const flat=new Valley({...VALLEY,heights:VALLEY.heights.map(()=>0),colliders:[],
    deposits:[{...VALLEY.deposits[0],id:'near-copper',kind:'copper',x:14,z:6}]});
  const w=economy(new World({bots:false,valley:flat,random:()=>.5}),mode);
  const a=w.addPlayer('a','A'),b=w.addPlayer('b','B');
  w.timeLeft=remaining;w.time=180-remaining;
  // Choose an actual current order, not an invented future offer.
  const station=w.stations.find(s=>w.orderAt(s).id)||w.stations[0],kind=w.orderAt(station).kind;
  Object.assign(a,{x:station.x+14,y:0,z:station.z,pickLevel:2,bag:Array(carry).fill(kind)});
  Object.assign(b,{x:station.x+16.25,y:0,z:station.z,pickLevel:2,bag:[kind,kind]});
  const events=[],seen=new Set();let attacked=false;
  const saleInput=p=>distance(p,station)<=station.radius-.3?{sell:true}:
    {...aim(w,p,station),x:(station.x-p.x)/Math.max(1,distance(p,station)),z:(station.z-p.z)/Math.max(1,distance(p,station)),sprint:true};
  for(let i=0;i<Math.min(20,remaining)*20;i++){
    const t=i*.05;let input={};
    if(t>=delay){
      if(choice==='mine'&&a.bag.length<3){
        const d=w.deposits[0];
        if(!a.goal)w.planRoute(a,d.id,d.approaches);
        input=distance(a,a.goal)>.35?w.travel(a,{x:0,y:0,z:1},false):
          {...aim(w,a,{...d.weak,y:d.weak.y-1}),fire:true};
      }
      else if(choice==='intercept'&&!attacked){input={...aim(w,a,b),fire:true};attacked=true;}
      else if(choice==='overchase'&&t<8){const gap=distance(a,b);input={...aim(w,a,b),x:(b.x-a.x)/Math.max(1,gap),
        z:(b.z-a.z)/Math.max(1,gap),sprint:true,fire:gap<2.6&&w.time>=a.nextStrike};}
      else input=saleInput(a);
    }
    w.input(a.id,input);w.input(b.id,escape||t>.8?saleInput(b):{});w.tick(.05);
    for(const e of w.events){if(seen.has(e.id))continue;seen.add(e.id);if(['steal','sold'].includes(e.type))
      events.push([+t.toFixed(2),e.type,e.actorId,e.value,e.orderBonus||0]);}
    if(!a.bag.length&&!b.bag.length)break;
  }
  return {mode,choice,escape,delay,remaining,carry,scores:[a.score,b.score],orders:[a.orderEarnings,b.orderEarnings],
    unsold:[a.bag.length,b.bag.length],events};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  for(const mode of ['market','personal','first'])for(const choice of ['bank','mine','intercept','overchase'])
    console.log(JSON.stringify(encounter({mode,choice})));
  for(const mode of ['personal','first'])console.log(JSON.stringify(encounter({mode,choice:'bank',carry:2})));
  console.log(JSON.stringify(encounter({choice:'intercept',escape:true,delay:1.2})));
  for(const remaining of [20,5])for(const choice of ['bank','intercept','overchase'])
    console.log(JSON.stringify(encounter({choice,remaining,escape:true})));
  for(const seed of [7,77,777])for(const mode of ['market','personal','first'])for(const policy of ['mine','opportunistic','hunt'])
    console.log(JSON.stringify(round({seed,mode,policy})));
}
