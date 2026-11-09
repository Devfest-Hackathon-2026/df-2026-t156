import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync, gunzipSync } from 'node:zlib';
import { serveArchivedAsset } from './archive.js';

test('historical proxy streams only hashed archive objects and preserves gzip and HEAD semantics', async () => {
  const previousFetch = globalThis.fetch, previousBucket = process.env.HISTORY_ASSET_BUCKET;
  process.env.HISTORY_ASSET_BUCKET = 'fixture-bucket';
  const raw = Buffer.from('retained historical game asset'.repeat(1000)), encoded = gzipSync(raw);
  const fetched = [];
  globalThis.fetch = async (url, options) => {
    fetched.push(String(url)); assert.equal(options.headers['Accept-Encoding'], 'identity');
    return new Response(String(url).includes('.gz?') ? encoded : raw);
  };
  const server = http.createServer((req, res) => { void serveArchivedAsset(req, res, { headers: async () => ({}) }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = (pathname, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: pathname, method, headers: { 'Accept-Encoding': 'gzip' } }, res => {
      const parts = []; res.on('data', p => parts.push(p)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
    }); req.on('error', reject); req.end();
  });
  try {
    const uri = `/history-play/chunks/${'a'.repeat(64)}.bin`;
    let response = await request(uri);
    assert.equal(response.status, 200); assert.equal(response.headers['content-encoding'], 'gzip'); assert.deepEqual(gunzipSync(response.body), raw);
    assert.ok(fetched[0].includes('orbit-salvage%2Fhistory%2Fchunks%2F'));
    response = await request(uri, 'HEAD'); assert.equal(response.status, 200); assert.equal(response.body.length, 0);
    response = await request('/history-play/assets/private-key.json'); assert.equal(response.status, 404); assert.equal(fetched.length, 2);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBucket === undefined) delete process.env.HISTORY_ASSET_BUCKET; else process.env.HISTORY_ASSET_BUCKET = previousBucket;
    await new Promise(resolve => server.close(resolve));
  }
});
