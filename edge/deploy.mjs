import { readFile } from 'node:fs/promises';
const api = 'https://api.cloudflare.com/client/v4';
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) throw Error('Set CLOUDFLARE_API_TOKEN for the pichu.dev zone.');
const host = 'patchplay.pichu.dev', name = 'patchplay-edge';
async function call(path, options = {}) {
  const r = await fetch(api + path, {...options, headers: {Authorization: 'Bearer ' + token,...options.headers}});
  const b = await r.json(); if (!r.ok || !b.success) throw Error(r.status+' '+JSON.stringify(b.errors));
  return b.result;
}
const zone = (await call('/zones?name=pichu.dev&status=active')).find(z=>z.name==='pichu.dev');
if(!zone) throw Error('Zone unavailable');
const acc='/accounts/'+zone.account.id+'/workers';
const domains=await call(acc+'/domains'), current=domains.find(d=>d.hostname===host);
const records=await call('/zones/'+zone.id+'/dns_records?name='+host);
if ((current && current.service!==name) || (!current && records.length)) throw Error('Hostname in use');
const scripts=await call(acc+'/scripts');
if (!current && scripts.some(s=>s.id===name) && !process.argv.includes('--resume-own-script')) throw Error('Worker already exists; inspect deployment before attaching domain');
const data=new FormData();
data.append('metadata',new Blob([JSON.stringify({main_module:'patchplay.mjs',compatibility_date:'2025-08-01'})],{type:'application/json'}));
data.append('patchplay.mjs',new Blob([await readFile(new URL('patchplay.mjs',import.meta.url))],{type:'application/javascript+module'}),'patchplay.mjs');
await call(acc+'/scripts/'+name,{method:'PUT',body:data});
await call(acc+'/domains',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({hostname:host,zone_id:zone.id,service:name,environment:'production'})});
console.log('Attached https://'+host);