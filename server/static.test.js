import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdtemp, writeFile, rm, utimes, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serveBuild } from './static.js';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'orbit-gzip-'));
  const original = Buffer.from('Unity immutable binary payload '.repeat(5000));
  const compressed = gzipSync(original);
  await writeFile(path.join(dir, 'game.wasm'), original);
  await writeFile(path.join(dir, 'game.wasm.gz'), compressed);
  const handle = serveBuild(dir);
  const server = http.createServer((req, res) => handle(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.ok(path.resolve(dir).startsWith(path.join(path.resolve(os.tmpdir()), 'orbit-gzip-')));
    await rm(dir, { recursive: true, force: true });
  });
  const url = 'http://127.0.0.1:' + server.address().port + '/game.wasm';
  function request(encoding, method = 'GET') {
    return new Promise((resolve, reject) => {
      const req = http.request(url, { method, headers: encoding ? { 'Accept-Encoding': encoding } : {} }, res => {
        const chunks = [];res.on('data', data => chunks.push(data));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);req.end();
    });
  }
  return { dir, original, compressed, url, request };
}

test('normal Unity URL negotiates gzip with original MIME, Vary, HEAD and matching decoded bytes', async t => {
  const f = await fixture(t), compressed = await f.request('gzip, br');
  assert.equal(compressed.status, 200);
  assert.equal(compressed.headers['content-encoding'], 'gzip');
  assert.equal(compressed.headers['content-type'], 'application/wasm');
  assert.equal(compressed.headers.vary, 'Accept-Encoding');
  assert.equal(Number(compressed.headers['content-length']), f.compressed.length);
  assert.equal(compressed.headers['cache-control'], 'no-cache');
  assert.deepEqual(gunzipSync(compressed.body), f.original);
  const head = await f.request('gzip', 'HEAD');
  assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-length'], compressed.headers['content-length']);
  const browserStyle = await fetch(f.url, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.deepEqual(Buffer.from(await browserStyle.arrayBuffer()), f.original);
});

test('clients rejecting gzip keep the original representation; no acceptable representation gives406', async t => {
  const f = await fixture(t);
  for (const encoding of [undefined, 'identity', 'br', 'gzip;q=0', 'gzip;q=.5, identity;q=1']) {
    const response = await f.request(encoding);
    assert.equal(response.status, 200);assert.equal(response.headers['content-encoding'], undefined);
    assert.deepEqual(response.body, f.original);
    assert.equal(Number(response.headers['content-length']), f.original.length);
  }
  assert.equal((await f.request('gzip;q=0, identity;q=0')).status, 406);
  assert.equal((await f.request('gzip, identity;q=0')).headers['content-encoding'], 'gzip');
});

test('a replaced raw build cannot accidentally serve an older gzip sidecar', async t => {
  const f = await fixture(t), next = Buffer.from('New adopted build');
  await writeFile(path.join(f.dir, 'game.wasm'), next);
  const changed = new Date(Date.now() + 2000);
  await utimes(path.join(f.dir, 'game.wasm'), changed, changed);
  const response = await f.request('gzip');
  assert.equal(response.headers['content-encoding'], undefined);
  assert.deepEqual(response.body, next);
});

test('raw Git bundles are not public archive downloads, even if accidentally copied or URL encoded', async t => {
  const f = await fixture(t);
  const sources = path.join(f.dir, 'history-play', 'sources');
  await mkdir(sources, { recursive: true });
  await writeFile(path.join(sources, 'private.bundle'), 'private history fixture');
  await writeFile(path.join(sources, 'runtime.zip'), 'public runtime fixture');
  for (const name of ['private.bundle', 'private%2ebundle']) {
    const response = await fetch(new URL('/history-play/sources/' + name, f.url));
    assert.equal(response.status, 404);
  }
  assert.equal((await fetch(new URL('/history-play/sources/runtime.zip', f.url))).status, 200);
});
