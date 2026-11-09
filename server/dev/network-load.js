import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import net from 'node:net';
import path from 'node:path';
const root=process.env.NETWORK_SERVER_ROOT||(await import('node:url')).fileURLToPath(new URL('../',import.meta.url));
const {createGameServer}=await import(pathToFileURL(path.join(root,'index.js')));
const {World}=await import(pathToFileURL(path.join(root,'game.js')));
const modern=process.env.NETWORK_PROTOCOL==='2',duration=Number(process.env.NETWORK_SECONDS||180),count=Number(process.env.NETWORK_CLIENTS||8);
const world=new World({roundSeconds:duration}),app=createGameServer({world});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const stats={mode:modern?'delta':'legacy',duration,clients:count,bytes:0,messages:0,windows:{early:0,middle:0,late:0},tickCosts:[],pumpGaps:[],snapshotCosts:[],maxEvents:0,maxServerBuffer:0,corrections:0,latencies:[],ticks:0};
let tickAt=performance.now(),begin=0,ended=false;
const limited=Number(process.env.NETWORK_BYTES_PER_SECOND||0), proxyQueues=[], proxyConnections=[];
let proxy=null,proxyTimer=null;
if(limited){
 proxy=net.createServer(client=>{
  const upstream=net.connect(app.server.address().port,'127.0.0.1');
  const q={client,upstream,queue:[],offset:0,bytes:0,peak:0,tokens:0};proxyQueues.push(q);proxyConnections.push(client,upstream);
  client.pipe(upstream);upstream.on('data',data=>{q.queue.push(data);q.bytes+=data.length;q.peak=Math.max(q.peak,q.bytes);});
  upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());client.on('close',()=>upstream.destroy());
 });
 await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
 let last=performance.now();proxyTimer=setInterval(()=>{const now=performance.now(),dt=(now-last)/1000;last=now;
  for(const q of proxyQueues){q.tokens=Math.min(limited*.1,q.tokens+limited*dt);while(q.queue.length&&q.tokens>=1){const data=q.queue[0],n=Math.min(data.length-q.offset,Math.floor(q.tokens));q.client.write(data.subarray(q.offset,q.offset+n));q.offset+=n;q.tokens-=n;q.bytes-=n;if(q.offset===data.length){q.queue.shift();q.offset=0;}}}
 },5);
}
const address=proxy?proxy.address().port:app.server.address().port;stats.bandwidthBytesPerSecond=limited||null;
stats.observations=[];stats.npcTravel=0;let npcBefore=new Map(),nextObserve=15;

const tick=world.tick.bind(world);world.tick=dt=>{let now=performance.now();stats.pumpGaps.push(now-tickAt);tickAt=now;tick(dt);stats.tickCosts.push(performance.now()-now);stats.ticks++;
 for(const p of world.players.values())if(p.bot){const old=npcBefore.get(p.id);if(old)stats.npcTravel+=Math.hypot(p.x-old.x,p.z-old.z);npcBefore.set(p.id,{x:p.x,z:p.z});}
 stats.maxEvents=Math.max(stats.maxEvents,world.events.length);};
const snapshot=world.snapshot.bind(world);world.snapshot=id=>{let at=performance.now();let s=snapshot(id);stats.snapshotCosts.push(performance.now()-at);return s;};
let resolveEnd;const finish=new Promise(r=>resolveEnd=r);const sockets=[];
for(let i=0;i<count;i++){
 const s=new WebSocket('ws://127.0.0.1:'+address+'/ws');sockets.push(s);s.info={id:null,ack:0,attack:0,time:0,correction:0};
 s.on('open',()=>s.send(JSON.stringify({type:'join',name:'LOAD'+i,...(modern?{protocol:2}:{})})));
 s.on('message',bytes=>{const p=JSON.parse(bytes);if(p.type==='welcome'){s.info.id=p.id;if(!begin)begin=performance.now();return;}if(p.type!=='state'&&p.type!=='frame')return;
 stats.bytes+=bytes.length;stats.messages++;s.info.ack=p.seq||0;s.info.receivedClock=p.serverTime;s.info.phase=p.phase;
 const elapsed=(performance.now()-begin)/1000,key=elapsed<60?'early':elapsed<120?'middle':'late';stats.windows[key]+=bytes.length;
 stats.latencies.push(Math.max(0,(performance.now()-begin)/1000-p.serverTime));
 if(p.phase==='finished'&&!ended){ended=true;resolveEnd();}
 });
 await once(s,'open');
}
const input=setInterval(()=>{
 const elapsed=(performance.now()-begin)/1000;
 if(elapsed>=nextObserve){stats.observations.push({wall:+elapsed.toFixed(2),world:+world.time.toFixed(2),received:sockets.map(s=>({clock:s.info.receivedClock,phase:s.info.phase})),npcTravel:+stats.npcTravel.toFixed(2)});nextObserve+=15;}
 for(const s of sockets){const p=world.players.get(s.info.id);if(!p||s.readyState!==1)continue;
 if(p.correctionId>s.info.correction){stats.corrections+=p.correctionId-s.info.correction;s.info.correction=p.correctionId;}
 const spam=elapsed>=15&&elapsed<120;
 s.send(JSON.stringify({type:'input',ack:s.info.ack,motionSeq:++s.info.time,motionRound:world.round,motionTime:elapsed,px:p.x,py:p.y,pz:p.z,correctionId:p.correctionId,impulseId:p.impulseId,x:0,z:0,ax:Math.sin(p.yaw),ay:0,az:Math.cos(p.yaw),attackId:spam?++s.info.attack:s.info.attack,attackTime:world.time,attackAx:Math.sin(p.yaw),attackAy:0,attackAz:Math.cos(p.yaw),fire:spam,miningOnly:true}));
 }
 for(const s of app.wss.clients)stats.maxServerBuffer=Math.max(stats.maxServerBuffer,s.bufferedAmount);
},50);
const deadline=setTimeout(()=>resolveEnd(),(duration+(limited?5:30))*1000);
let suspend=null;
if(process.env.NETWORK_STALL_AT)suspend=setTimeout(()=>{const end=performance.now()+1200;while(performance.now()<end){};},Number(process.env.NETWORK_STALL_AT)*1000);
await finish;clearInterval(input);clearTimeout(deadline);clearTimeout(suspend);
const wall=(performance.now()-begin)/1000;
const summary=a=>({max:+Math.max(...a).toFixed(3),p99:+a.sort((a,b)=>a-b)[Math.floor(a.length*.99)].toFixed(3),mean:+(a.reduce((a,b)=>a+b,0)/a.length).toFixed(3)});
console.log(JSON.stringify({...stats,tickCosts:summary(stats.tickCosts),pumpGaps:summary(stats.pumpGaps),snapshotCosts:summary(stats.snapshotCosts),latencies:summary(stats.latencies),wallSeconds:+wall.toFixed(3),worldSeconds:world.time,phase:world.phase,serverNetwork:app.networkStats||null,peakProxyQueuedBytes:Math.max(0,...proxyQueues.map(q=>q.peak)),remainingProxyQueuedBytes:proxyQueues.map(q=>q.bytes)}));
sockets.forEach(s=>s.terminate());if(proxyTimer)clearInterval(proxyTimer);proxyConnections.forEach(s=>s.destroy());if(proxy)await new Promise(r=>proxy.close(r));await app.stop();
