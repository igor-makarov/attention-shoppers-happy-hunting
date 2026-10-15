#!/usr/bin/env node
// Regenerate the checked-in published observation snapshot
// (src/data/published-observations.js).
//
//   node scripts/publish-observations.mjs --from <source-check.json>
//   node scripts/publish-observations.mjs --fixture      # offline smoke run against tests/fixtures
//   npm run publish:observations                         # live bounded source check, then write
//   node scripts/publish-observations.mjs --check        # validate the checked-in file, write nothing
//
// What the snapshot is: a read-only record of one bounded runner source check.
// The observations it holds are the exact parse results of that run — the same
// vendor pages, the same `observedAt`, price, stock, availability evidence and
// shipping evidence times the adapters recorded at the time. It is never
// runtime state: the Worker merges it into board *reads* when the live store has
// no current observation for an offer, so a shopper can see verified runner
// evidence while the scheduled refresh is blocked or pending.
//
// Rules enforced here so the published file can never drift into fiction:
//   - every observation keeps the run's own recorded timestamps; nothing is
//     re-stamped with the publish time;
//   - every row must come from a registered adapter, name a tracked product and
//     carry a finite positive price and a real observation time inside the run
//     window;
//   - a synthetic QA/demo observation is rejected (those live only in the
//     offline QA server);
//   - a run in which a registered adapter produced nothing is refused unless
//     --allow-partial is passed, and then the missing vendors are named in the
//     snapshot metadata instead of being silently dropped.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { registeredVendors } from '../src/vendors/index.js';
import { products } from '../src/catalog.js';
import { createBoundedFetcher } from '../src/lib/http.js';
import { createFixtureFetch } from '../tests/fixtures/vendor-fixtures.mjs';

const DEFAULT_OUT = new URL('../src/data/published-observations.js', import.meta.url);

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = name => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : null;
};

const fromFile = option('from');
const outFile = option('out') ? new URL(option('out'), import.meta.url) : DEFAULT_OUT;
const useFixtures = flag('fixture');
const allowPartial = flag('allow-partial');
const checkOnly = flag('check');

if (!fromFile && !useFixtures && !checkOnly) {
  console.error('Refusing to publish without a source. Pass --from <source-check.json>, --fixture or --check.');
  process.exit(2);
}

const trackedProductIds = new Set(products.map(product => product.id));

async function runSourceCheck() {
  const now = Date.now();
  const startedAt = new Date(now).toISOString();
  const fetchImpl = useFixtures ? createFixtureFetch() : globalThis.fetch;
  const vendors = [];
  for (const vendor of registeredVendors()) {
    const fetchText = createBoundedFetcher({
      fetchImpl,
      allowedHosts: vendor.allowedHosts,
      minIntervalMs: useFixtures ? 0 : (vendor.crawlDelayMs ?? 0)
    });
    let outcome;
    try {
      outcome = await vendor.observe({ fetchText, now });
    } catch (error) {
      outcome = { observations: [], failures: [{ offerId: '*', error: error?.message ?? String(error) }] };
    }
    vendors.push({
      vendorId: vendor.id,
      vendorName: vendor.name,
      parserVersion: vendor.parserVersion,
      observations: outcome.observations ?? [],
      failures: outcome.failures ?? []
    });
  }
  return { mode: useFixtures ? 'fixtures' : 'live', startedAt, finishedAt: new Date().toISOString(), vendors };
}

const report = fromFile
  ? JSON.parse(await readFile(new URL(`../${fromFile.replace(/^\.?\//, '')}`, import.meta.url), 'utf8'))
  : await runSourceCheck();

const runStartedMs = Date.parse(report.startedAt ?? '');
const runFinishedMs = Date.parse(report.finishedAt ?? report.startedAt ?? '');
const trackedAdapterIds = new Set(registeredVendors().map(vendor => vendor.id));

/** One recorded observation for the snapshot, or a rejection reason. */
function accept(observation, vendorId) {
  const problems = [];
  if (!trackedAdapterIds.has(vendorId)) problems.push(`vendor ${vendorId} is not a registered adapter`);
  if (observation?.vendor?.id !== vendorId) problems.push('observation vendor id does not match the reporting adapter');
  if (/^qa-/.test(vendorId)) problems.push('QA/demo observations are never published');
  const productId = observation?.product?.productId ?? null;
  if (!trackedProductIds.has(productId)) problems.push(`product ${productId} is not tracked`);
  if (!Number.isFinite(observation?.price?.amount) || observation.price.amount <= 0) problems.push('price is missing or not positive');
  if (!observation?.itemUrl || !/^https:\/\//.test(observation.itemUrl)) problems.push('itemUrl must be an https vendor URL');
  const observedMs = Date.parse(observation?.observedAt ?? '');
  if (!Number.isFinite(observedMs)) {
    problems.push('observedAt is missing or not an ISO time');
  } else if (Number.isFinite(runStartedMs) && Number.isFinite(runFinishedMs)
    && (observedMs < runStartedMs - 1000 || observedMs > runFinishedMs + 1000)) {
    // The timestamp must belong to the recorded run, not to the publish step.
    problems.push(`observedAt ${observation.observedAt} is outside the recorded run window`);
  }
  if (!observation?.availability) problems.push('availability is missing');
  return problems;
}

const accepted = [];
const rejected = [];
const missingVendors = [];
for (const vendor of report.vendors ?? []) {
  const observations = vendor.observations ?? [];
  if (!observations.length) {
    missingVendors.push(vendor.vendorId);
    continue;
  }
  for (const observation of observations) {
    const problems = accept(observation, vendor.vendorId);
    if (problems.length) rejected.push({ vendorId: vendor.vendorId, problems });
    else accepted.push({ observation, vendorId: vendor.vendorId, parserVersion: vendor.parserVersion });
  }
}

if (rejected.length) {
  console.error('Refusing to publish: some recorded observations are not valid snapshot evidence.');
  for (const entry of rejected) console.error(`  ${entry.vendorId}: ${entry.problems.join('; ')}`);
  process.exit(1);
}
if (missingVendors.length && !allowPartial) {
  console.error(`Refusing to publish: ${missingVendors.join(', ')} produced no observation in this run.`);
  console.error('Re-run the check, or pass --allow-partial to name the missing vendors in the snapshot metadata.');
  process.exit(1);
}
if (!accepted.length) {
  console.error('Refusing to publish an empty snapshot.');
  process.exit(1);
}

accepted.sort((a, b) => a.vendorId.localeCompare(b.vendorId));
const iso = new Date(runStartedMs).toISOString();
const runStamp = iso.slice(0, 19).replace(/[-:]/g, ''); // 20261015T200921
const snapshotId = `runner-source-check-${runStamp}`;
const evidenceName = `source-check-${iso.slice(0, 10).replace(/-/g, '')}T${iso.slice(11, 16).replace(':', '')}Z.json`;
const evidencePath = fromFile
  ? String(fromFile).replace(/^\.\//, '')
  : `docs/evidence/${evidenceName}`;

const snapshot = {
  id: snapshotId,
  label: `Runner source check — ${new Date(runStartedMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  origin: 'runner-research',
  source: useFixtures
    ? 'Offline fixture replay of the registered adapters (development smoke run, not vendor evidence)'
    : 'GitHub Actions runner · npm run check:sources (bounded fetcher, published crawl delays, AttentionShoppersBot user agent)',
  recordedAt: new Date(runStartedMs).toISOString(),
  window: { startedAt: report.startedAt, finishedAt: report.finishedAt },
  evidence: evidencePath,
  mode: report.mode ?? 'live',
  adapters: [...new Set(accepted.map(entry => `${entry.vendorId}@${entry.parserVersion}`))].sort(),
  unavailableVendors: missingVendors,
  note: 'Read-only evidence merged into board reads when the Worker store has no current observation for an offer. Each observation keeps the recorded times of this run; runner research is labelled separately from a successful Worker refresh and is never used to update the store.',
  observations: accepted.map(entry => entry.observation)
};

if (checkOnly) {
  const current = await readFile(DEFAULT_OUT, 'utf8');
  const marker = 'export const PUBLISHED_SNAPSHOT = ';
  const markerAt = current.indexOf(marker);
  const start = (markerAt >= 0 ? markerAt + marker.length : current.indexOf('{'));
  const embedded = JSON.parse(current.slice(start, current.lastIndexOf('}') + 1));
  const same = JSON.stringify(embedded) === JSON.stringify(snapshot);
  console.log(`${same ? 'MATCH' : 'DIFFER'}  ${snapshotId}: ${snapshot.observations.length} observations`);
  process.exit(same ? 0 : 1);
}

const body = `// Checked-in published observation snapshot (read-only evidence).
//
// Generated by scripts/publish-observations.mjs from one bounded runner source
// check; regenerate it with \`npm run publish:observations\` (live) or
// \`node scripts/publish-observations.mjs --from <recorded run>\` after new
// runner research. Do not hand-edit the rows: every value must stay the exact
// recorded evidence of the run named below, including its observation times.
//
// The Worker merges these rows into board reads (src/lib/published-observations.js)
// when its own store has no current observation for an offer. That is what lets
// the public board show verified runner research while the scheduled refresh is
// blocked or pending. The snapshot is never written into the store, never
// counted as a Worker refresh and never used to claim a fresh vendor check.

export const PUBLISHED_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};

export default PUBLISHED_SNAPSHOT;
`;

await mkdir(new URL('./', outFile), { recursive: true });
await writeFile(outFile, body);
console.log(`Published ${snapshot.observations.length} observations from ${snapshot.label}`);
console.log(`  snapshot id: ${snapshot.id}`);
console.log(`  evidence:    ${snapshot.evidence}`);
console.log(`  output:      ${outFile.pathname}`);
