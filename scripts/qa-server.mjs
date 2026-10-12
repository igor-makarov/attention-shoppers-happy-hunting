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
import { products, resolveVariantId, resolveProductRequest } from '../src/catalog.js';
import { quoteBoard, findDestination, DESTINATIONS } from '../src/lib/quote.js';
import { createObservation, registeredVendors } from '../src/vendors/index.js';
import { refreshFreshness } from '../src/refresh.js';
import { publicProducts, publicVendors } from '../src/index.js';
import { readFixtureForUrl } from '../tests/fixtures/vendor-fixtures.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = resolve(ROOT, 'public');
const PUBLIC_CACHE = 'public, max-age=300, stale-while-revalidate=3600';

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
  for (const vendor of [coffeeman, pucks, coffee4u]) {
    const outcome = await vendor.observe({ fetchText: fixtureFetch, now, logger: null });
    if (outcome.failures?.length) {
      throw new Error(`${vendor.id}: fixture parse failed: ${JSON.stringify(outcome.failures)}`);
    }
    observations.push(...outcome.observations);
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
 * Start a local HTTP server that behaves like the deployed read-only board.
 * Returns { url, port, observations, close }.
 */
export async function startQaServer({ port = 0, now = Date.now(), withTermsDemo = false, staleRefresh = false } = {}) {
  const observations = await fixtureObservations(now);
  if (withTermsDemo) observations.push(termsDemoObservation(now));
  // `staleRefresh` simulates a board whose scheduled refresh has stopped running: the
  // offers are still as fresh as the fixture timestamps say, but the refresh is old.
  const lastRefreshAt = new Date(staleRefresh ? now - 30 * 60 * 60 * 1000 : now).toISOString();
  const server = createServer((request, response) => {
    handle(request, response, { observations, now, withTermsDemo, lastRefreshAt, staleRefresh }).catch(error => {
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

async function handle(request, response, { observations, now, withTermsDemo, lastRefreshAt, staleRefresh }) {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/api/catalog') {
    return json(response, {
      products: publicProducts(),
      destinations: DESTINATIONS,
      vendors: publicVendors()
    });
  }
  if (url.pathname === '/api/board') {
    const { product, retired } = resolveProductRequest(url.searchParams.get('product'));
    const variantId = resolveVariantId(product, url.searchParams.get('variant'));
    const grams = url.searchParams.get('grams') ?? '500';
    const destination = findDestination(url.searchParams.get('dest'));
    const board = quoteBoard({ observations, productId: product.id, variantId, targetGrams: grams, destination, fx: null, now });
    return json(response, {
      ...board,
      product: publicProducts().find(item => item.id === product.id) ?? null,
      requestedRetiredProduct: retired ? { id: retired.id, line: retired.line } : null,
      freshness: {
        ...refreshFreshness(lastRefreshAt, now),
        fx: null,
        vendors: registeredVendors().map(vendor => ({
          vendorId: vendor.id,
          lastAttemptAt: new Date(now).toISOString(),
          lastSuccessAt: new Date(now).toISOString(),
          consecutiveFailures: 0,
          nextAttemptAt: null,
          lastErrors: []
        }))
      },
      status: board.ranked.length > 0
        ? 'Delivered totals ranked from verified observations.'
        : 'No offer currently has enough verified information to rank. Unknowns are listed below.',
      qa: {
        mode: 'fixtures',
        demoOffers: withTermsDemo ? 1 : 0,
        staleRefresh,
        note: withTermsDemo
          ? 'Offline browser QA server. Recorded fixtures plus one clearly labelled QA-only terms demo offer (not a real vendor).'
          : 'Offline browser QA server. Data comes from tests/fixtures, not a live refresh.'
      }
    });
  }
  if (url.pathname.startsWith('/api/')) {
    return json(response, { error: 'Not found' }, 404);
  }
  return serveStatic(response, url.pathname);
}

async function serveStatic(response, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
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
