"""Read existing revision images; extract only this game's /app runtime.

No deployment, registry mutation, base image extraction, or Unity build.
Credentials stay in this process, never in the output manifest.
Run from WSL with gcloud already authenticated.
"""
import io, json, pathlib, subprocess, tarfile, urllib.request, hashlib
ROOT = pathlib.Path(__file__).resolve().parent
RESEARCH = ROOT / '_research'
catalog=RESEARCH/'cloud-revisions.json'
if catalog.exists():
    REVISIONS=json.loads(catalog.read_text())
else:
    REVISIONS=json.loads(subprocess.check_output([str(pathlib.Path.home()/'.local/bin/gcloud'),'run','revisions','list','--service=orbit-salvage-prototype','--region=asia-northeast1','--project=hobby-256508','--format=json']))
REVISIONS=[r for r in REVISIONS if int(r['metadata']['name'].split('-')[-2])<=44]
HOST = 'asia-northeast1-docker.pkg.dev'
REPO = 'hobby-256508/orbit-salvage-prototype/app'
token = subprocess.check_output([str(pathlib.Path.home()/'.local/bin/gcloud'), 'auth', 'print-access-token'], text=True).strip()
def get(kind, digest, accept=None):
    request = urllib.request.Request(f'https://{HOST}/v2/{REPO}/{kind}/{digest}', headers={'Authorization': 'Bearer '+token, **({'Accept': accept} if accept else {})})
    with urllib.request.urlopen(request, timeout=90) as response: return response.read()
def digest(data): return hashlib.sha256(data).hexdigest()
cache = RESEARCH/'layers'; cache.mkdir(parents=True,exist_ok=True)
out=[]
for revision in sorted(REVISIONS, key=lambda x:x['metadata']['name']):
    name=revision['metadata']['name']; number=int(name.split('-')[-2]); image=revision['spec']['containers'][0]['image']; sha=image.split('@')[1]
    dest=ROOT/'history-source'/f'r{number:02}'; dest.mkdir(parents=True,exist_ok=True)
    manifest=json.loads(get('manifests',sha,'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'))
    config=json.loads(get('blobs',manifest['config']['digest']))
    layers=iter(manifest['layers']); selected=[]
    for entry in config.get('history',[]):
        if entry.get('empty_layer'): continue
        layer=next(layers); command=entry.get('created_by','')
        if not ('COPY ' in command or 'WORKDIR /app' in command): continue
        datafile=cache/layer['digest'].split(':')[1]
        if not datafile.exists():
            raw=get('blobs',layer['digest']); assert 'sha256:'+digest(raw)==layer['digest']; datafile.write_bytes(raw)
        with tarfile.open(datafile,'r:*') as archive:
            for member in archive:
                p=pathlib.PurePosixPath(member.name)
                if not member.isfile() or '..' in p.parts or not p.parts or p.parts[0]!='app': continue
                relative=pathlib.Path(*p.parts[1:])
                if 'node_modules' in relative.parts: continue
                target=dest/relative; target.parent.mkdir(parents=True,exist_ok=True)
                raw=archive.extractfile(member).read(); target.write_bytes(raw)
        selected.append(layer['digest'])
    record={'number':number,'id':f'r{number:02}','revision':name,'imageDigest':sha,'createdAt':revision['metadata']['creationTimestamp'],'sourceDirectory':f'history-source/r{number:02}','layers':selected,'runtimeExtracted':(dest/'game.js').exists(),'webglRetained':(dest/'public/index.html').exists()}
    out.append(record)
    (ROOT/'history-inventory.json').write_text(json.dumps({'versions':out},ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'{name}: runtime={record["runtimeExtracted"]} client={record["webglRetained"]}',flush=True)
