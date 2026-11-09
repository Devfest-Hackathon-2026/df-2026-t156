import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from './game.js';
import { Valley, VALLEY } from './valley.js';
import { hitPlayer } from './melee.js';

const flat=new Valley({...VALLEY,heights:VALLEY.heights.map(()=>0),colliders:[],deposits:[]});
function fixture({bot=false,valley=flat}={}){
  const w=new World({bots:false,valley,random:()=>.5}),a=w.addPlayer('a','A'),b=w.addPlayer('b','B',bot);
  Object.assign(a,{x:18,y:0,z:-10});Object.assign(b,{x:20,y:0,z:-10});
  return{w,a,b};
}
function press(w,p,id,target){const eye=w.eyes(p),dx=target.x-eye.x,dy=target.y+1.2-eye.y,dz=target.z-eye.z,length=Math.hypot(dx,dy,dz);
  w.input(p.id,{attackId:id,attackTime:w.time,attackAx:dx/length,attackAy:dy/length,attackAz:dz/length,miningOnly:true});}

test('a full carrier can immediately take its lost unit back from the thief with one physical press',()=>{
  const{w,a,b}=fixture();b.bag=Array(8).fill('crystal');a.nextStrike=b.nextStrike=100;
  press(w,a,1,b);w.tick(.05);
  assert.deepEqual([a.bag.length,b.bag.length],[1,7]);
  press(w,b,1,a);w.tick(.05);
  assert.deepEqual([a.bag.length,b.bag.length],[0,8]);
  assert.equal(w.events.filter(e=>e.type==='steal').length,2);
  assert.ok(w.events.filter(e=>e.type==='steal').every(e=>e.amount===1));
  assert.deepEqual([a.score,b.score],[0,0],'inventory moves, banked score does not');
});

test('the last unit can be stolen, recovered, and never duplicated by rapid or repeated inputs',()=>{
  const{w,a,b}=fixture();b.bag=['gold'];
  press(w,a,1,b);w.tick(.05);assert.deepEqual([a.bag.length,b.bag.length],[1,0]);
  press(w,b,1,a);w.tick(.05);assert.deepEqual([a.bag.length,b.bag.length],[0,1]);
  press(w,b,1,a);w.tick(.05);
  assert.equal(a.bag.length+b.bag.length,1);
  assert.equal(w.events.filter(e=>e.type==='steal').length,2,'same attack id cannot repeat a transfer');
});

test('normal follow-ups use only the half-second hurt window, including the final unit',()=>{
  const{w,a,b}=fixture();b.bag=['copper','gold'];
  hitPlayer(w,a,b,b,{ax:1,az:0});assert.equal(b.bag.length,1);
  w.time=.49;hitPlayer(w,a,b,b,{ax:1,az:0});assert.equal(b.bag.length,1);
  w.time=.5;hitPlayer(w,a,b,b,{ax:1,az:0});assert.equal(b.bag.length,0);
  assert.equal(a.bag.length,2);assert.equal(w.snapshot().players.find(p=>p.id===b.id).invuln,0);
});

test('empty targets and full attackers retain knockback without minting or swapping ore',()=>{
  const{w,a,b}=fixture();a.bag=Array(8).fill('copper');b.bag=['gold'];
  hitPlayer(w,a,b,b,{ax:1,az:0});
  assert.equal(b.impulseId,1);assert.equal(w.events.find(e=>e.type==='hit').meleeReason,'full');
  assert.deepEqual([a.bag.length,b.bag.length],[8,1]);
  const empty=fixture();hitPlayer(empty.w,empty.a,empty.b,empty.b,{ax:1,az:0});
  assert.equal(empty.b.impulseId,1);assert.equal(empty.w.events.find(e=>e.type==='hit').meleeReason,'empty');
  assert.equal(empty.w.events.filter(e=>e.type==='steal').length,0);
});

test('a stronger falling critical keeps the existing hit exception but still moves only one ore',()=>{
  const{w,a,b}=fixture();b.bag=Array(3).fill('gold');
  hitPlayer(w,a,b,b,{ax:1,az:0});const impulse=b.impulseId;
  w.time=.1;Object.assign(a,{grounded:false,velocityY:-1});hitPlayer(w,a,b,b,{ax:1,az:0});
  assert.equal(a.bag.length,2);assert.equal(b.impulseId,impulse,'no second base knockback');
  hitPlayer(w,a,b,b,{ax:1,az:0});assert.equal(a.bag.length,2,'equal criticals do not bypass hurt repeatedly');
});

test('a recently robbed NPC counters despite its mining cooldown, then disengages and sells',()=>{
  const{w,a,b}=fixture({bot:true});b.bag=Array(8).fill('copper');b.nextStrike=100;
  press(w,a,1,b);w.tick(.05);
  let recovered=false;
  for(let i=0;i<36;i++){w.input(a.id,{});w.tick(.05);if(b.bag.length===8){recovered=true;break;}}
  assert.ok(recovered,'visible, reachable thief offers a real counter opportunity');
  assert.equal(b.lastTheft,null);assert.ok(b.botDisengageUntil>w.time);
  w.tick(.05);assert.equal(b.botChase,null);
  for(let i=0;i<240;i++){w.input(a.id,{});w.tick(.05);}
  assert.ok(b.grossSales>0,'the counter episode returns to the ordinary economy');
});

test('a withdrawing NPC can counter again without turning its bank route into protection',()=>{
  const{w,a,b}=fixture({bot:true});a.bag=['gold'];b.bag=Array(7).fill('copper');
  b.lastTheft={id:a.id,until:3,readyAt:0};b.botDisengageUntil=2;b.nextStrike=100;
  w.tick(.05);
  assert.equal(b.bag.length,8,'an in-reach counter is still allowed during withdrawal');
  assert.ok(Math.hypot(b.velocityX,b.velocityZ)>0,'banking continues through native movement');
  w.tick(.05);assert.ok(b.botSale);assert.equal(b.botChase,null);
  hitPlayer(w,a,b,b,{ax:1,az:0});
  assert.equal(b.bag.length,7,'the AI decision grants no hit or theft protection');
  assert.equal(a.bag.length,1);
});

test('counter pursuit requires present visibility and respects the same safe circle',()=>{
  const cover=new Valley({...flat.data,colliders:[{id:'screen',kind:'trunk',x:19,z:-10,radius:.3,height:3}]});
  const{w,a,b}=fixture({bot:true,valley:cover});a.bag=['gold'];b.lastTheft={id:a.id,until:3,readyAt:0};
  w.considerBotRetaliation(b);assert.equal(b.botChase,null,'memory does not reveal a thief through cover');
  const open=fixture({bot:true});open.a.bag=['copper'];open.b.lastTheft={id:open.a.id,until:3,readyAt:0};
  const s=open.w.stations[0];Object.assign(open.a,{x:s.x,z:s.z+s.safeRadius-.01});
  Object.assign(open.b,{x:s.x,z:s.z+s.safeRadius+1});open.w.considerBotRetaliation(open.b);
  assert.equal(open.b.botChase,null);
  hitPlayer(open.w,open.b,open.a,open.a,{ax:0,az:-1});assert.equal(open.a.bag.length,1);
});

test('loaded carriers make a brief visible crossing attempt but do not chase behind their route',()=>{
  const{w,a,b}=fixture();a.bag=Array(3).fill('copper');b.bag=['gold'];
  a.route=[{x:30,z:-10}];b.x=22;
  w.considerBotChase(a);assert.equal(a.botChase?.crossing,true);
  assert.ok(a.botChase.until-w.time<=1.6);
  const behind=fixture();behind.a.bag=['crystal'];behind.b.bag=['gold'];behind.a.route=[{x:30,z:-10}];behind.b.x=16;
  behind.w.considerBotChase(behind.a);assert.equal(behind.a.botChase,null);
});

test('personal theft memories and decision timers reset with the round',()=>{
  const{w,a,b}=fixture();b.bag=['gold'];hitPlayer(w,a,b,b,{ax:1,az:0});
  w.time=.1;hitPlayer(w,b,a,a,{ax:-1,az:0});assert.ok(b.botDisengageUntil>0);
  w.resetRound();
  for(const p of[a,b]){assert.equal(p.lastTheft,null);assert.equal(p.botDisengageUntil,0);assert.equal(p.bag.length,0);}
});

test('a legal actor touching cover can connect to navigation without testing every grid point',()=>{
  const valley=new Valley({...flat.data,colliders:[{id:'post',kind:'trunk',x:0,z:0,radius:1,height:3}]});
  const from={x:-1.5,y:0,z:0},to={x:4,y:0,z:0};
  assert.equal(valley.blocked(from.x,from.z,valley.data.playerRadius),false);
  assert.equal(valley.blocked(from.x,from.z,valley.data.playerRadius+.1),true);
  const walk=valley.walkClear.bind(valley);let calls=0;valley.walkClear=(...args)=>{calls++;return walk(...args);};
  const route=valley.path(from,to);assert.ok(route.length>1);assert.ok(calls<20);
  let at=from;for(const step of route){assert.ok(walk(at,step,valley.data.playerRadius));at=step;}
  calls=0;assert.deepEqual(valley.path({x:0,y:0,z:0},to),[]);assert.ok(calls<=1);
});
