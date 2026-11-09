import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from './game.js';

function advance(w, seconds) { for (let i=0;i<seconds*20;i++) w.tick(.05); }
function at(w,p,site) { Object.assign(p,{x:site.x,z:site.z,y:w.valley.height(site.x,site.z)}); }
function hold(w,p,key,seconds=1.9) { w.input(p.id,{[key]:true});for(let i=0;i<seconds*20;i++){w.input(p.id,{[key]:true});w.tick(.05);} }

test('gold keeps partial work after the former deadline, then opens another site only after exhaustion',()=>{
 const w=new World({bots:false,rareRandom:()=>0}),p=w.addPlayer('a','A');
 advance(w,32.1);const d=w.deposits.find(d=>d.kind==='gold'&&d.active);
 at(w,p,d.approaches[0]);w.mine(p,d,false,d.weak);const hp=d.hp,work=d.work.get(p.id);
 advance(w,65);
 assert.equal(d.hp,hp);assert.equal(d.work.get(p.id),work);assert.equal(d.active,true);
 assert.equal(w.deposits.filter(d=>d.kind==='gold'&&d.active).length,1);
 assert.equal('expiresIn' in w.snapshot().deposits.find(x=>x.id===d.id),false);
 p.pickLevel=8;for(let i=0;i<4;i++)w.mine(p,d,true,d.weak);
 assert.equal(p.bag.filter(k=>k==='gold').length,2);
 w.tick(.05);assert.equal(d.active,false);assert.equal(w.announcedRare.length,1);
 const next=w.announcedRare[0];assert.notEqual(next.id,d.id);
 advance(w,6.1);assert.equal(next.active,true);assert.equal(next.hp,12);
});

test('one visibly hot shop pays one and a half for every ore for every seller; no first-delivery reward exists',()=>{
 const w=new World({bots:false}),a=w.addPlayer('a','A'),b=w.addPlayer('b','B');
 const central=w.stations.find(s=>s.id==='central');
 for(const p of [a,b]) { at(w,p,central);p.bag=['copper','silver','crystal','ruby','diamond','gold'];hold(w,p,'sell',1.1); }
 assert.equal(a.score,122);assert.equal(b.score,122);
 assert.equal(w.snapshot().stations.filter(s=>s.hot).length,1);
 assert.equal('orderId' in w.snapshot().stations[0],false);
 advance(w,30);assert.equal(w.marketAt(central).hot,false);
 a.bag=['gold'];assert.equal(w.quote(a,central).value,28);
});

test('storage purchase is independent, consumes one hold, handles mixed overflow and resets on rematch',()=>{
 const w=new World({bots:false}),p=w.addPlayer('a','A'),rival=w.addPlayer('b','B');
 const d=w.deposits.find(d=>d.kind==='diamond');p.pickLevel=8;at(w,p,d.approaches[0]);
 p.bag=['silver','silver','silver','copper','copper','copper'];
 for(let i=0;i<5;i++)w.mine(p,d,true,d.weak);
 assert.equal(p.bag.length,8);assert.equal(d.looseCount,4);
 at(w,p,w.stations[0]);hold(w,p,'sell',1.1);assert.equal(p.score,74);
 hold(w,p,'expand',4);assert.equal(w.capacity(p),12);assert.equal(p.score,62);assert.equal(p.pickLevel,8);
 assert.equal(p.bagInvestment,12);
 w.input(p.id,{});w.tick(.05);hold(w,p,'expand');assert.equal(w.capacity(p),16);assert.equal(p.score,42);
 advance(w,50);assert.equal(d.hp,0);assert.equal(d.looseCount,4);
 at(w,p,d.approaches[0]);w.mine(p,d,false,d.weak);assert.equal(p.bag.length,4);assert.equal(d.looseCount,0);
 p.bag=Array(15).fill('copper');rival.bag=['gold','silver'];w.steal(p,rival,rival);
 assert.equal(p.bag.length,16);assert.equal(rival.bag.length,1);w.steal(p,rival,rival);assert.equal(rival.bag.length,1);
 at(w,p,w.stations[0]);const score=p.score,autoValue=w.quote(p,w.stations[0]).value;hold(w,p,'expand');assert.equal(p.score,score+autoValue);assert.equal(w.capacity(p),16);
 w.resetRound();assert.equal(w.capacity(p),8);assert.equal(p.bagLevel,0);assert.equal(p.bagInvestment,0);assert.equal(p.score,0);
});

test('automatic sale remains independent of conflicting legacy keys; unaffordable storage never expands',()=>{
 const w=new World({bots:false}),p=w.addPlayer('a','A');at(w,p,w.stations[0]);p.score=40;p.bag=['silver'];
 for(let i=0;i<50;i++){w.input(p.id,{expand:true,upgrade:true,sell:true});w.tick(.05);}
 assert.equal(p.score,48);assert.equal(w.capacity(p),8);assert.equal(p.bag.length,0);
 p.score=11;hold(w,p,'expand');assert.equal(p.score,11);assert.equal(w.capacity(p),8);
});
