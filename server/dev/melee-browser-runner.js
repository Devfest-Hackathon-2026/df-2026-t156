import WebSocket from '../node_modules/ws/index.js';
const ws=new WebSocket('ws://127.0.0.1:18121/ws');
let id='',impulse=0,restUntil=0;
ws.on('open',()=>ws.send(JSON.stringify({type:'join',name:'RUNNER'})));
ws.on('message',bytes=>{const s=JSON.parse(bytes);if(s.type==='welcome'){id=s.id;return;}if(s.type!=='state')return;
 const p=s.players.find(p=>p.id===id);if(!p)return;
 if(p.impulseId!==impulse){impulse=p.impulseId;restUntil=Date.now()+1800;}
 let dx=0,dz=0;
 if(Date.now()>restUntil){if(Math.abs(p.z+12.4)>.15){dz=Math.sign(-12.4-p.z)*.6;dx=Math.sign(-p.x)*.1;}
 else dx=(p.x>.24?-1:p.x<-.24?1:Math.sin(s.serverTime*2)>0?1:-1)*.10;}
 ws.send(JSON.stringify({type:'input',x:dx,z:dz,ax:0,ay:0,az:-1,fire:false,sprint:false}));
});
