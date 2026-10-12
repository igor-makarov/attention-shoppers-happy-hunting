#!/usr/bin/env node
// Repeatable local cron simulation.
//
//   npm run cron:local            # real vendor + Bank of Israel checks, persisted to .shurik-local/board.json
//   npm run cron:offline          # same pipeline with recorded fixtures, no network
//
// The Worker's scheduled handler calls the same runRefresh() function, so this
// script exercises the production refresh path without any Cloudflare account.

import { runRefresh } from '../src/refresh.js';
import { createFileStore } from '../src/store.js';
import { registeredVendors } from '../src/vendors/index.js';
import { readFile } from 'node:fs/promises';

const args = new Set(process.argv.slice(2));
const offline = args.has('--offline');
const storePath = process.env.BOARD_STATE_PATH ?? '.shurik-local/board.json';
const now = args.has('--simulate-failure-now') ? Date.now() + 24 * 60 * 60 * 1000 : Date.now();

const store = await createFileStore(storePath);

if (offline) {
  const fixtures = new URL('../tests/fixtures/', import.meta.url);
  const coffeemanBytes = await readFile(new URL('coffeeman-product.windows-1255.html', fixtures));
  const pucksHtml = await readFile(new URL('pucks-product.html', fixtures), 'utf8');
  const boi = {
    exchangeRates: [
      { key: 'USD', currentExchangeRate: 3.0, unit: 1, lastUpdate: '2026-10-09T09:21:04.476265Z' },
      { key: 'EUR', currentExchangeRate: 3.5, unit: 1, lastUpdate: '2026-10-09T09:21:04.476265Z' }
    ]
  };
  globalThis.__offlineFetch = async url => {
    if (url.includes('coffeeman.co.il')) {
      return new Response(coffeemanBytes, { status: 200, headers: { 'content-type': 'text/html; charset=windows-1255' } });
    }
    if (url.includes('pucks.co.il')) {
      return new Response(pucksHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url.includes('boi.org.il')) {
      return Response.json(boi);
    }
    return new Response('not found', { status: 404 });
  };
}

const fetchImpl = offline ? globalThis.__offlineFetch : globalThis.fetch;

try {
  const summary = await runRefresh({
    store,
    vendors: registeredVendors(),
    fetchImpl,
    now,
    trigger: offline ? 'cron-simulation-offline' : 'cron-simulation',
    logger: console
  });
  await store.flush();
  const snapshot = await store.snapshot();
  console.log(JSON.stringify({
    mode: offline ? 'offline fixtures' : 'live sources',
    statePath: storePath,
    summary,
    offers: snapshot.observations.map(observation => ({
      key: observation.key,
      vendor: observation.vendor?.name,
      price: observation.price,
      availability: observation.availability,
      shipping: observation.shipping?.amount,
      shippingCertainty: observation.shipping?.certainty,
      observedAt: observation.observedAt,
      lastError: observation.lastError ?? null
    })),
    fx: snapshot.meta.fx ? { asOf: snapshot.meta.fx.asOf, fetchedAt: snapshot.meta.fx.fetchedAt, usd: snapshot.meta.fx.rates?.USD } : null
  }, null, 2));
  process.exitCode = summary.skipped ? 0 : 0;
} catch (error) {
  console.error('cron simulation failed:', error);
  process.exitCode = 1;
}
