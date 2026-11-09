import { World } from '../game.js';
import { RoutePlayer } from './balance-sim.js';
import { fixedGold } from './causal-sim.js';
import { installForecast } from './forecast-experiment.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const rng=seed=>{let value=seed;return()=>((value=value*16807%2147483647)-1)/2147483646;};
const place=(w,p,at)=>Object.assign(p,{x:at.x,z:at.z,y:w.valley.height(at.x,at.z)});
function aim(w,p,to){const e=w.eyes(p),x=to.x-e.x,y=to.y-e.y,z=to.z-e.z,l=Math.hypot(x,y,z)||1;return{ax:x/l,ay:y/l,az:z/l};}
function metres(w,from,to){
  if(to.approaches)return Math.min(...to.approaches.map(at=>metres(w,from,at)));
  let last=from,total=0;const path=w.valley.path(from,to);if(!path.length)return Infinity;
  for(const at of path){total+=distance(last,at);last=at;}return total;
}

class ForecastRoute {
  constructor(w,p,{policy='work',precision=.5,interval=.7,reaction=.8}={}){
    Object.assign(this,{w,p,policy,precision,interval,reaction});
    this.normal=new RoutePlayer(w,p,{knowledge:true,maxLevel:3,precision,avoid:true,initialCopper:true});
    this.target=null;this.ready=0;this.pause=0;this.signature='';this.shots=0;
    this.wait=0;this.jobs=[];this.decisions=[];
  }
  opportunity(sites){
    const {w,p}=this,seconds=w.nextRareAt-w.rare.previewSeconds-w.time;
    if(w.time<(this.opportunityAt||0))return null;
    this.opportunityAt=w.time+1.2;
    // A player can estimate map distances; final travel still follows the real collision-aware path.
    const currentWorst=Math.max(...sites.map(s=>distance(p,s)));
    return w.deposits.filter(d=>d.kind!=='gold'&&w.perceivedOre(p,d).hp&&d.ore.minLevel<=p.pickLevel)
      .map(d=>{
        const at=d.approaches[0];if(!at)return null;
        const travel=distance(p,at)/w.valley.data.walkSpeed;
        const mine=Math.ceil(w.perceivedOre(p,d).hp/(3*(1+this.precision)))*this.interval;
        const worst=Math.max(...sites.map(s=>distance(at,s)));
        // Work which can finish before confirmation and does not place us far beyond either branch.
        const rank=d.ore.yield*d.ore.value/(travel+mine+3)-(Math.max(0,worst-currentWorst)/6);
        return {d,travel,mine,rank};
      }).filter(o=>o&&o.travel+o.mine+this.reaction<seconds&&Number.isFinite(o.rank))
      .sort((a,b)=>b.rank-a.rank)[0]?.d;
  }
  input(){
    const {w,p}=this;w.observeOre(p);
    if(p.pickLevel<3)return this.normal.input();
    const forecast=w.rareForecast(),sites=forecast.sites.map(s=>w.deposits.find(d=>d.id===s.id));
    const signature=forecast.phase+':'+sites.map(s=>s.id).join(',');
    if(signature!==this.signature){
      this.signature=signature;
      if(forecast.phase!=='none'){
        this.target=null;p.goalKey='';p.goal=null;this.pause=w.time+this.reaction;
        this.normal.target=null;
        this.decisions.push([+w.time.toFixed(1),forecast.phase,sites.map(s=>s.id),+p.x.toFixed(1),+p.z.toFixed(1),p.bag.length]);
      }
    }
    if(w.time<this.pause)return{};
    const gold=p.bag.filter(k=>k==='gold').length;
    const shouldSell=gold>=2||p.bag.length>=4||p.bag.length&&w.timeLeft<10;
    if(shouldSell||this.normal.selling||p.sellProgress){
      this.target=null;
      if(!this.normal.selling){const choice=w.chooseBotSale(p);if(!choice)return{};
        this.normal.selling=choice.station;p.goalKey=choice.station.id;p.goal=choice.station;p.route=choice.route;}
      const station=this.normal.selling;
      if(!p.bag.length){this.normal.selling=null;return{};}
      if(distance(p,station)<=station.radius-.2)return{sell:true};
      return w.travel(p,aim(w,p,station),false);
    }
    if(this.target&&this.target.kind!=='gold'&&!w.perceivedOre(p,this.target).hp)this.target=null;
    if(this.target?.kind==='gold'&&!this.target.hp&&!this.target.announced&&!w.possibleGold(this.target))this.target=null;
    if(!this.target){
      if(forecast.phase==='confirmed')this.target=sites[0];
      else if(forecast.phase==='possible'){
        this.target=this.policy==='rush'?sites.sort((a,b)=>metres(w,p,a)-metres(w,p,b))[0]:this.opportunity(sites);
      }
      if(!this.target){return this.normal.input();}
      p.goalKey='';p.goal=null;
      this.jobs.push([+w.time.toFixed(1),this.target.id]);
      this.ready=w.time+.2;
    }
    const d=this.target;
    if(p.goal&&distance(p,p.goal)<.5&&w.visibleOpponents(p).some(other=>distance(other,p)<.85)){
      p.goalKey='';p.goal=null;
    }
    if(!w.planRoute(p,d.id,w.miningPositions(p,d))){this.target=null;return{};}
    if(distance(p,p.goal)>.3)return w.travel(p,aim(w,p,d.weak),false);
    if(!d.hp||!d.active){if(d.kind==='gold')this.wait+=.05;return{};}
    if(w.time<this.ready)return{};
    const weak=(++this.shots*.61803398875%1)<this.precision;
    const at=weak?d.weak:{x:d.x,y:d.y+d.height*.72,z:d.z};
    this.ready=w.time+this.interval;
    return{...aim(w,p,at),fire:true};
  }
}

export function forecastRound({mode='six',policy='work',seed=77}={}){
  const w=installForecast(new World({bots:true,botKnowledge:true,botTactics:true,goldLayers:[6,24],secondPickCost:30,
    random:rng(seed),rareRandom:rng(seed+999)}),{mode,hintRandom:rng(seed+1999)});
  fixedGold(w);
  const p=w.addPlayer('learner','Learner'),driver=new ForecastRoute(w,p,{policy});
  const bots=[...w.players.values()].filter(q=>q.bot);
  bots.forEach((q,i)=>w.spawn(q,[1,6][i]));
  const randoms=new Map(bots.map((q,i)=>[q.id,rng(seed+997*(i+1))])),native=w.botInput.bind(w);
  w.botInput=q=>{const old=w.random;w.random=randoms.get(q.id);try{return native(q);}finally{w.random=old;}};
  const gold=[],upgrades=[],botWait=new Map(bots.map(q=>[q.id,0]));let last=0;
  for(let frame=0;frame<3600;frame++){
    const old=w.random;w.random=rng(seed+frame*197);w.input(p.id,driver.input());w.random=old;
    w.tick(.05);
    for(const q of bots){const d=q.botTarget;if(d&&q.goal&&distance(q,q.goal)<.4&&
      (d.announced||w.possibleGold(d))&&!d.active)botWait.set(q.id,botWait.get(q.id)+.05);}
    for(const e of w.events){
      if(+e.id<=last)continue;last=+e.id;
      if(e.type==='harvest'&&e.kind==='gold')gold.push([+w.time.toFixed(1),e.targetId,e.layer,e.actorId]);
      if(e.type==='upgraded')upgrades.push([+w.time.toFixed(1),e.actorId,e.amount]);
    }
  }
  return{mode,policy,seed,score:p.score,gross:p.grossSales,spent:p.investmentSpent,gold,upgrades,
    wait:+driver.wait.toFixed(1),botWait:[...botWait].map(([id,t])=>[id,+t.toFixed(1)]),
    bots:bots.map(q=>[q.id,q.pickLevel,q.score]),jobs:driver.jobs};
}

export function forecastFork({mode='six',policy='work',rival='practiced',station='east',target='gold-2',count=2}={}){
  const w=installForecast(new World({bots:false,botKnowledge:true,botTactics:true,goldLayers:[6,24],secondPickCost:30,
    random:rng(77),rareRandom:rng(778)}),{mode,hintRandom:rng(779)});
  w.time=102;w.timeLeft=78;w.nextRareAt=120;w.lastRareIds=new Set(['gold-3']);
  const other=target==='gold-4'?'gold-2':'gold-4';
  fixedGold(w,[target,other],[['gold-2','gold-4'],['gold-1',other]]);
  const p=w.addPlayer('learner','Learner');p.pickLevel=3;p.score=6;p.grossSales=44;p.investmentSpent=38;
  place(w,p,w.stations.find(s=>s.id===station));
  const human=new ForecastRoute(w,p,{policy});
  const others=[];
  for(let i=1;i<count;i++){
    const q=w.addPlayer('bot-'+(i-1),'Rival'+i,rival==='native');
    q.pickLevel=3;q.score=20;q.grossSales=58;q.investmentSpent=38;
    place(w,q,i===1?{x:5,z:-25}:{x:-31,z:1});
    others.push(q);
  }
  const drivers=rival==='native'?[]:others.map(q=>new ForecastRoute(w,q,{policy:'rush',precision:.9,interval:.55,reaction:.4}));
  const botRng=new Map(others.map((q,i)=>[q.id,rng(900+i*197)])),baseBot=w.botInput.bind(w);
  w.botInput=q=>{const old=w.random;w.random=botRng.get(q.id);try{return baseBot(q);}finally{w.random=old;}};
  const gold=[],sales=[],arrivals=[],visibility=[];let last=0,lastForecast='';
  const waves=new Map();
  for(let frame=0;frame<1560;frame++){
    const old=w.random;w.random=rng(777+frame);w.input(p.id,human.input());w.random=old;
    for(const d of drivers)w.input(d.p.id,d.input());
    w.tick(.05);
    const forecast=w.rareForecast(),sig=forecast.phase+':'+forecast.sites.map(s=>s.id).join(',');
    if(sig!==lastForecast){lastForecast=sig;visibility.push([+w.time.toFixed(1),forecast.phase,forecast.sites.map(s=>s.id)]);}
    for(const e of w.events){
      if(+e.id<=last)continue;last=+e.id;
      if(e.kind==='gold'&&['mine','weak'].includes(e.type)){
        if(!waves.has(e.targetId))waves.set(e.targetId,new Set());waves.get(e.targetId).add(e.actorId);
        if(!arrivals.some(a=>a[0]===e.targetId&&a[1]===e.actorId))arrivals.push([e.targetId,e.actorId,+w.time.toFixed(1)]);
      }
      if(e.kind==='gold'&&e.type==='harvest')gold.push([+w.time.toFixed(1),e.targetId,e.layer,e.actorId]);
      if(e.type==='sold'&&e.actorId===p.id)sales.push([+w.time.toFixed(1),e.value]);
    }
  }
  return{mode,policy,rival,station,target,count,score:p.score,gold,sales,firstHits:arrivals,
    participants:[...waves].map(([id,people])=>[id,[...people]]),wait:+human.wait.toFixed(1),
    rivals:others.map(q=>[q.pickLevel,q.score]),rivalWait:drivers.map(d=>+d.wait.toFixed(1)),
    rivalJobs:drivers.map(d=>d.jobs),
    decisions:human.decisions,jobs:human.jobs,visibility};
}
if(process.argv[2]==='fork'){
  for(const rival of ['practiced','native'])for(const mode of ['six','ten','pair'])for(const policy of ['rush','work']){
    const {decisions,jobs,visibility,...summary}=forecastFork({mode,policy,rival});console.log(JSON.stringify(summary));
  }
}else if(process.argv[2]==='branches'){
  for(const target of ['gold-2','gold-4'])for(const mode of ['six','ten','pair']){
    const r=forecastFork({target,mode,policy:'work'});console.log(JSON.stringify(r));
  }
}else if(process.argv[2]==='rounds'){
  for(const mode of ['six','ten','pair'])console.log(JSON.stringify(forecastRound({mode})));
}
