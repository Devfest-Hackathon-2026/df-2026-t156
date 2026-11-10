const backend = 'https://orbit-salvage-prototype-905974313870.asia-northeast1.run.app';
const sites = new Set(['https://worldshift.pichu.dev', 'https://patchplay.pichu.dev']);

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!sites.has(url.origin)) return new Response('Unknown host', { status: 404 });

    const upgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin && (request.method !== 'GET' || upgrade)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (upgrade) {
      if (url.pathname !== '/ws') return new Response('Not found', { status: 404 });
      // Let the Workers runtime negotiate a fresh handshake with the game server.
      return fetch(backend + '/ws', { headers: { Upgrade: 'websocket', Origin: backend } });
    }

    const upstream = new Request(backend + url.pathname + url.search, request);
    upstream.headers.delete('Host');
    if (origin === url.origin) upstream.headers.set('Origin', backend);
    const result = await fetch(upstream, { redirect: 'manual', cache: 'no-store' });
    const response = new Response(result.body, result);
    response.headers.set('Cache-Control', url.pathname.startsWith('/api/') ? 'private, no-store' : 'no-cache');
    return response;
  }
};
