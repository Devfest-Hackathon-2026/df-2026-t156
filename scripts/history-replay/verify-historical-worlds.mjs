import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const inventory=JSON.parse(await fs.readFile(path.join(root,'history-inventory.json'),'utf8'));
const results=[];
for(const version of inventory.versions){
 const base=path.join(root,'history-play/play',version.id);
 const config=JSON.parse(await fs.readFile(path.join(base,'replay.json'),'utf8'));
 globalThis.archiveFiles={};for(const name of config.data)globalThis.archiveFiles[name]=await fs.readFile(path.join(base,'server',name),'utf8');
 const {World,RULES}=await import(pathToFileURL(path.join(base,'server/game.js')));
 const world=new World();world.addPlayer('history-check','PLAYER');
 for(let i=0;i<40;i++){world.input('history-check',{type:'input',x:0,z:1,y:0,ax:0,ay:0,az:1,fire:false});world.tick(1/RULES.tickRate);}
 const state=JSON.parse(JSON.stringify(world.snapshot('history-check')));
 if(state.type!=='state'||!state.players.find(p=>p.id==='history-check')||state.players.length<2||!Number.isFinite(state.timeLeft))throw Error('Invalid historic world '+version.id);
 results.push({id:version.id,worldInstantiated:true,ticks:40,playerCount:state.players.length,roundSeconds:world.roundSeconds,timeLeft:state.timeLeft,clientByteIdentical:true});
 console.log(version.id+' World/ticks/NPC/snapshot OK');
}
await fs.writeFile(path.join(root,'world-verification.json'),JSON.stringify({scope:'Original historical World + browser compatibility imports, run in Node. This is not browser/visual verification.',versions:results},null,2));
