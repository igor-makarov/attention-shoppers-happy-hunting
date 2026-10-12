import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { createMemoryStore } from '../src/store.js';
import { trackedOffers } from './fixtures/vendor-fixtures.mjs';
import { pacingDefaults } from '../src/refresh.js';

// Pacing waits are injected away: crawl-delay timing has its own test.
pacingDefaults.sleep = async () => {};

const fixtures = new URL('./fixtures/', import.meta.url);
const fixtureCache = new Map();
for (const offer of trackedOffers()) {
  if (offer.file) fixtureCache.set(offer.url, readFixtureSync(offer.file));
}
function readFixtureSync(file) {
  const bytes = readFileSync(new URL(file, fixtures));
  return { bytes, contentType: file.includes('windows-1255') ? 'text/html; charset=windows-1255' : 'text/html; charset=utf-8' };
}
const BOI = {
  exchangeRates: [{ key: 'USD', currentExchangeRate: 3.05, unit: 1, lastUpdate: '2026-10-09T09:21:04.476265Z' }]
};

function fixtureFetch(url) {
  const response = fixtureResponse(url);
  if (response) return response;
  if (String(url).includes("boi.org.il")) return Response.json(BOI);
  return new Response("unexpected " + url, { status: 404 });
}

function fixtureResponse(url) {
  const hit = fixtureCache.get(String(url));
  if (!hit) return null;
  return new Response(hit.bytes, { status: 200, headers: { "content-type": hit.contentType } });
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
  assert.ok(body.lastObservationAt, 'health exposes the newest saved observation for interrupted-refresh diagnosis');
});

test('catalog route lists the product, destinations and vendor allowlist without offers', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/catalog'), envWith(createMemoryStore()), {});
  const body = await response.json();
  assert.equal(body.products[0].id, 'lavazza-crema-e-gusto-vacuum-ground');
  assert.equal(body.products.length, 1, 'only the one tracked product line is selectable');
  assert.ok(body.destinations.length >= 5);
  const vendorIds = body.vendors.map(vendor => vendor.id).sort();
  assert.deepEqual(vendorIds, ['coffee4u', 'coffeeman', 'pucks']);
  const coffee4u = body.vendors.find(vendor => vendor.id === 'coffee4u');
  assert.match(coffee4u.offers[0].url, /^https:\/\/www\.coffee4u\.co\.il\/product\//);
  assert.match(body.vendors[0].offers[0].url, /^https:\/\//);
});

test('board ranks all three vendors with their evidenced shipping conditions', async () => {
  const store = await seededStore();
  const response = await worker.fetch(new Request('https://example.test/api/board?grams=500&dest=tel-aviv'), envWith(store), {});
  assert.equal(response.status, 200);
  const board = await response.json();
  assert.equal(board.targetGrams, 500);
  // 2 × ₪30 + ₪30 researched checkout rate: the ₪100 threshold is not met at ₪60.
  assert.equal(board.best.vendor.id, 'pucks');
  assert.equal(board.best.totalIls, 90);
  assert.equal(board.best.ilsPerKg, 180);
  assert.equal(board.best.availabilityLabel, 'In stock (observed)');
  assert.equal(board.best.shipping.certaintyLabel, 'Published rate (verified)', 'the API carries a written shipping-certainty label');
  assert.equal(board.best.shipping.freeThreshold, 100, 'the researched free-shipping threshold is structured');
  assert.match(board.best.shipping.coverageCaveat, /not individually verified/, 'the researched rate keeps its coverage caveat');
  assert.equal(board.ranked.length, 4, 'the single pack, 4-pack, 8-pack and Pucks are all rankable now');
  const fourPack = board.ranked.find(quote => quote.product.packCount === 4);
  assert.equal(fourPack.totalIls, 149, '₪124 + ₪25 courier');
  assert.equal(fourPack.ilsPerKg, 149);
  const eightPack = board.ranked.find(quote => quote.product.packCount === 8);
  assert.equal(eightPack.totalIls, 260, '₪240 + the researched ₪20 checkout rate for the 2 kg cart');
  assert.equal(eightPack.shipping.maxTotalGrams, 2000, 'the checkout rate is limited to the cart it was observed on');
  assert.match(board.freshness.vendors.map(v => v.vendorId).join(','), /coffeeman/);
  assert.ok(board.freshness.vendors.every(vendor => vendor.nextAttemptAt), 'every vendor state exposes its next due time for the footer');
  assert.equal(board.counts.excludedByVariant, 1, 'the Coffee4U listing states no blend variant, so it is not merged into Classico');
  assert.deepEqual(board.counts.excludedVariants, ['unspecified']);

  // The researched 8-pack rate must not be stretched to a larger cart: at 3 kg the
  // offer stays visible but unrankable with the exact quote-limit reason.
  const big = await (await worker.fetch(new Request('https://example.test/api/board?grams=3000&dest=tel-aviv'), envWith(store), {})).json();
  const blocked = big.unrankable.find(quote => quote.product.packCount === 8);
  assert.ok(blocked, 'the 8-pack cannot rank with a 2 kg quote on a 4 kg cart');
  assert.match(blocked.reasons.join(' '), /quoted only for carts up to 2000 g/);
});

test('a listing without a stated blend variant is compared separately and keeps its shipping alternatives', async () => {
  const store = await seededStore();
  const response = await worker.fetch(new Request('https://example.test/api/board?grams=250&dest=tel-aviv&variant=unspecified'), envWith(store), {});
  const board = await response.json();
  assert.equal(board.ranked.length, 1);
  assert.equal(board.best.vendor.id, 'coffee4u');
  assert.equal(board.best.product.variantLabel, 'Variant not stated');
  assert.equal(board.best.totalIls, 68, '₪38 item + ₪30 published door-to-door courier');
  assert.equal(board.best.ilsPerKg, 272);
  assert.equal(board.best.shipping.alternatives[0].amountIls, 15);
  assert.equal(board.best.shipping.pickup.available, true);
  const classico = await (await worker.fetch(new Request('https://example.test/api/board?grams=250&dest=tel-aviv&variant=classico'), envWith(store), {})).json();
  assert.equal(classico.best.vendor.id, 'coffeeman');
  assert.ok(!classico.ranked.some(quote => quote.vendor.id === 'coffee4u'));
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

test('the researched Pucks free-shipping threshold beats the CoffeeMan 4-pack at 1 kg', async () => {
  const store = await seededStore();
  const response = await worker.fetch(new Request('https://example.test/api/board?grams=1000&dest=tel-aviv'), envWith(store), {});
  const board = await response.json();
  assert.equal(board.best.vendor.id, 'pucks', 'the researched flat rate plus the ₪100 threshold wins at 1 kg');
  assert.equal(board.best.units, 4);
  assert.equal(board.best.totalIls, 120, '4 × ₪30 with free shipping above ₪100');
  const fourPack = board.ranked.find(quote => quote.product.packCount === 4);
  assert.equal(fourPack.totalIls, 149, 'the CoffeeMan 4-pack still beats four single packs once shipping is counted');
  const single = board.ranked.find(quote => quote.vendor.id === 'coffeeman' && quote.product.packCount === 1);
  assert.equal(single.totalIls, 157, '4 × ₪33 + ₪25');
  assert.ok(board.best.totalIls < fourPack.totalIls);
  assert.ok(fourPack.totalIls < single.totalIls);
});

test('unknown API paths are JSON 404s and non-GET methods are rejected', async () => {
  const env = envWith(createMemoryStore());
  const missing = await worker.fetch(new Request('https://example.test/api/nope'), env, {});
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Not found' });
  const post = await worker.fetch(new Request('https://example.test/api/board', { method: 'POST' }), env, {});
  assert.equal(post.status, 405);
});

test('board freshness reports a stopped scheduled refresh as stale', async () => {
  const store = await seededStore();
  await store.setMeta('lastRefreshAt', { value: new Date(Date.now() - 30 * 3600 * 1000).toISOString(), trigger: 'cron' });
  const stale = await (await worker.fetch(new Request('https://example.test/api/board?grams=500&dest=tel-aviv'), envWith(store), {})).json();
  assert.equal(stale.freshness.stale, true);
  assert.ok(stale.freshness.ageHours >= 29.9, `ageHours=${stale.freshness.ageHours}`);

  await store.setMeta('lastRefreshAt', { value: new Date(Date.now() - 60 * 60 * 1000).toISOString(), trigger: 'cron' });
  const fresh = await (await worker.fetch(new Request('https://example.test/api/board?grams=500&dest=tel-aviv'), envWith(store), {})).json();
  assert.equal(fresh.freshness.stale, false);
  assert.ok(fresh.freshness.ageHours <= 1.1);
});

test('board freshness falls back to the newest observation when no refresh completed', async () => {
  const store = await seededStore();
  const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  for (const row of await store.listObservations()) {
    if (row.observedAt) await store.putObservation({ ...row, observedAt: recent });
  }
  await store.setMeta('lastRefreshAt', null);
  const board = await (await worker.fetch(new Request('https://example.test/api/board?grams=500&dest=tel-aviv'), envWith(store), {})).json();
  assert.equal(board.freshness.lastRefreshAt, null, 'no completion marker is claimed');
  assert.equal(board.freshness.lastObservationAt, recent, 'the newest saved observation is reported');
  assert.equal(board.freshness.dataAsOf, recent);
  assert.equal(board.freshness.stale, false, 'an interrupted refresh with fresh saved offers is not labelled never-refreshed');
  assert.ok(board.freshness.ageHours <= 1.1, `ageHours=${board.freshness.ageHours}`);

  const old = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  for (const row of await store.listObservations()) {
    if (row.observedAt) await store.putObservation({ ...row, observedAt: old });
  }
  const stale = await (await worker.fetch(new Request('https://example.test/api/board?grams=500&dest=tel-aviv'), envWith(store), {})).json();
  assert.equal(stale.freshness.stale, true, 'old observations without a completed refresh are still stale');
  assert.ok(stale.freshness.ageHours >= 19.9, `ageHours=${stale.freshness.ageHours}`);
});

test('a lingering retired observation cannot make the tracked board look fresh', async () => {
  const store = createMemoryStore();
  const old = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await store.putObservation({ key: 'retired:oro', product: { productId: 'lavazza-qualita-oro-vacuum-ground' }, observedAt: recent, price: { amount: 1, currency: 'ILS' }, availability: 'in_stock' });
  await store.putObservation({ key: 'coffeeman:tracked', product: { productId: 'lavazza-crema-e-gusto-vacuum-ground' }, observedAt: old, price: { amount: 33, currency: 'ILS' }, availability: 'in_stock' });
  // Throttle the initial-refresh trigger so this test never starts a background fetch.
  await store.setMeta('initialRefreshAttemptAt', { value: new Date().toISOString() });
  const env = envWith(store);
  const health = await (await worker.fetch(new Request('https://example.test/health'), env, {})).json();
  assert.equal(health.lastObservationAt, old, 'the retired row is ignored for freshness');
  const status = await (await worker.fetch(new Request('https://example.test/api/status'), env, {})).json();
  assert.equal(status.freshness.lastObservationAt, old);
  assert.equal(status.freshness.stale, true, 'a fresh retired row cannot mask a stale tracked board');
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
  assert.equal(snapshot.observations.length, 5);
  assert.equal(snapshot.meta.lastRefreshAt.trigger, 'cron');
  assert.equal(snapshot.meta.fx.rates.USD.rate, 3.05);
  const run = snapshot.runs[0];
  assert.equal(run.trigger, 'cron');
  assert.equal(run.requests, 6);
});

test('the catalog lists only the tracked Crema e Gusto product and its own variants', async () => {
  const catalog = await (await worker.fetch(new Request('https://example.test/api/catalog'), envWith(createMemoryStore()), {})).json();
  assert.equal(catalog.products.length, 1, 'no retired product line is selectable');
  const crema = catalog.products[0];
  assert.equal(crema.id, 'lavazza-crema-e-gusto-vacuum-ground');
  assert.equal(crema.line, 'Crema e Gusto');
  assert.equal(crema.form, 'ground');
  assert.equal(crema.packaging, 'vacuum brick');
  assert.equal(crema.defaultVariant, 'classico');
  assert.deepEqual(crema.variants.map(item => item.id), ['classico', 'forte', 'ricco', 'risveglio', 'decaf', 'unspecified']);
  assert.ok(!/oro|rossa|suerte/i.test(JSON.stringify(catalog.products)), 'no retired line appears in the catalog');
});

test('an old product URL for a retired line falls back to Crema e Gusto and says so', async () => {
  const store = await seededStore();
  const board = await (await worker.fetch(new Request('https://example.test/api/board?product=lavazza-qualita-oro-vacuum-ground&grams=500&dest=tel-aviv'), envWith(store), {})).json();
  assert.equal(board.product.id, 'lavazza-crema-e-gusto-vacuum-ground', 'the retired line is never displayed or compared');
  assert.deepEqual(board.requestedRetiredProduct, { id: 'lavazza-qualita-oro-vacuum-ground', line: 'Qualità Oro' });
  assert.equal(board.counts.observed, 4, 'only Crema e Gusto Classico offers are compared; the unstated-variant listing is excluded, not merged');
  const offers = [...board.ranked, ...board.unknown, ...board.pickup, ...board.unrankable, ...board.staleOrUnavailable];
  assert.ok(offers.length > 0, 'the fallback board still renders its own offers');
  assert.ok(offers.every(quote => quote.product.productId === 'lavazza-crema-e-gusto-vacuum-ground'), 'no retired observation is mixed into the comparison');

  // A Suerte URL behaves the same way, and the Crema e Gusto ranking still works.
  const suerte = await (await worker.fetch(new Request('https://example.test/api/board?product=lavazza-suerte-ground&grams=500&dest=tel-aviv'), envWith(store), {})).json();
  assert.equal(suerte.product.id, 'lavazza-crema-e-gusto-vacuum-ground');
  assert.equal(suerte.requestedRetiredProduct.line, 'Suerte');
  assert.equal(suerte.best.totalIls, 90, 'the Crema e Gusto board still ranks normally with the researched Pucks rate');

  // A normal request reports no retired product.
  const plain = await (await worker.fetch(new Request('https://example.test/api/board?product=lavazza-crema-e-gusto-vacuum-ground&grams=500&dest=tel-aviv'), envWith(store), {})).json();
  assert.equal(plain.requestedRetiredProduct, null);
});

test('an unknown variant id falls back to the product default instead of an empty board', async () => {
  const store = await seededStore();
  const fallback = await (await worker.fetch(new Request('https://example.test/api/board?grams=500&dest=tel-aviv&variant=nope'), envWith(store), {})).json();
  assert.equal(fallback.variantId, 'classico', 'a typo falls back to the default variant');
  assert.ok(fallback.ranked.length > 0, 'the default variant is still ranked');
  const defaultBoard = await (await worker.fetch(new Request('https://example.test/api/board?grams=500&dest=tel-aviv'), envWith(store), {})).json();
  assert.deepEqual(fallback.ranked.map(quote => quote.key), defaultBoard.ranked.map(quote => quote.key));
  const prototype = await (await worker.fetch(new Request('https://example.test/api/board?grams=500&dest=tel-aviv&variant=constructor'), envWith(store), {})).json();
  assert.equal(prototype.variantId, 'classico', 'object prototype keys are never treated as variant ids');
  // A variant id that belongs to no tracked variant is still a fallback, not an error.
  const unknownVariant = await (await worker.fetch(new Request('https://example.test/api/board?grams=500&dest=tel-aviv&variant=taglio-macina'), envWith(store), {})).json();
  assert.equal(unknownVariant.variantId, 'classico');
  assert.ok(unknownVariant.ranked.length > 0);
});

test('board without a storage binding explains the deployment requirement', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/board'), { ASSETS: { fetch: async () => new Response('x') } }, {});
  const body = await response.json();
  assert.match(body.message, /BOARD Durable Object binding/);
  assert.deepEqual(body.offers, []);
});
