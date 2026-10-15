// Duchan Ganei Shmuel (duchan.co.il), branch 2175 — the store's only online
// branch — tracked Tnuva 5% cottage cheese in 250 g tubs.
//
// Source of truth: the store's own public Self-Point/stor.ai JSON API. The
// product endpoint is the same one the storefront calls for
// https://www.duchan.co.il/?catalogProduct=12053 and carries the branch price,
// the active/visible flags, the branch out-of-stock flag and the vendor's
// published per-line quantity limit for the exact listing. Delivery is not on
// the product endpoint; it comes from the branch's public delivery-areas
// endpoint and the retailer config, both recorded in the shared policy
// (src/lib/policies.js, `duchanCottageCheesePolicy`): the branch's local
// גן שמואל area publishes deliveryAreaPrice ₪28 with no deliveryMinimumCost,
// while every other area (Pardes Hanna-Karkur, Or Akiva, Zikhron Ya'akov, …)
// publishes a ₪250 minimum order. The store's published banner/FAQ state there
// is no minimum order and delivery is free above ₪599 (valid until
// 31.12.2026), so an exact 4-10 tub batch is purchasable and ranked.
//
// Evidence (GitHub Actions runner, 2026-10-15): anonymous public cart API
// quotes for exact batches 4/6/8/10 tubs were ₪25.20/₪37.80/₪50.40/₪63.00 plus
// the ₪28 delivery line = ₪53.20/₪65.80/₪78.40/₪91.00; no street address,
// login, payment or order was involved. The cart line must be added by the
// row's own `id` (retailerProductId 9469068), not the branch product id, or
// the store marks it inactive. See
// docs/evidence/tnuva-cottage-cheese-duchan-cart-20261015.json.

import { classifyListing } from '../catalog.js';
import { duchanCottageCheesePolicy, policyIsCurrent } from '../lib/policies.js';
import { createObservation, parseError } from './index.js';

// The product page the storefront publishes; it is the offer's provenance URL.
export const DUCHAN_PRODUCT_URL = 'https://www.duchan.co.il/?catalogProduct=12053';
// The public JSON endpoint behind that page (retailer 1420 = Duchan Ganei
// Shmuel, branch 2175 = the store's only online branch).
export const DUCHAN_PRODUCT_API = 'https://www.duchan.co.il/v2/retailers/1420/branches/2175/products?catalogProductId=12053&ignoreBranchVisibility=true&appId=4&languageId=2';
export const DUCHAN_AREAS_API = 'https://www.duchan.co.il/v2/retailers/1420/branches/2175/areas?appId=4&deliveryTypeId=1&languageId=1';

const AVAILABILITY_NOTE = 'Availability comes from the store API branch flags (isActive, isVisible, isOutOfStock), not from a price-only scrape.';

/**
 * Pick the row the online store would actually sell: an active, visible branch
 * row. The endpoint can also return retired/hidden rows for the same catalog
 * product, so selection is explicit and the ignored rows are reported in
 * evidence. On 2026-10-15 branch 2175 returned exactly one sellable row
 * (id 9469068, branchProductId 16375166, ₪6.30, in stock).
 */
export function selectDuchanProduct(products = []) {
  const rows = products.filter(product => product && product.branch && Number.isFinite(Number(product.branch.regularPrice)));
  if (!rows.length) return null;
  const sellable = rows.filter(product => product.branch.isActive === true && product.branch.isVisible === true);
  const pool = sellable.length ? sellable : rows;
  const inStock = pool.find(product => product.branch.isOutOfStock !== true);
  return inStock ?? pool[0];
}

/**
 * The catalog API carries the listing under localized names. The Hebrew primary
 * name does not state the brand ("קוטג' 5%"), while the store's English name
 * does ("Cottage Tnuva (5%) 250 g"), so classification tries each raw vendor
 * name and keeps the first one that ties to the tracked product. Raw wording
 * stays on the observation as provenance; it is never a filter.
 */
export function classifyDuchanNames(product = {}, productId = null) {
  const names = product.names ?? {};
  const candidates = [
    names['1']?.long, names['1']?.short,
    names['2']?.long, names['2']?.short,
    names['4']?.long, names['4']?.short,
    product.localName
  ].filter(Boolean);
  const attempts = candidates.map(value => ({ value, classification: classifyListing(value, { productId }) }));
  const matched = attempts.find(attempt => attempt.classification.matched) ?? null;
  return { matched, attempts };
}

export function parseDuchanProduct(json, { now, itemUrl = DUCHAN_PRODUCT_URL, apiUrl = DUCHAN_PRODUCT_API, productId = null } = {}) {
  let data;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw parseError('Duchan product API did not return JSON', { url: apiUrl, error: error.message });
  }
  const products = Array.isArray(data?.products) ? data.products : [];
  const product = selectDuchanProduct(products);
  if (!product) throw parseError('No sellable branch product in the Duchan API response', { url: apiUrl });

  const { matched, attempts } = classifyDuchanNames(product, productId);
  if (!matched) {
    const fallback = attempts[0]?.classification;
    throw parseError('Listing does not match the tracked product', {
      names: attempts.map(attempt => attempt.value),
      reasons: fallback?.reasons ?? ['no vendor name was present']
    });
  }
  const classification = matched.classification;

  const priceAmount = Number(product.branch.regularPrice);
  if (!Number.isFinite(priceAmount) || priceAmount <= 0) {
    throw parseError('Price missing from the Duchan branch product', { price: product.branch.regularPrice });
  }

  const outOfStock = product.branch.isOutOfStock === true;
  const active = product.branch.isActive === true && product.branch.isVisible === true;
  const availability = outOfStock ? 'out_of_stock' : (active ? 'in_stock' : 'unknown');
  // The vendor's own published per-line cap (quantityLimit 999 on 2026-10-15),
  // far above every requested batch; recording it keeps the cap verified
  // instead of assumed.
  const quantityLimit = Number(product.quantityLimit);
  const maxUnits = Number.isFinite(quantityLimit) && quantityLimit > 0 ? quantityLimit : null;

  const policyCurrent = policyIsCurrent(duchanCottageCheesePolicy, now);
  const policyStamp = {
    id: duchanCottageCheesePolicy.id,
    version: duchanCottageCheesePolicy.version,
    origin: duchanCottageCheesePolicy.origin,
    retrievedAt: duchanCottageCheesePolicy.evidence.retrievedAt,
    reviewBy: duchanCottageCheesePolicy.reviewBy,
    thresholdSemantics: duchanCottageCheesePolicy.rule.thresholdSemantics ?? null
  };
  const shipping = policyCurrent
    ? {
        mode: 'delivery',
        service: duchanCottageCheesePolicy.service,
        certainty: duchanCottageCheesePolicy.certainty,
        amount: { ...duchanCottageCheesePolicy.rule.amount },
        minOrder: null,
        freeThreshold: { ...duchanCottageCheesePolicy.rule.freeThreshold },
        freeThresholdSemantics: duchanCottageCheesePolicy.rule.thresholdSemantics,
        freeThresholdOrigin: 'published',
        freeThresholdEvidence: {
          url: 'https://www.duchan.co.il/?catalogProduct=12053',
          note: 'The store banner and FAQ publish free delivery above ₪599 (valid until 31.12.2026); every requested 4-10 tub batch stays below it, so the ₪28 delivery line applies.'
        },
        destination: { ...duchanCottageCheesePolicy.destination },
        note: `${duchanCottageCheesePolicy.evidence.note} Home delivery only; self-pickup is not part of the delivered comparison.`,
        policy: policyStamp,
        evidence: { ...duchanCottageCheesePolicy.evidence }
      }
    : {
        mode: 'delivery',
        service: duchanCottageCheesePolicy.service,
        certainty: 'unknown',
        amount: null,
        minOrder: null,
        freeThreshold: { ...duchanCottageCheesePolicy.rule.freeThreshold },
        freeThresholdSemantics: duchanCottageCheesePolicy.rule.thresholdSemantics,
        freeThresholdOrigin: 'published',
        destination: { scope: duchanCottageCheesePolicy.destination.scope, country: 'IL', localities: [...duchanCottageCheesePolicy.destination.localities] },
        note: `The researched Duchan delivery terms are past their review date (${duchanCottageCheesePolicy.reviewBy}) and are not applied until they are re-checked; shipping is unknown, not free.`,
        policy: policyStamp
      };

  return createObservation({
    vendor: {
      id: 'duchan',
      name: 'Duchan Ganei Shmuel (דוכן גן שמואל)',
      homepage: 'https://www.duchan.co.il'
    },
    itemUrl,
    product: {
      productId: classification.productId,
      name: matched.value,
      sku: String(product.productId ?? '12053'),
      gtin: product.externalId != null ? String(product.externalId) : null,
      form: classification.form,
      packGrams: classification.packGrams,
      packCount: classification.packCount,
      totalGrams: classification.totalGrams,
      category: product.family?.names?.['2']?.name ?? null
    },
    price: { amount: priceAmount, currency: 'ILS' },
    availability,
    availabilityEvidence: {
      url: apiUrl,
      value: `isActive=${product.branch.isActive} isVisible=${product.branch.isVisible} isOutOfStock=${product.branch.isOutOfStock} quantityLimit=${product.quantityLimit ?? 'not stated'}`,
      note: `${AVAILABILITY_NOTE} The ignored rows (${Math.max(0, products.length - 1)}) are recorded for provenance only and never priced.`
    },
    shipping,
    maxUnits,
    now
  });
}

export const duchan = {
  id: 'duchan',
  name: 'Duchan Ganei Shmuel (דוכן גן שמואל)',
  homepage: 'https://www.duchan.co.il',
  allowedHosts: ['duchan.co.il', 'www.duchan.co.il'],
  parserVersion: 'duchan/1',
  // robots.txt asks for a 4-second crawl delay; the refresh pipeline spaces the
  // single tracked offer request to this host accordingly.
  crawlDelayMs: 4000,
  offers: [
    {
      id: 'tnuva-cottage-5-250g',
      url: DUCHAN_PRODUCT_API,
      itemUrl: DUCHAN_PRODUCT_URL,
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
        observations.push(parseDuchanProduct(response.text, {
          now,
          itemUrl: offer.itemUrl ?? DUCHAN_PRODUCT_URL,
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
