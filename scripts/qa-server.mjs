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
import { products } from '../src/catalog.js';
import { quoteBoard, findDestination, DESTINATIONS } from '../src/lib/quote.js';
import { registeredVendors } from '../src/vendors/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = resolve(ROOT, 'public');
const FIXTURES = new URL('../tests/fixtures/', import.meta.url);
const DEFAULT_VARIANT = 'classico';
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
  const coffeemanBytes = await readFile(new URL('coffeeman-product.windows-1255.html', FIXTURES));
  const pucksHtml = await readFile(new URL('pucks-product.html', FIXTURES), 'utf8');
  const fixtureFetch = async url => {
    if (String(url).includes('coffeeman.co.il')) {
      const buffer = new Uint8Array(coffeemanBytes);
      return { ok: true, status: 200, url, buffer, text: new TextDecoder('utf-8', { fatal: false }).decode(buffer) };
    }
    if (String(url).includes('pucks.co.il')) {
      const buffer = new Uint8Array(Buffer.from(pucksHtml, 'utf8'));
      return { ok: true, status: 200, url, buffer, text: pucksHtml };
    }
    return { ok: false, status: 404, error: 'no fixture for this URL' };
  };
  const observations = [];
  for (const vendor of [coffeeman, pucks]) {
    const outcome = await vendor.observe({ fetchText: fixtureFetch, now, logger: null });
    if (outcome.failures?.length) {
      throw new Error(`${vendor.id}: fixture parse failed: ${JSON.stringify(outcome.failures)}`);
    }
    observations.push(...outcome.observations);
  }
  return observations;
}

/**
 * Start a local HTTP server that behaves like the deployed read-only board.
 * Returns { url, port, observations, close }.
 */
export async function startQaServer({ port = 0, now = Date.now() } = {}) {
  const observations = await fixtureObservations(now);
  const server = createServer((request, response) => {
    handle(request, response, { observations, now }).catch(error => {
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

async function handle(request, response, { observations, now }) {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/api/catalog') {
    return json(response, {
      products,
      destinations: DESTINATIONS,
      vendors: registeredVendors().map(vendor => ({
        id: vendor.id,
        name: vendor.name,
        homepage: vendor.homepage,
        offers: vendor.offers.map(offer => ({ id: offer.id, url: offer.url, kind: offer.kind }))
      }))
    });
  }
  if (url.pathname === '/api/board') {
    const productId = url.searchParams.get('product') ?? products[0].id;
    const variantId = url.searchParams.get('variant') ?? DEFAULT_VARIANT;
    const grams = url.searchParams.get('grams') ?? '500';
    const destination = findDestination(url.searchParams.get('dest'));
    const board = quoteBoard({ observations, productId, variantId, targetGrams: grams, destination, fx: null, now });
    return json(response, {
      ...board,
      product: products.find(item => item.id === productId) ?? null,
      freshness: {
        lastRefreshAt: new Date(now).toISOString(),
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
      qa: { mode: 'fixtures', note: 'Offline browser QA server. Data comes from tests/fixtures, not a live refresh.' }
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
