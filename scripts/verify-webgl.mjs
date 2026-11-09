import http from 'node:http';
import https from 'node:https';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';

const [base, directory] = process.argv.slice(2);
if (!base || !directory) throw new Error('Usage: verify-webgl.mjs BASE_URL BUILD_DIRECTORY');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function request(url, method, encoding) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, { method, headers: { 'Accept-Encoding': encoding } }, res => {
      const chunks = [];res.on('data', data => chunks.push(data));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
    });
    req.on('error', reject);req.end();
  });
}
const output = [];
for (const file of await readdir(path.join(directory, 'Build'))) {
  if (!file.endsWith('.wasm') && !file.endsWith('.data') && !file.endsWith('.framework.js')) continue;
  const raw = await readFile(path.join(directory, 'Build', file));
  const url = new URL('Build/' + encodeURIComponent(file), base.endsWith('/') ? base : base + '/');
  const encoded = await request(url, 'GET', 'gzip');
  const decoded = encoded.headers['content-encoding'] === 'gzip' ? gunzipSync(encoded.bytes) : encoded.bytes;
  if (encoded.status !== 200 || hash(decoded) !== hash(raw)) throw new Error('Decoded build mismatch: ' + file);
  // Cloud Run may replace compressed Content-Length with chunked transfer encoding.
  if (encoded.headers['content-length'] !== undefined &&
    Number(encoded.headers['content-length']) !== encoded.bytes.length) throw new Error('Transfer length mismatch: ' + file);
  if (!String(encoded.headers.vary).toLowerCase().includes('accept-encoding')) throw new Error('Missing Vary: ' + file);
  const head = await request(url, 'HEAD', 'identity');
  if (head.status !== 200 || head.bytes.length || head.headers['content-encoding'] ||
    Number(head.headers['content-length']) !== raw.length) throw new Error('Raw HEAD mismatch: ' + file);
  output.push({ file, originalBytes: raw.length, transferBytes: encoded.bytes.length,
    encoding: encoded.headers['content-encoding'] || 'identity', contentType: encoded.headers['content-type'],
    sha256: hash(raw), decodedMatches: true, rawHeadMatches: true });
}
console.log(JSON.stringify(output));
