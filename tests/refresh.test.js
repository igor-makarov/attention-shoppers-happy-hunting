import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runRefresh, maybeInitialRefresh, backoffMs, refreshFreshness, newestObservationAt, isVendorDue, REFRESH_INTERVAL_MS, REFRESH_STALE_MS, BACKOFF_BASE_MS, EARLY_DUE_TOLERANCE_MS } from '../src/refresh.js';
import { quoteBoard, findDestination } from '../src/lib/quote.js';
import { createMemoryStore } from '../src/store.js';
import { registeredVendors } from '../src/vendors/index.js';
import { readFixtureForUrl, createFixtureFetch, trackedOffers } from './fixtures/vendor-fixtures.mjs';

const fixtures = new URL('./fixtures/', import.meta.url);
const coffeemanOosBytes = readFileSync(new URL('coffeeman-product.outofstock.windows-1255.html', fixtures));
const coffee4uOosBytes = readFileSync(new URL('coffee4u-product.outofstock.windows-1255.html', fixtures));

const BOI = {
  exchangeRates: [
    { key: 'USD', currentExchangeRate: 3.05, unit: 1, lastUpdate: '2026-10-09T09:21:04.476265Z' },
    { key: 'EUR', currentExchangeRate: 3.55, unit: 1, lastUpdate: '2026-10-09T09:21:04.476265Z' }
  ]
};

function fixtureFetch({ overrides = {}, failCoffeeman = false, failVendors = [], failFx = false, calls = [] } = {}) {
  return async url => {
    calls.push(String(url));
    if (String(url).includes("boi.org.il")) {
      return failFx ? new Response("fx down", { status: 500 }) : Response.json(BOI);
    }
    if (failCoffeeman && String(url).includes("coffeeman.co.il")) {
      return new Response("vendor down", { status: 503 });
    }
    if (failVendors.some(vendor => String(url).includes(`${vendor}.co.il`))) {
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
  assert.equal(summary.requests, 6, 'three CoffeeMan listings, one Pucks listing, Coffee4U and one FX request');
  const snapshot = await store.snapshot();
  assert.equal(snapshot.observations.length, 5, 'only the tracked Crema e Gusto offers are observed');
  assert.deepEqual(
    [...new Set(snapshot.observations.map(o => o.product.productId))],
    ['lavazza-crema-e-gusto-vacuum-ground'],
    'no retired product line is observed any more'
  );
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
  assert.equal(attempts[0].vendors.find(v => v.vendorId === 'coffeeman').failures.length, 3, 'all three CoffeeMan listings report the failure');
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

test('a successful vendor counts as due a little before its stored due time', () => {
  const due = new Date(NOW + REFRESH_INTERVAL_MS).toISOString();
  const state = { nextAttemptAt: due, consecutiveFailures: 0 };
  assert.equal(isVendorDue(state, NOW + REFRESH_INTERVAL_MS - EARLY_DUE_TOLERANCE_MS), true);
  assert.equal(isVendorDue(state, NOW + REFRESH_INTERVAL_MS - 60 * 1000), true, 'a tick seconds before the due time is still due');
  assert.equal(isVendorDue(state, NOW + REFRESH_INTERVAL_MS - 30 * 60 * 1000), false, 'a vendor is not fetched hours early');
  assert.equal(isVendorDue(null, NOW), true, 'a vendor without state is always due');
  assert.equal(isVendorDue({ nextAttemptAt: 'not-a-date' }, NOW), true);
  assert.equal(
    isVendorDue({ nextAttemptAt: due, consecutiveFailures: 1 }, NOW + REFRESH_INTERVAL_MS - 60 * 1000),
    false,
    'failure backoff keeps its strict due time'
  );
  assert.equal(
    isVendorDue({ nextAttemptAt: due, consecutiveFailures: 1 }, NOW + REFRESH_INTERVAL_MS),
    true
  );
});

test('a cron tick just before the six-hour mark refreshes instead of skipping every vendor', async () => {
  const store = createMemoryStore();
  const first = await run({ store, fetchImpl: fixtureFetch(), now: NOW, trigger: 'cron' });
  assert.equal(first.requests, 6);
  const refreshAt = (await store.snapshot()).meta.lastRefreshAt.value;
  for (const vendorId of ['coffeeman', 'pucks', 'coffee4u']) {
    assert.equal(Date.parse((await store.getVendorState(vendorId)).nextAttemptAt), NOW + REFRESH_INTERVAL_MS);
  }

  // The next cron tick lands 30 seconds before the stored due times. This is the
  // production phase: cron fires on fixed clock times, the due time is run time + 6 h.
  const calls = [];
  const tick = await run({
    store,
    fetchImpl: fixtureFetch({ calls }),
    now: NOW + REFRESH_INTERVAL_MS - 30 * 1000,
    trigger: 'cron'
  });
  assert.equal(tick.vendors.filter(vendor => vendor.skipped).length, 0, 'no vendor is skipped by cron phase drift');
  assert.equal(tick.requests, 6, 'all five tracked offers and the rate table are re-checked');
  assert.equal(tick.vendors.filter(vendor => (vendor.saved ?? 0) > 0).length, 3, 'every vendor saved an observation on the tick');
  const after = (await store.snapshot()).meta.lastRefreshAt.value;
  assert.ok(after, 'the completed tick advances lastRefreshAt, so the board stays fresh');
  assert.ok(Date.parse(after) >= Date.parse(refreshAt), 'lastRefreshAt never moves backwards');
});

test('the production cron sequence keeps a six-hour cadence and recovers from the off-phase start', async () => {
  const store = createMemoryStore();
  const fetchImpl = fixtureFetch();
  let simMs = Date.parse('2026-10-12T15:52:12.000Z');
  // The completion marker is written from the same simulated timeline as `now`,
  // so the freshness checks below describe the simulated production sequence
  // instead of mixing in the real wall clock.
  const timeSource = () => simMs;
  const tick = async startIso => {
    simMs = Date.parse(startIso);
    const summary = await run({ store, fetchImpl, now: simMs, trigger: 'cron', timeSource, clock: () => simMs });
    const snapshot = await store.snapshot();
    const lastRefreshAt = snapshot.meta?.lastRefreshAt?.value ?? null;
    return {
      startIso,
      requests: summary.requests,
      saved: summary.vendors.filter(vendor => (vendor.saved ?? 0) > 0).length,
      skipped: summary.vendors.filter(vendor => vendor.skipped).length,
      lastRefreshAt,
      freshness: refreshFreshness(lastRefreshAt, simMs)
    };
  };

  // The post-deployment initial refresh completed off-phase at 15:52:12 and left
  // every vendor due at 21:52:12.
  const initial = await run({ store, fetchImpl, now: simMs, trigger: 'initial', timeSource, clock: () => simMs });
  assert.equal(initial.requests, 6);
  assert.equal((await store.snapshot()).meta.lastRefreshAt.value, '2026-10-12T15:52:12.000Z');

  // 18:17 UTC tick: every vendor is still inside its window, so the run is
  // recorded with no fetches and must not advance lastRefreshAt.
  const offPhase = await tick('2026-10-12T18:17:20.000Z');
  assert.equal(offPhase.requests, 0, 'an off-phase tick makes no vendor request');
  assert.equal(offPhase.saved, 0);
  assert.equal(offPhase.skipped, 3);
  assert.equal(offPhase.lastRefreshAt, '2026-10-12T15:52:12.000Z');
  assert.equal(offPhase.freshness.stale, false, 'the board stays fresh through the off-phase tick');

  // 00:17 UTC: the stored due times have passed, so every vendor refreshes. Just
  // before that run the off-phase data is more than eight hours old, which the
  // board honestly reports as stale; the tick then replaces it.
  simMs = Date.parse('2026-10-13T00:17:20.000Z');
  const beforeDue = refreshFreshness((await store.snapshot()).meta.lastRefreshAt.value, simMs);
  assert.equal(beforeDue.stale, true, 'off-phase data past the eight-hour threshold reads as stale, not silently fresh');
  assert.ok(beforeDue.ageHours > 8 && beforeDue.ageHours < 9);
  const firstOnPhase = await tick('2026-10-13T00:17:20.000Z');
  assert.equal(firstOnPhase.requests, 6);
  assert.equal(firstOnPhase.saved, 3, 'the due tick refreshes every vendor');
  assert.equal(firstOnPhase.skipped, 0);
  assert.equal(firstOnPhase.freshness.stale, false);

  // From here the ticks land seconds before the stored due times (production
  // run-start jitter), so the early-due tolerance is what keeps the cadence at
  // six hours instead of skipping to a twelve-hour drift.
  const ticks = [
    await tick('2026-10-13T06:17:05.000Z'),
    await tick('2026-10-13T12:17:20.000Z'),
    await tick('2026-10-13T18:17:20.000Z'),
    await tick('2026-10-14T00:17:20.000Z')
  ];
  for (const entry of ticks) {
    assert.equal(entry.skipped, 0, `${entry.startIso} refreshes instead of skipping every vendor`);
    assert.equal(entry.requests, 6, `${entry.startIso} re-checks the five tracked offers and the rate table`);
    assert.equal(entry.saved, 3, `${entry.startIso} saves an observation for every vendor`);
    assert.equal(entry.freshness.stale, false, `${entry.startIso} keeps the board fresh`);
  }

  const completions = [firstOnPhase, ...ticks].map(entry => Date.parse(entry.lastRefreshAt));
  for (let index = 1; index < completions.length; index += 1) {
    const gap = completions[index] - completions[index - 1];
    assert.ok(
      Math.abs(gap - REFRESH_INTERVAL_MS) <= 60 * 1000,
      `completed refreshes stay six hours apart (gap ${Math.round(gap / 60000)} min)`
    );
    assert.ok(gap < REFRESH_STALE_MS, 'no completion gap reaches the stale threshold');
  }

  // The skipped tick is still visible in the run history so the pipeline can be
  // audited, and the runs that did save observations are the only ones that
  // advanced the marker.
  const runs = await store.listRuns(10);
  assert.equal(runs.filter(runEntry => runEntry.requests === 0).length, 1);
  assert.equal(runs.filter(runEntry => runEntry.requests === 6).length, 6, 'the initial run and the five on-phase ticks each fetched every offer');
});

test('a vendor failure inside the cron sequence keeps its previous good offer and recovers on the next due tick', async () => {
  const store = createMemoryStore();
  let simMs = Date.parse('2026-10-12T12:00:00.000Z');
  const timeSource = () => simMs;
  const tick = async (startIso, fetchImpl) => {
    simMs = Date.parse(startIso);
    return run({ store, fetchImpl, now: simMs, trigger: 'cron', timeSource, clock: () => simMs });
  };

  const first = await tick('2026-10-12T12:00:00.000Z', fixtureFetch());
  assert.equal(first.vendors.every(vendor => vendor.ok), true);
  const goodCoffeeman = (await store.snapshot()).observations.find(observation => observation.vendor.id === 'coffeeman' && observation.product.packCount === 1);
  assert.equal(goodCoffeeman.price.amount, 33);

  // The next tick: CoffeeMan is down, the other two vendors still refresh. The
  // board must keep the previous good CoffeeMan observation (price, stock and
  // observedAt) instead of erasing it, and the failed attempt is recorded.
  const failing = await tick('2026-10-12T18:00:00.000Z', fixtureFetch({ failVendors: ['coffeeman'] }));
  const coffeemanResult = failing.vendors.find(vendor => vendor.vendorId === 'coffeeman');
  assert.equal(coffeemanResult.ok, false);
  assert.equal(coffeemanResult.saved, 0);
  assert.equal(failing.vendors.filter(vendor => (vendor.saved ?? 0) > 0).length, 2, 'the other two vendors are not blocked by the failure');
  const keptCoffeeman = (await store.snapshot()).observations.find(observation => observation.vendor.id === 'coffeeman' && observation.product.packCount === 1);
  assert.equal(keptCoffeeman.price.amount, 33, 'the previous good price is preserved');
  assert.equal(keptCoffeeman.observedAt, goodCoffeeman.observedAt, 'the successful observation time is not overwritten');
  assert.equal(keptCoffeeman.attemptedAt, '2026-10-12T18:00:00.000Z', 'the failed attempt is stamped separately');
  assert.ok(keptCoffeeman.lastError, 'the failure reason is kept on the row');
  const failedState = await store.getVendorState('coffeeman');
  assert.equal(failedState.consecutiveFailures, 1);
  assert.equal(Date.parse(failedState.nextAttemptAt), simMs + BACKOFF_BASE_MS, 'the failed vendor backs off, not the whole board');

  const snapshot = await store.snapshot();
  const board = quoteBoard({
    observations: snapshot.observations,
    productId: 'lavazza-crema-e-gusto-vacuum-ground',
    variantId: 'classico',
    targetGrams: 500,
    destination: findDestination('tel-aviv'),
    fx: snapshot.meta.fx,
    now: simMs
  });
  assert.equal(board.best.vendor.id, 'coffeeman', 'the last known good observation still ranks');
  assert.equal(board.best.totalIls, 91);
  assert.equal(board.best.freshness, 'fresh');
  assert.equal(board.best.lastAttemptFailed, true, 'the quote says the most recent attempt failed');
  assert.ok(board.best.lastError, 'the quote carries the failure reason');
  assert.equal(board.best.observedAt, goodCoffeeman.observedAt, 'the quote keeps the last successful check time');
  assert.equal(board.best.attemptedAt, '2026-10-12T18:00:00.000Z', 'the quote carries the failed attempt time');

  // The next cron tick is six hours later, past the 30-minute backoff, so the
  // recovered vendor saves again and resets its failure count.
  const recovered = await tick('2026-10-13T00:00:00.000Z', fixtureFetch());
  const recoveredResult = recovered.vendors.find(vendor => vendor.vendorId === 'coffeeman');
  assert.equal(recoveredResult.ok, true);
  assert.equal(recoveredResult.saved, 3);
  const recoveredState = await store.getVendorState('coffeeman');
  assert.equal(recoveredState.consecutiveFailures, 0);
  const recoveredObservation = (await store.snapshot()).observations.find(observation => observation.vendor.id === 'coffeeman' && observation.product.packCount === 1);
  assert.equal(recoveredObservation.previous.price.amount, 33, 'the recovered check still compares with the pre-failure price');
  assert.equal(recoveredObservation.previous.observedAt, goodCoffeeman.observedAt);
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
  assert.equal(summaries.find(summary => !summary.skipped).requests, 6);
  assert.equal(calls.length, 6, 'the losing run performs no vendor or FX requests');
});

test('a zero-request run does not claim a completed refresh', async () => {
  const store = createMemoryStore();
  const first = await run({ store, fetchImpl: fixtureFetch(), now: NOW });
  assert.equal(first.requests, 6);
  const refreshAt = (await store.snapshot()).meta.lastRefreshAt.value;

  // Every vendor is still inside its six-hour window, so this run fetches nothing.
  const idle = await run({ store, fetchImpl: fixtureFetch(), now: NOW + 60_000 });
  assert.equal(idle.requests, 0);
  assert.equal(idle.vendors.filter(vendor => vendor.skipped).length, 3, 'all vendors are backed off');
  const after = (await store.snapshot()).meta.lastRefreshAt.value;
  assert.equal(after, refreshAt, 'an empty run must not look like a fresh observation');
  const runs = await store.listRuns(5);
  assert.equal(runs[0].requests, 0, 'the empty run is still recorded in the run history');
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

test('an interrupted refresh with saved observations is not reported as never refreshed', () => {
  const now = Date.parse('2026-10-12T12:00:00.000Z');
  const interrupted = refreshFreshness(null, now, '2026-10-12T11:30:00.000Z');
  assert.equal(interrupted.stale, false, 'fresh saved observations keep the board honest-fresh');
  assert.equal(interrupted.ageHours, 0.5);
  assert.equal(interrupted.lastRefreshAt, null, 'the missing completion marker stays visible');
  assert.equal(interrupted.lastObservationAt, '2026-10-12T11:30:00.000Z');
  assert.equal(interrupted.dataAsOf, '2026-10-12T11:30:00.000Z');

  const old = refreshFreshness(null, now, '2026-10-12T03:00:00.000Z');
  assert.equal(old.stale, true, 'observations older than the threshold are still stale');
  assert.equal(old.ageHours, 9);

  const stoppedPipeline = refreshFreshness('2026-10-12T03:00:00.000Z', now, '2026-10-12T11:30:00.000Z');
  assert.equal(stoppedPipeline.stale, true, 'a recorded but old completed refresh keeps the pipeline-stopped warning');
  assert.equal(stoppedPipeline.ageHours, 9, 'age stays anchored to the completed refresh when one exists');
  assert.equal(stoppedPipeline.dataAsOf, '2026-10-12T11:30:00.000Z', 'dataAsOf reports the newest evidence');
});

test('newestObservationAt ignores attempt markers and picks the newest success', () => {
  const rows = [
    { key: 'a', observedAt: '2026-10-12T10:00:00.000Z' },
    { key: 'b', attemptedAt: '2026-10-12T11:00:00.000Z', lastError: 'timeout' },
    { key: 'c', observedAt: '2026-10-12T09:00:00.000Z' },
    { key: 'd', observedAt: null }
  ];
  assert.equal(newestObservationAt(rows), '2026-10-12T10:00:00.000Z');
  assert.equal(newestObservationAt([]), null);
  assert.equal(newestObservationAt([{ key: 'x', attemptedAt: '2026-10-12T11:00:00.000Z' }]), null, 'a failed attempt is not an observation');
  assert.equal(newestObservationAt([
    { key: 'tracked', observedAt: '2026-10-12T10:00:00.000Z', product: { productId: 'tracked-product' } },
    { key: 'retired', observedAt: '2026-10-12T11:00:00.000Z', product: { productId: 'retired-product' } }
  ], ['tracked-product']), '2026-10-12T10:00:00.000Z', 'rows for other product lines are ignored');
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

test('retired-line observations and attempt markers are pruned from the live store', async () => {
  const store = createMemoryStore({
    observations: [
      {
        key: 'coffeeman:930339:unspecified:ground:250g:x1',
        vendor: { id: 'coffeeman', name: 'CoffeeMan (אמיגו)' },
        product: { productId: 'lavazza-qualita-oro-vacuum-ground', variantId: 'unspecified', form: 'ground', totalGrams: 250, packCount: 1 },
        price: { amount: 37, currency: 'ILS' },
        availability: 'in_stock',
        shipping: { certainty: 'verified', amount: { amount: 25, currency: 'ILS' } },
        observedAt: '2026-10-12T09:00:00.000Z'
      },
      {
        key: 'pucks:offer:suerte-250g',
        product: {},
        price: {},
        shipping: {},
        attemptedAt: '2026-10-12T09:00:00.000Z',
        lastError: 'HTTP 404'
      }
    ]
  });
  const summary = await run({ store, fetchImpl: fixtureFetch(), now: NOW });
  assert.equal(summary.pruned, 2, 'the retired observation and the retired attempt marker are removed');
  const snapshot = await store.snapshot();
  assert.equal(snapshot.observations.length, 5, 'only the five tracked Crema e Gusto offers remain after the refresh');
  assert.ok(!snapshot.observations.some(o => o.product?.productId === 'lavazza-qualita-oro-vacuum-ground'));
  assert.ok(!snapshot.observations.some(o => o.key === 'pucks:offer:suerte-250g'));
  assert.ok(snapshot.observations.every(o => o.product.productId === 'lavazza-crema-e-gusto-vacuum-ground'), 'the tracked line is never pruned');
});

test('the tracked offers are the only fetch targets the adapters declare', () => {
  for (const vendor of registeredVendors()) {
    for (const offer of vendor.offers) {
      assert.equal(offer.productId, 'lavazza-crema-e-gusto-vacuum-ground', `${vendor.id}:${offer.id} is a tracked Crema e Gusto offer`);
    }
  }
  const urls = registeredVendors().flatMap(vendor => vendor.offers.map(offer => offer.url));
  for (const url of urls) {
    assert.ok(!/qualita|suerte/i.test(decodeURIComponent(url)), `${url} is not a retired product URL`);
  }
});

test('retired product URLs have no fixture route, so offline tools cannot serve them', async () => {
  const retiredUrls = [
    'https://www.coffeeman.co.il/product/lavazza-qualita-oro-ground-250-gr--%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F',
    'https://www.coffeeman.co.il/product/4-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-lavazza-qualit224-oro-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F',
    'https://www.coffeeman.co.il/product/250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-qualita-rossa',
    'https://www.coffeeman.co.il/product/250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-suerte-%D7%97%D7%95%D7%96%D7%A7-10',
    'https://pucks.co.il/product/lavazza-qualita-oro-ground-coffee-250gr',
    'https://pucks.co.il/product/lavazza-qualita-rossa-ground-coffee-250g',
    'https://pucks.co.il/product/lavazza-qualita-rossa-ground-coffee-powder-250g',
    'https://pucks.co.il/product/lavazza-suerte-ground-coffee-250g'
  ];
  for (const url of retiredUrls) {
    assert.equal(await readFixtureForUrl(url), null, `${url} must not be routable`);
  }
  // Every mapped fixture belongs to a tracked offer; none of the historical
  // retired excerpts can be reached through the fixture fetch used by the
  // offline tools, tests and browser QA server.
  const mapped = trackedOffers().filter(offer => offer.file);
  assert.equal(mapped.length, 5, 'the five tracked Crema e Gusto offers have fixtures');
  assert.ok(mapped.every(offer => offer.productId === 'lavazza-crema-e-gusto-vacuum-ground'));
  const fixtureFetch = createFixtureFetch();
  const retiredResponse = await fixtureFetch(retiredUrls[0]);
  assert.equal(retiredResponse.status, 404, 'a retired URL is a fixture 404, never a vendor page');
});

test('a run that only refreshes the FX table does not claim a completed offer refresh', async () => {
  const store = createMemoryStore();
  await run({ store, fetchImpl: fixtureFetch(), now: NOW });
  const refreshAt = (await store.snapshot()).meta.lastRefreshAt.value;

  // Vendors are still inside their six-hour window, but the stored FX table is
  // three hours old, so this run fetches only the rate table.
  const fxOnly = await run({ store, fetchImpl: fixtureFetch(), now: NOW + 3 * 60 * 60 * 1000 + 1000 });
  assert.equal(fxOnly.requests, 1, 'only the FX request is made');
  assert.equal(fxOnly.vendors.filter(vendor => vendor.skipped).length, 3, 'every vendor is inside its backoff window');
  const after = (await store.snapshot()).meta.lastRefreshAt.value;
  assert.equal(after, refreshAt, 'refreshing only the rate table must not look like a fresh offer check');
});

test('a later successful check keeps the previous price as comparison evidence', async () => {
  const store = createMemoryStore();
  await run({ store, fetchImpl: fixtureFetch(), now: NOW });
  const before = (await store.snapshot()).observations.find(o => o.vendor.id === 'coffeeman' && o.product.packCount === 1);
  assert.equal(before.price.amount, 33);
  assert.equal(before.previous, undefined, 'the first observation has nothing to compare with');

  const cheaper = Buffer.from(
    readFileSync(new URL('coffeeman-product.windows-1255.html', fixtures)).toString('latin1').split('price="33.00"').join('price="30.00"'),
    'latin1'
  );
  await run({
    store,
    fetchImpl: fixtureFetch({ overrides: { 'coffeeman:classico-250g': cheaper } }),
    now: NOW + REFRESH_INTERVAL_MS
  });
  const after = (await store.snapshot()).observations.find(o => o.vendor.id === 'coffeeman' && o.product.packCount === 1);
  assert.equal(after.price.amount, 30);
  assert.equal(after.previous.price.amount, 33);
  assert.equal(after.previous.price.currency, 'ILS');
  assert.equal(after.previous.observedAt, before.observedAt);
  assert.equal(after.previous.availability, 'in_stock');
  assert.equal(after.previous.totalGrams, 250);

  const snapshot = await store.snapshot();
  const board = quoteBoard({
    observations: snapshot.observations,
    productId: 'lavazza-crema-e-gusto-vacuum-ground',
    variantId: 'classico',
    targetGrams: 500,
    destination: findDestination('tel-aviv'),
    fx: snapshot.meta.fx,
    now: NOW + REFRESH_INTERVAL_MS
  });
  assert.equal(board.best.key, after.key);
  assert.equal(board.best.priceChange.direction, 'down');
  assert.equal(board.best.priceChange.deltaIls, 3);
});
