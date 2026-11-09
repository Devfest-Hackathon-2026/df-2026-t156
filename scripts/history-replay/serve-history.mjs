// Local review server only. No API/WS forwarding, no connection to public game.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.wasm':'application/wasm','.data':'application/octet-stream','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.zip':'application/zip','.txt':'text/plain; charset=utf-8'};
http.createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
  const file=path.resolve(root,'.'+pathname,pathname.endsWith('/')?'index.html':'');
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  let target=file,info=await stat(file);if(!info.isFile())throw Error('missing');
  const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'};
  if(req.headers['accept-encoding']?.includes('gzip'))try{const compressed=await stat(file+'.gz');target=file+'.gz';info=compressed;headers['Content-Encoding']='gzip';headers.Vary='Accept-Encoding';}catch{}
  headers['Content-Length']=info.size;res.writeHead(200,headers);
  if(req.method==='HEAD')res.end();else createReadStream(target).pipe(res);
 }catch{res.writeHead(404).end('Not found');}
}).listen(Number(process.env.PORT||18460),'127.0.0.1',()=>console.log('Historical archive: http://127.0.0.1:'+Number(process.env.PORT||18460)+'/history-play/'));
