import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { createMemoryStore } from '../src/store.js';

const fixtures = new URL('./fixtures/', import.meta.url);
const coffeemanBytes = readFileSync(new URL('coffeeman-product.windows-1255.html', fixtures));
const pucksHtml = readFileSync(new URL('pucks-product.html', fixtures), 'utf8');
const BOI = {
  exchangeRates: [{ key: 'USD', currentExchangeRate: 3.05, unit: 1, lastUpdate: '2026-10-09T09:21:04.476265Z' }]
};

function fixtureFetch(url) {
  if (url.includes('coffeeman.co.il')) {
    return new Response(coffeemanBytes, { status: 200, headers: { 'content-type': 'text/html; charset=windows-1255' } });
  }
  if (url.includes('pucks.co.il')) {
    return new Response(pucksHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (url.includes('boi.org.il')) return Response.json(BOI);
  return new Response('unexpected ' + url, { status: 404 });
}

function envWith(store, extra = {}) {
  const stub = {
    fetch: async (request, init = {}) => {
      const { op, args = [] } = JSON.parse(init.body ?? (await request.text()));
      try {
        return Response.json({ result: await store[op](...args) });
      } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }
    }
  };
  return {
    BOARD: { idFromName: () => 'board', get: () => stub },
    ASSETS: { fetch: async request => new Response(`asset:${new URL(request.url).pathname}`) },
    ...extra
  };
}

async function seededStore() {
  const store = createMemoryStore();
  const { runRefresh } = await import('../src/refresh.js');
  await runRefresh({ store, fetchImpl: fixtureFetch, now: Date.parse('2026-10-12T10:00:00.000Z'), trigger: 'test' });
  return store;
}

test('health route reports live stage and last refresh', async () => {
  const store = await seededStore();
  const response = await worker.fetch(new Request('https://example.test/health'), envWith(store), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.stage, 'live');
  assert.ok(body.lastRefreshAt);
});

test('catalog route lists the product, destinations and vendor allowlist without offers', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/catalog'), envWith(createMemoryStore()), {});
  const body = await response.json();
  assert.equal(body.products[0].id, 'lavazza-crema-e-gusto-vacuum-ground');
  assert.ok(body.destinations.length >= 5);
  const vendorIds = body.vendors.map(vendor => vendor.id).sort();
  assert.deepEqual(vendorIds, ['coffeeman', 'pucks']);
  assert.match(body.vendors[0].offers[0].url, /^https:\/\//);
});

test('board ranks the offer with a verified delivered total and labels the unknown-shipping offer', async () => {
  const store = await seededStore();
  const response = await worker.fetch(new Request('https://example.test/api/board?grams=500&dest=tel-aviv'), envWith(store), {});
  assert.equal(response.status, 200);
  const board = await response.json();
  assert.equal(board.targetGrams, 500);
  assert.equal(board.best.vendor.id, 'coffeeman');
  // 2 packs × ₪33 + ₪25 courier shipping
  assert.equal(board.best.totalIls, 91);
  assert.equal(board.best.ilsPerKg, 182);
  assert.equal(board.best.availabilityLabel, 'In stock (observed)');
  assert.equal(board.ranked.length, 1);
  const unknown = board.unknown.find(quote => quote.vendor.id === 'pucks');
  assert.equal(unknown.totalIls, null);
  assert.match(unknown.reasons.join(' '), /unknown, not free/);
  assert.match(board.freshness.vendors.map(v => v.vendorId).join(','), /coffeeman/);
});

test('board response is public-cacheable and reflects quantity and destination', async () => {
  const store = await seededStore();
  const response = await worker.fetch(new Request('https://example.test/api/board?grams=250&dest=eilat&variant=classico'), envWith(store), {});
  assert.match(response.headers.get('cache-control'), /max-age=300/);
  const board = await response.json();
  assert.equal(board.destination.id, 'eilat');
  assert.equal(board.best.units, 1);
  assert.equal(board.best.totalIls, 58);
});

test('unknown API paths are JSON 404s and non-GET methods are rejected', async () => {
  const env = envWith(createMemoryStore());
  const missing = await worker.fetch(new Request('https://example.test/api/nope'), env, {});
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Not found' });
  const post = await worker.fetch(new Request('https://example.test/api/board', { method: 'POST' }), env, {});
  assert.equal(post.status, 405);
});

test('website requests fall through to static assets', async () => {
  const response = await worker.fetch(new Request('https://example.test/'), envWith(createMemoryStore()), {});
  assert.equal(await response.text(), 'asset:/');
});

test('scheduled handler refreshes and persists through the BOARD binding', async () => {
  const store = createMemoryStore();
  const waits = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => fixtureFetch(String(url));
  try {
    await worker.scheduled({ cron: '17 */6 * * *' }, envWith(store), { waitUntil: promise => waits.push(promise) });
    await Promise.all(waits);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const snapshot = await store.snapshot();
  assert.equal(snapshot.observations.length, 2);
  assert.equal(snapshot.meta.lastRefreshAt.trigger, 'cron');
  assert.equal(snapshot.meta.fx.rates.USD.rate, 3.05);
  const run = snapshot.runs[0];
  assert.equal(run.trigger, 'cron');
  assert.equal(run.requests, 3);
});

test('board without a storage binding explains the deployment requirement', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/board'), { ASSETS: { fetch: async () => new Response('x') } }, {});
  const body = await response.json();
  assert.match(body.message, /BOARD Durable Object binding/);
  assert.deepEqual(body.offers, []);
});
