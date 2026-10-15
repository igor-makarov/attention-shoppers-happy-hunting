// Public Worker: read-only comparison board plus the scheduled refresh entry.
//
// Public routes only read the persisted snapshot. They never fetch vendor URLs
// supplied by a visitor and never trigger unbounded scraping. The first request
// after a deployment may start one throttled initial refresh.

import { products, resolveProductRequest } from './catalog.js';
import { quoteBoard, findDestination, DESTINATIONS } from './lib/quote.js';
import { policySummary } from './lib/policies.js';
import { promotionSummary } from './lib/promotions.js';
import { runRefresh, maybeInitialRefresh, refreshFreshness, newestObservationAt } from './refresh.js';
import { durableStore, storeClient } from './store.js';
import { registeredVendors } from './vendors/index.js';

export { BoardStore } from './store.js';

const PUBLIC_CACHE = 'public, max-age=300, stale-while-revalidate=3600';
// Freshness must only consider observations for product lines that are still tracked:
// a lingering historical row must not keep the single-product board looking fresh.
const TRACKED_PRODUCT_IDS = products.map(product => product.id);

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
    // Product-detail pages are directly loadable: /product/<id> is served the
    // product page asset, which resolves the id (including a retired-line
    // fallback) against the tracked catalog through the read-only API.
    if (url.pathname === '/product' || /^\/product\/[^/]+\/?$/.test(url.pathname)) {
      if (!env.ASSETS) return new Response('Not found', { status: 404 });
      const assetUrl = new URL('/product.html', url.origin);
      return env.ASSETS.fetch(new Request(assetUrl, { method: request.method, headers: request.headers }));
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
      lastObservationAt = newestObservationAt(snapshot.observations, TRACKED_PRODUCT_IDS);
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
  // Owner correction, 2026-10-12: there is no blend/variant feature. An old
  // shared URL may still carry `variant=classico/unspecified/...`; the obsolete
  // parameter is ignored so the URL resolves to the one unified comparison and
  // quantity/locality are preserved. It never creates a second view or filters
  // any listing out.
  const grams = url.searchParams.get('grams') ?? undefined;
  const destination = findDestination(url.searchParams.get('dest'));
  const snapshot = await store.snapshot();
  const lastObservationAt = newestObservationAt(snapshot.observations, [productId]);
  const board = quoteBoard({
    observations: snapshot.observations,
    productId,
    targetGrams: grams,
    targetQuantity: url.searchParams.get('quantity'),
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
      ...refreshFreshness(lastObservationAt ? snapshot.meta?.lastRefreshAt?.value ?? null : null, Date.now(), lastObservationAt),
      fx: snapshot.meta?.fx ? { asOf: snapshot.meta.fx.asOf, fetchedAt: snapshot.meta.fx.fetchedAt, source: snapshot.meta.fx.source?.name ?? null } : null,
      vendors: Object.values(vendors).filter(state => registeredVendors().some(vendor =>
        vendor.id === state.vendorId && vendor.offers.some(offer => offer.productId === productId)
      )).map(state => ({
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
  const lastObservationAt = newestObservationAt(snapshot.observations, TRACKED_PRODUCT_IDS);
  return json({
    lastRefreshAt: snapshot.meta?.lastRefreshAt?.value ?? null,
    lastObservationAt,
    freshness: refreshFreshness(snapshot.meta?.lastRefreshAt?.value ?? null, Date.now(), lastObservationAt),
    fx: snapshot.meta?.fx ? { asOf: snapshot.meta.fx.asOf, fetchedAt: snapshot.meta.fx.fetchedAt } : null,
    // Versioned shipping policies applied at read time: which rule version is in
    // force, when it was observed and when it must be re-checked. An expired
    // policy stops enriching offers until browser research renews it.
    shippingPolicies: policySummary(Date.now()),
    // Published quantity promotions (item-price discounts) the board may apply,
    // with the same review-date discipline.
    promotions: promotionSummary(Date.now()),
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

/** Public product shape: identity and packaging. No blend/variant selection exists. */
export function publicProduct(product) {
  if (!product) return null;
  return {
    id: product.id,
    brand: product.brand,
    line: product.line,
    form: product.form,
    packaging: product.packaging,
    targetMarket: product.targetMarket,
    notes: product.notes,
    description: product.description,
    detailDescription: product.detailDescription ?? product.description,
    quantity: product.quantity,
    deliveryOnly: Boolean(product.deliveryOnly),
    sourcing: product.sourcing ?? null
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
