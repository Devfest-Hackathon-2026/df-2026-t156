import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { encodingQuality, contentType } from './static.js';

// Only content-addressed historical build assets are proxied. The bucket stays
// private; callers cannot select arbitrary object names or storage locations.
export async function serveArchivedAsset(req, res, identity) {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
  const match = /^\/history-play\/(assets|chunks)\/([a-f0-9]{64}\.[a-z0-9.]{1,20})$/.exec(new URL(req.url, 'http://local').pathname);
  if (!match) { res.writeHead(404).end(); return; }
  const [, directory, name] = match;
  const bucket = process.env.HISTORY_ASSET_BUCKET;
  const prefix = `orbit-salvage/history/${directory}/`;
  const quality = encodingQuality(req.headers['accept-encoding']);
  let gzip = quality.gzip > 0 && quality.gzip >= quality.identity && /\.(data|wasm|js|json|bin)$/.test(name);
  const headers = { ...await identity.headers(), 'Accept-Encoding': 'identity' };
  const get = suffix => fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(prefix + name + suffix)}?alt=media`,
    { headers, signal: AbortSignal.timeout(60000) });
  let response = await get(gzip ? '.gz' : '');
  if (gzip && response.status === 404) { await response.body?.cancel(); gzip = false; response = await get(''); }
  if (!response.ok) { await response.body?.cancel(); res.writeHead(response.status === 404 ? 404 : 503).end('Archive unavailable'); return; }
  if (!gzip && quality.identity <= 0) { await response.body?.cancel(); res.writeHead(406).end(); return; }
  const outgoing = { 'Content-Type': contentType(name), 'Cache-Control': 'public, max-age=31536000, immutable', Vary: 'Accept-Encoding' };
  if (gzip) outgoing['Content-Encoding'] = 'gzip';
  res.writeHead(200, outgoing);
  if (req.method === 'HEAD') { await response.body?.cancel(); res.end(); return; }
  await pipeline(Readable.fromWeb(response.body), res);
}
