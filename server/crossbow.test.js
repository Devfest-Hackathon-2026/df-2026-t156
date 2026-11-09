import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { World } from './game.js';
import { Valley, VALLEY } from './valley.js';
import { BOW, bowPower, boltPosition, botCrossbowInput } from './crossbow.js';
import { recordCombatPose } from './melee.js';
import { StateStream, prepareFrame } from './stream.js';
import { createGameServer } from './index.js';
const flat=new Valley({...VALLEY,heights:VALLEY.heights.map(()=>0),colliders:[],deposits:[]});
function fixture(valley=flat){const w=new World({bots:false,valley,random:()=>.5}),a=w.addPlayer('a','A'),b=w.addPlayer('b','B');
  Object.assign(a,{x:18,y:0,z:-24,yaw:0});Object.assign(b,{x:18,y:0,z:-10,yaw:Math.PI,bag:['gold']});recordCombatPose(w,a);recordCombatPose(w,b);return{w,a,b};}
function advance(w,seconds){for(let t=0;t<seconds-1e-9;t+=.05)w.tick(.05);}
function charge(w,a,seconds=1){for(let t=0;t<seconds-1e-9;t+=.05){w.input(a.id,{weapon:'bow',bowDrawing:true});w.tick(.05);}}
function release(w,a,b,id=1,extra={}){const e=w.eyes(a),dx=b.x-e.x,dz=b.z-e.z,flight=Math.hypot(dx,dz)/60;
  const dy=b.y+1.15+BOW.gravity*flight*flight/2-e.y,len=Math.hypot(dx,dy,dz);
  w.input(a.id,{weapon:'bow',bowDrawing:false,shotId:id,shotTime:w.time,shotAx:dx/len,shotAy:dy/len,shotAz:dz/len,motionRound:w.round,...extra});}
function shoot(w,a,b,id=1,extra={}){charge(w,a);release(w,a,b,id,extra);}
const impacts=w=>w.events.filter(e=>e.type==='bolt-impact');

test('1.8.9 draw curve and air flight use blocks per twenty-Hz tick, not metres per second by accident',()=>{
  assert.equal(bowPower(20),1);assert.equal(bowPower(40),1);assert.ok(bowPower(2)<.1);assert.equal(bowPower(3),.1075);
  assert.ok(Math.abs(bowPower(10)-5/12)<1e-12);
  const arrow={x:0,y:10,z:0,vx:60,vy:0,vz:0,spawnTime:0,expiresAt:8};
  const a=boltPosition(arrow,.05),b=boltPosition(arrow,.1);
  assert.ok(Math.abs(a.x-3)<1e-10);assert.ok(Math.abs(a.y-10)<1e-10);
  assert.ok(Math.abs(b.x-5.97)<1e-10);assert.ok(Math.abs(b.y-9.95)<1e-10);
});

test('holding draws without firing; release creates one shared flight and one later ore transfer',()=>{
  const{w,a,b}=fixture();charge(w,a);assert.equal(w.bolts.length,0);assert.equal(a.bowDrawing,true);
  release(w,a,b);w.tick(.05);const spawn=w.snapshot().bolts[0];assert.equal(spawn.power,1);
  assert.equal(spawn.shotId,1);
  const receipt=w.events.find(e=>e.type==='shot');
  assert.equal(receipt.shotId,1);assert.equal(receipt.spawnTime,spawn.spawnTime);
  assert.deepEqual(w.snapshot().bow,BOW);assert.equal(a.bag.length,0);
  advance(w,.1);assert.deepEqual(w.snapshot().bolts[0],spawn,'flight metadata remains static');
  advance(w,.2);assert.deepEqual(a.bag,['gold']);assert.deepEqual(b.bag,[]);
  assert.equal(w.bolts.length,0);assert.ok(b.impulseId>0,'arrows share normal accepted-hit knockback');
  const contact=impacts(w).at(-1),at=boltPosition(spawn,contact.impactTime);
  assert.ok(contact.impactTime>spawn.spawnTime&&contact.impactTime<=w.time);
  assert.ok(Math.hypot(contact.x-at.x,contact.y-at.y,contact.z-at.z)<1e-6,'terminal wake receives the exact contact on this ballistic curve');
  assert.equal(w.events.find(e=>e.type==='steal').weapon,'bow');assert.equal(impacts(w).at(-1).reason,'hit');
  assert.equal(w.events.filter(e=>e.type==='swing').length,0);assert.deepEqual([a.score,b.score],[0,0]);
});

test('under-three-tick taps are invalid, and partial releases have the original lower launch speed',()=>{
  const{w,a,b}=fixture();charge(w,a,.1);release(w,a,b);w.tick(.05);assert.equal(w.bolts.length,0);
  assert.equal(w.events.find(e=>e.type==='shot-blocked').shotId,1);
  charge(w,a,.15);release(w,a,b,2);w.tick(.05);const bolt=w.bolts[0];
  assert.ok(bolt);assert.ok(Math.abs(bolt.power-.1075)<1e-10);
  assert.ok(Math.hypot(bolt.vx,bolt.vy,bolt.vz)<7);
});

test('switching, cancellation, focus-equivalent stale input and forged release power cannot manufacture a shot',()=>{
  const{w,a,b}=fixture();release(w,a,b,1,{power:999,drawTicks:999});w.tick(.05);assert.equal(w.bolts.length,0);
  charge(w,a,.5);w.input(a.id,{weapon:'pick',bowDrawing:false});release(w,a,b,2);w.tick(.05);assert.equal(w.bolts.length,0);
  charge(w,a,.5);w.input(a.id,{weapon:'bow',bowDrawing:false});release(w,a,b,3);w.tick(.05);assert.equal(w.bolts.length,0);
  charge(w,a,.2);advance(w,.65);assert.equal(a.bowDrawing,false);release(w,a,b,4);w.tick(.05);assert.equal(w.bolts.length,0);
});

test('fresh draws can be repeated without an invented reload timer, but duplicate IDs cannot repeat a release',()=>{
  const{w,a,b}=fixture();shoot(w,a,b);w.tick(.05);const first=w.bolts[0].id;
  release(w,a,b);w.tick(.05);assert.equal(w.bolts.length,1);
  charge(w,a,.15);release(w,a,b,2);w.tick(.05);
  assert.equal(w.events.filter(e=>e.type==='shot').length,2);assert.ok(w.bolts.some(b=>b.id!==first));
});

test('left attacks remain normal melee with a bow selected, and cannot mine a deposit',()=>{
  const{w,a,b}=fixture();b.z=a.z+2;recordCombatPose(w,b);
  w.input(a.id,{weapon:'bow',attackId:1,attackTime:w.time,attackAx:0,attackAy:0,attackAz:1});w.tick(.05);
  assert.equal(w.events.filter(e=>e.type==='hit').length,1);assert.equal(a.bag.length,1);assert.equal(w.bolts.length,0);
  const d={...VALLEY.deposits[0],x:18,z:-21.5,radius:.6,height:2};
  const f=fixture(new Valley({...flat.data,deposits:[d]})),ore=f.w.deposits[0],hp=ore.hp;
  f.w.input(f.a.id,{weapon:'bow',attackId:1,attackTime:0,attackAx:0,attackAy:0,attackAz:1});f.w.tick(.05);
  assert.equal(ore.hp,hp);
});

test('left clicks while using the bow are consumed without cancelling the draw or adding a release-frame punch',()=>{
  const{w,a,b}=fixture();charge(w,a,.5);
  w.input(a.id,{weapon:'bow',bowDrawing:true,attackId:1,attackTime:w.time,attackAx:0,attackAy:0,attackAz:1});
  assert.equal(a.bowDrawing,true);assert.equal(a.pendingAttacks.length,0);assert.equal(a.attackId,1);
  charge(w,a,.5);release(w,a,b,1,{attackId:2,attackTime:w.time,attackAx:0,attackAy:0,attackAz:1});w.tick(.05);
  assert.equal(w.bolts.length,1);assert.equal(a.pendingAttacks.length,0);
  assert.equal(w.events.filter(e=>e.type==='swing').length,0);
});

test('movement after release evades actual flight instead of rewinding to an old target pose',()=>{
  const{w,a,b}=fixture();shoot(w,a,b);w.tick(.05);w.input(b.id,{x:1,sprint:true});advance(w,.6);
  assert.equal(a.bag.length,0);assert.equal(b.bag.length,1);
});

test('props, imported scenery mesh, deposit bodies and terrain stop arrows; a collapsed passage no longer does',()=>{
  for(const kind of ['trunk','rock','deposit','ground']){
    const c={id:kind==='rock'?'rock-1':'cover',kind,x:18,z:-17,radius:2,height:4};
    const valley=new Valley({...flat.data,colliders:kind==='trunk'||kind==='rock'?[c]:[],deposits:kind==='deposit'?[{...VALLEY.deposits[0],x:18,z:-17,radius:2,height:4}]:[]});
    const{w,a,b}=fixture(valley);shoot(w,a,b,1,kind==='ground'?{shotAy:-.5,shotAz:1}:{});advance(w,.4);
    assert.equal(b.bag.length,1,kind);assert.equal(impacts(w).at(-1)?.reason,'terrain',kind);
    if(kind==='rock'){w.valley.removedRocks.add('rock-1');shoot(w,a,b,2);advance(w,.35);assert.equal(a.bag.length,1);}
  }
});

test('shop protection blocks launching but an empty safety boundary never consumes flight',()=>{
  for(const station of flat.data.stations){
    const{w,a,b}=fixture();Object.assign(a,{x:station.x,z:station.z});shoot(w,a,b);w.tick(.05);
    assert.equal(w.bolts.length,0);assert.equal(w.events.at(-1).reason,'safety');
    const f=fixture();Object.assign(f.a,{x:station.x,z:station.z-12});Object.assign(f.b,{x:station.x,z:station.z+10});
    recordCombatPose(f.w,f.a);recordCombatPose(f.w,f.b);
    shoot(f.w,f.a,f.b);advance(f.w,.6);
    assert.equal(f.b.bag.length,0);assert.equal(f.a.bag.length,1);assert.equal(impacts(f.w).at(-1)?.reason,'hit');
  }
});

test('protected bodies are ignored and do not shield a vulnerable carrier beyond the shop',()=>{
  const{w,a,b}=fixture(),station=w.stations.find(s=>s.id==='central'),safe=w.addPlayer('c','Protected visitor');
  Object.assign(a,{x:station.x,z:station.z-12});Object.assign(b,{x:station.x,z:station.z+10});
  Object.assign(safe,{x:station.x,y:0,z:station.z,bag:['copper']});
  for(const p of [a,b,safe])recordCombatPose(w,p);
  shoot(w,a,b);advance(w,.6);
  assert.deepEqual(safe.bag,[]);assert.ok(safe.grossSales>=2, 'protection also automatically sells the copper');assert.equal(safe.impulseId,0);assert.equal(safe.hurtUntil,0);
  assert.equal(b.bag.length,0);assert.equal(a.bag.length,1);assert.equal(impacts(w).at(-1).targetId,b.id);
});

test('an existing arrow survives its shooter entering protection after release',()=>{
  const{w,a,b}=fixture();shoot(w,a,b);w.tick(.05);assert.equal(w.bolts.length,1);
  const station=w.stations.find(s=>s.id==='central');Object.assign(a,{x:station.x,z:station.z});recordCombatPose(w,a);
  advance(w,.35);assert.equal(a.bag.length,0);assert.equal(a.goldSold,1, 'the arrow still steals gold, then the protected shooter sells it');assert.equal(impacts(w).at(-1).reason,'hit');
});

test('a protected visitor sells automatically, without arrow impact or hurt',()=>{
  const{w,a,b}=fixture(),station=w.stations.find(s=>s.id==='central');
  Object.assign(a,{x:0,z:-12});Object.assign(b,{x:0,z:station.safeRadius-.1});
  recordCombatPose(w,a);recordCombatPose(w,b);shoot(w,a,b);advance(w,.7);
  assert.equal(b.bag.length,0);assert.equal(b.goldSold,1);assert.equal(b.hurtUntil,0);assert.equal(b.impulseId,0);
  assert.ok(impacts(w).every(e=>e.targetId!==b.id));
});

test('protection at swept arrow contact follows a carrier entering or leaving the shop',()=>{
  for(const entering of [true,false]){
    const{w,a,b}=fixture(),station=w.stations.find(s=>s.id==='central');
    Object.assign(a,{x:0,z:-12});Object.assign(b,{x:0,z:station.safeRadius+(entering?.7:-.3)});
    recordCombatPose(w,a);recordCombatPose(w,b);shoot(w,a,b);
    w.input(b.id,{z:entering?-1:1,sprint:true});advance(w,.65);
    assert.equal(b.bag.length,0);assert.equal(b.goldSold,1, 'inside protection the carried gold is automatically sold');
    if(entering){assert.equal(b.hurtUntil,0);assert.equal(b.impulseId,0);assert.ok(impacts(w).every(e=>e.targetId!==b.id));}
    else {assert.equal(impacts(w).at(-1).targetId,b.id);assert.equal(impacts(w).at(-1).reason,'empty');assert.ok(b.impulseId>0);}
  }
});

test('empty and full bodies occlude the next person, while hurt rejects equal bow hits',()=>{
  for(const reason of ['empty','full','hurt']){
    const{w,a,b}=fixture();if(reason==='empty')b.bag=[];if(reason==='full')a.bag=Array(8).fill('copper');
    if(reason==='hurt'){b.hurtUntil=100;b.lastHitDamage=100;}
    shoot(w,a,b);advance(w,.35);assert.equal(impacts(w).at(-1).reason,reason);assert.equal(w.events.filter(e=>e.type==='steal').length,0);
  }
  const{w,a,b}=fixture(),c=w.addPlayer('c','C');Object.assign(c,{x:18,y:0,z:-17,bag:[]});
  shoot(w,a,b);advance(w,.3);assert.equal(b.bag.length,1);assert.equal(a.bag.length,0);assert.equal(impacts(w).at(-1).targetId,c.id);
});

test('a full critical may pass a weaker hurt window without adding the base knockback twice',()=>{
  const{w,a,b}=fixture();b.bag=['gold','gold'];b.hurtUntil=10;b.lastHitDamage=1;
  const impulse=b.impulseId;shoot(w,a,b);advance(w,.35);
  assert.equal(a.bag.length,1);assert.equal(b.impulseId,impulse);assert.ok(b.lastHitDamage>1.5);
});

test('a faster full arrow passes a hurt strength that rejects a slower partial arrow',()=>{
  const{w,a,b}=fixture();b.bag=['gold','gold'];b.hurtUntil=100;b.lastHitDamage=5;
  charge(w,a,.7);release(w,a,b);advance(w,.5);assert.equal(a.bag.length,0);assert.equal(impacts(w).at(-1).reason,'hurt');
  shoot(w,a,b,2);advance(w,.35);assert.equal(a.bag.length,1);assert.ok(b.lastHitDamage>5);assert.equal(b.impulseId,0);
});

test('arrow birth uses the original side/down offsets and arrow-specific wider entity border',()=>{
  const{w,a,b}=fixture();w.random=()=>.25;b.x=18.38;recordCombatPose(w,b);
  shoot(w,a,b,1,{shotAx:0,shotAy:.01,shotAz:1});w.tick(.05);const bolt=w.bolts[0];
  assert.ok(Math.abs(bolt.x-(a.x-.16))<1e-10);assert.ok(Math.abs(bolt.y-(w.eyes(a).y-.1))<1e-10);
  advance(w,.3);assert.equal(a.bag.length,1,'a .54m lateral gap meets arrow border .3, beyond melee border .1');
});

test('stale, future, invalid-direction and old-round releases never launch',()=>{
  for(const extra of [{shotTime:-10},{shotTime:100},{shotAx:NaN},{motionRound:-1}]){
    const{w,a,b}=fixture();shoot(w,a,b,1,extra);w.tick(.05);assert.equal(w.bolts.length,0);
  }
});

test('automatic shop selling is independent of drawing, and clock recovery discards old flight and draw state',()=>{
  const{w,a,b}=fixture();Object.assign(a,{x:0,z:0,bag:['copper']});w.input(a.id,{weapon:'bow',bowDrawing:true});w.tick(.05);
  assert.equal(a.bowDrawing,true, 'automatic selling does not require releasing the held bow');assert.equal(a.sellProgress,0);assert.equal(a.bag.length,0);assert.ok(w.events.some(e=>e.type==='sold'&&e.actorId===a.id));
  Object.assign(a,{x:18,z:-24});shoot(w,a,b);w.tick(.05);assert.equal(w.bolts.length,1);
  w.advanceClock(.3);assert.equal(w.bolts.length,0);assert.equal(a.bowDrawing,false);assert.equal(b.bag.length,1);
});

test('flight is field-bounded, and finish/rematch clears all draws and projectiles',()=>{
  const{w,a,b}=fixture();shoot(w,a,b,1,{shotAx:0,shotAy:.7,shotAz:.7});advance(w,4);
  assert.equal(w.bolts.length,0);
  charge(w,a);release(w,a,b,2);w.tick(.05);w.timeLeft=.05;w.tick(.05);
  assert.equal(w.bolts.length,0);assert.equal(a.bowDrawing,false);
  w.resetRound();assert.equal(a.weapon,'pick');assert.equal(a.shotId,0);assert.equal(a.bowDrawing,false);
});

test('ordered deltas upsert a static ballistic launch once and remove impacts; joins receive live flight',()=>{
  const{w,a,b}=fixture(),s=new StateStream(),frame=()=>s.frame(prepareFrame(w.snapshot()),a.id,[]);
  assert.deepEqual(frame().bow,BOW);shoot(w,a,b);w.tick(.05);const launch=frame();assert.equal(launch.bolts.length,1);
  w.tick(.05);assert.equal(frame().bolts,undefined);
  const joined=new StateStream().frame(prepareFrame(w.snapshot()),b.id,[]);assert.deepEqual(joined.bolts,launch.bolts);
  advance(w,.3);assert.deepEqual(frame().removedBolts,[launch.bolts[0].id]);
});

test('NPC bow drawing respects visible opportunity and opening fifteen seconds, then releases real arrows',()=>{
  const{w,a,b}=fixture();a.bot=true;advance(w,14.9);assert.equal(a.bag.length,0);assert.equal(a.botBow,null);
  Object.assign(a,{x:18,y:0,z:-24,yaw:0});advance(w,3);assert.ok(a.bag.length>=1);assert.ok(b.bag.length<1);
  const cover=new Valley({...flat.data,colliders:[{id:'screen',kind:'trunk',x:18,z:-17,radius:2,height:5}]});
  const hidden=fixture(cover);hidden.a.bot=true;hidden.w.timeLeft=hidden.w.roundSeconds-15;assert.equal(botCrossbowInput(hidden.w,hidden.a),null);
});

test('opening filter leaves NPC pairs and human pairs intact; late joins do not restart it',()=>{
  const{w,a,b}=fixture();a.bot=b.bot=true;assert.ok(botCrossbowInput(w,a));assert.ok(a.botBow);assert.equal(a.bowDrawing,false);
  b.bot=false;w.time=.8;assert.equal(botCrossbowInput(w,a),null);assert.equal(a.pendingShots.length,0);
  const h=fixture();shoot(h.w,h.a,h.b);advance(h.w,.35);assert.equal(h.a.bag.length,1);
  const late=fixture();late.a.bot=true;late.w.timeLeft=late.w.roundSeconds-20;assert.ok(botCrossbowInput(late.w,late.a));
});

async function until(predicate){const deadline=performance.now()+3000;while(!predicate()){
  if(performance.now()>deadline)throw new Error('Timed out waiting for bow WebSocket state');await new Promise(r=>setTimeout(r,5));}}
test('two real ordered WebSockets share draw, release, flight, impact and exactly one transfer',async t=>{
  const app=createGameServer({world:new World({bots:false,valley:flat,random:()=>.5})});t.after(()=>app.stop());
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const peers=[];
  for(const name of ['Archer','Carrier']){const socket=new WebSocket('ws://127.0.0.1:'+app.server.address().port+'/ws'),p={socket,frames:[]};peers.push(p);
    socket.on('message',raw=>{const f=JSON.parse(raw);if(f.type==='welcome')p.id=f.id;if(f.type==='frame'){p.frames.push(f);socket.send(JSON.stringify({type:'input',ack:f.seq,...p.hold}));}});
    await once(socket,'open');socket.send(JSON.stringify({type:'join',name,protocol:2}));await until(()=>p.id&&p.frames.length);}
  const[p,q]=peers,a=app.world.players.get(p.id),b=app.world.players.get(q.id);Object.assign(a,{x:18,y:0,z:-24,yaw:0});Object.assign(b,{x:18,y:0,z:-10,yaw:Math.PI,bag:['gold']});
  p.hold={weapon:'bow',bowDrawing:true};p.socket.send(JSON.stringify({type:'input',...p.hold}));await until(()=>a.bowDrawing&&app.world.time-a.bowDrawStartedAt>=1);
  p.hold={weapon:'bow',bowDrawing:false};p.socket.send(JSON.stringify({type:'input',...p.hold,shotId:1,shotTime:app.world.time,shotAx:0,shotAy:.01,shotAz:1}));
  await until(()=>peers.every(p=>p.frames.some(f=>f.events.some(e=>e.type==='bolt-impact'))));
  for(const p of peers){const events=p.frames.flatMap(f=>f.events);assert.equal(events.filter(e=>e.type==='shot').length,1);assert.equal(events.filter(e=>e.type==='steal').length,1);
    assert.ok(p.frames.some(f=>f.players?.some(row=>row.bowDrawing)));assert.ok(p.frames.some(f=>f.bolts?.length===1));assert.ok(p.frames.some(f=>f.removedBolts?.length===1));}
  assert.deepEqual([a.bag.length,b.bag.length],[1,0]);
});


test('NPCs notice in front, visibly turn before drawing, and keep a fixed dodgeable aim',()=>{
  const{w,a,b}=fixture();a.bot=true;w.timeLeft=w.roundSeconds-20;
  a.yaw=Math.PI;assert.equal(botCrossbowInput(w,a),null);assert.equal(a.botBow,null);
  a.botBowAt=0;a.yaw=Math.PI/3;assert.ok(botCrossbowInput(w,a));assert.equal(a.bowDrawing,false);
  const aim={...a.botBow.press};w.tick(.05);assert.ok(a.yaw>0&&a.yaw<Math.PI/3);assert.equal(a.bowDrawing,false);
  advance(w,.4);assert.equal(a.bowDrawing,true);assert.equal(w.bolts.length,0);
  b.x+=3;advance(w,.6);const shot=w.events.find(e=>e.type==='shot');assert.ok(shot);
  assert.ok(Math.abs(shot.vx/shot.vz-aim.ax/aim.az)<.04);assert.equal(a.bag.length,0);
});

test('a returning NPC banks a normal four-unit load instead of renewing bow theft',()=>{
  const{w,a,b}=fixture();a.bot=true;w.timeLeft=w.roundSeconds-20;a.bag=Array(4).fill('copper');
  assert.equal(botCrossbowInput(w,a),null);assert.equal(a.botBow,null);
});


test('a mining sound turns an NPC towards its last point before forward vision can acquire the miner',()=>{
  const{w,a,b}=fixture();a.bot=true;w.timeLeft=w.roundSeconds-20;a.yaw=Math.PI;b.z=-13;
  w.event('weak',b,{x:b.x,y:b.y+1,z:b.z});assert.ok(botCrossbowInput(w,a));
  assert.equal(a.botBow,null);assert.ok(a.botLook);w.tick(.05);
  assert.ok(Math.abs(a.yaw-Math.PI)<.17,'hearing cannot snap the body around');
  advance(w,1.2);assert.ok(a.botBow);assert.equal(w.bolts.length,0);
});
