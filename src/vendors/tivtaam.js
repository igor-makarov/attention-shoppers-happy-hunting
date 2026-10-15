// Tiv Taam (tivtaam.co.il), Ramat HaHayal branch 924 — the online delivery
// branch — tracked Tnuva 5% cottage cheese in 250 g tubs.
//
// Source of truth: the store's own public Self-Point JSON API. The product
// endpoint is the same one the storefront calls for
// https://www.tivtaam.co.il/?catalogProduct=12053 and carries the branch price,
// the active/visible flags and the branch out-of-stock flag for the exact
// listing. Delivery is not on the product endpoint; it comes from the branch's
// public delivery-areas endpoint and the published site terms, both recorded in
// the shared policy (src/lib/policies.js, `tivtaamCottageCheesePolicy`):
// seven active areas, each ₪29.90 home delivery with no per-area minimum, and a
// published ₪300 minimum order (terms clause 16.1 / config minimumOrderPrice)
// that keeps a standalone 4-10 tub batch below the vendor minimum.
//
// Evidence (GitHub Actions runner, 2026-10-15): anonymous public cart API quotes
// for exact batches 4/6/8/10 tubs were ₪24.40/₪36.60/₪48.80/₪61.00 plus ₪29.90
// delivery = ₪54.30/₪66.50/₪78.70/₪90.90; no street address, login, payment or
// order was involved. The checkout requires login, so the published minimum
// order is treated as the binding condition instead of the cart's silence.
// See docs/evidence/tnuva-cottage-cheese-runner-research-20261015.json.

import { classifyListing } from '../catalog.js';
import { tivtaamCottageCheesePolicy, policyIsCurrent } from '../lib/policies.js';
import { createObservation, parseError } from './index.js';

// The product page the storefront publishes; it is the offer's provenance URL.
export const TIVTAAM_PRODUCT_URL = 'https://www.tivtaam.co.il/?catalogProduct=12053';
// The public JSON endpoint behind that page (retailer 1062 = Tiv Taam, branch
// 924 = Ramat HaHayal, the online delivery branch).
export const TIVTAAM_PRODUCT_API = 'https://www.tivtaam.co.il/v2/retailers/1062/branches/924/products?catalogProductId=12053&ignoreBranchVisibility=true&appId=4&languageId=2';

const AVAILABILITY_NOTE = 'Availability comes from the store API branch flags (isActive, isVisible, isOutOfStock), not from a price-only scrape.';

/**
 * Pick the row the online store would actually sell: an active, visible branch
 * row. The endpoint can also return a retired/hidden row for the same catalog
 * product (it did on 2026-10-15: an inactive ₪5.70 row beside the active ₪6.10
 * one), so selection is explicit and the ignored row is reported in evidence.
 */
export function selectTivtaamProduct(products = []) {
  const rows = products.filter(product => product && product.branch && Number.isFinite(Number(product.branch.regularPrice)));
  if (!rows.length) return null;
  const sellable = rows.filter(product => product.branch.isActive === true && product.branch.isVisible === true);
  const pool = sellable.length ? sellable : rows;
  const inStock = pool.find(product => product.branch.isOutOfStock !== true);
  return inStock ?? pool[0];
}

export function parseTivtaamProduct(json, { now, itemUrl = TIVTAAM_PRODUCT_URL, apiUrl = TIVTAAM_PRODUCT_API, productId = null } = {}) {
  let data;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw parseError('Tiv Taam product API did not return JSON', { url: apiUrl, error: error.message });
  }
  const products = Array.isArray(data?.products) ? data.products : [];
  const product = selectTivtaamProduct(products);
  if (!product) throw parseError('No sellable branch product in the Tiv Taam API response', { url: apiUrl });

  // The Hebrew row name does not state the brand, so classification uses the
  // vendor's own English name, which does ("Cottage Tnuva (5%) 250 g"). The raw
  // Hebrew/English wording stays on the observation as provenance.
  const hebrewName = product.names?.['1']?.long ?? product.localName ?? '';
  const englishName = product.names?.['2']?.long ?? '';
  const classification = classifyListing(englishName || hebrewName, { productId });
  if (!classification.matched) {
    throw parseError('Listing does not match the tracked product', {
      name: englishName || hebrewName,
      reasons: classification.reasons
    });
  }

  const priceAmount = Number(product.branch.regularPrice);
  if (!Number.isFinite(priceAmount) || priceAmount <= 0) {
    throw parseError('Price missing from the Tiv Taam branch product', { price: product.branch.regularPrice });
  }

  const outOfStock = product.branch.isOutOfStock === true;
  const active = product.branch.isActive === true && product.branch.isVisible === true;
  const availability = outOfStock ? 'out_of_stock' : (active ? 'in_stock' : 'unknown');

  const policyCurrent = policyIsCurrent(tivtaamCottageCheesePolicy, now);
  const policyStamp = {
    id: tivtaamCottageCheesePolicy.id,
    version: tivtaamCottageCheesePolicy.version,
    origin: tivtaamCottageCheesePolicy.origin,
    retrievedAt: tivtaamCottageCheesePolicy.evidence.retrievedAt,
    reviewBy: tivtaamCottageCheesePolicy.reviewBy,
    thresholdSemantics: tivtaamCottageCheesePolicy.rule.thresholdSemantics ?? null
  };
  const shipping = policyCurrent
    ? {
        mode: 'delivery',
        service: tivtaamCottageCheesePolicy.service,
        certainty: tivtaamCottageCheesePolicy.certainty,
        amount: { ...tivtaamCottageCheesePolicy.rule.amount },
        minOrder: { ...tivtaamCottageCheesePolicy.rule.minOrder },
        freeThreshold: null,
        destination: { ...tivtaamCottageCheesePolicy.destination },
        note: `${tivtaamCottageCheesePolicy.evidence.note} Home delivery only; self-pickup is not part of the delivered comparison.`,
        policy: policyStamp,
        evidence: { ...tivtaamCottageCheesePolicy.evidence }
      }
    : {
        mode: 'delivery',
        service: tivtaamCottageCheesePolicy.service,
        certainty: 'unknown',
        amount: null,
        minOrder: { ...tivtaamCottageCheesePolicy.rule.minOrder },
        freeThreshold: null,
        destination: { scope: tivtaamCottageCheesePolicy.destination.scope, country: 'IL', localities: [...tivtaamCottageCheesePolicy.destination.localities] },
        note: `The researched Tiv Taam delivery terms are past their review date (${tivtaamCottageCheesePolicy.reviewBy}) and are not applied until they are re-checked; shipping is unknown, not free.`,
        policy: policyStamp
      };

  return createObservation({
    vendor: {
      id: 'tivtaam',
      name: 'Tiv Taam (טיב טעם)',
      homepage: 'https://www.tivtaam.co.il'
    },
    itemUrl,
    product: {
      productId: classification.productId,
      name: hebrewName || englishName,
      sku: String(product.productId ?? '12053'),
      gtin: null,
      form: classification.form,
      packGrams: classification.packGrams,
      packCount: classification.packCount,
      totalGrams: classification.totalGrams,
      category: product.branch.aisleName ?? null
    },
    price: { amount: priceAmount, currency: 'ILS' },
    availability,
    availabilityEvidence: {
      url: apiUrl,
      value: `isActive=${product.branch.isActive} isVisible=${product.branch.isVisible} isOutOfStock=${product.branch.isOutOfStock}`,
      note: `${AVAILABILITY_NOTE} The ignored rows (${Math.max(0, products.length - 1)}) are recorded for provenance only and never priced.`
    },
    shipping,
    now
  });
}

export const tivtaam = {
  id: 'tivtaam',
  name: 'Tiv Taam (טיב טעם)',
  homepage: 'https://www.tivtaam.co.il',
  allowedHosts: ['tivtaam.co.il', 'www.tivtaam.co.il'],
  parserVersion: 'tivtaam/1',
  // robots.txt asks for a 4-second crawl delay; the refresh pipeline spaces the
  // single tracked offer request to this host accordingly.
  crawlDelayMs: 4000,
  offers: [
    {
      id: 'tnuva-cottage-5-250g',
      url: TIVTAAM_PRODUCT_API,
      itemUrl: TIVTAAM_PRODUCT_URL,
      kind: 'delivery',
      productId: 'tnuva-cottage-cheese-5-percent'
    }
  ],

  async observe({ fetchText, now }) {
    const observations = [];
    const failures = [];
    for (const offer of this.offers) {
      const response = await fetchText(offer.url, { accept: 'application/json' });
      if (!response.ok) {
        failures.push({ offerId: offer.id, url: offer.url, error: response.error ?? `HTTP ${response.status}` });
        continue;
      }
      try {
        observations.push(parseTivtaamProduct(response.text, {
          now,
          itemUrl: offer.itemUrl ?? TIVTAAM_PRODUCT_URL,
          apiUrl: offer.url,
          productId: offer.productId ?? null
        }));
      } catch (error) {
        failures.push({ offerId: offer.id, url: offer.url, error: error.message, details: error.details ?? null });
      }
    }
    return { observations, failures };
  }
};
