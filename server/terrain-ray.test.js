import test from 'node:test';
import assert from 'node:assert/strict';
import { Valley, VALLEY } from './valley.js';
import { World } from './game.js';

function grid(heights){return new Valley({...VALLEY,originX:0,originZ:0,columns:2,rows:2,cellSize:1,heights,colliders:[],deposits:[]});}

test('a short arrow segment returns the surface crossing before its padded final sample',()=>{
  const v=grid([0,0,0,0]),o={x:.2,y:.05,z:.2},ray={x:0,y:-.5,z:Math.sqrt(.75)};
  const hit=v.rayDistance(o,ray,.11+1e-7,0);
  assert.ok(Math.abs(hit-.1)<1e-9);assert.ok(hit<.11);
  assert.equal(v.terrainRayDistance({x:.2,y:1,z:.2},{x:0,y:1,z:0},2),null);
  assert.equal(v.rayDistance({x:.2,y:1,z:.2},{x:0,y:1,z:0},2),2,'the existing no-hit distance remains the requested limit');
  assert.ok(Math.abs(v.rayDistance({x:.2,y:1,z:.2},{x:0,y:-1,z:0},2)-.97)<1e-9,'ordinary rays keep their existing .03m ground padding');
});

test('an upward segment meets a steeper slope at its exact ground crossing',()=>{
  const v=grid([0,2,0,2]),o={x:0,y:.1,z:.2},ray={x:Math.SQRT1_2,y:Math.SQRT1_2,z:0};
  const hit=v.terrainRayDistance(o,ray,.5);
  assert.ok(Math.abs(hit-.1*Math.SQRT2)<1e-9);
  const x=o.x+ray.x*hit,y=o.y+ray.y*hit;assert.ok(Math.abs(y-v.height(x,o.z))<1e-9);
});

test('a bilinear crest is hit even when both segment endpoints are above ground',()=>{
  const v=grid([0,2,2,0]),o={x:0,y:.75,z:0},ray={x:Math.SQRT1_2,y:0,z:Math.SQRT1_2};
  assert.ok(o.y>v.height(0,0)&&o.y>v.height(1,1));
  assert.ok(Math.abs(v.terrainRayDistance(o,ray,Math.SQRT2)-.25*Math.SQRT2)<1e-9);
  assert.equal(v.terrainRayDistance({x:.5,y:.5,z:.5},{x:0,y:1,z:0},1),0,'a buried origin cannot escape upward through the ground');
});

function firstImpact(w){for(let i=0;i<120;i++){w.tick(.05);const event=w.events.find(e=>e.type==='bolt-impact');if(event)return event;}throw new Error('no projectile impact');}

test('the recorded eight-tick browser shot sticks to the real valley instead of an underground safe cylinder',()=>{
  const w=new World({bots:false}),p=w.addPlayer('archer','Archer');Object.assign(p,{x:0,y:w.valley.height(0,-24),z:-24});
  // Resolved launch from the reported browser reproduction; no client fixture power is trusted.
  w.bolts.push({id:'probe',ownerId:p.id,x:-.16,y:2.1712,z:-24,vx:-.22877998682161477,vy:-1.7494521920238466,vz:19.156834953178834,power:.32,spawnTime:0,expiresAt:8});
  const impact=firstImpact(w);
  assert.equal(impact.reason,'terrain');assert.ok(w.time<1);assert.ok(impact.z<-6.5);
  assert.ok(Math.abs(impact.y-w.valley.height(impact.x,impact.z))<1e-6);
  assert.equal(w.bolts.length,0);
});

test('an upward weak arrow follows its arc and stops where it descends through the actual flat surface',()=>{
  const valley=new Valley({...VALLEY,heights:VALLEY.heights.map(()=>0),colliders:[],deposits:[]});
  const w=new World({bots:false,valley}),p=w.addPlayer('archer','Archer');Object.assign(p,{x:18,y:0,z:-24});
  w.bolts.push({id:'upward',ownerId:p.id,x:18,y:1.5,z:-24,vx:0,vy:8,vz:5,power:.32,spawnTime:0,expiresAt:8});
  const impact=firstImpact(w);assert.equal(impact.reason,'terrain');assert.ok(w.time>.6);
  assert.ok(Math.abs(impact.y)<1e-6);assert.equal(w.bolts.length,0);
});
