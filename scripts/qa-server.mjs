#!/usr/bin/env node
// Offline fixture server for the browser QA harness.
//
// Serves public/ exactly as Cloudflare assets do, plus the read-only JSON API
// computed with the production quote engine from recorded vendor fixtures.
// This keeps `npm run qa:browser` deterministic and network-free: the browser
// exercises the real front-end code without a Worker, credentials or vendors
// being reachable. The API response mirrors the Worker's shape closely enough
// for the board UI (see src/index.js handleBoard).
//
// Can also be run directly for manual inspection:
//   node scripts/qa-server.mjs [port]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { coffeeman } from '../src/vendors/coffeeman.js';
import { pucks } from '../src/vendors/pucks.js';
import { coffee4u } from '../src/vendors/coffee4u.js';
import { tivtaam } from '../src/vendors/tivtaam.js';
import { yuda } from '../src/vendors/yuda.js';
import { duchan } from '../src/vendors/duchan.js';
import { products } from '../src/catalog.js';
import { DESTINATIONS } from '../src/lib/quote.js';
import { createObservation, registeredVendors } from '../src/vendors/index.js';
import { refreshFreshness, newestObservationAt } from '../src/refresh.js';
import { buildBoardBody, publicProducts, publicVendors } from '../src/index.js';
import { PUBLISHED_SNAPSHOT } from '../src/data/published-observations.js';
import { readFixtureForUrl } from '../tests/fixtures/vendor-fixtures.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = resolve(ROOT, 'public');
const PUBLIC_CACHE = 'public, max-age=300, stale-while-revalidate=3600';
// Mirror the Worker: freshness only counts observations for product lines that are
// still tracked, so a historical retired row can never make the fixture board look fresh.
const TRACKED_PRODUCT_IDS = products.map(product => product.id);

// A single plain-language failure reason for the QA-only failed-attempt scenario.
// It is fixture metadata about a simulated vendor outage, never a claim about a real
// vendor response.
export const FAILED_ATTEMPT_REASON = 'HTTP 503 from the vendor product page';
// The simulated production grocery-egress failure for the published-evidence
// scenario: the store WAFs answer the deployed Worker's honest fetches with 403
// while the same bounded fetch succeeds from the runner. Fixture metadata, never
// a claim that any new vendor response was observed.
export const GROCERY_EGRESS_BLOCK_REASON = 'HTTP 403 from the store API (Worker egress)';
// An empty snapshot for the QA-only "no evidence at all" scenario: it proves the
// zero-observation copy path without inventing any observation value.
const EMPTY_SNAPSHOT = {
  ...PUBLISHED_SNAPSHOT,
  id: 'qa-empty-snapshot',
  label: 'QA empty snapshot (no published evidence)',
  observations: [],
  unavailableVendors: []
};
// The exact grocery vendors the production board tracks, for the scenario states.
const GROCERY_VENDOR_IDS = ['tivtaam', 'yuda', 'duchan'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

/** Parse the recorded vendor pages with the production adapters (no network). */
export async function fixtureObservations(now = Date.now()) {
  const fixtureFetch = async url => {
    const hit = await readFixtureForUrl(url);
    if (!hit) return { ok: false, status: 404, error: 'no fixture for this URL' };
    const buffer = new Uint8Array(hit.bytes);
    return {
      ok: true,
      status: 200,
      url,
      buffer,
      contentType: hit.contentType,
      text: new TextDecoder('utf-8', { fatal: false }).decode(buffer)
    };
  };
  const observations = [];
  for (const vendor of [coffeeman, pucks, coffee4u, tivtaam, yuda, duchan]) {
    const outcome = await vendor.observe({ fetchText: fixtureFetch, now, logger: null });
    if (outcome.failures?.length) {
      throw new Error(`${vendor.id}: fixture parse failed: ${JSON.stringify(outcome.failures)}`);
    }
    observations.push(...outcome.observations);
  }
  // QA-only previous-check metadata: one recorded offer is given a synthetic
  // earlier price and timestamp so the browser harness can verify the price-change
  // rendering without a second live refresh. It is fixture metadata for the offline
  // QA server, not evidence about any real vendor price change.
  const coffeemanSingle = observations.find(item => item.vendor.id === 'coffeeman' && item.product.packCount === 1);
  if (coffeemanSingle) {
    coffeemanSingle.previous = {
      observedAt: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
      price: { amount: 35, currency: coffeemanSingle.price.currency },
      availability: 'in_stock',
      totalGrams: coffeemanSingle.product.totalGrams
    };
  }
  // QA-only legacy-store row: before the 2026-10-12 owner correction the
  // persisted key contained the blend wording a listing printed. An old store can
  // therefore hold this row next to the stable-key row of the same listing, and
  // the board must collapse them instead of rendering the offer twice. The row is
  // fixture metadata (older observation, lower price) and never represents a real
  // vendor observation.
  const pucksOffer = observations.find(item => item.vendor.id === 'pucks');
  if (pucksOffer) {
    observations.push({
      ...pucksOffer,
      key: 'pucks:Lav69:classico:ground:250g:x1',
      product: { ...pucksOffer.product, variantId: 'classico', variantLabel: 'Classico' },
      price: { amount: 25, currency: pucksOffer.price.currency },
      observedAt: new Date(now - 12 * 60 * 60 * 1000).toISOString(),
      attemptedAt: new Date(now - 12 * 60 * 60 * 1000).toISOString()
    });
  }
  return observations;
}

/**
 * QA-only synthetic offer. It exists to exercise how the UI renders shipping
 * terms (minimum order, free-shipping threshold, locality restriction) that the
 * two recorded vendors do not currently publish. It is never part of the
 * production board and is clearly labelled as a fixture in the UI and API.
 */
export function termsDemoObservation(now = Date.now()) {
  return createObservation({
    vendor: { id: 'qa-terms-demo', name: 'QA fixture offer (terms demo, not a vendor)', homepage: null },
    itemUrl: 'https://example.invalid/qa-terms-demo',
    product: {
      productId: products[0].id,
      name: 'QA fixture: Lavazza Crema e Gusto Classico 250 g vacuum ground',
      sku: 'QA-DEMO',
      variantId: 'classico',
      variantLabel: 'Classico',
      form: 'ground',
      packGrams: 250,
      packCount: 1,
      totalGrams: 250,
      category: 'QA fixture'
    },
    price: { amount: 20, currency: 'ILS' },
    availability: 'in_stock',
    availabilityEvidence: {
      url: 'https://example.invalid/qa-terms-demo',
      value: 'fixture',
      note: 'Synthetic QA-only record: not an observation of any real vendor.'
    },
    shipping: {
      mode: 'delivery',
      service: 'home_delivery',
      certainty: 'verified',
      amount: { amount: 15, currency: 'ILS' },
      destination: { scope: 'localities', localities: ['tel-aviv', 'eilat'] },
      minOrder: { amount: 30, currency: 'ILS' },
      freeThreshold: { amount: 100, currency: 'ILS' },
      note: 'QA-only demo offer for shipping-term rendering. Not a real vendor listing.'
    },
    now
  });
}

/**
 * QA-only synthetic offer with no published shipping rate. It exists because
 * every recorded vendor now carries a researched rate, so the "Shipping not
 * published" path would otherwise be untested in the browser. It is never part
 * of the production board and is clearly labelled as a fixture.
 */
export function unknownShippingDemoObservation(now = Date.now()) {
  return createObservation({
    vendor: { id: 'qa-unknown-demo', name: 'QA fixture offer (no shipping rate, not a vendor)', homepage: null },
    itemUrl: 'https://example.invalid/qa-unknown-demo',
    product: {
      productId: products[0].id,
      name: 'QA fixture: Lavazza Crema e Gusto Classico 250 g vacuum ground',
      sku: 'QA-UNKNOWN',
      variantId: 'classico',
      variantLabel: 'Classico',
      form: 'ground',
      packGrams: 250,
      packCount: 1,
      totalGrams: 250,
      category: 'QA fixture'
    },
    price: { amount: 24, currency: 'ILS' },
    availability: 'in_stock',
    availabilityEvidence: {
      url: 'https://example.invalid/qa-unknown-demo',
      value: 'fixture',
      note: 'Synthetic QA-only record: not an observation of any real vendor.'
    },
    shipping: {
      mode: 'delivery',
      certainty: 'unknown',
      destination: { scope: 'country', country: 'IL' },
      note: 'QA-only demo: no public shipping rate. Not a real vendor listing.'
    },
    now
  });
}

/**
 * Start a local HTTP server that behaves like the deployed read-only board.
 * Returns { url, port, observations, close }.
 */
export async function startQaServer({ port = 0, now = Date.now(), withTermsDemo = false, withUnknownDemo = false, staleRefresh = false, interruptedRefresh = false, failedAttempt = false, withEmptyDairy = false, withPublishedDairy = false } = {}) {
  let observations = await fixtureObservations(failedAttempt ? now - 30 * 60 * 1000 : now);
  if (withTermsDemo) observations.push(termsDemoObservation(now));
  if (withUnknownDemo) observations.push(unknownShippingDemoObservation(now));
  // `withEmptyDairy` simulates a deployment where the grocery refresh has not
  // stored any observation yet and no published evidence exists at all (the QA
  // empty snapshot): the cheese board must say so plainly and must not offer a
  // locality switch that cannot rank anything. `withPublishedDairy` is the real
  // production state of 2026-10-15: no stored grocery observation either, but
  // the checked-in runner-research snapshot fills the board at read time.
  if (withEmptyDairy || withPublishedDairy) {
    observations = observations.filter(observation => !GROCERY_VENDOR_IDS.includes(observation.vendor.id));
  }
  // `failedAttempt` simulates the most recent vendor check failing while the last
  // successful observation is preserved: the fixture pages are parsed 30 minutes
  // before the server's reference time, then the ranked CoffeeMan offer and the
  // unrankable Pucks offer keep their price, stock and observedAt while carrying
  // attemptedAt/lastError for the failed check, so the UI must disclose it.
  if (failedAttempt) {
    const failedAt = new Date(now).toISOString();
    for (const observation of observations) {
      const isFailed = (observation.vendor.id === 'coffeeman' && observation.product.packCount === 1)
        || observation.vendor.id === 'pucks';
      if (!isFailed) continue;
      observation.attemptedAt = failedAt;
      observation.lastError = FAILED_ATTEMPT_REASON;
    }
  }
  // Per-vendor runtime state the Worker's scheduled refresh would have stored.
  // Mirrors handleBoard's `snapshot.vendors` so the QA board exercises the same
  // live-check logic (failed / pending / checked) as the deployed Worker.
  const vendorStates = {};
  for (const vendor of registeredVendors()) {
    const failed = failedAttempt && (vendor.id === 'coffeeman' || vendor.id === 'pucks');
    const lastSuccessAt = observations.find(row => row.vendor.id === vendor.id && row.observedAt)?.observedAt
      ?? new Date(now).toISOString();
    vendorStates[vendor.id] = {
      vendorId: vendor.id,
      lastAttemptAt: new Date(now).toISOString(),
      lastSuccessAt: failed ? lastSuccessAt : new Date(now).toISOString(),
      consecutiveFailures: failed ? 1 : 0,
      // Synthetic due time: six hours after a successful refresh (matching the
      // Worker's schedule) or the 30-minute failure backoff so the footer
      // next-check and failure lines are both testable offline.
      nextAttemptAt: new Date(now + (failed ? 30 * 60 * 1000 : 6 * 60 * 60 * 1000)).toISOString(),
      lastErrors: failed ? [FAILED_ATTEMPT_REASON] : []
    };
  }
  if (withPublishedDairy) {
    // The production grocery state: Tiv Taam and Super Yuda's first Worker
    // fetches failed with HTTP 403 (their last good coffee-independent state
    // keeps lastSuccessAt null because no grocery row was ever stored), and
    // Duchan was added after that cron tick, so it has never been attempted on
    // this deployment and must stay visibly pending.
    const attemptedAt = new Date(now - 30 * 60 * 1000).toISOString();
    for (const id of ['tivtaam', 'yuda']) {
      vendorStates[id] = {
        vendorId: id,
        lastAttemptAt: attemptedAt,
        lastSuccessAt: null,
        consecutiveFailures: 1,
        nextAttemptAt: new Date(now + 30 * 60 * 1000).toISOString(),
        lastErrors: [GROCERY_EGRESS_BLOCK_REASON]
      };
      // A total fetch failure leaves an attempt marker with no observation time,
      // exactly as the refresh pipeline stores it.
      const offer = registeredVendors().find(vendor => vendor.id === id)?.offers?.find(item => item.productId === 'tnuva-cottage-cheese-5-percent');
      observations.push({
        key: `${id}:offer:${offer?.id ?? 'unknown'}`,
        attemptedAt,
        lastError: GROCERY_EGRESS_BLOCK_REASON,
        product: {},
        price: {},
        shipping: {}
      });
    }
    delete vendorStates.duchan;
  }
  const snapshot = withEmptyDairy ? EMPTY_SNAPSHOT : PUBLISHED_SNAPSHOT;
  // `staleRefresh` simulates a board whose scheduled refresh has stopped running: the
  // offers are still as fresh as the fixture timestamps say, but the refresh is old.
  // `interruptedRefresh` simulates a run that saved observations but was stopped before
  // writing the completion marker (for example a redeploy killed the background job).
  const lastRefreshAt = interruptedRefresh ? null : new Date(staleRefresh ? now - 30 * 60 * 60 * 1000 : now).toISOString();
  const server = createServer((request, response) => {
    handle(request, response, { observations, now, withTermsDemo, withUnknownDemo, lastRefreshAt, staleRefresh, interruptedRefresh, failedAttempt, withEmptyDairy, withPublishedDairy, vendorStates, snapshot }).catch(error => {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`qa server error: ${error?.message ?? error}`);
    });
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolvePromise);
  });
  const { port: boundPort } = server.address();
  return {
    url: `http://127.0.0.1:${boundPort}`,
    port: boundPort,
    observations,
    close: () => new Promise(resolvePromise => server.close(() => resolvePromise()))
  };
}

async function handle(request, response, { observations, now, withTermsDemo, withUnknownDemo, lastRefreshAt, staleRefresh, interruptedRefresh, failedAttempt, withEmptyDairy, withPublishedDairy, vendorStates, snapshot }) {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/api/catalog') {
    return json(response, {
      products: publicProducts(),
      destinations: DESTINATIONS,
      vendors: publicVendors()
    });
  }
  if (url.pathname === '/api/board') {
    // Build the board through the Worker's own board builder, against a read-only
    // store view of the fixture observations, so the QA harness exercises the
    // real published-snapshot merge, live-check states and quote engine instead
    // of a second implementation that could drift from production.
    const storeView = {
      snapshot: async () => ({
        observations,
        meta: { fx: null, lastRefreshAt: lastRefreshAt ? { value: lastRefreshAt } : null },
        vendors: vendorStates ?? {}
      })
    };
    const board = await buildBoardBody({ url, store: storeView, now, snapshot });
    return json(response, {
      ...board,
      qa: {
        mode: 'fixtures',
        demoOffers: (withTermsDemo ? 1 : 0) + (withUnknownDemo ? 1 : 0),
        staleRefresh,
        interruptedRefresh,
        failedAttempt,
        emptyDairy: Boolean(withEmptyDairy),
        publishedDairy: Boolean(withPublishedDairy),
        previousCheckMetadata: 1,
        note: withTermsDemo
          ? 'Offline browser QA server. Recorded fixtures plus one clearly labelled QA-only terms demo offer (not a real vendor) and one synthetic previous-check price for change rendering.'
          : withUnknownDemo
            ? 'Offline browser QA server. Recorded fixtures plus one clearly labelled QA-only offer without a shipping rate (not a real vendor).'
            : withPublishedDairy
              ? 'Offline browser QA server. Fixture observations with the grocery rows removed (the production state while the Worker grocery egress is blocked), so the checked-in runner-research snapshot fills the board with its recorded times; Tiv Taam/Super Yuda report simulated HTTP 403 failures and Duchan is pending.'
              : withEmptyDairy
                ? 'Offline browser QA server. Fixture observations with the grocery rows removed and no published snapshot, to exercise the zero-observation copy path.'
                : 'Offline browser QA server. Data comes from tests/fixtures, not a live refresh; one offer carries synthetic previous-check metadata for change rendering.'
      }
    });
  }
  if (url.pathname === '/api/status') {
    const lastObservationAt = newestObservationAt(observations, TRACKED_PRODUCT_IDS);
    return json(response, {
      lastRefreshAt,
      lastObservationAt,
      freshness: refreshFreshness(lastRefreshAt, now, lastObservationAt),
      fx: null,
      vendors: registeredVendors().map(vendor => ({
        vendorId: vendor.id,
        lastAttemptAt: new Date(now).toISOString(),
        lastSuccessAt: new Date(now).toISOString(),
        consecutiveFailures: 0,
        nextAttemptAt: new Date(now + 6 * 60 * 60 * 1000).toISOString(),
        lastErrors: []
      })),
      observations: observations.length
    });
  }
  if (url.pathname.startsWith('/api/')) {
    return json(response, { error: 'Not found' }, 404);
  }
  return serveStatic(response, url.pathname);
}

async function serveStatic(response, pathname) {
  let relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  // Mirror the Worker: /product and /product/<id> serve the product page asset,
  // which resolves the id against the tracked catalog in the browser.
  if (relative === 'product' || /^product\/[^/]+\/?$/.test(relative)) relative = 'product.html';
  const target = resolve(PUBLIC_DIR, relative);
  if (target !== PUBLIC_DIR && !target.startsWith(`${PUBLIC_DIR}${sep}`)) {
    return json(response, { error: 'Not found' }, 404);
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(target);
    response.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store'
    });
    return response.end(body);
  } catch {
    return json(response, { error: 'Not found' }, 404);
  }
}

function json(response, body, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': PUBLIC_CACHE });
  response.end(JSON.stringify(body));
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  const port = Number(process.argv[2]) || 8789;
  const server = await startQaServer({ port });
  console.log(`QA fixture server on ${server.url} (${server.observations.length} fixture observations). Ctrl-C to stop.`);
}
