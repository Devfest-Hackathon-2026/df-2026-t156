import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { once } from 'node:events';
import { World } from './game.js';
import { StateStream, prepareFrame } from './stream.js';
import { createGameServer } from './index.js';

test('ordered deltas restore poses, accounting, removals and rematch without replaying events',()=>{
 const w=new World({bots:false}),a=w.addPlayer('a','A'),b=w.addPlayer('b','B'),stream=new StateStream();
 const view={players:new Map(),poses:new Map(),deposits:new Map(),stations:new Map()},seen=new Set();
 function receive(){
  const snapshot=w.snapshot(a.id),prepared=prepareFrame(snapshot),frame=stream.frame(prepared,a.id,snapshot.localClaims);
  if(frame.full)for(const map of Object.values(view))map.clear();
  for(const id of frame.removedPlayers||[]) {view.players.delete(id);view.poses.delete(id);}
  for(const key of Object.keys(view))for(const row of frame[key]||[])view[key].set(row.id,row);
  for(const e of frame.events){assert.ok(!seen.has(e.id));seen.add(e.id);}
  for(const player of prepared.players)assert.deepEqual(view.players.get(player.id),player);
  for(const p of prepared.poses){const actual=view.poses.get(p.id);assert.equal(actual.x,p.x);assert.equal(actual.y,p.y);assert.equal(actual.z,p.z);assert.equal(actual.yaw,p.yaw);}
  for(const d of prepared.deposits)assert.deepEqual(view.deposits.get(d.id),d);
  assert.equal(view.players.size,w.players.size);stream.acknowledge(frame.seq);return frame;
 }
 assert.equal(receive().full,true);
 w.event('swing',a,w.eyes(a));assert.equal(receive().events.length,1);assert.equal(receive().events.length,0);
 a.x+=.012345;a.bag.push('gold');a.score=28;a.grossSales=36;a.investmentSpent=8;a.pickLevel=2;
 receive();b.x+=.7;receive();
 assert.equal(view.players.get('a').score,28);assert.equal(view.players.get('a').inventory[0].count,1);
 w.removePlayer('b');receive();assert.equal(view.players.has('b'),false);
 w.timeLeft=.05;w.tick(.05);const result=receive();assert.equal(result.standings[0].score,28);
 w.resetRound();const rematch=receive();assert.equal(rematch.full,true);assert.deepEqual(rematch.standings,[]);assert.equal(view.players.get('a').score,0);
 const reconnect=new StateStream().frame(prepareFrame(w.snapshot(a.id)),a.id,[]);assert.equal(reconnect.full,true);assert.ok(reconnect.deposits.length);
});

test('clock recovery expires time without replaying attacks or awarding hold progress',()=>{
 const w=new World({bots:false,roundSeconds:2}),p=w.addPlayer('a','A');
 p.pendingAttacks.push({});p.sellProgress=.2;const at={x:p.x,y:p.y,z:p.z};
 w.advanceClock(1.2);assert.equal(w.time,1.2);assert.equal(w.timeLeft,.8);assert.equal(p.sellProgress,.2);assert.equal(w.events.length,0);assert.equal(p.x,at.x);
 w.advanceClock(1);assert.equal(w.phase,'finished');assert.ok(Math.abs(w.resultTimeLeft-7.8)<1e-8);
 w.advanceClock(7.8);assert.equal(w.phase,'playing');assert.equal(w.round,2);assert.equal(w.timeLeft,2);
});

test('a non-consuming client has at most three outstanding states; ack resumes current state and legacy still works',async t=>{
 const app=createGameServer({world:new World({bots:false})});t.after(()=>app.stop());
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const socket=new WebSocket('ws://127.0.0.1:'+app.server.address().port+'/ws');t.after(()=>socket.close());
 const packets=[];socket.on('message',raw=>packets.push(JSON.parse(raw)));await once(socket,'open');socket.send(JSON.stringify({type:'join',name:'slow',protocol:2}));
 await new Promise(r=>setTimeout(r,300));const frames=packets.filter(p=>p.type==='frame');assert.equal(frames.length,3);assert.equal(app.networkStats.maxOutstanding,3);
 const p=app.world.players.values().next().value;p.score=42;p.grossSales=42;
 socket.send(JSON.stringify({type:'input',ack:frames.at(-1).seq}));await new Promise(r=>setTimeout(r,100));
 assert.ok(packets.some(p=>p.type==='frame'&&p.players?.some(p=>p.score===42)));assert.ok(app.networkStats.coalescedFrames>0);
 const legacy=new WebSocket('ws://127.0.0.1:'+app.server.address().port+'/ws');t.after(()=>legacy.close());await once(legacy,'open');const state=once(legacy,'message');legacy.send(JSON.stringify({type:'join',name:'old'}));await state;
 const [raw]=await once(legacy,'message');assert.equal(JSON.parse(raw).type,'state');
});
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('browser batches reliable deltas once per render, acks consumption and ignores replaced sockets',()=>{
 const messages=[],sent=[],sockets=[];
 const noop=()=>{};const canvas={addEventListener:noop,removeEventListener:noop};
 const document={addEventListener:noop,removeEventListener:noop,hasFocus:()=>true};
 class Socket {constructor(){this.readyState=1;this.bufferedAmount=0;sockets.push(this);}send(text){sent.push(JSON.parse(text));}close(){this.readyState=3;}}
 let library;const context={LibraryManager:{library:{}},mergeInto:(_,value)=>library=value,UTF8ToString:v=>v,Module:{canvas},window:{addEventListener:noop,removeEventListener:noop},document,location:{protocol:'http:',host:'local'},WebSocket:Socket,SendMessage:(_,method,json)=>messages.push({method,json}),console};
 vm.runInNewContext(readFileSync(new URL('../Unity/Assets/Plugins/WebGL/OrbitSocket.jslib',import.meta.url),'utf8'),context);
 library.OrbitConnect('OrbitClient');const first=sockets[0];
 const emit=p=>first.onmessage({data:JSON.stringify(p)});
 emit({type:'frame',seq:1,full:true,round:1,players:[{id:'a',score:0}],poses:[{id:'a',x:0}],deposits:[],stations:[],events:[{id:'1'}]});
 emit({type:'frame',seq:2,full:false,round:1,poses:[{id:'a',x:1}],events:[{id:'2'}]});
 assert.equal(messages.length,0);library.OrbitSend('{"type":"input"}');assert.equal(sent.at(-1).ack,0);
 library.OrbitPoll();assert.equal(messages.length,1);const frame=JSON.parse(messages[0].json);assert.equal(frame.full,true);assert.equal(frame.seq,2);assert.equal(frame.poses[0].x,1);assert.equal(frame.players[0].score,0);assert.equal(frame.events.length,2);
 library.OrbitSend('{"type":"input"}');assert.equal(sent.at(-1).ack,2);library.OrbitPoll();assert.equal(messages.length,1);
 const oldClose=first.onclose,oldError=first.onerror;library.OrbitConnect('OrbitClient');oldClose();oldError();assert.equal(messages.length,1);
});

test('expired queued clicks and a preceding round hold cannot replay after clock recovery',()=>{
 const w=new World({bots:false}),p=w.addPlayer('a','A');
 w.input(p.id,{attackId:1,attackTime:0,attackAx:0,attackAy:1,attackAz:0});assert.equal(p.pendingAttacks.length,1);
 w.advanceClock(1);w.tick(.05);assert.equal(w.events.length,0);
 const previousRound=w.round;w.resetRound();
 w.input(p.id,{motionRound:previousRound,fire:true,sell:true,attackId:2,attackTime:w.time});
 assert.equal(p.pendingAttacks.length,0);assert.equal(p.input.fire,false);assert.equal(p.input.sell,false);
});
