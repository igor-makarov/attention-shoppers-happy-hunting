import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runRefresh, maybeInitialRefresh, backoffMs, REFRESH_INTERVAL_MS, BACKOFF_BASE_MS } from '../src/refresh.js';
import { createMemoryStore } from '../src/store.js';
import { registeredVendors } from '../src/vendors/index.js';

const fixtures = new URL('./fixtures/', import.meta.url);
const coffeemanBytes = readFileSync(new URL('coffeeman-product.windows-1255.html', fixtures));
const coffeeman4Bytes = readFileSync(new URL('coffeeman-4pack-product.windows-1255.html', fixtures));
const coffeeman8Bytes = readFileSync(new URL('coffeeman-8pack-product.windows-1255.html', fixtures));
const coffeemanOosBytes = readFileSync(new URL('coffeeman-product.outofstock.windows-1255.html', fixtures));
const pucksHtml = readFileSync(new URL('pucks-product.html', fixtures), 'utf8');
const coffee4uBytes = readFileSync(new URL('coffee4u-product.windows-1255.html', fixtures));
const coffee4uOosBytes = readFileSync(new URL('coffee4u-product.outofstock.windows-1255.html', fixtures));

const BOI = {
  exchangeRates: [
    { key: 'USD', currentExchangeRate: 3.05, unit: 1, lastUpdate: '2026-10-09T09:21:04.476265Z' },
    { key: 'EUR', currentExchangeRate: 3.55, unit: 1, lastUpdate: '2026-10-09T09:21:04.476265Z' }
  ]
};

function fixtureFetch({ coffeeman = coffeemanBytes, fourPack = coffeeman4Bytes, eightPack = coffeeman8Bytes, failCoffeeman = false, failFx = false, calls = [] } = {}) {
  return async url => {
    calls.push(url);
    if (url.includes('coffeeman.co.il')) {
      if (failCoffeeman) return new Response('vendor down', { status: 503 });
      const bytes = url.includes('4-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA') ? fourPack
        : url.includes('8-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA') ? eightPack
        : coffeeman;
      return new Response(bytes, { status: 200, headers: { 'content-type': 'text/html; charset=windows-1255' } });
    }
    if (url.includes('pucks.co.il')) {
      return new Response(pucksHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('coffee4u.co.il')) {
      return new Response(coffee4uBytes, { status: 200, headers: { 'content-type': 'text/html; charset=windows-1255' } });
    }
    if (url.includes('boi.org.il')) {
      if (failFx) return new Response('fx down', { status: 500 });
      return Response.json(BOI);
    }
    return new Response('unexpected', { status: 404 });
  };
}

const NOW = Date.parse('2026-10-12T12:00:00.000Z');

test('scheduled refresh persists observations without a browser', async () => {
  const store = createMemoryStore();
  const calls = [];
  const summary = await runRefresh({ store, fetchImpl: fixtureFetch({ calls }), now: NOW, trigger: 'cron' });
  assert.equal(summary.trigger, 'cron');
  assert.equal(summary.vendors.length, 3);
  assert.equal(summary.requests, 6, 'three CoffeeMan listings plus Pucks, Coffee4U and one FX request');
  const snapshot = await store.snapshot();
  assert.equal(snapshot.observations.length, 5);
  const coffeeman = snapshot.observations.find(o => o.vendor.id === 'coffeeman');
  assert.equal(coffeeman.price.amount, 33);
  assert.equal(coffeeman.attemptedAt, new Date(NOW).toISOString());
  assert.equal(snapshot.meta.fx.rates.USD.rate, 3.05);
  assert.equal(snapshot.meta.fx.asOf, '2026-10-09T09:21:04.476265Z');
  assert.ok(snapshot.meta.lastRefreshAt.value);
  const vendorState = await store.getVendorState('pucks');
  assert.equal(vendorState.consecutiveFailures, 0);
  assert.equal(Date.parse(vendorState.nextAttemptAt), NOW + REFRESH_INTERVAL_MS);
});

test('one failing vendor keeps its previous good observation and does not block the other', async () => {
  const store = createMemoryStore();
  await runRefresh({ store, fetchImpl: fixtureFetch(), now: NOW });
  const before = (await store.snapshot()).observations.find(o => o.vendor.id === 'coffeeman');
  assert.equal(before.price.amount, 33);

  const second = await runRefresh({
    store,
    fetchImpl: fixtureFetch({ failCoffeeman: true }),
    now: NOW + REFRESH_INTERVAL_MS + 1000
  });
  const coffeemanResult = second.vendors.find(v => v.vendorId === 'coffeeman');
  assert.equal(coffeemanResult.ok, false);
  const pucksResult = second.vendors.find(v => v.vendorId === 'pucks');
  assert.equal(pucksResult.ok, true);

  const snapshot = await store.snapshot();
  const kept = snapshot.observations.find(o => o.vendor.id === 'coffeeman');
  assert.equal(kept.price.amount, 33, 'previous good price is preserved');
  assert.equal(kept.observedAt, before.observedAt, 'last successful observation timestamp is unchanged');
  assert.ok(kept.attemptedAt, 'failed attempt timestamp is recorded');
  const attempts = await store.listRuns(5);
  assert.equal(attempts[0].vendors.find(v => v.vendorId === 'coffeeman').failures.length, 3, 'all three CoffeeMan listings report the failure');
});

test('repeated failures back off and stop re-fetching the broken vendor', async () => {
  const store = createMemoryStore();
  const first = await runRefresh({ store, fetchImpl: fixtureFetch({ failCoffeeman: true }), now: NOW });
  assert.equal(first.vendors.find(v => v.vendorId === 'coffeeman').ok, false);
  const state = await store.getVendorState('coffeeman');
  assert.equal(state.consecutiveFailures, 1);
  assert.equal(Date.parse(state.nextAttemptAt), NOW + BACKOFF_BASE_MS);

  const calls = [];
  const second = await runRefresh({ store, fetchImpl: fixtureFetch({ failCoffeeman: true, calls }), now: NOW + 5 * 60 * 1000 });
  assert.equal(second.vendors.find(v => v.vendorId === 'coffeeman').skipped, true);
  assert.equal(calls.some(url => url.includes('coffeeman')), false, 'vendor in backoff is not fetched');
  assert.equal(backoffMs(2), 60 * 60 * 1000);
  assert.equal(backoffMs(10), 12 * 60 * 60 * 1000);
});

test('a failing FX fetch keeps the previous rate table', async () => {
  const store = createMemoryStore();
  await runRefresh({ store, fetchImpl: fixtureFetch(), now: NOW });
  const fx = (await store.snapshot()).meta.fx;
  assert.equal(fx.rates.USD.rate, 3.05);
  await runRefresh({ store, fetchImpl: fixtureFetch({ failFx: true }), now: NOW + REFRESH_INTERVAL_MS });
  const after = (await store.snapshot()).meta.fx;
  assert.equal(after.rates.USD.rate, 3.05, 'previous rates preserved when the feed fails');
  assert.equal(after.asOf, fx.asOf);
});

test('out-of-stock observation replaces the price but never claims availability', async () => {
  const store = createMemoryStore();
  await runRefresh({ store, fetchImpl: fixtureFetch(), now: NOW });
  const summary = await runRefresh({
    store,
    fetchImpl: fixtureFetch({ coffeeman: coffeemanOosBytes }),
    now: NOW + REFRESH_INTERVAL_MS
  });
  assert.equal(summary.vendors.find(v => v.vendorId === 'coffeeman').ok, true);
  const observation = (await store.snapshot()).observations.find(o => o.vendor.id === 'coffeeman');
  assert.equal(observation.availability, 'out_of_stock');
});

test('Coffee4U is persisted with its published courier rate and an unstated blend variant', async () => {
  const store = createMemoryStore();
  await runRefresh({ store, fetchImpl: fixtureFetch(), now: NOW });
  const observation = (await store.snapshot()).observations.find(o => o.vendor.id === 'coffee4u');
  assert.ok(observation, 'the third vendor is persisted');
  assert.equal(observation.product.productId, 'lavazza-crema-e-gusto-vacuum-ground');
  assert.equal(observation.product.form, 'ground');
  assert.equal(observation.product.variantId, 'unspecified', 'the vendor does not state the blend variant');
  assert.equal(observation.product.packGrams, 250);
  assert.equal(observation.product.sku, '2010561');
  assert.equal(observation.price.amount, 38);
  assert.equal(observation.availability, 'in_stock');
  assert.equal(observation.shipping.certainty, 'verified');
  assert.equal(observation.shipping.amount.amount, 30);
  assert.equal(observation.shipping.alternatives[0].amount.amount, 15, 'the cheaper pickup-point delivery stays an alternative, not the ranked rate');
  assert.equal(observation.shipping.pickup.available, true);
  assert.equal(observation.attemptedAt, new Date(NOW).toISOString());
});

test('an out-of-stock Coffee4U page stays visible and unranked', async () => {
  const store = createMemoryStore();
  await runRefresh({
    store,
    fetchImpl: async url => url.includes('coffee4u.co.il')
      ? new Response(coffee4uOosBytes, { status: 200, headers: { 'content-type': 'text/html; charset=windows-1255' } })
      : fixtureFetch()(url),
    now: NOW
  });
  const observation = (await store.snapshot()).observations.find(o => o.vendor.id === 'coffee4u');
  assert.equal(observation.availability, 'out_of_stock');
});

test('leases prevent concurrent refresh runs', async () => {
  const store = createMemoryStore();
  const gate = new Promise(resolve => setTimeout(resolve, 15));
  const slowFetch = async url => {
    await gate;
    return fixtureFetch()(url);
  };
  const first = runRefresh({ store, fetchImpl: slowFetch, now: NOW });
  await new Promise(resolve => setTimeout(resolve, 2));
  const second = await runRefresh({ store, fetchImpl: fixtureFetch(), now: NOW });
  assert.equal(second.skipped, true);
  await first;
});

test('refresh runs started in the same tick cannot both acquire the lease', async () => {
  const store = createMemoryStore();
  const calls = [];
  const [first, second] = await Promise.all([
    runRefresh({ store, fetchImpl: fixtureFetch({ calls }), now: NOW }),
    runRefresh({ store, fetchImpl: fixtureFetch({ calls }), now: NOW })
  ]);
  const summaries = [first, second];
  assert.equal(summaries.filter(summary => summary.skipped).length, 1, 'exactly one run is skipped');
  assert.equal(summaries.find(summary => !summary.skipped).requests, 6);
  assert.equal(calls.length, 6, 'the losing run performs no vendor or FX requests');
});

test('initial refresh runs once and is throttled afterwards', async () => {
  const store = createMemoryStore();
  const started = await maybeInitialRefresh({ store, ctx: null, now: NOW, run: async () => ({ ran: true }), vendors: [], includeFx: false });
  assert.equal(started.started, true);
  const triggered = await maybeInitialRefresh({ store, ctx: null, now: NOW + 1000 });
  assert.equal(triggered.skipped, true);
  const waited = await maybeInitialRefresh({ store, ctx: null, now: NOW + 20 * 60 * 1000, run: async () => ({ ran: true }), vendors: [], includeFx: false });
  assert.equal(waited.started, true);
});

test('allowlist blocks requests to hosts outside the vendor registry', async () => {
  const store = createMemoryStore();
  const calls = [];
  const hostileFetch = async url => {
    calls.push(url);
    return new Response('ok');
  };
  await runRefresh({
    store,
    vendors: [{
      id: 'fake',
      name: 'Fake',
      homepage: 'https://fake.test',
      allowedHosts: ['allowed.test'],
      parserVersion: 'fake/1',
      offers: [{ id: 'x', url: 'https://allowed.test/p' }],
      async observe({ fetchText }) {
        const denied = await fetchText('https://evil.test/p');
        assert.equal(denied.ok, false);
        assert.match(denied.error, /not allowed/);
        return { observations: [], failures: [{ offerId: 'x', error: 'no data' }] };
      }
    }],
    fetchImpl: hostileFetch,
    now: NOW
  });
  assert.deepEqual(calls.filter(url => url.includes('evil.test')), [], 'no network request is made for a non-allowlisted host');
  assert.deepEqual(calls, ['https://www.boi.org.il/currency.xml'], 'only the allowlisted FX host is contacted');
});

test('registered vendors are within their own allowlists', async () => {
  for (const vendor of registeredVendors()) {
    for (const offer of vendor.offers) {
      const host = new URL(offer.url).hostname;
      assert.ok(vendor.allowedHosts.includes(host), `${vendor.id} allowlists ${host}`);
    }
    assert.ok(vendor.parserVersion, `${vendor.id} has a parser version`);
  }
});
