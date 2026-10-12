// Published quantity promotions (item-price discounts) and the shared evaluator.
//
// A promotion is a scoped statement of a discount the vendor publishes on its
// product page: the percent off, the item subtotal that activates it, the
// vendor/product/URL scope it covers, the vendor's own wording and where it was
// observed. The adapter parses the vendor's promotion banner into this shape on
// every fetch, so a promotion that ends stops applying with the next
// observation instead of lingering as a hard-coded constant.
//
// The checked-in fallback below covers persisted rows that predate banner
// parsing (they carry no `promotions` field at all). A freshly parsed row always
// carries `promotions: []` or the parsed rules, so "checked, none found" is
// never re-enriched from the fallback. Applying a promotion never changes the
// base unit price, the stock observation time or the refresh marker; it only
// reduces the item subtotal of the offer it applies to, and the board discloses
// the discount, the vendor wording and the evidence.

const PRODUCT_ID = 'lavazza-crema-e-gusto-vacuum-ground';
const COFFEEMAN_SINGLE_URL = 'https://www.coffeeman.co.il/product/250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico';

/**
 * CoffeeMan's published ground-coffee promotion, read from the single 250 g
 * product page on 2026-10-12:
 *
 *   כל הקפה טחון ב-10% הנחה.
 *   קונים קפה טחון מכל המותגים המובילים ב-250 ש"ח ומקבלים 10% הנחה אוטומטית
 *   בקופה על הקפה שבחרתם. (לא כולל מארזים ובאנדלים)
 *
 * i.e. 10% off the ground-coffee item subtotal from a ₪250 subtotal, applied
 * automatically at checkout, multipacks and bundles excluded. The anonymous
 * 8 × 250 g single-pack cart observed on 2026-10-12 (19:56-20:09 UTC) showed
 * exactly this: ₪264 item subtotal, ₪237.60 total after the automatic 10%
 * discount, while the 6 × 250 g (₪198) and 7 × 250 g (₪231) carts showed no
 * discount and the 4-pack/8-pack pages advertise a different promotion, not
 * this one. The fallback exists only for rows stored before banner parsing; the
 * adapter parses the live banner on every refresh, so an ended promotion stops
 * applying without waiting for `reviewBy`.
 */
export const coffeemanGroundCoffeePercentPromotion = {
  id: 'coffeeman-ground-coffee-percent-off',
  version: 1,
  vendorId: 'coffeeman',
  productIds: [PRODUCT_ID],
  itemUrlPrefixes: ['https://www.coffeeman.co.il/product/250-'],
  percent: 10,
  minItemSubtotal: { amount: 250, currency: 'ILS' },
  semantics: 'at_least',
  excludesMultipacks: true,
  origin: 'published',
  wording: 'כל הקפה טחון ב-10% הנחה. קונים קפה טחון מכל המותגים המובילים ב-250 ש"ח ומקבלים 10% הנחה אוטומטית בקופה על הקפה שבחרתם. (לא כולל מארזים ובאנדלים)',
  evidence: {
    url: COFFEEMAN_SINGLE_URL,
    retrievedAt: '2026-10-12T23:38:00Z',
    note: 'Promotion banner in the rendered product page HTML (promotionName/promotionDesc), retrieved with the bounded fetcher; the anonymous 8 × 250 g cart on 2026-10-12 showed the 10% automatic checkout discount, and the 6 × 250 g and 7 × 250 g carts did not.'
  },
  observed: {
    cart: '8 × 250 g single packs = ₪264 item subtotal',
    discountedIls: 237.6,
    observedAt: '2026-10-12T20:09:00Z',
    evidence: 'docs/evidence/browser-research/2026-10-12-coffeeman-cart-single-4pack.json'
  },
  reviewBy: '2026-11-11T00:00:00.000Z'
};

/** Every validated promotion the shared evaluator may apply. */
export const PROMOTIONS = [coffeemanGroundCoffeePercentPromotion];

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Validate one promotion's shape. Returns { ok, errors } without throwing. */
export function validatePromotion(promotion) {
  const errors = [];
  if (!promotion || typeof promotion !== 'object') return { ok: false, errors: ['promotion is not an object'] };
  if (!promotion.id || typeof promotion.id !== 'string') errors.push('id is required');
  if (!promotion.vendorId) errors.push('vendorId is required');
  if (!Array.isArray(promotion.productIds) || promotion.productIds.length === 0) errors.push('productIds must be a non-empty array');
  if (!Number.isFinite(promotion.percent) || promotion.percent <= 0 || promotion.percent > 90) {
    errors.push('percent must be a number greater than 0 and at most 90');
  }
  const min = promotion.minItemSubtotal;
  if (!min || !Number.isFinite(min.amount) || min.amount < 0 || !CURRENCY_PATTERN.test(String(min.currency ?? ''))) {
    errors.push('minItemSubtotal must carry a non-negative amount and a 3-letter currency');
  }
  if (!['above', 'at_least'].includes(promotion.semantics)) errors.push('semantics must be "above" or "at_least"');
  if (promotion.excludesMultipacks != null && typeof promotion.excludesMultipacks !== 'boolean') {
    errors.push('excludesMultipacks must be a boolean when present');
  }
  if (!promotion.wording || typeof promotion.wording !== 'string') errors.push('wording is required (the vendor’s own text)');
  if (!promotion.evidence?.url || !promotion.evidence?.retrievedAt) errors.push('evidence.url and evidence.retrievedAt are required');
  if (promotion.reviewBy != null && Number.isNaN(Date.parse(promotion.reviewBy))) errors.push('reviewBy must be an ISO date when present');
  return { ok: errors.length === 0, errors };
}

export function validatePromotions(promotions = PROMOTIONS) {
  const results = promotions.map(promotion => ({ id: promotion?.id ?? null, ...validatePromotion(promotion) }));
  return { ok: results.every(result => result.ok), results };
}

/** Is this promotion still inside its review window at `now`? */
export function promotionIsCurrent(promotion, now = Date.now()) {
  if (promotion?.reviewBy == null) return true;
  const reviewBy = Date.parse(promotion.reviewBy);
  return Number.isFinite(reviewBy) && reviewBy >= now;
}

/** Does this promotion's scope cover the observation? */
function promotionMatches(promotion, observation) {
  if (!observation || !promotion) return false;
  if (promotion.vendorId && observation.vendor?.id !== promotion.vendorId) return false;
  const productId = observation.product?.productId ?? null;
  if (promotion.productIds?.length && !promotion.productIds.includes(productId)) return false;
  if (promotion.itemUrlPrefixes?.length) {
    const url = String(observation.itemUrl ?? '');
    if (!promotion.itemUrlPrefixes.some(prefix => url.startsWith(prefix))) return false;
  }
  return true;
}

/**
 * Does the promotion's own activation condition hold for this offer? The
 * vendor's wording decides the boundary: "ב-250 ש\"ח" is "at ₪250", so
 * `at_least`; an `above` rule keeps its strict boundary.
 */
export function promotionApplies(promotion, { itemSubtotalIls, packCount = 1 } = {}) {
  if (promotion?.excludesMultipacks && packCount > 1) return false;
  const min = promotion?.minItemSubtotal?.amount;
  if (!Number.isFinite(min) || !Number.isFinite(itemSubtotalIls)) return false;
  return promotion.semantics === 'above'
    ? itemSubtotalIls > min + 0.005
    : itemSubtotalIls >= min - 0.005;
}

/**
 * Resolve which promotion (if any) may reduce this offer's item subtotal.
 *
 * A parsed `observation.promotions` array is authoritative — including an empty
 * one, which means the page was checked and no promotion banner was present.
 * Only observations that predate banner parsing (the field is absent) may use
 * the checked-in fallback, and then only while it is inside its review window.
 * Returns { status, promotion, source, discountIls }; statuses: applied | none.
 */
export function resolvePromotion({ observation, itemSubtotalIls, packCount = 1, now = Date.now(), promotions = PROMOTIONS } = {}) {
  const parsed = Array.isArray(observation?.promotions) ? observation.promotions : null;
  const candidates = parsed ?? (Array.isArray(promotions) ? promotions : []);
  const source = parsed ? 'page' : 'policy';
  const matched = [];
  for (const candidate of candidates) {
    if (!candidate || !promotionIsCurrent(candidate, now)) continue;
    if (!validatePromotion(candidate).ok) continue;
    if (!promotionMatches(candidate, observation)) continue;
    if (!promotionApplies(candidate, { itemSubtotalIls, packCount })) continue;
    matched.push(candidate);
  }
  if (!matched.length) return { status: 'none', promotion: null, source, discountIls: null };
  // One promotion per offer: take the largest percent so two overlapping rules
  // cannot silently stack into a discount neither rule states.
  matched.sort((a, b) => b.percent - a.percent);
  const chosen = matched[0];
  return {
    status: 'applied',
    promotion: chosen,
    source,
    discountIls: Math.round(itemSubtotalIls * chosen.percent) / 100
  };
}

/** Compact promotion status for the public status API; no secrets, no payloads. */
export function promotionSummary(now = Date.now(), promotions = PROMOTIONS) {
  return promotions.map(promotion => ({
    id: promotion.id,
    version: promotion.version,
    vendorId: promotion.vendorId,
    origin: promotion.origin,
    percent: promotion.percent,
    minItemSubtotal: promotion.minItemSubtotal?.amount ?? null,
    semantics: promotion.semantics,
    excludesMultipacks: Boolean(promotion.excludesMultipacks),
    observedAt: promotion.evidence?.retrievedAt ?? null,
    reviewBy: promotion.reviewBy ?? null,
    expired: !promotionIsCurrent(promotion, now)
  }));
}
