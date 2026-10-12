import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quoteBoard, findDestination } from '../src/lib/quote.js';
import {
  SHIPPING_POLICIES,
  pucksHomeDeliveryPolicy,
  coffeemanEightPackPolicy,
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

const COFFEEMAN_EIGHT_PACK_URL = 'https://www.coffeeman.co.il/product/8-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico';
const COFFEEMAN_SINGLE_URL = 'https://www.coffeeman.co.il/product/250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico';

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
  assert.equal(SHIPPING_POLICIES.length >= 2, true);
  const pucks = SHIPPING_POLICIES.find(policy => policy.id === pucksHomeDeliveryPolicy.id);
  assert.ok(pucks, 'the evidenced Pucks rule is a checked-in policy');
  assert.equal(pucks.origin, 'observed_cart', 'a cart-observed rule is never relabelled as published');
  assert.equal(pucks.certainty, 'checkout_quote');
  assert.equal(pucks.rule.thresholdSemantics, 'above', 'the vendor wording "above ₪100" is preserved, not silently rewritten');
  const coffeeman = SHIPPING_POLICIES.find(policy => policy.id === coffeemanEightPackPolicy.id);
  assert.ok(coffeeman, 'the researched CoffeeMan 8-pack cart quote is a checked-in policy');
  assert.equal(coffeeman.origin, 'observed_cart');
  assert.equal(coffeeman.certainty, 'checkout_quote');
  assert.equal(coffeeman.rule.maxTotalGrams, 2000, 'the cart quote is scoped to the 2 kg cart it was observed on');
  assert.equal(coffeeman.rule.freeThreshold, null, 'no free threshold is invented from unobserved larger carts');
  assert.equal(coffeeman.service, 'home_delivery');
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

  // The policy is scoped to the 8-pack offer URL: the single-pack listing keeps
  // its own evidence and is never given the multipack cart rate.
  const single = oldPersistedCoffeemanEightPackObservation({
    key: 'coffeeman:930333:classico:ground:250g:x1',
    itemUrl: COFFEEMAN_SINGLE_URL,
    product: { ...oldPersistedCoffeemanEightPackObservation().product, packCount: 1, totalGrams: 250, sku: '930333' }
  });
  const singleBoard = quote([single]);
  assert.equal(singleBoard.unrankable.length, 1);
  assert.equal(singleBoard.unrankable[0].shipping.policy, null, 'the 8-pack cart quote is not applied to the single pack');
  assert.match(singleBoard.unrankable[0].reasons.join(' '), /not published before checkout/);
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
