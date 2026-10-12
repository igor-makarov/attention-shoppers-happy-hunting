import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runRefresh, maybeInitialRefresh, backoffMs, refreshFreshness, REFRESH_INTERVAL_MS, REFRESH_STALE_MS, BACKOFF_BASE_MS } from '../src/refresh.js';
import { createMemoryStore } from '../src/store.js';
import { registeredVendors } from '../src/vendors/index.js';
import { readFixtureForUrl } from './fixtures/vendor-fixtures.mjs';

const fixtures = new URL('./fixtures/', import.meta.url);
const coffeemanOosBytes = readFileSync(new URL('coffeeman-product.outofstock.windows-1255.html', fixtures));
const coffee4uOosBytes = readFileSync(new URL('coffee4u-product.outofstock.windows-1255.html', fixtures));

const BOI = {
  exchangeRates: [
    { key: 'USD', currentExchangeRate: 3.05, unit: 1, lastUpdate: '2026-10-09T09:21:04.476265Z' },
    { key: 'EUR', currentExchangeRate: 3.55, unit: 1, lastUpdate: '2026-10-09T09:21:04.476265Z' }
  ]
};

function fixtureFetch({ overrides = {}, failCoffeeman = false, failFx = false, calls = [] } = {}) {
  return async url => {
    calls.push(String(url));
    if (String(url).includes("boi.org.il")) {
      return failFx ? new Response("fx down", { status: 500 }) : Response.json(BOI);
    }
    if (failCoffeeman && String(url).includes("coffeeman.co.il")) {
      return new Response("vendor down", { status: 503 });
    }
    const hit = await readFixtureForUrl(url);
    if (!hit) return new Response("unexpected", { status: 404 });
    const override = overrides[`${hit.offer.vendorId}:${hit.offer.offerId}`];
    const body = override ?? hit.bytes;
    return new Response(body, { status: 200, headers: { "content-type": hit.contentType } });
  };
}

// Pacing waits are injected away: the crawl-delay timing itself is covered by the
// dedicated pacing test below, so the suite never really sleeps.
const run = options => runRefresh({ sleep: async () => {}, ...options });

const NOW = Date.parse('2026-10-12T12:00:00.000Z');

test('scheduled refresh persists observations without a browser', async () => {
  const store = createMemoryStore();
  const calls = [];
  const summary = await run({ store, fetchImpl: fixtureFetch({ calls }), now: NOW, trigger: 'cron' });
  assert.equal(summary.trigger, 'cron');
  assert.equal(summary.vendors.length, 3);
  assert.equal(summary.requests, 13, 'seven CoffeeMan listings, four Pucks listings, Coffee4U and one FX request');
  const snapshot = await store.snapshot();
  assert.equal(snapshot.observations.length, 12);
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
  await run({ store, fetchImpl: fixtureFetch(), now: NOW });
  const before = (await store.snapshot()).observations.find(o => o.vendor.id === 'coffeeman');
  assert.equal(before.price.amount, 33);

  const second = await run({
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
  assert.equal(attempts[0].vendors.find(v => v.vendorId === 'coffeeman').failures.length, 7, 'all seven CoffeeMan listings report the failure');
});

test('repeated failures back off and stop re-fetching the broken vendor', async () => {
  const store = createMemoryStore();
  const first = await run({ store, fetchImpl: fixtureFetch({ failCoffeeman: true }), now: NOW });
  assert.equal(first.vendors.find(v => v.vendorId === 'coffeeman').ok, false);
  const state = await store.getVendorState('coffeeman');
  assert.equal(state.consecutiveFailures, 1);
  assert.equal(Date.parse(state.nextAttemptAt), NOW + BACKOFF_BASE_MS);

  const calls = [];
  const second = await run({ store, fetchImpl: fixtureFetch({ failCoffeeman: true, calls }), now: NOW + 5 * 60 * 1000 });
  assert.equal(second.vendors.find(v => v.vendorId === 'coffeeman').skipped, true);
  assert.equal(calls.some(url => url.includes('coffeeman')), false, 'vendor in backoff is not fetched');
  assert.equal(backoffMs(2), 60 * 60 * 1000);
  assert.equal(backoffMs(10), 12 * 60 * 60 * 1000);
});

test('a failing FX fetch keeps the previous rate table', async () => {
  const store = createMemoryStore();
  await run({ store, fetchImpl: fixtureFetch(), now: NOW });
  const fx = (await store.snapshot()).meta.fx;
  assert.equal(fx.rates.USD.rate, 3.05);
  await run({ store, fetchImpl: fixtureFetch({ failFx: true }), now: NOW + REFRESH_INTERVAL_MS });
  const after = (await store.snapshot()).meta.fx;
  assert.equal(after.rates.USD.rate, 3.05, 'previous rates preserved when the feed fails');
  assert.equal(after.asOf, fx.asOf);
});

test('out-of-stock observation replaces the price but never claims availability', async () => {
  const store = createMemoryStore();
  await run({ store, fetchImpl: fixtureFetch(), now: NOW });
  const summary = await run({
    store,
    fetchImpl: fixtureFetch({ overrides: { 'coffeeman:classico-250g': coffeemanOosBytes } }),
    now: NOW + REFRESH_INTERVAL_MS
  });
  assert.equal(summary.vendors.find(v => v.vendorId === 'coffeeman').ok, true);
  const observation = (await store.snapshot()).observations.find(o => o.vendor.id === 'coffeeman');
  assert.equal(observation.availability, 'out_of_stock');
});

test('Coffee4U is persisted with its published courier rate and an unstated blend variant', async () => {
  const store = createMemoryStore();
  await run({ store, fetchImpl: fixtureFetch(), now: NOW });
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
  await run({
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
  const first = run({ store, fetchImpl: slowFetch, now: NOW });
  await new Promise(resolve => setTimeout(resolve, 2));
  const second = await run({ store, fetchImpl: fixtureFetch(), now: NOW });
  assert.equal(second.skipped, true);
  await first;
});

test('refresh runs started in the same tick cannot both acquire the lease', async () => {
  const store = createMemoryStore();
  const calls = [];
  const [first, second] = await Promise.all([
    run({ store, fetchImpl: fixtureFetch({ calls }), now: NOW }),
    run({ store, fetchImpl: fixtureFetch({ calls }), now: NOW })
  ]);
  const summaries = [first, second];
  assert.equal(summaries.filter(summary => summary.skipped).length, 1, 'exactly one run is skipped');
  assert.equal(summaries.find(summary => !summary.skipped).requests, 13);
  assert.equal(calls.length, 13, 'the losing run performs no vendor or FX requests');
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
  await run({
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

test('board freshness turns stale when the scheduled refresh stops completing', () => {
  const fresh = refreshFreshness('2026-10-12T11:00:00.000Z', Date.parse('2026-10-12T12:00:00.000Z'));
  assert.equal(fresh.stale, false);
  assert.equal(fresh.lastRefreshAt, '2026-10-12T11:00:00.000Z');
  assert.equal(fresh.ageHours, 1);

  const justInside = refreshFreshness('2026-10-12T04:00:00.000Z', Date.parse('2026-10-12T12:00:00.000Z'));
  assert.equal(justInside.stale, false, 'eight hours is the stated threshold');
  const stale = refreshFreshness('2026-10-12T03:59:00.000Z', Date.parse('2026-10-12T12:00:00.000Z'));
  assert.equal(stale.stale, true);
  assert.equal(REFRESH_STALE_MS, 8 * 60 * 60 * 1000);
  const never = refreshFreshness(null, Date.parse('2026-10-12T12:00:00.000Z'));
  assert.equal(never.stale, true, 'a board that never refreshed is stale, not silently fresh');
  assert.equal(never.ageHours, null);
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

test('a vendor crawl delay spaces requests to the same host instead of firing them back to back', async () => {
  const store = createMemoryStore();
  const waits = [];
  let clock = 1_000_000;
  const calls = [];
  const summary = await run({
    store,
    now: NOW,
    // A delay large enough that every offer after the first has to wait.
    vendors: [{
      id: 'paced',
      name: 'Paced vendor',
      homepage: 'https://paced.test',
      allowedHosts: ['paced.test'],
      parserVersion: 'paced/1',
      crawlDelayMs: 7000,
      offers: [
        { id: 'a', url: 'https://paced.test/a', productId: null },
        { id: 'b', url: 'https://paced.test/b', productId: null },
        { id: 'c', url: 'https://paced.test/c', productId: null }
      ],
      async observe({ fetchText }) {
        for (const offer of this.offers) {
          await fetchText(offer.url);
        }
        return { observations: [], failures: [] };
      }
    }],
    includeFx: false,
    sleep: async ms => { waits.push(ms); clock += ms; },
    clock: () => clock,
    fetchImpl: async url => {
      calls.push(String(url));
      clock += 250; // simulate a fast response
      return new Response('ok');
    }
  });
  assert.equal(summary.vendors[0].ok, false, 'no observations means the vendor is not reported as successful');
  assert.deepEqual(calls, ['https://paced.test/a', 'https://paced.test/b', 'https://paced.test/c']);
  assert.equal(waits.length, 2, 'the second and third request wait for the crawl delay');
  for (const waited of waits) assert.equal(waited, 6750, 'the wait covers the published delay');

  // Without a declared delay nothing is postponed.
  const noWait = [];
  await run({
    store: createMemoryStore(),
    now: NOW,
    vendors: [{
      id: 'unpaced',
      name: 'Unpaced vendor',
      homepage: 'https://unpaced.test',
      allowedHosts: ['unpaced.test'],
      parserVersion: 'unpaced/1',
      offers: [{ id: 'a', url: 'https://unpaced.test/a', productId: null }],
      async observe({ fetchText }) {
        await fetchText('https://unpaced.test/a');
        return { observations: [], failures: [] };
      }
    }],
    includeFx: false,
    sleep: async ms => { noWait.push(ms); },
    clock: () => 5_000_000,
    fetchImpl: async () => new Response('ok')
  });
  assert.deepEqual(noWait, [], 'a vendor that publishes no crawl delay is not paced');
});

test('the second tracked product is observed and kept out of the first product\'s board data', async () => {
  const store = createMemoryStore();
  await run({ store, fetchImpl: fixtureFetch(), now: NOW });
  const snapshot = await store.snapshot();
  const oro = snapshot.observations.filter(o => o.product.productId === 'lavazza-qualita-oro-vacuum-ground');
  assert.equal(oro.length, 4, 'three CoffeeMan Qualità Oro listings plus one Pucks listing');
  assert.deepEqual([...new Set(oro.map(o => o.vendor.id))].sort(), ['coffeeman', 'pucks'], 'two independent vendors carry the second product');
  const fourPack = oro.find(o => o.vendor.id === 'coffeeman' && o.product.packCount === 4);
  assert.equal(fourPack.price.amount, 125);
  assert.equal(fourPack.product.totalGrams, 1000);
  assert.equal(fourPack.shipping.certainty, 'verified');
  assert.equal(fourPack.shipping.amount.amount, 25);
  assert.deepEqual([...new Set(oro.map(o => o.product.variantId))], ['unspecified'], 'Qualità Oro publishes no blend variant');
  assert.equal(snapshot.observations.filter(o => o.product.productId === 'lavazza-crema-e-gusto-vacuum-ground').length, 5);
});

test('the third tracked product is observed from two vendors with honest stock and stays out of the other boards', async () => {
  const store = createMemoryStore();
  await run({ store, fetchImpl: fixtureFetch(), now: NOW });
  const snapshot = await store.snapshot();
  const rossa = snapshot.observations.filter(o => o.product.productId === 'lavazza-qualita-rossa-vacuum-ground');
  assert.equal(rossa.length, 3, 'one CoffeeMan listing plus two Pucks listings');
  assert.deepEqual([...new Set(rossa.map(o => o.vendor.id))].sort(), ['coffeeman', 'pucks'], 'two independent vendors carry the third product');

  const coffeeman = rossa.find(o => o.vendor.id === 'coffeeman');
  assert.equal(coffeeman.product.sku, '930336');
  assert.equal(coffeeman.product.packGrams, 250);
  assert.equal(coffeeman.product.variantId, 'unspecified', 'the page states no blend variant');
  assert.equal(coffeeman.price.amount, 33);
  assert.equal(coffeeman.price.currency, 'ILS');
  assert.equal(coffeeman.availability, 'in_stock');
  assert.equal(coffeeman.shipping.certainty, 'verified');
  assert.equal(coffeeman.shipping.amount.amount, 25);

  const inStock = rossa.find(o => o.vendor.id === 'pucks' && o.product.sku === 'Lav80');
  assert.equal(inStock.price.amount, 30);
  assert.equal(inStock.availability, 'in_stock');
  assert.equal(inStock.shipping.certainty, 'unknown');

  const outOfStock = rossa.find(o => o.vendor.id === 'pucks' && o.product.sku === 'Lav35');
  assert.equal(outOfStock.price.amount, 35, 'a price is still observed for an out-of-stock listing');
  assert.equal(outOfStock.availability, 'out_of_stock', 'the page is observed as out of stock, not assumed available');
  assert.equal(snapshot.observations.filter(o => o.product.productId === 'lavazza-qualita-oro-vacuum-ground').length, 4);
});
