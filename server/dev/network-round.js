import { once } from 'node:events';
import WebSocket from 'ws';
import { World } from '../game.js';
import { createGameServer } from '../index.js';
import { fixedGold } from './causal-sim.js';
import { makeDriver, roles } from './population-sim.js';

const rng=seed=>{let state=seed;return()=>((state=state*16807%2147483647)-1)/2147483646;};
const duration=Number(process.env.NETWORK_ROUND_SECONDS||180);
const world=new World({roundSeconds:duration,random:rng(77),rareRandom:rng(1076)});fixedGold(world);
const app=createGameServer({world});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const port=app.server.address().port,sockets=[],drivers=new Map(),randoms=new Map();
const snapshots=new Map(),joins=[],gaps=[];let started=null,ended=null,lastTick=null,ticks=0;
let fixed=null,resultMismatches=0,peak=0,uniqueStarts=true;
const controllerCosts=[],tickCosts=[];
const originalTick=world.tick.bind(world);
world.tick=dt=>{
  const now=performance.now();if(lastTick!==null)gaps.push(now-lastTick);lastTick=now;ticks++;
  originalTick(dt);
  tickCosts.push(performance.now()-now);
  const humans=[...world.players.values()].filter(p=>!p.bot);peak=Math.max(peak,humans.length);
  uniqueStarts&&=new Set(humans.map(p=>p.startSeamId)).size===humans.length;
};
const native=world.botInput.bind(world),botRandom=new Map();
world.botInput=p=>{
  if(!botRandom.has(p.id))botRandom.set(p.id,rng(p.id.endsWith('0')?1074:2071));
  const old=world.random;world.random=botRandom.get(p.id);try{return native(p);}finally{world.random=old;}
};
const timers=[];
let resolveFinished,rejectFinished;
const finished=new Promise((resolve,reject)=>{resolveFinished=resolve;rejectFinished=reject;});
function join(index){
  const socket=new WebSocket('ws://127.0.0.1:'+port+'/ws');sockets.push(socket);
  socket.on('open',()=>socket.send(JSON.stringify({type:'join',name:'NET-'+roles[index].name+(index+1)})));
  socket.on('error',rejectFinished);
  socket.on('message',raw=>{
    const packet=JSON.parse(raw);
    if(packet.type==='welcome'){
      if(started===null)started=performance.now();
      const player=world.players.get(packet.id);
      drivers.set(socket,makeDriver(world,player,roles[index]));randoms.set(socket,rng(77+997*(index+1)));
      snapshots.set(socket,{count:0,firstClock:null,result:false});
      joins.push({index,at:+world.time.toFixed(2),clock:+world.timeLeft.toFixed(2),late:player.joinedLate,start:player.startSeamId});
    }
    if(packet.type!=='state')return;
    const count=snapshots.get(socket);if(!count)return;count.count++;count.firstClock??=packet.timeLeft;
    if(packet.phase==='finished'){
      ended??=performance.now();const value=JSON.stringify(packet.standings);
      fixed??=value;if(value!==fixed)resultMismatches++;count.result=true;
      if(snapshots.size===8&&[...snapshots.values()].every(s=>s.result))resolveFinished();
    }
  });
}
// First observe an empty server, then join two people and spread six more joins over five seconds.
timers.push(setTimeout(()=>join(0),1500));
for(const [i,ms] of [[1,1800],[2,2600],[3,3300],[4,4000],[5,4800],[6,5500],[7,6300]])
  timers.push(setTimeout(()=>join(i),ms));
const inputTimer=setInterval(()=>{
  const begin=performance.now();
  for(const [socket,driver] of drivers){
    if(socket.readyState!==WebSocket.OPEN||world.phase!=='playing')continue;
    const old=world.random;world.random=randoms.get(socket);
    const packet=driver.input();world.random=old;
    socket.send(JSON.stringify({type:'input',...packet}));
  }
  controllerCosts.push(performance.now()-begin);
},50);
const deadline=setTimeout(()=>rejectFinished(new Error('Live round exceeded wall-clock budget')),Math.max(60000,duration*1250));
try{
  await finished;
  const seconds=(ended-started)/1000;
  console.log(JSON.stringify({type:'local-automated-round',duration,port,wallSeconds:+seconds.toFixed(2),
    ticks,averageHz:+(ticks/seconds).toFixed(2),maxTickGapMs:+Math.max(...gaps).toFixed(1),
    maxControllerMs:+Math.max(...controllerCosts).toFixed(1),maxServerTickMs:+Math.max(...tickCosts).toFixed(1),
    gapsOver150ms:gaps.filter(g=>g>150).length,peakHumans:peak,uniqueStarts,joins,
    snapshotCounts:[...snapshots.values()].map(s=>s.count),allSawResults:true,resultMismatches,
    standings:JSON.parse(fixed)}));
}catch(error){
  console.log(JSON.stringify({error:error.message,clock:world.timeLeft,phase:world.phase,ticks,joins,
    snapshots:[...snapshots.values()],maxControllerMs:Math.max(...controllerCosts),maxServerTickMs:Math.max(...tickCosts),
    maxTickGapMs:Math.max(...gaps)}));throw error;
}finally{
  clearInterval(inputTimer);clearTimeout(deadline);timers.forEach(clearTimeout);
  sockets.forEach(s=>s.close());await app.stop();
}
