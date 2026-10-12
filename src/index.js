import { products } from './catalog.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/health') {
      return Response.json({ status: 'ok', stage: 'scaffold' });
    }
    if (pathname === '/api/catalog') {
      return Response.json({
        products,
        offers: [],
        status: 'Research pending. No verified vendor offers yet.',
        updatedAt: null
      }, { headers: { 'Cache-Control': 'public, max-age=60' } });
    }
    if (pathname.startsWith('/api/')) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  }
};
