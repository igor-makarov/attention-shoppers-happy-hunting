// Super Yuda (yuda.co.il), branch 2481 (ישעיהו, Tel Aviv–Yafo) — one of the
// store's online Tel Aviv branches — tracked Tnuva 5% cottage cheese in 250 g
// tubs.
//
// Source of truth: the store's own public Self-Point/stor.ai JSON API. The
// product endpoint is the same one the storefront calls for
// https://www.yuda.co.il/?catalogProduct=12053 and carries the branch price,
// the active/visible flags, the branch out-of-stock flag and the vendor's
// published per-line quantity limit for the exact listing. Delivery is not on
// the product endpoint; it comes from the branch's public delivery-areas
// endpoint and the retailer config, both recorded in the shared policy
// (src/lib/policies.js, `yudaCottageCheesePolicy`): area "ישעיהו תל אביב"
// publishes deliveryAreaPrice ₪35 and deliveryMinimumCost ₪150, and the
// retailer config minimumOrderPrice is ₪150. The ₪150 minimum keeps a
// standalone 4-10 tub batch (₪26.80-₪67.00 item + ₪35 delivery) below the
// vendor minimum, so no exact batch is purchasable there.
//
// Evidence (GitHub Actions runner, 2026-10-15): the public product API returned
// ₪6.70 per 250 g tub, isActive/isVisible true and isOutOfStock false with
// quantityLimit 999; the public areas endpoint returned the Tel Aviv area with
// ₪35 delivery and a ₪150 minimum. The store's Radware WAF served a bot
// challenge for cart PATCH/GET reads from the runner, so no anonymous-cart
// total was read; the adapter relies on the store's published product/area
// endpoints and never claims a cart quote. No street address, login, payment
// or order was involved. See
// docs/evidence/tnuva-cottage-cheese-runner-research-20261015.json.

import { classifyListing } from '../catalog.js';
import { yudaCottageCheesePolicy, policyIsCurrent } from '../lib/policies.js';
import { createObservation, parseError } from './index.js';

// The product page the storefront publishes; it is the offer's provenance URL.
export const YUDA_PRODUCT_URL = 'https://www.yuda.co.il/?catalogProduct=12053';
// The public JSON endpoint behind that page (retailer 1492 = Super Yuda,
// branch 2481 = ישעיהו, Tel Aviv).
export const YUDA_PRODUCT_API = 'https://www.yuda.co.il/v2/retailers/1492/branches/2481/products?catalogProductId=12053&ignoreBranchVisibility=true&appId=4&languageId=2';

const AVAILABILITY_NOTE = 'Availability comes from the store API branch flags (isActive, isVisible, isOutOfStock), not from a price-only scrape.';

/**
 * Pick the row the online store would actually sell: an active, visible branch
 * row. The endpoint can also return retired/hidden rows for the same catalog
 * product, so selection is explicit and the ignored rows are reported in
 * evidence. On 2026-10-15 the Tel Aviv branches בארט and נחלת בנימין carried
 * hidden (isVisible false) ₪6.70/₪5.70 rows that must never be priced; the
 * three visible Tel Aviv branches (ישעיהו, אינשטיין, בן ציון) all priced the
 * same ₪6.70 with the same ₪35/₪150 delivery terms.
 */
export function selectYudaProduct(products = []) {
  const rows = products.filter(product => product && product.branch && Number.isFinite(Number(product.branch.regularPrice)));
  if (!rows.length) return null;
  const sellable = rows.filter(product => product.branch.isActive === true && product.branch.isVisible === true);
  const pool = sellable.length ? sellable : rows;
  const inStock = pool.find(product => product.branch.isOutOfStock !== true);
  return inStock ?? pool[0];
}

/**
 * The catalog API carries the same listing under several localized names. The
 * Hebrew primary name does not state the brand, while the store's second name
 * ("קוטג' 5% תנובה מהדרין 250 גרם") does, so classification tries each raw
 * vendor name and keeps the first one that ties to the tracked product. Raw
 * wording stays on the observation as provenance; it is never a filter.
 */
export function classifyYudaNames(product = {}, productId = null) {
  const names = product.names ?? {};
  const candidates = [
    names['1']?.long, names['1']?.short,
    names['2']?.long, names['2']?.short,
    names['4']?.long, names['4']?.short,
    names['6']?.long, names['6']?.short,
    product.localName
  ].filter(Boolean);
  const attempts = candidates.map(value => ({ value, classification: classifyListing(value, { productId }) }));
  const matched = attempts.find(attempt => attempt.classification.matched) ?? null;
  return { matched, attempts };
}

export function parseYudaProduct(json, { now, itemUrl = YUDA_PRODUCT_URL, apiUrl = YUDA_PRODUCT_API, productId = null } = {}) {
  let data;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw parseError('Super Yuda product API did not return JSON', { url: apiUrl, error: error.message });
  }
  const products = Array.isArray(data?.products) ? data.products : [];
  const product = selectYudaProduct(products);
  if (!product) throw parseError('No sellable branch product in the Super Yuda API response', { url: apiUrl });

  const { matched, attempts } = classifyYudaNames(product, productId);
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
    throw parseError('Price missing from the Super Yuda branch product', { price: product.branch.regularPrice });
  }

  const outOfStock = product.branch.isOutOfStock === true;
  const active = product.branch.isActive === true && product.branch.isVisible === true;
  const availability = outOfStock ? 'out_of_stock' : (active ? 'in_stock' : 'unknown');
  // The vendor's own published per-line cap. It is far above every requested
  // batch, so it never blocks one; recording it keeps the cap verified instead
  // of assumed.
  const quantityLimit = Number(product.quantityLimit);
  const maxUnits = Number.isFinite(quantityLimit) && quantityLimit > 0 ? quantityLimit : null;

  const policyCurrent = policyIsCurrent(yudaCottageCheesePolicy, now);
  const policyStamp = {
    id: yudaCottageCheesePolicy.id,
    version: yudaCottageCheesePolicy.version,
    origin: yudaCottageCheesePolicy.origin,
    retrievedAt: yudaCottageCheesePolicy.evidence.retrievedAt,
    reviewBy: yudaCottageCheesePolicy.reviewBy,
    thresholdSemantics: yudaCottageCheesePolicy.rule.thresholdSemantics ?? null
  };
  const shipping = policyCurrent
    ? {
        mode: 'delivery',
        service: yudaCottageCheesePolicy.service,
        certainty: yudaCottageCheesePolicy.certainty,
        amount: { ...yudaCottageCheesePolicy.rule.amount },
        minOrder: { ...yudaCottageCheesePolicy.rule.minOrder },
        freeThreshold: null,
        destination: { ...yudaCottageCheesePolicy.destination },
        note: `${yudaCottageCheesePolicy.evidence.note} Home delivery only; self-pickup is not part of the delivered comparison.`,
        policy: policyStamp,
        evidence: { ...yudaCottageCheesePolicy.evidence }
      }
    : {
        mode: 'delivery',
        service: yudaCottageCheesePolicy.service,
        certainty: 'unknown',
        amount: null,
        minOrder: { ...yudaCottageCheesePolicy.rule.minOrder },
        freeThreshold: null,
        destination: { scope: yudaCottageCheesePolicy.destination.scope, country: 'IL', localities: [...yudaCottageCheesePolicy.destination.localities] },
        note: `The researched Super Yuda delivery terms are past their review date (${yudaCottageCheesePolicy.reviewBy}) and are not applied until they are re-checked; shipping is unknown, not free.`,
        policy: policyStamp
      };

  return createObservation({
    vendor: {
      id: 'yuda',
      name: 'Super Yuda (סופר יודה)',
      homepage: 'https://www.yuda.co.il'
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
      category: product.branch.aisleName ?? null
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

export const yuda = {
  id: 'yuda',
  name: 'Super Yuda (סופר יודה)',
  homepage: 'https://www.yuda.co.il',
  allowedHosts: ['yuda.co.il', 'www.yuda.co.il'],
  parserVersion: 'yuda/1',
  // robots.txt asks for a 4-second crawl delay; the refresh pipeline spaces the
  // single tracked offer request to this host accordingly.
  crawlDelayMs: 4000,
  offers: [
    {
      id: 'tnuva-cottage-5-250g',
      url: YUDA_PRODUCT_API,
      itemUrl: YUDA_PRODUCT_URL,
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
        observations.push(parseYudaProduct(response.text, {
          now,
          itemUrl: offer.itemUrl ?? YUDA_PRODUCT_URL,
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
