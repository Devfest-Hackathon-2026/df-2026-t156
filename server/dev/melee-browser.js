import {World} from '../game.js';
import {createGameServer} from '../index.js';
import {resetMotion} from '../motion.js';
const world=new World({bots:false,roundSeconds:600,rareRandom:()=>.3});
const add=world.addPlayer.bind(world);
world.addPlayer=(id,name,bot=false)=>{
 const p=add(id,name,bot);
 const at=name==='RUNNER'?{x:0,z:-12.4,yaw:Math.PI}:name==='VIEW'?{x:2.5,z:-15,yaw:-Math.PI/2}:{x:0,z:-15,yaw:0};
 Object.assign(p,at,{y:world.valley.height(at.x,at.z),combatHistory:[]});
 resetMotion(p,world.time,world.round);
 return p;
};
const app=createGameServer({world});
app.server.listen(18121,'127.0.0.1',()=>console.log('LOCAL MELEE 18121: prepared positions, otherwise normal authority/inputs'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.stop().then(()=>process.exit(0)));
