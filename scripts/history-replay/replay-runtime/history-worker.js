// One historical World per tab. No requests reach the current online game.
let world, rules, playerId, timer, ready=false;
const send = packet => postMessage({kind:'message',data:JSON.stringify(packet)});
try {
  const version=new URL(import.meta.url).searchParams.get('version');
  if(!/^r\d{2}$/.test(version)) throw new Error('Invalid history version');
  const base=new URL('../play/'+version+'/',import.meta.url);
  const config=await fetch(new URL('replay.json',base)).then(r=>{if(!r.ok)throw new Error('Missing replay');return r.json();});
  globalThis.archiveFiles={};
  globalThis.process={env:{}};
  await Promise.all(config.data.map(async name=>{
    const response=await fetch(new URL('server/'+name,base));
    if(!response.ok) throw new Error('Missing historical data');
    globalThis.archiveFiles[name]=await response.text();
  }));
  const original=await import(new URL('server/game.js',base));
  rules=original.RULES; world=new original.World(); ready=true;
  postMessage({kind:'ready',version});
} catch(error) {postMessage({kind:'error',message:String(error.stack||error)});}
onmessage = event => {
  if(!ready)return;
  const packet=event.data;
  if(packet.type==='join'&&!playerId){
    playerId=crypto.randomUUID();
    const name=typeof packet.name==='string'?packet.name.replace(/[\x00-\x1f\x7f<>]/g,'').trim().slice(0,18):'';
    world.addPlayer(playerId,name||'PLAYER');
    send({type:'welcome',id:playerId,protocol:1});
    send(world.snapshot(playerId));
    timer=setInterval(()=>{try{world.tick(1/rules.tickRate);send(world.snapshot(playerId));}catch(error){clearInterval(timer);postMessage({kind:'error',message:String(error.stack||error)});}},1000/rules.tickRate);
  }else if(packet.type==='input'&&playerId)world.input(playerId,packet);
  else if(packet.type==='close'){clearInterval(timer);world.removePlayer(playerId);close();}
};
