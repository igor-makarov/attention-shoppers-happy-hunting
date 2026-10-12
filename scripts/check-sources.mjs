#!/usr/bin/env node
// Live source check for the registered vendor adapters.
//
//   npm run check:sources              # fetch every tracked listing and parse it
//   npm run check:sources -- --json    # machine-readable full observations
//   npm run check:sources -- --fixture # parse the recorded fixtures instead of the network
//
// This runs the exact bounded fetcher and adapter parsers used by the scheduled
// refresh, so a parse failure here is a real regression against the live page.
// Evidence is written to .shurik-local/sources/<timestamp>.json unless
// --no-save is passed. Exit code 1 when any vendor produced no observation.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { registeredVendors } from '../src/vendors/index.js';
import { createBoundedFetcher } from '../src/lib/http.js';

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const useFixtures = args.has('--fixture');
const save = !args.has('--no-save');
const vendors = registeredVendors();
const now = Date.now();
const startedAt = new Date(now).toISOString();

const fixtureFetch = async url => {
  if (url.includes('coffeeman.co.il')) {
    const bytes = await readFile(new URL('../tests/fixtures/coffeeman-product.windows-1255.html', import.meta.url));
    return new Response(bytes, { status: 200, headers: { 'content-type': 'text/html; charset=windows-1255' } });
  }
  if (url.includes('pucks.co.il')) {
    const html = await readFile(new URL('../tests/fixtures/pucks-product.html', import.meta.url), 'utf8');
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  return new Response('not found', { status: 404 });
};

const fetchImpl = useFixtures ? fixtureFetch : globalThis.fetch;
const results = [];
let failed = false;

for (const vendor of vendors) {
  const fetchText = createBoundedFetcher({ fetchImpl, allowedHosts: vendor.allowedHosts });
  const vendorStarted = Date.now();
  let outcome;
  try {
    outcome = await vendor.observe({ fetchText, now });
  } catch (error) {
    outcome = { observations: [], failures: [{ offerId: '*', error: error?.message ?? String(error) }] };
  }
  const ok = (outcome.observations ?? []).length > 0 &&
    (outcome.observations ?? []).every(observation => observation.observedAt === startedAt);
  if (!ok) failed = true;
  results.push({
    vendorId: vendor.id,
    vendorName: vendor.name,
    parserVersion: vendor.parserVersion,
    ok,
    durationMs: Date.now() - vendorStarted,
    observations: outcome.observations ?? [],
    failures: outcome.failures ?? []
  });
}

const report = {
  mode: useFixtures ? 'fixtures' : 'live',
  startedAt,
  finishedAt: new Date().toISOString(),
  vendors: results
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Source check (${report.mode}) at ${startedAt}`);
  for (const vendor of results) {
    console.log(`\n${vendor.ok ? 'PASS' : 'FAIL'}  ${vendor.vendorName} [${vendor.vendorId}] parser=${vendor.parserVersion} ${vendor.durationMs}ms`);
    for (const observation of vendor.observations) {
      const product = observation.product;
      console.log(`  offer      ${observation.itemUrl}`);
      console.log(`  product    ${product.name}`);
      console.log(`  identity   variant=${product.variantId} form=${product.form} pack=${product.packGrams}g x${product.packCount} sku=${product.sku ?? '-'}`);
      console.log(`  price      ${observation.price.amount} ${observation.price.currency}`);
      console.log(`  stock      ${observation.availability} (${observation.availabilityEvidence?.value ?? 'no evidence value'})`);
      console.log(`  shipping   certainty=${observation.shipping.certainty} amount=${observation.shipping.amount ? `${observation.shipping.amount.amount} ${observation.shipping.amount.currency}` : 'unknown'}`);
      console.log(`  note       ${observation.shipping.note}`);
      console.log(`  checked    ${observation.observedAt}`);
    }
    for (const failure of vendor.failures) {
      console.log(`  failure    ${failure.offerId}: ${failure.error}`);
    }
  }
}

if (save) {
  const dir = new URL('../.shurik-local/sources/', import.meta.url);
  await mkdir(dir, { recursive: true });
  const file = new URL(`${startedAt.replace(/[:.]/g, '-')}.json`, dir);
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nEvidence: ${file.pathname}`);
}

process.exitCode = failed ? 1 : 0;
