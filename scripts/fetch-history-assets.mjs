// Restore retained historical binaries without committing gigabytes of generated
// build output. Every downloaded payload is checked against its SHA-256 name.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/history-play/', import.meta.url));
const base = new URL(process.argv[2] || 'https://orbit-salvage-prototype-905974313870.asia-northeast1.run.app/');
const selected = process.argv[3];
const inventory = JSON.parse(await readFile(path.join(root, 'inventory.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(root, 'chunk-manifest.json'), 'utf8'));
const versions = inventory.versions.filter(v => !selected || v.id === selected);
if (!versions.length) throw new Error('Unknown retained version: ' + selected);
const assets = new Set(versions.flatMap(v => Object.values(v.assetMapping).map(value => value.split('/').at(-1))));
const chunks = new Set([...assets].filter(name => manifest[name]).flatMap(name => manifest[name].chunks));
const requests = [...chunks].map(hash => ['chunks', hash + '.bin']);
for (const name of assets) if (!/\.(data|wasm)$/.test(name)) requests.push(['assets', name]);
let cursor = 0, complete = 0;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function worker() {
  while (cursor < requests.length) {
    const [folder, name] = requests[cursor++], expected = name.split('.')[0];
    if (!/^[a-f0-9]{64}\.[a-z0-9.]{1,20}$/.test(name)) throw new Error('Invalid asset manifest entry');
    const directory = path.join(root, folder), target = path.join(directory, name);
    await mkdir(directory, { recursive: true });
    let correct = false;
    try { correct = sha(await readFile(target)) === expected; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!correct) {
      const url = new URL(`/history-play/${folder}/${name}`, base);
      const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`${response.status}: ${url.pathname}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (sha(data) !== expected) throw new Error('Asset hash mismatch: ' + name);
      await writeFile(target + '.tmp', data); await rename(target + '.tmp', target);
    }
    complete++;
    if (complete % 50 === 0 || complete === requests.length) console.log(`Restored ${complete}/${requests.length}`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`Ready: ${versions.length} retained version(s). Start the normal local server and open /history/.`);
