#!/usr/bin/env node
// Repeatable local cron simulation.
//
//   npm run cron:local            # real vendor + Bank of Israel checks, persisted to .shurik-local/board.json
//   npm run cron:offline          # same pipeline with recorded fixtures, no network
//
// The Worker's scheduled handler calls the same runRefresh() function, so this
// script exercises the production refresh path without any Cloudflare account.
//
// Offline runs are deterministic: they use their own state file and start from a
// clean store, so the command can be repeated and the live script's six-hour
// backoff window is never consumed by a fixture run. Live runs keep their state
// (like the deployed cron); pass --fresh to a live run to reset it. Set
// BOARD_STATE_PATH to choose the state file explicitly.

import { rm } from 'node:fs/promises';
import { runRefresh } from '../src/refresh.js';
import { createFileStore } from '../src/store.js';
import { registeredVendors } from '../src/vendors/index.js';
import { createFixtureFetch } from '../tests/fixtures/vendor-fixtures.mjs';

const args = new Set(process.argv.slice(2));
const offline = args.has('--offline');
const explicitStatePath = process.env.BOARD_STATE_PATH || null;
const storePath = explicitStatePath ?? (offline ? '.shurik-local/board-offline.json' : '.shurik-local/board.json');
const resetState = args.has('--fresh') || (offline && !explicitStatePath);
const now = args.has('--simulate-failure-now') ? Date.now() + 24 * 60 * 60 * 1000 : Date.now();

if (resetState) await rm(storePath, { force: true });
const store = await createFileStore(storePath);

if (offline) {
  const fixtureFetch = createFixtureFetch();
  const boi = {
    exchangeRates: [
      { key: 'USD', currentExchangeRate: 3.0, unit: 1, lastUpdate: '2026-10-09T09:21:04.476265Z' },
      { key: 'EUR', currentExchangeRate: 3.5, unit: 1, lastUpdate: '2026-10-09T09:21:04.476265Z' }
    ]
  };
  globalThis.__offlineFetch = async (url, init) => {
    if (String(url).includes('boi.org.il')) return Response.json(boi);
    return fixtureFetch(url, init);
  };
}

const fetchImpl = offline ? globalThis.__offlineFetch : globalThis.fetch;
// Offline runs use recorded pages, so the crawl-delay wait would only slow the
// test down; the pacing itself is covered by tests/http fixtures in unit tests.
const sleep = offline ? async () => {} : undefined;
const logger = { info: message => process.stderr.write(`${message}\n`), warn: message => process.stderr.write(`${message}\n`) };

try {
  const summary = await runRefresh({
    store,
    vendors: registeredVendors(),
    fetchImpl,
    now,
    sleep,
    trigger: offline ? 'cron-simulation-offline' : 'cron-simulation',
    logger
  });
  await store.flush();
  const snapshot = await store.snapshot();
  console.log(JSON.stringify({
    mode: offline ? 'offline fixtures' : 'live sources',
    statePath: storePath,
    summary,
    offers: snapshot.observations.map(observation => ({
      key: observation.key,
      productId: observation.product?.productId ?? null,
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
