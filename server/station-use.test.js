import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from './game.js';
function aim(w,p,s,kind){const e=w.eyes(p),d={ax:s[kind+'X']-e.x,ay:s[kind+'Y']-e.y,az:s[kind+'Z']-e.z};const n=Math.hypot(d.ax,d.ay,d.az);for(const k in d)d[k]/=n;return d;}
function hold(w,p,packet,seconds=2){for(let i=0;i<seconds*20;i++){w.input(p.id,packet);w.tick(.05);}}
function room(){const w=new World({bots:false}),p=w.addPlayer('a','A'),s=w.stations[0];Object.assign(p,{x:0,z:-2.8,y:w.valley.height(0,-2.8)});return {w,p,s};}
test('circle sells without input or aim; one click upgrades selected tool immediately and never repeats',()=>{
 const {w,p,s}=room();p.bag=Array(8).fill('copper');w.tick(.05);assert.equal(p.score,24);assert.equal(p.bag.length,0);
 const receipts=w.eventSerial;hold(w,p,{},.2);assert.equal(p.score,24);assert.equal(w.eventSerial,receipts);
 Object.assign(p,{x:0,z:-2.5,y:w.valley.height(0,-2.5)});
 w.input(p.id,{...aim(w,p,s,'anvil'),weapon:'pick',use:true,useId:1});
 w.input(p.id,{...aim(w,p,s,'anvil'),weapon:'pick',use:false,useId:1});w.tick(.05);
 assert.equal(p.pickLevel,2);assert.equal(p.score,16);
 hold(w,p,{...aim(w,p,s,'anvil'),weapon:'pick',use:true,useId:1});assert.equal(p.pickLevel,2);assert.equal(p.score,16);
 w.input(p.id,{use:false,useId:1});w.input(p.id,{...aim(w,p,s,'anvil'),weapon:'bag',use:true,useId:2});w.tick(.05);
 assert.equal(w.capacity(p),12);assert.equal(p.score,4);
});
test('holding while approaching or switching tools cannot buy; an automatic sale does not rescue an unaffordable press',()=>{
 const {w,p,s}=room();p.score=100;
 hold(w,p,{ax:0,ay:1,az:0,weapon:'pick',use:true,useId:1},.1);
 hold(w,p,{...aim(w,p,s,'anvil'),weapon:'pick',use:true,useId:1});assert.equal(p.pickLevel,1);
 w.input(p.id,{use:false,useId:1});w.input(p.id,{...aim(w,p,s,'anvil'),weapon:'pick',use:true,useId:2});
 w.input(p.id,{...aim(w,p,s,'anvil'),weapon:'bag',use:true,useId:2});w.tick(.05);assert.equal(p.pickLevel,1);assert.equal(w.capacity(p),8);
 p.score=0;p.bag=Array(8).fill('copper');w.input(p.id,{use:false,useId:2});
 w.input(p.id,{...aim(w,p,s,'anvil'),weapon:'pick',use:true,useId:3});w.tick(.05);
 assert.equal(p.pickLevel,1);assert.equal(p.score,24);assert.ok(w.events.some(e=>e.type==='workshop-denied'&&e.reason==='funds'));
 hold(w,p,{...aim(w,p,s,'anvil'),weapon:'pick',use:true,useId:3});assert.equal(p.pickLevel,1);
});
