#!/usr/bin/env node
// Read-only production probe for the deployed comparison board.
//
//   npm run probe:production                       # owner-reported production URL
//   npm run probe:production -- --url http://127.0.0.1:8789
//   npm run probe:production -- --out docs/evidence/production-probe-<timestamp>.json
//
// The probe sends only public GETs to a fixed endpoint list: /health, /api/status,
// /api/catalog and a few /api/board queries (including an old retired-product URL).
// It never authenticates, never deploys and never sends a credential. A snapshot
// is always written under .shurik-local/production/ unless --no-save is passed, so
// a later iteration can diff production state without re-inventing the probe.
//
// Exit code 1 when the site is unreachable, when a response is not HTTP 200, or
// when the single-product scope is violated (a retired product line appearing in
// a board payload or more than one catalog product).

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const valueOf = flag => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const baseUrl = (valueOf('--url') ?? 'https://attention-shoppers.igormaka.workers.dev').replace(/\/$/, '');
const explicitOut = valueOf('--out');
const noSave = args.includes('--no-save');
const jsonOnly = args.includes('--json');
const timeoutMs = Number(valueOf('--timeout') ?? 15_000);

const TRACKED_PRODUCT = 'lavazza-crema-e-gusto-vacuum-ground';
const RETIRED_PRODUCT_IDS = [
  'lavazza-qualita-oro-vacuum-ground',
  'lavazza-qualita-rossa-vacuum-ground',
  'lavazza-suerte-ground'
];

const startedAt = new Date().toISOString();

async function get(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: 'application/json,text/html;q=0.9,*/*;q=0.5' }
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }
    return {
      status: response.status,
      headers: {
        contentType: response.headers.get('content-type'),
        cacheControl: response.headers.get('cache-control'),
        cfCacheStatus: response.headers.get('cf-cache-status')
      },
      body
    };
  } catch (error) {
    return { status: 0, error: error?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : `fetch failed: ${error?.message ?? error}` };
  } finally {
    clearTimeout(timer);
  }
}

const boardRows = board => [
  ...(board?.ranked ?? []),
  ...(board?.pickup ?? []),
  ...(board?.unrankable ?? []),
  ...(board?.staleOrUnavailable ?? []),
  ...(board?.unknown ?? []),
  ...(board?.best ? [board.best] : []),
  ...(board?.bestPerKg ? [board.bestPerKg] : [])
];

const summarizeBoard = board => ({
  generatedAt: board?.generatedAt ?? null,
  productId: board?.productId ?? null,
  variantId: board?.variantId ?? null,
  targetGrams: board?.targetGrams ?? null,
  destination: board?.destination?.id ?? null,
  best: board?.best ? { key: board.best.key, totalIls: board.best.totalIls, vendor: board.best.vendor?.id ?? null } : null,
  ranked: (board?.ranked ?? []).map(quote => ({
    key: quote.key,
    vendor: quote.vendor?.id ?? null,
    productId: quote.product?.productId ?? null,
    variantId: quote.product?.variantId ?? null,
    packGrams: quote.product?.packGrams ?? null,
    packCount: quote.product?.packCount ?? null,
    units: quote.units,
    itemTotalIls: quote.itemTotalIls,
    shippingIls: quote.shipping?.amountIls ?? null,
    shippingCertainty: quote.shipping?.certainty ?? null,
    totalIls: quote.totalIls,
    ilsPerKg: quote.ilsPerKg
  })),
  unrankable: (board?.unrankable ?? []).map(quote => ({
    key: quote.key,
    vendor: quote.vendor?.id ?? null,
    productId: quote.product?.productId ?? null,
    itemPrice: quote.itemPrice,
    reasons: quote.reasons
  })),
  staleOrUnavailable: (board?.staleOrUnavailable ?? []).map(quote => ({
    key: quote.key,
    vendor: quote.vendor?.id ?? null,
    availability: quote.availability,
    labels: quote.labels
  })),
  pickup: (board?.pickup ?? []).map(quote => ({
    key: quote.key,
    vendor: quote.vendor?.id ?? null,
    itemTotalIls: quote.itemTotalIls,
    note: quote.shipping?.pickup?.note ?? null
  })),
  freshness: board?.freshness ?? null,
  requestedRetiredProduct: board?.requestedRetiredProduct ?? null
});

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  return Boolean(ok);
};

const endpoints = {
  health: await get('/health'),
  status: await get('/api/status'),
  catalog: await get('/api/catalog'),
  board500: await get('/api/board?grams=500&dest=tel-aviv'),
  board1000: await get('/api/board?grams=1000&dest=tel-aviv'),
  boardUnstated: await get('/api/board?variant=unspecified&grams=500&dest=tel-aviv'),
  retiredUrl: await get('/api/board?product=lavazza-qualita-oro-vacuum-ground&grams=500&dest=tel-aviv')
};
const finishedAt = new Date().toISOString();

for (const [name, response] of Object.entries(endpoints)) {
  check(`${name} responds HTTP 200`, response.status === 200, response.error ?? `HTTP ${response.status}`);
}

const catalogProducts = (endpoints.catalog.body?.products ?? []).map(product => product.id);
check('catalog exposes exactly the tracked product', catalogProducts.length === 1 && catalogProducts[0] === TRACKED_PRODUCT, catalogProducts.join(', '));
check(
  'health reports ok with storage available',
  endpoints.health.body?.status === 'ok' && !endpoints.health.body?.storageError,
  `${endpoints.health.body?.status ?? 'missing'} / ${endpoints.health.body?.storageError ?? 'no storage error'}`
);

// Run-history integrity: a completed refresh must be recorded and time-ordered, so
// a missing or mis-stamped cron run is visible instead of silently reading as "never
// refreshed". The newest run is printed below, which is how a cron tick is observed.
const statusBody = endpoints.status.body ?? {};
const runs = Array.isArray(statusBody.runs) ? statusBody.runs : [];
const runsWellFormed = runs.length > 0 && runs.every(run => {
  const started = Date.parse(run?.startedAt);
  const finished = Date.parse(run?.finishedAt);
  return Number.isFinite(started) && Number.isFinite(finished) && finished >= started;
});
check('status run history is present and time-ordered', runsWellFormed, `${runs.length} run(s)`);
check(
  'health and status agree on the last completed refresh',
  (endpoints.health.body?.lastRefreshAt ?? null) === (statusBody.lastRefreshAt ?? null),
  `health=${endpoints.health.body?.lastRefreshAt ?? null} status=${statusBody.lastRefreshAt ?? null}`
);

const boards = {
  board500: endpoints.board500.body,
  board1000: endpoints.board1000.body,
  boardUnstated: endpoints.boardUnstated.body,
  retiredUrl: endpoints.retiredUrl.body
};
for (const [name, board] of Object.entries(boards)) {
  const ids = new Set(boardRows(board).map(quote => quote.product?.productId).filter(Boolean));
  const retiredSeen = [...ids].filter(id => RETIRED_PRODUCT_IDS.includes(id));
  check(`${name} has no retired product row`, retiredSeen.length === 0, [...ids].join(', '));
  check(`${name} names the tracked product`, board?.productId === TRACKED_PRODUCT, board?.productId ?? 'missing');
}
check(
  'the retired URL falls back with a written retired-line notice',
  boards.retiredUrl?.requestedRetiredProduct?.id === 'lavazza-qualita-oro-vacuum-ground',
  JSON.stringify(boards.retiredUrl?.requestedRetiredProduct ?? null)
);

const snapshot = {
  capturedAt: `${startedAt} to ${finishedAt}`,
  mode: 'read-only public GETs from the coding runner; no Cloudflare credentials, admin API, deploy or remote resource change',
  url: baseUrl,
  endpoints: Object.fromEntries(Object.entries(endpoints).map(([name, response]) => [name, {
    status: response.status,
    error: response.error ?? null,
    headers: response.headers ?? null,
    body: name.startsWith('board') || name === 'retiredUrl' ? undefined : response.body,
    summary: name.startsWith('board') || name === 'retiredUrl' ? summarizeBoard(response.body) : undefined
  }])),
  checks
};

if (!noSave) {
  const outPath = explicitOut ?? join('.shurik-local', 'production', `probe-${startedAt.replace(/[:.]/g, '-')}.json`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  snapshot.savedTo = outPath;
}

if (jsonOnly) {
  console.log(JSON.stringify(snapshot, null, 2));
} else {
  const status = endpoints.status.body ?? {};
  const catalog = endpoints.catalog.body ?? {};
  console.log(`Production probe (read-only) at ${startedAt}`);
  console.log(`URL: ${baseUrl}`);
  console.log(`Health: ${endpoints.health.status} lastRefreshAt=${endpoints.health.body?.lastRefreshAt ?? null} lastObservationAt=${endpoints.health.body?.lastObservationAt ?? null}`);
  console.log(`Status: observations=${status.observations ?? null} lastRefreshAt=${status.lastRefreshAt ?? null} stale=${status.freshness?.stale ?? null} ageHours=${status.freshness?.ageHours ?? null}`);
  console.log(`Catalog: products=[${catalogProducts.join(', ')}] vendors=[${(catalog.vendors ?? []).map(vendor => vendor.id).join(', ')}]`);
  console.log(`Vendor next attempts: ${(status.vendors ?? []).map(vendor => `${vendor.vendorId}@${vendor.nextAttemptAt}`).join(' ')}`);
  console.log(`Runs: ${(status.runs ?? []).map(run => `${run.trigger}(${run.requests} req, ${run.finishedAt})`).join(' ')}`);
  for (const [name, board] of Object.entries(boards)) {
    const best = boards[name]?.best;
    console.log(`${name}: best=${best ? `${best.vendor?.id} ${best.totalIls} ILS (${best.key})` : 'none'} ranked=${(boards[name]?.ranked ?? []).length} unrankable=${(boards[name]?.unrankable ?? []).length}`);
  }
  for (const entry of checks) {
    console.log(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.name}${entry.ok ? '' : `  (${entry.detail})`}`);
  }
  if (snapshot.savedTo) console.log(`Evidence: ${snapshot.savedTo}`);
}

if (checks.some(entry => !entry.ok)) process.exitCode = 1;
