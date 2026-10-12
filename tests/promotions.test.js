// Published quantity promotions: the vendor-published item-price discount that
// the board applies on top of the observed unit price.
//
// CoffeeMan publishes "10% off ground coffee from a ₪250 item subtotal
// (multipacks excluded)" in the promotion banner of the single 250 g product
// page, and the anonymous 8 × 250 g cart observed on 2026-10-12 showed exactly
// that: ₪264 item subtotal, ₪237.60 after the automatic checkout discount.
// These tests pin the parsed banner, the validated fallback used only for rows
// stored before banner parsing, the boundary and multipack scope, and the
// quote-level arithmetic.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeHtml } from '../src/lib/text.js';
import { parseCoffeemanProduct, parseCoffeemanPromotion } from '../src/vendors/coffeeman.js';
import {
  PROMOTIONS,
  coffeemanGroundCoffeePercentPromotion,
  validatePromotion,
  validatePromotions,
  promotionIsCurrent,
  promotionApplies,
  resolvePromotion,
  promotionSummary
} from '../src/lib/promotions.js';
import { quoteBoard, quoteOffer, findDestination } from '../src/lib/quote.js';

const NOW = Date.parse('2026-10-12T23:50:00.000Z');
const fixtures = new URL('./fixtures/', import.meta.url);
const read = name => readFileSync(new URL(name, fixtures));

const PRODUCT_URL = 'https://www.coffeeman.co.il/product/250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico';
const FOUR_PACK_URL = 'https://www.coffeeman.co.il/product/4-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico';
const EIGHT_PACK_URL = 'https://www.coffeeman.co.il/product/8-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico';

const singleObservation = (overrides = {}) => parseCoffeemanProduct(decodeHtml(read('coffeeman-product.windows-1255.html')), { now: NOW, url: PRODUCT_URL, ...overrides });
const fourObservation = () => parseCoffeemanProduct(decodeHtml(read('coffeeman-4pack-product.windows-1255.html')), { now: NOW, url: FOUR_PACK_URL });
const eightObservation = () => parseCoffeemanProduct(decodeHtml(read('coffeeman-8pack-product.windows-1255.html')), { now: NOW, url: EIGHT_PACK_URL });

/** An old persisted CoffeeMan single-pack row exactly as earlier parser versions stored it. */
function oldPersistedCoffeemanSingleObservation(overrides = {}) {
  return {
    key: 'coffeeman:930333:classico:ground:250g:x1',
    vendor: { id: 'coffeeman', name: 'CoffeeMan (אמיגו)', homepage: 'https://www.coffeeman.co.il' },
    itemUrl: PRODUCT_URL,
    product: {
      productId: 'lavazza-crema-e-gusto-vacuum-ground',
      name: '250 גרם קפה טחון lavazza Crema e Gusto Classico חוזק 7',
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
      certainty: 'verified',
      amount: { amount: 25, currency: 'ILS' },
      destination: { scope: 'country', country: 'IL' }
    },
    observedAt: '2026-10-12T15:51:52.931Z',
    ...overrides
  };
}

test('the checked-in promotion validates and is inside its review window', () => {
  const check = validatePromotion(coffeemanGroundCoffeePercentPromotion);
  assert.equal(check.ok, true, check.errors.join('; '));
  assert.equal(validatePromotions(PROMOTIONS).ok, true);
  assert.equal(promotionIsCurrent(coffeemanGroundCoffeePercentPromotion, NOW), true);
  assert.equal(promotionIsCurrent(coffeemanGroundCoffeePercentPromotion, Date.parse('2026-12-01T00:00:00Z')), false);
});

test('validatePromotion rejects a malformed promotion instead of guessing', () => {
  const malformed = [
    { ...coffeemanGroundCoffeePercentPromotion, percent: 0 },
    { ...coffeemanGroundCoffeePercentPromotion, percent: 'ten' },
    { ...coffeemanGroundCoffeePercentPromotion, minItemSubtotal: { amount: 250, currency: 'SHEKEL' } },
    { ...coffeemanGroundCoffeePercentPromotion, semantics: 'roughly' },
    { ...coffeemanGroundCoffeePercentPromotion, wording: '' },
    { ...coffeemanGroundCoffeePercentPromotion, evidence: { url: PRODUCT_URL } }
  ];
  for (const promotion of malformed) {
    assert.equal(validatePromotion(promotion).ok, false, `expected rejection: ${JSON.stringify(promotion).slice(0, 80)}`);
  }
});

test('the product page promotion banner is parsed into the validated shape', () => {
  const promotion = parseCoffeemanPromotion(decodeHtml(read('coffeeman-product.windows-1255.html')), { url: PRODUCT_URL });
  assert.ok(promotion, 'the single-pack page publishes the 10% banner');
  assert.equal(promotion.id, coffeemanGroundCoffeePercentPromotion.id);
  assert.equal(promotion.percent, 10);
  assert.equal(promotion.minItemSubtotal.amount, 250);
  assert.equal(promotion.minItemSubtotal.currency, 'ILS');
  assert.equal(promotion.semantics, 'at_least', 'the vendor wording "ב-250 ש\\"ח" means at ₪250');
  assert.equal(promotion.excludesMultipacks, true);
  assert.match(promotion.wording, /10% הנחה/);
  assert.match(promotion.wording, /250/);
  assert.equal(validatePromotion(promotion).ok, true, 'a parsed banner is validated before it can reduce a price');
});

test('a gift banner with no percent-off rule is never turned into a discount', () => {
  assert.equal(parseCoffeemanPromotion(decodeHtml(read('coffeeman-4pack-product.windows-1255.html')), { url: FOUR_PACK_URL }), null);
  assert.equal(parseCoffeemanPromotion(decodeHtml(read('coffeeman-8pack-product.windows-1255.html')), { url: EIGHT_PACK_URL }), null);
  const four = fourObservation();
  const eight = eightObservation();
  assert.deepEqual(four.promotions, [], 'a checked page with no discount banner records an explicit empty list');
  assert.deepEqual(eight.promotions, []);
  assert.equal(singleObservation().promotions.length, 1, 'the single-pack row carries the parsed promotion');
});

test('promotionApplies honours the vendor boundary and the multipack exclusion', () => {
  const promotion = coffeemanGroundCoffeePercentPromotion;
  assert.equal(promotionApplies(promotion, { itemSubtotalIls: 264, packCount: 1 }), true);
  assert.equal(promotionApplies(promotion, { itemSubtotalIls: 250, packCount: 1 }), true, '"at ₪250" includes the boundary');
  assert.equal(promotionApplies(promotion, { itemSubtotalIls: 231, packCount: 1 }), false, 'the observed ₪231 cart got no discount');
  assert.equal(promotionApplies(promotion, { itemSubtotalIls: 264, packCount: 4 }), false, 'multipacks are excluded by the vendor wording');
  assert.equal(promotionApplies({ ...promotion, semantics: 'above' }, { itemSubtotalIls: 250, packCount: 1 }), false);
});

test('resolvePromotion applies the fallback only when the observation was never banner-checked', () => {
  const old = oldPersistedCoffeemanSingleObservation();
  const applied = resolvePromotion({ observation: old, itemSubtotalIls: 264, packCount: 1, now: NOW });
  assert.equal(applied.status, 'applied');
  assert.equal(applied.source, 'policy');
  assert.equal(applied.discountIls, 26.4);

  const checked = resolvePromotion({ observation: { ...old, promotions: [] }, itemSubtotalIls: 264, packCount: 1, now: NOW });
  assert.equal(checked.status, 'none', 'a parsed empty list means checked-and-none, never fallback-enriched');

  const parsed = resolvePromotion({
    observation: { ...old, promotions: [parseCoffeemanPromotion(decodeHtml(read('coffeeman-product.windows-1255.html')), { url: PRODUCT_URL })] },
    itemSubtotalIls: 264,
    packCount: 1,
    now: NOW
  });
  assert.equal(parsed.status, 'applied');
  assert.equal(parsed.source, 'page');

  const below = resolvePromotion({ observation: old, itemSubtotalIls: 231, packCount: 1, now: NOW });
  assert.equal(below.status, 'none');
  const multipack = resolvePromotion({ observation: old, itemSubtotalIls: 264, packCount: 4, now: NOW });
  assert.equal(multipack.status, 'none');
});

test('an expired fallback promotion stops applying', () => {
  const expired = [{ ...coffeemanGroundCoffeePercentPromotion, reviewBy: '2026-10-13T00:00:00.000Z' }];
  const old = oldPersistedCoffeemanSingleObservation();
  const later = Date.parse('2026-11-20T00:00:00Z');
  assert.equal(resolvePromotion({ observation: old, itemSubtotalIls: 264, packCount: 1, now: later, promotions: expired }).status, 'none');
  assert.equal(resolvePromotion({ observation: old, itemSubtotalIls: 264, packCount: 1, now: NOW, promotions: expired }).status, 'applied');
});

test('quoteBoard discounts 8 single packs with the published promotion but never the multipacks', () => {
  const observations = [singleObservation(), fourObservation(), eightObservation()];
  const at2000 = quoteBoard({
    observations,
    productId: 'lavazza-crema-e-gusto-vacuum-ground',
    targetGrams: 2000,
    destination: findDestination('tel-aviv'),
    now: NOW
  });
  const singles = at2000.ranked.find(quote => quote.key.includes('250g'));
  assert.equal(singles.units, 8);
  assert.equal(singles.itemSubtotalBeforeDiscountIls, 264, '8 × ₪33 before the promotion');
  assert.equal(singles.itemDiscount.percent, 10);
  assert.equal(singles.itemDiscount.amountIls, 26.4);
  assert.equal(singles.itemTotalIls, 237.6, 'the observed anonymous cart showed exactly ₪237.60');
  assert.equal(singles.shipping.amountIls, 25, 'the published courier rate still applies; free shipping is never inferred');
  assert.equal(singles.totalIls, 262.6);
  assert.match(singles.labels.join(' '), /Published promotion applied: 10% off the item subtotal/);

  const fourPack = at2000.ranked.find(quote => quote.key.includes('1000g'));
  const eightPack = at2000.ranked.find(quote => quote.key.includes('2000g'));
  assert.equal(fourPack.itemDiscount, null, 'the 4-pack is a multipack: no promotion');
  assert.equal(eightPack.itemDiscount, null, 'the 8-pack is a multipack: no promotion');
  assert.equal(at2000.best.key, eightPack.key, 'the 8-pack still wins at 2 kg: ₪260 vs ₪262.60');
  assert.equal(at2000.promotions[0].id, coffeemanGroundCoffeePercentPromotion.id);
});

test('the promotion never applies below the published ₪250 subtotal', () => {
  const observations = [singleObservation()];
  const at1000 = quoteBoard({
    observations,
    productId: 'lavazza-crema-e-gusto-vacuum-ground',
    targetGrams: 1000,
    destination: findDestination('tel-aviv'),
    now: NOW
  });
  assert.equal(at1000.best.itemTotalIls, 132, '4 × ₪33 is below the threshold');
  assert.equal(at1000.best.itemDiscount, null);
  assert.equal(at1000.best.totalIls, 157);
});

test('quoteOffer applies the fallback to an old persisted row and can be disabled for raw evidence', () => {
  const old = oldPersistedCoffeemanSingleObservation();
  const quoted = quoteOffer(old, { grams: 2000, destination: findDestination('tel-aviv'), fx: null, now: NOW, staleAfterMs: 1e12 });
  assert.equal(quoted.itemSubtotalBeforeDiscountIls, 264);
  assert.equal(quoted.itemTotalIls, 237.6);
  assert.equal(quoted.itemDiscount.source, 'policy');
  assert.match(quoted.itemDiscount.wording, /הנחה/);
  assert.equal(quoted.observedAt, old.observedAt, 'applying a promotion never touches the observation time');

  const raw = quoteOffer(old, { grams: 2000, destination: findDestination('tel-aviv'), fx: null, now: NOW, staleAfterMs: 1e12, promotions: null });
  assert.equal(raw.itemDiscount, null);
  assert.equal(raw.itemTotalIls, 264, 'the raw stored evidence keeps the undiscounted subtotal');
});

test('promotionSummary exposes the rule without payloads', () => {
  const summary = promotionSummary(NOW);
  assert.equal(summary.length, 1);
  assert.equal(summary[0].id, coffeemanGroundCoffeePercentPromotion.id);
  assert.equal(summary[0].percent, 10);
  assert.equal(summary[0].minItemSubtotal, 250);
  assert.equal(summary[0].expired, false);
  assert.equal(summary[0].reviewBy, coffeemanGroundCoffeePercentPromotion.reviewBy);
});
