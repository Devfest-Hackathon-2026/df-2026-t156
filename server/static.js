import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.data': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

function encodingQuality(header) {
  const offers = new Map();
  for (const item of String(header || '').toLowerCase().split(',')) {
    const [name, ...parameters] = item.trim().split(';');
    if (!name) continue;
    const quality = parameters.find(p => p.trim().startsWith('q='));
    const value = quality ? Number(quality.trim().slice(2)) : 1;
    offers.set(name.trim(), Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0);
  }
  return { gzip: offers.get('gzip') ?? offers.get('*') ?? 0,
    identity: offers.get('identity') ?? (offers.get('*') === 0 ? 0 : 1) };
}

const releaseAsset = name => name.endsWith('.wasm') || name.endsWith('.data') || name.endsWith('.framework.js');

export function serveBuild(directory) {
  const root = path.resolve(directory);
  return async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname); }
    catch { res.writeHead(400).end('Invalid path'); return; }
    if (pathname.includes('\0') || pathname.includes('\\')) {
      res.writeHead(400).end('Invalid path'); return;
    }
    const target = path.resolve(root, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '');
    if (target !== root && !target.startsWith(root + path.sep)) {
      res.writeHead(403).end(); return;
    }
    try {
      let info = await stat(target), representation = target;
      if (!info.isFile()) { res.writeHead(404).end('Not found'); return; }
      let logicalName = target;
      const headers = { 'Cache-Control': 'no-cache' };
      if (releaseAsset(target)) {
        headers.Vary = 'Accept-Encoding';
        const quality = encodingQuality(req.headers['accept-encoding']);
        let compressed;
        try { compressed = await stat(target + '.gz'); } catch { /* Local debug builds stay raw. */ }
        if (quality.gzip > 0 && quality.gzip >= quality.identity && compressed?.isFile() &&
          compressed.mtimeMs >= info.mtimeMs) {
          representation = target + '.gz';
          info = compressed;
          headers['Content-Encoding'] = 'gzip';
        } else if (quality.identity <= 0) {
          res.writeHead(406, { Vary: 'Accept-Encoding' }).end(); return;
        }
      }
      if (target.endsWith('.br') || target.endsWith('.gz')) {
        headers['Content-Encoding'] = target.endsWith('.br') ? 'br' : 'gzip';
        logicalName = target.slice(0, -3);
      } else if (target.endsWith('.unityweb')) logicalName = target.slice(0, -9);
      headers['Content-Length'] = info.size;
      headers['Content-Type'] = types[path.extname(logicalName)] || 'application/octet-stream';
      res.writeHead(200, headers);
      if (req.method === 'HEAD') res.end();
      else createReadStream(representation).on('error', () => res.destroy()).pipe(res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end('Unity WebGL build not found. Set STATIC_DIR to the build folder.');
    }
  };
}
