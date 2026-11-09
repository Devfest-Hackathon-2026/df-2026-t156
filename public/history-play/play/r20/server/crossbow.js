import { MELEE, playerRayHit, combatPose } from './melee.js';

export const CROSSBOW = Object.freeze({ range:24, reloadSeconds:1.8, projectileSpeed:30, gravity:3 });
const lifespan=CROSSBOW.range/CROSSBOW.projectileSpeed;
const idle={x:0,z:0,ax:0,ay:0,az:1,fire:false,sprint:false,sell:false,upgrade:false};

export function cylinderHit(eye, ray, body) {
  const x = eye.x - body.x, z = eye.z - body.z;
  const a = ray.x ** 2 + ray.z ** 2;
  let enter = 0, exit = Infinity;
  if (a > 1e-10) {
    const b = x * ray.x + z * ray.z;
    const discriminant = b * b - a * (x * x + z * z - body.radius ** 2);
    if (discriminant < 0) return Infinity;
    const halfChord = Math.sqrt(discriminant);
    enter = Math.max(enter, (-b - halfChord) / a);
    exit = (-b + halfChord) / a;
  } else if (Math.hypot(x, z) > body.radius) return Infinity;

  if (Math.abs(ray.y) > 1e-10) {
    const base = (body.y - eye.y) / ray.y;
    const top = (body.y + body.height - eye.y) / ray.y;
    enter = Math.max(enter, Math.min(base, top));
    exit = Math.min(exit, Math.max(base, top));
  } else if (eye.y < body.y || eye.y > body.y + body.height) return Infinity;
  return enter <= exit ? enter : Infinity;
}


export function boltPosition(bolt,time){
  const t=Math.max(0,Math.min(bolt.expiresAt,time)-bolt.spawnTime);
  return {x:bolt.x+bolt.vx*t,y:bolt.y+bolt.vy*t-CROSSBOW.gravity*t*t/2,z:bolt.z+bolt.vz*t};
}
function blocked(world,player,reason){
  if(world.time<(player.nextShotHint||0))return;
  player.nextShotHint=world.time+.35;
  world.event('shot-blocked',player,world.eyes(player),{weapon:'crossbow',reason});
}
export function receiveShot(world,player,packet){
  if(world.phase!=='playing'||!Number.isSafeInteger(packet.shotId)||packet.shotId<=0||packet.shotId<=player.shotId)return;
  player.shotId=packet.shotId;
  if(player.weapon!=='crossbow')return;
  // Flight begins now, without rewinding targets. Match the ordinary held-intent
  // age budget rather than rejecting a valid shot for presentation/round-trip lag.
  const time=Number.isFinite(packet.shotTime)?packet.shotTime:world.time;
  if(time<world.time-.6-1e-9||time>world.time+.05)return;
  const values=[packet.shotAx,packet.shotAy,packet.shotAz],length=Math.hypot(...values);
  if(!values.every(Number.isFinite)||length<.01||player.pendingShots.length>=4)return;
  player.pendingShots.push({eye:world.eyes(player),ax:values[0]/length,ay:values[1]/length,az:values[2]/length,queuedAt:world.time});
}
export function launchBolt(world,player,press){
  if(world.phase!=='playing'||press.queuedAt<world.time-MELEE.rewindSeconds-1e-9)return false;
  if(world.stationAt(player,'safeRadius')||world.stationAt(press.eye,'safeRadius')){blocked(world,player,'safety');return false;}
  if(world.time+1e-9<player.nextShotAt){blocked(world,player,'reload');return false;}
  player.nextShotAt=world.time+CROSSBOW.reloadSeconds;
  const bolt={id:String(++world.boltSerial),ownerId:player.id,...press.eye,
    vx:press.ax*CROSSBOW.projectileSpeed,vy:press.ay*CROSSBOW.projectileSpeed,vz:press.az*CROSSBOW.projectileSpeed,
    spawnTime:world.time,expiresAt:world.time+lifespan,distance:0};
  world.bolts.push(bolt);
  world.event('shot',player,press.eye,{weapon:'crossbow',projectileId:bolt.id,vx:bolt.vx,vy:bolt.vy,vz:bolt.vz});
  return true;
}
function circleHit(origin,ray,circle){
  const x=origin.x-circle.x,z=origin.z-circle.z,a=ray.x*ray.x+ray.z*ray.z;
  const c=x*x+z*z-circle.safeRadius**2;
  if(c<=0)return 0;
  if(a<1e-10)return Infinity;
  const b=x*ray.x+z*ray.z,disc=b*b-a*c;
  if(disc<0)return Infinity;
  const t=(-b-Math.sqrt(disc))/a;
  return t>=0?t:Infinity;
}
function interpolatePose(player,time){return combatPose(player,time)||player;}
function bodySweep(origin,end,player,from,to){
  const a=interpolatePose(player,from),b=interpolatePose(player,to);
  const dx=end.x-origin.x-(b.x-a.x),dy=end.y-origin.y-(b.y-a.y),dz=end.z-origin.z-(b.z-a.z);
  const length=Math.hypot(dx,dy,dz);
  if(length<1e-10)return playerRayHit(origin,{x:0,y:0,z:0},a)===0?0:Infinity;
  return playerRayHit(origin,{x:dx/length,y:dy/length,z:dz/length},a)/length;
}
function impact(world,bolt,point,reason,target){
  const shooter=world.players.get(bolt.ownerId);
  if(!shooter)return;
  if(target){
    if(world.stationAt(shooter,'safeRadius')||world.stationAt(target,'safeRadius'))reason='safety';
    else if(world.time+1e-9<(target.hurtUntil||0))reason='hurt';
    else {
      target.hurtUntil=world.time+MELEE.hurtSeconds;target.lastHitDamage=1;
      target.sellProgress=0;target.sale=null;
      reason=!target.bag.length?'empty':shooter.bag.length>=world.config.capacity?'full':'hit';
      if(reason==='hit')world.steal(shooter,target,point,'crossbow');
    }
  }
  world.event('bolt-impact',shooter,point,{weapon:'crossbow',projectileId:bolt.id,targetId:target?.id||'',reason});
}
export function tickBolts(world,dt){
  const surviving=[];
  for(const bolt of world.bolts){
    if(!world.players.has(bolt.ownerId))continue;
    let from=Math.max(bolt.spawnTime,world.time-dt),alive=true;
    while(from<world.time-1e-9&&alive){
      const to=Math.min(world.time,bolt.expiresAt,from+.0125),origin=boltPosition(bolt,from),end=boltPosition(bolt,to);
      const dx=end.x-origin.x,dy=end.y-origin.y,dz=end.z-origin.z,length=Math.hypot(dx,dy,dz);
      const ray={x:dx/length,y:dy/length,z:dz/length};
      const remaining=Math.max(0,CROSSBOW.range-bolt.distance);
      let nearest=Math.min(length,remaining),reason=remaining<=length?'range':'',target=null;
      const cover=world.valley.rayDistance(origin,ray,nearest+1e-7);
      if(cover<=nearest){nearest=cover;reason='terrain';}
      for(const deposit of world.deposits){const hit=cylinderHit(origin,ray,deposit);
        if(hit<=nearest){nearest=hit;reason='terrain';}}
      for(const station of world.stations){const hit=circleHit(origin,ray,station);
        if(hit<=nearest){nearest=hit;reason='safety';}}
      for(const player of world.players.values()){
        if(player.id===bolt.ownerId)continue;
        const hit=bodySweep(origin,end,player,from,to)*length;
        if(hit<nearest){nearest=hit;target=player;reason='hit';}
      }
      if(reason){
        const point={x:origin.x+ray.x*nearest,y:origin.y+ray.y*nearest,z:origin.z+ray.z*nearest};
        impact(world,bolt,point,reason,target);alive=false;
      }else if(to>=bolt.expiresAt-1e-9){impact(world,bolt,end,'range');alive=false;}
      bolt.distance+=Math.min(nearest,length);from=to;
    }
    if(alive)surviving.push(bolt);
  }
  world.bolts=surviving;
}
export function boltSnapshot(world){return world.bolts.map(({distance,...bolt})=>({...bolt}));}

// Short, visible opportunities only. NPCs aim at the observed pose, never a
// hidden destination or future movement; the preparation leaves time to dodge.
export function botCrossbowInput(world,player){
  if(!world.botTactics)return null;
  if(player.botBow){
    const bow=player.botBow,other=world.visibleOpponents(player,18).find(p=>p.id===bow.id);
    if(!other||!other.bag.length||!world.awayFromTrade(player,1)||!world.awayFromTrade(other,1)||
      Math.hypot(other.x-player.x,other.z-player.z)<4.8){player.botBow=null;player.weapon='pick';return null;}
    player.weapon='crossbow';
    if(world.time>=bow.readyAt){
      player.pendingShots.push({...bow.press,eye:world.eyes(player),queuedAt:world.time});
      player.botBow=null;
    }
    return {...idle,ax:bow.press.ax,ay:bow.press.ay,az:bow.press.az};
  }
  player.weapon='pick';
  if(world.time<player.botBowAt||world.time<player.nextShotAt||world.time<player.botDisengageUntil||player.botChase||player.botInvest||
    player.bag.length>=world.config.capacity||world.timeLeft<4||!world.awayFromTrade(player,1))return null;
  player.botBowAt=world.time+.4;
  const next=player.route[0]||player.goal;
  const target=world.visibleOpponents(player,18).find(other=>{
    const gap=Math.hypot(other.x-player.x,other.z-player.z);
    const revenge=player.lastTheft?.id===other.id&&world.time<player.lastTheft.until;
    const onRoute=next&&(other.x-player.x)*(next.x-player.x)+(other.z-player.z)*(next.z-player.z)>0;
    return gap>=7&&other.bag.length&&world.awayFromTrade(other,1)&&(revenge||!player.bag.length||onRoute);
  });
  if(!target)return null;
  const eye=world.eyes(player),gap=Math.hypot(target.x-eye.x,target.z-eye.z),flight=gap/CROSSBOW.projectileSpeed;
  const dx=target.x-eye.x+(world.random()-.5)*.35,dy=target.y+1.15+CROSSBOW.gravity*flight*flight/2-eye.y,
    dz=target.z-eye.z+(world.random()-.5)*.35,len=Math.hypot(dx,dy,dz);
  player.botBowAt=world.time+5.5+world.random()*1.5;
  player.botBow={id:target.id,readyAt:world.time+.3,press:{ax:dx/len,ay:dy/len,az:dz/len}};
  player.weapon='crossbow';
  return {...idle,ax:dx/len,ay:dy/len,az:dz/len};
}
