import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quoteBoard, findDestination } from '../src/lib/quote.js';
import {
  SHIPPING_POLICIES,
  pucksHomeDeliveryPolicy,
  coffeemanEightPackPolicy,
  coffeemanSingleFourPackPolicy,
  coffee4uHomeDeliveryPolicy,
  validatePolicy,
  validatePolicies,
  resolveShippingPolicy,
  enrichObservationShipping,
  policySummary
} from '../src/lib/policies.js';
import { parsePucksProduct } from '../src/vendors/pucks.js';
import { parseCoffeemanProduct } from '../src/vendors/coffeeman.js';
import { decodeHtml } from '../src/lib/text.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const FRESH = '2026-10-12T09:00:00.000Z';
const PUCKS_URL = 'https://pucks.co.il/product/lavazza-crema-e-gusto-ground-coffee-250g';

/**
 * An old persisted Pucks row exactly as earlier parser versions stored it:
 * price and stock observed, shipping unknown (the product page only said
 * "shipping is calculated at checkout"). This is the acceptance case for
 * read-time policy enrichment.
 */
function oldPersistedPucksObservation(overrides = {}) {
  return {
    key: 'pucks:classico-250g',
    vendor: { id: 'pucks', name: 'Pucks (פאקס)', homepage: 'https://pucks.co.il' },
    itemUrl: PUCKS_URL,
    product: {
      productId: 'lavazza-crema-e-gusto-vacuum-ground',
      name: 'Lavazza Crema e Gusto Classico 250 g ground coffee',
      variantId: 'classico',
      variantLabel: 'Classico',
      form: 'ground',
      packGrams: 250,
      packCount: 1,
      totalGrams: 250,
      sku: 'sku-old'
    },
    price: { amount: 30, currency: 'ILS' },
    availability: 'in_stock',
    shipping: {
      mode: 'delivery',
      certainty: 'unknown',
      amount: null,
      destination: { scope: 'country', country: 'IL' },
      note: 'Shipping is calculated at checkout'
    },
    observedAt: FRESH,
    ...overrides
  };
}

const quote = (observations, options = {}) => quoteBoard({
  observations,
  productId: 'lavazza-crema-e-gusto-vacuum-ground',
  targetGrams: 500,
  destination: findDestination('tel-aviv'),
  now: NOW,
  ...options
});

const COFFEEMAN_EIGHT_PACK_URL = 'https://www.coffeeman.co.il/product/8-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico';
const COFFEEMAN_SINGLE_URL = 'https://www.coffeeman.co.il/product/250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico';
const COFFEE4U_URL = 'https://www.coffee4u.co.il/product/lavazza-crema-e-gusto-250-gr-%D7%98%D7%97%D7%95%D7%9F';

/**
 * An old persisted CoffeeMan single-pack row as the pre-cart-observation parser
 * stored it: price and stock observed, shipping unknown, generic destination.
 */
function oldPersistedCoffeemanSingleObservation(overrides = {}) {
  return {
    key: 'coffeeman:930333:classico:ground:250g:x1',
    vendor: { id: 'coffeeman', name: 'CoffeeMan (אמיגו)', homepage: 'https://www.coffeeman.co.il' },
    itemUrl: COFFEEMAN_SINGLE_URL,
    product: {
      productId: 'lavazza-crema-e-gusto-vacuum-ground',
      name: '250 גרם קפה טחון lavazza Crema e Gusto Classico',
      variantId: 'classico',
      variantLabel: 'Classico',
      form: 'ground',
      packGrams: 250,
      packCount: 1,
      totalGrams: 250,
      sku: '930333'
    },
    price: { amount: 33, currency: 'ILS' },
    availability: 'in_stock',
    shipping: {
      mode: 'delivery',
      service: 'home_delivery',
      certainty: 'unknown',
      amount: null,
      destination: { scope: 'country', country: 'IL' },
      note: 'No published courier rate found; delivery cost is unknown before checkout.'
    },
    observedAt: FRESH,
    ...overrides
  };
}

/**
 * An old persisted Coffee4U row exactly as earlier parser versions stored it:
 * price and stock observed, shipping unknown, generic destination.
 */
function oldPersistedCoffee4uObservation(overrides = {}) {
  return {
    key: 'coffee4u:2010561:unspecified:ground:250g:x1',
    vendor: { id: 'coffee4u', name: 'Coffee4U (קופי פור יו)', homepage: 'https://www.coffee4u.co.il' },
    itemUrl: COFFEE4U_URL,
    product: {
      productId: 'lavazza-crema-e-gusto-vacuum-ground',
      name: 'Lavazza Crema e gusto 250 גר׳ טחון',
      variantId: 'unspecified',
      variantLabel: 'Variant not stated',
      form: 'ground',
      packGrams: 250,
      packCount: 1,
      totalGrams: 250,
      sku: '2010561'
    },
    price: { amount: 38, currency: 'ILS' },
    availability: 'in_stock',
    shipping: {
      mode: 'delivery',
      service: 'home_delivery',
      certainty: 'unknown',
      amount: null,
      destination: { scope: 'country', country: 'IL' },
      note: 'No published courier rate found on the product page; delivery cost is unknown before checkout.'
    },
    observedAt: FRESH,
    ...overrides
  };
}

/**
 * An old persisted CoffeeMan 8-pack row exactly as the pre-cart-quote parser
 * stored it: price and stock observed, shipping unknown because the product
 * page publishes no courier price for this SKU. This is the second acceptance
 * case for read-time policy enrichment, after the Pucks row below.
 */
function oldPersistedCoffeemanEightPackObservation(overrides = {}) {
  return {
    key: 'coffeeman:930335:classico:ground:2000g:x8',
    vendor: { id: 'coffeeman', name: 'CoffeeMan (אמיגו)', homepage: 'https://www.coffeeman.co.il' },
    itemUrl: COFFEEMAN_EIGHT_PACK_URL,
    product: {
      productId: 'lavazza-crema-e-gusto-vacuum-ground',
      name: '8 אריזות 250 גרם קפה טחון lavazza Crema e Gusto Classico',
      variantId: 'classico',
      variantLabel: 'Classico',
      form: 'ground',
      packGrams: 250,
      packCount: 8,
      totalGrams: 2000,
      sku: '930335'
    },
    price: { amount: 240, currency: 'ILS' },
    availability: 'in_stock',
    shipping: {
      mode: 'delivery',
      service: null,
      certainty: 'unknown',
      amount: null,
      destination: {
        scope: 'country',
        country: 'IL',
        caveat: 'Home delivery is limited to the localities on Amigo’s home-delivery list, which the product page does not publish. Confirm the destination at checkout.'
      },
      note: 'No published courier rate found; delivery cost is unknown before checkout.'
    },
    observedAt: FRESH,
    ...overrides
  };
}

test('the checked-in shipping policies are structurally valid', () => {
  const result = validatePolicies(SHIPPING_POLICIES);
  assert.equal(result.ok, true, JSON.stringify(result.results));
  assert.equal(SHIPPING_POLICIES.length, 4);
  const pucks = SHIPPING_POLICIES.find(policy => policy.id === pucksHomeDeliveryPolicy.id);
  assert.ok(pucks, 'the evidenced Pucks rule is a checked-in policy');
  assert.equal(pucks.origin, 'observed_cart', 'a cart-observed rule is never relabelled as published');
  assert.equal(pucks.certainty, 'checkout_quote');
  assert.equal(pucks.rule.thresholdSemantics, 'above', 'the vendor wording "above ₪100" is preserved, not silently rewritten');
  // 2026-10-13 destination extension: every selectable locality with a postcode
  // is named in the coverage caveat, so the sampled coverage is visible evidence
  // instead of an implicit country-wide claim.
  for (const locality of ['Tel Aviv–Yafo / 6100000', 'Eilat / 8800000', 'Jerusalem / 9100000', 'Haifa / 3100000', 'Be’er Sheva / 8400000']) {
    assert.ok(pucks.destination.caveat.includes(locality), `the coverage caveat names ${locality}`);
  }
  assert.match(pucks.evidence.note, /2026-10-13/, 'the evidence note records the destination re-check');
  assert.equal(pucks.destination.scope, 'country', 'the estimator quote is still scoped as an observed country rule, not a per-locality guarantee');
  const coffeeman = SHIPPING_POLICIES.find(policy => policy.id === coffeemanEightPackPolicy.id);
  assert.ok(coffeeman, 'the researched CoffeeMan 8-pack cart quote is a checked-in policy');
  assert.equal(coffeeman.origin, 'observed_cart');
  assert.equal(coffeeman.certainty, 'checkout_quote');
  assert.equal(coffeeman.rule.maxTotalGrams, 2000, 'the cart quote is scoped to the 2 kg cart it was observed on');
  assert.equal(coffeeman.rule.freeThreshold, null, 'no free threshold is invented from unobserved larger carts');
  assert.equal(coffeeman.service, 'home_delivery');
  assert.equal(coffeeman.alternatives[0].amount.amount, 20, 'the observed distribution-center alternative is part of the policy');
  const singleFour = SHIPPING_POLICIES.find(policy => policy.id === coffeemanSingleFourPackPolicy.id);
  assert.ok(singleFour, 'the published single/4-pack rule is a checked-in policy');
  assert.equal(singleFour.origin, 'published', 'the published ₪25 rate is not relabelled as a cart quote');
  assert.equal(singleFour.certainty, 'verified');
  assert.equal(singleFour.rule.amount.amount, 25);
  assert.equal(singleFour.version, 2, 'the cart-observed free condition bumps the policy version');
  assert.equal(singleFour.rule.freeThreshold.amount, 231, 'the free condition is stored at the lowest observed free subtotal');
  assert.equal(singleFour.rule.thresholdSemantics, 'at_least');
  assert.equal(singleFour.rule.freeThresholdOrigin, 'observed_cart', 'an observed threshold is never relabelled as published');
  assert.match(singleFour.rule.freeThresholdEvidence.url, /checkout\.asp/);
  assert.equal(singleFour.alternatives[0].amount.amount, 15, 'the cart-observed ₪15 distribution-center rate lives in the policy');
  const coffee4u = SHIPPING_POLICIES.find(policy => policy.id === coffee4uHomeDeliveryPolicy.id);
  assert.ok(coffee4u, 'the Coffee4U published rule with its coverage shape is a checked-in policy');
  assert.equal(coffee4u.origin, 'published');
  assert.equal(coffee4u.rule.amount.amount, 30);
  assert.equal(coffee4u.alternatives[0].amount.amount, 15);
  assert.equal(coffee4u.destination.observed.courierLocalities, 1269, 'the observed closed locality list stays structured');
});

test('an old persisted CoffeeMan single-pack offer gains the published rule and its cart-observed alternative', () => {
  const stored = oldPersistedCoffeemanSingleObservation();
  const storedSnapshot = JSON.parse(JSON.stringify(stored));
  const board = quote([stored]);
  assert.equal(board.best.vendor.id, 'coffeeman');
  assert.equal(board.best.shipping.certainty, 'verified', 'the published ₪25 rate keeps the published certainty');
  assert.equal(board.best.shipping.amountIls, 25);
  assert.equal(board.best.shipping.serviceLabel, 'Home delivery');
  assert.equal(board.best.shipping.alternatives[0].amountIls, 15, 'the cart-observed distribution-center alternative is added to the old row');
  assert.equal(board.best.shipping.alternatives[0].id, 'distribution-center');
  assert.match(board.best.shipping.alternatives[0].label, /cart-observed for 0\.5–1 kg carts/);
  assert.match(board.best.shipping.alternatives[0].note, /free condition is applied from ₪231/);
  assert.match(board.best.shipping.coverageCaveat, /home-delivery list/);
  assert.equal(board.best.shipping.policy.id, 'coffeeman-single-4pack-il-home-delivery');
  assert.equal(board.best.shipping.policy.version, 2);
  assert.equal(board.best.shipping.freeThreshold, 231, 'the old row gains the observed free condition at read time');
  assert.equal(board.best.shipping.freeThresholdOrigin, 'observed_cart');
  assert.equal(board.best.totalIls, 91, '2 × ₪33 item + the published ₪25 courier rate (below the observed free subtotal)');
  assert.equal(board.best.ilsPerKg, 182);
  assert.match(board.best.shipping.note, /validated policy coffeeman-single-4pack-il-home-delivery v2/);
  assert.deepEqual(stored, storedSnapshot, 'the stored observation is never mutated');
});

test('the CoffeeMan free condition applies only from the observed ₪231 subtotal and only to the single/4-pack listings', () => {
  const singleAt2000 = quote([oldPersistedCoffeemanSingleObservation()], { targetGrams: 2000 });
  assert.equal(singleAt2000.best.vendor.id, 'coffeeman');
  assert.equal(singleAt2000.best.itemTotalIls, 237.6, '8 singles keep the published 10% promotion');
  assert.equal(singleAt2000.best.shipping.amountIls, 0, 'the ₪237.60 cart is at/above the observed free subtotal');
  assert.equal(singleAt2000.best.totalIls, 237.6);
  assert.ok(singleAt2000.best.labels.some(label => /Free shipping threshold met \(from ₪231\.00, observed in the vendor’s anonymous cart\)/.test(label)), 'the label names the observed scope');

  const exactly231 = quote([oldPersistedCoffeemanSingleObservation()], { targetGrams: 1750 });
  assert.equal(exactly231.best.units, 7);
  assert.equal(exactly231.best.itemTotalIls, 231);
  assert.equal(exactly231.best.shipping.amountIls, 0, 'the observed ₪231 cart is free');

  const below = quote([oldPersistedCoffeemanSingleObservation()], { targetGrams: 1500 });
  assert.equal(below.best.units, 6);
  assert.equal(below.best.itemTotalIls, 198);
  assert.equal(below.best.shipping.amountIls, 25, 'a cart below the lowest observed free subtotal keeps the published ₪25');
  assert.equal(below.best.totalIls, 223);

  const fourPackAt2000 = quote([{
    ...oldPersistedCoffeemanSingleObservation(),
    key: 'coffeeman:930334:classico:ground:1000g:x4',
    itemUrl: 'https://www.coffeeman.co.il/product/4-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico',
    product: { ...oldPersistedCoffeemanSingleObservation().product, sku: '930334', packCount: 4, totalGrams: 1000 },
    price: { amount: 124, currency: 'ILS' }
  }], { targetGrams: 2000 });
  assert.equal(fourPackAt2000.best.units, 2);
  assert.equal(fourPackAt2000.best.itemTotalIls, 248);
  assert.equal(fourPackAt2000.best.shipping.amountIls, 0, 'the observed ₪248 two-4-pack cart is free');
  assert.equal(fourPackAt2000.best.totalIls, 248);

  // The ₪240 8-pack SKU cart kept its own ₪20 quote and must never inherit the
  // single/4-pack free condition.
  const eightPack = quote([oldPersistedCoffeemanEightPackObservation()], { targetGrams: 2000 });
  assert.equal(eightPack.best.shipping.amountIls, 20);
  assert.equal(eightPack.best.shipping.freeThreshold, null);
  assert.equal(eightPack.best.totalIls, 260);
});

test('an old persisted Coffee4U offer gains the published rate, coverage and pickup-point alternative at read time', () => {
  const stored = oldPersistedCoffee4uObservation();
  const storedSnapshot = JSON.parse(JSON.stringify(stored));
  const board = quote([stored]);
  assert.equal(board.best.vendor.id, 'coffee4u');
  assert.equal(board.best.shipping.certainty, 'verified');
  assert.equal(board.best.shipping.amountIls, 30);
  assert.equal(board.best.shipping.alternatives[0].amountIls, 15, 'the pickup-point service stays an alternative, never the ranked rate');
  assert.equal(board.best.shipping.alternatives[0].id, 'pickup-point');
  assert.match(board.best.shipping.coverageCaveat, /closed list of 1,269/, 'the enriched rate keeps the observed closed-locality-list caveat');
  assert.equal(board.best.shipping.destination.observed.courierLocalities, 1269);
  assert.equal(board.best.shipping.destination.observed.pickupPointLocalities, 420);
  assert.deepEqual(board.best.shipping.destination.observed.verifiedLocalities, ['תל אביב - יפו', 'אילת']);
  assert.equal(board.best.shipping.policy.id, 'coffee4u-il-home-delivery');
  assert.equal(board.best.totalIls, 106, '2 × ₪38 item + ₪30 published courier rate');
  assert.equal(board.best.ilsPerKg, 212);
  assert.match(board.best.shipping.note, /validated policy coffee4u-il-home-delivery v1/);
  assert.deepEqual(stored, storedSnapshot, 'the stored observation is never mutated');
});

test('enrichment never rewrites a parsed rate, alternatives or destination that the row already has', () => {
  const parsed = oldPersistedCoffee4uObservation({
    shipping: {
      mode: 'delivery',
      service: 'home_delivery',
      certainty: 'verified',
      amount: { amount: 30, currency: 'ILS' },
      alternatives: [{ id: 'pickup-point', label: 'Parsed pickup point', amount: { amount: 15, currency: 'ILS' }, note: 'parsed on the page' }],
      destination: { scope: 'country', country: 'IL', caveat: 'The row already knows its coverage caveat.' },
      note: 'Parsed published rate'
    }
  });
  const enriched = enrichObservationShipping(parsed, { policies: [coffee4uHomeDeliveryPolicy], now: NOW });
  assert.equal(enriched.status, 'already-known');
  assert.equal(enriched.observation.shipping.amount.amount, 30);
  assert.equal(enriched.observation.shipping.alternatives[0].label, 'Parsed pickup point');
  assert.equal(enriched.observation.shipping.destination.caveat, 'The row already knows its coverage caveat.');
  assert.equal(enriched.observation.shipping.policy, undefined, 'a fully known row gets no policy stamp');
});

test('a malformed alternative invalidates the policy instead of applying a partial rule', () => {
  const bad = {
    ...coffeemanSingleFourPackPolicy,
    id: 'bad-alternative',
    alternatives: [{ id: 'distribution-center', label: 'No amount', amount: { amount: 'fifteen', currency: 'ILS' } }]
  };
  const check = validatePolicy(bad);
  assert.equal(check.ok, false);
  assert.match(check.errors.join(' '), /alternatives\[0\]\.amount/);
  const resolved = resolveShippingPolicy({ observation: oldPersistedCoffeemanSingleObservation(), policies: [bad], now: NOW });
  assert.equal(resolved.status, 'invalid');
});

test('an old persisted CoffeeMan 8-pack offer gains the researched cart quote at read time', () => {
  const stored = oldPersistedCoffeemanEightPackObservation();
  const storedSnapshot = JSON.parse(JSON.stringify(stored));
  const board = quote([stored]);
  assert.equal(board.best.vendor.id, 'coffeeman');
  assert.equal(board.best.shipping.certainty, 'checkout_quote', 'the applied cart quote keeps its conditional certainty');
  assert.equal(board.best.shipping.amountIls, 20, '₪20 home courier is applied to the old row');
  assert.equal(board.best.shipping.serviceLabel, 'Home delivery');
  assert.equal(board.best.shipping.maxTotalGrams, 2000, 'the quote stays limited to the 2 kg cart it was observed on');
  assert.equal(board.best.shipping.policy.id, 'coffeeman-8pack-il-cart-quote');
  assert.equal(board.best.shipping.policy.version, 1);
  assert.match(board.best.shipping.coverageCaveat, /home-delivery list/, 'the enriched rate keeps the locality-list caveat');
  assert.equal(board.best.labels.some(label => /Delivery coverage caveat/.test(label)), true);
  assert.equal(board.best.totalIls, 260, '₪240 item + ₪20 observed courier quote for the one-8-pack cart');
  assert.equal(board.best.ilsPerKg, 130);
  assert.match(board.best.shipping.note, /validated policy coffeeman-8pack-il-cart-quote v1/);
  assert.deepEqual(stored, storedSnapshot, 'the stored observation is never mutated');

  // Two 8-packs (4 kg) is a cart the estimator never quoted: the offer stays
  // visible and unrankable instead of stretching the ₪20 rate.
  const twoPacks = quote([oldPersistedCoffeemanEightPackObservation()], { targetGrams: 3000 });
  assert.equal(twoPacks.best, null);
  assert.equal(twoPacks.unrankable.length, 1);
  assert.match(twoPacks.unrankable[0].reasons.join(' '), /quoted only for carts up to 2000 g/);
  assert.equal(twoPacks.unrankable[0].shipping.amountIls, null, 'an out-of-scope cart never becomes a ranked total');

  // The 8-pack policy is scoped to the 8-pack offer URL: the single-pack listing
  // keeps its own evidence and is never given the multipack cart rate.
  const single = oldPersistedCoffeemanEightPackObservation({
    key: 'coffeeman:930333:classico:ground:250g:x1',
    itemUrl: COFFEEMAN_SINGLE_URL,
    product: { ...oldPersistedCoffeemanEightPackObservation().product, packCount: 1, totalGrams: 250, sku: '930333' },
    price: { amount: 33, currency: 'ILS' }
  });
  const singleBoard = quote([single]);
  assert.equal(singleBoard.best.shipping.policy.id, 'coffeeman-single-4pack-il-home-delivery', 'the single pack gains its own published rule, not the 8-pack cart quote');
  assert.equal(singleBoard.best.shipping.amountIls, 25, 'the single pack keeps the published ₪25 rate');
  assert.notEqual(singleBoard.best.shipping.policy.id, coffeemanEightPackPolicy.id);
});

test('a malformed policy is rejected instead of applied', () => {
  const bad = { ...pucksHomeDeliveryPolicy, id: 'bad', rule: { amount: { amount: 'thirty', currency: 'ILS' } }, origin: 'guessed', reviewBy: 'not-a-date' };
  const check = validatePolicy(bad);
  assert.equal(check.ok, false);
  assert.ok(check.errors.length >= 3);
  const resolved = resolveShippingPolicy({ observation: oldPersistedPucksObservation(), policies: [bad], now: NOW });
  assert.equal(resolved.status, 'invalid');
  const enriched = enrichObservationShipping(oldPersistedPucksObservation(), { policies: [bad], now: NOW });
  assert.equal(enriched.status, 'invalid');
  assert.equal(enriched.observation.shipping.amount, null, 'an invalid policy never becomes a shipping amount');
});

test('an old persisted Pucks offer with unknown shipping gains the evidenced rule at read time', () => {
  const stored = oldPersistedPucksObservation();
  const storedSnapshot = JSON.parse(JSON.stringify(stored));
  const board = quote([stored]);
  assert.equal(board.best.vendor.id, 'pucks');
  assert.equal(board.best.shipping.certainty, 'checkout_quote', 'the applied rule keeps its observed-cart certainty');
  assert.equal(board.best.shipping.amountIls, 30, '₪30 home delivery is applied to the old row');
  assert.equal(board.best.shipping.serviceLabel, 'Home delivery');
  assert.equal(board.best.shipping.freeThreshold, 100, 'the evidenced free-shipping threshold comes with the rule');
  assert.equal(board.best.shipping.policy.id, 'pucks-il-home-delivery');
  assert.equal(board.best.shipping.policy.version, 2);
  // The old row already had a generic country destination, so the policy's
  // coverage caveat must still be attached: an enriched rate is never presented
  // as unconditional country-wide delivery.
  assert.match(board.best.shipping.coverageCaveat, /not individually verified/);
  assert.match(board.best.shipping.coverageCaveat, /Haifa \/ 3100000/, 'the enriched rate names the sampled localities including the 2026-10-13 checks');
  assert.equal(board.best.shipping.destination.scope, 'country', 'the row keeps its own destination scope');
  assert.equal(board.best.labels.some(label => /Delivery coverage caveat/.test(label)), true);
  assert.equal(board.best.totalIls, 90, '2 × ₪30 item + ₪30 shipping; the ₪100 threshold is not met at ₪60');
  assert.match(board.best.shipping.note, /validated policy pucks-il-home-delivery v2/);

  // Applying the policy must not claim a fresh price/stock check: the stored
  // observation (and its own evidence) is untouched.
  assert.deepEqual(stored, storedSnapshot, 'the stored observation is never mutated');

  // At 1 kg the threshold is met by the ₪120 item subtotal: free delivery.
  const oneKg = quote([oldPersistedPucksObservation()], { targetGrams: 1000 });
  assert.equal(oneKg.best.units, 4);
  assert.equal(oneKg.best.shipping.amountIls, 0);
  assert.equal(oneKg.best.totalIls, 120);
  assert.equal(oneKg.best.labels.some(label => /Free shipping threshold met/.test(label)), true);
});

test('a newer policy version applies immediately without waiting for the next item refresh', () => {
  const stored = oldPersistedPucksObservation();
  const updated = {
    ...pucksHomeDeliveryPolicy,
    version: 2,
    rule: { ...pucksHomeDeliveryPolicy.rule, amount: { amount: 35, currency: 'ILS' } },
    evidence: { ...pucksHomeDeliveryPolicy.evidence, retrievedAt: '2026-10-12T13:30:00Z', note: 'Re-observed at ₪35.' }
  };
  const board = quote([stored], { policies: [updated] });
  assert.equal(board.best.shipping.amountIls, 35, 'the newer rule applies to the persisted row promptly');
  assert.equal(board.best.totalIls, 95);
  assert.equal(board.best.shipping.policy.version, 2);
  assert.equal(board.best.observedAt, FRESH, 'the item price/stock observation time is preserved');
  assert.equal(board.best.attemptedAt, null, 'no fresh vendor attempt is claimed');
  assert.equal(board.shippingPolicies[0].version, 2);
  assert.equal(board.shippingPolicies[0].observedAt, '2026-10-12T13:30:00Z');
});

test('the vendor boundary wording decides the free-shipping comparison', () => {
  // 4 × ₪25 = exactly the ₪100 threshold at 1 kg. "above ₪100" does not include
  // the boundary itself, so the ₪30 fee stays; "at least ₪100" makes it free.
  const above = quote([oldPersistedPucksObservation({ price: { amount: 25, currency: 'ILS' } })], { targetGrams: 1000 });
  assert.equal(above.best.itemTotalIls, 100);
  assert.equal(above.best.shipping.freeThresholdSemantics, 'above');
  assert.equal(above.best.shipping.amountIls, 30, 'the exact threshold is not silently treated as free');
  assert.equal(above.best.totalIls, 130);

  const atLeastPolicy = {
    ...pucksHomeDeliveryPolicy,
    id: 'pucks-il-home-delivery-at-least',
    rule: { ...pucksHomeDeliveryPolicy.rule, thresholdSemantics: 'at_least' }
  };
  const atLeast = quote([oldPersistedPucksObservation({ price: { amount: 25, currency: 'ILS' } })], { targetGrams: 1000, policies: [atLeastPolicy] });
  assert.equal(atLeast.best.shipping.freeThresholdSemantics, 'at_least');
  assert.equal(atLeast.best.shipping.amountIls, 0, 'a recorded "at least" wording keeps the inclusive comparison');
  assert.equal(atLeast.best.totalIls, 100);
});

test('an expired policy stops applying and the offer falls back to explicit unknown shipping', () => {
  const expired = { ...pucksHomeDeliveryPolicy, reviewBy: '2026-10-01T00:00:00.000Z' };
  const resolved = resolveShippingPolicy({ observation: oldPersistedPucksObservation(), policies: [expired], now: NOW });
  assert.equal(resolved.status, 'expired');
  const board = quote([oldPersistedPucksObservation()], { policies: [expired] });
  assert.equal(board.best, null, 'a stale rate cannot rank');
  assert.equal(board.unrankable.length, 1);
  assert.match(board.unrankable[0].reasons.join(' '), /not published before checkout/);
  assert.equal(board.unrankable[0].shipping.amountIls, null, 'an expired policy never becomes zero');
});

test('conflicting policies for the same scope stay unresolved instead of guessing', () => {
  const conflicting = [
    pucksHomeDeliveryPolicy,
    { ...pucksHomeDeliveryPolicy, id: 'pucks-il-home-delivery-alt', version: 3, rule: { ...pucksHomeDeliveryPolicy.rule, amount: { amount: 45, currency: 'ILS' } } }
  ];
  const resolved = resolveShippingPolicy({ observation: oldPersistedPucksObservation(), policies: conflicting, now: NOW });
  assert.equal(resolved.status, 'inconsistent');
  const board = quote([oldPersistedPucksObservation()], { policies: conflicting });
  assert.equal(board.best, null, 'inconsistent evidence does not silently pick a rate');
  assert.equal(board.unrankable[0].shipping.amountIls, null);
});

test('enrichment only fills missing fields and never overwrites a fresher parsed rate', () => {
  const parsed = oldPersistedPucksObservation({
    shipping: {
      mode: 'delivery',
      service: 'home_delivery',
      certainty: 'verified',
      amount: { amount: 25, currency: 'ILS' },
      destination: { scope: 'country', country: 'IL' },
      note: 'Published rate'
    }
  });
  const enriched = enrichObservationShipping(parsed, { policies: [pucksHomeDeliveryPolicy], now: NOW });
  assert.equal(enriched.status, 'applied');
  assert.equal(enriched.observation.shipping.amount.amount, 25, 'the observation keeps its own amount');
  assert.equal(enriched.observation.shipping.freeThreshold.amount, 100, 'only the missing threshold is filled');
  assert.equal(enriched.observation.shipping.certainty, 'verified', 'the parsed certainty is not replaced by the policy certainty');
});

test('the Pucks adapter stamps the policy version it was parsed from', () => {
  const html = readFileSync(new URL('./fixtures/pucks-product.html', import.meta.url));
  const observation = parsePucksProduct(html.toString('utf8'), { now: NOW });
  assert.equal(observation.shipping.policy.id, 'pucks-il-home-delivery');
  assert.equal(observation.shipping.policy.version, pucksHomeDeliveryPolicy.version);
  assert.equal(observation.shipping.service, 'home_delivery');
  assert.equal(observation.shipping.certainty, 'checkout_quote');
  assert.equal(observation.shipping.amount.amount, 30);
  assert.equal(observation.shipping.freeThreshold.amount, 100);
});

test('the public policy summary exposes versions and review dates without payloads', () => {
  const summary = policySummary(NOW);
  assert.equal(summary.length, SHIPPING_POLICIES.length);
  for (const entry of summary) {
    assert.equal(typeof entry.id, 'string');
    assert.equal(entry.expired, false);
    assert.ok(Date.parse(entry.reviewBy) > NOW);
    assert.ok(!('evidence' in entry) || typeof entry.evidence !== 'object', 'no evidence payload in the summary');
  }
});

// An expired policy must not be applied at parse time either: the adapter is a
// second place where a researched rule enters the board, and it must honor the
// same `reviewBy` gate as the read-time evaluator so an overdue rate becomes
// explicit unknown shipping instead of a stale unconditional quote.
test('an expired Pucks policy is withheld at parse time and the offer falls back to explicit unknown shipping', () => {
  const AFTER_REVIEW = Date.parse('2026-11-12T00:00:00.000Z');
  const html = readFileSync(new URL('./fixtures/pucks-product.html', import.meta.url)).toString('utf8');
  const expired = parsePucksProduct(html, { now: AFTER_REVIEW });
  assert.equal(expired.shipping.certainty, 'unknown');
  assert.equal(expired.shipping.amount, null);
  assert.equal(expired.shipping.freeThreshold ?? null, null);
  assert.match(expired.shipping.note, /past its review date/);
  const board = quoteBoard({
    observations: [expired],
    targetGrams: 500,
    destination: findDestination('tel-aviv'),
    now: AFTER_REVIEW
  });
  assert.equal(board.ranked.length, 0, 'an overdue rate cannot rank');
  assert.match(board.unrankable[0].reasons.join(' '), /not published before checkout/);
  const current = parsePucksProduct(html, { now: NOW });
  assert.equal(current.shipping.certainty, 'checkout_quote', 'the same page parses with the rate while the policy is current');
  assert.equal(current.shipping.amount.amount, 30);
});

test('an expired CoffeeMan cart policy drops the 8-pack quote and the alternative but keeps the page-published single rate', () => {
  const AFTER_REVIEW = Date.parse('2026-11-12T00:00:00.000Z');
  const read = name => decodeHtml(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
  const eight = parseCoffeemanProduct(read('coffeeman-8pack-product.windows-1255.html'), { now: AFTER_REVIEW, url: 'https://example.test/8pack' });
  assert.equal(eight.shipping.certainty, 'unknown');
  assert.equal(eight.shipping.amount, null);
  assert.equal(eight.shipping.alternatives.length, 0);
  assert.equal(eight.shipping.maxTotalGrams ?? null, null);
  assert.match(eight.shipping.note, /past its review date/);
  const eightBoard = quoteBoard({
    observations: [eight],
    targetGrams: 500,
    destination: findDestination('tel-aviv'),
    now: AFTER_REVIEW
  });
  assert.equal(eightBoard.ranked.length, 0, 'the withheld 8-pack quote cannot rank');
  const single = parseCoffeemanProduct(read('coffeeman-product.windows-1255.html'), { now: AFTER_REVIEW });
  assert.equal(single.shipping.certainty, 'verified', 'the product page publishes the ₪25 courier rate independently of the policy');
  assert.equal(single.shipping.amount.amount, 25);
  assert.equal(single.shipping.freeThreshold ?? null, null, 'the cart-observed free condition is withheld with its policy');
  assert.equal(single.shipping.alternatives.length, 0, 'the cart-observed ₪15 alternative is withheld with its policy');
  const singleBoard = quoteBoard({
    observations: [single],
    targetGrams: 500,
    destination: findDestination('tel-aviv'),
    now: AFTER_REVIEW
  });
  assert.equal(singleBoard.ranked.length, 1, 'the page-published rate still ranks');
  assert.equal(singleBoard.best.totalIls, 91);
  const singleBoard2000 = quoteBoard({
    observations: [single],
    targetGrams: 2000,
    destination: findDestination('tel-aviv'),
    now: AFTER_REVIEW
  });
  assert.equal(singleBoard2000.best.shipping.amountIls, 25, 'an overdue free condition never becomes a stale free promise');
  assert.equal(singleBoard2000.best.shipping.freeThreshold ?? null, null);
});
