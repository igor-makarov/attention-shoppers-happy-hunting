// Validated shipping policies and the shared policy evaluator.
//
// A policy is a versioned, scoped statement of a shipping rule that browser
// research established: what the rule is, which vendor/product/service and
// destination scope it covers, when it was observed, and when it must be
// re-checked. Policies are deliberately separate from an observation's own
// parsed shipping block:
//
//   - Published rules and observed conditional cart quotes stay distinguishable
//     through `origin` and `certainty`; a cart quote is never relabelled as a
//     published rate.
//   - The evaluator is deterministic and shared by every vendor: it matches an
//     observation by vendor, product, service and item-URL scope, refuses to
//     guess when matching policies disagree (status `inconsistent`) and refuses
//     to keep applying evidence past its `reviewBy` date (status `expired`).
//   - Enrichment only fills missing shipping fields. An observation that already
//     carries its own amount, threshold or destination is never overwritten, so
//     a newer policy cannot rewrite a fresher parse.
//   - Enrichment happens at read time. It never changes the observation's price,
//     stock, `observedAt` or the refresh completion marker, so applying a newer
//     shipping rule cannot claim a fresh vendor price/stock check.
//
// Recheck/staleness: each policy carries `reviewBy`. Browser research re-runs
// update the evidence and version (and move `reviewBy` forward); until then the
// policy applies. Once `reviewBy` passes, the evaluator stops applying it and
// the offer falls back to its parsed shipping — explicit unknown rather than a
// stale unconditional rate.

const PRODUCT_ID = 'lavazza-crema-e-gusto-vacuum-ground';

/**
 * Pucks home-delivery rule, observed in the anonymous checkout estimator on
 * 2026-10-12: ₪30 flat home delivery, free above a ₪100 item subtotal.
 * Observed carts: 1, 2 and 4 × 250 g to Tel Aviv / 6100000 and Eilat / 8800000
 * (the fee did not change with locality; no restriction was displayed).
 * The vendor's own wording is "above ₪100"; the boundary was observed only at
 * ₪60 (paid) and ₪120 (free), so `thresholdSemantics` records "above" and the
 * quote engine keeps the observed `>=` arithmetic only as the conservative
 * reading of "free above the stated threshold" — see docs/SOURCES.md.
 */
export const pucksHomeDeliveryPolicy = {
  id: 'pucks-il-home-delivery',
  version: 1,
  vendorId: 'pucks',
  productIds: [PRODUCT_ID],
  itemUrlPrefixes: ['https://pucks.co.il/product/'],
  service: 'home_delivery',
  origin: 'observed_cart',
  certainty: 'checkout_quote',
  rule: {
    amount: { amount: 30, currency: 'ILS' },
    freeThreshold: { amount: 100, currency: 'ILS' },
    thresholdSemantics: 'above',
    minOrder: null,
    maxTotalGrams: null
  },
  destination: {
    scope: 'country',
    country: 'IL',
    caveat: 'The ₪30 rate was observed in the anonymous checkout estimator for Tel Aviv and Eilat carts; the fee did not change with locality and no restriction was displayed, but coverage for every locality was not individually verified.',
    caveatSource: 'https://pucks.co.il/payment/request'
  },
  evidence: {
    url: 'https://pucks.co.il/payment/request',
    retrievedAt: '2026-10-12T18:10:10Z',
    note: 'Anonymous checkout estimator quote recorded by interactive browser research: ₪30 flat home delivery, free above ₪100 item subtotal, for 1, 2 and 4 × 250 g carts; see docs/evidence/browser-research/2026-10-12-vendor-shipping-quotes.json.'
  },
  observedFor: {
    carts: ['1 × 250 g', '2 × 250 g', '4 × 250 g'],
    destinations: ['Tel Aviv / 6100000', 'Eilat / 8800000'],
    note: 'The estimator offered home delivery only; no street address or personal detail was entered and no order was submitted.'
  },
  reviewBy: '2026-11-11T00:00:00.000Z'
};

/**
 * CoffeeMan 8 × 250 g multipack (2 kg) cart quote, observed in the anonymous
 * checkout on 2026-10-12 (18:16 UTC, re-checked in a fresh cart at 20:07 UTC).
 * The product page publishes no courier price for this SKU; the checkout quoted
 * ₪20 for home courier and ₪20 for distribution-center delivery on exactly the
 * one-8-pack cart. A larger cart was never observed, so the rule carries
 * `maxTotalGrams: 2000` and the quote engine refuses to stretch it to two
 * 8-packs. The ₪240 8-pack cart did NOT receive the free delivery that some
 * larger single-pack/two-4-pack carts showed, so no free threshold is recorded.
 */
export const coffeemanEightPackPolicy = {
  id: 'coffeeman-8pack-il-cart-quote',
  version: 1,
  vendorId: 'coffeeman',
  productIds: [PRODUCT_ID],
  itemUrlPrefixes: ['https://www.coffeeman.co.il/product/8-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico'],
  service: 'home_delivery',
  origin: 'observed_cart',
  certainty: 'checkout_quote',
  rule: {
    amount: { amount: 20, currency: 'ILS' },
    freeThreshold: null,
    thresholdSemantics: null,
    minOrder: null,
    maxTotalGrams: 2000
  },
  destination: {
    scope: 'country',
    country: 'IL',
    caveat: 'Home delivery is limited to the localities on Amigo’s home-delivery list, which the product page does not publish. Confirm the destination at checkout.',
    caveatSource: 'https://www.coffeeman.co.il/page/%D7%AA%D7%A0%D7%90%D7%99-%D7%A9%D7%99%D7%9E%D7%95%D7%A9'
  },
  evidence: {
    url: 'https://www.coffeeman.co.il/checkout.asp',
    retrievedAt: '2026-10-12T20:07:00Z',
    note: 'Anonymous checkout quote for one 8 × 250 g multipack (2 kg) on 2026-10-12, re-checked in a fresh cart at 20:07 UTC: ₪20 home courier and ₪20 distribution-center delivery up to 5 kg; self-pickup free. The product page publishes no courier price, and carts above 2 kg are not verified.'
  },
  observedFor: {
    carts: ['1 × (8 × 250 g) = 2 kg'],
    destinations: ['the anonymous checkout showed the method prices without asking for a locality'],
    note: 'No street address or personal detail was entered and no order was submitted; the locality restriction in the terms page could not be tested without personal delivery details.'
  },
  reviewBy: '2026-11-11T00:00:00.000Z'
};

/** Every validated policy the shared evaluator may apply. */
export const SHIPPING_POLICIES = [pucksHomeDeliveryPolicy, coffeemanEightPackPolicy];

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Validate one policy's shape. Returns { ok, errors } without throwing. */
export function validatePolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== 'object') return { ok: false, errors: ['policy is not an object'] };
  if (!policy.id || typeof policy.id !== 'string') errors.push('id is required');
  if (!Number.isInteger(policy.version) || policy.version < 1) errors.push('version must be a positive integer');
  if (!policy.vendorId) errors.push('vendorId is required');
  if (!Array.isArray(policy.productIds) || policy.productIds.length === 0) errors.push('productIds must be a non-empty array');
  if (policy.service != null && typeof policy.service !== 'string') errors.push('service must be a string when present');
  if (!['observed_cart', 'published'].includes(policy.origin)) errors.push('origin must be "observed_cart" or "published"');
  if (!['verified', 'checkout_quote', 'estimated'].includes(policy.certainty)) errors.push('certainty must be verified, checkout_quote or estimated');
  const amount = policy.rule?.amount;
  if (!amount || !Number.isFinite(amount.amount) || !CURRENCY_PATTERN.test(String(amount.currency ?? ''))) {
    errors.push('rule.amount must carry a numeric amount and a 3-letter currency');
  }
  const threshold = policy.rule?.freeThreshold;
  if (threshold != null && (!Number.isFinite(threshold.amount) || !CURRENCY_PATTERN.test(String(threshold.currency ?? '')))) {
    errors.push('rule.freeThreshold must carry a numeric amount and a 3-letter currency when present');
  }
  if (threshold != null && !['above', 'at_least'].includes(policy.rule?.thresholdSemantics)) {
    errors.push('rule.thresholdSemantics must be "above" or "at_least" when a free threshold is present');
  }
  if (!policy.evidence?.url || !policy.evidence?.retrievedAt) errors.push('evidence.url and evidence.retrievedAt are required');
  if (!policy.reviewBy || Number.isNaN(Date.parse(policy.reviewBy))) errors.push('reviewBy must be an ISO date');
  if (!policy.destination || !['country', 'localities'].includes(policy.destination.scope)) errors.push('destination.scope must be country or localities');
  if (policy.destination?.scope === 'localities' && !Array.isArray(policy.destination.localities)) {
    errors.push('a localities destination needs a localities array');
  }
  return { ok: errors.length === 0, errors };
}

export function validatePolicies(policies = SHIPPING_POLICIES) {
  const results = policies.map(policy => ({ id: policy?.id ?? null, ...validatePolicy(policy) }));
  return { ok: results.every(result => result.ok), results };
}

/** Does this policy's scope cover the observation? */
function policyMatches(policy, observation) {
  if (!observation || !policy) return false;
  if (policy.vendorId && observation.vendor?.id !== policy.vendorId) return false;
  const productId = observation.product?.productId ?? null;
  if (policy.productIds?.length && !policy.productIds.includes(productId)) return false;
  if (policy.itemUrlPrefixes?.length) {
    const url = String(observation.itemUrl ?? '');
    if (!policy.itemUrlPrefixes.some(prefix => url.startsWith(prefix))) return false;
  }
  if (policy.service != null && observation.shipping?.service != null && observation.shipping.service !== policy.service) return false;
  return true;
}

function ruleKey(rule) {
  const amount = rule?.amount ? `${rule.amount.amount}${rule.amount.currency}` : '-';
  const threshold = rule?.freeThreshold ? `${rule.freeThreshold.amount}${rule.freeThreshold.currency}` : '-';
  return `${amount}/${threshold}/${rule?.minOrder?.amount ?? '-'}`;
}

/**
 * Resolve which policy (if any) may enrich this observation.
 * Statuses: applied | already-known | unmatched | expired | invalid | inconsistent.
 */
export function resolveShippingPolicy({ observation, policies = SHIPPING_POLICIES, now = Date.now() } = {}) {
  const matching = policies.filter(policy => policyMatches(policy, observation));
  if (!matching.length) return { status: 'unmatched', policy: null };
  const valid = [];
  const expired = [];
  const invalid = [];
  for (const policy of matching) {
    const check = validatePolicy(policy);
    if (!check.ok) { invalid.push({ policy, errors: check.errors }); continue; }
    if (Date.parse(policy.reviewBy) < now) expired.push(policy);
    else valid.push(policy);
  }
  if (!valid.length) {
    if (expired.length) return { status: 'expired', policy: expired.sort((a, b) => b.version - a.version)[0] };
    return { status: 'invalid', policy: invalid[0]?.policy ?? null, errors: invalid[0]?.errors ?? [] };
  }
  // One effective rule per policy id: the highest version.
  const latestById = new Map();
  for (const policy of valid) {
    const current = latestById.get(policy.id);
    if (!current || policy.version > current.version) latestById.set(policy.id, policy);
  }
  const effective = [...latestById.values()];
  const keys = new Set(effective.map(policy => ruleKey(policy.rule)));
  if (keys.size > 1) return { status: 'inconsistent', policy: null, policies: effective };
  return { status: 'applied', policy: effective.sort((a, b) => b.version - a.version)[0] };
}

/**
 * Fill only the shipping fields the observation is missing from a matching
 * validated policy. Returns { observation, status, policy }; the original
 * observation is never mutated and its observedAt/price/stock stay untouched.
 */
export function enrichObservationShipping(observation, options = {}) {
  const resolved = resolveShippingPolicy({ observation, ...options });
  if (resolved.status !== 'applied') return { observation, status: resolved.status, policy: resolved.policy ?? null };
  const policy = resolved.policy;
  const shipping = { ...(observation.shipping ?? {}) };
  let changed = false;

  if ((shipping.certainty === 'unknown' || shipping.amount == null) && policy.rule?.amount?.amount != null) {
    shipping.amount = { ...policy.rule.amount };
    shipping.certainty = policy.certainty;
    changed = true;
  }
  if (shipping.freeThreshold == null && policy.rule?.freeThreshold?.amount != null) {
    shipping.freeThreshold = { ...policy.rule.freeThreshold };
    changed = true;
  }
  // Keep the vendor's boundary wording attached to the threshold it belongs to,
  // so "above ₪100" is never silently evaluated as "at least ₪100".
  if (shipping.freeThresholdSemantics == null && shipping.freeThreshold != null && policy.rule?.thresholdSemantics) {
    shipping.freeThresholdSemantics = policy.rule.thresholdSemantics;
    changed = true;
  }
  if (shipping.minOrder == null && policy.rule?.minOrder?.amount != null) {
    shipping.minOrder = { ...policy.rule.minOrder };
    changed = true;
  }
  if (shipping.maxTotalGrams == null && policy.rule?.maxTotalGrams != null) {
    shipping.maxTotalGrams = policy.rule.maxTotalGrams;
    changed = true;
  }
  if (shipping.service == null && policy.service) {
    shipping.service = policy.service;
    changed = true;
  }
  if (shipping.destination == null && policy.destination) {
    shipping.destination = { ...policy.destination };
    changed = true;
  } else if (shipping.destination != null && policy.destination?.caveat && shipping.destination.caveat == null) {
    // An older stored row often already carries a generic destination scope but
    // not the coverage caveat the researched evidence established. Keep the
    // row's own scope and add the caveat, so an enriched rate is never
    // presented as unconditional country-wide delivery.
    shipping.destination = {
      ...shipping.destination,
      caveat: policy.destination.caveat,
      caveatSource: policy.destination.caveatSource ?? null
    };
    changed = true;
  }

  if (!changed) return { observation, status: 'already-known', policy };
  shipping.policy = {
    id: policy.id,
    version: policy.version,
    origin: policy.origin,
    retrievedAt: policy.evidence.retrievedAt,
    reviewBy: policy.reviewBy,
    thresholdSemantics: policy.rule?.thresholdSemantics ?? null
  };
  if (shipping.evidence == null) shipping.evidence = { ...policy.evidence };
  const originText = policy.origin === 'observed_cart' ? 'observed anonymous cart quote' : 'published rule';
  shipping.note = [shipping.note, `Shipping rule applied from validated policy ${policy.id} v${policy.version} (${originText}, observed ${policy.evidence.retrievedAt}); confirm at checkout.`]
    .filter(Boolean)
    .join(' ');
  return { observation: { ...observation, shipping }, status: 'applied', policy };
}

/** Compact policy status for the public status API; no secrets, no payloads. */
export function policySummary(now = Date.now(), policies = SHIPPING_POLICIES) {
  return policies.map(policy => ({
    id: policy.id,
    version: policy.version,
    vendorId: policy.vendorId,
    origin: policy.origin,
    certainty: policy.certainty,
    observedAt: policy.evidence?.retrievedAt ?? null,
    reviewBy: policy.reviewBy,
    expired: Date.parse(policy.reviewBy) < now
  }));
}
