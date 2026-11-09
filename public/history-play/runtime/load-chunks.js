(async()=>{
 const progress=document.getElementById('progress'),status=document.getElementById('status');
 try{
  const manifest=await fetch('../../chunk-manifest.json').then(r=>{if(!r.ok)throw Error('素材一覧を取得できません');return r.json();});
  const cache=typeof caches==='object'?await caches.open('valley-history-chunks-v1').catch(()=>null):null;
  const needed=[...new Set(window.historyAssets.flatMap(name=>manifest[name].chunks))];
  const results=new Map();let finished=0,cursor=0;
  async function load(){while(cursor<needed.length){const id=needed[cursor++],url=new URL('../../chunks/'+id+'.bin',location.href);
   let response=cache?await cache.match(url):null;
   if(!response){response=await fetch(url);if(!response.ok)throw Error('素材を取得できません');if(cache)await cache.put(url,response.clone()).catch(()=>{});}
   const data=await response.arrayBuffer();
   const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(n=>n.toString(16).padStart(2,'0')).join('');
   if(digest!==id)throw Error('素材の内容が一致しません');
   results.set(id,data);progress.value=++finished/needed.length;status.textContent=Math.round(progress.value*100)+'%';
  }}
  await Promise.all(Array.from({length:6},load));
  window.historyAssetUrls={};
  for(const name of window.historyAssets){const asset=manifest[name];const blob=new Blob(asset.chunks.map(id=>results.get(id)),{type:asset.type});if(blob.size!==asset.size)throw Error('素材の長さが一致しません');window.historyAssetUrls[name]=URL.createObjectURL(blob);}
  // Start the unchanged client in the top-level document: its original input,
  // fullscreen and pointer-lock handlers retain their normal browser context.
  const client=await fetch('client.html').then(r=>{if(!r.ok)throw Error('ゲームを取得できません');return r.text();});
  document.open();document.write(client);document.close();
  window.addEventListener('pagehide',()=>{for(const url of Object.values(window.historyAssetUrls))URL.revokeObjectURL(url);},{once:true});
 }catch(error){status.textContent='読み込みに失敗しました。再読み込みしてください。 '+error.message;console.error(error);}
})();
