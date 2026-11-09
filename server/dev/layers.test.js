import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../game.js';
import { VALLEY } from '../valley.js';
import { race, cutOrContinue } from './layers-sim.js';

function fixture(layers=[6,24]) {
  const w=new World({bots:false,goldLayers:layers,botTactics:true,botKnowledge:true,secondPickCost:30});
  const d=w.deposits.find(d=>d.kind==='gold');
  Object.assign(d,{active:true,layer:1,hp:layers[0],expiresAt:25});w.nextRareAt=500;
  const a=w.addPlayer('a','A'),b=w.addPlayer('b','B');
  [a,b].forEach((p,i)=>Object.assign(p,{...d.approaches[i*3],y:w.valley.height(d.approaches[i*3].x,d.approaches[i*3].z),pickLevel:3}));
  return {w,d,a,b};
}

test('layer contributions reset, hit overflow is discarded and actual input lets the later miner win the core',()=>{
  const a=race({layers:null,delay:.6,firstPrecision:.35,secondPrecision:1});
  const b=race({layers:[6,24],delay:.6,firstPrecision:.35,secondPrecision:1});
  assert.deepEqual(a.bags,[2,0]);assert.deepEqual(b.bags,[1,1]);
  assert.deepEqual(b.harvests.map(h=>h[1]),[1,2]);
  const {w,d,a:first,b:second}=fixture();
  d.hp=1;
  w.mine(first,d,true,d.weak);
  assert.equal(first.bag.length,1);assert.equal(d.hp,24);assert.equal(d.work.size,0);
  w.mine(first,d,true,d.weak);
  for(let i=0;i<3;i++)w.mine(second,d,true,d.weak);
  assert.equal(first.bag.length,1);assert.equal(second.bag.length,1);
  assert.equal(d.hp,0);assert.equal(d.layerResults.length,2);
  const packet=w.snapshot(first.id);
  assert.equal(packet.deposits.find(x=>x.id===d.id).remainingYield,0);
  assert.equal(packet.localClaims.filter(x=>x.status==='received').length,1);
  assert.equal(packet.localClaims.filter(x=>x.status==='other-received').length,1);
  assert.equal(new Set(packet.localClaims.map(x=>x.resultId)).size,2);
  assert.deepEqual(w.snapshot(first.id).localClaims,packet.localClaims);
});

test('one layer can be banked, its final ore can be stolen and reclaimed, and late greed fails to sell',()=>{
  const cut=cutOrContinue({remaining:6,cut:true}),greedy=cutOrContinue({remaining:6,cut:false});
  const goldValue=VALLEY.ores.find(ore=>ore.id==='gold').value;
  assert.equal(cut.score,goldValue);assert.equal(greedy.score,0);assert.equal(greedy.unsold,2);
  assert.equal(cutOrContinue({remaining:10,cut:false}).score,goldValue*2);
  const {w,d,a,b}=fixture();w.mine(a,d,true,d.weak);
  w.steal(b,a,a);assert.deepEqual(a.bag,[]);assert.deepEqual(b.bag,['gold']);
  w.steal(a,b,b);assert.deepEqual(a.bag,['gold']);assert.deepEqual(b.bag,[]);
  assert.equal(a.score+b.score,0,'moving the layer ore never awards banked score');
});

test('full bags, expiry and rematch cannot mint another layer or leak previous claims',()=>{
  const {w,d,a,b}=fixture();w.mine(a,d,true,d.weak);
  a.bag=Array(w.config.capacity).fill('crystal');
  w.mine(a,d,true,d.weak);assert.equal(d.hp,24);
  w.mine(b,d,true,d.weak);
  d.expiresAt=.05;w.tick(.05);
  assert.equal(d.hp,0);assert.equal(a.bag.filter(x=>x==='gold').length,0);
  assert.equal(b.bag.length,0);
  const claims=w.snapshot(b.id).localClaims;
  assert.equal(claims[0].status,'expired');assert.equal(claims[0].layer,2);
  assert.equal(claims[0].resultAmount,0);
  w.resetRound();
  assert.equal(a.bag.length,0);assert.equal(b.bag.length,0);
  assert.deepEqual(w.snapshot(b.id).localClaims,[]);
  assert.ok(w.deposits.filter(x=>x.kind==='gold').every(x=>x.layer===0&&x.layerResults.length===0));
});

test('native bots choose banking versus the second contest from visible rivals and remaining time',()=>{
  const {w,d,a,b}=fixture();a.id='bot-0';b.id='bot-1';
  a.bag=['gold'];b.bag=['gold'];d.layer=2;d.hp=24;
  a.botTarget=b.botTarget=d;
  a.botVisibleRivals=[{id:'rival',x:d.x,z:d.z,pickLevel:3,inventoryCount:0}];
  b.botVisibleRivals=[...a.botVisibleRivals];
  assert.equal(w.botShouldBankLayer(a),true);assert.equal(w.botShouldBankLayer(b),false);
  a.botVisibleRivals=[];assert.equal(w.botShouldBankLayer(a),false);
  w.timeLeft=2;assert.equal(w.botShouldBankLayer(b),true);
  const old=new World({bots:false,goldLayers:null});assert.equal(old.snapshot().goldLayers,undefined);
});

test('two live sockets receive the same layer harvest IDs without a second grant on repeated snapshots', async t=>{
  const { createGameServer }=await import('../index.js');
  const { default:WebSocket }=await import('ws');
  const { once }=await import('node:events');
  const w=new World({bots:false,goldLayers:[6,24]});
  const app=createGameServer({world:w});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.stop());
  function receive(socket,predicate){return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.off('message',read);reject(new Error('Missing candidate state'));},3000);
    function read(raw){const packet=JSON.parse(raw);if(predicate(packet)){clearTimeout(timer);socket.off('message',read);resolve(packet);}}
    socket.on('message',read);
  });}
  const port=app.server.address().port;
  const sockets=[new WebSocket(`ws://127.0.0.1:${port}/ws`),new WebSocket(`ws://127.0.0.1:${port}/ws`)];
  await Promise.all(sockets.map(s=>once(s,'open')));
  const welcomes=sockets.map(s=>receive(s,p=>p.type==='welcome'));
  sockets.forEach((s,i)=>s.send(JSON.stringify({type:'join',name:'Layer'+i})));
  const ids=(await Promise.all(welcomes)).map(p=>p.id),d=w.deposits.find(d=>d.kind==='gold');
  Object.assign(d,{active:true,layer:1,hp:6,expiresAt:w.time+25});w.nextRareAt=500;
  const ps=ids.map(id=>w.players.get(id));
  ps.forEach((p,i)=>Object.assign(p,{...d.approaches[i*3],y:w.valley.height(d.approaches[i*3].x,d.approaches[i*3].z),pickLevel:3}));
  const states=sockets.map(s=>receive(s,p=>p.type==='state'&&p.events.filter(e=>e.type==='harvest').length===2));
  w.mine(ps[0],d,true,d.weak);
  for(let i=0;i<4;i++)w.mine(ps[1],d,true,d.weak);
  const packets=await Promise.all(states);
  const harvests=packets.map(p=>p.events.filter(e=>e.type==='harvest'));
  assert.deepEqual(harvests[0],harvests[1]);assert.deepEqual(harvests[0].map(e=>e.layer),[1,2]);
  assert.equal(new Set(harvests[0].map(e=>e.id)).size,2);
  assert.deepEqual(packets.map(p=>p.localClaims.map(c=>c.layer)),[[1],[2]]);
  const again=await receive(sockets[0],p=>p.type==='state');
  assert.equal(again.players.find(p=>p.id===ids[0]).inventoryCount,1);
  assert.equal(again.players.find(p=>p.id===ids[1]).inventoryCount,1);
  sockets.forEach(s=>s.close());
});
