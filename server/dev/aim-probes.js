import { World } from '../game.js';

const place=(w,p,at)=>Object.assign(p,{x:at.x,z:at.z,y:w.valley.height(at.x,at.z)});
function inputAt(w,p,point){
  const eye=w.eyes(p),x=point.x-eye.x,y=point.y-eye.y,z=point.z-eye.z,l=Math.hypot(x,y,z)||1;
  w.input(p.id,{ax:x/l,ay:y/l,az:z/l,fire:true});
}
function ready(w,d){if(d.kind==='gold')Object.assign(d,{active:true,layer:1,hp:6,expiresAt:w.time+25});}

export function authoredAim(){
  const w=new World({bots:false}),p=w.addPlayer('a','A');
  const cases=w.deposits.flatMap(d=>d.approaches.map(at=>({id:d.id,at})));
  const failures=[];let weak=0;
  for(const item of cases){
    w.resetRound();const d=w.deposits.find(d=>d.id===item.id);ready(w,d);
    p.pickLevel=3;place(w,p,item.at);inputAt(w,p,d.weak);w.tick(.05);
    const hit=w.events.find(e=>e.actorId===p.id&&e.targetId===d.id&&['weak','mine'].includes(e.type));
    if(hit?.type==='weak')weak++;else failures.push([item.id,item.at,hit?.type||'miss']);
  }
  return{cases:cases.length,weak,failures};
}

export function pairAim({mode='apart'}={}){
  const w=new World({bots:false}),a=w.addPlayer('a','A'),b=w.addPlayer('b','B');
  const d=w.deposits.find(d=>d.id==='gold-4');ready(w,d);
  a.pickLevel=b.pickLevel=3;
  const at=d.approaches[0];place(w,a,at);
  place(w,b,mode==='apart'?d.approaches[3]:mode==='side'?{x:at.x+.6,z:at.z}:at);
  const hits=[];let last=0;
  // Separate real input swings let the second participant follow the newly exposed crack.
  for(let i=0;i<8;i++){
    const p=i%2?a:b;inputAt(w,p,d.weak);w.tick(.05);w.input(p.id,{});
    for(const e of w.events){if(+e.id<=last)continue;last=+e.id;
      if(['mine','weak','harvest','steal'].includes(e.type))hits.push([e.type,e.actorId,e.amount,e.layer||0]);}
    for(let j=0;j<11;j++)w.tick(.05);
  }
  return{mode,hits,bags:[a.bag.length,b.bag.length],remainingHP:d.hp};
}

export function verticalPatch(){
  const rows=[];
  for(const offset of [0,-.1,-.2,-.3,-.4]){
    const w=new World({bots:false}),p=w.addPlayer('a','A'),d=w.deposits.find(d=>d.id==='vein-3');
    p.pickLevel=1;place(w,p,d.approaches[0]);
    inputAt(w,p,{...d.weak,y:d.weak.y+offset});w.tick(.05);
    rows.push({offset,events:w.events.filter(e=>['mine','weak'].includes(e.type)).map(e=>[e.type,e.amount])});
  }
  return rows;
}
if(process.argv[2]==='geometry'){
  console.log(JSON.stringify(authoredAim()));
  for(const mode of ['apart','side','overlap'])console.log(JSON.stringify(pairAim({mode})));
  console.log(JSON.stringify({hypotheticalVerticalSurface:verticalPatch()}));
}
