"""Run in WSL after build-history.py. Keep the large original assets private.
The static delivery uses byte-identical chunks, not converted Unity content.
"""
from pathlib import Path
import subprocess,hashlib,json,gzip,shutil
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'history-play';chunks=OUT/'chunks';chunks.mkdir(exist_ok=True)
tool=ROOT/'_research/cdc-offsets';tool.parent.mkdir(parents=True,exist_ok=True)
subprocess.run(['g++','-O3','-std=c++17',str(ROOT/'cdc-offsets.cpp'),'-o',str(tool)],check=True)
manifest={};unique=set()
for file in sorted((OUT/'assets').iterdir()):
 if file.suffix not in ('.wasm','.data'):continue
 raw=file.read_bytes();offsets=list(map(int,subprocess.check_output([str(tool),str(file)]).split()));start=0;ids=[]
 for end in offsets:
  data=raw[start:end];sha=hashlib.sha256(data).hexdigest();ids.append(sha);start=end
  if sha in unique:continue
  unique.add(sha);target=chunks/(sha+'.bin');target.write_bytes(data)
  with target.with_suffix('.bin.gz').open('wb') as output:
   with gzip.GzipFile(filename='',mode='wb',fileobj=output,mtime=0,compresslevel=6) as compressed:compressed.write(data)
 manifest[file.name]={'size':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'type':'application/wasm' if file.suffix=='.wasm' else 'application/octet-stream','chunks':ids}
 print(file.name[:12],len(ids),flush=True)
(OUT/'chunk-manifest.json').write_text(json.dumps(manifest,separators=(',',':')),encoding='utf-8')
inventory=json.loads((ROOT/'history-inventory.json').read_text(encoding='utf-8'))
version_map={v['id']:v for v in inventory['versions']}
for folder in sorted((OUT/'play').iterdir()):
 version=version_map[folder.name]
 client=(ROOT/version['sourceDirectory']/'public/index.html').read_text(encoding='utf-8-sig')
 for old,new in sorted(version['assetMapping'].items(),key=lambda p:-len(p[0])):client=client.replace(old,new)
 bridge=f'<script src="../../runtime/history-bridge.js" data-version="{folder.name}"></script>'
 position=client.lower().index('<script');client=client[:position]+bridge+client[position:]
 assets=[]
 for filename in manifest:
  relative='../../assets/'+filename
  for quote in ("'",'"'):
   literal=quote+relative+quote
   if literal in client:
    client=client.replace(literal,'window.historyAssetUrls['+json.dumps(filename)+']');assets.append(filename)
 (folder/'client.html').write_text(client,encoding='utf-8')
 (folder/'index.html').write_text('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>履歴 '+folder.name+'</title><style>html,body{margin:0;width:100%;height:100%;background:#101719;color:#eaf0ed;font:16px system-ui}main{position:absolute;left:8%;top:35%;max-width:650px}h1{font-size:24px}progress{width:300px}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style><main><h1>当時のゲームを読み込み中</h1><p>このタブだけでNPCと対戦します。</p><progress id="progress" max="1" value="0"></progress><p id="status">履歴 '+folder.name+'</p></main><script>window.historyAssets='+json.dumps(list(dict.fromkeys(assets)))+';</script><script src="../../runtime/load-chunks.js"></script></html>',encoding='utf-8')
# A separate deployment tree excludes the full-size duplicate binaries and originals.
deploy=ROOT/'history-distribution';deploy.mkdir(exist_ok=True)
for folder in ('play','runtime','sources','chunks'):
 shutil.copytree(OUT/folder,deploy/folder,dirs_exist_ok=True)
for name in ('index.html','inventory.json','chunk-manifest.json'):shutil.copyfile(OUT/name,deploy/name)
(deploy/'assets').mkdir(exist_ok=True)
for file in (OUT/'assets').iterdir():
 if file.name.removesuffix('.gz') not in manifest:shutil.copyfile(file,deploy/'assets'/file.name)
stats={'largeFiles':len(manifest),'uniqueChunks':len(unique),'uniqueChunkBytes':sum(p.stat().st_size for p in chunks.glob('*.bin')),'gzipChunkBytes':sum(p.stat().st_size for p in chunks.glob('*.gz')),'logicalLargeBytes':sum(x['size'] for x in manifest.values()),'distributionBytes':sum(p.stat().st_size for p in deploy.rglob('*') if p.is_file())}
(ROOT/'history-chunk-size.json').write_text(json.dumps(stats,indent=2),encoding='utf-8');print(json.dumps(stats))
