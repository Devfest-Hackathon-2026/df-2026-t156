import { MELEE, playerRayHit, combatPose, acceptHurt, baseKnockback } from './melee.js';

// Java 1.8.9 air: 3 blocks/tick at full draw; move, then drag .99 and vy -= .05.
export const BOW = Object.freeze({ tickRate:20, fullDrawTicks:20, minDrawTicks:3, projectileSpeed:60, gravity:20, dragPerTick:.99, maxFlightSeconds:8 });
export function bowPower(ticks){const t=Math.max(0,Math.min(20,ticks))/20;return Math.min(1,(t*t+2*t)/3);}
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
  const ticks=Math.max(0,Math.min(bolt.expiresAt,time)-bolt.spawnTime)*BOW.tickRate;
  const n=Math.floor(ticks+1e-9),part=Math.max(0,ticks-n),drag=BOW.dragPerTick,power=drag**n;
  const sum=(1-power)/(1-drag),duration=(sum+part*power)/BOW.tickRate;
  const gravityPerTick=BOW.gravity/(BOW.tickRate*BOW.tickRate);
  const fall=gravityPerTick/(1-drag)*(n-sum+part*(1-power));
  return{x:bolt.x+bolt.vx*duration,y:bolt.y+bolt.vy*duration-fall,z:bolt.z+bolt.vz*duration};
}
function blocked(world,player,reason,shotId=0){
  if(world.time<(player.nextShotHint||0))return;
  player.nextShotHint=world.time+.35;
  world.event('shot-blocked',player,world.eyes(player),{weapon:'bow',reason,shotId});
}
export function cancelBowDraw(player){player.bowDrawing=false;player.bowDrawStartedAt=0;}
export function receiveBowInput(world,player,packet){
  const trading=packet.sell===true&&player.bag.length&&world.stationAt(player,'radius');
  const drawing=world.phase==='playing'&&player.weapon==='bow'&&packet.bowDrawing===true&&!packet.upgrade&&!trading;
  player.bowConsumesAttack=player.bowDrawing||drawing;
  const ticks=player.bowDrawing?Math.floor((world.time-player.bowDrawStartedAt)*20+1e-7):0;
  if(drawing){
    if(!player.bowDrawing){player.bowDrawing=true;player.bowDrawStartedAt=world.time;}
    return null;
  }
  const released=player.bowDrawing&&player.weapon==='bow'&&!packet.upgrade&&!trading?ticks:null;
  cancelBowDraw(player);
  return released;
}
export function receiveShot(world,player,packet,drawTicks){
  if(world.phase!=='playing'||!Number.isSafeInteger(packet.shotId)||packet.shotId<=0||packet.shotId<=player.shotId)return;
  player.shotId=packet.shotId;
  if(player.weapon!=='bow'||player.bowDrawing)return;
  if(!Number.isSafeInteger(drawTicks)||drawTicks<BOW.minDrawTicks){blocked(world,player,'draw',packet.shotId);return;}
  const time=Number.isFinite(packet.shotTime)?packet.shotTime:world.time;
  if(time<world.time-.6-1e-9||time>world.time+.05)return;
  const values=[packet.shotAx,packet.shotAy,packet.shotAz],length=Math.hypot(...values);
  if(!values.every(Number.isFinite)||length<.01||player.pendingShots.length>=4)return;
  player.pendingShots.push({eye:world.eyes(player),ax:values[0]/length,ay:values[1]/length,az:values[2]/length,drawTicks,shotId:packet.shotId,queuedAt:world.time});
}
export function launchBolt(world,player,press){
  if(world.phase!=='playing'||!Number.isSafeInteger(press.drawTicks)||press.drawTicks<BOW.minDrawTicks||press.queuedAt<world.time-MELEE.rewindSeconds-1e-9)return false;
  if(world.stationAt(player,'safeRadius')||world.stationAt(press.eye,'safeRadius')){blocked(world,player,'safety',press.shotId);return false;}
  const power=bowPower(press.drawTicks),speed=BOW.projectileSpeed*power;
  // The original inaccuracy is gaussian .0075 per normalized component.
  const gaussian=()=>Math.sqrt(-2*Math.log(Math.max(1e-12,world.random())))*Math.cos(2*Math.PI*world.random())*.0075;
  const horizontal=Math.hypot(press.ax,press.az),sideX=horizontal>1e-8?press.az/horizontal:Math.cos(player.yaw),
    sideZ=horizontal>1e-8?press.ax/horizontal:Math.sin(player.yaw);
  const bolt={id:String(++world.boltSerial),ownerId:player.id,shotId:press.shotId||0,
    x:press.eye.x-sideX*.16,y:press.eye.y-.1,z:press.eye.z+sideZ*.16,vx:(press.ax+gaussian())*speed,vy:(press.ay+gaussian())*speed,vz:(press.az+gaussian())*speed,
    power,spawnTime:world.time,expiresAt:world.time+BOW.maxFlightSeconds};
  world.bolts.push(bolt);
  world.event('shot',player,bolt,{weapon:'bow',projectileId:bolt.id,shotId:bolt.shotId,spawnTime:bolt.spawnTime,vx:bolt.vx,vy:bolt.vy,vz:bolt.vz,power,drawTicks:press.drawTicks,critical:power>=1});
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
  if(length<1e-10)return playerRayHit(origin,{x:0,y:0,z:0},a,.3)===0?0:Infinity;
  return playerRayHit(origin,{x:dx/length,y:dy/length,z:dz/length},a,.3)/length;
}
export function boltVelocity(bolt,time){
  const n=Math.max(0,Math.floor((time-bolt.spawnTime)*20+1e-8)),drag=BOW.dragPerTick**n;
  return{x:bolt.vx*drag,y:bolt.vy*drag-BOW.gravity/20*(1-drag)/(1-BOW.dragPerTick),z:bolt.vz*drag};
}
function impact(world,bolt,point,reason,target,atTime=world.time){
  const shooter=world.players.get(bolt.ownerId);
  if(!shooter)return;
  if(target){
    if(world.stationAt(shooter,'safeRadius')||world.stationAt(target,'safeRadius'))reason='safety';
    else {
      const velocity=boltVelocity(bolt,atTime);
      let strength=Math.ceil(Math.hypot(velocity.x,velocity.y,velocity.z)/20*2);
      if(bolt.power>=1)strength+=Math.floor(world.random()*(Math.floor(strength/2)+2));
      const accepted=acceptHurt(world,target,strength);
      if(!accepted)reason='hurt';
      else {
        if(accepted.fresh){const velocity=baseKnockback(shooter,target,{ax:bolt.vx,az:bolt.vz});
          world.applyKnockback(target,velocity.vx,velocity.vy,velocity.vz);}
        target.sellProgress=0;target.sale=null;
        reason=!target.bag.length?'empty':shooter.bag.length>=world.config.capacity?'full':'hit';
        if(reason==='hit')world.steal(shooter,target,point,'bow');
      }
    }
  }
  world.event('bolt-impact',shooter,point,{weapon:'bow',projectileId:bolt.id,targetId:target?.id||'',reason,power:bolt.power,critical:bolt.power>=1});
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
      let nearest=length,reason='',target=null;
      for(const axis of ['x','z'])if(Math.abs(end[axis])>world.valley.data.boundary){
        const hit=(Math.sign(end[axis])*world.valley.data.boundary-origin[axis])/ray[axis];
        if(hit>=0&&hit<=nearest){nearest=hit;reason='range';}
      }
      const cover=world.valley.rayDistance(origin,ray,nearest+1e-7,0);
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
        impact(world,bolt,point,reason,target,from+(to-from)*nearest/length);alive=false;
      }else if(to>=bolt.expiresAt-1e-9){impact(world,bolt,end,'range');alive=false;}
      from=to;
    }
    if(alive)surviving.push(bolt);
  }
  world.bolts=surviving;
}
export function boltSnapshot(world){return world.bolts.map(bolt=>({...bolt}));}

// Short, visible opportunities only. NPCs aim at the observed pose, never a
// hidden destination or future movement; the preparation leaves time to dodge.
export function botCrossbowInput(world,player){
  if(!world.botTactics)return null;
  const canTarget=other=>other.bot||world.roundSeconds-world.timeLeft>=15-1e-9;
  if(player.botBow){
    const bow=player.botBow,other=world.visibleOpponents(player,24).find(p=>p.id===bow.id&&canTarget(p));
    if(!other||!other.bag.length||!world.awayFromTrade(player,1)||!world.awayFromTrade(other,1)||
      Math.hypot(other.x-player.x,other.z-player.z)<4.8){player.botBow=null;cancelBowDraw(player);player.weapon='pick';return null;}
    player.weapon='bow';
    if(!player.bowDrawing){
      const wanted=Math.atan2(bow.press.ax,bow.press.az),angle=Math.atan2(Math.sin(wanted-player.yaw),Math.cos(wanted-player.yaw));
      const step=Math.max(0,world.time-bow.turnAt)*Math.PI;bow.turnAt=world.time;
      const facing=player.yaw+Math.max(-step,Math.min(step,angle));
      if(Math.abs(angle)>.12||world.time<bow.noticedAt+.25)
        return {...idle,ax:Math.sin(facing),ay:bow.press.ay,az:Math.cos(facing)};
      player.bowDrawing=true;player.bowDrawStartedAt=world.time;bow.readyAt=world.time+bow.drawTicks/20;
    }
    if(world.time>=bow.readyAt){
      player.pendingShots.push({...bow.press,eye:world.eyes(player),drawTicks:Math.floor((world.time-player.bowDrawStartedAt)*20+1e-7),queuedAt:world.time});
      player.botBow=null;cancelBowDraw(player);
    }
    return {...idle,ax:bow.press.ax,ay:bow.press.ay,az:bow.press.az,bowDrawing:player.bowDrawing};
  }
  player.weapon='pick';cancelBowDraw(player);
  if((world.time<player.botBowAt&&!player.botLook)||world.time<player.botDisengageUntil||player.botChase||player.botInvest||
    player.bag.length>=Math.min(4,world.config.capacity)||player.botSale||world.timeLeft<4||!world.awayFromTrade(player,1))return null;
  if(player.botLook){
    const look=player.botLook,wanted=Math.atan2(look.x-player.x,look.z-player.z),angle=Math.atan2(Math.sin(wanted-player.yaw),Math.cos(wanted-player.yaw));
    const step=Math.max(0,world.time-look.at)*Math.PI;look.at=world.time;
    if(Math.abs(angle)>.12&&world.time<look.until){const facing=player.yaw+Math.max(-step,Math.min(step,angle));
      return {...idle,ax:Math.sin(facing),az:Math.cos(facing)};}
    player.botLook=null;player.botBowAt=0;
  }
  player.botBowAt=world.time+.4;
  const next=player.route[0]||player.goal;
  const target=world.visibleOpponents(player,24).find(other=>{
    if(!canTarget(other))return false;
    const bearing=Math.atan2(other.x-player.x,other.z-player.z);
    if(Math.cos(bearing-player.yaw)<Math.cos(70*Math.PI/180))return false;
    const gap=Math.hypot(other.x-player.x,other.z-player.z);
    const revenge=player.lastTheft?.id===other.id&&world.time<player.lastTheft.until;
    const onRoute=next&&(other.x-player.x)*(next.x-player.x)+(other.z-player.z)*(next.z-player.z)>0;
    return gap>=7&&other.bag.length&&world.awayFromTrade(other,1)&&(revenge||!player.bag.length||onRoute);
  });
  if(!target){
    // Mining is audible behind the observer. Turn towards its last real sound,
    // then require ordinary forward vision; do not track a hidden live body.
    const heard=[...world.events].reverse().find(e=>['mine','weak','body'].includes(e.type)&&e.actorId!==player.id&&e.id!==player.lastBowSound&&Math.hypot(e.x-player.x,e.z-player.z)<=12);
    if(heard){player.lastBowSound=heard.id;player.botLook={x:heard.x,z:heard.z,at:world.time,until:world.time+1.1};
      return {...idle,ax:Math.sin(player.yaw),az:Math.cos(player.yaw)};}
    return null;
  }
  const eye=world.eyes(player),gap=Math.hypot(target.x-eye.x,target.z-eye.z),drawTicks=gap>15?20:14;
  const flight=gap/(BOW.projectileSpeed*bowPower(drawTicks));
  const dx=target.x-eye.x+(world.random()-.5)*.35,dy=target.y+1.1+BOW.gravity*flight*flight/2-eye.y,
    dz=target.z-eye.z+(world.random()-.5)*.35,len=Math.hypot(dx,dy,dz);
  player.botBowAt=world.time+3+world.random()*2;
  player.botBow={id:target.id,noticedAt:world.time,turnAt:world.time,drawTicks,press:{ax:dx/len,ay:dy/len,az:dz/len}};
  player.weapon='bow';
  return {...idle,ax:Math.sin(player.yaw),ay:dy/len,az:Math.cos(player.yaw),bowDrawing:false};
}
