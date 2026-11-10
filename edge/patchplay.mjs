const backend = 'https://orbit-salvage-prototype-905974313870.asia-northeast1.run.app';
const site = 'https://patchplay.pichu.dev';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.origin !== site) return new Response('Unknown host', {status: 404});
    const origin = request.headers.get('origin');
    if (origin && origin !== site && (request.method !== 'GET' || request.headers.has('Upgrade'))) {
      return new Response('Forbidden', {status: 403});
    }
    const upstream = new Request(backend + url.pathname + url.search, request);
    upstream.headers.delete('host');
    if (origin === site) upstream.headers.set('Origin', backend);
    return fetch(upstream, {redirect: 'manual', cf: {cacheTtl: 0}});
  }
};