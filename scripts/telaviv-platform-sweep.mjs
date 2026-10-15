// Tel Aviv–Yafo grocery coverage sweep across the stor.ai / Self-Point platform.
//
//   node scripts/telaviv-platform-sweep.mjs --out docs/evidence/<name>.json
//   node scripts/telaviv-platform-sweep.mjs --from <recorded fetch set> --out <file>
//   node scripts/telaviv-platform-sweep.mjs --probe-storefronts   # adds one
//                                                             # bounded GET per
//                                                             # storefront host
//
// Why this exists: the two registered grocery adapters (Tiv Taam ₪300 minimum,
// Super Yuda ₪150) publish minimum orders above every exact 4/6/8/10-tub batch,
// so the shopping question is which *other* Tel Aviv–Yafo home-delivery store
// publishes a minimum these batches can meet. The platform publishes each
// retailer's own configuration as a public blob on its CDN
// (htmlcache.blob.core.windows.net/html-production-env/r-<id>/…/data.js). Those
// files carry the retailer's published site minimum, its online branches and
// every published delivery area with its minimum and price. Reading them is a
// fixed, public, product-data interface: no storefront page, cart, login or
// access control is touched, and no challenge is solved or bypassed.
//
// Output is evidence only. The sweep establishes *coverage and published
// minimums*; it is not a vendor observation of price or stock and never becomes
// one. A store listed here still needs a reachable public product/cart interface
// before any listing can be ranked.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const CONFIG_HOST = 'https://htmlcache.blob.core.windows.net';
const CONFIG_PATH = id => `/html-production-env/r-${id}/desktop/multi-true/data.js`;

export const HOME_DELIVERY_TYPE_ID = 1; // platform deliveryTypeId 1 = home delivery
export const TEL_AVIV_PATTERNS = [/תל\s*אביב/, /ת"א/, /ת״א/];

const BATCH_ITEM_TOTALS_ILS = [24.4, 36.6, 48.8, 61]; // 4/6/8/10 tubs at the observed ₪6.10–₪6.70 range

export function isIsraeliRetailer(config) {
  return config?.countryIso === 'IL';
}

/** Split a published area name into its named localities (areas can be unions). */
export function areaLocalities(areaName = '') {
  return String(areaName)
    .split(/[,;/]/)
    .map(part => part.trim())
    .filter(Boolean);
}

/** True when a published area name covers Tel Aviv–Yafo (possibly with other cities). */
export function areaCoversTelAviv(areaName = '') {
  return areaLocalities(areaName).some(locality => TEL_AVIV_PATTERNS.some(pattern => pattern.test(locality)));
}

/**
 * Home-delivery areas a retailer publishes that cover Tel Aviv–Yafo.
 * Each entry keeps the branch, the published area minimum, the published price
 * and the binding minimum (area minimum when published, otherwise the site
 * minimum) so a later reader can tell which value blocks a batch.
 */
export function telAvivDeliveryAreas(config) {
  const siteMinimum = numericOrNull(config?.minimumOrderPrice);
  const areas = [];
  for (const branch of config?.branches ?? []) {
    for (const area of branch?.areas ?? []) {
      if (area?.deliveryTypeId !== HOME_DELIVERY_TYPE_ID) continue;
      if (!areaCoversTelAviv(area?.name ?? '')) continue;
      const areaMinimum = numericOrNull(area?.deliveryMinimumCost);
      areas.push({
        branchId: branch?.id ?? null,
        branchCity: branch?.city ?? null,
        branchOnline: branch?.isOnline === true,
        areaId: area?.id ?? null,
        areaName: area?.name ?? null,
        areaMinimum,
        deliveryPrice: numericOrNull(area?.retailerBranchProductDeliveryPrice ?? area?.retailerProductDeliveryPrice),
        siteMinimum,
        bindingMinimum: areaMinimum ?? siteMinimum
      });
    }
  }
  return areas;
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Fold parsed retailer configs into a comparable coverage summary. `fetch` see
 * `telAvivDeliveryAreas`; the sweep also records how many area minimums would
 * admit at least one exact batch (≥ ₪24.40 of items for 4 tubs).
 */
export function summarizeSweep(configs = []) {
  const israeli = configs.filter(isIsraeliRetailer);
  const stores = [];
  for (const config of israeli) {
    const areas = telAvivDeliveryAreas(config);
    stores.push({
      retailerId: config.retailerId ?? null,
      name: config.name ?? null,
      title: config.title ?? null,
      domain: config.domain ?? null,
      siteMinimum: numericOrNull(config.minimumOrderPrice),
      onlineBranches: (config.branches ?? []).filter(branch => branch?.isOnline === true).length,
      telAvivAreas: areas,
      lowestTelAvivBindingMinimum: areas.length ? Math.min(...areas.map(area => area.bindingMinimum ?? Number.POSITIVE_INFINITY)) : null,
      admitsExactBatch: areas.some(area => area.bindingMinimum !== null && area.bindingMinimum <= BATCH_ITEM_TOTALS_ILS[0]),
      publishesNoTelAvivMinimum: areas.some(area => area.bindingMinimum === null)
    });
  }
  const withTelAviv = stores.filter(store => store.telAvivAreas.length);
  const minimums = withTelAviv.map(store => store.lowestTelAvivBindingMinimum).filter(value => value !== null && Number.isFinite(value));
  return {
    retailersRead: configs.length,
    israeliRetailers: israeli.length,
    storesPublishingTelAvivDelivery: withTelAviv.length,
    lowestPublishedTelAvivMinimum: minimums.length ? Math.min(...minimums) : null,
    storesWithNoPublishedTelAvivMinimum: stores.filter(store => store.publishesNoTelAvivMinimum).map(store => store.name),
    storesThatCouldRankABatch: stores.filter(store => store.admitsExactBatch).map(store => store.name),
    stores
  };
}

/** Parse one raw `data.js` body into the fields this sweep needs. */
export function parseRetailerConfig(text, { retailerId } = {}) {
  const start = text.indexOf('{"rid":');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) {
        const frontend = JSON.parse(text.slice(start, index + 1));
        const retailer = frontend.retailer ?? {};
        return {
          retailerId: retailerId ?? retailer.id ?? null,
          name: retailer.name ?? null,
          title: retailer.title ?? null,
          domain: retailer.domain ?? null,
          countryIso: retailer.countryIso ?? null,
          minimumOrderPrice: retailer.settings?.minimumOrderPrice ?? null,
          branches: (retailer.branches ?? []).map(branch => ({
            id: branch.id ?? null,
            name: branch.name ?? null,
            city: branch.city ?? null,
            isOnline: branch.isOnline === true,
            areas: (branch.areas ?? []).map(area => ({
              id: area.id ?? null,
              name: area.name ?? null,
              deliveryTypeId: area.deliveryTypeId ?? null,
              deliveryMinimumCost: area.deliveryMinimumCost ?? null,
              retailerBranchProductDeliveryPrice: area.retailerBranchProductDeliveryPrice ?? null,
              retailerProductDeliveryPrice: area.retailerProductDeliveryPrice ?? null
            }))
          }))
        };
      }
    }
  }
  return null;
}

async function fetchConfig(id, { timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    const response = await fetch(`${CONFIG_HOST}${CONFIG_PATH(id)}`, { signal: controller.signal });
    if (!response.ok) return { retailerId: id, status: response.status, config: null };
    const text = Buffer.from(await response.arrayBuffer()).toString('utf8');
    return { retailerId: id, status: response.status, config: parseRetailerConfig(text, { retailerId: id }) };
  } catch (error) {
    return { retailerId: id, status: 0, error: error?.message ?? String(error), config: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One bounded read-only GET per storefront host with the project's honest user
 * agent. It records whether the runner can reach the store at all; it never
 * solves, retries around or otherwise bypasses a challenge, and a challenge is
 * written down as the blocker it is.
 */
async function probeStorefront(url, { timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'AttentionShoppersBot/0.1 (+public grocery price comparison)', accept: 'text/html' },
      signal: controller.signal
    });
    const body = await response.text();
    return {
      url,
      status: response.status,
      bytes: body.length,
      challenge: /Just a moment|Attention Required|cf-browser-verification|rc.js|Unauthorized Request/i.test(body) ? true : false
    };
  } catch (error) {
    return { url, status: 0, error: error?.message ?? String(error), challenge: false };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const valueOf = flag => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : null;
  };
  const from = valueOf('--from');
  const out = valueOf('--out') ?? `docs/evidence/telaviv-platform-sweep-${new Date().toISOString().replace(/[:.]/g, '')}.json`;
  const fromId = Number(valueOf('--from-id') ?? 1);
  const toId = Number(valueOf('--to-id') ?? 2400);
  const concurrency = Number(valueOf('--concurrency') ?? 8);
  const timeoutMs = Number(valueOf('--timeout') ?? 25_000);
  const probeStorefronts = args.includes('--probe-storefronts');

  let configs = [];
  let source;
  if (from) {
    const recorded = JSON.parse(await readFile(from, 'utf8'));
    configs = (recorded.retailers ?? []).map(entry => entry.config).filter(Boolean);
    source = `recorded fetch set ${from}`;
  } else {
    source = `live bounded read of the platform config CDN, retailer ids ${fromId}-${toId}, concurrency ${concurrency}`;
    const ids = [];
    for (let id = fromId; id <= toId; id++) ids.push(id);
    const rows = [];
    for (let index = 0; index < ids.length; index += concurrency) {
      const batch = await Promise.all(ids.slice(index, index + concurrency).map(id => fetchConfig(id, { timeoutMs })));
      rows.push(...batch);
      if (index % (concurrency * 25) === 0) process.stderr.write(`read ${index}/${ids.length}\n`);
    }
    configs = rows.map(row => row.config).filter(Boolean);
    var reads = { attempted: ids.length, found: configs.length };
  }

  const summary = summarizeSweep(configs);
  const scope = 'Tel Aviv–Yafo home delivery only, per the owner instruction of 2026-10-15';

  let storefronts = null;
  if (probeStorefronts) {
    const urls = [...new Set(summary.stores
      .filter(store => store.telAvivAreas.length && typeof store.domain === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(store.domain))
      .map(store => `https://${store.domain}/`))];
    storefronts = [];
    for (let index = 0; index < urls.length; index += 4) {
      storefronts.push(...await Promise.all(urls.slice(index, index + 4).map(url => probeStorefront(url, { timeoutMs }))));
    }
  }

  const evidence = {
    kind: 'tel-aviv-selfpoint-platform-sweep',
    scope,
    source,
    method: 'Public retailer configuration blobs on the platform CDN (htmlcache.blob.core.windows.net/html-production-env/r-<id>/desktop/multi-true/data.js), read only. Published values used: settings.minimumOrderPrice, branch isOnline, branch areas (deliveryTypeId 1 = home delivery, deliveryMinimumCost, delivery price). No storefront page, cart, login, credential or access control was used; no challenge was solved.',
    storesThatPublishATelAvivHomeDeliveryArea: summary.storesPublishingTelAvivDelivery,
    lowestPublishedTelAvivMinimum: summary.lowestPublishedTelAvivMinimum,
    storesWithNoPublishedTelAvivMinimum: summary.storesWithNoPublishedTelAvivMinimum,
    batchItemTotalsIls: BATCH_ITEM_TOTALS_ILS,
    batchNote: 'Exact 4/6/8/10 × 250 g tub item subtotals at the observed ₪6.10–₪6.70 tub prices: ₪24.40 / ₪36.60 / ₪48.80 / ₪61.00. A published minimum must be at or below the batch item total for that batch to be purchasable; the mandatory delivery fee is added on top.',
    result: null,
    storefrontReachability: storefronts,
    stores: summary.stores.map(store => ({
      retailerId: store.retailerId,
      name: store.name,
      title: store.title,
      domain: store.domain,
      siteMinimum: store.siteMinimum,
      onlineBranches: store.onlineBranches,
      telAvivHomeDeliveryAreas: store.telAvivAreas.map(area => ({
        branchId: area.branchId,
        branchCity: area.branchCity,
        areaId: area.areaId,
        areaName: area.areaName,
        areaMinimum: area.areaMinimum,
        deliveryPrice: area.deliveryPrice,
        bindingMinimum: area.bindingMinimum
      })),
      lowestTelAvivBindingMinimum: store.lowestTelAvivBindingMinimum,
      couldRankAnExactBatch: store.admitsExactBatch
    })),
    disclaimer: 'Coverage and published minimum evidence only. Nothing here is a price or stock observation of the tracked listing and nothing here is ranked on the public board. A store still needs a reachable public product/cart interface before its listing can be compared.'
  };
  if (typeof reads !== 'undefined') evidence.reads = reads;

  const rankingStores = summary.stores.filter(store => store.admitsExactBatch);
  evidence.result = rankingStores.length
    ? `${rankingStores.length} store(s) publish a Tel Aviv–Yafo home-delivery area with a minimum an exact batch can meet; each still needs a reachable public product/cart interface before a listing can be ranked.`
    : `No store on the platform publishes a Tel Aviv–Yafo home-delivery area with a minimum an exact 4/6/8/10-tub batch can meet. The lowest published Tel Aviv–Yafo minimum is ₪${summary.lowestPublishedTelAvivMinimum}; stores with no published minimum are ${summary.storesWithNoPublishedTelAvivMinimum.join(', ') || 'none'}.`;

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(evidence, null, 1)}\n`);
  console.log(`sweep: ${evidence.retailersRead ?? configs.length} retailers read, ${evidence.storesThatPublishATelAvivHomeDeliveryArea} publish a Tel Aviv–Yafo home-delivery area`);
  console.log(`result: ${evidence.result}`);
  console.log(`evidence: ${out}`);
}

import { readFile } from 'node:fs/promises';

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
