// Acceptance checks for the checked-in published runner-research snapshot:
// how it reaches a board read, and what it may never do.
//
// The deployed Worker's scheduled grocery check is blocked by the store WAFs
// (HTTP 403 from Cloudflare egress), while the same bounded public fetch succeeds
// from the GitHub Actions runner. That runner evidence is real and recorded, so
// the public board reads it. These tests lock the rules the owner set:
//
//   * an empty production store still shows the published evidence with its
//     original recorded time, source and runner-research label;
//   * a vendor that was never stored still reports its failed or pending runtime
//     check instead of silently disappearing;
//   * a current or newer stored observation always wins, so an older snapshot can
//     never revive stock that newer evidence says is unavailable;
//   * an expired snapshot stays visible as dated evidence but stops ranking;
//   * a stored failure marker keeps the vendor's last attempt without inventing
//     an observation;
//   * the exact 4/6/8/10 tub batches, delivery-only scope and Tel Aviv–Yafo-only
//     destination still hold when the evidence comes from the snapshot.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoardBody } from '../src/index.js';
import { createMemoryStore } from '../src/store.js';
import { mergePublishedObservations, publishedSnapshotSummary } from '../src/lib/published-observations.js';
import { parseTivtaamProduct } from '../src/vendors/tivtaam.js';
import { parseYudaProduct } from '../src/vendors/yuda.js';
import { readFixture } from './fixtures/vendor-fixtures.mjs';

const PRODUCT = 'tnuva-cottage-cheese-5-percent';
// The recorded run time of the checked-in runner snapshot. A board read must
// never replace it with the read time, so it is compared literally below.
const RECORDED_AT = '2026-10-15T21:33:36.968Z';
const READ_AT = Date.parse('2026-10-15T22:10:00Z');
const TIVTAAM_OFFER = 'tnuva-cottage-5-250g';

const snapshot = (observations, overrides = {}) => ({
  id: 'runner-source-check-test',
  label: 'Runner source check — test snapshot',
  origin: 'runner-research',
  source: 'GitHub Actions runner · npm run check:sources (bounded fetcher, published crawl delays, AttentionShoppersBot user agent)',
  recordedAt: RECORDED_AT,
  evidence: 'docs/evidence/source-check-test.json',
  note: 'Read-only evidence merged into board reads when the Worker store has no current observation for an offer.',
  observations,
  ...overrides
});

/** The two real recorded Tel Aviv grocery rows, as the checked-in snapshot holds them. */
async function publishedGroceryRows(observedAt = RECORDED_AT) {
  const now = Date.parse(observedAt);
  const tivtaam = parseTivtaamProduct((await readFixture('tivtaam-product.json')).text, { now });
  const yuda = parseYudaProduct((await readFixture('yuda-product.json')).text, { now });
  assert.equal(tivtaam.vendor.id, 'tivtaam');
  assert.equal(yuda.vendor.id, 'yuda');
  return [tivtaam, yuda];
}

const boardUrl = (query = `product=${PRODUCT}&quantity=4`) =>
  new URL(`https://example.test/api/board?${query}`);

test('an empty production store still shows the recorded runner research on the Tel Aviv board', async () => {
  const rows = await publishedGroceryRows();
  const board = await buildBoardBody({
    url: boardUrl(), store: createMemoryStore(), now: READ_AT,
    published: snapshot(rows)
  });
  // Tel Aviv–Yafo is the only public destination and no batch is purchasable at
  // the observed vendors' minimums, so nothing is invented.
  assert.equal(board.destination.id, 'tel-aviv');
  assert.equal(board.best, null);
  assert.deepEqual(board.batchComparisons.map(batch => batch.best), [null, null, null, null]);
  assert.equal(board.counts.ranked, 0);
  const vendors = board.unrankable.map(row => row.vendor.id).sort();
  assert.deepEqual(vendors, ['tivtaam', 'yuda']);
  const tivtaam = board.unrankable.find(row => row.vendor.id === 'tivtaam');
  assert.equal(tivtaam.itemTotalIls, 24.4);
  assert.equal(tivtaam.shipping.amountIls, 29.9);
  assert.equal(tivtaam.totalIls, null, 'a below-minimum batch never receives a delivered total');
  assert.match(tivtaam.reasons.join(' '), /below the vendor minimum order of ₪300/);
  const yuda = board.unrankable.find(row => row.vendor.id === 'yuda');
  assert.equal(yuda.shipping.amountIls, 35);
  assert.match(yuda.reasons.join(' '), /below the vendor minimum order of ₪150/);
  // The row says where it came from, with the run's own recorded time — never a
  // timestamp assigned during the read or the deployment.
  for (const row of board.unrankable) {
    assert.equal(row.observedAt, RECORDED_AT);
    assert.equal(row.provenance.kind, 'published_snapshot');
    assert.equal(row.provenance.origin, 'runner-research');
    assert.equal(row.provenance.snapshotId, 'runner-source-check-test');
    assert.equal(row.provenance.recordedAt, RECORDED_AT);
    assert.match(row.provenance.source, /GitHub Actions runner/);
  }
  assert.deepEqual(board.publishedSnapshot.appliedVendors.sort(), ['tivtaam', 'yuda']);
  assert.equal(board.publishedSnapshot.origin, 'runner-research');
  assert.equal(board.publishedSnapshot.recordedAt, RECORDED_AT);
});

test('a vendor the store never saved still reports its failed or pending runtime check', async () => {
  const rows = await publishedGroceryRows();
  // Production state for the grocery adapters: the Worker attempted both stores
  // and was answered with HTTP 403, and never saved an observation.
  const store = createMemoryStore({
    vendors: {
      tivtaam: {
        vendorId: 'tivtaam', lastAttemptAt: '2026-10-15T18:17:23.933Z', lastSuccessAt: null,
        consecutiveFailures: 1, nextAttemptAt: '2026-10-15T18:47:23.933Z', lastErrors: ['HTTP 403']
      },
      yuda: {
        vendorId: 'yuda', lastAttemptAt: '2026-10-15T18:17:23.933Z', lastSuccessAt: null,
        consecutiveFailures: 1, nextAttemptAt: '2026-10-15T18:47:23.933Z', lastErrors: ['HTTP 403']
      }
    }
  });
  const board = await buildBoardBody({
    url: boardUrl(), store, now: READ_AT, published: snapshot(rows)
  });
  const checks = new Map(board.freshness.vendors.map(entry => [entry.vendorId, entry]));
  assert.deepEqual([...checks.keys()].sort(), ['tivtaam', 'yuda'], 'only Tel Aviv grocery vendors are listed');
  const tivtaam = checks.get('tivtaam');
  assert.equal(tivtaam.state, 'failed');
  assert.equal(tivtaam.consecutiveFailures, 1);
  assert.equal(tivtaam.lastAttemptAt, '2026-10-15T18:17:23.933Z');
  assert.equal(tivtaam.lastSuccessAt, null, 'the Worker never refreshed this vendor');
  assert.deepEqual(tivtaam.lastErrors, ['HTTP 403']);
  assert.equal(tivtaam.publishedObservations, 1, 'the shopper sees one runner-researched row');
  assert.equal(tivtaam.storedObservations, 0);
  assert.match(tivtaam.note, /HTTP 403/);
  // The same failed check travels on the published row itself.
  const row = board.unrankable.find(entry => entry.vendor.id === 'tivtaam');
  assert.equal(row.liveCheck.state, 'failed');
  assert.equal(row.liveCheck.error, 'HTTP 403');
});

test('a vendor without any attempt or stored row reports a pending check, not a blank board', async () => {
  const rows = await publishedGroceryRows();
  const board = await buildBoardBody({
    url: boardUrl(), store: createMemoryStore(), now: READ_AT, published: snapshot(rows)
  });
  const entries = new Map(board.freshness.vendors.map(entry => [entry.vendorId, entry]));
  for (const vendorId of ['tivtaam', 'yuda']) {
    assert.equal(entries.get(vendorId).state, 'pending', `${vendorId} reports a pending check`);
  }
  assert.equal(board.counts.observed, 2, 'the published evidence is still shown');
});

test('a newer stored observation wins and cannot be revived by an older published row', async () => {
  const [tivtaamPublished] = await publishedGroceryRows();
  // The stored row is itself past the stale window, but it is still newer than
  // the published row: the newer evidence wins and says the stock is gone.
  const olderPublished = { ...tivtaamPublished, observedAt: '2026-10-13T21:33:36.968Z' };
  const newer = {
    ...tivtaamPublished,
    availability: 'out_of_stock',
    availabilityLabel: 'Out of stock',
    observedAt: '2026-10-14T21:33:36.968Z'
  };
  const store = createMemoryStore({ observations: [newer] });
  const board = await buildBoardBody({
    url: boardUrl(), store, now: READ_AT, published: snapshot([olderPublished])
  });
  const row = [...board.unrankable, ...board.unknown, ...board.staleOrUnavailable]
    .find(entry => entry.vendor.id === 'tivtaam');
  assert.ok(row, 'the stored row is still shown');
  assert.equal(row.availability, 'out_of_stock', 'the newer unavailable stock is preserved');
  assert.equal(row.observedAt, '2026-10-14T21:33:36.968Z');
  assert.notEqual(row.provenance?.kind, 'published_snapshot', 'the older snapshot row does not take over');
  assert.equal(board.publishedSnapshot.appliedVendors.length, 0, 'the published row was not used');
  const merged = mergePublishedObservations([newer], { now: READ_AT, snapshot: snapshot([olderPublished]) });
  assert.equal(merged.sources.get(`${newer.vendor.id}:${newer.itemUrl}`), 'worker_refresh');
  assert.deepEqual(merged.superseded.map(entry => entry.reason), ['newer-stored-observation']);
});

test('a current stored observation always wins even when the published row is newer', async () => {
  const [tivtaamPublished] = await publishedGroceryRows();
  const stored = { ...tivtaamPublished, observedAt: new Date(READ_AT).toISOString(), price: { amount: 6.4, currency: 'ILS' } };
  const newerPublished = { ...tivtaamPublished, observedAt: new Date(READ_AT + 60 * 60 * 1000).toISOString(), price: { amount: 5.9, currency: 'ILS' } };
  const merged = mergePublishedObservations([stored], { now: READ_AT, snapshot: snapshot([newerPublished]) });
  assert.equal(merged.observations.length, 1);
  assert.equal(merged.observations[0].price.amount, 6.4, 'the live observation keeps its own price');
  assert.equal(merged.observations[0].published, undefined, 'it is not relabelled as published evidence');
  assert.equal(merged.backfilled.length, 0);
  assert.deepEqual(merged.superseded.map(entry => entry.reason), ['live-observation-current']);
});

test('an expired published snapshot stays visible as dated evidence but stops ranking', async () => {
  const [tivtaamPublished] = await publishedGroceryRows();
  const expiredRow = { ...tivtaamPublished, observedAt: '2026-10-12T21:33:36.968Z' };
  const board = await buildBoardBody({
    url: boardUrl(), store: createMemoryStore(), now: READ_AT,
    published: snapshot([expiredRow])
  });
  assert.equal(board.publishedSnapshot.expired, true, 'the summary reports the snapshot as expired');
  assert.equal(board.counts.ranked, 0, 'an expired row never ranks');
  const visible = [...board.unrankable, ...board.unknown, ...board.staleOrUnavailable];
  const stale = visible.find(entry => entry.vendor.id === 'tivtaam');
  assert.ok(stale, 'the evidence stays visible');
  assert.equal(stale.observedAt, '2026-10-12T21:33:36.968Z', 'its own recorded date is kept');
  assert.match(stale.labels.join(' '), /Stale/);
  assert.equal(stale.totalIls, null);
  const summary = publishedSnapshotSummary(snapshot([expiredRow]), READ_AT);
  assert.equal(summary.expired, true);
  assert.equal(summary.freshObservationCount, 0);
  assert.equal(summary.observationCount, 1);
});

test('a stored failure marker keeps the last attempt without inventing an observation', async () => {
  // The refresh pipeline stores exactly this shape for a vendor whose fetch
  // failed before any observation was ever saved.
  const store = createMemoryStore({
    observations: [{
      key: `tivtaam:offer:${TIVTAAM_OFFER}`,
      attemptedAt: '2026-10-15T18:17:23.933Z',
      lastError: 'HTTP 403'
    }],
    vendors: {
      tivtaam: {
        vendorId: 'tivtaam', lastAttemptAt: '2026-10-15T18:17:23.933Z', lastSuccessAt: null,
        consecutiveFailures: 1, nextAttemptAt: '2026-10-15T18:47:23.933Z', lastErrors: ['HTTP 403']
      }
    }
  });
  const board = await buildBoardBody({
    url: boardUrl(), store, now: READ_AT, published: snapshot([])
  });
  assert.equal(board.counts.observed, 0, 'no observation is manufactured from a failure marker');
  assert.equal(board.best, null);
  const tivtaam = board.freshness.vendors.find(entry => entry.vendorId === 'tivtaam');
  assert.equal(tivtaam.state, 'failed');
  assert.equal(tivtaam.storedObservations, 0);
  assert.deepEqual(tivtaam.lastErrors, ['HTTP 403']);
  // The marker itself is neither dropped nor turned into a quote: it keeps exactly
  // the fields the refresh pipeline wrote.
  const marker = {
    key: `tivtaam:offer:${TIVTAAM_OFFER}`,
    attemptedAt: '2026-10-15T18:17:23.933Z',
    lastError: 'HTTP 403'
  };
  const merged = mergePublishedObservations([marker], { now: READ_AT, snapshot: snapshot([]) });
  assert.equal(merged.observations.length, 1);
  assert.equal(merged.observations[0].key, marker.key);
  assert.equal(merged.observations[0].observedAt, undefined, 'a marker is never an observation');
  assert.equal(merged.observations[0].attemptedAt, marker.attemptedAt);
  assert.equal(merged.observations[0].lastError, 'HTTP 403');
  assert.equal(merged.backfilled.length, 0);
});

test('the published snapshot never restores the out-of-area Duchan vendor to a Tel Aviv read', async () => {
  const { parseDuchanProduct } = await import('../src/vendors/duchan.js');
  const duchan = parseDuchanProduct((await readFixture('duchan-product.json')).text, { now: Date.parse(RECORDED_AT) });
  const board = await buildBoardBody({
    url: boardUrl(), store: createMemoryStore(), now: READ_AT, published: snapshot([duchan])
  });
  assert.equal(board.destination.id, 'tel-aviv');
  const vendors = [...board.ranked, ...board.unrankable, ...board.staleOrUnavailable, ...board.unknown];
  assert.ok(vendors.every(row => row.vendor.id !== 'duchan'), 'the Ganei Shmuel evidence cannot become a Tel Aviv offer');
  assert.equal(board.counts.observed, 0);
  assert.deepEqual(board.publishedSnapshot.appliedVendors, []);
});

test('every exact batch and the shareable quantity link stay exact when evidence is published', async () => {
  const rows = await publishedGroceryRows();
  const store = createMemoryStore();
  const cases = [['quantity=4', 4], ['quantity=6', 6], ['quantity=8', 8], ['quantity=10', 10],
    ['quantity=5', 4], ['grams=2000', 8], ['grams=1500', 6], ['grams=500', 4]];
  for (const [query, expected] of cases) {
    const board = await buildBoardBody({
      url: boardUrl(`product=${PRODUCT}&${query}`), store, now: READ_AT, published: snapshot(rows)
    });
    assert.equal(board.targetQuantity, expected, query);
    assert.equal(board.deliveryOnly, true, query);
    assert.equal(board.destination.id, 'tel-aviv', query);
    assert.equal(board.counts.ranked, 0, query);
    assert.equal(board.pickup.length, 0, query);
    assert.equal(board.best, null, query);
  }
  // A gram link outside the exact batches falls back to the default batch rather
  // than inventing a 12-tub order.
  const threeKilograms = await buildBoardBody({
    url: boardUrl(`product=${PRODUCT}&grams=3000`), store, now: READ_AT, published: snapshot(rows)
  });
  assert.equal(threeKilograms.targetQuantity, 4, 'grams=3000 is not an exact batch and falls back to the default');
  // Old links for other cities normalize to the only public locality.
  for (const destination of ['eilat', 'jerusalem', 'ganei-shmuel', 'nowhere']) {
    const board = await buildBoardBody({
      url: boardUrl(`product=${PRODUCT}&dest=${destination}`), store, now: READ_AT, published: snapshot(rows)
    });
    assert.equal(board.destination.id, 'tel-aviv', destination);
  }
});
