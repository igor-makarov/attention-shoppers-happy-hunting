// Public Worker: read-only comparison board plus the scheduled refresh entry.
//
// Public routes only read the persisted snapshot. They never fetch vendor URLs
// supplied by a visitor and never trigger unbounded scraping. The first request
// after a deployment may start one throttled initial refresh.

import { products, resolveProductRequest, variantCatalog, resolveVariantId } from './catalog.js';
import { quoteBoard, findDestination, DESTINATIONS } from './lib/quote.js';
import { runRefresh, maybeInitialRefresh, refreshFreshness, newestObservationAt } from './refresh.js';
import { durableStore, storeClient } from './store.js';
import { registeredVendors } from './vendors/index.js';

export { BoardStore } from './store.js';

const PUBLIC_CACHE = 'public, max-age=300, stale-while-revalidate=3600';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    if (url.pathname === '/health') {
      scheduleInitialRefresh(env, ctx);
      return handleHealth(env);
    }
    if (url.pathname === '/api/catalog') {
      return json({ products: publicProducts(), destinations: DESTINATIONS, vendors: publicVendors() });
    }
    if (url.pathname === '/api/board') {
      scheduleInitialRefresh(env, ctx);
      return handleBoard(request, env, ctx, url);
    }
    if (url.pathname === '/api/status') {
      return handleStatus(env);
    }
    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, 404);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    const store = storeClient(durableStore(env));
    const job = runRefresh({ store, trigger: event?.cron ? 'cron' : 'scheduled' });
    if (ctx?.waitUntil) ctx.waitUntil(job);
    return job;
  }
};

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': PUBLIC_CACHE, ...headers } });
}

async function handleHealth(env) {
  let refresh = null;
  let lastObservationAt = null;
  let error = null;
  try {
    if (env.BOARD) {
      const store = storeClient(durableStore(env));
      const snapshot = await store.snapshot();
      refresh = snapshot.meta?.lastRefreshAt?.value ?? null;
      lastObservationAt = newestObservationAt(snapshot.observations);
    }
  } catch (cause) {
    error = 'storage unavailable';
  }
  return json({ status: 'ok', stage: 'live', lastRefreshAt: refresh, lastObservationAt, storageError: error });
}

async function handleBoard(request, env, ctx, url) {
  if (!env.BOARD) {
    return json({
      status: 'storage not configured',
      offers: [],
      message: 'The board needs the BOARD Durable Object binding from docs/DEPLOYMENT.md.'
    });
  }
  const store = storeClient(durableStore(env));
  // Owner correction 2026-10-12: only Crema e Gusto is tracked. An old shared
  // URL that still names a retired line (Qualità Oro, Qualità Rossa, Suerte)
  // falls back to the tracked product and says so instead of reviving it.
  const { product, retired } = resolveProductRequest(url.searchParams.get('product'));
  const productId = product.id;
  const requestedVariant = url.searchParams.get('variant');
  // A variant id that is not tracked at all (a typo or an old shared link) falls
  // back to the product's default, like an unknown product or destination. A real
  // variant of another line stays strict: it matches nothing on this board.
  const variantId = resolveVariantId(product, requestedVariant);
  const grams = url.searchParams.get('grams') ?? '500';
  const destination = findDestination(url.searchParams.get('dest'));
  const snapshot = await store.snapshot();
  const lastObservationAt = newestObservationAt(snapshot.observations);
  const board = quoteBoard({
    observations: snapshot.observations,
    productId,
    variantId,
    targetGrams: grams,
    destination,
    fx: snapshot.meta?.fx ?? null,
    now: Date.now()
  });
  const vendors = snapshot.vendors ?? {};
  return json({
    ...board,
    product: publicProduct(product),
    requestedRetiredProduct: retired ? { id: retired.id, line: retired.line } : null,
    freshness: {
      ...refreshFreshness(snapshot.meta?.lastRefreshAt?.value ?? null, Date.now(), lastObservationAt),
      fx: snapshot.meta?.fx ? { asOf: snapshot.meta.fx.asOf, fetchedAt: snapshot.meta.fx.fetchedAt, source: snapshot.meta.fx.source?.name ?? null } : null,
      vendors: Object.values(vendors).map(state => ({
        vendorId: state.vendorId,
        lastAttemptAt: state.lastAttemptAt,
        lastSuccessAt: state.lastSuccessAt,
        consecutiveFailures: state.consecutiveFailures,
        nextAttemptAt: state.nextAttemptAt,
        lastErrors: state.lastErrors ?? []
      }))
    },
    status: board.ranked.length > 0
      ? 'Delivered totals ranked from verified observations.'
      : 'No offer currently has enough verified information to rank. Unknowns are listed below.'
  }, 200, {
    'Vary': 'Accept-Encoding',
    'Access-Control-Allow-Origin': '*'
  });
}

async function handleStatus(env) {
  if (!env.BOARD) return json({ status: 'storage not configured', vendors: [], runs: [] });
  const store = storeClient(durableStore(env));
  const snapshot = await store.snapshot();
  const lastObservationAt = newestObservationAt(snapshot.observations);
  return json({
    lastRefreshAt: snapshot.meta?.lastRefreshAt?.value ?? null,
    lastObservationAt,
    freshness: refreshFreshness(snapshot.meta?.lastRefreshAt?.value ?? null, Date.now(), lastObservationAt),
    fx: snapshot.meta?.fx ? { asOf: snapshot.meta.fx.asOf, fetchedAt: snapshot.meta.fx.fetchedAt } : null,
    vendors: Object.values(snapshot.vendors ?? {}).map(state => ({
      vendorId: state.vendorId,
      lastAttemptAt: state.lastAttemptAt,
      lastSuccessAt: state.lastSuccessAt,
      consecutiveFailures: state.consecutiveFailures,
      nextAttemptAt: state.nextAttemptAt,
      lastErrors: state.lastErrors ?? []
    })),
    runs: (snapshot.runs ?? []).map(run => ({
      trigger: run.trigger,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      requests: run.requests,
      vendors: run.vendors
    })),
    observations: snapshot.observations.length
  });
}

export function publicVendors() {
  return registeredVendors().map(vendor => ({
    id: vendor.id,
    name: vendor.name,
    homepage: vendor.homepage,
    offers: vendor.offers.map(offer => ({ id: offer.id, url: offer.url, kind: offer.kind, productId: offer.productId ?? null }))
  }));
}

/** Public product shape: identity, packaging and the selectable variants. */
export function publicProduct(product) {
  if (!product) return null;
  return {
    id: product.id,
    brand: product.brand,
    line: product.line,
    form: product.form,
    packaging: product.packaging,
    targetMarket: product.targetMarket,
    defaultVariant: product.defaultVariant,
    variants: variantCatalog(product),
    notes: product.notes
  };
}

export function publicProducts() {
  return products.map(publicProduct);
}

function scheduleInitialRefresh(env, ctx) {
  const work = triggerInitialRefreshIfNeeded(env, ctx)
    .catch(error => console.warn('initial refresh trigger failed:', error?.stack ?? error));
  if (ctx?.waitUntil) ctx.waitUntil(work);
  return work;
}

export async function triggerInitialRefreshIfNeeded(env, ctx) {
  if (!env.BOARD) return { skipped: true, reason: 'no storage binding' };
  const store = storeClient(durableStore(env));
  return maybeInitialRefresh({ store, ctx });
}
