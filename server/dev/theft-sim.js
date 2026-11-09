// Offline, deterministic counterfactuals on the current field/economy. These
// policies exercise real movement, hit immunity, inventory and sale code; they
// are not measurements of human aiming or a substitute for the Chrome match.
import { World } from '../game.js';
import { Valley, VALLEY } from '../valley.js';
import { MELEE, playerRayHit } from '../melee.js';
import { pathToFileURL } from 'node:url';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const random=seed=>()=>((seed=seed*16807%2147483647)-1)/2147483646;
function aim(w,p,target){const eye=w.eyes(p),dx=target.x-eye.x,dy=target.y+1.2-eye.y,dz=target.z-eye.z,len=Math.hypot(dx,dy,dz)||1;
  return {ax:dx/len,ay:dy/len,az:dz/len};}

export function applyRule(w,rule){
  if(rule==='base')return w; // Exercise the adopted production implementation unchanged.
  w.steal=(a,v,point)=>{
    const minimum=rule==='base'?1:2;
    if(v.bag.length<minimum||a.bag.length>=w.config.capacity||rule==='legacy'&&w.time<v.invulnUntil)return;
    const kind=v.bag.pop();a.bag.push(kind);v.invulnUntil=rule==='legacy'?w.time+2.5:0;
    v.sellProgress=0;v.sale=null;w.noteTheft?.(a,v);
    w.event('steal',a,point,{targetId:v.id,kind,amount:1,value:w.ores.get(kind).value});
  };
  return w;
}

function press(w,p,target,state){
  const look=aim(w,p,target),eye=w.eyes(p);
  if(w.time<state.nextPress||playerRayHit(eye,{x:look.ax,y:look.ay,z:look.az},target)>MELEE.reach)return null;
  state.nextPress=w.time+.5;
  return {...look,miningOnly:true,attackId:++state.attackId,
    attackTime:w.time,attackAx:look.ax,attackAy:look.ay,attackAz:look.az};
}
function bank(w,p){
  const s=[...w.stations].sort((a,b)=>distance(a,p)-distance(b,p))[0];
  if(w.stationAt(p,'radius')?.id===s.id)return{sell:true};
  if(p.goalKey!=='sim-bank-'+s.id||!p.route.length)w.planRoute(p,'sim-bank-'+s.id,[s]);
  return w.travel(p,aim(w,p,s),true);
}
function pursue(w,p,target,state){
  const click=press(w,p,target,state);if(click){const gap=Math.max(.1,distance(p,target));
    return {...click,x:(target.x-p.x)/gap,z:(target.z-p.z)/gap,sprint:true};}
  if(w.time>=state.planAt){state.planAt=w.time+.4;w.planRoute(p,'sim-hunt-'+target.id,[target]);}
  return w.travel(p,aim(w,p,target),true);
}

export function interactionRound({rule='base',seed=77,count=3,policy='mixed'}={}){
  const w=applyRule(new World({bots:false,random:random(seed),rareRandom:random(seed*197)}),rule);
  const actor=w.addPlayer('driver','Driver'),people=[actor];
  for(let i=1;i<count;i++)people.push(w.addPlayer('bot-'+i,'Miner'+i,true));
  const rngs=new Map(people.map((p,i)=>[p.id,random(seed+i*997)])),native=w.botInput.bind(w);
  w.botInput=p=>{const previous=w.random;w.random=rngs.get(p.id);try{return native(p);}finally{w.random=previous;}};
  const state={attackId:0,nextPress:0,planAt:0},seen=new Set(),lastLoss=new Map();
  const record={rule,seed,count,policy,botVersion:typeof w.noteTheft==='function'?'retaliation':'rev18',hits:0,steals:0,reclaims:0,sales:0,harvests:0,driverSteals:0,shots:0,boltHits:0};
  const anchor={x:0,y:w.valley.height(0,-7.9),z:-7.9};
  if(process.env.THEFT_TRACE){const path=w.valley.path.bind(w.valley);w.valley.path=(from,to)=>{
    const started=performance.now();const result=path(from,to);
    if(performance.now()-started>40)console.error(JSON.stringify({slowPath:+(performance.now()-started).toFixed(1),time:w.time,from:{x:from.x,y:from.y,z:from.z},ground:w.valley.height(from.x,from.z)}));return result;};}
  for(let tick=0;tick<3600;tick++){
    if(process.env.THEFT_TRACE&&tick%120===0)console.error(JSON.stringify({tick,people:people.map(p=>[p.id,p.x,p.y,p.z,p.bag.length,p.botChase?.id])}));
    let input;
    const previous=w.random;w.random=rngs.get(actor.id);
    try{
      if(policy==='mine'){const tactics=w.botTactics;w.botTactics=false;try{input=native(actor);}finally{w.botTactics=tactics;}}
      else if(policy==='mixed')input=native(actor);
      else{
        const threats=w.visibleOpponents(actor).filter(p=>p.bag.length>0&&w.awayFromTrade(p)&&w.awayFromTrade(actor))
          .filter(p=>policy!=='camp'||distance(p,anchor)<5.5).sort((a,b)=>distance(a,actor)-distance(b,actor));
        if(actor.bag.length>=(policy==='camp'?1:2)||actor.bag.length&&!threats.length)input=bank(w,actor);
        else if(threats[0])input=pursue(w,actor,threats[0],state);
        else{if(actor.goalKey!=='sim-camp'||!actor.route.length)w.planRoute(actor,'sim-camp',[anchor]);input=w.travel(actor,aim(w,actor,anchor),true);}
      }
    }finally{w.random=previous;}
    w.input(actor.id,input||{});w.tick(.05);
    for(const e of w.events){if(seen.has(e.id))continue;seen.add(e.id);
      if(e.type==='hit')record.hits++;
      if(e.type==='shot')record.shots++;
      if(e.type==='bolt-impact'&&e.reason==='hit')record.boltHits++;
      if(e.type==='harvest')record.harvests++;
      if(e.type==='sold')record.sales++;
      if(e.type==='steal'){
        record.steals++;if(e.actorId===actor.id)record.driverSteals++;
        const lost=lastLoss.get(e.actorId);if(lost?.id===e.targetId&&w.time-lost.time<=3)record.reclaims++;
        lastLoss.delete(e.actorId);lastLoss.set(e.targetId,{id:e.actorId,time:w.time});
      }
    }
  }
  return {...record,score:actor.score,allScores:people.map(p=>p.score),gross:people.map(p=>p.grossSales),unsold:people.map(p=>p.bag.length)};
}

export function counterEncounter({rule='base',react=.1,escape=false,full=true}={}){
  const flat=new Valley({...VALLEY,heights:VALLEY.heights.map(()=>0),colliders:[],deposits:[]});
  const w=applyRule(new World({bots:false,valley:flat}),rule),a=w.addPlayer('a','Thief'),b=w.addPlayer('b','Carrier');
  Object.assign(a,{x:18,y:0,z:0,bag:[]});Object.assign(b,{x:20,y:0,z:0,bag:Array(full?8:1).fill('crystal')});
  const states=[{attackId:0,nextPress:0},{attackId:0,nextPress:0}],events=[],seen=new Set();
  for(let tick=0;tick<80;tick++){
    const t=tick*.05;
    let ai=t<.01?press(w,a,b,states[0]):{};
    let bi=t>=react&&t<react+.051?press(w,b,a,states[1]):{};
    if(escape&&t>react+.1){const s=w.stations.find(s=>s.id==='east');if(w.stationAt(b,'radius'))bi={sell:true};else bi={...aim(w,b,s),x:1,sprint:true};}
    w.input(a.id,ai||{});w.input(b.id,bi||{});w.tick(.05);
    for(const e of w.events){if(seen.has(e.id))continue;seen.add(e.id);if(['hit','steal','protected','sold'].includes(e.type))events.push([+t.toFixed(2),e.type,e.actorId,e.kind,e.value]);}
  }
  return {rule,react,escape,full,bags:[a.bag.length,b.bag.length],scores:[a.score,b.score],events};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const option=(key,fallback)=>(process.argv.find(a=>a.startsWith('--'+key+'='))?.split('=')[1]||fallback).split(',');
  const rules=option('rules','legacy,last-safe,base');
  for(const rule of rules)for(const full of [false,true])console.log(JSON.stringify(counterEncounter({rule,full})));
  for(const count of option('counts','3').map(Number))for(const seed of option('seeds','7,77,777').map(Number))
    for(const rule of rules)for(const policy of option('policies','mine,mixed,hunt,camp'))
      console.log(JSON.stringify(interactionRound({rule,seed,count,policy})));
}
