import { World } from '../game.js';
import { RoutePlayer } from './balance-sim.js';
import { fixedGold } from './causal-sim.js';

const distance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
const rng = seed => { let value=seed;return ()=>((value=value*16807%2147483647)-1)/2147483646; };
const profiles = {
  fast: { precision:.7,look:.15,aim:.12,wrong:false },
  looking: { precision:.7,look:1.2,aim:.7,wrong:true },
  inaccurate: { precision:.35,look:.15,aim:.12,wrong:false },
  learning: { precision:.35,look:1.2,aim:.7,wrong:true },
};
class LearningRoute extends RoutePlayer {
  constructor(world, player, {profile='fast',maxLevel=3,avoid=true}={}) {
    const pace=profiles[profile];
    super(world,player,{precision:pace.precision,maxLevel,knowledge:true,initialCopper:true,avoid});
    this.pace=pace;this.lastGoal='';this.pauseUntil=0;this.aimed='';this.goalCount=0;
    this.pausedSeconds=0;this.wrongSeconds=0;this.path=[];
  }
  input() {
    const w=this.world,p=this.player;
    if(w.time<this.pauseUntil){this.pausedSeconds+=.05;return {};}
    if(w.time<(this.wrongUntil||0)){
      this.wrongSeconds+=.05;
      return {x:Math.sin(p.yaw+1.1),z:Math.cos(p.yaw+1.1),ax:Math.sin(p.yaw),az:Math.cos(p.yaw)};
    }
    const packet=super.input();
    if(p.goalKey!==this.lastGoal){
      this.lastGoal=p.goalKey;this.goalCount++;
      this.path.push([+w.time.toFixed(1),p.goalKey]);
      this.pauseUntil=w.time+this.pace.look;
      if(this.pace.wrong&&this.goalCount%4===0)this.wrongUntil=this.pauseUntil+1.0;
      return {};
    }
    if(packet.fire&&this.aimed!==p.goalKey){
      this.aimed=p.goalKey;
      this.pauseUntil=w.time+this.pace.aim;
      return {};
    }
    if(!packet.fire&&this.selling)this.aimed='';
    return packet;
  }
}
function pathSeconds(world,from,target) {
  const path=world.valley.path(from,target);
  if(!path.length)return Infinity;
  let length=0,last=from;
  for(const point of path){length+=distance(last,point);last=point;}
  return length/world.valley.data.walkSpeed;
}

export function onboarding({cost=36,spawn=0,profile='fast',maxLevel=3,round=1,seed=77,avoid=true,goldLayers=null}={}){
  const world=new World({bots:false,botTactics:true,botKnowledge:true,secondPickCost:cost,
    random:rng(seed),rareRandom:rng(seed+999),goldLayers});
  while(world.round<round)world.resetRound();
  fixedGold(world);
  world.spawnCounter=spawn;
  const human=world.addPlayer('human','Learner');
  world.starterUntil.clear();
  world.spawn(human,spawn);
  const bots=[world.addPlayer('bot-0','PICK',true),world.addPlayer('bot-1','VEIN',true)];
  bots.forEach((p,i)=>world.spawn(p,[1,6][i]));
  const driver=new LearningRoute(world,human,{profile,maxLevel,avoid});
  const humanRandom=rng(seed+197), native=world.botInput.bind(world), botRandom=new Map(bots.map((p,i)=>[p.id,rng(seed+997*(i+1))]));
  world.botInput=p=>{
    const previous=world.random;world.random=botRandom.get(p.id);
    try{return native(p);}finally{world.random=previous;}
  };
  const upgrades=[],sales=[],harvests=[],missed=[],steals=[],allGold=[],goldWorkers=new Map();
  let last=0, upperPosition=null;
  for(let frame=0;frame<3600;frame++){
    const previous=world.random;world.random=humanRandom;
    world.input(human.id,driver.input());world.random=previous;
    world.tick(.05);
    for(const event of world.events){
      if(+event.id<=last)continue;last=+event.id;
      if(event.type==='harvest'&&event.actorId===human.id)harvests.push([+world.time.toFixed(1),event.kind,event.amount]);
      if(event.type==='harvest'&&event.kind==='gold')allGold.push([+world.time.toFixed(1),event.targetId,event.layer||0,event.actorId,event.amount]);
      if(event.kind==='gold'&&['mine','weak'].includes(event.type)){
        if(!goldWorkers.has(event.targetId))goldWorkers.set(event.targetId,new Set());
        goldWorkers.get(event.targetId).add(event.actorId);
      }
      if(event.type==='steal'&&(event.actorId===human.id||event.targetId===human.id))steals.push([+world.time.toFixed(1),event.actorId,event.kind]);
      if(event.type==='sold'&&event.actorId===human.id)sales.push([+world.time.toFixed(1),event.value,event.bonus]);
      if(event.type==='upgraded'&&event.actorId===human.id){
        upgrades.push([event.amount,+world.time.toFixed(1)]);
        if(event.amount===3)upperPosition={x:human.x,z:human.z};
      }
      if(event.type==='harvest'&&event.actorId!==human.id){
        const deposit=world.deposits.find(d=>d.id===event.targetId);
        const result=deposit?.layerResults.find(r=>r.id===event.id)||deposit?.result;
        if(result?.work.has(human.id))missed.push([+world.time.toFixed(1),event.kind,result.work.get(human.id)]);
      }
    }
  }
  let reachable=0;
  const upper=upgrades.find(([level])=>level===3)?.[1];
  if(upper!==undefined){
    const sequence=['gold-1','gold-3','gold-2','gold-4'];
    for(let i=0;i<4;i++){
      const deposit=world.deposits.find(d=>d.id===sequence[i]);
      const arrive=upper+Math.min(...deposit.approaches.map(at=>pathSeconds(world,upperPosition,at)));
      const mine=Math.ceil(deposit.ore.hp/(3*(1-profiles[profile].precision)+6*profiles[profile].precision))*.54;
      const done=Math.max(arrive,50+i*35)+mine;
      const home=Math.min(...world.stations.map(s=>pathSeconds(world,deposit.approaches[0],s)));
      if(done<75+i*35&&done+home+world.config.sellSeconds<180)reachable++;
    }
  }
  // This is an empty-site travel bound, not the number of waves actually won against the rivals.
  return {cost,spawn,profile,maxLevel,round,seed,goldLayers,upgrades,vacantReachableGoldWaves:reachable,
    goldTaken:harvests.filter(e=>e[1]==='gold').reduce((sum,e)=>sum+e[2],0),
    score:human.score,gross:human.grossSales,spent:human.investmentSpent,
    unsold:world.bagValue(human),paused:+driver.pausedSeconds.toFixed(1),wrongWay:+driver.wrongSeconds.toFixed(1),
    sales,harvests,missed,steals,allGold,goldParticipation:[...goldWorkers].map(([id,workers])=>[id,[...workers]]),
    bots:bots.map(p=>[p.pickLevel,p.score]),path:driver.path};
}

function compact(result) {
  const { path, sales, harvests, ...summary } = result;
  return summary;
}

if(process.argv[2]==='pace'){
  for(const spawn of [0,3])for(const profile of ['fast','looking','inaccurate','learning'])for(const cost of [36,30]){
    const result=onboarding({cost,spawn,profile});
    console.log(JSON.stringify(compact(result)));
  }
}else if(process.argv[2]==='market'){
  for(const round of [1,2])for(const spawn of [0,3])for(const cost of [36,30])
    console.log(JSON.stringify(compact(onboarding({cost,spawn,round,profile:'learning'}))));
}else if(process.argv[2]==='choices'){
  for(const options of [{spawn:0,profile:'fast',avoid:true},
    {spawn:0,profile:'looking',avoid:true},{spawn:3,profile:'looking',avoid:false}])
    for(const maxLevel of [2,3])
      console.log(JSON.stringify(compact(onboarding({cost:30,maxLevel,...options}))));
}
