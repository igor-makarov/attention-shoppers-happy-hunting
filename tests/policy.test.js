import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quoteBoard, findDestination } from '../src/lib/quote.js';
import {
  SHIPPING_POLICIES,
  pucksHomeDeliveryPolicy,
  validatePolicy,
  validatePolicies,
  resolveShippingPolicy,
  enrichObservationShipping,
  policySummary
} from '../src/lib/policies.js';
import { parsePucksProduct } from '../src/vendors/pucks.js';

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

test('the checked-in shipping policies are structurally valid', () => {
  const result = validatePolicies(SHIPPING_POLICIES);
  assert.equal(result.ok, true, JSON.stringify(result.results));
  assert.equal(SHIPPING_POLICIES.length >= 1, true);
  const pucks = SHIPPING_POLICIES.find(policy => policy.id === pucksHomeDeliveryPolicy.id);
  assert.ok(pucks, 'the evidenced Pucks rule is a checked-in policy');
  assert.equal(pucks.origin, 'observed_cart', 'a cart-observed rule is never relabelled as published');
  assert.equal(pucks.certainty, 'checkout_quote');
  assert.equal(pucks.rule.thresholdSemantics, 'above', 'the vendor wording "above ₪100" is preserved, not silently rewritten');
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
  assert.equal(board.best.shipping.policy.version, 1);
  // The old row already had a generic country destination, so the policy's
  // coverage caveat must still be attached: an enriched rate is never presented
  // as unconditional country-wide delivery.
  assert.match(board.best.shipping.coverageCaveat, /not individually verified/);
  assert.equal(board.best.shipping.destination.scope, 'country', 'the row keeps its own destination scope');
  assert.equal(board.best.labels.some(label => /Delivery coverage caveat/.test(label)), true);
  assert.equal(board.best.totalIls, 90, '2 × ₪30 item + ₪30 shipping; the ₪100 threshold is not met at ₪60');
  assert.match(board.best.shipping.note, /validated policy pucks-il-home-delivery v1/);

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
