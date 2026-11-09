"""Make a static, deduplicated archive. Does not rebuild/modify Unity binaries."""
from pathlib import Path
import json,hashlib,re,shutil,gzip,zipfile
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'history-play'
ASSETS=OUT/'assets'; ASSETS.mkdir(parents=True,exist_ok=True)
RUNTIME=OUT/'runtime'; RUNTIME.mkdir(exist_ok=True)
for file in (ROOT/'replay-runtime').glob('*.js'):shutil.copyfile(file,RUNTIME/file.name)
inventory=json.loads((ROOT/'history-inventory.json').read_text(encoding='utf-8'))
total=0; payloads={}
for version in inventory['versions']:
    source=ROOT/version['sourceDirectory']; public=source/'public'
    dest=OUT/'play'/version['id']; dest.mkdir(parents=True,exist_ok=True)
    server=dest/'server';server.mkdir(exist_ok=True)
    data=[]
    for file in source.iterdir():
        if file.suffix=='.json' and file.name not in ('package.json','package-lock.json'):
            shutil.copyfile(file,server/file.name);data.append(file.name)
        if file.suffix!='.js' or file.name in ('index.js','static.js','feedback.js'):continue
        text=file.read_text(encoding='utf-8')
        text=text.replace("from 'node:crypto'","from '../../../runtime/node-shim.js'").replace("from 'node:fs'","from '../../../runtime/node-shim.js'").replace("from 'node:url'","from '../../../runtime/node-shim.js'")
        if re.search(r"from\s+['\"]node:",text):raise ValueError(f'Unsupported import {file}')
        (server/file.name).write_text(text,encoding='utf-8',newline='\n')
    (dest/'replay.json').write_text(json.dumps({'version':version['id'],'data':data}),encoding='utf-8')
    mapping={}
    for file in sorted(public.rglob('*')):
        if not file.is_file() or file.name=='index.html' or file.suffix in ('.gz','.br'):continue
        raw=file.read_bytes();sha=hashlib.sha256(raw).hexdigest();target=sha+file.suffix
        relative=file.relative_to(public).as_posix();mapping[relative]='../../assets/'+target
        total+=len(raw)
        if target not in payloads:
            payloads[target]=len(raw)
            (ASSETS/target).write_bytes(raw)
            # Hosting can select this sibling with Content-Encoding:gzip.
            if file.suffix in ('.data','.wasm','.js','.json'):
                with (ASSETS/(target+'.gz')).open('wb') as output:
                    with gzip.GzipFile(filename='',mode='wb',fileobj=output,mtime=0,compresslevel=6) as compressed:compressed.write(raw)
    text=(public/'index.html').read_text(encoding='utf-8-sig')
    for old,new in sorted(mapping.items(),key=lambda p:-len(p[0])):text=text.replace(old,new)
    bridge=f'<script src="../../runtime/history-bridge.js" data-version="{version["id"]}"></script>'
    # First script runs before the original client creates its WebSocket.
    position=text.lower().index('<script')
    text=text[:position]+bridge+text[position:]
    (dest/'index.html').write_text(text,encoding='utf-8')
    sources=OUT/'sources';sources.mkdir(exist_ok=True)
    with zipfile.ZipFile(sources/(version['id']+'.zip'),'w',zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(source.iterdir()):
            if file.is_file() and file.suffix in ('.js','.json'):archive.write(file,file.name)
        archive.writestr('HISTORY.txt',f'Original /app runtime extracted from {version["revision"]}\nImage {version["imageDigest"]}\nWebGL binary is served unchanged; browser compatibility imports are separate.\n')
    version['playUrl']='/history-play/play/'+version['id']+'/'
    version['sourceUrl']='/history-play/sources/'+version['id']+'.zip'
    version['assetMapping']=mapping
    version['playback']={'mode':'browser-local-original-world','status':'prepared-not-yet-browser-verified','multiplayer':False,'note':'当時のWebGLと当時のルールを使用。このタブ内でNPCと対戦し、現在のオンラインへ接続しません。'}
(ROOT/'history-inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2),encoding='utf-8')
links=''.join(f'<li><a href="play/{v["id"]}/">{v["revision"]}</a></li>' for v in inventory['versions'])
(OUT/'index.html').write_text('<!doctype html><html lang="ja"><meta charset="utf-8"><title>当時の版を遊ぶ</title><h1>当時の版を遊ぶ</h1><p>当時のWebGLと当時のゲーム処理を使う、タブ内だけのNPC対戦です。現在のオンラインには接続しません。</p><ol>'+links+'</ol></html>',encoding='utf-8')
stats={'versionCount':len(inventory['versions']),'allVersionAssetBytes':total,'deduplicatedAssetBytes':sum(payloads.values()),'uniqueAssets':len(payloads),'gzipAssetBytes':sum(p.stat().st_size for p in ASSETS.glob('*.gz'))}
(ROOT/'history-size.json').write_text(json.dumps(stats,indent=2),encoding='utf-8');print(json.dumps(stats))
